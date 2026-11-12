import { HdmvVm, type TraceEntry, type VmOptions, type VmProgram } from "@bdmv2web/hdmv";
import { showStatus, visibleError } from "./runtime-status.js";
import { backgroundLabel, menuLog, sceneLabel, vmConsoleLogger } from "./runtime-diagnostics.js";
import { menuSceneKey, normalizeScene, validateEmbeddedDiscIR } from "./scene-normalizer.js";
export { createStatusToast, attachStatusCopy, copyText } from "./runtime-status.js";
export type { StatusToastOptions } from "./runtime-status.js";
import { CanvasViewport, drawMenu, installCanvasPointerInput, installKeyboardInput, MenuController, MenuLoopPlaybackBridge, MenuSoundPlayer, PreviewPlaybackBridge, type MenuInputConfig, type MenuLoopMediaPackage, type PlaybackBridge } from "./index.js";
import { resolveExternalPlayTarget, type ExternalMediaTargets, type ExternalPlayRequest } from "@bdmv2web/media-export/external-targets";
import { selectPopupScene, type SerializedScene } from "./igs-adapter.js";
import { format90kSeconds, requestExternalPlayback } from "./bdmv-url.js";
import type { BdjPackageData, BdjRuntimeHandle, BdjRuntimeCallbacks } from "./bdj-runtime.js";
import { startBdjMenuMedia, type BdjMenuMediaHandle } from "./bdj-menu-media.js";

export type PackageMenuMedia = MenuLoopMediaPackage;
export interface PackageData extends BdjPackageData { title?: string; scene: SerializedScene | null; popupScenes?: SerializedScene[]; menuScenes?: Array<{ playlistId: number; playItem?: number; scene: SerializedScene }>; menuPlaylistIds?: number[]; menuPlaylistMarks?: Array<{ playlistId: number; marks: Array<{ index: number; playItemRef: number }> }>; preMenuPlaylistIds?: number[]; pgsTracks?: unknown[]; vmPrograms?: VmProgram[]; profile?: VmOptions["profile"]; limits?: VmOptions["limits"]; externalTargets?: ExternalMediaTargets; vmInitialProgramId?: number; vmFirstPlayProgramId?: number; sounds?: Record<number, string>; media?: MenuLoopMediaPackage; menuMedia?: PackageMenuMedia[]; inputConfig?: Partial<MenuInputConfig> }
interface Asset { id: string; dataUrl: string }
declare global { var __BDMV_MENU_DATA__: PackageData | undefined; var __BDMV_MENU_ASSETS__: Asset[][] | undefined; var __BDMV_BDMV_PATH__: string | undefined; var __BDMV_BDJ_CLIENT__: { start: (data: BdjPackageData, root: HTMLElement, callbacks: BdjRuntimeCallbacks, requestedBdjoId?: string) => BdjRuntimeHandle; installKeyboardInput: (target: Window, runtime: BdjRuntimeHandle) => () => void; installPointerInput: (root: HTMLElement, runtime: BdjRuntimeHandle) => () => void } | undefined; }

/** Build the menu VM from packaged data. The packaged player profile must reach the
 * VM here: the conversion-time VM already ran with it, and PSR-dependent button
 * commands (player language, country, region) must behave identically at run time. */
export function createMenuVm(data: PackageData, onTrace?: (entry: TraceEntry) => void): HdmvVm {
  if (data.profile !== undefined && (typeof data.profile !== "object" || data.profile === null || Array.isArray(data.profile))) throw new Error("Embedded player profile must be a JSON object.");
  return new HdmvVm(data.vmPrograms ?? [], { ...(onTrace ? { onTrace } : {}), ...(data.vmEntries ? { entries: data.vmEntries } : {}), ...(data.profile ? { profile: data.profile } : {}), ...(data.limits ? { limits: data.limits } : {}) });
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
    if (!data.scene && !data.bdjRuntime) throw new Error("The package contains no supported menu scene or BD-J application.");
    let scene = data.scene ? normalizeScene(data.scene, assetMap) : null;
    let activeMenuSceneKey = data.scene ? menuSceneKey(data.scene) : "";
    const status = document.getElementById("runtime-status"); const start = document.getElementById("start-menu") as HTMLButtonElement | null;
    const muteToggle = document.getElementById("audio-mute-toggle") as HTMLButtonElement | null;
    const canvas = document.getElementById("menu-canvas") as HTMLCanvasElement | null;
    const popupCanvas = document.getElementById("popup-canvas") as HTMLCanvasElement | null;
    const video = document.getElementById("menu-background") as HTMLVideoElement | null;
    const audio = document.getElementById("menu-audio") as HTMLAudioElement | null;
    if (!status || !start || !muteToggle || !canvas) throw new Error("The menu page is missing required runtime elements.");
    let viewport = new CanvasViewport(scene?.width ?? 1920, scene?.height ?? 1080);
    // Context for the console trace. The button is recorded by the controllers
    // and consumed by the next batch, so a line names the control that ran it.
    const logState = { scene: data.scene ? sceneLabel(data.scene) : "BD-J menu", button: "" };
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
    let bdjRuntimeHandle: BdjRuntimeHandle | null = null;
    let bdjPersistentError = false;
    let removeBdjKeyboard: (() => void) | undefined;
    let removeBdjPointer: (() => void) | undefined;
    let activeBdjoId: string | null = null;
    const bdjAudioPlayers = new Map<string, HTMLAudioElement>();
    const bdjBlockedAudioPlayers = new Set<string>();
    const bdjMenuVideos = new Map<string, BdjMenuMediaHandle>();
    let serverHdmvMode = false;
    let routeDiscTitle: (title: number, origin?: "user" | "startup" | "system" | "authored") => string = () => "ERROR: Disc title routing is not ready.";
    // The playlist the VM is currently playing. `LinkPI`/`LinkMK` address a
    // PlayItem inside it and carry no playlist operand of their own.
    let activeMenuPlaylist: number | null = data.media?.playlist ?? data.menuPlaylistIds?.[0] ?? null;
    const missingMenuMedia = new Set<string>();
    const controllerVm = {
      handleEvent: (...args: Parameters<HdmvVm["handleEvent"]>) => { if (serverHdmvMode) bdjRuntimeHandle?.sendHdmv({ kind: "event", event: args[0] }); else vm.handleEvent(...args); },
      snapshot: () => vm.snapshot(),
      applyMenuContext: (pageId: number, selectedButtonId: number | null) => { if (serverHdmvMode) bdjRuntimeHandle?.sendHdmv({ kind: "context", pageId, selectedButtonId }); else vm.applyMenuContext(pageId, selectedButtonId); },
      beginMenuAction: () => { if (!serverHdmvMode) vm.beginMenuAction(); },
      recoverMenuAction: (...args: Parameters<HdmvVm["recoverMenuAction"]>) => serverHdmvMode ? false : vm.recoverMenuAction(...args),
      executeButtonProgram: (...args: Parameters<HdmvVm["executeButtonProgram"]>): ReturnType<HdmvVm["executeButtonProgram"]> => {
        if (!serverHdmvMode) return vm.executeButtonProgram(...args);
        bdjRuntimeHandle?.sendHdmv({ kind: "button", commands: args[0] });
        return { ...vm.snapshot(), actions: [], terminated: false, buttonCommandTerminated: false, fault: null };
      },
    };
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
      controller = new MenuController(scene, controllerVm, { render: redraw, dispatchActions, diagnostic: (message) => showStatus(message), playSound: (soundId, buttonId) => soundPlayer.play(soundId, buttonId), invalidateSound: () => { soundPlayer.invalidate(); retrySound = null; start.hidden = true; }, activateButton: (pageId, button) => { logState.button = `button ${button.id} (page ${pageId})`; } }, data.inputConfig);
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
      if (!controller && !data.bdjRuntime) return { menuPlaylistRequested: false, completion: Promise.resolve() };
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
            popupController = new MenuController(popupScene, controllerVm, { render: drawPopup, dispatchActions, diagnostic: (message) => showStatus(message), playSound: (soundId, buttonId) => soundPlayer.play(soundId, buttonId), invalidateSound: () => soundPlayer.invalidate(), activateButton: (pageId, button) => { logState.button = `popup button ${button.id} (page ${pageId})`; } }, data.inputConfig);
            const rect = popupCanvas.getBoundingClientRect(); popupViewport.resize(popupCanvas, rect.width, rect.height, window.devicePixelRatio || 1);
            removePopupPointer = installCanvasPointerInput(popupCanvas, popupViewport, popupController, () => { const size = popupCanvas.getBoundingClientRect(); return { width: size.width, height: size.height }; });
            popupController.start();
            if (inputStarted) queueMicrotask(() => { removeKeyboard?.(); if (popupController) removeKeyboard = installKeyboardInput(window, popupController); });
            drawPopup();
          }
        } else if (action.type === "TITLE_SEARCH" && typeof action.payload.title === "number") {
          closePopup();
          const result = routeDiscTitle(action.payload.title);
          if (result.startsWith("ERROR:")) {
            showStatus(result.slice(6).trim(), { persist: true, error: true });
            if (vm.recoverMenuAction()) { controller?.syncVmContext(); pendingActions.length = 0; continue; }
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
    const entryForTitle = (title: number) => {
      const entries = data.vmEntries ?? [];
      return title === 0 ? entries.find((item) => item.kind === "topMenu")
        : title === 0xffff ? entries.find((item) => item.kind === "firstPlay")
          : entries.filter((item) => item.kind === "title")[title - 1];
    };
    const setServerHdmvMode = (active: boolean): void => {
      serverHdmvMode = active;
      const javaCanvas = document.querySelector<HTMLCanvasElement>("#bdj-runtime-root canvas");
      if (javaCanvas) javaCanvas.hidden = active;
      if (active) {
        removeBdjKeyboard?.(); removeBdjKeyboard = undefined;
        removeBdjPointer?.(); removeBdjPointer = undefined;
      } else if (bdjRuntimeHandle) {
        removeKeyboard?.(); removePointer?.();
        const javaRoot = document.getElementById("bdj-runtime-root");
        if (javaRoot) {
          removeBdjKeyboard?.(); removeBdjPointer?.();
          const bdjClient = globalThis.__BDMV_BDJ_CLIENT__;
          if (!bdjClient) return;
          removeBdjKeyboard = bdjClient.installKeyboardInput(window, bdjRuntimeHandle);
          removeBdjPointer = bdjClient.installPointerInput(javaRoot, bdjRuntimeHandle);
        }
      }
    };
    const applyServerHdmvActions = (actions: ReturnType<HdmvVm["drainActions"]>, origin: "user" | "startup" | "system" | "authored" = "authored"): void => {
      if (!actions.length) return;
      const titleOrigin = ["user", "startup", "system", "authored"].includes(origin) ? origin : "authored";
      setServerHdmvMode(true);
      for (const action of actions) {
        if (action.type === "TITLE_SEARCH" && typeof action.payload.title === "number") {
          bdjRuntimeHandle?.sendTitle(action.payload.title, false, undefined, titleOrigin);
        } else if (["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"].includes(action.type) && typeof action.payload.playlist === "number") {
          const playlist = action.payload.playlist;
          const playItem = requestedPlayItem(playlist, action);
          const target = (data.menuScenes ?? []).find((item) => item.playlistId === playlist && (item.playItem ?? 0) === playItem)
            ?? (data.menuScenes ?? []).find((item) => item.playlistId === playlist);
          if (!target) { showStatus(`HDMV menu playlist ${playlist} PlayItem ${playItem} has no packaged IGS scene.`, { persist: true }); continue; }
          activeMenuPlaylist = playlist;
          activateMenuScene(target);
          menuLog(`${action.type} playlist ${playlist} PlayItem ${playItem} → ${sceneLabel(target.scene)}`);
        } else if (["LINK_PLAY_ITEM", "LINK_PLAY_MARK"].includes(action.type) && activeMenuPlaylist !== null) {
          const playItem = requestedPlayItem(activeMenuPlaylist, action);
          const target = (data.menuScenes ?? []).find((item) => item.playlistId === activeMenuPlaylist && (item.playItem ?? 0) === playItem);
          if (target) activateMenuScene(target);
        } else if (action.type === "SET_BUTTON_PAGE" && typeof action.payload.packed === "number") {
          controller?.applySetButtonPage(action.payload.packed);
        } else if (action.type === "ENABLE_BUTTON" && typeof action.payload.button === "number") {
          controller?.setButtonEnabled(action.payload.button, true);
        } else if (action.type === "DISABLE_BUTTON" && typeof action.payload.button === "number") {
          controller?.setButtonEnabled(action.payload.button, false);
        } else if (action.type === "POPUP_OFF") closePopup();
      }
    };
    const launchBdj = (bdjoId: string): void => {
      if (bdjRuntimeHandle) { activeBdjoId = bdjoId; return; }
      const root = document.getElementById("bdj-runtime-root");
      if (!root) throw new Error("The menu page has no BD-J Java window root.");
      removeKeyboard?.(); removeKeyboard = undefined;
      removePointer?.(); removePointer = undefined;
      removePopupPointer?.(); removePopupPointer = undefined;
      activeBdjoId = bdjoId;
      const bdjClient = globalThis.__BDMV_BDJ_CLIENT__;
      if (!bdjClient) throw new Error("The native BD-J client script is missing from this package.");
      bdjRuntimeHandle = bdjClient.start(data, root, {
        report: (message, error) => { if (error === true) bdjPersistentError = true; showStatus(message, { persist: error === true, error: error === true }); },
        trace: (message) => { console.info(`[BDMV BD-J] ${message}`); menuLog(message); },
        hdmvMode: setServerHdmvMode,
        hdmvActions: applyServerHdmvActions,
        frameReady: () => { if (!bdjPersistentError) showStatus(`BD-J application from BDJO ${activeBdjoId} is running.`); },
        playerHandoff: (result) => {
          if (result.status !== "unavailable" && result.status !== "error") return;
          bdjPersistentError = true;
          const source = result.source ? ` (${result.source.path}${result.source.offset ? ` at ${result.source.offset}` : ""})` : "";
          showStatus(`${result.message ?? `Feature playback ${result.status}.`}${source}`, { persist: true, error: true });
        },
        playerMenuMedia: (event) => {
          if (!video) { bdjRuntimeHandle?.sendPlayerEvent(event.playerId, "error"); return; }
          bdjMenuVideos.get(event.playerId)?.stop();
          const handle = startBdjMenuMedia(event, video, audio, (playerId, mediaEvent) => {
          if (mediaEvent === "ended" || mediaEvent.startsWith("missing-ended|") || mediaEvent === "error" || mediaEvent === "stopped") bdjMenuVideos.delete(playerId);
            bdjRuntimeHandle?.sendPlayerEvent(playerId, mediaEvent);
          }, (message, error) => {
            if (error) bdjPersistentError = true;
            showStatus(message, { persist: true, ...(error ? { error: true } : {}) });
          });
          if (handle) bdjMenuVideos.set(event.playerId, handle);
        },
        menuMediaUnavailable: (result) => {
          bdjPersistentError = true;
          const source = result.source ? ` (${result.source.path}${result.source.offset ? ` at ${result.source.offset}` : ""})` : "";
          showStatus(`BD-J menu media playlist ${String(result.playlist ?? "").padStart(5, "0")} is unavailable: ${result.message}${source}`, { persist: true, error: true });
        },
        retryMenuMedia: () => {
          for (const player of bdjMenuVideos.values()) player.retry();
          for (const playerId of bdjBlockedAudioPlayers) {
            const player = bdjAudioPlayers.get(playerId);
            if (!player) { bdjBlockedAudioPlayers.delete(playerId); continue; }
            void player.play().then(() => {
              if (bdjAudioPlayers.get(playerId) !== player) return;
              bdjBlockedAudioPlayers.delete(playerId);
              bdjRuntimeHandle?.sendPlayerEvent(playerId, "started");
            }).catch((error: unknown) => {
              if (bdjAudioPlayers.get(playerId) !== player) return;
              if (error instanceof Error && error.name === "NotAllowedError") bdjBlockedAudioPlayers.add(playerId);
              else { bdjBlockedAudioPlayers.delete(playerId); bdjRuntimeHandle?.sendPlayerEvent(playerId, "error"); }
            });
          }
        },
        playerResource: (playerId, path) => {
          const file = data.bdjFiles?.find((item) => item.packagePath === path);
          if (!file) { bdjPersistentError = true; showStatus(`BD-J media resource ${path} is not in the packaged application files.`, { persist: true, error: true }); bdjRuntimeHandle?.sendPlayerEvent(playerId, "error"); return; }
          const player = new Audio(new URL(file.packagePath, document.baseURI).href);
          player.preload = "auto";
          bdjAudioPlayers.get(playerId)?.pause();
          bdjBlockedAudioPlayers.delete(playerId);
          bdjAudioPlayers.set(playerId, player);
          player.addEventListener("ended", () => { if (bdjAudioPlayers.get(playerId) === player) { bdjAudioPlayers.delete(playerId); bdjBlockedAudioPlayers.delete(playerId); bdjRuntimeHandle?.sendPlayerEvent(playerId, "ended"); } }, { once: true });
          player.addEventListener("error", () => { if (bdjAudioPlayers.get(playerId) === player) { bdjAudioPlayers.delete(playerId); bdjBlockedAudioPlayers.delete(playerId); bdjRuntimeHandle?.sendPlayerEvent(playerId, "error"); } }, { once: true });
          void player.play().then(() => {
            if (bdjAudioPlayers.get(playerId) === player) bdjRuntimeHandle?.sendPlayerEvent(playerId, "started");
          }).catch((error: unknown) => {
            if (bdjAudioPlayers.get(playerId) === player) {
              const blocked = error instanceof Error && error.name === "NotAllowedError";
              if (blocked) bdjBlockedAudioPlayers.add(playerId);
              else { bdjBlockedAudioPlayers.delete(playerId); bdjAudioPlayers.delete(playerId); }
              bdjRuntimeHandle?.sendPlayerEvent(playerId, blocked ? "blocked" : "error");
              showStatus(blocked ? "BD-J audio is ready. Press a menu key or click the scene to play it." : `BD-J media resource could not start: ${error instanceof Error ? error.message : String(error)}`, { persist: true, error: !blocked });
            }
          });
        },
        playerStop: (playerId) => {
          const player = bdjAudioPlayers.get(playerId);
          if (player) { player.pause(); player.currentTime = 0; bdjAudioPlayers.delete(playerId); bdjBlockedAudioPlayers.delete(playerId); bdjRuntimeHandle?.sendPlayerEvent(playerId, "stopped"); }
          const menuPlayer = bdjMenuVideos.get(playerId);
          if (menuPlayer) { menuPlayer.stop(); bdjMenuVideos.delete(playerId); }
        },
      }, bdjoId);
      removeBdjKeyboard = bdjClient.installKeyboardInput(window, bdjRuntimeHandle);
      removeBdjPointer = bdjClient.installPointerInput(root, bdjRuntimeHandle);
      showStatus(`Starting BD-J application from BDJO ${bdjoId}.`);
    };
    routeDiscTitle = (title: number, origin: "user" | "startup" | "system" | "authored" = "user"): string => {
      const entry = entryForTitle(title);
      if (!entry) return `ERROR: Title ${title} has no INDEX entry.`;
      if (entry.target.objectType === "BDJ" && typeof entry.target.target === "string") {
        const bdjoId = entry.target.target.replace(/\.bdjo$/i, "");
        try { launchBdj(bdjoId); }
        catch (error) { return `ERROR: ${error instanceof Error ? error.message : String(error)}`; }
        bdjRuntimeHandle?.sendTitle(title, true, bdjoId, origin);
        menuLog(`TITLE_SEARCH ${title} → BDJO ${bdjoId}`);
        return "requested";
      }
      if (activeBdjoId && bdjRuntimeHandle) {
        bdjRuntimeHandle.sendTitle(title, false, activeBdjoId, origin);
        removeBdjKeyboard?.(); removeBdjKeyboard = undefined;
        removeBdjPointer?.(); removeBdjPointer = undefined;
        activeBdjoId = null;
      }
      const selected = vm.selectTitle(title);
      if (selected.diagnostic) return `ERROR: ${selected.diagnostic.message}`;
      pendingActions.push(...vm.drainActions());
      if (inputStarted && controller) {
        removeKeyboard?.(); removePointer?.();
        removePointer = installCanvasPointerInput(canvas, viewport, controller, () => { const rect = canvas.getBoundingClientRect(); return { width: rect.width, height: rect.height }; });
        removeKeyboard = installKeyboardInput(window, controller);
      }
      void dispatchActions().completion;
      return "requested";
    };
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
    const armAutoMuteRestoreAfterDispatch = () => {
      if (armAutoMuteTimer !== undefined) clearTimeout(armAutoMuteTimer);
      armAutoMuteTimer = setTimeout(() => {
        armAutoMuteTimer = undefined;
        if (menuMuted && !manualMuted) armAutoMuteRestore();
      }, 0);
    };
    const setMenuMuted = (muted: boolean, manual = false) => {
      if (manual) {
        manualMuted = muted;
        disarmAutoMuteRestore();
      }
      applyMenuMuted(muted);
      if (muted && !manual && !manualMuted) armAutoMuteRestoreAfterDispatch();
      else if (!muted) disarmAutoMuteRestore();
    };
    muteToggle.addEventListener("click", () => setMenuMuted(!menuMuted, true));
    const redraw = () => {
      if (!controller || !scene) return;
      const rect = canvas.getBoundingClientRect(); const context = canvas.getContext("2d");
      if (context) drawMenu(context, scene, controller, viewport, rect.width, rect.height, window.devicePixelRatio || 1);
      ensureAnimationLoop();
    };
    if (scene) controller = new MenuController(scene, controllerVm, { render: redraw, dispatchActions, diagnostic: (message) => { showStatus(message); }, playSound: (soundId, buttonId) => soundPlayer.play(soundId, buttonId), invalidateSound: () => { soundPlayer.invalidate(); retrySound = null; start.hidden = true; }, activateButton: (pageId, button) => { logState.button = `button ${button.id} (page ${pageId})`; } }, data.inputConfig);
    start.textContent = data.bdjRuntime ? "Start or reconnect BD-J session" : "Start menu preview";
    start.hidden = false; start.disabled = false; showStatus(data.bdjRuntime ? "Select Start or reconnect to the live BD-J session." : "Images decoded. Select Start menu preview to enable input.");
    let removePointer: (() => void) | undefined;
    const startMenuPreview = async (): Promise<void> => {
      if (retrySound) { const retry = retrySound; retrySound = null; start.disabled = true; start.hidden = true; retry(); return; }
      if (retryMedia) { const retry = retryMedia; retryMedia = null; start.disabled = true; start.hidden = true; retry(); return; }
      if (inputStarted) return;
      inputStarted = true; start.disabled = true; start.hidden = true;
      let menuMediaStarted: boolean | undefined;
      let pending = { menuPlaylistRequested: false, completion: Promise.resolve() };
      if (!data.bdjRuntime && data.vmInitialProgramId !== undefined) {
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
      if (data.bdjRuntime && !bdjRuntimeHandle) {
        const firstPlay = data.vmEntries?.find((entry) => entry.kind === "firstPlay");
        const topMenu = data.vmEntries?.find((entry) => entry.kind === "topMenu");
        const initialBdj = firstPlay?.target.objectType === "BDJ" ? { title: 0xffff, target: firstPlay.target.target }
          : firstPlay?.target.objectType === "HDMV" && topMenu?.target.objectType === "BDJ" ? { title: 0xffff, target: topMenu.target.target }
            : !firstPlay && topMenu?.target.objectType === "BDJ" ? { title: 0, target: topMenu.target.target } : undefined;
        if (initialBdj && typeof initialBdj.target === "string") {
          const result = routeDiscTitle(initialBdj.title, "startup");
          if (result.startsWith("ERROR:")) { showStatus(result.slice("ERROR: ".length), { persist: true, error: true }); return; }
        } else {
          showStatus("BD-J package has no First Play or Top Menu entry for the local service.", { persist: true, error: true });
          return;
        }
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
      if (!data.bdjRuntime && menuMediaStarted !== false) showStatus("Menu preview ready. Use arrow keys and Enter, or select a visible button.");
      if (controller) {
        const initialRect = canvas.getBoundingClientRect();
        viewport.resize(canvas, initialRect.width, initialRect.height, window.devicePixelRatio || 1);
        controller.start();
      }
      void dispatchActions().completion;
      // The dispatch above can switch scenes synchronously and install input
      // for the switched controller; remove those listeners before installing
      // the final set so one input event reaches one controller.
      removeKeyboard?.();
      removePointer?.();
      if (controller && !bdjRuntimeHandle) {
        removeKeyboard = installKeyboardInput(window, popupController ?? controller);
        removePointer = installCanvasPointerInput(canvas, viewport, controller, () => { const rect = canvas.getBoundingClientRect(); return { width: rect.width, height: rect.height }; });
      }
      redraw();
    };
    // The test host awaits a fired listener's return value, so the DOM listener
    // stays async and returns the preview promise.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    start.addEventListener("click", startMenuPreview);
    window.addEventListener("pagehide", () => {
      removeKeyboard?.(); removePointer?.();
      removeBdjKeyboard?.(); removeBdjPointer?.(); bdjRuntimeHandle?.close();
      disarmAutoMuteRestore();
    }, { once: true });
  } catch (error) { visibleError(error); }
}

/** Check that the embedded DiscIR belongs to this runtime. The runtime never
 * reads the IR; its schema, duplicate-ID and reference rules are enforced by
 * `parseDiscIR` when the package is written. */

if (typeof document !== "undefined") void boot();
