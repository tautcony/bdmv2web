import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDirectory = resolve(root, "packages/runtime-web/bdj-host/src");

async function javaSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javaSources(path);
    return entry.isFile() && entry.name.endsWith(".java") ? [path] : [];
  }));
  return nested.flat();
}

async function runTool(command, args) {
  try {
    await execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`BD-J host compilation failed while running '${command}': ${detail}. A JDK with javac and jar is required.`, { cause: error });
  }
}

export async function buildBdjHostApi(outputPath) {
  if (!outputPath) throw new Error("Pass the target path for bdj-host-api.jar.");
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), "bdmv2web-bdj-host-"));
  const classes = join(temporary, "classes");
  await mkdir(classes);
  try {
    const sources = (await javaSources(sourceDirectory)).sort();
    if (!sources.length) throw new Error(`No Java sources found under ${sourceDirectory}.`);
    await runTool("javac", ["--release", "8", "-d", classes, ...sources]);
    await runTool("jar", ["--create", "--file", target, "-C", classes, "."]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildBdjHostApi(process.argv[2]);
}
