#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendList, createProgram, exitWithError, integerArgument, numberArgument, parseOptions } from "./cli.mjs";
import { writeSampleStore } from "./sample-store.mjs";
import { summarizeForks } from "./stats.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptDir, "../..");

function createCiCommand() {
  return createProgram("bench-ci", "Run baseline and candidate benchmarks in alternating order and compare them.")
    .requiredOption("--baseline-root <dir>", "baseline code root")
    .requiredOption("--candidate-root <dir>", "candidate code root")
    .requiredOption("--out <dir>", "output directory for raw runs, merged runs, and the comparison")
    .option("--case <caseId>", "case ID or comma-separated case IDs (repeatable)", appendList)
    .option("--warmup-ms <ms>", "warmup duration in milliseconds", numberArgument, 50)
    .option("--time-ms <ms>", "measurement duration in milliseconds", numberArgument, 200)
    .option("--min-samples <count>", "minimum samples per fork", integerArgument, 5);
}

function parseArgs(args) {
  const options = parseOptions(createCiCommand(), args);
  const result = { baselineRoot: options.baselineRoot, candidateRoot: options.candidateRoot, out: options.out, cases: options.case ?? [], warmupMs: options.warmupMs, timeMs: options.timeMs, minSamples: options.minSamples };
  if (!result.cases.length) throw new Error("--case requires at least one case ID");
  return result;
}

function runProcess(command, args, cwd = workspace) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolvePromise({ stdout, stderr, exitCode: code ?? 1, signal }));
  });
}
function appendFork(target, row, sourceRunId) {
  let current = target.rows.find((item) => item.caseId === row.caseId);
  if (!current) { current = { ...row, forks: [] }; target.rows.push(current); }
  for (const fork of row.forks ?? []) current.forks.push({ ...fork, index: current.forks.length, sourceRunId });
  current.callsPerSample = Math.max(...current.forks.map((fork) => fork.callsPerSample ?? 1));
  const medians = current.forks.map((fork) => fork.stats?.median).filter(Number.isFinite);
  current.stats = medians.length ? summarizeForks(medians) : { min: null, mean: null, median: null, p95: null, max: null, deviation: null, cvPercent: null, sampleCount: 0, forkCount: 0 };
}
function mergeRuns(runs, role) {
  if (!runs.length) throw new Error(`No ${role} benchmark runs were collected`);
  const merged = { ...runs[0], runId: `${role}-${runs.map((item) => item.runId).join("-")}`, createdAt: new Date().toISOString(), rows: [], skipped: [], failures: [] };
  merged.configuration = { ...merged.configuration, forks: runs.length };
  merged.sourceRunIds = runs.map((item) => item.runId);
  for (const run of runs) {
    for (const row of run.rows ?? []) appendFork(merged, row, run.runId);
    merged.skipped.push(...(run.skipped ?? [])); merged.failures.push(...(run.failures ?? []));
  }
  return merged;
}
async function readRunDirectory(text) {
  const match = text.match(/^Run directory: (.+)$/m);
  if (!match) throw new Error(`Benchmark command did not print its run directory: ${text.trim()}`);
  const dir = match[1].trim();
  return { dir, run: JSON.parse(await readFile(join(dir, "run.json"), "utf8")) };
}
async function runPair(options, dependencies = {}) {
  const run = dependencies.runProcess ?? runProcess;
  const harness = dependencies.harness ?? join(scriptDir, "index.mjs");
  const sequence = ["baseline", "candidate", "candidate", "baseline"];
  const results = { baseline: [], candidate: [] };
  const rawDir = join(resolve(options.out), "raw");
  await mkdir(rawDir, { recursive: true });
  for (const role of sequence) {
    const root = resolve(role === "baseline" ? options.baselineRoot : options.candidateRoot);
    const args = [harness, "--mode", "benchmark", "--root", root, "--build-mode", "normal", "--suite", "all", "--forks", "1", "--warmup-ms", String(options.warmupMs), "--time-ms", String(options.timeMs), "--min-samples", String(options.minSamples), "--out", rawDir];
    for (const caseId of options.cases) args.push("--case", caseId);
    const output = await run(process.execPath, args, workspace);
    results[role].push(await readRunDirectory(output.stdout));
  }
  const baseline = mergeRuns(results.baseline.map((item) => item.run), "baseline");
  const candidate = mergeRuns(results.candidate.map((item) => item.run), "candidate");
  const sources = new Map([...results.baseline, ...results.candidate].map((item) => [item.run.runId, item.dir]));
  const baseDir = join(resolve(options.out), "baseline"), candidateDir = join(resolve(options.out), "candidate");
  await mkdir(baseDir, { recursive: true }); await mkdir(candidateDir, { recursive: true });
  for (const [dir, merged] of [[baseDir, baseline], [candidateDir, candidate]]) {
    const store = await writeSampleStore(dir, merged.rows, { sources });
    if (store) merged.samples = store;
    await writeFile(join(dir, "run.json"), `${JSON.stringify(merged)}\n`, { flag: "wx" });
  }
  const compareArgs = [join(scriptDir, "compare.mjs"), join(baseDir, "run.json"), join(candidateDir, "run.json"), "--out", join(resolve(options.out), "comparison.json")];
  const comparison = await run(process.execPath, compareArgs, workspace);
  await writeFile(join(resolve(options.out), "summary.md"), comparison.stdout, { flag: "wx" });
  return { order: sequence, baselinePath: join(baseDir, "run.json"), candidatePath: join(candidateDir, "run.json"), summaryPath: join(resolve(options.out), "summary.md"), rawDir, failures: baseline.failures.length + candidate.failures.length, benchmarkExitCodes: [...results.baseline, ...results.candidate].map((item) => item.exitCode ?? 0), comparisonExitCode: comparison.exitCode ?? 0 };
}

export { mergeRuns, parseArgs, runPair };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runPair(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failures || result.benchmarkExitCodes.some((code) => code !== 0) || result.comparisonExitCode !== 0) process.exitCode = 1;
  } catch (error) {
    exitWithError(error, 2);
  }
}
