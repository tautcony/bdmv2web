#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createProgram, exitWithError, integerArgument, numberArgument, parseOptions } from "./cli.mjs";
import { CONFIGURATION_FIELDS, ENVIRONMENT_FIELDS, mismatchedFields, stable } from "./compatibility.mjs";
import { forkMedians, median } from "./stats.mjs";

const DEFAULTS = { relativeThreshold: 10, absoluteThresholdMs: 0.05, resamples: 10_000 };
const MINIMUM_FORKS = 3;

function createCompareCommand() {
  return createProgram("bench-compare", "Compare a baseline run record with a candidate run record.")
    .argument("<baseline>", "baseline run record or run directory")
    .argument("<candidate>", "candidate run record or run directory")
    .option("--relative-threshold <percent>", "relative change threshold in percent", numberArgument, DEFAULTS.relativeThreshold)
    .option("--absolute-threshold-ms <ms>", "absolute change threshold in milliseconds", numberArgument, DEFAULTS.absoluteThresholdMs)
    .option("--resamples <count>", "bootstrap resamples", integerArgument, DEFAULTS.resamples)
    .option("--fail-on-regression", "exit non-zero on a confirmed regression")
    .option("--out <file>", "write the JSON comparison to a file");
}

function parseArgs(args) {
  const command = createCompareCommand();
  const options = parseOptions(command, args);
  const result = { files: command.args, failOnRegression: Boolean(options.failOnRegression), relativeThreshold: options.relativeThreshold, absoluteThresholdMs: options.absoluteThresholdMs, resamples: options.resamples, out: options.out ?? null };
  if (!(result.relativeThreshold >= 0) || !(result.absoluteThresholdMs >= 0) || result.resamples < 100) throw new Error("Thresholds must be non-negative and resamples must be at least 100");
  return result;
}

async function loadRun(path) {
  const full = resolve(path);
  const info = await stat(full);
  const file = info.isDirectory() ? join(full, "run.json") : full;
  const run = JSON.parse(await readFile(file, "utf8"));
  if (run.schemaVersion !== 1 || run.mode !== "benchmark") throw new Error(`${file}: expected schemaVersion 1 benchmark run`);
  if (!Array.isArray(run.rows) || !Array.isArray(run.skipped) || !Array.isArray(run.failures)) throw new Error(`${file}: run is missing rows, skipped, or failures`);
  return { run, file };
}

function hashSeed(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0;
  return value || 1;
}
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function bootstrap(baseline, candidate, seed, count) {
  const random = rng(seed);
  const effects = new Array(count);
  for (let i = 0; i < count; i++) {
    const before = Array.from({ length: baseline.length }, () => baseline[Math.floor(random() * baseline.length)]);
    const after = Array.from({ length: candidate.length }, () => candidate[Math.floor(random() * candidate.length)]);
    effects[i] = median(after) - median(before);
  }
  effects.sort((a, b) => a - b);
  return { lowMs: effects[Math.floor(count * 0.025)], highMs: effects[Math.min(count - 1, Math.floor(count * 0.975))], resamples: count, seed };
}

function fixtureMismatches(baseline, candidate) {
  return ["id", "version", "parameters"].filter((key) => stable(baseline?.fixture?.[key]) !== stable(candidate?.fixture?.[key])).map((key) => `fixture.${key}`);
}
function indexByCase(run) { return new Map(run.rows.map((row) => [row.caseId, row])); }
function recordedStatus(run, caseId) {
  if (run.failures.some((item) => item.caseId === caseId || item.case === caseId)) return "failed";
  if (run.skipped.some((item) => item.caseId === caseId || item.case === caseId)) return "skipped";
  return null;
}
function caseStatus(run, caseId, hasRow) {
  return recordedStatus(run, caseId) ?? (hasRow ? "measured" : "missing");
}
function allCaseIds(baseline, candidate) {
  const ids = new Set([...indexByCase(baseline).keys(), ...indexByCase(candidate).keys()]);
  for (const run of [baseline, candidate]) for (const item of [...run.skipped, ...run.failures]) { const id = item.caseId ?? item.case; if (id) ids.add(id); }
  return [...ids].sort();
}

function compareRuns(baseline, candidate, options) {
  const baseRows = indexByCase(baseline);
  const candidateRows = indexByCase(candidate);
  const commonMismatch = [
    ...mismatchedFields(baseline.environment, candidate.environment, ENVIRONMENT_FIELDS).map((key) => `environment.${key}`),
    ...mismatchedFields(baseline.configuration, candidate.configuration, CONFIGURATION_FIELDS).map((key) => `configuration.${key}`),
  ];
  const rows = allCaseIds(baseline, candidate).map((caseId) => {
    const before = baseRows.get(caseId);
    const after = candidateRows.get(caseId);
    const baselineStatus = caseStatus(baseline, caseId, Boolean(before));
    const candidateStatus = caseStatus(candidate, caseId, Boolean(after));
    if (baselineStatus === "failed" || candidateStatus === "failed") return { caseId, status: "failed", baselineStatus, candidateStatus, detail: "case has a failure record", verdict: "unclassified" };
    if (baselineStatus === "skipped" || candidateStatus === "skipped") return { caseId, status: "skipped", baselineStatus, candidateStatus, detail: "case has a skip record", verdict: "unclassified" };
    if (!before || !after) return { caseId, status: "missing", baselineStatus, candidateStatus, detail: !before ? "baseline row unavailable" : "candidate row unavailable", verdict: "unclassified" };
    const mismatches = [...commonMismatch, ...fixtureMismatches(before, after), ...(stable(before.scope) === stable(after.scope) ? [] : ["scope"])];
    if (mismatches.length) return { caseId, status: "incompatible", mismatches, verdict: "unclassified" };
    const beforeForks = forkMedians(before);
    const afterForks = forkMedians(after);
    if (!beforeForks.length || !afterForks.length) return { caseId, status: "failed", detail: "no valid fork medians", verdict: "unclassified" };
    const baselineMedianMs = median(beforeForks);
    const candidateMedianMs = median(afterForks);
    const deltaMs = candidateMedianMs - baselineMedianMs;
    const relativeChangePercent = baselineMedianMs === 0 ? (deltaMs === 0 ? 0 : null) : deltaMs / baselineMedianMs * 100;
    const interval = bootstrap(beforeForks, afterForks, hashSeed(`${baseline.runId ?? "base"}:${candidate.runId ?? "candidate"}:${caseId}`), options.resamples);
    const lowConfidence = Math.min(beforeForks.length, afterForks.length) < MINIMUM_FORKS || (interval.lowMs <= 0 && interval.highMs >= 0);
    const regression = deltaMs > 0 && relativeChangePercent !== null && deltaMs > options.absoluteThresholdMs && relativeChangePercent > options.relativeThreshold;
    const verdict = regression
      ? (lowConfidence ? "regression-warning" : "confirmed-regression")
      : deltaMs < 0 ? (lowConfidence ? "improvement-warning" : "improvement") : "no-regression";
    return {
      caseId, status: "compared", verdict,
      baseline: { forkMediansMs: beforeForks, medianMs: baselineMedianMs }, candidate: { forkMediansMs: afterForks, medianMs: candidateMedianMs },
      deltaMs, relativeChangePercent, effectSizePercent: relativeChangePercent,
      thresholds: { relativePercent: options.relativeThreshold, absoluteMs: options.absoluteThresholdMs },
      confidence: { ...interval, minimumForks: MINIMUM_FORKS, sufficient: !lowConfidence, note: lowConfidence ? `Fewer than ${MINIMUM_FORKS} forks per side or a process interval that spans zero; confidence is insufficient for a confirmed verdict.` : undefined },
    };
  });
  const count = (predicate) => rows.filter(predicate).length;
  return {
    schemaVersion: 1, mode: "comparison", createdAt: new Date().toISOString(),
    baseline: { runId: baseline.runId ?? null }, candidate: { runId: candidate.runId ?? null },
    configuration: { relativeThresholdPercent: options.relativeThreshold, absoluteThresholdMs: options.absoluteThresholdMs, resamples: options.resamples, minimumForks: MINIMUM_FORKS },
    summary: {
      compared: count((row) => row.status === "compared"), incompatible: count((row) => row.status === "incompatible"),
      unavailable: count((row) => ["missing", "skipped", "failed"].includes(row.status)),
      regressionWarnings: count((row) => row.verdict === "regression-warning"), confirmedRegressions: count((row) => row.verdict === "confirmed-regression"),
    },
    rows,
  };
}

function markdown(report) {
  const lines = ["# Benchmark comparison", "", `Baseline: ${report.baseline.runId ?? "unknown"}  `, `Candidate: ${report.candidate.runId ?? "unknown"}`, "", "| Case | Status | Baseline state | Candidate state | Verdict | Baseline median (ms) | Candidate median (ms) | Change | 95% process bootstrap interval (ms) |", "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |"];
  for (const row of report.rows) {
    const fmt = (value) => Number.isFinite(value) ? value.toPrecision(5) : "—";
    lines.push(`| ${row.caseId} | ${row.status}${row.mismatches ? ` (${row.mismatches.join(", ")})` : ""} | ${row.baselineStatus ?? "measured"} | ${row.candidateStatus ?? "measured"} | ${row.verdict} | ${fmt(row.baseline?.medianMs)} | ${fmt(row.candidate?.medianMs)} | ${fmt(row.relativeChangePercent)}% | ${row.confidence ? `${fmt(row.confidence.lowMs)} … ${fmt(row.confidence.highMs)}` : "—"} |`);
  }
  lines.push("", `Each observation is one independent process fork median. ${report.configuration.minimumForks} forks per side and a process interval excluding zero support a confirmed verdict.`);
  return `${lines.join("\n")}\n`;
}

export { bootstrap, compareRuns, loadRun, markdown, parseArgs };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const [baseline, candidate] = await Promise.all(options.files.map(loadRun));
    const report = compareRuns(baseline.run, candidate.run, options);
    const result = `${JSON.stringify(report, null, 2)}\n`;
    if (options.out) await writeFile(resolve(options.out), result, { flag: "wx" });
    process.stdout.write(markdown(report));
    if (options.failOnRegression && report.summary.confirmedRegressions) process.exitCode = 1;
  } catch (error) {
    exitWithError(error, 2);
  }
}
