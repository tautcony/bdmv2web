import type { NavigationAction, VmOptions } from "@bdmv2web/hdmv";

export interface BdjApplicationRecord {
  organizationId: number;
  applicationId: number;
  controlCode: number;
  binding: number;
  basePath: string;
  classPath: string;
  initialClass: string;
  parameters: string[];
}

interface BdjDescriptor { path: string; applications: BdjApplicationRecord[]; accessiblePlaylists: { accessToAll: boolean; playlistIds: string[] }; terminalInfo: { menuCallMask: boolean; titleSearchMask: boolean } }
interface BdjFile { path: string; packagePath: string }
export interface BdjPackageData { ir: unknown; vmEntries?: NonNullable<VmOptions["entries"]>; bdjRuntime?: boolean; bdjFiles?: BdjFile[]; bdjHostApiPath?: string }
export interface BdjMenuMediaItem { index: number; clipId: string; source: { path: string; offset?: string }; start90k: string; end90k: string; mediaStart90k?: string; url?: string; missing?: true; warning?: string; audioUrls?: string[]; loopStartOffset90k?: string; loopMarkIndex?: number; marks?: Array<{ index: number; offset90k: string }> }
export interface BdjMenuMediaEvent { playerId: string; mode: "menu"; bdjoId: string; title: number; playlistId: string; source: { path: string; offset?: string }; items: BdjMenuMediaItem[] }
export interface BdjRuntimeCallbacks { report: (message: string, error?: boolean) => void; trace: (message: string) => void; frameReady?: () => void; playerHandoff?: (result: { status: string; message?: string; source?: { path: string; offset?: string } }) => void; playerResource?: (playerId: string, path: string) => void; playerMenuMedia?: (event: BdjMenuMediaEvent) => void; menuMediaUnavailable?: (result: { playerId: string; playlist?: number; message: string; source?: { path: string; offset?: string } }) => void; retryMenuMedia?: () => void; playerStop?: (playerId: string) => void; hdmvMode?: (active: boolean) => void; hdmvActions?: (actions: NavigationAction[], origin?: "user" | "startup" | "system" | "authored") => void }

export interface BdjRuntimeHandle {
  sendInput(keyCode: number, modifiers?: number, pressed?: boolean): void;
  sendPointer(x: number, y: number): void;
  sendTitle(title: number, started: boolean, bdjoId?: string, origin?: "user" | "startup" | "system" | "authored"): void;
  sendHdmv(request: unknown): void;
  sendPlayerEvent(playerId: string, event: "started" | "presented" | "ended" | "error" | "blocked" | "stopped" | `missing-ended|${number}|${string}` | `position|${string}|${number}|${string}`): void;
  retryBlockedMedia(): void;
  close(): void;
}

const ENTRY_KIND_ORDER: ReadonlyArray<NonNullable<VmOptions["entries"]>[number]["kind"]> = ["firstPlay", "topMenu"];

/** Connect the page to the native Java session managed by `bdmv2web serve`. */
export function startBdjRuntime(data: BdjPackageData, root: HTMLElement, callbacks: BdjRuntimeCallbacks, requestedBdjoId?: string): BdjRuntimeHandle {
  if (location.protocol !== "http:" && location.protocol !== "https:") throw new Error("BD-J execution requires `bdmv2web serve <package-directory>` and a local HTTP URL. Java runs as a local process.");
  const ir = record(data.ir, "DiscIR");
  const bdjos = arrayOf<BdjDescriptor>(ir["bdjos"], "DiscIR.bdjos");
  const entries = data.vmEntries ?? [];
  const entry = requestedBdjoId === undefined
    ? ENTRY_KIND_ORDER.map((kind) => entries.find((candidate) => candidate.kind === kind && candidate.target.objectType === "BDJ")).find((candidate) => candidate !== undefined)
    : undefined;
  const target = requestedBdjoId ?? (entry && typeof entry.target.target === "string" ? entry.target.target : undefined);
  if (target === undefined) throw new Error("Disc index has no First Play or Top Menu BD-J entry.");
  const bdjoId = target.replace(/\.bdjo$/i, "");
  if (!/^\d{5}$/.test(bdjoId)) throw new Error(`BD-J entry has invalid BDJO identifier '${target}'.`);
  const reachableBdjoIds = new Set(entries.flatMap((candidate) => {
    const value = candidate.target.target;
    return candidate.target.objectType === "BDJ" && typeof value === "string" ? [value.replace(/\.bdjo$/i, "").padStart(5, "0")] : [];
  }));
  reachableBdjoIds.add(bdjoId);
  const selectedBdjos = bdjos.filter((candidate) => {
    const id = candidate.path.match(/(?:^|\/)BDJO\/(\d{5})\.bdjo$/i)?.[1];
    return id !== undefined && reachableBdjoIds.has(id);
  });
  const bdjo = selectedBdjos.find((candidate) => candidate.path.replaceAll("\\", "/").toLocaleLowerCase("en-US").endsWith(`bdjo/${bdjoId}.bdjo`));
  if (!bdjo) throw new Error(`BDJO ${bdjoId} was not packaged from the input disc.`);
  const packagedFiles = data.bdjFiles ?? [];
  const packageFiles = new Map(packagedFiles.map((file) => [file.path.toLocaleLowerCase("en-US"), file]));
  const appJars = new Set<string>();
  for (const descriptor of selectedBdjos) {
    for (const application of descriptor.applications) {
      const jarPath = applicationJarPath(application.basePath);
      if (!jarPath || !packageFiles.has(jarPath.toLocaleLowerCase("en-US"))) throw new Error(`BDJO ${descriptor.path} application ${application.applicationId} JAR '${application.basePath}' is not packaged.`);
      appJars.add(jarPath);
      for (const item of application.classPath.split(/[;:]/).map((value) => value.trim()).filter(Boolean)) {
        const classPath = applicationJarPath(item);
        if (!classPath || !packageFiles.has(classPath.toLocaleLowerCase("en-US"))) throw new Error(`BDJO ${descriptor.path} application ${application.applicationId} class path '${item}' is not packaged.`);
        appJars.add(classPath);
      }
    }
  }
  let closed = false;
  let frameSequence = 0;
  let firstFrameReady = false;
  const eventSource = new EventSource("/api/bdj/events");
  eventSource.addEventListener("frame", (event) => {
    if (closed) return;
    const frame = JSON.parse((event as MessageEvent<string>).data) as { sequence: number; data: string };
    if (frame.sequence <= frameSequence) return;
    frameSequence = frame.sequence;
    let canvas = root.querySelector("canvas");
    if (!canvas) { canvas = document.createElement("canvas"); canvas.setAttribute("aria-label", "BD-J menu scene"); root.appendChild(canvas); }
    const context = canvas.getContext("2d"); if (!context) return;
    const image = new Image();
    image.onload = () => { if (frame.sequence !== frameSequence) return; canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0); if (!firstFrameReady) { firstFrameReady = true; callbacks.frameReady?.(); } };
    image.src = `data:image/png;base64,${frame.data}`;
  });
  eventSource.addEventListener("trace", (event) => callbacks.trace((JSON.parse((event as MessageEvent<string>).data) as { line: string }).line));
  eventSource.addEventListener("diagnostic", (event) => { const item = JSON.parse((event as MessageEvent<string>).data) as { message: string; error?: boolean }; callbacks.report(item.message, item.error); });
  eventSource.addEventListener("session-error", (event) => callbacks.report((JSON.parse((event as MessageEvent<string>).data) as { message: string }).message, true));
  eventSource.addEventListener("player-resource", (event) => { const item = JSON.parse((event as MessageEvent<string>).data) as { playerId: string; path: string }; callbacks.playerResource?.(item.playerId, item.path); });
  eventSource.addEventListener("player-menu-media", (event) => callbacks.playerMenuMedia?.(JSON.parse((event as MessageEvent<string>).data) as BdjMenuMediaEvent));
  eventSource.addEventListener("menu-media-error", (event) => callbacks.menuMediaUnavailable?.(JSON.parse((event as MessageEvent<string>).data) as { playerId: string; playlist?: number; message: string; source?: { path: string; offset?: string } }));
  eventSource.addEventListener("player-handoff", (event) => callbacks.playerHandoff?.(JSON.parse((event as MessageEvent<string>).data) as { status: string; message?: string; source?: { path: string; offset?: string } }));
  eventSource.addEventListener("player-stop", (event) => callbacks.playerStop?.((JSON.parse((event as MessageEvent<string>).data) as { playerId: string }).playerId));
  eventSource.addEventListener("hdmv-mode", (event) => callbacks.hdmvMode?.((JSON.parse((event as MessageEvent<string>).data) as { active: boolean }).active));
  eventSource.addEventListener("hdmv-actions", (event) => { const item = JSON.parse((event as MessageEvent<string>).data) as { actions: NavigationAction[]; origin?: "user" | "startup" | "system" | "authored" }; callbacks.hdmvActions?.(item.actions, item.origin); });
  const sessionStarted = fetch("/api/bdj/start", { method: "POST" }).then(async (response) => {
    if (!response.ok) throw new Error((await response.text()) || `Local BD-J service returned HTTP ${response.status}.`);
    const session: unknown = await response.json();
    return typeof session === "object" && session !== null && "attached" in session && session.attached === true;
  }).catch((error: unknown) => { callbacks.report(`Could not start local BD-J session: ${error instanceof Error ? error.message : String(error)}`, true); throw error; });
  const post = (operation: () => Promise<Response>, label: string) => {
    if (closed) return;
    void sessionStarted.then(operation)
      .then(async (response) => { if (!response.ok) throw new Error((await response.text()) || `Local BD-J service returned HTTP ${response.status}.`); })
      .catch((error: unknown) => { if (!closed) callbacks.report(`${label}: ${error instanceof Error ? error.message : String(error)}`, true); });
  };
  const sendInput = (body: unknown) => post(() => fetch("/api/bdj/input", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), "Local BD-J input failed");
  return {
    sendInput: (keyCode, modifiers = 0, pressed = true) => sendInput({ kind: "key", keyCode, modifiers, type: pressed ? "pressed" : "released" }),
    sendPointer: (x, y) => sendInput({ kind: "pointer", x: Math.round(x), y: Math.round(y) }),
    sendTitle: (title, started, bdjoId = "", origin = "user") => {
      if (started && origin === "startup") {
        void sessionStarted.then((attached) => attached || closed ? undefined : fetch("/api/bdj/title", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, origin }) }))
          .then(async (response) => { if (response && !response.ok) throw new Error((await response.text()) || `Local BD-J service returned HTTP ${response.status}.`); })
          .catch((error: unknown) => { if (!closed) callbacks.report(`Local BD-J title routing failed: ${error instanceof Error ? error.message : String(error)}`, true); });
        return;
      }
      post(() => fetch("/api/bdj/title", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, started, bdjoId, origin }) }), "Local BD-J title routing failed");
    },
    sendHdmv: (request) => post(() => fetch("/api/bdj/hdmv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }), "Local HDMV request failed"),
    sendPlayerEvent: (playerId, event) => {
      post(() => fetch("/api/bdj/media-event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId, event }) }), "Local BD-J media event failed");
    },
    retryBlockedMedia: () => callbacks.retryMenuMedia?.(),
    close: () => { closed = true; eventSource.close(); },
  };
}

export function installBdjKeyboardInput(target: Window, runtime: BdjRuntimeHandle): () => void {
  const held = new Set<number>();
  const keyCodes: Record<string, number> = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 10, Escape: 27, Backspace: 8, Space: 32 };
  const onDown = (event: KeyboardEvent) => {
    const keyCode = keyCodes[event.code] ?? keyCodes[event.key];
    if (keyCode === undefined) return;
    event.preventDefault(); event.stopImmediatePropagation(); runtime.retryBlockedMedia(); runtime.sendInput(keyCode, event.shiftKey ? 1 : 0, true); held.add(keyCode);
  };
  const onUp = (event: KeyboardEvent) => {
    const keyCode = keyCodes[event.code] ?? keyCodes[event.key];
    if (keyCode === undefined) return;
    event.preventDefault(); event.stopImmediatePropagation(); held.delete(keyCode); runtime.sendInput(keyCode, event.shiftKey ? 1 : 0, false);
  };
  const onBlur = () => { for (const keyCode of held) runtime.sendInput(keyCode, 0, false); held.clear(); };
  target.addEventListener("keydown", onDown, true); target.addEventListener("keyup", onUp, true); target.addEventListener("blur", onBlur);
  return () => { onBlur(); target.removeEventListener("keydown", onDown, true); target.removeEventListener("keyup", onUp, true); target.removeEventListener("blur", onBlur); };
}

export function installBdjPointerInput(root: HTMLElement, runtime: BdjRuntimeHandle): () => void {
  const activate = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    runtime.retryBlockedMedia();
    const bounds = root.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const canvas = root.querySelector("canvas");
    const width = canvas?.width || 1920; const height = canvas?.height || 1080;
    const scale = Math.min(bounds.width / width, bounds.height / height);
    const offsetX = (bounds.width - width * scale) / 2; const offsetY = (bounds.height - height * scale) / 2;
    const x = (event.clientX - bounds.left - offsetX) / scale; const y = (event.clientY - bounds.top - offsetY) / scale;
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    runtime.sendPointer(x, y);
  };
  root.addEventListener("pointerdown", activate);
  return () => root.removeEventListener("pointerdown", activate);
}

function applicationJarPath(basePath: string): string | null {
  const normalized = basePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) return null;
  const jarPath = /\.jar$/i.test(normalized) ? normalized : `${normalized}.jar`;
  return `BDMV/JAR/${jarPath}`;
}
function record(value: unknown, label: string): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as Record<string, unknown>; }
function arrayOf<T>(value: unknown, label: string): T[] { if (!Array.isArray(value)) throw new Error(`${label} must be an array.`); return value as T[]; }
