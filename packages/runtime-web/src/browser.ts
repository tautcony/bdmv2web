import { HdmvVm, type TraceEntry, type VmOptions, type VmProgram } from "@bdmv-web/hdmv";
import { CanvasViewport, drawMenu, installCanvasPointerInput, installKeyboardInput, MenuController, MenuLoopPlaybackBridge, MenuSoundPlayer, PreviewPlaybackBridge, type MenuButton, type MenuInputConfig, type MenuLoopMediaPackage, type MenuScene, type PlaybackBridge } from "./index.js";
import { resolveExternalPlayTarget, type ExternalMediaTargets, type ExternalPlayRequest } from "@bdmv-web/media-export/external-targets";
import type { SerializedMenuState, SerializedScene } from "./igs-adapter.js";

export interface PackageData { ir: unknown; title?: string; scene: SerializedScene | null; vmPrograms?: VmProgram[]; vmEntries?: VmOptions["entries"]; profile?: VmOptions["profile"]; externalTargets?: ExternalMediaTargets; vmInitialProgramId?: number; vmFirstPlayProgramId?: number; sounds?: Record<number, string>; media?: MenuLoopMediaPackage; inputConfig?: Partial<MenuInputConfig> }
interface Asset { id: string; dataUrl: string }
declare global { var __BDMV_MENU_DATA__: PackageData | undefined; var __BDMV_MENU_ASSETS__: Asset[][] | undefined; }

/** Build the menu VM from packaged data. The packaged player profile must reach the
 * VM here: the conversion-time VM already ran with it, and PSR-dependent button
 * commands (player language, country, region) must behave identically at run time. */
export function createMenuVm(data: PackageData, onTrace?: (entry: TraceEntry) => void): HdmvVm {
  if (data.profile !== undefined && (typeof data.profile !== "object" || data.profile === null || Array.isArray(data.profile))) throw new Error("Embedded player profile must be a JSON object.");
  return new HdmvVm(data.vmPrograms ?? [], { ...(onTrace ? { onTrace } : {}), ...(data.vmEntries ? { entries: data.vmEntries } : {}), ...(data.profile ? { profile: data.profile } : {}) });
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
    const scene = normalizeScene(data.scene, assetMap);
    const status = document.getElementById("runtime-status"); const start = document.getElementById("start-menu") as HTMLButtonElement | null;
    const canvas = document.getElementById("menu-canvas") as HTMLCanvasElement | null;
    const video = document.getElementById("menu-background") as HTMLVideoElement | null;
    const audio = document.getElementById("menu-audio") as HTMLAudioElement | null;
    if (!status || !start || !canvas) throw new Error("The menu page is missing required runtime elements.");
    const viewport = new CanvasViewport(scene.width, scene.height);
    const vm = createMenuVm(data, vmConsoleLogger());
    if (data.vmInitialProgramId !== undefined) {
      if (!Number.isSafeInteger(data.vmInitialProgramId) || !(data.vmPrograms ?? []).some((program) => program.id === data.vmInitialProgramId)) throw new Error(`Invalid initial MovieObject ${String(data.vmInitialProgramId)}.`);
      vm.reset(data.vmInitialProgramId);
    }
    let retrySound: (() => void) | null = null;
    let retryMedia: (() => void) | null = null;
    const playbackBridge: PlaybackBridge = data.media && video && audio
      ? new MenuLoopPlaybackBridge(vm, video, audio, data.media, (message) => { showStatus(message); }, {
        offerRetry: (retry) => { retryMedia = retry; start.textContent = "Retry menu media"; start.hidden = false; start.disabled = false; },
        clearRetry: () => { retryMedia = null; if (!retrySound) start.hidden = true; },
      })
      : new PreviewPlaybackBridge(vm, (message) => { showStatus(message); });
    let controller: MenuController | null = null;
    const pendingActions: Array<ReturnType<HdmvVm["drainActions"]>[number]> = [];
    let externalRequestSequence = 0;
    const dispatchActions = () => {
      const requestSequence = ++externalRequestSequence;
      pendingActions.push(...vm.drainActions());
      if (!controller) return { menuPlaylistRequested: false, completion: Promise.resolve() };
      const mediaActions: Promise<void>[] = [];
      let menuPlaylistRequested = false;
      while (pendingActions.length) {
        const action = pendingActions.shift()!;
        if (action.type === "SET_BUTTON_PAGE") {
          const packed = action.payload.packed;
          if (typeof packed === "number") controller.applySetButtonPage(packed);
          else showStatus("VM emitted SET_BUTTON_PAGE without its packed operand.");
        } else if ((action.type === "ENABLE_BUTTON" || action.type === "DISABLE_BUTTON") && typeof action.payload.button === "number") {
          controller.setButtonEnabled(action.payload.button, action.type === "ENABLE_BUTTON");
        } else if (action.type === "TITLE_SEARCH" && typeof action.payload.title === "number" && data.vmEntries) {
          const selected = vm.selectTitle(action.payload.title);
          if (selected.diagnostic) {
            showStatus(selected.diagnostic.message);
            if (vm.recoverMenuAction()) { controller.syncVmContext(); pendingActions.length = 0; continue; }
          }
          pendingActions.push(...vm.drainActions());
        } else if (data.externalTargets && ["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"].includes(action.type) && !(action.type === "PLAY_PLAYLIST" && action.payload.playlist === data.media?.playlist && data.media)) {
          const result = resolveExternalPlayTarget(data.externalTargets, { type: action.type, ...action.payload } as ExternalPlayRequest);
          if (result.status === "unavailable") { showStatus(result.message, { persist: true }); vm.releaseExternalPlayback(action); continue; }
          const params = new URLSearchParams(location.hash.slice(1)); const port = params.get("bridgePort"); const token = params.get("bridgeToken");
          if (!port || !token || !/^\d{1,5}$/.test(port) || !/^[0-9a-f]{48}$/.test(token)) {
            // The user has to copy this path or launch the helper: keep it on screen.
            showStatus(`Open ${result.item.streamPath} manually, or launch start-menu.command to use the system player.`, { persist: true });
            vm.releaseExternalPlayback(action); continue;
          }
          const image = new Image();
          image.onload = () => { if (requestSequence === externalRequestSequence) showStatus(`System player requested for ${result.item.streamPath}. ${result.limitations.join(" ")}`); };
          image.onerror = () => { if (requestSequence === externalRequestSequence) showStatus(`Could not open ${result.item.streamPath}; check the local bridge and BDMV path.`, { persist: true }); };
          image.src = `http://127.0.0.1:${port}/open?token=${token}&clip=${encodeURIComponent(result.item.clipId)}`;
          vm.releaseExternalPlayback(action);
        } else {
          if (action.type === "PLAY_PLAYLIST" && action.payload.playlist === data.media?.playlist) menuPlaylistRequested = true;
          mediaActions.push(Promise.resolve(playbackBridge.dispatch(action)));
        }
      }
      return { menuPlaylistRequested, completion: Promise.all(mediaActions).then(() => undefined) };
    };
    let inputStarted = false;
    const soundPlayer = new MenuSoundPlayer(data.sounds ?? {}, (url) => new Audio(url), {
      report: (kind, message) => {
        showStatus(message);
        if (kind === "blocked") { start.textContent = "Retry sound"; start.hidden = false; start.disabled = false; }
        else if (kind === "unsupported" || kind === "asset") { start.hidden = true; retrySound = null; }
      },
      offerRetry: (retry) => { retrySound = retry; start.textContent = "Retry sound"; start.hidden = false; start.disabled = false; },
      isCurrent: (_soundId, buttonId) => !!controller && controller.button?.id === buttonId && controller.activatedButtonId === buttonId,
    });
    const redraw = () => {
      if (!controller) return;
      const rect = canvas.getBoundingClientRect(); const context = canvas.getContext("2d");
      if (context) drawMenu(context, scene, controller, viewport, rect.width, rect.height, window.devicePixelRatio || 1);
    };
    controller = new MenuController(scene, vm, { render: redraw, dispatchActions, diagnostic: (message) => { showStatus(message); }, playSound: (soundId, buttonId) => soundPlayer.play(soundId, buttonId), invalidateSound: () => { soundPlayer.invalidate(); retrySound = null; start.hidden = true; } }, data.inputConfig);
    start.hidden = false; start.disabled = false; showStatus("Images decoded. Select Start menu preview to enable input.");
    let removeKeyboard: (() => void) | undefined; let removePointer: (() => void) | undefined;
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
      removeKeyboard = installKeyboardInput(window, controller!);
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
    compositionTimeout90k: source.compositionTimeout90k,
    selectionTimeout90k: source.selectionTimeout90k,
    pages: source.pages.map((page) => ({
    id: page.id, uoMask: page.uoMask, defaultButtonId: page.defaultButtonId,
    ...(page.defaultActivatedButtonId !== undefined ? { defaultActivatedButtonId: page.defaultActivatedButtonId } : {}),
    ...(page.bogDefaults ? { bogDefaults: page.bogDefaults } : {}),
    animationFrameRateCode: page.animationFrameRateCode,
    rawEffects: page.rawEffects,
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
