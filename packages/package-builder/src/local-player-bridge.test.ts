import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { LOCAL_PLAYER_BRIDGE } from "./local-player-bridge.js";

describe("local system player bridge", () => {
  it("opens only declared regular STREAM files for the active session", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv bridge ")); const menu = join(root, "BDMV-menu"); const stream = join(root, "BDMV", "STREAM");
    await mkdir(menu); await mkdir(stream, { recursive: true });
    await writeFile(join(stream, "00006.m2ts"), "fixture");
    await writeFile(join(root, "outside.m2ts"), "outside");
    await symlink(join(root, "outside.m2ts"), join(stream, "00007.m2ts"));
    await writeFile(join(menu, "bdmv-config.json"), JSON.stringify({ bdmvPath: "../BDMV" }));
    await writeFile(join(menu, "external-targets.json"), JSON.stringify({ playlists: [{ items: [{ clipId: "00006" }, { clipId: "00007" }] }] }));
    const source = LOCAL_PLAYER_BRIDGE.replace('console.log("BDMV menu local playback bridge is running. Close this window to stop it.");', 'console.log(url.href);')
      .replace('spawn("/usr/bin/open", [path]', 'spawn("/usr/bin/true", []')
      .replace('spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [url.href]', 'spawn("/usr/bin/true", []');
    await writeFile(join(menu, "local-player-bridge.mjs"), source);
    const child = spawn(process.execPath, [join(menu, "local-player-bridge.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      const line = await new Promise<string>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`Bridge exited early: ${code}`)));
        createInterface({ input: child.stdout }).once("line", resolve);
      });
      const session = new URL(line); const fragment = new URLSearchParams(session.hash.slice(1));
      const endpoint = `http://127.0.0.1:${fragment.get("bridgePort")}/open`;
      const token = fragment.get("bridgeToken");
      expect((await fetch(`${endpoint}?token=wrong&clip=00006`)).status).toBe(400);
      expect((await fetch(`${endpoint}?token=${token}&clip=00008`)).status).toBe(400);
      expect((await fetch(`${endpoint}?token=${token}&clip=00007`)).status).toBe(400);
      expect((await fetch(`${endpoint}?token=${token}&clip=00006`)).status).toBe(200);
    } finally {
      child.kill();
      await rm(root, { recursive: true, force: true });
    }
  });
});
