#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Option } from "commander";
import { createProgram, exitWithError, parseOptions } from "./cli.mjs";
import { environmentIdentity, runIdentity, stable } from "./compatibility.mjs";
import { forkMedians, median } from "./stats.mjs";

const RUN_MODES = ["benchmark", "cpu", "heap", "memory", "browser"];
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
    runs.push({ file, run });
  }
  if (!runs.length) throw new Error(`No schemaVersion 1 run records were found in ${inputs.join(", ")}`);
  const superseded = new Set(runs.flatMap((item) => item.run.sourceRunIds ?? []));
  return runs.filter((item) => !superseded.has(item.run.runId));
}
function forkSummary(row) {
  const forks = forkMedians(row);
  const perFork = (key) => (row?.forks ?? []).map((fork) => fork?.stats?.[key]).filter(Number.isFinite);
  const medianFork = median(forks);
  return {
    forkCount: forks.length,
    callsPerSample: row?.callsPerSample ?? 1,
    forkMedianMs: medianFork,
    minForkMedianMs: forks.length ? Math.min(...forks) : null,
    maxForkMedianMs: forks.length ? Math.max(...forks) : null,
    p95Ms: median(perFork("p95")),
    p99Ms: median(perFork("p99")),
    opsPerSecond: medianFork > 0 ? 1000 / medianFork : null,
    worstCvPercent: perFork("cvPercent").length ? Math.max(...perFork("cvPercent")) : null,
    outlierPercent: median(perFork("outlierPercent")),
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
  return { schemaVersion: 1, mode: "trend", createdAt: new Date().toISOString(), runCount: runs.filter((item) => item.run.mode === "benchmark").length, profileRunCount: profileRuns.length, environmentSeriesCount: seriesLabels.size, profileRuns, series, statuses };
}
function profileLinks(profiles, baseDir) {
  if (!profiles.length) return "—";
  return profiles.map((profile) => `[${profile.path}](<${relative(baseDir, resolve(profile.runDirectory, profile.path))}>)`).join(", ");
}
function sourceLabel(series) {
  if (!series.source) return series.sample ?? "";
  return [series.source.disc, series.source.path].filter(Boolean).join(" · ");
}
function formatCell(value, digits = 4) {
  return Number.isFinite(value) ? Number(value).toPrecision(digits) : "—";
}
function markdown(trend, baseDir = process.cwd()) {
  const lines = ["# Benchmark trends", "", `Runs: ${trend.runCount}; environment series: ${trend.environmentSeriesCount}.`, "", "| Case | Fixture | Environment series | Run | Fork count | Calls/sample | Median of fork medians (ms) | p95 (ms) | p99 (ms) | Ops/s | Worst fork CV % | Outliers % | Profiles |", "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"];
  for (const series of trend.series) for (const run of series.runs) {
    lines.push(`| ${series.caseId} | ${series.fixture?.id ?? "—"} | ${series.environmentSeries} | ${run.runId} | ${run.forkCount} | ${run.callsPerSample} | ${formatCell(run.forkMedianMs, 5)} | ${formatCell(run.p95Ms, 5)} | ${formatCell(run.p99Ms, 5)} | ${formatCell(run.opsPerSecond, 4)} | ${formatCell(run.worstCvPercent, 3)} | ${formatCell(run.outlierPercent, 3)} | ${profileLinks(run.profiles, baseDir)} |`);
  }
  if (trend.statuses.length) {
    lines.push("", "## Skipped and failed cases", "", "| Run | Case | Status | Reason |", "| --- | --- | --- | --- |");
    for (const item of trend.statuses) lines.push(`| ${item.runId} | ${item.caseId} | ${item.status} | ${String(item.reason).replaceAll("|", "\\|").replaceAll("\n", " ")} |`);
  }
  lines.push("", "Each plotted value is the median of independent process fork medians. Calls/sample is the number of operation calls divided into each timing sample. p95 and p99 are the median of per-fork percentiles, Ops/s derives from the median fork median, and the CV and outlier columns report the worst and median per-fork values.");
  return `${lines.join("\n")}\n`;
}
function escapeXml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function hash(value) { let result = 0; for (const char of value) result = Math.imul(result, 31) + char.charCodeAt(0) | 0; return result; }
function cpuLabel(environment) {
  return environment?.cpuModel ?? `${environment?.platform ?? "?"}/${environment?.architecture ?? "?"}`;
}
function plotRow(series, seriesIndex) {
  const points = series.runs.filter((run) => Number.isFinite(run.forkMedianMs));
  if (!points.length) return "";
  const values = points.flatMap((point) => [point.minForkMedianMs, point.maxForkMedianMs]).filter(Number.isFinite);
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(max - min, Math.abs(max) * 0.1, 0.001);
  const low = Math.max(0, min - span * 0.15), high = max + span * 0.15;
  const chartWidth = Math.max(940, points.length * 90), plotLeft = 60, plotRight = chartWidth - 20;
  const top = seriesIndex * 136, plotTop = top + 30, plotBottom = top + 103;
  const scaleY = (value) => plotBottom - (value - low) / (high - low) * (plotBottom - plotTop);
  const xFor = (index) => points.length === 1 ? (plotLeft + plotRight) / 2 : plotLeft + index * (plotRight - plotLeft) / (points.length - 1);
  const coordinates = points.map((point, index) => `${xFor(index)},${scaleY(point.forkMedianMs)}`).join(" ");
  const marks = points.map((point, index) => `<line x1="${xFor(index)}" y1="${scaleY(point.minForkMedianMs)}" x2="${xFor(index)}" y2="${scaleY(point.maxForkMedianMs)}" stroke="#52606d" stroke-width="5"/><circle cx="${xFor(index)}" cy="${scaleY(point.forkMedianMs)}" r="4" fill="#1769aa"/><text x="${xFor(index)}" y="${plotBottom + 18}" text-anchor="middle">${escapeXml(String(point.revision ?? point.createdAt ?? "").slice(0, 7))}</text>`).join("");
  const label = `${escapeXml(series.name || series.caseId)} · ${escapeXml(series.sample ?? "")} · ${escapeXml(series.environmentSeries)} · ${escapeXml(cpuLabel(series.environment).slice(0, 56))} · ms`;
  return `<g><text x="12" y="${top + 16}">${label}</text><text x="8" y="${plotTop + 4}" text-anchor="end">${high.toPrecision(3)}</text><text x="8" y="${plotBottom + 4}" text-anchor="end">${low.toPrecision(3)}</text><line x1="${plotLeft}" y1="${plotTop}" x2="${plotRight}" y2="${plotTop}" stroke="#e1e5e8"/><line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#83909c"/><polyline points="${coordinates}" fill="none" stroke="hsl(${Math.abs(hash(series.caseId + series.environmentSeries)) % 360} 65% 42%)" stroke-width="2"/>${marks}</g>`;
}
function runRow(series, run, baseDir) {
  const profiles = run.profiles.map((profile) => { const href = relative(baseDir, resolve(profile.runDirectory, profile.path)); return `<a href="${escapeXml(href)}">${escapeXml(profile.path)}</a>`; }).join(", ");
  return `<tr><td><strong>${escapeXml(series.name || series.caseId)}</strong><br><small>${escapeXml(series.caseId)}</small></td><td>${escapeXml(series.fixture?.id ?? "")}<br><small>${escapeXml(series.sample ?? "")}</small></td><td>${escapeXml(sourceLabel(series))}</td><td>${escapeXml(series.scope ?? "")}</td><td>${escapeXml(run.outputStatuses.join(", ") || "measured")}</td><td>${escapeXml(series.environmentSeries)}<br><small>${escapeXml(cpuLabel(series.environment))}</small></td><td>${escapeXml(series.environment?.node ?? "")}/${escapeXml(series.environment?.v8 ?? "")}</td><td>${escapeXml(JSON.stringify(series.environment?.nodeOptions ?? series.environment?.execArgv ?? []))}</td><td>${escapeXml(String(series.environment?.buildMode ?? "unknown"))} (${escapeXml(String(series.environment?.profileBuildMode ?? "unknown"))})</td><td>${escapeXml(run.runId)}</td><td>${run.forkCount}</td><td>${run.callsPerSample}</td><td>${formatCell(run.forkMedianMs, 5)}</td><td>${formatCell(run.minForkMedianMs, 5)}–${formatCell(run.maxForkMedianMs, 5)}</td><td>${formatCell(run.p95Ms, 5)}</td><td>${formatCell(run.p99Ms, 5)}</td><td>${formatCell(run.opsPerSecond, 4)}</td><td>${formatCell(run.worstCvPercent, 3)}</td><td>${formatCell(run.outlierPercent, 3)}</td><td>${profiles || "—"}</td></tr>`;
}
function captureRow(capture, baseDir) {
  return capture.artifacts.map((artifact) => {
    const href = relative(baseDir, resolve(artifact.runDirectory, artifact.path));
    return `<tr><td>${escapeXml(capture.caseId)}</td><td>${escapeXml(capture.mode)}</td><td>${escapeXml(capture.fixture?.id ?? "")}</td><td>${escapeXml(capture.environment?.buildMode ?? "unknown")} (${escapeXml(String(capture.environment?.profileBuildMode ?? "unknown"))})</td><td>${escapeXml(cpuLabel(capture.environment))}</td><td>${escapeXml(capture.runId)}</td><td><a href="${escapeXml(href)}">${escapeXml(artifact.path)}</a></td></tr>`;
  }).join("");
}
function html(trend, baseDir = process.cwd()) {
  const data = JSON.stringify(trend).replaceAll("<", "\\u003c");
  const plotRows = trend.series.map(plotRow).join("");
  const width = Math.max(1000, ...trend.series.map((series) => Math.max(940, series.runs.length * 90) + 40));
  const height = Math.max(180, trend.series.length * 136 + 20);
  const runRows = trend.series.flatMap((series) => series.runs.map((run) => runRow(series, run, baseDir))).join("");
  const captureRows = trend.profileRuns.map((capture) => captureRow(capture, baseDir)).join("");
  const statusRows = trend.statuses.map((item) => `<li>${escapeXml(item.runId)} · ${escapeXml(item.caseId)}: ${escapeXml(item.status)} ${escapeXml(String(item.reason).slice(0, 220))}${String(item.reason).length > 220 ? "…" : ""}</li>`).join("");
  const style = "body{font:14px system-ui;margin:2rem;color:#17202a}svg{width:100%;height:auto;border:1px solid #ccd1d1}text{font:12px system-ui}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border-bottom:1px solid #ddd;padding:.4rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}small{color:#667}details{margin:1rem 0}";
  const summary = `${trend.runCount} benchmark runs · ${trend.profileRunCount} profile records · ${trend.environmentSeriesCount} environment series. Each row is one case and environment; points show median fork time and min–max fork medians in milliseconds. Calls/sample is the number of operation calls divided into each timing sample. p95 and p99 are the median of per-fork percentiles, Ops/s derives from the median fork median, and the CV and outlier columns report the worst and median per-fork values.`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Benchmark trends</title><style>${style}</style><h1>Benchmark trends</h1><p>${summary}</p><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Benchmark fork median trends">${plotRows}</svg><h2>Run records</h2><table><thead><tr><th>Case</th><th>Fixture</th><th>Source</th><th>Scope</th><th>Output status</th><th>Environment</th><th>Node/V8</th><th>Node options</th><th>Build mode</th><th>Run</th><th>Forks</th><th>Calls/sample</th><th>Median of fork medians (ms)</th><th>Fork median range (ms)</th><th>p95 (ms)</th><th>p99 (ms)</th><th>Ops/s</th><th>Worst fork CV %</th><th>Outliers %</th><th>CPU profiles</th></tr></thead><tbody>${runRows}</tbody></table><h2>Profile and browser captures</h2><p>Capture artifacts are listed with their recorded environment and build mode.</p><table><thead><tr><th>Case</th><th>Mode</th><th>Fixture</th><th>Build mode</th><th>Environment</th><th>Run</th><th>Artifact</th></tr></thead><tbody>${captureRows}</tbody></table><h2>Run status</h2><ul>${statusRows}</ul><script type="application/json" id="trend-data">${data}</script>`;
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
    if (outputPath) { await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, output, { flag: "wx" }); }
    else process.stdout.write(output);
  } catch (error) {
    exitWithError(error, 2);
  }
}
