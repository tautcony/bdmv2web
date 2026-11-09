import { PerformanceObserver } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Option } from "commander";
import { BUILD_MODES } from "./build-mode.mjs";
import { createProgram, exitWithError, numberArgument, parseOptions } from "./cli.mjs";

function memorySnapshot() {
  const memory = process.memoryUsage();
  return {
    timestamp: new Date().toISOString(),
    rssBytes: memory.rss,
    heapTotalBytes: memory.heapTotal,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  };
}

export function normalizeMaxRssBytes(maxRss) {
  return maxRss * 1024;
}

export function observeGc() {
  const events = [];
  const record = (entries) => {
    for (const entry of entries) events.push({ kind: entry.detail?.kind ?? null, flags: entry.detail?.flags ?? null, durationMs: entry.duration, startTimeMs: entry.startTime });
  };
  let observer;
  try {
    observer = new PerformanceObserver((list) => record(list.getEntries()));
    observer.observe({ entryTypes: ["gc"] });
  } catch (error) {
    return { events, available: false, reason: error instanceof Error ? error.message : String(error), async stop() {} };
  }
  return {
    events,
    available: true,
    async stop() {
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
      record(observer.takeRecords());
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
      record(observer.takeRecords());
      observer.disconnect();
    },
  };
}

export async function runMemoryCapture({ run, durationMs, sampleEvery = 100, maxIterations = 1_000_000 }) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const deadline = start + durationMs;
  const gc = observeGc();
  const samples = [memorySnapshot()];
  let iterations = 0;
  let lastSampleAt = start;
  while (performance.now() < deadline && iterations < maxIterations) {
    await run();
    iterations += 1;
    const now = performance.now();
    if (now - lastSampleAt >= sampleEvery) {
      samples.push(memorySnapshot());
      lastSampleAt = now;
      // Let the async GC observer deliver entries between synchronous iterations.
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
    }
  }
  samples.push(memorySnapshot());
  await gc.stop();
  const maxRssRaw = process.resourceUsage().maxRSS;
  return {
    mode: "memory",
    startedAt,
    durationMs: performance.now() - start,
    requestedDurationMs: durationMs,
    iterations,
    memory: {
      samples,
      peakObservedRssBytes: Math.max(...samples.map((sample) => sample.rssBytes)),
      maxRSSBytes: normalizeMaxRssBytes(maxRssRaw),
      maxRSSUnit: "bytes",
      maxRssScope: "process-lifetime peak RSS for this entire Node process; includes preparation and capture setup",
      heapScope: "process-wide snapshots sampled during this memory capture; not per operation",
      externalScope: "process-wide snapshots sampled during this memory capture; includes native and external allocations",
    },
    gc: {
      available: gc.available,
      unavailableReason: gc.reason ?? null,
      events: gc.events,
      scope: "all garbage collection events observed in this process during the capture window",
    },
  };
}

export async function writeMemoryResult(file, result) {
  const destination = resolve(file);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  return destination;
}

function createMemoryCommand() {
  return createProgram("bench-memory", "Capture process memory and GC observations for one case.")
    .requiredOption("--case <caseId>", "stable case ID")
    .option("--root <dir>", "code root", fileURLToPath(new URL("../..", import.meta.url)))
    .option("--fixture-root <dir>", "fixture root")
    .option("--duration-ms <ms>", "capture duration in milliseconds", numberArgument, 5_000)
    .option("--out <dir>", "output root")
    .option("--output <dir>", "output root")
    .addOption(new Option("--build-mode <mode>", "declared build mode").choices(BUILD_MODES));
}

async function main(argv) {
  const options = parseOptions(createMemoryCommand(), argv);
  const { case: caseId } = options;
  const root = resolve(options.root);
  const fixtureRoot = resolve(options.fixtureRoot ?? root);
  const buildMode = options.buildMode;
  const durationMs = options.durationMs;
  if (!(durationMs > 0)) throw new Error("--duration-ms must be positive");
  const outputRoot = options.out ?? options.output ?? "test-data/bench/runs";
  const { getCaseDefinitions } = await import("./cases.mjs");
  const { prepareCase } = await import("./worker.mjs");
  const definitions = await getCaseDefinitions({ root, fixtureRoot });
  const caseDef = definitions.find((item) => item.caseId === caseId);
  if (!caseDef) throw new Error(`Unknown case ID: ${caseId}`);
  const prepared = await prepareCase(caseDef, root);
  if (prepared.skip) {
    process.stdout.write(`${JSON.stringify({ status: "skipped", mode: "memory", caseId, reason: prepared.skip })}\n`);
    return;
  }
  const startedAt = new Date().toISOString();
  try {
    const result = await runMemoryCapture({ run: prepared.run, durationMs });
    const finalValue = await prepared.run();
    await prepared.validate?.(finalValue);
    const outputSummary = prepared.describe ? prepared.describe(finalValue) : undefined;
    const row = {
      caseId, fixture: caseDef.fixture, category: caseDef.category, name: caseDef.name, sample: caseDef.sample, scope: prepared.scope,
      artifacts: ["memory.json"], forks: [{ index: 0, iterations: result.iterations, wallMs: result.durationMs, output: outputSummary, memory: result.memory, gc: result.gc }],
    };
    const { writeProfileRun } = await import("./profile-record.mjs");
    const record = await writeProfileRun({ root, outputRoot, mode: "memory", definition: caseDef, configuration: { caseId, requestedDurationMs: durationMs, startedAt }, row, buildMode });
    const detailsFile = join(record.runDir, "memory.json");
    await writeMemoryResult(detailsFile, { schemaVersion: 1, mode: "memory", runId: record.runId, caseId, fixture: caseDef.fixture, scope: prepared.scope, input: prepared.input, output: outputSummary, ...result });
    process.stdout.write(`${JSON.stringify({ status: "complete", mode: "memory", caseId, runId: record.runId, runDirectory: record.runDir, record: join(record.runDir, "run.json"), iterations: result.iterations })}\n`);
  } finally {
    await prepared.afterMeasurement?.();
    await prepared.cleanup?.();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { exitWithError(error, 1, { stack: true }); });
}
