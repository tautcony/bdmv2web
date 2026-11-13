import { constants as fsConstants } from "node:fs";
import { open, readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { within } from "@bdmv2web/utils/node-path";
import { isRecord, errorText } from "@bdmv2web/utils";
import { inputPath, optionValue } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { HdmvVm, type VmOptions, type VmProgram } from "@bdmv2web/hdmv";
import { isDeclaredExternalStreamPath, resolveExternalPlayTarget, type ExternalMediaTargets, type ExternalPlayItem, type ExternalPlayRequest } from "@bdmv2web/media-export/external-targets";
import { buildExternalPlayerLaunch, launchExternalPlayer } from "../shared/external-player.js";
import { normalizeDiscId } from "../shared/disc-id.js";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".gz": "application/gzip", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".jar": "application/java-archive",
  ".png": "image/png", ".wasm": "application/wasm", ".m4a": "audio/mp4", ".mp4": "video/mp4",
};

interface RuntimeLaunch {
  discId: string;
  initialBdjoId: string;
  applications: Array<{ bdjoId: string; controlCode: number; binding: number; organizationId: number; applicationId: number; initialClass: string; basePath: string; classPath: string; parameters: string[] }>;
  session?: { vmPrograms: VmProgram[]; vmEntries?: VmOptions["entries"]; playerProfile?: VmOptions["profile"]; vmLimits?: VmOptions["limits"]; externalTargets?: ExternalMediaTargets; bdmvPath?: string; bdjoDescriptors?: Array<{ path: string; terminalInfo: { titleSearchMask: boolean; menuCallMask: boolean }; accessiblePlaylists: { accessToAll: boolean; playlistIds: string[] } }> };
}

interface MenuMediaTargetItem {
  index: number;
  clipId: string;
  streamPath: string;
  present: boolean;
  sourceOrigin90k: string | null;
  sourceStart90k: string;
  sourceEnd90k: string;
  playlistStart90k: string;
  sourceIn90k: string;
  source: ExternalPlayItem["source"];
}

interface PreparedMenuMediaItem { videoFile?: string; audioFiles: string[]; missing?: boolean; warning?: string; loopStartOffset90k?: string }

/** `asset-manifest.json` media: one pointer per PlayItem, one record per plan. */
interface PackagedMenuIndex {
  pointers: Array<Record<string, unknown>>;
  plans: Record<string, Record<string, unknown>>;
}

interface MenuMediaTarget {
  playlistId: string;
  items: MenuMediaTargetItem[];
  source: ExternalPlayItem["source"];
}

/** Serve a generated package and own its native BD-J Java process. */
export async function serve(): Promise<void> {
  const input = inputPath() ?? ".";
  const portText = optionValue("--port") ?? "4173";
  const discIdOption = optionValue("--disc-id");
  let discIdOverride: string | undefined;
  try { if (discIdOption !== undefined) discIdOverride = normalizeDiscId(discIdOption); }
  catch (error) { fail("CLI_INVALID_DISC_ID", errorText(error)); }
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) fail("CLI_INVALID_PORT", `Port must be an integer from 1 to 65535; received '${portText}'.`);
  let root: string;
  try { root = await realpath(resolve(input)); }
  catch (error) { fail("CLI_SERVE_ROOT_MISSING", `Could not open package directory: ${errorText(error)}`, input); }
  let rootInfo;
  try { rootInfo = await stat(root); }
  catch { fail("CLI_SERVE_ROOT_INVALID", "The serve input must be a package directory.", root); }
  if (!rootInfo.isDirectory()) fail("CLI_SERVE_ROOT_INVALID", "The serve input must be a package directory.", root);
  let javaProcess: ChildProcessWithoutNullStreams | undefined;
  let javaSessionStarted = false;
  let javaSessionReady = false;
  let stopping = false;
  let hdmvVm: HdmvVm | undefined;
  let hdmvMode = false;
  let activeBdjoId = "";
  let activeLaunch: RuntimeLaunch | undefined;
  const playerPlaylists = new Map<string, number>();
  const browserMediaPlayers = new Set<string>();
  const menuMediaSessions = new Map<string, Record<string, unknown>>();
  const pendingMenuPlayers = new Set<string>();
  const activePlayerTokens = new Set<string>();
  const menuMediaFiles = new Map<string, string>();
  const latestPlayerHandoffs = new Map<string, Record<string, unknown>>();
  let packagedMenuMedia: Promise<PackagedMenuIndex> | undefined;
  let activeTitle = 0xffff;
  let userFeatureTitleSelected = false;
  let pendingUserSelection = false;
  let frameSequence = 0;
  let latestFrame: { sequence: number; data: string } | undefined;
  const eventClients = new Set<import("node:http").ServerResponse>();
  const pendingStartResponses: import("node:http").ServerResponse[] = [];
  const emit = (name: string, value: unknown) => { const record = `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`; for (const client of eventClients) client.write(record); };
  const outsidePackage = (path: string): boolean => !within(root, path);
  const resetBdjSession = (): void => {
    javaProcess = undefined;
    javaSessionStarted = false;
    javaSessionReady = false;
    hdmvVm = undefined;
    hdmvMode = false;
    activeBdjoId = "";
    activeLaunch = undefined;
    activeTitle = 0xffff;
    userFeatureTitleSelected = false;
    pendingUserSelection = false;
    latestFrame = undefined;
    playerPlaylists.clear();
    browserMediaPlayers.clear();
    menuMediaSessions.clear();
    pendingMenuPlayers.clear();
    activePlayerTokens.clear();
    menuMediaFiles.clear();
    latestPlayerHandoffs.clear();
    packagedMenuMedia = undefined;
  };
  const packagedMenuItems = (): Promise<PackagedMenuIndex> => packagedMenuMedia ??= readFile(resolve(root, "asset-manifest.json"), "utf8").then((json) => {
    const manifest: unknown = JSON.parse(json);
    if (!isRecord(manifest)) return { pointers: [], plans: {} };
    return {
      pointers: Array.isArray(manifest.menuMedia) ? manifest.menuMedia.filter(isRecord) : [],
      plans: isRecord(manifest.mediaPlans) ? Object.fromEntries(Object.entries(manifest.mediaPlans).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))) : {},
    };
  });
  const packagedMenuItem = async (item: MenuMediaTargetItem, playlistId: string, bdmvRoot: string): Promise<PreparedMenuMediaItem> => {
    if (!isDeclaredExternalStreamPath(item.clipId, item.streamPath)) throw new Error(`Menu playlist source '${item.streamPath}' is not a declared clip stream.`);
    const sourcePath = resolve(bdmvRoot, "STREAM", `${item.clipId}.m2ts`);
    try { await stat(sourcePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { missing: true, audioFiles: [], warning: `BD-J media is missing: BDJO ${activeBdjoId || "unknown"}, title ${activeTitle}, playlist ${playlistId}, PlayItem ${item.index}, source ${item.streamPath}. Skipping this item.` };
    }
    const start = BigInt(item.sourceStart90k); const end = BigInt(item.sourceEnd90k);
    if (start % 2n !== 0n || end % 2n !== 0n || end <= start) throw new Error(`Menu playlist ${playlistId} PlayItem ${item.index} has an interval that cannot be represented on the MPLS 45 kHz clock.`);
    // `assets/media` indexes every PlayItem by (playlist, PlayItem) and names the
    // plan it plays; the plan's own record is stored once per encoded unit.
    const { pointers, plans } = await packagedMenuItems();
    const pointer = pointers.find((entry) => entry.playlistId === playlistId && entry.playItemIndex === item.index && typeof entry.planPath === "string");
    const record = pointer === undefined ? undefined : plans[String(pointer.planPath)];
    const plan = record?.plan;
    const background = record?.background;
    if (!isRecord(plan) || !isRecord(background) || typeof background.path !== "string" || plan.clipId !== item.clipId
      || plan.sourceIn45k !== Number(start / 2n) || plan.sourceOut45k !== Number(end / 2n)) throw new Error(`Menu playlist ${playlistId} PlayItem ${item.index} source ${item.streamPath} has no matching packaged playback asset; rebuild the package.`);
    const audioFiles = Array.isArray(record?.audioTracks) ? record.audioTracks.flatMap((track) => isRecord(track) && typeof track.path === "string" ? [resolve(root, track.path)] : []) : [];
    const videoFile = resolve(root, background.path);
    if (outsidePackage(videoFile)) throw new Error(`Packaged BD-J menu media path '${background.path}' is outside the package.`);
    for (const audioFile of audioFiles) if (outsidePackage(audioFile)) throw new Error(`Packaged BD-J menu audio path '${audioFile}' is outside the package.`);
    return { videoFile, audioFiles };
  };
  const prepareMenuPlaylist = async (target: MenuMediaTarget, playerId: string, bdmvRoot: string, bdjoId: string, title: number) => {
    const items: Array<{ index: number; clipId: string; source: ExternalPlayItem["source"]; start90k: string; end90k: string; mediaStart90k: string; url?: string; audioUrls: string[]; missing?: true; warning?: string; loopStartOffset90k?: string; loopMarkIndex?: number; marks: Array<{ index: number; offset90k: string }> }> = [];
    for (const item of target.items) {
      const file = await packagedMenuItem(item, target.playlistId, bdmvRoot);
      const assetId = file.missing ? undefined : randomUUID();
      if (assetId && file.videoFile) menuMediaFiles.set(assetId, file.videoFile);
      const audioUrls = file.audioFiles.map((audioFile) => { const audioId = randomUUID(); menuMediaFiles.set(audioId, audioFile); return `/api/bdj/menu-media/${audioId}`; });
      const mediaStart = BigInt(item.playlistStart90k) + BigInt(item.sourceStart90k) - BigInt(item.sourceIn90k);
      const marks = (activeLaunch?.session?.externalTargets?.playlists.find((candidate) => candidate.id === target.playlistId)?.marks ?? [])
        .filter((mark) => mark.playItemIndex === item.index && BigInt(mark.sourceTime90k) >= BigInt(item.sourceStart90k) && BigInt(mark.sourceTime90k) < BigInt(item.sourceEnd90k))
        .map((mark) => ({ index: mark.index, offset90k: (BigInt(mark.sourceTime90k) - BigInt(item.sourceStart90k)).toString() }));
      const loopMark = file.loopStartOffset90k === undefined ? undefined : marks.find((mark) => mark.offset90k === file.loopStartOffset90k)?.index;
      items.push({ index: item.index, clipId: item.clipId, source: item.source, start90k: item.sourceStart90k, end90k: item.sourceEnd90k, mediaStart90k: mediaStart.toString(), ...(assetId ? { url: `/api/bdj/menu-media/${assetId}` } : {}), audioUrls, marks, ...(file.missing ? { missing: true as const, warning: file.warning } : {}), ...(file.loopStartOffset90k === undefined ? {} : { loopStartOffset90k: file.loopStartOffset90k }), ...(loopMark === undefined ? {} : { loopMarkIndex: loopMark }) });
    }
    return { playerId, mode: "menu", bdjoId, title, playlistId: target.playlistId, source: target.source, items };
  };
  const server = createServer((request, response) => {
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-cache");
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/bdj/") && request.method === "POST") {
      const expectedHost = `127.0.0.1:${port}`;
      const expectedOrigin = `http://${expectedHost}`;
      if (request.headers.host !== expectedHost || (request.headers.origin !== undefined && request.headers.origin !== expectedOrigin)) {
        response.writeHead(403).end("BD-J session requests require the local package origin."); return;
      }
    }
    if (url.pathname === "/api/bdj/events" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Connection": "keep-alive", "Cache-Control": "no-cache" });
      response.write(`event: session\ndata: ${JSON.stringify({ running: javaSessionReady && javaProcess !== undefined, alive: javaSessionReady && javaProcess?.exitCode === null, starting: javaSessionStarted && !javaSessionReady })}\n\n`);
      if (latestFrame) response.write(`event: frame\ndata: ${JSON.stringify(latestFrame)}\n\n`);
      for (const handoff of latestPlayerHandoffs.values()) response.write(`event: player-handoff\ndata: ${JSON.stringify(handoff)}\n\n`);
      for (const media of menuMediaSessions.values()) response.write(`event: player-menu-media\ndata: ${JSON.stringify(media)}\n\n`);
      eventClients.add(response); request.on("close", () => eventClients.delete(response)); return;
    }
    const menuAssetId = url.pathname.match(/^\/api\/bdj\/menu-media\/([0-9a-f-]+)$/i)?.[1];
    if (menuAssetId && (request.method === "GET" || request.method === "HEAD")) {
      const assetPath = menuMediaFiles.get(menuAssetId);
      if (!assetPath) { response.writeHead(404).end("Menu media item not found."); return; }
      void realpath(assetPath).then(async (filePath) => {
        if (outsidePackage(filePath)) { response.writeHead(403).end("Menu media item is outside the package."); return; }
        const handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
        const info = await handle.stat();
        if (!info.isFile()) { await handle.close(); response.writeHead(404).end("Menu media item not found."); return; }
        const range = parseByteRange(request.headers.range, info.size);
        if (range === null) { await handle.close(); response.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end(); return; }
        const mediaType = contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream";
        if (range) response.writeHead(206, { "Content-Type": mediaType, "Accept-Ranges": "bytes", "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`, "Content-Length": String(range.end - range.start + 1) });
        else response.writeHead(200, { "Content-Type": mediaType, "Accept-Ranges": "bytes", "Content-Length": String(info.size) });
        if (request.method === "HEAD") { await handle.close(); response.end(); return; }
        const stream = handle.createReadStream(range ? { start: range.start, end: range.end } : undefined);
        stream.on("error", () => response.destroy()); stream.pipe(response);
      }).catch(() => { if (!response.headersSent) response.writeHead(404).end("Menu media item not found."); else response.destroy(); });
      return;
    }
    if (url.pathname === "/api/bdj/start" && request.method === "POST") {
      if (javaSessionStarted) {
        if (javaSessionReady) response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ started: true, attached: javaProcess?.exitCode === null }));
        else pendingStartResponses.push(response);
        return;
      }
      javaSessionStarted = true;
      const failStart = (message: string): void => {
        resetBdjSession();
        emit("session-error", { message });
        if (!response.destroyed && !response.headersSent && !response.writableEnded) response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: message }));
        for (const waiter of pendingStartResponses.splice(0)) if (!waiter.destroyed && !waiter.headersSent && !waiter.writableEnded) waiter.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: message }));
      };
      void (async () => {
        let launch: RuntimeLaunch;
        try {
          const parsed: unknown = JSON.parse(await readFile(resolve(root, "runtime/bdj/session.json"), "utf8"));
          if (!isRecord(parsed) || typeof parsed.discId !== "string" || typeof parsed.initialBdjoId !== "string" || !Array.isArray(parsed.applications)) throw new Error("Session data does not match the BD-J launch contract.");
          launch = { ...(parsed as unknown as typeof launch), discId: discIdOverride ?? parsed.discId };
          activeLaunch = launch;
        }
        catch (error) { failStart(`BD-J launch data is unavailable: ${errorText(error)}`); return; }
        try {
        if (launch.session) hdmvVm = new HdmvVm(launch.session.vmPrograms, {
          ...(launch.session.vmEntries ? { entries: launch.session.vmEntries } : {}),
          ...(launch.session.playerProfile ? { profile: launch.session.playerProfile } : {}),
          ...(launch.session.vmLimits ? { limits: launch.session.vmLimits } : {}),
        });
        activeBdjoId = launch.initialBdjoId;
        const initialEntry = launch.session?.vmEntries?.find((item) => item.kind === "firstPlay" && item.target.objectType === "BDJ" && String(item.target.target).replace(/\.bdjo$/i, "").padStart(5, "0") === activeBdjoId)
          ?? launch.session?.vmEntries?.find((item) => item.kind === "topMenu" && item.target.objectType === "BDJ" && String(item.target.target).replace(/\.bdjo$/i, "").padStart(5, "0") === activeBdjoId);
        if (initialEntry) hdmvVm?.selectBdjTitle(initialEntry.kind === "firstPlay" ? 0xffff : 0);
        const hostJar = resolve(root, "runtime/bdj/bdj-host-api.jar");
        const classpath = hostJar;
        const applicationRecord = (app: typeof launch.applications[number]) => {
          const parameters = Buffer.from(app.parameters.join("\n"), "utf8").toString("base64");
          const fields = [app.bdjoId, app.controlCode, app.binding, app.organizationId, app.applicationId, app.initialClass, app.basePath, app.classPath, parameters];
          if (fields.slice(0, 8).some((field) => String(field).includes("|"))) throw new Error(`BD-J application '${app.initialClass}' has a descriptor field containing '|', which the Java host cannot decode.`);
          return Buffer.from(fields.join("|"), "utf8").toString("base64");
        };
        const java = optionValue("--java") ?? "java";
        const args = [`-Dbluray.vfs.root=${resolve(root, "bdj")}`, "-Djava.awt.headless=true", "-cp", classpath,
          "com.bdmv2web.bdj.BdjMain", launch.discId, launch.initialBdjoId, String(launch.applications.length), ...launch.applications.map(applicationRecord)];
        const child = spawn(java, args, { cwd: root, stdio: "pipe", windowsHide: true });
        javaProcess = child;
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        let startupReady = false;
        let resolveStartupReady!: () => void;
        let rejectStartupReady!: (error: Error) => void;
        let startupTimer: ReturnType<typeof setTimeout>;
        const startupReadyPromise = new Promise<void>((resolveReady, rejectReady) => {
          resolveStartupReady = () => { startupReady = true; clearTimeout(startupTimer); resolveReady(); };
          rejectStartupReady = (error) => { clearTimeout(startupTimer); rejectReady(error); };
          startupTimer = setTimeout(() => {
            rejectStartupReady(new Error("BD-J Java host did not complete startup within 30 seconds."));
            if (javaProcess === child && child.exitCode === null) child.kill();
          }, 30_000);
        });
        let stdout = "";
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          const lines = stdout.split(/\r?\n/); stdout = lines.pop() ?? "";
          for (const line of lines) {
            if (line === "BDMV_READY") resolveStartupReady();
            else if (line.startsWith("BDMV_FRAME\t")) { latestFrame = { sequence: ++frameSequence, data: line.slice(11) }; emit("frame", latestFrame); }
            else if (line.startsWith("BDMV_TRACE\t")) {
              const trace = decodeTrace(line);
              process.stdout.write(`[BD-J] ${trace}\n`);
              emit("trace", { line: trace });
            }
            else if (line.startsWith("BDMV_RPC\t")) {
              const [, id, operation, payload = ""] = line.split("\t");
              const fields = Buffer.from(payload, "base64").toString("utf8").split("\u001f");
              let result: string;
              void (async () => {
              if (javaProcess !== child) return;
              try {
                if (operation === "discId") result = launch.discId;
                else if (operation === "xletEvent") { emit("xlet-event", { name: fields[0] ?? "", value: fields[1] ?? "", bdjoId: activeBdjoId }); result = "ok"; }
                else if (operation === "readGPR") result = String(hdmvVm?.registers.read({ kind: "gpr", index: Number(fields[0]) }) ?? 0);
                else if (operation === "readPSR") result = String(hdmvVm?.registers.read({ kind: "psr", index: Number(fields[0]) }) ?? 0);
                else if (operation === "writeGPR") { hdmvVm?.registers.write({ kind: "gpr", index: Number(fields[0]) }, Number(fields[1]) >>> 0); result = "ok"; }
                else if (operation === "writePSR") { hdmvVm?.registers.systemWrite(Number(fields[0]), Number(fields[1]) >>> 0); result = "ok"; }
                else if (operation === "selectTitle") {
                  const title = Number(fields[0]);
                  const entry = entryForTitle(launch, title);
                  if (!entry) throw new Error(`Title ${title} has no INDEX entry.`);
                  if (entry.target.objectType === "BDJ" && typeof entry.target.target === "string") {
                    activeTitle = title; userFeatureTitleSelected = false; pendingUserSelection = false;
                    hdmvVm?.selectBdjTitle(title); hdmvMode = false; emit("hdmv-mode", { active: false }); activeBdjoId = entry.target.target.replace(/\.bdjo$/i, "").padStart(5, "0");
                    const restart = fields[1] === "true";
                    const message = Buffer.from(`${title}|start|${restart}`, "utf8").toString("base64");
                    javaProcess?.stdin.write(`BDMV_EVENT\ttitle\t${activeBdjoId}\t${message}\n`); result = "requested";
                  } else if (entry.target.objectType === "HDMV") {
                    activeTitle = title; userFeatureTitleSelected = pendingUserSelection; pendingUserSelection = false;
                    hdmvMode = true; emit("hdmv-mode", { active: true });
                    const snapshot = hdmvVm?.selectTitle(title); const actions = hdmvVm?.drainActions() ?? [];
                    emit("navigation", { title, status: snapshot?.status, programId: snapshot?.programId, pc: snapshot?.pc, gpr: snapshot?.registers.gpr, psr: snapshot?.registers.psr, actions });
                    if (actions.length) emit("hdmv-actions", { actions, origin: "authored" });
                    const message = Buffer.from(`${title}|stop`, "utf8").toString("base64");
                    javaProcess?.stdin.write(`BDMV_EVENT\ttitle\t${activeBdjoId}\t${message}\n`); result = "requested";
                  } else throw new Error(`Title ${title} target is unavailable.`);
                }
                else if (operation === "topMenu") {
                  const activeDescriptor = launch.session?.bdjoDescriptors?.find((item) => bdjoIdFromPath(item.path) === activeBdjoId);
                  if (activeDescriptor?.terminalInfo.menuCallMask) throw new Error(`BDJO ${activeBdjoId} masks user menu-call requests.`);
                  const topMenu = launch.session?.vmEntries?.find((item) => item.kind === "topMenu");
                  if (!topMenu) throw new Error("The INDEX has no Top Menu entry.");
                  const target = topMenu.target;
                  if (target.objectType === "BDJ" && typeof target.target === "string") {
                    activeTitle = 0; userFeatureTitleSelected = false; pendingUserSelection = false;
                    hdmvMode = false; emit("hdmv-mode", { active: false });
                    const bdjoId = target.target.replace(/\.bdjo$/i, "").padStart(5, "0");
                    hdmvVm?.selectBdjTitle(0);
                    activeBdjoId = bdjoId;
                    javaProcess?.stdin.write(`BDMV_EVENT\ttitle\t${bdjoId}\t${Buffer.from("0|start", "utf8").toString("base64")}\n`);
                    emit("navigation", { type: "title", title: 0, target });
                    result = "requested";
                  } else if (target.objectType === "HDMV" && typeof target.target === "number") {
                    activeTitle = 0; userFeatureTitleSelected = false; pendingUserSelection = false;
                    hdmvMode = true; emit("hdmv-mode", { active: true });
                    const snapshot = hdmvVm?.selectTitle(0);
                    const actions = hdmvVm?.drainActions() ?? [];
                    emit("navigation", { type: "title", title: 0, target, status: snapshot?.status, programId: snapshot?.programId, pc: snapshot?.pc, gpr: snapshot?.registers.gpr, psr: snapshot?.registers.psr, actions });
                    if (actions.length) emit("hdmv-actions", { actions, origin: "authored" });
                    javaProcess?.stdin.write(`BDMV_EVENT\ttitle\t${activeBdjoId}\t${Buffer.from("0|stop", "utf8").toString("base64")}\n`);
                    result = "requested";
                  } else throw new Error("The INDEX Top Menu target is unavailable.");
                }
                else if (operation === "playerPlaylist") {
                  const [playerId = "", rawPlaylist = ""] = fields;
                  const playlist = Number(rawPlaylist);
                  if (!Number.isSafeInteger(playlist) || playlist < 0) throw new Error("Playlist number must be a non-negative integer.");
                  const descriptor = launch.session?.bdjoDescriptors?.find((item) => bdjoIdFromPath(item.path) === activeBdjoId);
                  if (!descriptor || (!descriptor.accessiblePlaylists.accessToAll && !descriptor.accessiblePlaylists.playlistIds.some((id) => Number(id) === playlist))) throw new Error(`BDJO ${activeBdjoId} cannot access playlist ${String(playlist).padStart(5, "0")}.`);
                  playerPlaylists.set(playerId, playlist); result = "selected";
                }
                else if (operation === "playerStart") {
                  const playerId = fields[0] ?? "";
                  const ownerId = fields[1] ?? "";
                  activePlayerTokens.add(playerId);
                  if (fields[2] === "playlist") {
                    const playlist = playerPlaylists.get(ownerId) ?? Number(fields[3]);
                    const request: ExternalPlayRequest = { type: "PLAY_PLAYLIST", playlist };
                    const isMenuPlayback = !userFeatureTitleSelected && !pendingUserSelection;
                    const target = launch.session?.externalTargets ? resolveExternalPlayTarget(launch.session.externalTargets, request, { allowMissing: isMenuPlayback }) : { status: "unavailable" as const, code: "EXTERNAL_TARGETS_UNAVAILABLE", message: "The package has no external-play target map." };
                    const bdmvRoot = launch.session?.bdmvPath ? resolve(root, launch.session.bdmvPath) : resolve(root, "BDMV");
                    if (userFeatureTitleSelected || pendingUserSelection) {
                      userFeatureTitleSelected = false; pendingUserSelection = false;
                      const executable = optionValue("--player-executable");
                      const plan = buildExternalPlayerLaunch(target, { bdmvRoot, adapter: (optionValue("--player") ?? "system") as "system", ...(executable ? { executable } : {}) });
                      const handoff = await launchExternalPlayer(plan);
                      if (javaProcess !== child) return;
                      const event = { playerId, playlist, ...handoff };
                      latestPlayerHandoffs.set(playerId, event);
                      emit("player-handoff", event);
                      activePlayerTokens.delete(playerId);
                      result = handoff.status === "requested" ? "requested" : `unavailable: ${handoff.message}`;
                    } else if (target.status === "unavailable") {
                      emit("menu-media-error", { playerId, playlist, status: target.status, code: target.code, message: target.message, source: target.source });
                      result = `unavailable: ${target.message}`;
                    } else {
                      const targetItems = [target.item, ...target.remainingItems];
                      const menuTarget: MenuMediaTarget = {
                        playlistId: target.playlistId,
                        source: target.item.source,
                        items: targetItems.map((item, index) => ({
                          index: item.index, clipId: item.clipId, streamPath: item.streamPath, present: item.present,
                          sourceOrigin90k: item.sourceOrigin90k,
                          sourceStart90k: index === 0 ? target.clipTime90k : item.sourceIn90k,
                          sourceEnd90k: item.sourceOut90k,
                          playlistStart90k: item.playlistStart90k,
                          sourceIn90k: item.sourceIn90k,
                          source: item.source,
                        })),
                      };
                      result = "pending";
                      pendingMenuPlayers.add(playerId);
                      void prepareMenuPlaylist(menuTarget, playerId, bdmvRoot, activeBdjoId, activeTitle).then((event) => {
                        if (!pendingMenuPlayers.delete(playerId)) { emit("player-media-cancelled", { playerId, playlist, source: target.item.source }); return; }
                        menuMediaSessions.set(playerId, event);
                        emit("player-menu-media", event);
                      }).catch((error: unknown) => {
                        if (!pendingMenuPlayers.delete(playerId)) { emit("player-media-cancelled", { playerId, playlist, source: target.item.source }); return; }
                        const message = errorText(error);
                        emit("menu-media-error", { playerId, playlist, status: "unavailable", code: "BDJ_MENU_MEDIA_UNAVAILABLE", message, source: target.item.source });
                        javaProcess?.stdin.write(`BDMV_EVENT\tplayer\t${playerId}\t${Buffer.from("error", "utf8").toString("base64")}\n`);
                      });
                    }
                  } else if (fields[2] === "resource") {
                    const resource = fields[3] ?? "";
                    const match = resource.match(/(?:^|\/)BDMV\/JAR\/([^?#]+)/i);
                    const relativePath = match?.[1]?.replaceAll("\\", "/");
                    const packaged = relativePath && launch.applications.some((app) => [app.basePath, ...app.classPath.split(/[;:]/).filter(Boolean)].some((basePath) => {
                      const normalized = basePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\.jar$/i, "");
                      return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
                    }));
                    if (!relativePath || !packaged || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
                      const source = launch.session?.bdjoDescriptors?.find((item) => bdjoIdFromPath(item.path) === activeBdjoId)?.path ?? activeBdjoId;
                      const event = { playerId, status: "unavailable", code: "BDJ_RESOURCE_UNAVAILABLE", message: `BD-J media resource '${resource}' is not packaged.`, source };
                      latestPlayerHandoffs.set(playerId, event);
                      emit("player-handoff", event);
                      result = "unavailable";
                    } else {
                      browserMediaPlayers.add(playerId);
                      emit("player-resource", { playerId, path: `bdj/BDMV/JAR/${relativePath}` });
                      result = "pending";
                    }
                  } else result = "unavailable";
                }
                else if (operation === "playerStop") {
                  const playerId = fields[0] ?? "";
                  if (pendingMenuPlayers.delete(playerId)) { activePlayerTokens.delete(playerId); emit("player-cancelled", { playerId, status: "stopped" }); result = "stopped"; }
                  else if (browserMediaPlayers.delete(playerId) || menuMediaSessions.has(playerId)) { emit("player-stop", { playerId }); result = "pending"; }
                  else result = "unavailable: This player has no browser-owned media resource to stop.";
                }
                else if (["playerNavigate", "playerStream", "playerGain"].includes(operation ?? "")) result = `unavailable: BD-J player operation '${operation ?? ""}' has no confirmed adapter capability.`;
                else result = `ERROR: Unsupported local service operation '${operation}'.`;
              } catch (error) { result = `ERROR: ${errorText(error)}`; }
              if (javaProcess !== child) return;
              if (operation === "playerStart" && (result.startsWith("ERROR: ") || result.startsWith("unavailable:"))) activePlayerTokens.delete(fields[0] ?? "");
              if (operation === "playerStop" && result.startsWith("unavailable:")) activePlayerTokens.delete(fields[0] ?? "");
              child.stdin.write(`BDMV_RES\t${id}\t${Buffer.from(result, "utf8").toString("base64")}\n`);
              emit("rpc", { operation, status: result.startsWith("ERROR: ") ? "unsupported" : "ok" });
              })();
            } else if (line.trim()) emit("diagnostic", { message: line });
          }
        });
        child.stderr.on("data", (chunk: string) => {
          process.stderr.write(`[BD-J stderr] ${chunk}`);
          emit("diagnostic", { error: true, message: chunk.trim() });
        });
        child.once("error", (error) => {
          if (javaProcess !== child) return;
          if (startupReady) failStart(`Java session '${java}' reported an error: ${error.message}`);
          else rejectStartupReady(new Error(`Could not start Java executable '${java}': ${error.message}`));
        });
        child.once("exit", (code, signal) => {
          if (javaProcess !== child) return;
          if (!startupReady) {
            emit("session-exit", { code, signal });
            rejectStartupReady(new Error(`BD-J Java process exited before startup completed (code ${String(code)}, signal ${String(signal)}).`));
            return;
          }
          resetBdjSession();
          emit("session-exit", { code, signal });
          if (!stopping) emit("session-error", { message: `BD-J Java process exited (code ${String(code)}, signal ${String(signal)}). Restart the BD-J session to continue.` });
          if (child.exitCode === null) child.kill();
        });
        await startupReadyPromise;
        javaSessionReady = true;
        if (!response.destroyed && !response.headersSent && !response.writableEnded) response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ started: true, attached: false, pid: child.pid ?? null }));
        for (const waiter of pendingStartResponses.splice(0)) if (!waiter.destroyed && !waiter.headersSent && !waiter.writableEnded) waiter.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ started: true, attached: true, pid: child.pid ?? null }));
        } catch (error) {
          if (!response.writableEnded) failStart(`Could not start the BD-J Java session: ${errorText(error)}`);
        }
      })().catch((error: unknown) => {
        if (!response.writableEnded) failStart(`Could not start the BD-J Java session: ${errorText(error)}`);
      });
      return;
    }
    if (url.pathname === "/api/bdj/input" && request.method === "POST") {
      const hostProcess = javaProcess;
      if (!hostProcess || hostProcess.exitCode !== null) { response.writeHead(409).end("BD-J session is not running."); return; }
      let body = ""; request.setEncoding("utf8"); request.on("data", (part: string) => { body += part; });
      request.on("end", () => {
        try {
          if (javaProcess !== hostProcess || hostProcess.exitCode !== null) { response.writeHead(409).end("BD-J session changed while reading input."); return; }
          const input = JSON.parse(body) as { kind: "key" | "pointer"; keyCode?: number; modifiers?: number; x?: number; y?: number; type?: "pressed" | "released" };
          if (input.kind === "key" && (!Number.isInteger(input.keyCode) || !Number.isInteger(input.modifiers ?? 0) || ![undefined, "pressed", "released"].includes(input.type))) throw new Error("Invalid key event.");
          if (input.kind === "pointer" && (!Number.isFinite(input.x) || !Number.isFinite(input.y))) throw new Error("Invalid pointer event.");
          if (input.kind !== "key" && input.kind !== "pointer") throw new Error("Unsupported input event.");
          if (input.kind === "pointer" || (input.type !== "released" && [10, 13, 32].includes(input.keyCode ?? 0))) pendingUserSelection = true;
      const value = input.kind === "pointer" ? `${input.x ?? 0}|${input.y ?? 0}` : `${input.keyCode ?? 0}|${input.modifiers ?? 0}|${input.type === "released" ? 402 : 401}`;
          const encoded = Buffer.from(value, "utf8").toString("base64");
          hostProcess.stdin.write(`BDMV_EVENT\t${input.kind === "key" ? "input" : "pointer"}\t\t${encoded}\n`);
          response.writeHead(204).end();
        } catch { response.writeHead(400).end("Invalid input request."); }
      }); return;
    }
    if (url.pathname === "/api/bdj/hdmv" && request.method === "POST") {
      const hostProcess = javaProcess; const sessionVm = hdmvVm;
      if (!hostProcess || hostProcess.exitCode !== null || !sessionVm || !hdmvMode) { response.writeHead(409).end("The BD-J session is not in HDMV mode."); return; }
      let body = ""; request.setEncoding("utf8"); request.on("data", (part: string) => { body += part; });
      request.on("end", () => {
        try {
          if (javaProcess !== hostProcess || hostProcess.exitCode !== null || hdmvVm !== sessionVm || !hdmvMode) { response.writeHead(409).end("BD-J session changed while reading HDMV input."); return; }
          const input: unknown = JSON.parse(body);
          if (!isRecord(input) || typeof input.kind !== "string") throw new Error("Invalid HDMV request.");
          if (input.kind === "context") {
            const pageId = input.pageId;
            const selectedButtonId = input.selectedButtonId;
            if (typeof pageId !== "number" || !Number.isSafeInteger(pageId) || typeof selectedButtonId !== "number" && selectedButtonId !== null) throw new Error("Invalid menu context.");
            sessionVm.applyMenuContext(pageId, selectedButtonId);
          } else if (input.kind === "event") {
            if (!isRecord(input.event) || !["MENU_INPUT", "TOP_MENU", "POPUP_MENU", "RETURN"].includes(String(input.event.type))) throw new Error("Invalid HDMV event.");
            sessionVm.beginMenuAction(); sessionVm.handleEvent(input.event as unknown as Parameters<HdmvVm["handleEvent"]>[0]);
          } else if (input.kind === "button") {
            const commands = input.commands;
            if (!Array.isArray(commands) || commands.length > 256 || !commands.every(isRawCommand)) throw new Error("Invalid HDMV button program.");
            sessionVm.beginMenuAction(); sessionVm.executeButtonProgram(commands, "ig_object");
          } else throw new Error("Unsupported HDMV request.");
          const actions = sessionVm.drainActions();
          emit("hdmv-state", { snapshot: sessionVm.snapshot() });
          if (actions.length) emit("hdmv-actions", { actions, origin: "authored" });
          response.writeHead(204).end();
        } catch { response.writeHead(400).end("Invalid HDMV request."); }
      }); return;
    }
    if (url.pathname === "/api/bdj/title" && request.method === "POST") {
      const sessionVm = hdmvVm; const launch = activeLaunch; const hostProcess = javaProcess;
      if (!hostProcess || hostProcess.exitCode !== null || !sessionVm || !launch) { response.writeHead(409).end("BD-J session is not running."); return; }
      let body = ""; request.setEncoding("utf8"); request.on("data", (part: string) => { body += part; });
      request.on("end", () => {
        try {
          if (javaProcess !== hostProcess || hostProcess.exitCode !== null || hdmvVm !== sessionVm || activeLaunch !== launch) { response.writeHead(409).end("BD-J session changed while reading the title request."); return; }
          const input: unknown = JSON.parse(body);
          if (!isRecord(input) || !Number.isSafeInteger(input.title) || (input.title as number) < 0 || (input.title as number) > 0xffff) throw new Error("Invalid title number.");
          const title = input.title as number;
          const origin = input.origin === undefined ? "user" : input.origin;
          if (origin !== "user" && origin !== "startup" && origin !== "system" && origin !== "authored") throw new Error("Invalid title request origin.");
          const activeDescriptor = launch.session?.bdjoDescriptors?.find((item) => bdjoIdFromPath(item.path) === activeBdjoId);
          if (origin === "user" && title === 0 && activeDescriptor?.terminalInfo.menuCallMask) throw new Error(`BDJO ${activeBdjoId} masks user menu-call requests.`);
          if (origin === "user" && title > 0 && title < 0xffff && activeDescriptor?.terminalInfo.titleSearchMask) throw new Error(`BDJO ${activeBdjoId} masks user title-search requests.`);
          const entry = entryForTitle(launch, title);
          if (!entry) throw new Error(`Title ${title} has no INDEX entry.`);
          activeTitle = title;
          userFeatureTitleSelected = origin === "user" && entry.target.objectType === "HDMV";
          if (origin === "user") pendingUserSelection = false;
          if (entry.target.objectType === "BDJ" && typeof entry.target.target === "string") {
            userFeatureTitleSelected = false;
            hdmvMode = false; emit("hdmv-mode", { active: false });
            sessionVm.selectBdjTitle(title); activeBdjoId = entry.target.target.replace(/\.bdjo$/i, "").padStart(5, "0");
            hostProcess.stdin.write(`BDMV_EVENT\ttitle\t${activeBdjoId}\t${Buffer.from(`${title}|start`, "utf8").toString("base64")}\n`);
          } else if (entry.target.objectType === "HDMV") {
            hdmvMode = true; emit("hdmv-mode", { active: true });
            const snapshot = sessionVm.selectTitle(title); const actions = sessionVm.drainActions();
            emit("navigation", { title, status: snapshot.status, programId: snapshot.programId, pc: snapshot.pc, gpr: snapshot.registers.gpr, psr: snapshot.registers.psr, actions });
            if (actions.length) emit("hdmv-actions", { actions, origin: origin === "startup" ? "system" : origin });
            hostProcess.stdin.write(`BDMV_EVENT\ttitle\t${activeBdjoId}\t${Buffer.from(`${title}|stop`, "utf8").toString("base64")}\n`);
          } else throw new Error(`Title ${title} target is unavailable.`);
          response.writeHead(204).end();
        } catch (error) { response.writeHead(400).end(errorText(error)); }
      }); return;
    }
    if (url.pathname === "/api/bdj/media-event" && request.method === "POST") {
      const hostProcess = javaProcess;
      if (!hostProcess || hostProcess.exitCode !== null) { response.writeHead(409).end("BD-J session is not running."); return; }
      let body = ""; request.setEncoding("utf8"); request.on("data", (part: string) => { body += part; });
      request.on("end", () => {
        try {
          if (javaProcess !== hostProcess || hostProcess.exitCode !== null) { response.writeHead(409).end("BD-J session changed while reading the media event."); return; }
          const observation = JSON.parse(body) as { playerId?: string; event?: string };
          const missingEnded = /^missing-ended\|\d+\|[^|\r\n]+$/.test(observation.event ?? "");
          if (!observation.playerId || !( ["started", "presented", "ended", "error", "blocked", "stopped"].includes(observation.event ?? "")
            || /^position\|\d+\|\d+\|(?:\d+)?$/.test(observation.event ?? "")
            || missingEnded )) throw new Error("Invalid player observation.");
          process.stdout.write(`[BD-J media] ${observation.playerId} ${observation.event}\n`);
          if (!activePlayerTokens.has(observation.playerId)) { response.writeHead(409).end("The player request is no longer active."); return; }
          const terminal = observation.event === "ended" || missingEnded;
          if (terminal || ["error", "blocked", "stopped"].includes(observation.event!)) browserMediaPlayers.delete(observation.playerId);
          if (terminal || ["error", "stopped"].includes(observation.event!)) menuMediaSessions.delete(observation.playerId);
          const encoded = Buffer.from(observation.event!, "utf8").toString("base64");
          hostProcess.stdin.write(`BDMV_EVENT\tplayer\t${observation.playerId}\t${encoded}\n`);
          if (terminal || ["error", "stopped"].includes(observation.event!)) activePlayerTokens.delete(observation.playerId);
          emit("player-observation", observation);
          response.writeHead(204).end();
        } catch { response.writeHead(400).end("Invalid player observation."); }
      }); return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { Allow: "GET, HEAD, POST" }).end(); return; }
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { response.writeHead(400).end("Invalid URL path."); return; }
    const requestedPath = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (outsidePackage(requestedPath)) { response.writeHead(403).end("Path is outside the package."); return; }
    void realpath(requestedPath).then(async (target) => {
      if (outsidePackage(target)) { response.writeHead(403).end("Path is outside the package."); return; }
      const handle = await open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile()) { await handle.close(); response.writeHead(404).end("File not found."); return; }
      response.setHeader("Content-Type", contentTypes[extname(target).toLowerCase()] ?? "application/octet-stream");
      response.setHeader("Content-Length", String(info.size));
      response.writeHead(200);
      if (request.method === "HEAD") { await handle.close(); response.end(); return; }
      const stream = handle.createReadStream();
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    }).catch(() => { if (!response.headersSent) response.writeHead(404).end("File not found."); else response.destroy(); });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolveListen(); });
  }).catch((error: unknown) => fail("CLI_SERVE_FAILED", `Could not start local package server: ${errorText(error)}`));
  process.stdout.write(`Serving ${root}\nOpen http://127.0.0.1:${String(port)}/\nPress Ctrl-C to stop.\n`);
  const stop = () => {
    stopping = true;
    if (javaProcess && javaProcess.exitCode === null) {
      javaProcess.stdin.write(`BDMV_EVENT\tshutdown\t\t${Buffer.from("", "utf8").toString("base64")}\n`);
      const child = javaProcess;
      const killer = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1500);
      child.once("exit", () => clearTimeout(killer));
    }
    for (const client of eventClients) client.end(); eventClients.clear(); server.close();
  };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  await new Promise<void>((resolveClose) => server.once("close", resolveClose));
}

function entryForTitle(launch: RuntimeLaunch, title: number): NonNullable<VmOptions["entries"]>[number] | undefined {
  const entries = launch.session?.vmEntries;
  return title === 0 ? entries?.find((item) => item.kind === "topMenu") : title === 0xffff ? entries?.find((item) => item.kind === "firstPlay") : entries?.filter((item) => item.kind === "title")[title - 1];
}

function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (header === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(requestedEnd)) return null;
  const end = Math.min(requestedEnd, size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return null;
  return { start, end };
}
function bdjoIdFromPath(path: string): string | undefined { return path.replaceAll("\\", "/").match(/(?:^|\/)BDJO\/(\d{5})\.bdjo$/i)?.[1]; }
function decodeTrace(line: string): string {
  const fields = line.slice("BDMV_TRACE\t".length).split("\t");
  if (fields.length !== 4) return line;
  return fields.map((field) => Buffer.from(field, "base64").toString("utf8")).join("\t");
}
function isRawCommand(value: unknown): value is Parameters<HdmvVm["executeButtonProgram"]>[0][number] {
  if (!isRecord(value) || typeof value.bytes !== "string" || !Array.isArray(value.words) || value.words.length !== 3 || !value.words.every(Number.isSafeInteger) || !isRecord(value.source)) return false;
  return typeof value.source.path === "string" && (value.source.origin === "primary" || value.source.origin === "backup") && typeof value.source.offset === "string";
}
