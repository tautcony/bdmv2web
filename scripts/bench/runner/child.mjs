#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Option } from "commander";
import { BUILD_MODES } from "../store/build-mode.mjs";
import { createProgram, exitWithError, numberArgument, parseOptions } from "../lib/cli.mjs";

function createChildCommand() {
  return createProgram("bench-child", "Capture GC and memory from the CLI child process for one case.")
    .requiredOption("--case <caseId>", "stable case ID")
    .option("--root <dir>", "code root", fileURLToPath(new URL("../../..", import.meta.url)))
    .option("--fixture-root <dir>", "fixture root")
    .option("--duration-ms <ms>", "capture duration in milliseconds", numberArgument, 5_000)
    .option("--out <dir>", "output root")
    .addOption(new Option("--build-mode <mode>", "declared build mode").choices(BUILD_MODES));
}

async function main(argv) {
  const options = parseOptions(createChildCommand(), argv);
  const { case: caseId } = options;
  const root = resolve(options.root), fixtureRoot = resolve(options.fixtureRoot ?? root);
  const durationMs = options.durationMs;
  if (!(durationMs > 0)) throw new Error("--duration-ms must be positive");
  const { getCaseDefinitions } = await import("../cases/registry.mjs");
  const { prepareCase } = await import("./worker.mjs");
  const definitions = await getCaseDefinitions({ root, fixtureRoot });
  const caseDef = definitions.find((item) => item.caseId === caseId);
  if (!caseDef) throw new Error(`Unknown case ID: ${caseId}`);
  if (caseDef.spawnsChild !== true) throw new Error(`${caseId} does not spawn a CLI child; use --mode memory for the parent`);
  caseDef.options = { ...(caseDef.options ?? {}), observeChild: true };
  const prepared = await prepareCase(caseDef, root);
  if (prepared.skip) {
    process.stdout.write(`${JSON.stringify({ status: "skipped", mode: "child", caseId, reason: prepared.skip })}\n`);
    return;
  }
  const startedAt = new Date().toISOString();
  try {
    await prepared.validate?.(await prepared.run());
    const start = performance.now();
    let iterations = 0;
    let last;
    do {
      last = await prepared.run();
      iterations++;
    } while (performance.now() - start < durationMs);
    await prepared.validate?.(last);
    const child = last?.child ?? null;
    const output = prepared.describe ? prepared.describe(last) : undefined;
    const { createProfileRunDirectory, profilePath, writeProfileRun } = await import("../store/environment.mjs");
    const outputRoot = options.out ?? "test-data/bench/runs";
    const { runId, runDir } = await createProfileRunDirectory(root, outputRoot);
    const artifact = profilePath(runDir, "child.json");
    await mkdir(dirname(artifact.target), { recursive: true });
    await writeFile(artifact.target, `${JSON.stringify({ schemaVersion: 1, mode: "child", runId, caseId, fixture: caseDef.fixture, scope: prepared.scope, input: prepared.input, output, iterations, startedAt, child }, null, 2)}\n`, { flag: "wx" });
    const row = {
      caseId, fixture: caseDef.fixture, category: caseDef.category, name: caseDef.name, sample: caseDef.sample, scope: prepared.scope,
      artifacts: [artifact.relativePath], forks: [{ index: 0, iterations, output, child }],
    };
    await writeProfileRun({ root, outputRoot, mode: "child", definition: caseDef, configuration: { caseId, requestedDurationMs: durationMs, startedAt, scope: "spawned CLI child" }, row, buildMode: options.buildMode, runDir, runId });
    process.stdout.write(`${JSON.stringify({ status: "complete", mode: "child", caseId, runId, runDirectory: runDir, record: join(runDir, "run.json"), artifact: artifact.target, iterations, child })}\n`);
  } finally {
    await prepared.afterMeasurement?.();
    await prepared.cleanup?.();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { exitWithError(error, 1, { stack: true }); });
}
