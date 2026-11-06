import { HdmvVm, type TraceEntry, type VmOptions, type VmProgram } from "@bdmv2web/hdmv";
import { CanvasViewport, drawMenu, installCanvasPointerInput, installKeyboardInput, MenuController, MenuLoopPlaybackBridge, MenuSoundPlayer, PreviewPlaybackBridge, type MenuButton, type MenuInputConfig, type MenuLoopMediaPackage, type MenuPage, type MenuScene, type PlaybackBridge } from "./index.js";
import { resolveExternalPlayTarget, type ExternalMediaTargets, type ExternalPlayRequest } from "@bdmv2web/media-export/external-targets";
import { selectPopupScene, type SerializedMenuState, type SerializedScene } from "./igs-adapter.js";

export type PackageMenuMedia = MenuLoopMediaPackage;
export interface PackageData { ir: unknown; title?: string; scene: SerializedScene | null; popupScenes?: SerializedScene[]; menuScenes?: Array<{ playlistId: number; scene: SerializedScene }>; menuPlaylistIds?: number[]; pgsTracks?: unknown[]; vmPrograms?: VmProgram[]; vmEntries?: VmOptions["entries"]; profile?: VmOptions["profile"]; limits?: VmOptions["limits"]; externalTargets?: ExternalMediaTargets; vmInitialProgramId?: number; vmFirstPlayProgramId?: number; sounds?: Record<number, string>; media?: MenuLoopMediaPackage; menuMedia?: PackageMenuMedia[]; inputConfig?: Partial<MenuInputConfig> }
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

/** Render status updates as a translucent toast in the top-right corner. Ordinary
 * updates fade out again; persistent ones stay until the next update and accept
 * text selection, because instructions the user has to copy must not vanish. */
export function createStatusToast(host: StatusToastHost, timeoutMs = 4500): (message: string, options?: StatusToastOptions) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message, options = {}) => {
    host.textContent = message;
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

function showStatus(message: string, options?: StatusToastOptions): void {
  const element = document.getElementById("runtime-status");
  if (!element) return;
  statusToast ??= createStatusToast(element);
  statusToast(message, options);
}

function visibleError(error: unknown): void {
  const status = document.getElementById("runtime-status"); const detail = document.getElementById("runtime-diagnostics");
  if (status) status.role = "alert";
  showStatus("Menu preview could not start.", { persist: true, error: true });
  if (detail) { detail.hidden = false; detail.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
}

function vmConsoleLogger(): (entry: TraceEntry) => void {
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
      if (!commands.length && !actions && !events && !diagnostics) return;
      const shownCommands = commands.length <= 4
        ? commands.join(" → ")
        : `${commands.slice(0, 2).join(" → ")} → … +${commands.length - 3} → ${commands.at(-1)}`;
      const fields = [`${commands.length} step${commands.length === 1 ? "" : "s"}`];
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

function summarizeLabels(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => count === 1 ? value : `${value} x${count}`).join(",");
}

function fileUrlFromBdmvPath(bdmvPath: string, streamPath: string): string {
  const normalize = (path: string) => path.replace(/\\/g, "/").split("/").map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join("/");
  const base = bdmvPath.replace(/\\/g, "/");
  let bdmvUrl: URL;
  if (/^[A-Za-z]:\//.test(base)) bdmvUrl = new URL(`file:///${normalize(base)}/`);
  else if (base.startsWith("/")) bdmvUrl = new URL(`file://${normalize(base)}/`);
  else bdmvUrl = new URL(`${normalize(base.replace(/\/$/, ""))}/`, location.href);
  return new URL(normalize(streamPath), bdmvUrl).href;
}

function format90kSeconds(ticks: string): string {
  const value = BigInt(ticks);
  if (value < 0n) throw new RangeError("Playback offset cannot be negative.");
  const whole = value / 90_000n;
  const fraction = ((value % 90_000n) * 1_000_000n / 90_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function openExternalVideo(bdmvPath: string, streamPath: string, seekTime90k: string | null): string {
  const videoUrl = fileUrlFromBdmvPath(bdmvPath, streamPath);
  const platform = navigator.userAgent;
  if (/Macintosh|Mac OS X/i.test(platform)) {
    if (seekTime90k === null) throw new Error("The selected chapter position is unavailable.");
    // Always provide an explicit offset. IINA versions that apply mpv_start to
    // a reused player core can otherwise carry the previous chapter position.
    return `iina://open?url=${encodeURIComponent(videoUrl)}&mpv_start=${format90kSeconds(seekTime90k)}`;
  }
  if (/Windows/i.test(platform)) return `potplayer://${videoUrl}`;
  throw new Error("External playback is available on macOS and Windows.");
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
    const vm = createMenuVm(data, vmConsoleLogger());
    if (data.vmInitialProgramId !== undefined) {
      if (!Number.isSafeInteger(data.vmInitialProgramId) || !(data.vmPrograms ?? []).some((program) => program.id === data.vmInitialProgramId)) throw new Error(`Invalid initial MovieObject ${String(data.vmInitialProgramId)}.`);
      vm.reset(data.vmInitialProgramId);
    }
    let retrySound: (() => void) | null = null;
    let retryMedia: (() => void) | null = null;
    const menuMedia = (data.menuMedia ?? []).filter((item) => item.playlist !== data.media?.playlist);
    const playlistMedia = (playlist: number): PackageMenuMedia | undefined => playlist === data.media?.playlist ? data.media : menuMedia.find((item) => item.playlist === playlist);
    const playbackBridge: PlaybackBridge = data.media && video && audio
      ? new MenuLoopPlaybackBridge(vm, video, audio, data.media, (message) => { showStatus(message); }, {
        offerRetry: (retry) => { retryMedia = retry; start.textContent = "Retry menu media"; start.hidden = false; start.disabled = false; },
        clearRetry: () => { retryMedia = null; if (!retrySound) start.hidden = true; },
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
    const dispatchActions = () => {
      pendingActions.push(...vm.drainActions());
      if (!controller) return { menuPlaylistRequested: false, completion: Promise.resolve() };
      const mediaActions: Promise<void>[] = [];
      let menuPlaylistRequested = false;
      while (pendingActions.length) {
        const action = pendingActions.shift()!;
        const inputController = popupController ?? controller;
        if (action.type === "SET_BUTTON_PAGE") {
          const packed = action.payload.packed;
          if (typeof packed === "number") inputController?.applySetButtonPage(packed);
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
            popupController = new MenuController(popupScene, vm, { render: drawPopup, dispatchActions, diagnostic: (message) => showStatus(message), playSound: (soundId, buttonId) => soundPlayer.play(soundId, buttonId), invalidateSound: () => soundPlayer.invalidate() }, data.inputConfig);
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
        } else if (action.type === "PLAY_PLAYLIST" && typeof action.payload.playlist === "number" && data.menuPlaylistIds?.includes(action.payload.playlist)) {
          const playlist = action.payload.playlist;
          const localMedia = playlistMedia(playlist);
          const target = data.menuScenes?.find((item) => item.playlistId === playlist);
          if (!target) {
            showStatus(`Menu playlist ${playlist} has no packaged IGS composition.`);
            vm.releaseExternalPlayback(action);
            continue;
          }
          // Always-on menu compositions replace the menu scene. Menu backgrounds are
          // switched through the playback bridge when that playlist has local media.
          const targetSceneKey = menuSceneKey(target.scene);
          const sameScene = activeMenuSceneKey === targetSceneKey;
          if (!sameScene) {
            closePopup();
            removePointer?.();
            scene = normalizeScene(target.scene, assetMap);
            activeMenuSceneKey = targetSceneKey;
            viewport = new CanvasViewport(scene.width, scene.height);
            controller = new MenuController(scene, vm, { render: redraw, dispatchActions, diagnostic: (message) => showStatus(message), playSound: (soundId, buttonId) => soundPlayer.play(soundId, buttonId), invalidateSound: () => { soundPlayer.invalidate(); retrySound = null; start.hidden = true; } }, data.inputConfig);
            const rect = canvas.getBoundingClientRect(); viewport.resize(canvas, rect.width, rect.height, window.devicePixelRatio || 1);
            controller.start();
            if (inputStarted) {
              removeKeyboard?.(); removePointer = installCanvasPointerInput(canvas, viewport, controller, () => { const size = canvas.getBoundingClientRect(); return { width: size.width, height: size.height }; });
              removeKeyboard = installKeyboardInput(window, controller);
            }
            redraw();
          }
          if (localMedia) mediaActions.push(Promise.resolve(playbackBridge.dispatch(action)));
          else {
            vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id });
            mediaActions.push(Promise.resolve(playbackBridge.startMenuBackground?.() ?? false).then(() => undefined));
          }
          menuPlaylistRequested = true;
        } else if (data.externalTargets && ["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"].includes(action.type) && !(action.type === "PLAY_PLAYLIST" && typeof action.payload.playlist === "number" && playlistMedia(action.payload.playlist))) {
          closePopup();
          const result = resolveExternalPlayTarget(data.externalTargets, { type: action.type, ...action.payload } as ExternalPlayRequest);
          if (result.status === "unavailable") { showStatus(result.message, { persist: true }); vm.releaseExternalPlayback(action); continue; }
          const bdmvPath = globalThis.__BDMV_BDMV_PATH__;
          if (!bdmvPath) { showStatus("The package is missing runtime/bdmv-config.js; set the BDMV path and reload.", { persist: true, error: true }); vm.releaseExternalPlayback(action); continue; }
          try {
            const protocolUrl = openExternalVideo(bdmvPath, result.item.streamPath, result.seekTime90k);
            setMenuMuted(true);
            showStatus(`Requested ${result.item.streamPath} in the external player.`);
            location.href = protocolUrl;
          } catch (error) {
            showStatus(error instanceof Error ? error.message : String(error), { persist: true, error: true });
          }
          vm.releaseExternalPlayback(action);
        } else {
          if (["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK", "TOP_MENU", "MENU_RETURN"].includes(action.type)) closePopup();
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
    const setMenuMuted = (muted: boolean) => {
      menuMuted = muted;
      if (video) video.muted = muted;
      if (audio) audio.muted = muted;
      soundPlayer.setMuted(muted);
      muteToggle.setAttribute("aria-pressed", String(muted));
      muteToggle.setAttribute("aria-label", muted ? "Unmute menu audio" : "Mute menu audio");
      muteToggle.title = muted ? "Unmute menu audio" : "Mute menu audio";
    };
    muteToggle.addEventListener("click", () => setMenuMuted(!menuMuted));
    const redraw = () => {
      if (!controller) return;
      const rect = canvas.getBoundingClientRect(); const context = canvas.getContext("2d");
      if (context) drawMenu(context, scene, controller, viewport, rect.width, rect.height, window.devicePixelRatio || 1);
      ensureAnimationLoop();
    };
    controller = new MenuController(scene, vm, { render: redraw, dispatchActions, diagnostic: (message) => { showStatus(message); }, playSound: (soundId, buttonId) => soundPlayer.play(soundId, buttonId), invalidateSound: () => { soundPlayer.invalidate(); retrySound = null; start.hidden = true; } }, data.inputConfig);
    start.hidden = false; start.disabled = false; showStatus("Images decoded. Select Start menu preview to enable input.");
    let removePointer: (() => void) | undefined;
    start.addEventListener("click", async () => {
      if (retrySound) { const retry = retrySound; retrySound = null; start.disabled = true; start.hidden = true; retry(); return; }
      if (retryMedia) { const retry = retryMedia; retryMedia = null; start.disabled = true; start.hidden = true; retry(); return; }
      if (inputStarted) return;
      inputStarted = true; start.disabled = true; start.hidden = true;
      let menuMediaStarted: boolean | undefined;
      let pending = { menuPlaylistRequested: false, completion: Promise.resolve() };
      if (data.vmInitialProgramId !== undefined && data.media && video && audio) {
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
      removeKeyboard = installKeyboardInput(window, popupController ?? controller!);
      removePointer = installCanvasPointerInput(canvas, viewport, controller!, () => { const rect = canvas.getBoundingClientRect(); return { width: rect.width, height: rect.height }; });
      redraw();
    });
    window.addEventListener("pagehide", () => { removeKeyboard?.(); removePointer?.(); }, { once: true });
  } catch (error) { visibleError(error); }
}

function validateEmbeddedDiscIR(value: unknown): { programs: Array<{ title: string }> } {
  if (!isRecord(value)) throw new Error("Embedded DiscIR must be a JSON object.");
  if (value.schemaVersion !== "1.0") throw new Error(`Unsupported DiscIR schema version '${String(value.schemaVersion ?? "missing")}'. Expected 1.0.`);
  for (const key of ["entries", "programs", "menus", "playlists", "mediaAssets", "diagnostics"]) if (!Array.isArray(value[key])) throw new Error(`Embedded DiscIR is invalid: '${key}' must be an array.`);
  const ids = new Set<string>();
  for (const key of ["entries", "programs", "menus", "playlists", "mediaAssets"] as const) {
    for (const [index, item] of (value[key] as unknown[]).entries()) {
      if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) throw new Error(`Embedded DiscIR is invalid: '${key}/${index}/id' must be a non-empty string.`);
      if (ids.has(item.id)) throw new Error(`Embedded DiscIR has duplicate ID '${item.id}'.`);
      ids.add(item.id);
    }
  }
  const programIds = new Set((value.programs as Array<Record<string, unknown>>).map((program) => program.id as string));
  const menuIds = new Set((value.menus as Array<Record<string, unknown>>).map((menu) => menu.id as string));
  for (const [index, playlist] of (value.playlists as unknown[]).entries()) {
    if (!isRecord(playlist) || !Array.isArray(playlist.programIds) || !Array.isArray(playlist.menuIds)) throw new Error(`Embedded DiscIR is invalid: 'playlists/${index}' requires programIds and menuIds arrays.`);
    if (playlist.programIds.some((id) => typeof id !== "string" || !programIds.has(id))) throw new Error(`Embedded DiscIR has an unresolved program reference in playlists/${index}.`);
    if (playlist.menuIds.some((id) => typeof id !== "string" || !menuIds.has(id))) throw new Error(`Embedded DiscIR has an unresolved menu reference in playlists/${index}.`);
  }
  for (const [index, program] of (value.programs as unknown[]).entries()) if (!isRecord(program) || typeof program.title !== "string") throw new Error(`Embedded DiscIR is invalid: 'programs/${index}/title' must be a string.`);
  return { programs: value.programs as Array<{ title: string }> };
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
