#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Option } from "commander";
import { BUILD_MODES, readBuildMode } from "./build-mode.mjs";
import { getCaseDefinitions } from "./cases.mjs";
import { appendArgument, createProgram, exitWithError, integerArgument, numberArgument, parseOptions, splitList } from "./cli.mjs";
import { writeSampleStore } from "./sample-store.mjs";
import { summarizeForks, summarizeSamples } from "./stats.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptDir, "../..");
const MODES = ["benchmark", "cpu", "heap", "memory", "browser"];
const SUITES = ["all", "real", "synthetic", "scenario"];

function createBenchCommand() {
  return createProgram("bench", "Run benchmark cases and write a schema version 1 run record.")
    .addOption(new Option("--mode <mode>", "measurement mode").choices(MODES).default("benchmark"))
    .addOption(new Option("--root <dir>", "code root").default(process.env.BDMV2WEB_ROOT ?? workspace, "repository root"))
    .addOption(new Option("--fixture-root <dir>", "fixture root").default(workspace, "repository root"))
    .addOption(new Option("--suite <suite>", "case suite").choices(SUITES).default("all"))
    .option("--case <caseId>", "stable case ID (repeatable)", appendArgument)
    .option("--only <categories>", "comma-separated category filter")
    .option("--forks <count>", "independent child-process forks", integerArgument, 3)
    .option("--warmup-ms <ms>", "warmup duration in milliseconds", numberArgument, 100)
    .option("--time-ms <ms>", "measurement duration in milliseconds", numberArgument, 500)
    .option("--min-samples <count>", "minimum samples per fork", integerArgument, 10)
    .option("--calls-per-sample <count>", "fixed operation calls per timing sample; omit to calibrate against a 1 ms target", integerArgument)
    .option("--duration-ms <ms>", "capture duration for cpu, heap, and memory modes", numberArgument)
    .option("--warmup-runs <count>", "warmup iterations for cpu and heap modes", integerArgument)
    .option("--artifact <file>", "profile artifact path")
    .option("--node-arg <flag>", "additional Node flag for child processes (repeatable)", appendArgument)
    .addOption(new Option("--build-mode <mode>", "declared build mode").choices(BUILD_MODES))
    .option("--out <dir>", "output root", "test-data/bench/runs")
    .option("--list", "list the selected cases without running them")
    .option("--no-json", "skip writing run.json");
}

function normalizeBenchOptions(parsed) {
  const { case: caseIds, nodeArg: nodeArgs, ...options } = parsed;
  options.cases = caseIds ?? [];
  options.nodeArgs = nodeArgs ?? [];
  options.only = options.only ? new Set(splitList(options.only)) : null;
  if (options.forks < 1 || options.forks > 100) throw new Error("--forks must be an integer from 1 to 100");
  if (!(options.warmupMs >= 0 && options.timeMs > 0 && options.minSamples > 0)) throw new Error("--warmup-ms, --time-ms, and --min-samples require valid non-negative/positive budgets");
  if (options.callsPerSample !== undefined && !(options.callsPerSample >= 1)) throw new Error("--calls-per-sample must be a positive integer");
  checkedNodeArgs(options.nodeArgs);
  return options;
}

export function parseBenchArguments(args) {
  return normalizeBenchOptions(parseOptions(createBenchCommand(), args));
}

const supportedNodeFlag = /^--(?:enable-source-maps|expose-gc|jitless|always-opt|no-opt|trace-gc(?:-verbose|-nvp)?|trace-opt|trace-deopt|max-old-space-size=\d+|max-semi-space-size=\d+|stack-size=\d+)$/;
function checkedNodeArgs(args) { for (const arg of args) if (!supportedNodeFlag.test(arg)) throw new Error(`Unsupported --node-arg '${arg}'. Supported flags: --enable-source-maps, --expose-gc, --jitless, optimization/GC trace flags, --max-old-space-size=N, --max-semi-space-size=N, --stack-size=N.`); }
function git(root, args) { try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } }
function runWorker(def, options, index) {
  return new Promise((resolvePromise, reject) => {
    const inherited = process.execArgv.filter((arg) => supportedNodeFlag.test(arg));
    const args = [...inherited, ...options.nodeArgs, join(scriptDir, "worker.mjs"), "--case", def.caseId, "--root", options.root, "--fixture-root", options.fixtureRoot, "--warmup-ms", String(options.warmupMs), "--time-ms", String(options.timeMs), "--min-samples", String(options.minSamples), ...(options.callsPerSample === undefined ? [] : ["--calls-per-sample", String(options.callsPerSample)])];
    const child = spawn(process.execPath, args, { cwd: workspace, env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stdout = "", stderr = "";
    let message;
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("message", (value) => { if (value?.kind === "bench-result") message = value.result; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code !== 0) return reject(new Error(`fork ${index} exited ${code ?? signal}: ${stderr.trim()}`));
      if (message) resolvePromise({ ...message, stdout, stderr });
      else reject(new Error(`fork ${index} exited without an IPC result; stdout=${stdout}; stderr=${stderr}`));
    });
  });
}

async function main() {
  const command = createBenchCommand();
  const cli = normalizeBenchOptions(parseOptions(command, process.argv.slice(2).filter((arg) => arg !== "--")));
  const timeMsProvided = command.getOptionValueSource("timeMs") === "cli";
  const root = resolve(cli.root), fixtureRoot = resolve(cli.fixtureRoot), definitions = await getCaseDefinitions({ root, fixtureRoot });
  const selected = definitions.filter((item) => (cli.suite === "all" || item.suite === cli.suite) && (!cli.only || cli.only.has(item.category)) && (!cli.cases.length || cli.cases.includes(item.caseId)));
  if (cli.cases.some((id) => !definitions.some((item) => item.caseId === id))) throw new Error(`Unknown caseId: ${cli.cases.find((id) => !definitions.some((item) => item.caseId === id))}`);
  if (cli.only) { const categories = new Set(definitions.map((item) => item.category)); for (const category of cli.only) if (!categories.has(category)) throw new Error(`Unknown benchmark category: ${category}`); }
  if (!selected.length && !cli.list) throw new Error("No benchmark cases match the selected filters");
  if (cli.list) { process.stdout.write(`Repository root: ${root}\n`); for (const item of selected) process.stdout.write(`${item.caseId.padEnd(48)} ${item.suite.padEnd(10)} ${item.category.padEnd(8)} ${item.sample.padEnd(28)} ${item.fixture.id}@${item.fixture.version}\n`); return; }
  if (cli.mode !== "benchmark") {
    const file = cli.mode === "browser" ? "browser.mjs" : cli.mode === "memory" ? "memory.mjs" : "profile.mjs";
    const caseId = cli.cases[0];
    if (!caseId) throw new Error(`--mode ${cli.mode} requires --case <caseId>`);
    const common = ["--case", caseId, "--root", root, "--fixture-root", fixtureRoot];
    const declaredBuildMode = cli.buildMode ? ["--build-mode", cli.buildMode] : [];
    let childArgs;
    if (cli.mode === "memory") childArgs = [...common, ...declaredBuildMode, "--duration-ms", String(cli.durationMs ?? (timeMsProvided ? cli.timeMs : 5_000)), "--output", cli.out];
    else if (cli.mode === "cpu" || cli.mode === "heap") childArgs = ["--mode", cli.mode, ...common, ...declaredBuildMode, "--duration-ms", String(cli.durationMs ?? (timeMsProvided ? cli.timeMs : 5_000)), "--warmup-ms", String(cli.warmupMs), ...(cli.warmupRuns === undefined ? [] : ["--warmup-runs", String(cli.warmupRuns)]), "--out", cli.out, ...(cli.artifact ? ["--artifact", cli.artifact] : [])];
    else childArgs = [...common, ...declaredBuildMode, "--out", cli.out];
    const profileFlags = cli.mode === "cpu" || cli.mode === "heap" ? ["--enable-source-maps"] : [];
    const runtimeFlags = [...new Set([...process.execArgv.filter((arg) => supportedNodeFlag.test(arg)), ...cli.nodeArgs, ...profileFlags])];
    const child = spawn(process.execPath, [...runtimeFlags, join(scriptDir, file), ...childArgs], { cwd: workspace, env: process.env, stdio: "inherit" });
    await new Promise((resolvePromise, reject) => { child.once("error", reject); child.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`${file} exited ${code}`))); }); return;
  }
  const runId = `${new Date().toISOString().replaceAll(":", "").replaceAll(".", "-")}-${randomUUID().slice(0, 8)}`;
  const outputRoot = isAbsolute(cli.out) ? cli.out : resolve(workspace, cli.out);
  const runDir = join(outputRoot, runId);
  if (cli.json) { await mkdir(outputRoot, { recursive: true }); await mkdir(runDir, { recursive: false }); }
  const rows = [], skipped = [], failures = [];
  for (const def of selected) {
    const forkResults = [];
    let skip = false;
    let callsPerSample = cli.callsPerSample;
    for (let index = 0; index < cli.forks; index++) {
      try {
        const result = await runWorker(def, { ...cli, root, fixtureRoot, callsPerSample }, index);
        if (result.skip) { skipped.push({ caseId: def.caseId, reason: result.skip }); skip = true; break; }
        callsPerSample ??= result.callsPerSample;
        forkResults.push({ index, callsPerSample: result.callsPerSample, iterations: result.iterations, rawMsPerCall: result.rawMsPerCall, stats: summarizeSamples(result.rawMsPerCall), memory: result.memory, cpuUsage: result.cpuUsage, wallMs: result.wallMs, gc: result.gc, runtime: result.runtime, input: result.input, output: result.output, scope: result.scope, stdout: result.stdout, stderr: result.stderr });
      } catch (error) {
        if (def.options?.optional && /ENOENT|ENOTDIR/.test(error.message)) { skipped.push({ caseId: def.caseId, reason: error.message }); skip = true; break; }
        failures.push({ caseId: def.caseId, fork: index, reason: error.stack ?? String(error) }); break;
      }
    }
    if (skip || !forkResults.length) continue;
    rows.push({ caseId: def.caseId, fixture: def.fixture, category: def.category, name: def.name, sample: def.sample, scope: def.scope, unit: "ms/call", callsPerSample, ...(def.source ? { source: def.source } : {}), forks: forkResults, stats: summarizeForks(forkResults.map((fork) => fork.stats.median)) });
  }
  const revision = git(root, ["rev-parse", "HEAD"]), dirty = Boolean(git(root, ["status", "--porcelain"]));
  const buildMode = await readBuildMode(root, cli.buildMode);
  const workerRuntime = rows[0]?.forks[0]?.runtime;
  const report = { schemaVersion: 1, mode: "benchmark", runId, createdAt: new Date().toISOString(), environment: { repositoryRoot: root, revision, dirty, node: process.version, v8: process.versions.v8, platform: platform(), release: release(), architecture: arch(), cpuModel: cpus()[0]?.model ?? null, cpuCount: cpus().length, totalMemoryBytes: totalmem(), execArgv: workerRuntime?.execArgv ?? [...process.execArgv.filter((arg) => supportedNodeFlag.test(arg)), ...cli.nodeArgs], nodeOptions: workerRuntime?.nodeOptions ?? process.env.NODE_OPTIONS ?? null, ...buildMode }, configuration: { suite: cli.suite, caseIds: selected.map((item) => item.caseId), forks: cli.forks, warmupMs: cli.warmupMs, timeMs: cli.timeMs, minSamples: cli.minSamples, callsPerSample: cli.callsPerSample ?? null, nodeArgs: cli.nodeArgs, profile: false, ...buildMode, engine: "tinybench", engineVersion: "6.2.3" }, rows, skipped, failures };
  if (cli.json) {
    const store = await writeSampleStore(runDir, rows);
    if (store) report.samples = store;
    await writeFile(join(runDir, "run.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  }
  process.stdout.write(`Run directory: ${runDir}\n`);
  process.stdout.write(`# BDMV2Web performance run ${runId}\n\n| Case | Forks | Calls/sample | Median ms/call | CV % |\n|---|---:|---:|---:|---:|\n`);
  for (const row of rows) process.stdout.write(`| ${row.caseId} | ${row.forks.length} | ${row.callsPerSample ?? 1} | ${row.stats.median.toFixed(6)} | ${row.stats.cvPercent.toFixed(2)} |\n`);
  if (skipped.length) { process.stdout.write("\n## Skipped\n"); for (const item of skipped) process.stdout.write(`- ${item.caseId}: ${item.reason}\n`); }
  if (failures.length) { process.stdout.write("\n## Failures\n"); for (const item of failures) process.stdout.write(`- ${item.caseId} fork ${item.fork}: ${item.reason.split("\n")[0]}\n`); }
  if (failures.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => exitWithError(error, 1, { stack: true }));
export { summarizeSamples };
