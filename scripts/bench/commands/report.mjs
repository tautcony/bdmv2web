#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Option } from "commander";
import { createProgram, exitWithError, parseOptions } from "../lib/cli.mjs";
import { environmentIdentity, runIdentity, stable } from "../store/compatibility.mjs";
import { DRIFT_LIMIT_PERCENT, forkMedians, median } from "../lib/stats.mjs";
import { readGcSeries, readSampleRef } from "../store/samples.mjs";
import { cleanText, html } from "../render/html.mjs";

/** Same defaults as bench:compare. */
const CHANGE_RELATIVE_PERCENT = 10;
const CHANGE_ABSOLUTE_MS = 0.05;
const SAMPLE_WINDOW_POINTS = 48;
/** Runs within this window of the newest run and with the same identity form the current session. */
const CURRENT_SESSION_HOURS = 6;

const RUN_MODES = ["benchmark", "cpu", "heap", "memory", "child", "browser"];
const FORMATS = ["json", "markdown", "html"];

function createReportCommand() {
  return createProgram("bench-report", "Render benchmark run records as a trend report.")
    .argument("<input...>", "run record file or run directory")
    .addOption(new Option("--format <format>", "report format").choices(FORMATS).default("markdown"))
    .option("--out <file>", "write the report to a file");
}

function parseArgs(args) {
  const command = createReportCommand();
  const options = parseOptions(command, args);
  return { inputs: command.args, format: options.format, out: options.out ?? null };
}
async function findRuns(input) {
  const path = resolve(input);
  const info = await stat(path);
  if (info.isFile()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await findRuns(child));
    else if (entry.isFile() && entry.name === "run.json") files.push(child);
  }
  return files;
}
async function loadRuns(inputs) {
  const files = [...new Set((await Promise.all(inputs.map(findRuns))).flat())].sort();
  const runs = [];
  for (const file of files) {
    const run = JSON.parse(await readFile(file, "utf8"));
    if (run.schemaVersion !== 1 || !RUN_MODES.includes(run.mode)) continue;
    await attachForkDetails(file, run);
    runs.push({ file, run });
  }
  if (!runs.length) throw new Error(`No schemaVersion 1 run records were found in ${inputs.join(", ")}`);
  const superseded = new Set(runs.flatMap((item) => item.run.sourceRunIds ?? []));
  return runs.filter((item) => !superseded.has(item.run.runId));
}
async function attachForkDetails(file, run) {
  if (run.mode !== "benchmark") return;
  const directory = dirname(file);
  for (const row of run.rows ?? []) for (const fork of row.forks ?? []) {
    if (Array.isArray(fork.rawMsPerCall)) fork.sampleValues = fork.rawMsPerCall;
    else if (fork.rawMsPerCall?.file) {
      try { fork.sampleValues = await readSampleRef(directory, fork); } catch { fork.sampleValues = null; }
    }
    if (Array.isArray(fork.gc?.events)) fork.gcEventList = fork.gc.events;
    else if (fork.gc?.series?.file) {
      try { fork.gcEventList = await readGcSeries(directory, fork.gc); } catch { fork.gcEventList = null; }
    }
  }
}
function finiteMedian(values) { return median(values.filter(Number.isFinite)); }
function finiteMax(values) { const present = values.filter(Number.isFinite); return present.length ? Math.max(...present) : null; }
function quantileSorted(sorted, p) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * p, low = Math.floor(at), high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}
/** Keep one point per bucket, using the bucket maximum so pauses stay visible. */
function downsampleMax(values, limit = SAMPLE_WINDOW_POINTS) {
  if (values.length <= limit) return [...values];
  const out = [], bucket = values.length / limit;
  for (let index = 0; index < limit; index++) {
    const start = Math.floor(index * bucket), end = Math.max(start + 1, Math.floor((index + 1) * bucket));
    let peak = 0;
    for (let at = start; at < Math.min(end, values.length); at++) peak = Math.max(peak, values[at]);
    out.push(peak);
  }
  return out;
}
function changeBetween(previous, latest) {
  if (!previous || !latest || !Number.isFinite(previous.forkMedianMs) || !Number.isFinite(latest.forkMedianMs)) return null;
  const deltaMs = latest.forkMedianMs - previous.forkMedianMs;
  const percent = previous.forkMedianMs > 0 ? deltaMs / previous.forkMedianMs * 100 : (deltaMs === 0 ? 0 : null);
  const significant = percent !== null && Math.abs(percent) >= CHANGE_RELATIVE_PERCENT && Math.abs(deltaMs) >= CHANGE_ABSOLUTE_MS;
  return {
    fromRunId: previous.runId, toRunId: latest.runId, fromMs: previous.forkMedianMs, toMs: latest.forkMedianMs,
    deltaMs, percent, significant, status: !significant ? "stable" : deltaMs > 0 ? "regression" : "improvement",
  };
}
function forkSummary(row) {
  const forks = row?.forks ?? [];
  const perFork = (key) => forks.map((fork) => fork?.stats?.[key]).filter(Number.isFinite);
  const forkMediansMs = forkMedians(row);
  const medianFork = median(forkMediansMs);
  const samples = [];
  let windowSource = null;
  for (const fork of forks) {
    const values = fork?.sampleValues;
    if (!values?.length) continue;
    for (const value of values) if (Number.isFinite(value)) samples.push(value);
    if (!windowSource || values.length > windowSource.length) windowSource = values;
  }
  samples.sort((a, b) => a - b);
  const q = (p) => quantileSorted(samples, p);
  const distribution = samples.length
    ? { min: samples[0], p5: q(0.05), p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99), max: samples[samples.length - 1], sampleCount: samples.length }
    : { min: finiteMedian(perFork("min")), p5: null, p25: null, median: medianFork, p75: null, p95: finiteMedian(perFork("p95")), p99: finiteMedian(perFork("p99")), max: finiteMax(perFork("max")), sampleCount: 0 };
  const perForkGc = forks.map((fork) => {
    const events = Array.isArray(fork?.gcEventList) ? fork.gcEventList : Array.isArray(fork?.gc?.events) ? fork.gc.events : [];
    const durations = events.map((event) => event?.durationMs).filter(Number.isFinite);
    const totalMs = durations.length ? durations.reduce((sum, value) => sum + value, 0) : null;
    const calls = (fork?.iterations ?? 0) * (fork?.callsPerSample ?? row?.callsPerSample ?? 1);
    return {
      events: events.length || fork?.gc?.eventCount || 0,
      totalMs,
      maxPauseMs: durations.length ? Math.max(...durations) : null,
      major: events.filter((event) => event?.kind !== 1).length,
      minor: events.filter((event) => event?.kind === 1).length,
      msPerCall: totalMs !== null && calls ? totalMs / calls : null,
      sharePercent: totalMs !== null && fork?.wallMs ? totalMs / fork.wallMs * 100 : null,
    };
  });
  const childForks = forks.map((fork) => fork?.child).filter((child) => child?.calls);
  const childCalls = childForks.reduce((sum, child) => sum + child.calls, 0);
  const childGcMs = childForks.reduce((sum, child) => sum + (child.gc?.durationMs ?? 0), 0);
  const childDurationMs = childForks.reduce((sum, child) => sum + (child.durationMs ?? 0), 0);
  const childMemory = childForks.length ? {
    heapUsedBytes: Math.max(...childForks.map((child) => child.memory?.heapUsedBytes ?? 0)),
    peakRssBytes: Math.max(...childForks.map((child) => child.memory?.rssBytes ?? 0)),
    maxRSSBytes: Math.max(...childForks.map((child) => child.memory?.maxRSSBytes ?? 0)),
    externalBytes: Math.max(...childForks.map((child) => child.memory?.externalBytes ?? 0)),
  } : null;
  const cpuParentOnly = forks.some((fork) => fork?.cpuUsage?.coversSpawnedProcess === false);
  const parentOnly = !childForks.length && cpuParentOnly;
  const gc = childForks.length ? {
    parentOnly: false,
    events: childForks.reduce((sum, child) => sum + (child.gc?.events ?? 0), 0),
    major: childForks.reduce((sum, child) => sum + (child.gc?.major ?? 0), 0),
    minor: childForks.reduce((sum, child) => sum + (child.gc?.minor ?? 0), 0),
    totalMs: childGcMs,
    maxPauseMs: finiteMax(childForks.map((child) => child.gc?.maxPauseMs)),
    msPerCall: childCalls ? childGcMs / childCalls : null,
    sharePercent: childDurationMs ? childGcMs / childDurationMs * 100 : null,
    scope: "spawned CLI child processes; per-call values divide by child calls",
  } : {
    parentOnly,
    events: perForkGc.reduce((sum, item) => sum + item.events, 0),
    major: perForkGc.reduce((sum, item) => sum + item.major, 0),
    minor: perForkGc.reduce((sum, item) => sum + item.minor, 0),
    totalMs: finiteMedian(perForkGc.map((item) => item.totalMs)),
    maxPauseMs: finiteMax(perForkGc.map((item) => item.maxPauseMs)),
    msPerCall: finiteMedian(perForkGc.map((item) => item.msPerCall)),
    sharePercent: finiteMedian(perForkGc.map((item) => item.sharePercent)),
    scope: "parent process",
  };
  const memory = childForks.length ? { parentOnly: false, ...childMemory, scope: "spawned CLI child processes" } : {
    parentOnly,
    heapUsedBytes: finiteMedian(forks.map((fork) => fork?.memory?.heapUsedBytes)),
    peakRssBytes: finiteMedian(forks.map((fork) => fork?.memory?.peakObservedRssBytes)),
    maxRSSBytes: finiteMedian(forks.map((fork) => fork?.memory?.maxRSSBytes)),
    externalBytes: finiteMedian(forks.map((fork) => fork?.memory?.externalBytes)),
    scope: "parent process",
  };
  return {
    forkCount: forkMediansMs.length,
    callsPerSample: row?.callsPerSample ?? 1,
    forkMedianMs: medianFork,
    minForkMedianMs: forkMediansMs.length ? Math.min(...forkMediansMs) : null,
    maxForkMedianMs: forkMediansMs.length ? Math.max(...forkMediansMs) : null,
    p95Ms: finiteMedian(perFork("p95")),
    p99Ms: finiteMedian(perFork("p99")),
    opsPerSecond: medianFork > 0 ? 1000 / medianFork : null,
    worstCvPercent: perFork("cvPercent").length ? Math.max(...perFork("cvPercent")) : null,
    medianCvPercent: finiteMedian(perFork("cvPercent")),
    outlierPercent: finiteMedian(perFork("outlierPercent")),
    driftPercent: perFork("driftPercent").length ? perFork("driftPercent").reduce((worst, value) => (Math.abs(value) > Math.abs(worst) ? value : worst)) : null,
    unstable: perFork("driftPercent").some((value) => Math.abs(value) >= DRIFT_LIMIT_PERCENT),
    gcEvents: gc.events,
    gc,
    memory,
    parentOnly,
    cpuParentOnly,
    child: childForks.length ? { calls: childCalls, durationMs: childDurationMs } : null,
    transport: forks.find((fork) => fork?.input?.transport)?.input.transport ?? null,
    cpuMsPerCall: finiteMedian(forks.map((fork) => {
      const usage = fork?.cpuUsage;
      const calls = (fork?.iterations ?? 0) * (fork?.callsPerSample ?? row?.callsPerSample ?? 1);
      return usage && calls ? ((usage.user ?? 0) + (usage.system ?? 0)) / 1000 / calls : null;
    })),
    iterations: finiteMedian(forks.map((fork) => fork?.iterations)),
    wallMs: finiteMedian(forks.map((fork) => fork?.wallMs)),
    distribution,
    sampleWindow: windowSource ? downsampleMax(Array.from(windowSource)) : [],
  };
}
function profileKey(row, run) {
  return `${row.caseId}\0${stable(row.fixture ?? {})}\0${environmentIdentity(run.environment)}\0${run.environment?.revision ?? ""}`;
}
function buildTrend(runs) {
  const seriesMap = new Map();
  const statuses = [];
  const profileRuns = [];
  const profileMap = new Map();
  for (const { file, run } of runs) {
    if (run.mode === "benchmark") continue;
    for (const row of run.rows ?? []) {
      const artifacts = (row.artifacts ?? []).map((path) => ({ path, runDirectory: dirname(file) }));
      profileRuns.push({ mode: run.mode, runId: run.runId, createdAt: run.createdAt, caseId: row.caseId, fixture: row.fixture, revision: run.environment?.revision ?? null, environment: run.environment, artifacts });
      const key = profileKey(row, run);
      profileMap.set(key, [...(profileMap.get(key) ?? []), ...artifacts]);
    }
  }
  for (const { file, run } of runs) {
    if (run.mode !== "benchmark") continue;
    const identity = runIdentity(run);
    for (const row of run.rows ?? []) {
      const failed = (run.failures ?? []).filter((item) => item.caseId === row.caseId);
      const skipped = (run.skipped ?? []).filter((item) => item.caseId === row.caseId);
      if (failed.length || skipped.length) {
        statuses.push({ runId: run.runId, createdAt: run.createdAt, caseId: row.caseId, status: failed.length ? "failed" : "skipped", reason: [...failed, ...skipped].map((item) => item.reason).filter(Boolean).join("; "), file });
        continue;
      }
      const key = `${row.caseId}\0${identity}\0${stable(row.fixture ?? {})}\0${stable(row.scope)}`;
      if (!seriesMap.has(key)) seriesMap.set(key, { caseId: row.caseId, fixture: row.fixture, category: row.category, name: row.name, sample: row.sample, source: row.source ?? null, scope: row.scope, environment: run.environment, environmentIdentity: identity, environmentSeries: "", runs: [] });
      const inlineProfiles = (row.forks ?? []).filter((fork) => fork.profilePath).map((fork) => ({ path: fork.profilePath, runDirectory: dirname(file) }));
      const outputStatuses = [...new Set((row.forks ?? []).map((fork) => fork.output?.details?.status ?? fork.output?.details?.decision ?? "measured").filter(Boolean))];
      seriesMap.get(key).runs.push({ runId: run.runId, createdAt: run.createdAt, revision: run.environment?.revision ?? null, dirty: run.environment?.dirty ?? null, file, scope: row.scope, outputStatuses, ...forkSummary(row), profiles: [...inlineProfiles, ...(profileMap.get(profileKey(row, run)) ?? [])] });
    }
    for (const item of [...(run.skipped ?? []), ...(run.failures ?? [])]) {
      if (run.rows?.some((row) => row.caseId === item.caseId)) continue;
      const skipped = (run.skipped ?? []).some((entry) => entry.caseId === item.caseId);
      statuses.push({ runId: run.runId, createdAt: run.createdAt, status: skipped ? "skipped" : "failed", caseId: item.caseId ?? item.case, reason: item.reason ?? "", file });
    }
  }
  const series = [...seriesMap.values()].sort((a, b) => a.caseId.localeCompare(b.caseId) || a.environmentIdentity.localeCompare(b.environmentIdentity) || stable(a.fixture).localeCompare(stable(b.fixture)));
  const seriesLabels = new Map();
  for (const group of series) {
    if (!seriesLabels.has(group.environmentIdentity)) seriesLabels.set(group.environmentIdentity, `env-${String(seriesLabels.size + 1).padStart(2, "0")}`);
    group.environmentSeries = seriesLabels.get(group.environmentIdentity);
  }
  for (const group of series) group.runs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const benchmarkRuns = runs.filter((item) => item.run.mode === "benchmark");
  const newestRun = [...benchmarkRuns].sort((a, b) => String(a.run.createdAt).localeCompare(String(b.run.createdAt))).at(-1)?.run ?? null;
  const newestIdentity = newestRun ? runIdentity(newestRun) : null;
  const newestTime = newestRun ? Date.parse(newestRun.createdAt) : Number.NaN;
  const currentCutoff = Number.isFinite(newestTime) ? newestTime - CURRENT_SESSION_HOURS * 60 * 60 * 1000 : 0;
  // Old records with the same case can have a different fixture contract or harness
  // version. They remain in the history, but the ranking and KPI cards describe the
  // newest comparable session instead of mixing every historical series.
  const currentRunIds = new Set(newestRun ? benchmarkRuns.filter((item) => {
    const createdAt = Date.parse(item.run.createdAt);
    return createdAt >= currentCutoff && runIdentity(item.run) === newestIdentity;
  }).map((item) => item.run.runId) : []);
  for (const group of series) {
    const currentRuns = group.runs.filter((run) => currentRunIds.has(run.runId));
    const latest = currentRuns.at(-1) ?? group.runs.at(-1);
    const previous = currentRuns.length > 1 ? currentRuns.at(-2) : currentRuns.length === 0 && group.runs.length > 1 ? group.runs.at(-2) : null;
    const change = changeBetween(previous, latest);
    group.current = Boolean(currentRuns.length);
    group.change = change ? { caseId: group.caseId, ...change } : null;
  }
  const currentSeries = series.filter((group) => group.current);
  const caseCounts = new Map();
  for (const group of currentSeries) caseCounts.set(group.caseId, (caseCounts.get(group.caseId) ?? 0) + 1);
  for (const group of currentSeries) if (group.change && (caseCounts.get(group.caseId) ?? 0) > 1) group.change.label = `${group.caseId} · ${group.fixture?.id ?? group.scope ?? ""}`;
  const latestEntries = currentSeries.map((group) => ({ caseId: group.caseId, name: group.name, category: group.category, environmentSeries: group.environmentSeries, run: group.runs.at(-1) })).filter((entry) => entry.run);
  const topEntries = (accessor, count = 5) => latestEntries
    .map((entry) => ({ caseId: entry.caseId, name: entry.name, category: entry.category, environmentSeries: entry.environmentSeries, runId: entry.run.runId, value: accessor(entry.run) }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => b.value - a.value).slice(0, count);
  const changes = currentSeries.map((group) => group.change).filter(Boolean);
  const currentStatuses = statuses.filter((item) => currentRunIds.has(item.runId));
  const summary = {
    cases: currentSeries.length, allSeries: series.length, runs: benchmarkRuns.length, currentRuns: currentRunIds.size,
    environments: seriesLabels.size, profiles: profileRuns.length, newestRunAt: newestRun?.createdAt ?? null, currentFrom: newestRun && Number.isFinite(newestTime) ? new Date(currentCutoff).toISOString() : null,
    regressions: changes.filter((change) => change.status === "regression").length,
    improvements: changes.filter((change) => change.status === "improvement").length,
    stable: changes.filter((change) => change.status === "stable").length,
    unstable: latestEntries.filter((entry) => entry.run.unstable).length,
    failures: currentStatuses.filter((item) => item.status === "failed").length,
    skips: currentStatuses.filter((item) => item.status === "skipped").length,
    hotspots: {
      gc: topEntries((run) => run.gc?.parentOnly ? null : run.gc?.msPerCall),
      heap: topEntries((run) => run.memory?.parentOnly ? null : run.memory?.heapUsedBytes),
      slowest: topEntries((run) => run.forkMedianMs),
      variable: topEntries((run) => run.medianCvPercent),
    },
  };
  const categories = [...new Set(series.map((group) => group.category).filter(Boolean))].sort();
  const environments = [];
  for (const group of series) if (!environments.some((item) => item.label === group.environmentSeries)) environments.push({
    label: group.environmentSeries, node: group.environment?.node ?? null, platform: group.environment?.platform ?? null,
    architecture: group.environment?.architecture ?? null, cpuModel: group.environment?.cpuModel ?? null,
    cpuCount: group.environment?.cpuCount ?? null, buildMode: group.environment?.buildMode ?? null,
  });
  return { schemaVersion: 1, mode: "trend", createdAt: new Date().toISOString(), runCount: summary.runs, profileRunCount: profileRuns.length, environmentSeriesCount: seriesLabels.size, summary, categories, environments, profileRuns, series, statuses };
}
function profileLinks(profiles, baseDir) {
  if (!profiles.length) return "—";
  return profiles.map((profile) => `[${profile.path}](<${relative(baseDir, resolve(profile.runDirectory, profile.path)).split(sep).join("/")}>)`).join(", ");
}
function formatCell(value, digits = 4) {
  return Number.isFinite(value) ? Number(value).toPrecision(digits) : "—";
}
/** Drift stays a signed percentage with one decimal, never exponential. */
function formatDrift(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}
/** Qualify the unstable flag when GC ran inside the measured window. */
function unstableMark(run) {
  if (!run.unstable) return "";
  return run.gcEvents > 0 ? " ! gc" : " !";
}
function statusCounts(statuses) {
  let failed = 0, skipped = 0;
  for (const item of statuses) { if (item.status === "failed") failed++; else skipped++; }
  return { failed, skipped };
}
function markdown(trend, baseDir = process.cwd()) {
  const scope = trend.summary ? ` Current session: ${trend.summary.cases} cases from ${trend.summary.currentRuns} runs.` : "";
  const lines = ["# Benchmark trends", "", `Runs: ${trend.runCount}; environment series: ${trend.environmentSeriesCount}.${scope}`, "", "| Case | Fixture | Environment series | Run | Fork count | Calls/sample | Median of fork medians (ms) | p95 (ms) | p99 (ms) | Ops/s | Worst fork CV % | Outliers % | Drift % | Profiles |", "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"];
  for (const series of trend.series) for (const run of series.runs) {
    lines.push(`| ${series.caseId} | ${series.fixture?.id ?? "—"} | ${series.environmentSeries} | ${run.runId} | ${run.forkCount} | ${run.callsPerSample} | ${formatCell(run.forkMedianMs, 5)} | ${formatCell(run.p95Ms, 5)} | ${formatCell(run.p99Ms, 5)} | ${formatCell(run.opsPerSecond, 4)} | ${formatCell(run.worstCvPercent, 3)} | ${formatCell(run.outlierPercent, 3)} | ${formatDrift(run.driftPercent)}${unstableMark(run)} | ${profileLinks(run.profiles, baseDir)} |`);
  }
  if (trend.statuses.length) {
    const counts = statusCounts(trend.statuses);
    lines.push("", "## Recorded run failures and skips", "", `${counts.failed} failed and ${counts.skipped} skipped case records come from the source runs; they do not describe this report's rendering.`, "", "| Run | Case | Status | Reason |", "| --- | --- | --- | --- |");
    const root = trend.series.find((series) => series.environment?.repositoryRoot)?.environment?.repositoryRoot ?? null;
    for (const item of trend.statuses) lines.push(`| ${item.runId} | ${item.caseId} | ${item.status} | ${cleanText(item.reason, root).replaceAll("|", "\\|").replaceAll("\n", " ")} |`);
  }
  lines.push("", "Each plotted value is the median of independent process fork medians. Calls/sample is the number of operation calls divided into each timing sample. p95 and p99 are the median of per-fork percentiles, Ops/s derives from the median fork median, and the CV and outlier columns report the worst and median per-fork values. Drift is the change between the first and last fifth of a fork's samples as a share of its median; a row marked `!` drifted by 25% or more, and `! gc` adds that the fork recorded GC events during measurement.");
  return `${lines.join("\n")}\n`;
}

export { buildTrend, findRuns, html, loadRuns, markdown, parseArgs };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const runs = await loadRuns(options.inputs);
    const trend = buildTrend(runs);
    const outputPath = options.out ? resolve(options.out) : null;
    const baseDir = outputPath ? dirname(outputPath) : process.cwd();
    const output = options.format === "json" ? `${JSON.stringify(trend, null, 2)}\n` : options.format === "html" ? `${html(trend, baseDir)}\n` : markdown(trend, baseDir);
    // Rendered reports are derived from the records, so regenerating one in place
    // is the normal flow; the records themselves are never rewritten.
    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, output);
      const counts = statusCounts(trend.statuses);
      const lines = [`Wrote ${options.format} report: ${outputPath}`, `Source records: ${trend.runCount} benchmark runs, ${trend.profileRunCount} profile records, ${counts.failed} recorded failures, ${counts.skipped} recorded skips.`];
      if (trend.statuses.length) lines.push("Recorded failures and skips belong to those source runs; they do not describe this export.");
      process.stdout.write(`${lines.join("\n")}\n`);
    } else process.stdout.write(output);
  } catch (error) {
    exitWithError(error, 2);
  }
}
