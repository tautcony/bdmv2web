import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

function git(root, args) {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

export async function profileEnvironment(root, declaredBuildMode) {
  const cpu = cpus()[0];
  const { readBuildMode } = await import("./build-mode.mjs");
  const buildMode = await readBuildMode(root, declaredBuildMode);
  return {
    repositoryRoot: resolve(root), revision: git(root, ["rev-parse", "HEAD"]), dirty: Boolean(git(root, ["status", "--porcelain"])),
    ...buildMode, nodeOptions: process.env.NODE_OPTIONS ?? null,
    node: process.version, v8: process.versions.v8, platform: platform(), release: release(), architecture: arch(),
    cpuModel: cpu?.model ?? null, cpuCount: cpus().length, totalMemoryBytes: totalmem(), execArgv: process.execArgv,
  };
}

export async function createProfileRunDirectory(root, outputRoot) {
  const base = isAbsolute(outputRoot) ? outputRoot : resolve(root, outputRoot);
  await mkdir(base, { recursive: true });
  const runId = `${new Date().toISOString().replaceAll(":", "").replaceAll(".", "-")}-${randomUUID().slice(0, 8)}`;
  const runDir = join(base, runId);
  await mkdir(runDir, { recursive: false });
  return { runId, runDir };
}

export async function writeProfileRun({ root, outputRoot, mode, definition, configuration, row, buildMode, runDir: existingRunDir, runId: existingRunId }) {
  const { runId, runDir } = existingRunDir && existingRunId ? { runId: existingRunId, runDir: existingRunDir } : await createProfileRunDirectory(root, outputRoot);
  const run = {
    schemaVersion: 1, mode, runId, createdAt: new Date().toISOString(), environment: await profileEnvironment(root, buildMode),
    configuration, rows: [row], skipped: [], failures: [],
  };
  await writeFile(join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  return { runId, runDir, run };
}

export function profilePath(runDir, fileName) {
  const target = isAbsolute(fileName) ? fileName : join(runDir, fileName);
  const rel = relative(runDir, target).replaceAll("\\", "/");
  return { target, relativePath: rel };
}
