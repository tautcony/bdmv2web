import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const javacAvailable = spawnSync("javac", ["-version"], { encoding: "utf8" }).status === 0;

async function javaSources(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javaSources(path));
    else if (entry.name.endsWith(".java")) files.push(path);
  }
  return files;
}

it.skipIf(!javacAvailable)("disc-bound Xlets retain identity across BDJO changes and support pause/resume", async () => {
  const output = await mkdtemp(join(tmpdir(), "bdmv-host-lifecycle-"));
  try {
    const compile = spawnSync("javac", ["--release", "8", "-d", output,
      ...await javaSources(join(packageRoot, "bdj-host/src")),
      ...await javaSources(join(packageRoot, "tests/fixtures/bdj-lifecycle")),
    ], { encoding: "utf8" });
    expect(compile.status, compile.stderr).toBe(0);
    const discRoot = join(output, "disc");
    const jarDirectory = join(discRoot, "BDMV", "JAR");
    await mkdir(jarDirectory, { recursive: true });
    const jar = spawnSync("jar", ["--create", "--file", join(jarDirectory, "00000.jar"), "-C", output, "LifecycleXlet.class", "-C", output, "TitleBoundLifecycleXlet.class"], { encoding: "utf8" });
    expect(jar.status, jar.stderr).toBe(0);
    await rm(join(output, "LifecycleXlet.class"), { force: true });
    await rm(join(output, "TitleBoundLifecycleXlet.class"), { force: true });
    const run = await runLifecycleProbe(output, discRoot);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).toContain("LIFECYCLE_OK disc-bound-init=1 title-bound-init=5 title-bound-destroy=5 pause=1");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

function runLifecycleProbe(classpath: string, discRoot: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("java", ["-Djava.awt.headless=true", "-cp", classpath, "LifecycleProbe", discRoot], { stdio: "pipe" });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Native lifecycle probe timed out.")); }, 10_000);
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split("\n"); stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("BDMV_RPC\t")) continue;
        const [, id = "", operation] = line.split("\t");
        const value = operation === "discId" ? "00000000000000000000000000000000" : "ok";
        child.stdin.write(`BDMV_RES\t${id}\t${Buffer.from(value).toString("base64")}\n`);
        if (operation === "selectTitle") {
          const [title = "0", restart = "false"] = Buffer.from(line.split("\t")[3] ?? "", "base64").toString("utf8").split("\u001f");
          const event = Buffer.from(`${title}|start|${restart}`).toString("base64");
          child.stdin.write(`BDMV_EVENT\ttitle\t00001\t${event}\n`);
        }
      }
    });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolveRun({ code, stderr }); });
  });
}
