import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { m3Fixtures } from "@bdmv2web/hdmv";
import { expect, it } from "vitest";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

async function waitForLine(child: ChildProcess, text: string): Promise<void> {
  await new Promise<void>((resolveLine, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for '${text}'.`)), 10_000);
    let output = "";
    child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { output += chunk; if (output.includes(text)) { clearTimeout(timer); resolveLine(); } });
    child.stderr?.on("data", (chunk: string) => { output += chunk; if (output.includes(text)) { clearTimeout(timer); resolveLine(); } });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`bdmv2web serve exited ${code}: ${output}`)); });
  });
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>, name: string): Promise<Record<string, unknown>> {
  let pending = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`SSE ended before ${name}.`);
    pending += new TextDecoder().decode(chunk.value);
    const blocks = pending.split("\n\n"); pending = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (event === name && data) return JSON.parse(data) as Record<string, unknown>;
    }
  }
}

async function fixture(parent: string, args: Array<{ bdjoId: string; controlCode: number; binding: number; organizationId: number; applicationId: number; initialClass: string; basePath: string; classPath: string; parameters: string[] }>, script: string, runtimeSession: Record<string, unknown> = {}): Promise<{ root: string; java: string }> {
  const root = join(parent, "package");
  await mkdir(join(root, "runtime", "bdj"), { recursive: true });
  await mkdir(join(root, "bdj", "BDMV", "JAR", "00000"), { recursive: true });
  await mkdir(join(root, "BDMV", "STREAM"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html>");
  await writeFile(join(root, "runtime", "bdj", "bdj-host-api.jar"), "fixture host");
  await writeFile(join(root, "bdj", "BDMV", "JAR", "00000.jar"), "fixture application");
  await writeFile(join(root, "bdj", "BDMV", "JAR", "00000", "tone.wav"), "fixture audio");
  await writeFile(join(root, "BDMV", "STREAM", "00100.m2ts"), "fixture stream");
  await writeFile(join(root, "runtime", "bdj", "session.json"), JSON.stringify({
    discId: "fixture-disc", initialBdjoId: "00000", applications: args, session: { vmPrograms: [], vmEntries: [], bdjoDescriptors: [{ path: "BDJO/00000.bdjo", terminalInfo: { titleSearchMask: true, menuCallMask: true }, accessiblePlaylists: { accessToAll: true, playlistIds: [] } }], ...runtimeSession },
  }));
  const java = join(parent, "fake-java");
  await writeFile(java, script);
  await chmod(java, 0o755);
  return { root, java };
}

const application = [{ bdjoId: "00000", controlCode: 1, binding: 1, organizationId: 1, applicationId: 1, initialClass: "fixture.Xlet", basePath: "00000", classPath: "", parameters: [] }];

const playlist100 = {
  playlists: [{ id: "00100", source: { path: "BDMV/PLAYLIST/00100.mpls", origin: "primary", offset: "70" }, routes: [], marks: [], items: [{ index: 0, stcId: 0, clipId: "00100", streamPath: "STREAM/00100.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source: { path: "BDMV/PLAYLIST/00100.mpls", origin: "primary", offset: "70" } }] }], unknown: [], complete: true,
};

const hasMediaTools = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

async function writeSyntheticStream(path: string): Promise<void> {
  await new Promise<void>((resolveProcess, rejectProcess) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "ac3", "-b:a", "192k", "-streamid", "0:4113", "-streamid", "1:4352", "-f", "mpegts", path], { stdio: "ignore" });
    child.once("error", rejectProcess); child.once("exit", (code) => code === 0 ? resolveProcess() : rejectProcess(new Error(`Fixture FFmpeg exited ${String(code)}.`)));
  });
}

it.skipIf(process.platform === "win32" || !hasMediaTools)("routes the startup BD-J playlist to local menu media and keeps its real interval", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bdmv2web menu media "));
  const responseLog = join(parent, "rpc-response.log"); const b64 = (value: string) => Buffer.from(value).toString("base64");
  const fakeJava = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const responseLog = ${JSON.stringify(responseLog)};`,
    `process.stdout.write('BDMV_RPC\\t1\\tplayerStart\\t${b64("token-menu\u001fowner-menu\u001fplaylist\u001f100")}\\n');`,
    "let input = ''; process.stdin.on('data', (chunk) => { input += chunk; const lines = input.split(/\\r?\\n/); input = lines.pop() || ''; for (const line of lines) { if (line.startsWith('BDMV_RES\\t1\\t')) fs.writeFileSync(responseLog, Buffer.from(line.split('\\t')[2], 'base64').toString()); if (line.startsWith('BDMV_EVENT\\tshutdown')) process.exit(0); } });",
  ].join("\n");
  let serverProcess: ChildProcess | undefined;
  try {
    const source = { path: "BDMV/PLAYLIST/00100.mpls", origin: "primary", offset: "70" };
    const markedPlaylist = {
      ...playlist100,
      playlists: [{
        ...playlist100.playlists[0]!,
        marks: [
          { index: 0, playItemIndex: 0, sourceTime90k: "1000", source },
          { index: 1, playItemIndex: 0, sourceTime90k: "2274", source },
        ],
        items: [
          { ...playlist100.playlists[0]!.items[0]!, present: false, sourceIn90k: "1000", sourceOut90k: "5000", playlistStart90k: "0", playlistEnd90k: "4000" },
          { ...playlist100.playlists[0]!.items[0]!, index: 1, present: false, sourceIn90k: "1000", sourceOut90k: "5000", playlistStart90k: "4000", playlistEnd90k: "8000" },
        ],
      }],
    };
    const audioTracks = [{ streamNumber: 0, pid: 0x1100, language: "eng" }];
    const packageData = await fixture(parent, application, fakeJava, { externalTargets: markedPlaylist, bdjMenuMediaInputs: [0, 1].map((playItemIndex) => ({ playlistId: "00100", playItemIndex, clipId: "00100", sourceFile: "BDMV/STREAM/00100.m2ts", inTime45k: 500, outTime45k: 2500, stillMode: 0, repeatCount: 100, loopBackground: true, loopStart45k: 1137, videoPid: 0x1011, audioTracks })) });
    await writeSyntheticStream(join(packageData.root, "BDMV", "STREAM", "00100.m2ts"));
    const port = await freePort();
    serverProcess = spawn(process.execPath, [cli, "serve", packageData.root, "--port", String(port), "--java", packageData.java], { stdio: ["ignore", "pipe", "pipe"] });
    await waitForLine(serverProcess, `http://127.0.0.1:${port}/`);
    const reader = (await fetch(`http://127.0.0.1:${port}/api/bdj/events`)).body!.getReader();
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/start`, { method: "POST" })).status).toBe(200);
    const media = await readEvent(reader, "player-menu-media");
    expect(media).toMatchObject({ playerId: "token-menu", mode: "menu", playlistId: "00100", items: [
      { index: 0, clipId: "00100", start90k: "1000", end90k: "5000", mediaStart90k: "0", marks: [{ index: 0, offset90k: "0" }, { index: 1, offset90k: "1274" }], audioUrls: [expect.stringContaining("/api/bdj/menu-media/")] },
      { index: 1, clipId: "00100", start90k: "1000", end90k: "5000", mediaStart90k: "4000", marks: [], audioUrls: [expect.stringContaining("/api/bdj/menu-media/")] },
    ] });
    expect((media.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty("loopStartOffset90k");
    expect((media.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty("loopMarkIndex");
    expect(await readFile(responseLog, "utf8")).toBe("pending");
    const item = (media.items as Array<{ url: string }>)[0]!;
    const asset = await fetch(new URL(item.url, `http://127.0.0.1:${port}`));
    expect(asset.status).toBe(200); expect(asset.headers.get("content-type")).toBe("video/mp4"); expect(Number(asset.headers.get("content-length"))).toBeGreaterThan(0);
    await reader.cancel();
  } finally {
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    await rm(parent, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("publishes a contextual warning and missing marker when a menu source is absent", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bdmv2web missing menu media "));
  const b64 = (value: string) => Buffer.from(value).toString("base64");
  const fakeJava = [
    "#!/usr/bin/env node",
    `process.stdout.write('BDMV_RPC\\t1\\tplayerStart\\t${b64("token-missing\u001fowner-missing\u001fplaylist\u001f100")}\\n');`,
    "let input = ''; process.stdin.on('data', (chunk) => { input += chunk; const lines = input.split(/\\r?\\n/); input = lines.pop() || ''; for (const line of lines) if (line.startsWith('BDMV_EVENT\\tshutdown')) process.exit(0); });",
  ].join("\n");
  let serverProcess: ChildProcess | undefined;
  try {
    const packageData = await fixture(parent, application, fakeJava, { externalTargets: playlist100 });
    await rm(join(packageData.root, "BDMV", "STREAM", "00100.m2ts"), { force: true });
    const port = await freePort();
    serverProcess = spawn(process.execPath, [cli, "serve", packageData.root, "--port", String(port), "--java", packageData.java], { stdio: ["ignore", "pipe", "pipe"] });
    await waitForLine(serverProcess, `http://127.0.0.1:${port}/`);
    const reader = (await fetch(`http://127.0.0.1:${port}/api/bdj/events`)).body!.getReader();
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/start`, { method: "POST" })).status).toBe(200);
    const media = await readEvent(reader, "player-menu-media");
    expect(media).toMatchObject({ items: [{ missing: true, start90k: "0", end90k: "90000", mediaStart90k: "0", audioUrls: [], warning: expect.stringContaining("BDJO 00000") }] });
    expect((media.items as Array<{ warning: string }>)[0]?.warning).toContain("playlist 00100, PlayItem 0, source STREAM/00100.m2ts");
    expect((media.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty("url");
    await reader.cancel();
  } finally {
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    await rm(parent, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32" || !hasMediaTools)("cancels a menu media export when its Java player closes before preparation completes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bdmv2web menu media close race "));
  const responseLog = join(parent, "rpc-response.log"); const b64 = (value: string) => Buffer.from(value).toString("base64");
  const fakeJava = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const responseLog = ${JSON.stringify(responseLog)};`,
    `process.stdout.write('BDMV_RPC\\t1\\tplayerStart\\t${b64("token-cancel\u001fowner-cancel\u001fplaylist\u001f100")}\\n');`,
    `const stop = 'BDMV_RPC\\t2\\tplayerStop\\t${b64("token-cancel")}\\n';`,
    "let input = ''; process.stdin.on('data', (chunk) => { input += chunk; const lines = input.split(/\\r?\\n/); input = lines.pop() || ''; for (const line of lines) { if (line.startsWith('BDMV_RES\\t1\\t')) { const result = Buffer.from(line.split('\\t')[2], 'base64').toString(); fs.appendFileSync(responseLog, 'start:' + result + '\\n'); if (result === 'pending') process.stdout.write(stop); } if (line.startsWith('BDMV_RES\\t2\\t')) fs.appendFileSync(responseLog, 'stop:' + Buffer.from(line.split('\\t')[2], 'base64').toString() + '\\n'); if (line.startsWith('BDMV_EVENT\\tshutdown')) process.exit(0); } });",
  ].join("\n");
  let serverProcess: ChildProcess | undefined;
  try {
    const packageData = await fixture(parent, application, fakeJava, { externalTargets: playlist100, bdjMenuMediaInputs: [{ playlistId: "00100", playItemIndex: 0, clipId: "00100", sourceFile: "BDMV/STREAM/00100.m2ts", inTime45k: 0, outTime45k: 45_000, stillMode: 0, repeatCount: 1, loopBackground: false, videoPid: 0x1011, audioTracks: [{ streamNumber: 0, pid: 0x1100, language: "eng" }] }] });
    await writeSyntheticStream(join(packageData.root, "BDMV", "STREAM", "00100.m2ts"));
    const port = await freePort();
    serverProcess = spawn(process.execPath, [cli, "serve", packageData.root, "--port", String(port), "--java", packageData.java], { stdio: ["ignore", "pipe", "pipe"] });
    await waitForLine(serverProcess, `http://127.0.0.1:${port}/`);
    const reader = (await fetch(`http://127.0.0.1:${port}/api/bdj/events`)).body!.getReader();
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/start`, { method: "POST" })).status).toBe(200);
    await expect(readEvent(reader, "player-cancelled")).resolves.toMatchObject({ playerId: "token-cancel", status: "stopped" });
    await expect(readEvent(reader, "player-media-cancelled")).resolves.toMatchObject({ playerId: "token-cancel", playlist: 100 });
    expect(await readFile(responseLog, "utf8")).toBe("start:pending\nstop:stopped\n");
    await reader.cancel();
  } finally {
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    await rm(parent, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("uses the external adapter only after a user selects an HDMV feature title", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bdmv2web feature handoff "));
  const b64 = (value: string) => Buffer.from(value).toString("base64");
  const fakeJava = [
    "#!/usr/bin/env node",
    `const request = 'BDMV_RPC\\t1\\tplayerStart\\t${b64("token-feature\u001fowner-feature\u001fplaylist\u001f100")}\\n';`,
    "let input = ''; process.stdin.on('data', (chunk) => { input += chunk; const lines = input.split(/\\r?\\n/); input = lines.pop() || ''; for (const line of lines) { if (line.startsWith('BDMV_EVENT\\ttitle\\t')) process.stdout.write(request); if (line.startsWith('BDMV_EVENT\\tshutdown')) process.exit(0); } });",
  ].join("\n");
  let serverProcess: ChildProcess | undefined;
  try {
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const packageData = await fixture(parent, application, fakeJava, {
      vmPrograms: [], vmEntries: [{ id: "feature", kind: "title", target: { objectType: "HDMV", playbackType: 1, target: 1, source } }],
      externalTargets: playlist100,
      bdjoDescriptors: [{ path: "BDJO/00000.bdjo", terminalInfo: { titleSearchMask: false, menuCallMask: false }, accessiblePlaylists: { accessToAll: true, playlistIds: ["00100"] } }],
    });
    const port = await freePort();
    serverProcess = spawn(process.execPath, [cli, "serve", packageData.root, "--port", String(port), "--java", packageData.java], { stdio: ["ignore", "pipe", "pipe"] });
    await waitForLine(serverProcess, `http://127.0.0.1:${port}/`);
    const reader = (await fetch(`http://127.0.0.1:${port}/api/bdj/events`)).body!.getReader();
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/start`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/title`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: 1, origin: "user" }) })).status).toBe(204);
    await expect(readEvent(reader, "player-handoff")).resolves.toMatchObject({ playerId: "token-feature", playlist: 100, status: "unavailable", message: expect.stringContaining("requires bounded playback") });
    await reader.cancel();
  } finally {
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    await rm(parent, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("serves BD-J resources and forwards observed browser media events to the live Java process", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bdmv2web serve bdj "));
  const eventLog = join(parent, "events.log"); const responseLog = join(parent, "rpc-response.log");
  const b64 = (value: string) => Buffer.from(value).toString("base64");
  const fakeJava = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const eventLog = ${JSON.stringify(eventLog)}; const responseLog = ${JSON.stringify(responseLog)};`,
    `process.stdout.write('BDMV_RPC\\t1\\tplayerStart\\t${b64("token-1\u001fowner-1\u001fresource\u001ffile:/BDMV/JAR/00000/tone.wav")}\\n');`,
    "let input = ''; process.stdin.on('data', (chunk) => { input += chunk; const lines = input.split(/\\r?\\n/); input = lines.pop() || ''; for (const line of lines) { if (line.startsWith('BDMV_RES\\t1\\t')) fs.writeFileSync(responseLog, Buffer.from(line.split('\\t')[2], 'base64').toString()); if (line.startsWith('BDMV_EVENT\\tplayer\\t')) fs.appendFileSync(eventLog, line + '\\n'); if (line.startsWith('BDMV_EVENT\\tshutdown')) process.exit(0); } });",
  ].join("\n");
  let serverProcess: ChildProcess | undefined;
  try {
    const packageData = await fixture(parent, application, fakeJava);
    const port = await freePort();
    serverProcess = spawn(process.execPath, [cli, "serve", packageData.root, "--port", String(port), "--java", packageData.java], { stdio: ["ignore", "pipe", "pipe"] });
    await waitForLine(serverProcess, `http://127.0.0.1:${port}/`);
    const events = await fetch(`http://127.0.0.1:${port}/api/bdj/events`);
    const reader = events.body!.getReader();
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/start`, { method: "POST" })).status).toBe(200);
    await expect(readEvent(reader, "player-resource")).resolves.toMatchObject({ playerId: "token-1", path: "bdj/BDMV/JAR/00000/tone.wav" });
    expect(await readFile(responseLog, "utf8")).toBe("pending");
    for (const event of ["started", "ended"] as const) {
      expect((await fetch(`http://127.0.0.1:${port}/api/bdj/media-event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: "token-1", event }) })).status).toBe(204);
      await expect(readEvent(reader, "player-observation")).resolves.toMatchObject({ playerId: "token-1", event });
    }
    const logged = await readFile(eventLog, "utf8");
    expect(logged).toContain(`BDMV_EVENT\tplayer\ttoken-1\t${b64("started")}`);
    expect(logged).toContain(`BDMV_EVENT\tplayer\ttoken-1\t${b64("ended")}`);
    await reader.cancel();
  } finally {
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    await rm(parent, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("replays a user-selected feature player handoff to a reconnected browser", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bdmv2web player handoff "));
  const b64 = (value: string) => Buffer.from(value).toString("base64");
  const fakeJava = [
    "#!/usr/bin/env node",
    `const request = 'BDMV_RPC\\t1\\tplayerStart\\t${b64("token-1\u001fowner-1\u001fplaylist\u001f100")}\\n';`,
    "let input = ''; process.stdin.on('data', (chunk) => { input += chunk; const lines = input.split(/\\r?\\n/); input = lines.pop() || ''; for (const line of lines) { if (line.startsWith('BDMV_EVENT\\ttitle\\t')) process.stdout.write(request); if (line.startsWith('BDMV_EVENT\\tshutdown')) process.exit(0); } });",
  ].join("\n");
  let serverProcess: ChildProcess | undefined;
  try {
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const packageData = await fixture(parent, application, fakeJava, { vmPrograms: [], vmEntries: [{ id: "feature", kind: "title", target: { objectType: "HDMV", playbackType: 1, target: 1, source } }], externalTargets: playlist100, bdjoDescriptors: [{ path: "BDJO/00000.bdjo", terminalInfo: { titleSearchMask: false, menuCallMask: false }, accessiblePlaylists: { accessToAll: true, playlistIds: ["00100"] } }] });
    const port = await freePort();
    serverProcess = spawn(process.execPath, [cli, "serve", packageData.root, "--port", String(port), "--java", packageData.java], { stdio: ["ignore", "pipe", "pipe"] });
    await waitForLine(serverProcess, `http://127.0.0.1:${port}/`);
    const firstReader = (await fetch(`http://127.0.0.1:${port}/api/bdj/events`)).body!.getReader();
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/start`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/title`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: 1, origin: "user" }) })).status).toBe(204);
    await expect(readEvent(firstReader, "player-handoff")).resolves.toMatchObject({ playerId: "token-1", playlist: 100, status: "unavailable", message: expect.stringContaining("requires bounded playback") });
    await firstReader.cancel();

    const reconnectedReader = (await fetch(`http://127.0.0.1:${port}/api/bdj/events`)).body!.getReader();
    await expect(readEvent(reconnectedReader, "player-handoff")).resolves.toMatchObject({ playerId: "token-1", playlist: 100, status: "unavailable", message: expect.stringContaining("requires bounded playback") });
    await reconnectedReader.cancel();
  } finally {
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    await rm(parent, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("routes mixed BD-J and HDMV title events through the service-owned VM", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bdmv2web mixed session "));
  const b64 = (value: string) => Buffer.from(value).toString("base64");
  const fakeJava = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const responseLog = ${JSON.stringify(join(parent, "rpc-response.log"))};`,
    `process.stdout.write('BDMV_RPC\\t1\\tselectTitle\\t${b64("1")}\\n');`,
    "let input = ''; process.stdin.on('data', (chunk) => { input += chunk; const lines = input.split(/\\r?\\n/); input = lines.pop() || ''; for (const line of lines) { if (line.startsWith('BDMV_RES\\t1\\t')) fs.writeFileSync(responseLog, Buffer.from(line.split('\\t')[2], 'base64').toString()); if (line.startsWith('BDMV_EVENT\\tshutdown')) process.exit(0); } });",
  ].join("\n");
  let serverProcess: ChildProcess | undefined;
  try {
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const runtimeSession = {
      vmPrograms: [{ id: 1, instructions: [], menuCallMask: false, titleSearchMask: true }],
      vmEntries: [
        { id: "first-play", kind: "firstPlay", target: { objectType: "BDJ", playbackType: 1, target: "00000", source } },
        { id: "top-menu", kind: "topMenu", target: { objectType: "HDMV", playbackType: 1, target: 1, source } },
        { id: "title-1", kind: "title", target: { objectType: "HDMV", playbackType: 1, target: 1, source } },
      ],
    };
    const packageData = await fixture(parent, application, fakeJava, runtimeSession);
    const session = JSON.parse(await readFile(join(packageData.root, "runtime/bdj/session.json"), "utf8")) as { session: { bdjoDescriptors: Array<{ terminalInfo: { titleSearchMask: boolean; menuCallMask: boolean } }> } };
    session.session.bdjoDescriptors[0]!.terminalInfo.titleSearchMask = false;
    session.session.bdjoDescriptors[0]!.terminalInfo.menuCallMask = false;
    await writeFile(join(packageData.root, "runtime/bdj/session.json"), JSON.stringify(session));
    const port = await freePort();
    serverProcess = spawn(process.execPath, [cli, "serve", packageData.root, "--port", String(port), "--java", packageData.java], { stdio: ["ignore", "pipe", "pipe"] });
    await waitForLine(serverProcess, `http://127.0.0.1:${port}/`);
    const events = await fetch(`http://127.0.0.1:${port}/api/bdj/events`);
    const reader = events.body!.getReader();
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/start`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/title`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: 1, origin: "user" }) })).status).toBe(204);
    await expect(readEvent(reader, "hdmv-mode")).resolves.toMatchObject({ active: true });
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if (await readFile(join(parent, "rpc-response.log"), "utf8") === "requested") break; } catch { /* The Java response is pending. */ }
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    expect(await readFile(join(parent, "rpc-response.log"), "utf8")).toBe("requested");
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/hdmv`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "event", event: { type: "TOP_MENU" } }) })).status).toBe(204);
    await expect(readEvent(reader, "hdmv-actions")).resolves.toMatchObject({ actions: [expect.objectContaining({ type: "TITLE_SEARCH", payload: { title: 0 } })] });
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/title`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: 0 }) })).status).toBe(204);
    await expect(readEvent(reader, "navigation")).resolves.toMatchObject({ title: 0, programId: 1 });
    await reader.cancel();
  } finally {
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    await rm(parent, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("runs HDMV First Play before the indexed BD-J Top Menu and preserves GPR for Java", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bdmv2web mixed bootstrap "));
  const observations = join(parent, "gpr-observations.log");
  const fakeJava = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const observations = ${JSON.stringify(observations)};`,
    "let input = ''; let rpcId = 0;",
    "process.stdin.on('data', (chunk) => { input += chunk; const lines = input.split(/\\r?\\n/); input = lines.pop() || ''; for (const line of lines) {",
    "if (line.startsWith('BDMV_EVENT\\ttitle\\t')) { const title = Buffer.from(line.split('\\t')[3] || '', 'base64').toString(); rpcId++; process.stdout.write('BDMV_RPC\\t' + rpcId + '\\treadGPR\\t' + Buffer.from('0').toString('base64') + '\\n'); fs.appendFileSync(observations, 'title:' + title + '\\n'); }",
    "if (line.startsWith('BDMV_RES\\t')) { const parts = line.split('\\t'); fs.appendFileSync(observations, 'gpr:' + Buffer.from(parts[2], 'base64').toString() + '\\n'); }",
    "if (line.startsWith('BDMV_EVENT\\tshutdown')) process.exit(0);",
    "} });",
  ].join("\n");
  let serverProcess: ChildProcess | undefined;
  try {
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const runtimeSession = {
      vmPrograms: [{ id: 0, instructions: [m3Fixtures.move5] }],
      vmEntries: [
        { id: "first-play", kind: "firstPlay", target: { objectType: "HDMV", playbackType: 1, target: 0, source } },
        { id: "top-menu", kind: "topMenu", target: { objectType: "BDJ", playbackType: 1, target: "00000", source } },
      ],
    };
    const packageData = await fixture(parent, application, fakeJava, runtimeSession);
    const port = await freePort();
    serverProcess = spawn(process.execPath, [cli, "serve", packageData.root, "--port", String(port), "--java", packageData.java], { stdio: ["ignore", "pipe", "pipe"] });
    await waitForLine(serverProcess, `http://127.0.0.1:${port}/`);
    const events = await fetch(`http://127.0.0.1:${port}/api/bdj/events`);
    const reader = events.body!.getReader();
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/start`, { method: "POST" })).status).toBe(200);
    const firstPlay = await fetch(`http://127.0.0.1:${port}/api/bdj/title`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: 0xffff, origin: "startup" }) });
    expect(firstPlay.status).toBe(204);
    await expect(readEvent(reader, "navigation")).resolves.toMatchObject({ title: 0xffff, programId: 0, gpr: expect.arrayContaining([5]) });
    const topMenu = await fetch(`http://127.0.0.1:${port}/api/bdj/title`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: 0, origin: "system" }) });
    expect(topMenu.status).toBe(204);
    await expect(readEvent(reader, "hdmv-mode")).resolves.toMatchObject({ active: false });
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await readFile(observations, "utf8")).includes("gpr:5")) break; } catch { /* Java has not read the session register yet. */ }
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    expect(await readFile(observations, "utf8")).toContain("gpr:5");
    await reader.cancel();
  } finally {
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    await rm(parent, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("authored Java title selection bypasses the user title-search mask", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bdmv2web masked session "));
  const responseLog = join(parent, "rpc-response.log");
  const b64 = (value: string) => Buffer.from(value).toString("base64");
  const fakeJava = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const responseLog = ${JSON.stringify(responseLog)};`,
    `process.stdout.write('BDMV_RPC\\t1\\tselectTitle\\t${b64("1")}\\n');`,
    "let input = ''; process.stdin.on('data', (chunk) => { input += chunk; const lines = input.split(/\\r?\\n/); input = lines.pop() || ''; for (const line of lines) { if (line.startsWith('BDMV_RES\\t1\\t')) fs.writeFileSync(responseLog, Buffer.from(line.split('\\t')[2], 'base64').toString()); if (line.startsWith('BDMV_EVENT\\tshutdown')) process.exit(0); } });",
  ].join("\n");
  let serverProcess: ChildProcess | undefined;
  try {
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const runtimeSession = {
      vmPrograms: [],
      vmEntries: [
        { id: "first-play", kind: "firstPlay", target: { objectType: "BDJ", playbackType: 1, target: "00000", source } },
        { id: "title-1", kind: "title", target: { objectType: "HDMV", playbackType: 1, target: 1, source } },
      ],
    };
    const packageData = await fixture(parent, application, fakeJava, runtimeSession);
    const port = await freePort();
    serverProcess = spawn(process.execPath, [cli, "serve", packageData.root, "--port", String(port), "--java", packageData.java], { stdio: ["ignore", "pipe", "pipe"] });
    await waitForLine(serverProcess, `http://127.0.0.1:${port}/`);
    expect((await fetch(`http://127.0.0.1:${port}/api/bdj/start`, { method: "POST" })).status).toBe(200);
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if (await readFile(responseLog, "utf8") === "requested") break; } catch { /* RPC response is pending. */ }
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    expect(await readFile(responseLog, "utf8")).toBe("requested");
    const masked = await fetch(`http://127.0.0.1:${port}/api/bdj/title`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: 1 }) });
    expect(masked.status).toBe(400);
    expect(await masked.text()).toContain("masks user title-search requests");
  } finally {
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    await rm(parent, { recursive: true, force: true });
  }
});
