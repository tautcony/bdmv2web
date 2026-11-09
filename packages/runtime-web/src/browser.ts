import { HdmvVm, type TraceEntry, type VmOptions, type VmProgram } from "@bdmv2web/hdmv";
import { CanvasViewport, drawMenu, installCanvasPointerInput, installKeyboardInput, MenuController, MenuLoopPlaybackBridge, MenuSoundPlayer, PreviewPlaybackBridge, type MenuButton, type MenuInputConfig, type MenuLoopMediaPackage, type MenuPage, type MenuScene, type PlaybackBridge } from "./index.js";
import { resolveExternalPlayTarget, type ExternalMediaTargets, type ExternalPlayRequest } from "@bdmv2web/media-export/external-targets";
import { selectPopupScene, type SerializedMenuState, type SerializedScene } from "./igs-adapter.js";
import { format90kSeconds, requestExternalPlayback } from "./bdmv-url.js";

export type PackageMenuMedia = MenuLoopMediaPackage;
export interface PackageData { ir: unknown; title?: string; scene: SerializedScene | null; popupScenes?: SerializedScene[]; menuScenes?: Array<{ playlistId: number; playItem?: number; scene: SerializedScene }>; menuPlaylistIds?: number[]; menuPlaylistMarks?: Array<{ playlistId: number; marks: Array<{ index: number; playItemRef: number }> }>; preMenuPlaylistIds?: number[]; pgsTracks?: unknown[]; vmPrograms?: VmProgram[]; vmEntries?: VmOptions["entries"]; profile?: VmOptions["profile"]; limits?: VmOptions["limits"]; externalTargets?: ExternalMediaTargets; vmInitialProgramId?: number; vmFirstPlayProgramId?: number; sounds?: Record<number, string>; media?: MenuLoopMediaPackage; menuMedia?: PackageMenuMedia[]; inputConfig?: Partial<MenuInputConfig> }
interface Asset { id: string; dataUrl: string }
declare global { var __BDMV_MENU_DATA__: PackageData | undefined; var __BDMV_MENU_ASSETS__: Asset[][] | undefined; var __BDMV_BDMV_PATH__: string | undefined; }

/** Build the menu VM from packaged data. The packaged player profile must reach the
 * VM here: the conversion-time VM already ran with it, and PSR-dependent button
 * commands (player language, country, region) must behave identically at run time. */
export function createMenuVm(data: PackageData, onTrace?: (entry: TraceEntry) => void): HdmvVm {
  if (data.profile !== undefined && (typeof data.profile !== "object" || data.profile === null || Array.isArray(data.profile))) throw new Error("Embedded player profile must be a JSON object.");
  return new HdmvVm(data.vmPrograms ?? [], { ...(onTrace ? { onTrace } : {}), ...(data.vmEntries ? { entries: data.vmEntries } : {}), ...(data.profile ? { profile: data.profile } : {}), ...(data.limits ? { limits: data.limits } : {}) });
}

export interface StatusToastOptions {
  /** Keep the message until the next update. Use it whenever the user must act on it. */
  persist?: boolean;
  /** Error styling; independent of persistence so a hint can stay without turning red. */
  error?: boolean;
}
type StatusToastHost = { textContent: string | null; classList?: { add(name: string): void; remove(name: string): void; toggle(name: string, force?: boolean): unknown } };
type StatusCopyButton = { addEventListener?: (type: string, listener: () => void) => void; setAttribute?: (name: string, value: string) => void };

/** Render status updates as a translucent toast in the top-right corner. Ordinary
 * updates fade out again; persistent ones stay until the next update and accept
 * text selection, because instructions the user has to copy must not vanish.
 * `messageHost` is the element that holds the text when the toast also carries a
 * control such as its copy button. */
export function createStatusToast(host: StatusToastHost, timeoutMs = 4500, messageHost: StatusToastHost = host): (message: string, options?: StatusToastOptions) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message, options = {}) => {
    messageHost.textContent = message;
    host.classList?.add("is-visible");
    host.classList?.toggle("is-error", options.error === true);
    host.classList?.toggle("is-persistent", options.persist === true);
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (options.persist) return;
    timer = setTimeout(() => { timer = undefined; host.classList?.remove("is-visible"); }, timeoutMs);
  };
}

let statusToast: ReturnType<typeof createStatusToast> | undefined;
let statusCopyButton: StatusCopyButton | undefined;
let statusMessage = "";

function showStatus(message: string, options?: StatusToastOptions): void {
  const element = document.getElementById("runtime-status");
  if (!element) return;
  statusMessage = message;
  statusCopyButton?.setAttribute?.("data-copied", "false");
  const messageElement = document.getElementById("runtime-status-message") as StatusToastHost | null;
  statusToast ??= createStatusToast(element, undefined, messageElement ?? element);
  statusToast(message, options);
  if (!statusCopyButton) {
    const button = document.getElementById("runtime-status-copy") as StatusCopyButton | null;
    if (button) {
      statusCopyButton = button;
      attachStatusCopy(button, () => statusMessage, () => { if (statusMessage) showStatus(statusMessage); });
    }
  }
}

/** Copy affordance for the status toast. The message is put back on screen after a
 * successful copy so the text the user acted on does not disappear mid-read. */
export function attachStatusCopy(button: StatusCopyButton, message: () => string, afterCopy?: () => void): void {
  let reset: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener?.("click", () => {
    const text = message();
    if (!text) return;
    void copyText(text).then((copied) => {
      if (!copied) return;
      afterCopy?.();
      button.setAttribute?.("data-copied", "true");
      if (reset !== undefined) clearTimeout(reset);
      reset = setTimeout(() => { reset = undefined; button.setAttribute?.("data-copied", "false"); }, 1600);
    });
  });
}

/** Copy text from a `file://` page: the asynchronous Clipboard API is not available
 * in every browser and context, so the selection copy stays as the fallback. */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    try { await clipboard.writeText(text); return true; } catch { /* use the selection copy */ }
  }
  if (typeof document.createElement !== "function" || typeof document.body?.appendChild !== "function") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try { return document.execCommand("copy") === true; }
  catch { return false; }
  finally { if (typeof document.body.removeChild === "function") document.body.removeChild(area); }
}

function visibleError(error: unknown): void {
  const status = document.getElementById("runtime-status"); const detail = document.getElementById("runtime-diagnostics");
  if (status) status.role = "alert";
  showStatus("Menu preview could not start.", { persist: true, error: true });
  if (detail) { detail.hidden = false; detail.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
}

/** Console trace for the HDMV VM: one line per decoded batch. `context` returns
 * the menu scene and the button that triggered the batch, so a line reads on its
 * own without the session that produced it. */
function vmConsoleLogger(context?: () => string | null): (entry: TraceEntry) => void {
  let pending: TraceEntry[] = [];
  let scheduled = false;
  return (entry) => {
    if (entry.decoded?.startsWith("RESET ")) return;
    pending.push(entry);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const batch = pending;
      pending = [];
      const commands = batch.filter((item) => item.decoded && !item.decoded.startsWith("MENU_CONTEXT")).map((item) => `${item.programId}:${item.pc} ${item.decoded}`);
      const actions = summarizeLabels(batch.flatMap((item) => item.action ? [item.action.type] : []));
      const events = summarizeLabels(batch.flatMap((item) => {
        const type = item.event?.type ?? item.input?.type;
        return type ? [type] : [];
      }));
      const diagnostics = summarizeLabels(batch.flatMap((item) => item.diagnostic ? [item.diagnostic.code] : []));
      const faulted = batch.some((item) => item.status === "faulted");
      // TIME_UPDATED arrives continuously for the whole menu loop and changes
      // nothing; printing those batches buries the batches a click produces.
      const heartbeatOnly = !actions && !diagnostics && !faulted && !!events && events.split(",").every((label) => label.startsWith("TIME_UPDATED"));
      if (heartbeatOnly) return;
      if (!commands.length && !actions && !events && !diagnostics) return;
      const shownCommands = commands.length <= 6
        ? commands.join(" → ")
        : `${commands.slice(0, 2).join(" → ")} → … ${commands.length - 4} more → ${commands.slice(-2).join(" → ")}`;
      const where = context?.();
      const fields = where ? [where] : [];
      fields.push(`${commands.length} step${commands.length === 1 ? "" : "s"}`);
      if (shownCommands) fields.push(shownCommands);
      if (actions) fields.push(`actions=${actions}`);
      if (events) fields.push(`events=${events}`);
      if (diagnostics) fields.push(`diag=${diagnostics}`);
      const status = batch.at(-1)?.status;
      if (status) fields.push(`status=${status}`);
      console.info(`[VM] ${fields.join(" | ")}`);
    });
  };
}

/** Console trace for what the runtime did with a VM action: which packaged scene
 * and background a jump reached, or why it did not move. */
function menuLog(message: string): void {
  console.info(`[menu] ${message}`);
}

/** Scene identity as it appears in the manifest, e.g. `clip 00014 pid 0x1400`. */
function sceneLabel(scene: SerializedScene): string {
  const clip = scene.clipId ?? scene.id ?? "?";
  const pid = typeof scene.pid === "number" ? `0x${scene.pid.toString(16)}` : "?";
  return `clip ${clip} pid ${pid}`;
}

/** Asset directory of a packaged background, e.g. `playlist-00016-pi2`. */
function backgroundLabel(path: string | undefined): string {
  if (!path) return "none";
  const parts = path.split("/");
  return parts.length >= 2 ? parts[parts.length - 2]! : path;
}

function summarizeLabels(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => count === 1 ? value : `${value} x${count}`).join(",");
}

async function boot(): Promise<void> {
  try {
    const data = globalThis.__BDMV_MENU_DATA__;
    if (!data || typeof data !== "object" || !("ir" in data)) throw new Error("Missing or invalid embedded menu data.");
    validateEmbeddedDiscIR(data.ir);
    const assetMap = new Map<string, HTMLImageElement>();
    for (const batch of globalThis.__BDMV_MENU_ASSETS__ ?? []) {
      if (!Array.isArray(batch)) throw new Error("Invalid embedded image batch.");
      await Promise.all(batch.map(async (asset) => {
        if (!asset || typeof asset.id !== "string" || typeof asset.dataUrl !== "string") throw new Error("Invalid embedded image record.");
        const image = new Image(); image.src = asset.dataUrl;
        try { await image.decode(); } catch { throw new Error(`Could not decode embedded PNG '${asset.id}'.`); }
        assetMap.set(asset.id, image);
      }));
    }
    if (!data.scene) throw new Error("The package contains no supported menu scene.");
    let scene = normalizeScene(data.scene, assetMap);
    let activeMenuSceneKey = menuSceneKey(data.scene);
    const status = document.getElementById("runtime-status"); const start = document.getElementById("start-menu") as HTMLButtonElement | null;
    const muteToggle = document.getElementById("audio-mute-toggle") as HTMLButtonElement | null;
    const canvas = document.getElementById("menu-canvas") as HTMLCanvasElement | null;
    const popupCanvas = document.getElementById("popup-canvas") as HTMLCanvasElement | null;
    const video = document.getElementById("menu-background") as HTMLVideoElement | null;
    const audio = document.getElementById("menu-audio") as HTMLAudioElement | null;
    if (!status || !start || !muteToggle || !canvas) throw new Error("The menu page is missing required runtime elements.");
    let viewport = new CanvasViewport(scene.width, scene.height);
    // Context for the console trace. The button is recorded by the controllers
    // and consumed by the next batch, so a line names the control that ran it.
    const logState = { scene: sceneLabel(data.scene), button: "" };
    const vm = createMenuVm(data, vmConsoleLogger(() => {
      const button = logState.button;
      logState.button = "";
      return button ? `${logState.scene} · ${button}` : logState.scene;
    }));
    if (data.vmInitialProgramId !== undefined) {
      if (!Number.isSafeInteger(data.vmInitialProgramId) || !(data.vmPrograms ?? []).some((program) => program.id === data.vmInitialProgramId)) throw new Error(`Invalid initial MovieObject ${String(data.vmInitialProgramId)}.`);
      vm.reset(data.vmInitialProgramId);
    }
    let retrySound: (() => void) | null = null;
    let retryMedia: (() => void) | null = null;
    // The primary menu media is one PlayItem of one playlist. Sub-menu PlayItems
    // of the same playlist stay in menuMedia because the runtime keys media by
    // (playlist, PlayItem), not by playlist alone.
    const menuMedia = (data.menuMedia ?? []).filter((item) => item.playlist !== data.media?.playlist || (item.playItem ?? 0) !== (data.media?.playItem ?? 0));
    const playlistHasMedia = (playlist: number): boolean => data.media?.playlist === playlist || menuMedia.some((item) => item.playlist === playlist);
    /** The packaged background a `(playlist, PlayItem)` request addresses. Kept
     * for the console trace; the bridge owns the media it actually plays. */
    const packagedMenuMedia = (playlist: number, playItem: number): PackageMenuMedia | undefined => {
      const candidates = [data.media, ...menuMedia].filter((item): item is PackageMenuMedia => !!item && item.playlist === playlist);
      return candidates.find((item) => (item.playItem ?? 0) === playItem) ?? (candidates.length === 1 ? candidates[0] : undefined);
    };
    const requestedPlayItem = (playlist: number, action: { type: string; payload: { playItem?: number; playMark?: number } }): number => {
      if ((action.type === "PLAY_PLAYLIST_ITEM" || action.type === "LINK_PLAY_ITEM") && typeof action.payload.playItem === "number") return action.payload.playItem;
      if ((action.type === "PLAY_PLAYLIST_MARK" || action.type === "LINK_PLAY_MARK") && typeof action.payload.playMark === "number") {
        return data.menuPlaylistMarks?.find((item) => item.playlistId === playlist)?.marks.find((mark) => mark.index === action.payload.playMark)?.playItemRef ?? 0;
      }
      return 0;
    };
    const playbackBridge: PlaybackBridge = (data.media || data.menuMedia?.length) && video && audio
      ? new MenuLoopPlaybackBridge(vm, video, audio, data.media, (message) => { showStatus(message); }, {
        offerRetry: (retry) => { retryMedia = retry; start.textContent = "Retry menu media"; start.hidden = false; start.disabled = false; },
        clearRetry: () => { retryMedia = null; if (!retrySound) start.hidden = true; },
        resolvePlayItem: (playlist, action) => requestedPlayItem(playlist, action),
      }, menuMedia)
      : new PreviewPlaybackBridge(vm, (message) => { showStatus(message); });
    let controller: MenuController | null = null;
    let popupController: MenuController | null = null;
    let popupViewport: CanvasViewport | null = null;
    let removePopupPointer: (() => void) | undefined;
    let removeKeyboard: (() => void) | undefined;
    let inputStarted = false;
    let animationFrameHandle: number | undefined;
    let lastAnimationFrameTime: number | undefined;
    const animateMenus = (time: number) => {
      animationFrameHandle = undefined;
      const delta = lastAnimationFrameTime === undefined ? 0 : Math.max(0, time - lastAnimationFrameTime);
      lastAnimationFrameTime = time;
      controller?.advanceWhileRunning(delta);
      popupController?.advanceWhileRunning(delta);
      if (controller?.isAnimating || popupController?.isAnimating) animationFrameHandle = requestAnimationFrame(animateMenus);
      else lastAnimationFrameTime = undefined;
    };
    const ensureAnimationLoop = () => {
      if (animationFrameHandle === undefined && (controller?.isAnimating || popupController?.isAnimating)) animationFrameHandle = requestAnimationFrame(animateMenus);
    };
    const closePopup = () => {
      const wasOpen = popupController !== null;
      if (!wasOpen) return;
      popupController?.pause();
      popupController = null;
      popupViewport = null;
      removePopupPointer?.(); removePopupPointer = undefined;
      if (popupCanvas) { popupCanvas.hidden = true; popupCanvas.getContext("2d")?.clearRect(0, 0, popupCanvas.width, popupCanvas.height); }
      if (inputStarted && controller) queueMicrotask(() => { removeKeyboard?.(); removeKeyboard = installKeyboardInput(window, controller!); });
      if (controller) { controller.syncVmContext(); redraw(); }
    };
    const pendingActions: Array<ReturnType<HdmvVm["drainActions"]>[number]> = [];
    // The playlist the VM is currently playing. `LinkPI`/`LinkMK` address a
    // PlayItem inside it and carry no playlist operand of their own.
    let activeMenuPlaylist: number | null = data.media?.playlist ?? data.menuPlaylistIds?.[0] ?? null;
    const missingMenuMedia = new Set<string>();
    const activateMenuScene = (target: { scene: SerializedScene }): void => {
      // Always-on menu compositions replace the menu scene. Menu backgrounds are
      // switched through the playback bridge when that playlist has local media.
      const targetSceneKey = menuSceneKey(target.scene);
      if (activeMenuSceneKey === targetSceneKey) return;
      closePopup();
      removePointer?.();
      scene = normalizeScene(target.scene, assetMap);
      activeMenuSceneKey = targetSceneKey;
      logState.scene = sceneLabel(target.scene);
      viewport = new CanvasViewport(scene.width, scene.height);
      controller = new MenuController(scene, vm, { render: redraw, dispatchActions, diagnostic: (message) => showStatus(message), playSound: (soundId, buttonId) => soundPlayer.play(soundId, buttonId), invalidateSound: () => { soundPlayer.invalidate(); retrySound = null; start.hidden = true; }, activateButton: (pageId, button) => { logState.button = `button ${button.id} (page ${pageId})`; } }, data.inputConfig);
      const rect = canvas.getBoundingClientRect(); viewport.resize(canvas, rect.width, rect.height, window.devicePixelRatio || 1);
      controller.start();
      if (inputStarted) {
        removeKeyboard?.(); removePointer = installCanvasPointerInput(canvas, viewport, controller, () => { const size = canvas.getBoundingClientRect(); return { width: size.width, height: size.height }; });
        removeKeyboard = installKeyboardInput(window, controller);
      }
      redraw();
    };
    const dispatchActions = () => {
      pendingActions.push(...vm.drainActions());
      if (!controller) return { menuPlaylistRequested: false, completion: Promise.resolve() };
      const mediaActions: Promise<void>[] = [];
      let menuPlaylistRequested = false;
      // The controller records the activation before running its commands, so the
      // action lines can name the control even though they run before the batch
      // the trace prints. A popup menu consumes the activation while it is open.
      const source = popupController?.activatedButtonId != null ? popupController : controller;
      const pressed = source?.activatedButtonId != null ? `button ${source.activatedButtonId} (page ${source.page.id}) ` : "";
      const report = (message: string): void => menuLog(`${pressed}${message}`);
      while (pendingActions.length) {
        const action = pendingActions.shift()!;
        const inputController = popupController ?? controller;
        if (action.type === "SET_BUTTON_PAGE") {
          const packed = action.payload.packed;
          if (typeof packed === "number") {
            const before = inputController ? `${inputController.page.id}:${inputController.selectedButtonId ?? "none"}` : "";
            inputController?.applySetButtonPage(packed);
            const after = inputController ? `${inputController.page.id}:${inputController.selectedButtonId ?? "none"}` : "";
            if (before !== after && inputController) report(`SET_BUTTON_PAGE #${packed.toString(16)} → page ${inputController.page.id} button ${inputController.selectedButtonId ?? "none"}`);
          }
          else showStatus("VM emitted SET_BUTTON_PAGE without its packed operand.");
        } else if ((action.type === "ENABLE_BUTTON" || action.type === "DISABLE_BUTTON") && typeof action.payload.button === "number") {
          inputController?.setButtonEnabled(action.payload.button, action.type === "ENABLE_BUTTON");
        } else if (action.type === "POPUP_OFF") {
          closePopup();
        } else if (action.type === "MENU_CALL") {
          const selected = data.scene?.clipId && data.scene.pid !== undefined
            ? selectPopupScene(data.popupScenes ?? [], data.scene.clipId, data.scene.pid)
            : { status: "not-found" as const };
          if (selected.status !== "selected" || !popupCanvas) {
            showStatus("No unambiguous popup IGS composition matches the active menu clip and PID.");
          } else {
            closePopup();
            const popupScene = normalizeScene(selected.scene, assetMap);
            popupViewport = new CanvasViewport(popupScene.width, popupScene.height);
            popupCanvas.hidden = false;
            const drawPopup = () => {
              if (!popupController || !popupViewport || !popupCanvas) return;
              const rect = popupCanvas.getBoundingClientRect(); const context = popupCanvas.getContext("2d");
              if (context) drawMenu(context, popupScene, popupController, popupViewport, rect.width, rect.height, window.devicePixelRatio || 1);
              ensureAnimationLoop();
            };
            popupController = new MenuController(popupScene, vm, { render: drawPopup, dispatchActions, diagnostic: (message) => showStatus(message), playSound: (soundId, buttonId) => soundPlayer.play(soundId, buttonId), invalidateSound: () => soundPlayer.invalidate(), activateButton: (pageId, button) => { logState.button = `popup button ${button.id} (page ${pageId})`; } }, data.inputConfig);
            const rect = popupCanvas.getBoundingClientRect(); popupViewport.resize(popupCanvas, rect.width, rect.height, window.devicePixelRatio || 1);
            removePopupPointer = installCanvasPointerInput(popupCanvas, popupViewport, popupController, () => { const size = popupCanvas.getBoundingClientRect(); return { width: size.width, height: size.height }; });
            popupController.start();
            if (inputStarted) queueMicrotask(() => { removeKeyboard?.(); if (popupController) removeKeyboard = installKeyboardInput(window, popupController); });
            drawPopup();
          }
        } else if (action.type === "TITLE_SEARCH" && typeof action.payload.title === "number") {
          closePopup();
          const selected = vm.selectTitle(action.payload.title);
          if (selected.diagnostic) {
            showStatus(selected.diagnostic.message);
            if (vm.recoverMenuAction()) { controller.syncVmContext(); pendingActions.length = 0; continue; }
          }
          pendingActions.push(...vm.drainActions());
        } else if (["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"].includes(action.type) && typeof action.payload.playlist === "number" && data.menuPlaylistIds?.includes(action.payload.playlist)) {
          const playlist = action.payload.playlist;
          const playItem = requestedPlayItem(playlist, action);
          const menuScenesForPlaylist = data.menuScenes?.filter((item) => item.playlistId === playlist) ?? [];
          const target = menuScenesForPlaylist.find((item) => (item.playItem ?? 0) === playItem) ?? menuScenesForPlaylist[0];
          if (!target) {
            report(`${action.type} playlist ${playlist} has no packaged IGS composition; released the VM wait`);
            showStatus(`Menu playlist ${playlist} has no packaged IGS composition.`);
            vm.releaseExternalPlayback(action);
            continue;
          }
          activeMenuPlaylist = playlist;
          activateMenuScene(target);
          report(`${action.type} playlist ${playlist}${playItem ? ` PlayItem ${playItem}` : ""} → ${sceneLabel(target.scene)} · background ${backgroundLabel(packagedMenuMedia(playlist, playItem)?.background.path)}`);
          if (playlistHasMedia(playlist)) mediaActions.push(Promise.resolve(playbackBridge.dispatch(action)));
          else {
            vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id });
            mediaActions.push(Promise.resolve(playbackBridge.startMenuBackground?.() ?? false).then(() => undefined));
          }
          menuPlaylistRequested = true;
        } else if (["LINK_PLAY_ITEM", "LINK_PLAY_MARK"].includes(action.type) && activeMenuPlaylist !== null) {
          // LinkPI/LinkMK move inside the playlist the VM is already playing, so
          // the jump carries no playlist operand and releases no media wait. A
          // packaged sub-menu PlayItem replaces the composition, and its exported
          // background replaces the loop when that PlayItem has local media.
          const playlist = activeMenuPlaylist;
          const playItem = requestedPlayItem(playlist, action);
          const jump = `${action.type === "LINK_PLAY_MARK" ? `LINK_MK ${action.payload.playMark}` : `LINK_PI ${playItem}`} → playlist ${playlist} PlayItem ${playItem}`;
          const entry = (data.menuScenes ?? []).find((item) => item.playlistId === playlist && (item.playItem ?? 0) === playItem);
          if (!entry) {
            report(`${jump} is not packaged; stayed on ${logState.scene}`);
            showStatus(`Menu playlist ${playlist} PlayItem ${playItem} is not packaged; the menu stayed on the current page.`, { persist: true });
            continue;
          }
          activateMenuScene(entry);
          const shown = playbackBridge.showMenuItem?.(playlist, playItem);
          if (!shown) {
            report(`${jump} → ${sceneLabel(entry.scene)} · no packaged background, the current one keeps playing`);
            if (!missingMenuMedia.has(`${playlist}:${playItem}`)) {
              missingMenuMedia.add(`${playlist}:${playItem}`);
              showStatus(`Menu PlayItem ${playItem} has no packaged background; the current one keeps playing.`);
            }
            continue;
          }
          report(`${jump} → ${sceneLabel(entry.scene)} · background ${backgroundLabel(packagedMenuMedia(playlist, playItem)?.background.path)}`);
          mediaActions.push(shown.then((ok) => { if (!ok) showStatus(`Menu PlayItem ${playItem} background could not start.`); }));
        } else if (["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"].includes(action.type) && typeof action.payload.playlist === "number" && data.preMenuPlaylistIds?.includes(action.payload.playlist)) {
          // Top Menu can start with a logo or warning playlist. Complete that intro
          // in the VM without handing it to the external player, then follow the
          // title/search actions that lead to the actual menu playlist.
          report(`${action.type} playlist ${action.payload.playlist} → intro completed in the VM`);
          vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
          pendingActions.push(...vm.drainActions());
          continue;
        } else if (data.externalTargets && ["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"].includes(action.type) && !(action.type === "PLAY_PLAYLIST" && typeof action.payload.playlist === "number" && playlistHasMedia(action.payload.playlist))) {
          closePopup();
          const result = resolveExternalPlayTarget(data.externalTargets, { type: action.type, ...action.payload } as ExternalPlayRequest);
          const bdmvPath = globalThis.__BDMV_BDMV_PATH__;
          const handoff = requestExternalPlayback({ target: result, bdmvPath, platform: navigator.userAgent, pageUrl: location.href, navigate: (url) => { location.href = url; } });
          if (handoff.status !== "requested") {
            const source = handoff.source ? ` (${handoff.source.path} @ ${handoff.source.offset})` : "";
            const diagnostic = `${handoff.code}: ${handoff.message}${source}`;
            report(`${action.type} ${action.payload.playlist ?? action.payload.playMark ?? "?"} → external handoff ${handoff.status}: ${diagnostic}`);
            showStatus(diagnostic, { persist: true, error: handoff.status === "unavailable" });
            vm.releaseExternalPlayback(action);
            continue;
          }
          setMenuMuted(true);
          report(`${action.type} ${action.payload.playlist ?? action.payload.playMark ?? "?"} → ${handoff.status} ${handoff.target.item.streamPath}${handoff.target.seekTime90k !== null ? ` at ${format90kSeconds(handoff.target.seekTime90k)}s` : ""}`);
          showStatus(`Requested ${handoff.target.item.streamPath} in the external player.`);
          vm.releaseExternalPlayback(action);
        } else {
          if (["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK", "TOP_MENU", "MENU_RETURN"].includes(action.type)) closePopup();
          if (["LINK_PLAY_ITEM", "LINK_PLAY_MARK"].includes(action.type)) report(`${action.type} ${action.payload.playItem ?? action.payload.playMark ?? "?"} → no packaged menu playlist is active; handed to the fallback bridge`);
          if (action.type === "PLAY_PLAYLIST" && action.payload.playlist === data.media?.playlist) menuPlaylistRequested = true;
          mediaActions.push(Promise.resolve(playbackBridge.dispatch(action)));
        }
      }
      return { menuPlaylistRequested, completion: Promise.all(mediaActions).then(() => undefined) };
    };
    const soundPlayer = new MenuSoundPlayer(data.sounds ?? {}, (url) => new Audio(url), {
      report: (kind, message) => {
        showStatus(message);
        if (kind === "blocked") { start.textContent = "Retry sound"; start.hidden = false; start.disabled = false; }
        else if (kind === "unsupported" || kind === "asset") { start.hidden = true; retrySound = null; }
      },
      offerRetry: (retry) => { retrySound = retry; start.textContent = "Retry sound"; start.hidden = false; start.disabled = false; },
      isCurrent: (_soundId, buttonId) => !!controller && controller.button?.id === buttonId && controller.activatedButtonId === buttonId,
    });
    let menuMuted = false;
    let manualMuted = false;
    let removeAutoMuteRestore: (() => void) | null = null;
    let armAutoMuteTimer: ReturnType<typeof setTimeout> | undefined;
    const applyMenuMuted = (muted: boolean) => {
      menuMuted = muted;
      if (video) video.muted = muted;
      if (audio) audio.muted = muted;
      soundPlayer.setMuted(muted);
      muteToggle.setAttribute("aria-pressed", String(muted));
      muteToggle.setAttribute("aria-label", muted ? "Unmute menu audio" : "Mute menu audio");
      muteToggle.title = muted ? "Unmute menu audio" : "Mute menu audio";
    };
    const disarmAutoMuteRestore = () => {
      if (armAutoMuteTimer !== undefined) clearTimeout(armAutoMuteTimer);
      armAutoMuteTimer = undefined;
      removeAutoMuteRestore?.();
      removeAutoMuteRestore = null;
    };
    // An external handoff mutes the page without expressing user intent. Restore
    // that automatic mute on the next input; keep an explicit mute in place.
    const isMuteControl = (event: Event): boolean => {
      const target = event.target as (Element & { closest?: (selector: string) => Element | null }) | null;
      if (target === muteToggle) return true;
      return !!target && typeof target.closest === "function" && target.closest("#audio-mute-toggle") !== null;
    };
    const restoreAutoMutedMenu = (event: Event) => {
      if (manualMuted || !menuMuted || isMuteControl(event)) return;
      applyMenuMuted(false);
      disarmAutoMuteRestore();
    };
    const armAutoMuteRestore = () => {
      if (removeAutoMuteRestore) return;
      window.addEventListener("keydown", restoreAutoMutedMenu, true);
      window.addEventListener("pointerdown", restoreAutoMutedMenu, true);
      window.addEventListener("click", restoreAutoMutedMenu, true);
      removeAutoMuteRestore = () => {
        window.removeEventListener("keydown", restoreAutoMutedMenu, true);
        window.removeEventListener("pointerdown", restoreAutoMutedMenu, true);
        window.removeEventListener("click", restoreAutoMutedMenu, true);
      };
    };
    const setMenuMuted = (muted: boolean, manual = false) => {
      if (manual) {
        manualMuted = muted;
        disarmAutoMuteRestore();
      }
      applyMenuMuted(muted);
      if (muted && !manual && !manualMuted) {
        // The handoff runs inside the key/click handler that caused it. Arm the
        // restore listener after that event finishes so it does not undo the mute.
        if (armAutoMuteTimer !== undefined) clearTimeout(armAutoMuteTimer);
        armAutoMuteTimer = setTimeout(() => {
          armAutoMuteTimer = undefined;
          if (menuMuted && !manualMuted) armAutoMuteRestore();
        }, 0);
      } else if (!muted) disarmAutoMuteRestore();
    };
    muteToggle.addEventListener("click", () => setMenuMuted(!menuMuted, true));
    const redraw = () => {
      if (!controller) return;
      const rect = canvas.getBoundingClientRect(); const context = canvas.getContext("2d");
      if (context) drawMenu(context, scene, controller, viewport, rect.width, rect.height, window.devicePixelRatio || 1);
      ensureAnimationLoop();
    };
    controller = new MenuController(scene, vm, { render: redraw, dispatchActions, diagnostic: (message) => { showStatus(message); }, playSound: (soundId, buttonId) => soundPlayer.play(soundId, buttonId), invalidateSound: () => { soundPlayer.invalidate(); retrySound = null; start.hidden = true; }, activateButton: (pageId, button) => { logState.button = `button ${button.id} (page ${pageId})`; } }, data.inputConfig);
    start.hidden = false; start.disabled = false; showStatus("Images decoded. Select Start menu preview to enable input.");
    let removePointer: (() => void) | undefined;
    // The test host awaits fired listeners, so the handler returns its completion promise.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    start.addEventListener("click", async () => {
      if (retrySound) { const retry = retrySound; retrySound = null; start.disabled = true; start.hidden = true; retry(); return; }
      if (retryMedia) { const retry = retryMedia; retryMedia = null; start.disabled = true; start.hidden = true; retry(); return; }
      if (inputStarted) return;
      inputStarted = true; start.disabled = true; start.hidden = true;
      let menuMediaStarted: boolean | undefined;
      let pending = { menuPlaylistRequested: false, completion: Promise.resolve() };
      if (data.vmInitialProgramId !== undefined) {
        if (data.vmFirstPlayProgramId !== undefined && data.vmEntries?.some((entry) => entry.kind === "topMenu" && entry.target.objectType === "HDMV")) {
          vm.reset(data.vmFirstPlayProgramId);
          const initial = vm.runTurn();
          if (initial.status === "faulted") { showStatus(initial.diagnostic?.message ?? "First Play initialization failed."); return; }
          if (initial.waiting) vm.releaseExternalPlayback(initial.waiting);
          vm.drainActions();
          vm.selectTitle(0);
        } else vm.runTurn();
        pending = dispatchActions();
      }
      if (!pending.menuPlaylistRequested && playbackBridge.startMenuBackground && !["faulted", "stopped"].includes(vm.snapshot().status)) {
        const backgroundStart = playbackBridge.startMenuBackground();
        const [, started] = await Promise.all([pending.completion, backgroundStart]); menuMediaStarted = started;
      } else {
        await pending.completion;
      }
      if (retryMedia) return;
      const vmStatus = vm.snapshot().status;
      if (vmStatus === "faulted" || vmStatus === "stopped" || (vmStatus === "suspended" && !pending.menuPlaylistRequested)) return;
      if (menuMediaStarted !== false) showStatus("Menu preview ready. Use arrow keys and Enter, or select a visible button.");
      const initialRect = canvas.getBoundingClientRect();
      viewport.resize(canvas, initialRect.width, initialRect.height, window.devicePixelRatio || 1);
      controller!.start();
      void dispatchActions().completion;
      // The dispatch above can switch scenes synchronously and install input
      // for the switched controller; remove those listeners before installing
      // the final set so one input event reaches one controller.
      removeKeyboard?.();
      removePointer?.();
      removeKeyboard = installKeyboardInput(window, popupController ?? controller!);
      removePointer = installCanvasPointerInput(canvas, viewport, controller!, () => { const rect = canvas.getBoundingClientRect(); return { width: rect.width, height: rect.height }; });
      redraw();
    });
    window.addEventListener("pagehide", () => {
      removeKeyboard?.(); removePointer?.();
      disarmAutoMuteRestore();
    }, { once: true });
  } catch (error) { visibleError(error); }
}

/** Check that the embedded DiscIR belongs to this runtime. The runtime never
 * reads the IR; its schema, duplicate-ID and reference rules are enforced by
 * `parseDiscIR` when the package is written. */
function validateEmbeddedDiscIR(value: unknown): void {
  if (!isRecord(value)) throw new Error("Embedded DiscIR must be a JSON object.");
  if (value.schemaVersion !== "1.0") throw new Error(`Unsupported DiscIR schema version '${typeof value.schemaVersion === "string" ? value.schemaVersion : "missing"}'. Expected 1.0.`);
  for (const key of ["entries", "programs", "menus", "playlists", "mediaAssets", "diagnostics"]) if (!Array.isArray(value[key])) throw new Error(`Embedded DiscIR is invalid: '${key}' must be an array.`);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function normalizeScene(source: SerializedScene, assets: Map<string, HTMLImageElement>): MenuScene {
  if (!source || !Number.isSafeInteger(source.width) || source.width <= 0 || !Number.isSafeInteger(source.height) || source.height <= 0 || !Array.isArray(source.pages) || source.pages.length === 0) throw new Error("Invalid menu scene dimensions or pages.");
  return {
    width: source.width,
    height: source.height,
    ...(source.frameRateCode !== undefined ? { frameRateCode: source.frameRateCode } : {}),
    compositionTimeout90k: source.compositionTimeout90k,
    selectionTimeout90k: source.selectionTimeout90k,
    pages: source.pages.map((page) => ({
    id: page.id, uoMask: page.uoMask, defaultButtonId: page.defaultButtonId,
    ...(page.defaultActivatedButtonId !== undefined ? { defaultActivatedButtonId: page.defaultActivatedButtonId } : {}),
    ...(page.bogDefaults ? { bogDefaults: page.bogDefaults } : {}),
    animationFrameRateCode: page.animationFrameRateCode,
    ...(page.objects ? { objects: new Map(page.objects.flatMap((object) => {
      const image = assets.get(object.assetId);
      return image ? [[object.id, { image, width: object.width, height: object.height }] as const] : [];
    })) } : {}),
    ...(page.effects ? { effects: {
      enter: normalizeEffects(page.effects.enter, assets),
      exit: normalizeEffects(page.effects.exit, assets),
    } } : {}),
    ...(page.allowedActions ? { allowedActions: page.allowedActions } : {}),
    buttons: page.buttons.map((button) => ({
      id: button.id, bog: button.bog ?? 0, enabled: button.enabled ?? true, ...(button.autoAction !== undefined ? { autoAction: button.autoAction } : {}), neighbors: button.neighbors,
      states: {
        ...(button.states.normal ? { normal: normalizeState(button.states.normal, assets) } : {}),
        ...(button.states.selected ? { selected: normalizeState(button.states.selected, assets) } : {}),
        ...(button.states.activated ? { activated: normalizeState(button.states.activated, assets) } : {}),
      }, commands: button.commands ?? [],
    })),
  })) };
}

function menuSceneKey(scene: SerializedScene): string { return `${scene.clipId ?? scene.id ?? ""}:${scene.pid ?? ""}`; }

function normalizeEffects(effects: NonNullable<SerializedScene["pages"][number]["effects"]>["enter"], assets: Map<string, HTMLImageElement>): NonNullable<MenuPage["effects"]>["enter"] {
  return effects.map((effect) => ({
    duration90k: effect.duration90k,
    objects: effect.objects.flatMap((object) => {
      const image = assets.get(object.assetId);
      return image ? [{ ...object, image }] : [];
    }),
  }));
}

function normalizeState(state: SerializedMenuState, assets: Map<string, HTMLImageElement>): NonNullable<MenuButton["states"]["normal"]> {
  const { x, y, width, height } = state.bounds;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error("Invalid button state bounds.");
  const image = state.assetId === undefined ? undefined : assets.get(state.assetId);
  if (state.assetId !== undefined && !image) throw new Error(`Button state references missing image '${state.assetId}'.`);
  return {
    bounds: { x, y, width, height },
    ...(image ? { image } : {}),
    ...(state.soundId !== undefined ? { soundId: state.soundId } : {}),
    startObjectId: state.startObjectId,
    endObjectId: state.endObjectId,
    ...(state.repeat !== undefined ? { repeat: state.repeat } : {}),
  };
}

if (typeof document !== "undefined") void boot();
