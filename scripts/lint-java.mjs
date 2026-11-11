import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDirectory = resolve(root, "packages/runtime-web/bdj-host/src");
const configPath = resolve(root, "config/checkstyle.xml");
const checkstyleVersion = "14.4.0";
const checkstyleJar = resolve(root, "node_modules/.cache/bdmv2web", `checkstyle-${checkstyleVersion}-all.jar`);
const checkstyleUrl = `https://github.com/checkstyle/checkstyle/releases/download/checkstyle-${checkstyleVersion}/checkstyle-${checkstyleVersion}-all.jar`;

async function javaSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javaSources(path);
    return entry.isFile() && entry.name.endsWith(".java") ? [path] : [];
  }));
  return nested.flat();
}

async function ensureCheckstyle() {
  try {
    await access(checkstyleJar);
    return;
  } catch {
    await mkdir(dirname(checkstyleJar), { recursive: true });
  }

  const response = await fetch(checkstyleUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`Could not download Checkstyle ${checkstyleVersion}: HTTP ${response.status}.`);
  const temporaryJar = `${checkstyleJar}.tmp`;
  await writeFile(temporaryJar, new Uint8Array(await response.arrayBuffer()));
  await rename(temporaryJar, checkstyleJar);
}

async function runTool(command, args, label) {
  try {
    const result = await execFileAsync(command, args, { cwd: root, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const output = [error?.stdout, error?.stderr].filter(Boolean).join("\n");
    throw new Error(`${label} failed: ${[detail, output].filter(Boolean).join("\n")}`, { cause: error });
  }
}

async function lintJava() {
  const sources = (await javaSources(sourceDirectory)).sort();
  if (!sources.length) throw new Error(`No Java sources found under ${sourceDirectory}.`);
  await ensureCheckstyle();
  await runTool("java", ["-jar", checkstyleJar, "-c", configPath, ...sources], "Java style lint");

  const temporary = await mkdtemp(join(tmpdir(), "bdmv2web-java-lint-"));
  try {
    await runTool("javac", [
      "--release", "8",
      "-Xlint:all,-options,-serial,-this-escape",
      "-Werror",
      "-d", temporary,
      ...sources,
    ], "Java compiler lint");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  process.stdout.write(`Java lint passed for ${sources.length} source files.\n`);
}

await lintJava();
