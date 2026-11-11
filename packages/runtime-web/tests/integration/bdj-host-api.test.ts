import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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

it.skipIf(!javacAvailable)("native Java host creates ARGB images and delivers AWT/DVB press and release", async () => {
  const output = await mkdtemp(join(tmpdir(), "bdmv-host-api-"));
  try {
    const compile = spawnSync("javac", ["--release", "8", "-d", output,
      ...await javaSources(join(packageRoot, "bdj-host/src")),
      join(packageRoot, "tests/fixtures/bdj-host-api/HostApiProbe.java"),
    ], { encoding: "utf8" });
    expect(compile.status, compile.stderr).toBe(0);
    const run = spawnSync("java", ["-Djava.awt.headless=true", "-cp", output, "HostApiProbe"], { encoding: "utf8", timeout: 10_000 });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("HOST_API_PROBE_OK pixels=ffff00ff,00000000 awt=401,402 dvb=401,402");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

it.skipIf(!javacAvailable).each(["requested", "ended", "stopped", "reuse", "identity", "contract", "missing"])("native JMF player follows %s observations", async (mode) => {
  const output = await mkdtemp(join(tmpdir(), "bdmv-host-player-"));
  try {
    const compile = spawnSync("javac", ["--release", "8", "-d", output,
      ...await javaSources(join(packageRoot, "bdj-host/src")),
      join(packageRoot, "tests/fixtures/bdj-host-api/BrowserPlayerProbe.java"),
    ], { encoding: "utf8" });
    expect(compile.status, compile.stderr).toBe(0);
    const result = await runPlayerProbe(output, mode);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain("PLAYER_REQUESTED state=500 events=RealizeCompleteEvent,PrefetchCompleteEvent");
    expect(result.stderr).toContain(`PLAYER_PROBE_OK ${mode}`);
    if (mode === "missing") expect(result.stdout).toContain(Buffer.from("missingSkip").toString("base64"));
    if (mode === "reuse") {
      expect(result.playerStarts).toHaveLength(2);
      expect(result.playerStarts[0]?.owner).toBe(result.playerStarts[1]?.owner);
      expect(result.playerStarts.map((request) => request.token)).toEqual([`${result.playerStarts[0]?.owner}:1`, `${result.playerStarts[0]?.owner}:2`]);
    }
    if (mode === "identity") {
      expect(result.playerStarts).toHaveLength(2);
      expect(result.playerStarts[0]?.owner).not.toBe(result.playerStarts[1]?.owner);
      expect(result.playerStarts.map((request) => request.token)).toEqual(result.playerStarts.map((request) => `${request.owner}:1`));
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

function runPlayerProbe(classpath: string, mode: string): Promise<{ code: number | null; stderr: string; stdout: string; playerStarts: Array<{ token: string; owner: string }> }> {
  return new Promise((resolve, reject) => {
    const child = spawn("java", ["-Djava.awt.headless=true", "-cp", classpath, "javax.media.BrowserPlayerProbe", mode], { stdio: "pipe" });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Native player observation timed out.")); }, 15_000);
    let stdoutBuffer = ""; let stderrBuffer = ""; let stderr = ""; let stdout = "";
    const response = (id: string, value: string) => child.stdin.write(`BDMV_RES\t${id}\t${Buffer.from(value).toString("base64")}\n`);
    let playerToken = "";
    const playerStarts: Array<{ token: string; owner: string }> = [];
    const event = (value: string) => child.stdin.write(`BDMV_EVENT\tplayer\t${playerToken}\t${Buffer.from(value).toString("base64")}\n`);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n"); stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("BDMV_RPC\t")) continue;
        const [, id = "", operation] = line.split("\t");
        if (operation === "playerStart") {
          const [token = "", owner = ""] = Buffer.from(line.split("\t")[3] ?? "", "base64").toString("utf8").split("\u001f");
          playerToken = token;
          playerStarts.push({ token, owner });
        }
        response(id, operation === "playerStop" || mode !== "requested" ? "pending" : "requested");
        if (operation === "playerStop") event("stopped");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk; stderrBuffer += chunk;
      const lines = stderrBuffer.split("\n"); stderrBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("PLAYER_REQUESTED ") && mode === "missing") event("missing-ended|2|STREAM%2F00358.m2ts");
        if (line.startsWith("PLAYER_REQUESTED ") && mode !== "requested" && mode !== "identity" && mode !== "missing") {
          event("started");
          if (mode === "contract") { event("presented"); event("presented"); event("position|1000000000|0|45"); event("position|2000000000|1|46"); event("ended"); }
        }
        if (line.startsWith("PLAYER_RESTART_REQUESTED ")) event("started");
        if (line.startsWith("PLAYER_STARTED ") && (mode === "ended" || mode === "reuse")) event("ended");
      }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => { clearTimeout(timer); resolve({ code, stderr, stdout, playerStarts }); });
  });
}
