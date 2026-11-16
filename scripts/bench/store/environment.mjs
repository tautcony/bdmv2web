import { execFileSync } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

function git(root, args) {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

/**
 * The CLI build a run measured: one bundled entry, or the multi-file tsc tree.
 *
 * The two shapes differ by tens of milliseconds per spawned CLI row, so a record
 * that does not say which one it timed cannot be compared with the other.
 * `runtime/` and `templates/` are copied into both shapes and stay out of the count.
 */
export async function cliArtifact(root) {
  const directory = join(root, "apps", "cli", "dist");
  let entries;
  try { entries = await readdir(directory, { recursive: true, withFileTypes: true }); }
  catch { return null; }
  let scriptFiles = 0, scriptBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    if (path.includes(`${sep}runtime${sep}`) || path.includes(`${sep}templates${sep}`)) continue;
    scriptFiles++;
    scriptBytes += (await stat(path)).size;
  }
  if (!scriptFiles) return null;
  return { mode: scriptFiles === 1 ? "bundled" : "module-tree", scriptFiles, scriptBytes };
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
    cliArtifact: await cliArtifact(resolve(root)),
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
