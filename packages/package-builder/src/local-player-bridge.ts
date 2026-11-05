/** The generated helper binds only localhost and opens declared BDMV STREAM files with the platform's default handler. */
export const LOCAL_PLAYER_BRIDGE = String.raw`import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(resolve(root, "bdmv-config.json"), "utf8"));
if (typeof config.bdmvPath !== "string" || !config.bdmvPath) throw new Error("bdmv-config.json must contain bdmvPath");
const bdmv = await realpath(resolve(root, config.bdmvPath));
const stream = await realpath(resolve(bdmv, "STREAM"));
if (relative(bdmv, stream) !== "STREAM") throw new Error("STREAM must be within the configured BDMV directory");
const data = JSON.parse(await readFile(resolve(root, "external-targets.json"), "utf8"));
const allowed = new Set(data.playlists.flatMap(p => p.items.map(i => i.clipId)).filter(id => /^[0-9]{5}$/.test(id)));
const token = randomBytes(24).toString("hex");
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const id = url.searchParams.get("clip");
    if (req.method !== "GET" || url.pathname !== "/open" || url.searchParams.get("token") !== token || !id || !allowed.has(id)) throw new Error("Invalid playback request");
    const path = await realpath(resolve(stream, id + ".m2ts"));
    const sub = relative(stream, path);
    if (!sub || sub === ".." || sub.startsWith(".." + sep) || isAbsolute(sub) || !(await stat(path)).isFile()) throw new Error("Source file is not a regular file within STREAM");
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32.exe" : "xdg-open";
    const openerArgs = process.platform === "win32" ? ["url.dll,FileProtocolHandler", path] : [path];
    const child = spawn(opener, openerArgs, { stdio: "ignore" });
    child.once("error", () => { if (!res.headersSent) { res.writeHead(500); res.end(); } });
    child.once("exit", code => { if (res.headersSent) return; if (code !== 0) { res.writeHead(500); res.end(); return; } res.writeHead(200, { "Content-Type": "image/gif", "Cache-Control": "no-store" }); res.end(gif); });
  } catch { if (!res.headersSent) { res.writeHead(400); res.end(); } }
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const url = pathToFileURL(resolve(root, "index.html"));
  url.hash = new URLSearchParams({ bridgePort: String(port), bridgeToken: token }).toString();
  console.log("BDMV menu local playback bridge is running. Close this window to stop it.");
  const browser = process.env.BROWSER;
  const candidates = browser ? [browser] : process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["chrome.exe", "chrome"] : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  const launch = (index) => {
    if (index >= candidates.length) { console.error("Could not find Google Chrome. Set BROWSER to its executable path and open this URL:", url.href); return; }
    const executable = candidates[index];
    const args = !browser && process.platform === "darwin" ? ["-a", "Google Chrome", url.href] : [url.href];
    const child = spawn(executable, args, { stdio: "ignore" });
    child.once("error", () => launch(index + 1));
    child.once("exit", code => { if (code !== 0) launch(index + 1); });
  };
  launch(0);
});
`;
export function localPlayerLauncher(nodePath: string): string {
  const escaped = `'${nodePath.replaceAll("'", "'\\''")}'`;
  return `#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nif command -v node >/dev/null 2>&1; then exec node ./local-player-bridge.mjs; fi\nif [ -x ${escaped} ]; then exec ${escaped} ./local-player-bridge.mjs; fi\necho "Node.js is required to start the local playback bridge."\nexit 1\n`;
}
