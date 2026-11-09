import { Session } from "node:inspector/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Option } from "commander";
import { BUILD_MODES } from "./build-mode.mjs";
import { createProgram, exitWithError, integerArgument, numberArgument, parseOptions } from "./cli.mjs";

export async function captureProfile({ run, mode, durationMs }) {
  if (mode !== "cpu" && mode !== "heap") throw new Error("Profile mode must be cpu or heap");
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Profile duration must be positive");
  const session = new Session();
  session.connect();
  const post = (method, params = {}) => session.post(method, params);
  let profile;
  let start;
  try {
    if (mode === "cpu") {
      await post("Profiler.enable");
      await post("Profiler.start");
    } else {
      await post("HeapProfiler.enable");
      await post("HeapProfiler.startSampling", { samplingInterval: 32 * 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    }
    start = performance.now();
    const deadline = start + durationMs;
    let iterations = 0;
    while (performance.now() < deadline) {
      await run();
      iterations += 1;
    }
    if (mode === "cpu") {
      const result = await post("Profiler.stop");
      profile = result.profile;
    } else {
      const result = await post("HeapProfiler.stopSampling");
      profile = result.profile;
    }
    return { profile, iterations, durationMs: performance.now() - start };
  } finally {
    try { await session.disconnect(); } catch { /* Session may have closed after a protocol error. */ }
  }
}

export async function writeProfile(file, profile) {
  const destination = resolve(file);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(profile)}\n`, { flag: "wx" });
  return destination;
}

function createProfileCommand() {
  return createProgram("bench-profile", "Capture a Chrome DevTools CPU or heap sampling profile for one case.")
    .requiredOption("--case <caseId>", "stable case ID")
    .addOption(new Option("--mode <mode>", "profile mode").choices(["cpu", "heap"]).default("cpu"))
    .option("--root <dir>", "code root", fileURLToPath(new URL("../..", import.meta.url)))
    .option("--fixture-root <dir>", "fixture root")
    .option("--duration-ms <ms>", "capture duration in milliseconds", numberArgument)
    .option("--time-ms <ms>", "capture duration in milliseconds", numberArgument)
    .option("--warmup-ms <ms>", "warmup duration in milliseconds", numberArgument, 0)
    .option("--warmup-runs <count>", "warmup iterations", integerArgument)
    .option("--out <dir>", "output root", "test-data/bench/runs")
    .option("--artifact <file>", "profile artifact path")
    .addOption(new Option("--build-mode <mode>", "declared build mode").choices(BUILD_MODES));
}

async function main(argv) {
  const options = parseOptions(createProfileCommand(), argv);
  const caseId = options.case;
  const mode = options.mode;
  const root = resolve(options.root);
  const fixtureRoot = resolve(options.fixtureRoot ?? root);
  const buildMode = options.buildMode;
  const durationMs = options.durationMs ?? options.timeMs ?? 5_000;
  const warmupMs = options.warmupMs;
  const warmupRuns = options.warmupRuns ?? null;
  if (!(durationMs > 0)) throw new Error("--duration-ms must be positive");
  if (!(warmupMs >= 0)) throw new Error("--warmup-ms must be non-negative");
  if (warmupRuns !== null && warmupRuns < 0) throw new Error("--warmup-runs must be a non-negative integer");
  const outputRoot = options.out;
  const artifactName = options.artifact ?? `profiles/${caseId}.${mode === "cpu" ? "cpuprofile" : "heapprofile"}`;
  const { getCaseDefinitions } = await import("./cases.mjs");
  const { prepareCase } = await import("./worker.mjs");
  const definitions = await getCaseDefinitions({ root, fixtureRoot });
  const caseDef = definitions.find((item) => item.caseId === caseId);
  if (!caseDef) throw new Error(`Unknown case ID: ${caseId}`);
  const prepared = await prepareCase(caseDef, root);
  if (prepared.skip) {
    process.stdout.write(`${JSON.stringify({ status: "skipped", mode, caseId, reason: prepared.skip })}\n`);
    return;
  }
  const startedAt = new Date().toISOString();
  try {
    await prepared.validate?.(await prepared.run());
    let actualWarmupRuns = 0;
    if (warmupRuns !== null) {
      for (let index = 0; index < warmupRuns; index++) { await prepared.run(); actualWarmupRuns++; }
    } else {
      const warmupDeadline = performance.now() + warmupMs;
      while (performance.now() < warmupDeadline) { await prepared.run(); actualWarmupRuns++; }
    }
    const { profile, iterations, durationMs: actualDurationMs } = await captureProfile({ run: prepared.run, mode, durationMs });
    const finalValue = await prepared.run();
    await prepared.validate?.(finalValue);
    const outputSummary = prepared.describe ? prepared.describe(finalValue) : undefined;
    const { createProfileRunDirectory, profilePath, writeProfileRun } = await import("./profile-record.mjs");
    const { runId, runDir } = await createProfileRunDirectory(root, outputRoot);
    const artifact = profilePath(runDir, artifactName);
    await writeProfile(artifact.target, profile);
    const format = mode === "cpu" ? "Chrome DevTools CPU profile (.cpuprofile)" : "Chrome DevTools heap sampling profile (.heapprofile)";
    const row = {
      caseId, fixture: caseDef.fixture, category: caseDef.category, name: caseDef.name, sample: caseDef.sample, scope: prepared.scope,
      artifacts: [artifact.relativePath], forks: [{ index: 0, iterations, requestedDurationMs: durationMs, actualDurationMs, profilePath: artifact.relativePath, output: outputSummary }],
    };
    const config = { caseId, mode, requestedDurationMs: durationMs, warmupMs, warmupRuns: actualWarmupRuns, iterations, format };
    await writeProfileRun({ root, outputRoot, mode, definition: caseDef, configuration: config, row, buildMode, runDir, runId });
    process.stdout.write(`${JSON.stringify({ status: "complete", mode, caseId, runId, runDirectory: runDir, record: join(runDir, "run.json"), artifact: artifact.target, startedAt, requestedDurationMs: durationMs, actualDurationMs, warmupMs, warmupRuns: actualWarmupRuns, iterations, output: outputSummary, format })}\n`);
  } finally {
    await prepared.afterMeasurement?.();
    await prepared.cleanup?.();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { exitWithError(error, 1, { stack: true }); });
}
