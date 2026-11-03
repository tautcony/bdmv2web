import { decodeInstruction, type ButtonCommandContext, type ButtonProgramResult, type HdmvVm, type NavigationAction, type RawCommand, type VmEvent } from "@bdmv-web/hdmv";
import type { SourceLocation } from "@bdmv-web/bdmv-parser";
export { adaptIgsScene } from "./igs-adapter.js";
export type { IgsAdapterDiagnostic, IgsSceneAdapterResult, SerializedMenuButton, SerializedMenuPage, SerializedMenuState, SerializedScene } from "./igs-adapter.js";
export { LinearPlaybackBridge } from "./linear-playback.js";
export type { LinearPlaybackAsset, LinearPlaybackHooks, LinearPlaybackMedia, LinearTimelineMapPort, LinearTimelinePosition } from "./linear-playback.js";
export interface Bounds { x: number; y: number; width: number; height: number }
export interface ButtonState { bounds: Bounds; image?: CanvasImageSource; soundId?: number; startObjectId?: number; endObjectId?: number; repeat?: boolean }
export interface MenuButton {
  id: number; bog: number; enabled: boolean; autoAction?: boolean;
  neighbors: { up: number; down: number; left: number; right: number };
  states: { normal?: ButtonState; selected?: ButtonState; activated?: ButtonState };
  commands: Array<{ bytes: string | Uint8Array; sourceOffset?: string; source?: SourceLocation }>;
}
export interface MenuPage {
  id: number;
  uoMask?: string;
  defaultButtonId: number;
  defaultActivatedButtonId?: number;
  bogDefaults?: Array<{ bog: number; defaultButtonId: number }>;
  animationFrameRateCode?: number;
  rawEffects?: { enterBytesHex: string; exitBytesHex: string; enterEffectCount: number; exitEffectCount: number };
  buttons: MenuButton[];
  allowedActions?: Partial<Record<"activate" | "move" | "popup" | "topMenu", boolean>>;
}
export interface MenuScene { width: number; height: number; compositionTimeout90k?: string | null; selectionTimeout90k?: string | null; pages: MenuPage[] }
export interface RuntimeVmPort {
  handleEvent(event: VmEvent): unknown;
  beginMenuAction?(): void;
  recoverMenuAction?(): boolean;
  executeButtonProgram?(commands: RawCommand[], context?: ButtonCommandContext): ButtonProgramResult;
  executeButtonCommand?(command: string | Uint8Array, source?: SourceLocation, context?: ButtonCommandContext): { status?: string; diagnostic?: { message?: string } | null; buttonCommandTerminated?: boolean };
}
export type InputKind = "up" | "down" | "left" | "right" | "activate" | "popup" | "topMenu" | "escape";
export type EscapeMapping = "popup" | "topMenu" | "custom" | "none";
export interface MenuInputConfig { escapeMapping: EscapeMapping }
export const DEFAULT_MENU_INPUT_CONFIG: Readonly<MenuInputConfig> = Object.freeze({ escapeMapping: "popup" });

export type PlaybackAction = Pick<NavigationAction, "id" | "generation" | "type" | "payload"> & Partial<Pick<NavigationAction, "source" | "waitFor">>;

/** Shared seam for the menu-only preview and a future timeline-backed player. */
export interface PlaybackBridge {
  dispatch(action: PlaybackAction): void | Promise<void>;
  isCurrent(generation: number): boolean;
  startMenuBackground?(): Promise<boolean>;
}

/** Source-space viewport shared by Canvas sizing and pointer hit testing. */
export class CanvasViewport {
  scale = 1; offsetX = 0; offsetY = 0;
  constructor(readonly width: number, readonly height: number) {}
  resize(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, dpr: number): void {
    const scale = Math.min(cssWidth / this.width, cssHeight / this.height);
    this.scale = scale; this.offsetX = (cssWidth - this.width * scale) / 2; this.offsetY = (cssHeight - this.height * scale) / 2;
    canvas.width = Math.round(cssWidth * dpr); canvas.height = Math.round(cssHeight * dpr);
    const context = canvas.getContext("2d");
    if (context) { context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, cssWidth, cssHeight); }
  }
  toSource(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } | null {
    const x = (clientX - rect.left - this.offsetX) / this.scale, y = (clientY - rect.top - this.offsetY) / this.scale;
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? null : { x, y };
  }
  toCss(context: CanvasRenderingContext2D, cssWidth: number, cssHeight: number, dpr = 1): void {
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, cssWidth, cssHeight);
    context.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.offsetX, dpr * this.offsetY);
  }
}

/** Logical-time scheduler. M5 can supply a media-time implementation through MenuScheduler. */
export class EventScheduler {
  private nowValue = 0; private nextId = 1;
  private readonly events = new Map<number, { due: number; scope: string; callback: () => void }>();
  get now(): number { return this.nowValue; }
  schedule(delayMs: number, scope: string, callback: () => void): number {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError("delay must be non-negative");
    const id = this.nextId++; this.events.set(id, { due: this.nowValue + delayMs, scope, callback }); return id;
  }
  cancelScope(scope: string): void { for (const [id, event] of this.events) if (event.scope === scope) this.events.delete(id); }
  advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError("delta must be non-negative");
    this.nowValue += deltaMs;
    while (true) {
      const due = [...this.events].filter(([, e]) => e.due <= this.nowValue).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!due) break; this.events.delete(due[0]); due[1].callback();
    }
  }
  pause(): void { this.pausedAt = this.nowValue; }
  resume(): void { this.pausedAt = null; }
  private pausedAt: number | null = null;
  advanceWhileRunning(deltaMs: number): void { if (this.pausedAt === null) this.advance(deltaMs); }
}
export interface MenuScheduler {
  /** Logical time and delays use milliseconds; M5 can map video time into this domain. */
  readonly now: number;
  schedule(delayMs: number, scope: string, callback: () => void): number;
  cancelScope(scope: string): void;
  pause(): void;
  resume(): void;
  advanceWhileRunning(deltaMs: number): void;
}

export interface RuntimeHooks { playSound?: (soundId: number, buttonId: number) => void; invalidateSound?: () => void; activateButton?: (pageId: number, button: MenuButton) => void; dispatchActions?: () => void; diagnostic?: (message: string) => void; render?: () => void; popup?: () => void; topMenu?: () => void; escape?: () => void }

export interface SoundAudioPort { play(): Promise<void> | void; addEventListener?(type: "error", listener: () => void, options?: { once?: boolean }): void }
export interface SoundPlayerHooks { report: (kind: "blocked" | "unsupported" | "asset" | "playback", message: string) => void; offerRetry: (retry: () => void) => void; isCurrent: (soundId: number, buttonId: number) => boolean }

/** Plays package-local WAVs and exposes an explicit, correlated gesture retry for autoplay blocks. */
export class MenuSoundPlayer {
  private requestId = 0;
  constructor(private readonly sounds: Readonly<Record<number, string>>, private readonly createAudio: (url: string) => SoundAudioPort, private readonly hooks: SoundPlayerHooks) {}
  invalidate(): void { this.requestId++; }
  play(soundId: number, buttonId: number): void {
    const requestId = ++this.requestId; const url = this.sounds[soundId];
    if (!url) { this.hooks.report("asset", `Sound ${soundId} for button ${buttonId} has no packaged WAV asset.`); return; }
    let audio: SoundAudioPort;
    try { audio = this.createAudio(url); }
    catch (error) { this.hooks.report("asset", `Could not load sound ${soundId}: ${errorMessage(error)}`); return; }
    audio.addEventListener?.("error", () => { if (requestId === this.requestId) this.hooks.report("asset", `Sound ${soundId} asset failed to load (${url}).`); }, { once: true });
    const start = (retry: boolean) => {
      let result: Promise<void> | void;
      try { result = audio.play(); } catch (error) { this.handleFailure(error, soundId, buttonId, url, requestId, audio, retry); return; }
      Promise.resolve(result).catch((error: unknown) => this.handleFailure(error, soundId, buttonId, url, requestId, audio, retry));
    };
    start(false);
  }
  private handleFailure(error: unknown, soundId: number, buttonId: number, url: string, requestId: number, audio: SoundAudioPort, retry: boolean): void {
    if (requestId !== this.requestId) return;
    const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
    if (name === "NotAllowedError") {
      if (!this.hooks.isCurrent(soundId, buttonId)) return;
      this.hooks.report("blocked", `Browser blocked sound ${soundId}; use the retry button to play it.`);
      this.hooks.offerRetry(() => { if (requestId === this.requestId && this.hooks.isCurrent(soundId, buttonId)) this.handleRetry(audio, soundId, buttonId, url, requestId); });
    } else if (name === "NotSupportedError") this.hooks.report("unsupported", `Browser does not support packaged sound ${soundId} (${url}).`);
    else this.hooks.report("playback", `Sound ${soundId} ${retry ? "retry" : "playback"} failed: ${errorMessage(error)}`);
  }
  private handleRetry(audio: SoundAudioPort, soundId: number, buttonId: number, url: string, requestId: number): void {
    let result: Promise<void> | void;
    try { result = audio.play(); } catch (error) { this.handleFailure(error, soundId, buttonId, url, requestId, audio, true); return; }
    Promise.resolve(result).catch((error: unknown) => this.handleFailure(error, soundId, buttonId, url, requestId, audio, true));
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }

/** Owns page/BOG/selection state and routes all activation through HDMV VM input. */
export class MenuController {
  pageIndex = 0; selectedButtonId: number | null = null; activatedButtonId: number | null = null;
  private readonly disabled = new Set<number>(); private bogSelections = new Map<string, number>(); private readonly scheduler: MenuScheduler; private readonly invalidUoMaskPages = new Set<number>(); private started = false; private readonly inputConfig: MenuInputConfig;
  constructor(readonly scene: MenuScene, readonly vm: RuntimeVmPort, readonly hooks: RuntimeHooks = {}, schedulerOrConfig: MenuScheduler | Partial<MenuInputConfig> = new EventScheduler()) {
    if (!scene.pages.length) throw new TypeError("menu scene must contain a page");
    const scheduler = isMenuScheduler(schedulerOrConfig);
    this.scheduler = scheduler ? schedulerOrConfig : new EventScheduler();
    const inputConfig = scheduler ? DEFAULT_MENU_INPUT_CONFIG : { ...DEFAULT_MENU_INPUT_CONFIG, ...schedulerOrConfig };
    if (!["popup", "topMenu", "custom", "none"].includes(inputConfig.escapeMapping)) throw new TypeError(`Invalid Escape mapping '${String(inputConfig.escapeMapping)}'.`);
    this.inputConfig = inputConfig as MenuInputConfig;
    this.selectPageDefault(false);
  }
  get page(): MenuPage { return this.scene.pages[this.pageIndex]!; }
  get button(): MenuButton | null { return this.page.buttons.find((b) => b.id === this.selectedButtonId) ?? null; }
  schedulePageEffect(delayMs: number, callback: () => void): number { return this.scheduler.schedule(delayMs, `page:${this.page.id}`, callback); }
  pause(): void { this.scheduler.pause(); }
  resume(): void { this.scheduler.resume(); }
  advanceWhileRunning(deltaMs: number): void { this.scheduler.advanceWhileRunning(deltaMs); }
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.button?.autoAction) this.handle("activate");
  }
  setPage(index: number): void {
    this.changePage(index, true);
  }
  applySetButtonPage(packed: number): void {
    if (!Number.isInteger(packed) || packed < 0 || packed > 0xffffffff) { this.hooks.diagnostic?.("VM emitted an invalid SET_BUTTON_PAGE value."); return; }
    const pageFlag = (packed & 0x80000000) !== 0;
    const effectsFlag = (packed & 0x40000000) !== 0;
    const buttonFlag = (packed & 0x20000000) !== 0;
    const pageId = (packed >>> 16) & 0xff;
    const buttonId = packed & 0xffff;
    if (effectsFlag) this.hooks.diagnostic?.(`SET_BUTTON_PAGE requests page effects for page ${pageId}; effects are not rendered in this preview.`);
    if (pageFlag) {
      const pageIndex = this.scene.pages.findIndex((page) => page.id === pageId);
      if (pageIndex < 0) { this.hooks.diagnostic?.(`SET_BUTTON_PAGE references missing page ${pageId}.`); return; }
      this.changePage(pageIndex, !buttonFlag);
    }
    if (!buttonFlag) return;
    if (buttonId === 0xffff) {
      this.selectedButtonId = null; this.activatedButtonId = null; this.hooks.invalidateSound?.(); this.hooks.render?.(); return;
    }
    const target = this.page.buttons.find((button) => button.id === buttonId);
    if (!this.isUsable(target)) { this.hooks.diagnostic?.(`SET_BUTTON_PAGE references unusable button ${buttonId} on page ${this.page.id}.`); return; }
    this.selectButton(buttonId);
  }
  private changePage(index: number, runAutoAction: boolean): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.scene.pages.length) throw new RangeError("page index out of range");
    this.scheduler.cancelScope(`page:${this.page.id}`); this.hooks.invalidateSound?.(); this.pageIndex = index; this.activatedButtonId = null; this.selectPageDefault(runAutoAction && this.started); this.hooks.render?.();
  }
  setButtonEnabled(id: number, enabled: boolean): void {
    enabled ? this.disabled.delete(id) : this.disabled.add(id);
    if (this.selectedButtonId === id && !this.isUsable(this.button)) { this.hooks.invalidateSound?.(); this.selectedButtonId = null; this.activatedButtonId = null; }
    this.hooks.render?.();
  }
  handle(kind: InputKind): void {
    if (kind === "escape") {
      if (!this.isUoAllowed(25)) return;
      if (this.inputConfig.escapeMapping === "popup") this.handle("popup");
      else if (this.inputConfig.escapeMapping === "topMenu") this.handle("topMenu");
      else if (this.inputConfig.escapeMapping === "custom") this.hooks.escape?.();
      return;
    }
    if (kind === "popup" || kind === "topMenu") {
      const permission = kind === "popup" ? "popup" : "topMenu";
      if (this.page.allowedActions?.[permission] === false || !this.isUoAllowed(kind === "popup" ? 24 : 0)) return;
      this.vm.beginMenuAction?.();
      if (kind === "popup") { this.hooks.popup?.(); this.vm.handleEvent({ type: "POPUP_MENU", channel: "keyboard" }); }
      else { this.hooks.topMenu?.(); this.vm.handleEvent({ type: "TOP_MENU", channel: "keyboard" }); }
      this.hooks.dispatchActions?.();
      return;
    }
    if (["up", "down", "left", "right"].includes(kind)) { this.move(kind as "up" | "down" | "left" | "right"); return; }
    if (this.page.allowedActions?.activate === false || !this.isUoAllowed(19)) return;
    const button = this.button; if (!this.isUsable(button)) return;
    const activatedPageId = this.page.id;
    this.vm.beginMenuAction?.();
    this.activatedButtonId = button.id; const state = button.states.selected;
    if (state?.soundId !== undefined && state.soundId !== 0xff) this.hooks.playSound?.(state.soundId, button.id);
    if (this.vm.executeButtonProgram) {
      try {
        const commands = button.commands.map(({ bytes, source }) => {
          const decoded = decodeInstruction(bytes, source);
          return { bytes: decoded.bytes, words: decoded.words, source: decoded.source };
        });
        const result = this.vm.executeButtonProgram(commands, "ig-button");
        if (result.fault?.message) { this.hooks.diagnostic?.(result.fault.message); this.vm.recoverMenuAction?.(); }
        else if (result.diagnostic?.message) { this.hooks.diagnostic?.(result.diagnostic.message); this.vm.recoverMenuAction?.(); }
        else this.hooks.dispatchActions?.();
      } catch (error) {
        this.vm.recoverMenuAction?.();
        this.hooks.diagnostic?.(error instanceof Error ? error.message : String(error));
      }
      this.hooks.activateButton?.(activatedPageId, button);
    } else if (this.vm.executeButtonCommand) {
      for (const command of button.commands) {
        const result = this.vm.executeButtonCommand(command.bytes, command.source, "ig-button");
        if (result.diagnostic?.message) this.hooks.diagnostic?.(result.diagnostic.message);
        if (result.status === "faulted" || result.diagnostic?.message) this.vm.recoverMenuAction?.();
        else this.hooks.dispatchActions?.();
        if (result.buttonCommandTerminated || result.status === "faulted" || result.status === "suspended" || result.status === "stopped") break;
      }
      this.hooks.activateButton?.(activatedPageId, button);
    } else if (button.commands.length) this.hooks.diagnostic?.(`Button ${button.id} has commands, but no HDMV button-command executor is connected.`);
    this.hooks.render?.();
  }
  hit(x: number, y: number): number | null {
    const match = this.page.buttons.filter((button) => this.isUsable(button) && contains(button.states.selected?.bounds ?? button.states.normal?.bounds, x, y));
    return match.length === 1 ? match[0]!.id : null;
  }
  selectFromPointer(x: number, y: number): boolean {
    if (!this.isUoAllowed(18)) return false;
    const id = this.hit(x, y); if (id === null) return false;
    this.selectButton(id, false);
    return this.selectedButtonId === id;
  }
  activatePointer(x: number, y: number): void {
    // A pointer-down is the combined select-and-activate operation. The regular
    // activate gate still applies in handle(); a blocked select cannot activate
    // whichever button happened to be focused before the click.
    if (!this.isUoAllowed(20)) return;
    const hit = this.hit(x, y); if (hit === null) return;
    const selectionChanged = this.selectedButtonId !== hit;
    if (selectionChanged && (!this.selectFromPointer(x, y) || this.selectedButtonId !== hit)) return;
    this.handle("activate");
  }
  private move(direction: "up" | "down" | "left" | "right"): void {
    const fieldIndex = ({ up: 14, down: 15, left: 16, right: 17 } as const)[direction];
    if (this.page.allowedActions?.move === false || !this.isUoAllowed(fieldIndex)) return;
    const current = this.button; if (!this.isUsable(current)) return;
    const targetId = current.neighbors[direction]; const target = this.page.buttons.find((b) => b.id === targetId);
    if (this.isUsable(target)) this.selectButton(targetId);
  }
  private isUsable(button: MenuButton | null | undefined): button is MenuButton {
    if (!button || !button.enabled || this.disabled.has(button.id) || !this.page.buttons.some((b) => b.bog === button.bog && b.id === button.id)) return false;
    // When the serialized page declares BOG defaults, they also describe which BOG IDs exist.
    return !this.page.bogDefaults || this.page.bogDefaults.some((entry) => entry.bog === button.bog);
  }
  private bogSelectionKey(pageId: number, bog: number): string { return `${pageId}:${bog}`; }
  private isUoAllowed(fieldIndex: number): boolean {
    const serialized = this.page.uoMask;
    if (serialized === undefined) return true;
    if (!/^(0|[1-9][0-9]*)$/.test(serialized)) {
      if (!this.invalidUoMaskPages.has(this.page.id)) {
        this.invalidUoMaskPages.add(this.page.id);
        this.hooks.diagnostic?.(`Page ${this.page.id} has an invalid decimal UO mask; menu input is blocked.`);
      }
      return false;
    }
    // uo_mask.c reads the first source bit first. Table field 0 is therefore the
    // most significant bit of the 64-bit decimal value preserved by the adapter.
    const sourceBit = 63 - fieldIndex;
    return ((BigInt(serialized) >> BigInt(sourceBit)) & 1n) === 0n;
  }
  private selectButton(id: number, runAutoAction = true): void {
    const target = this.page.buttons.find((button) => button.id === id);
    if (!this.isUsable(target)) return;
    const changed = this.selectedButtonId !== id;
    if (changed) {
      this.hooks.invalidateSound?.();
      this.activatedButtonId = null;
      this.selectedButtonId = id;
      this.bogSelections.set(this.bogSelectionKey(this.page.id, target.bog), id);
      this.hooks.render?.();
      // Pointer selection passes false, so hover never activates an auto-action button.
      // Other selection sources retain the immediate flag behavior; timing is not inferred.
      if (runAutoAction && target.autoAction) this.handle("activate");
    }
  }
  private selectPageDefault(runAutoAction: boolean): void {
    const page = this.page;
    // BOG defaults seed page-scoped remembered choices. The page-level default remains
    // authoritative for initial focus; there is no input action in SerializedScene that
    // means “switch to another BOG”.
    for (const entry of page.bogDefaults ?? []) {
      const button = page.buttons.find((candidate) => candidate.id === entry.defaultButtonId && candidate.bog === entry.bog && candidate.enabled && !this.disabled.has(candidate.id));
      if (button && !this.bogSelections.has(this.bogSelectionKey(page.id, entry.bog))) this.bogSelections.set(this.bogSelectionKey(page.id, entry.bog), button.id);
      else if (!button && entry.defaultButtonId !== 0xffff) this.hooks.diagnostic?.(`Page ${page.id} BOG ${entry.bog} default button ${entry.defaultButtonId} is not a usable member of that BOG.`);
    }
    const declaredDefault = page.defaultButtonId === 0xffff ? undefined : page.buttons.find((b) => b.id === page.defaultButtonId && this.isUsable(b));
    this.selectedButtonId = declaredDefault?.id ?? null;
    this.activatedButtonId = null;
    const defaultActivatedButtonId = page.defaultActivatedButtonId;
    if (defaultActivatedButtonId !== undefined && defaultActivatedButtonId !== 0xfffe && defaultActivatedButtonId !== 0xffff) {
      this.hooks.diagnostic?.(`Page ${page.id} declares default activated button ${defaultActivatedButtonId}, but its runtime semantics are unverified.`);
    }
    if (declaredDefault) this.bogSelections.set(this.bogSelectionKey(page.id, declaredDefault.bog), declaredDefault.id);
    if (runAutoAction && declaredDefault?.autoAction) this.handle("activate");
  }
}

function isMenuScheduler(value: MenuScheduler | Partial<MenuInputConfig>): value is MenuScheduler {
  return typeof (value as MenuScheduler).schedule === "function" && typeof (value as MenuScheduler).cancelScope === "function" &&
    typeof (value as MenuScheduler).pause === "function" && typeof (value as MenuScheduler).resume === "function" &&
    typeof (value as MenuScheduler).advanceWhileRunning === "function" && typeof (value as MenuScheduler).now === "number";
}

export function drawMenu(context: CanvasRenderingContext2D, scene: MenuScene, controller: MenuController, viewport: CanvasViewport, cssWidth: number, cssHeight: number, dpr = 1): void {
  const output = context.canvas;
  const pageLayer = output?.ownerDocument ? menuPageLayer(output, scene.width, scene.height) : null;
  const layerContext = pageLayer?.getContext("2d") ?? null;
  if (layerContext) {
    layerContext.setTransform(1, 0, 0, 1, 0, 0);
    layerContext.clearRect(0, 0, scene.width, scene.height);
    for (const button of controller.page.buttons) {
      const state = !button.enabled ? button.states.normal : button.id === controller.activatedButtonId ? button.states.activated : button.id === controller.selectedButtonId ? button.states.selected : button.states.normal;
      if (state?.image) layerContext.drawImage(state.image, state.bounds.x, state.bounds.y, state.bounds.width, state.bounds.height);
    }
  }
  viewport.toCss(context, cssWidth, cssHeight, dpr); context.save(); context.beginPath(); context.rect(0, 0, scene.width, scene.height); context.clip();
  if (layerContext && pageLayer) context.drawImage(pageLayer, 0, 0, scene.width, scene.height);
  else for (const button of controller.page.buttons) {
    const state = !button.enabled ? button.states.normal : button.id === controller.activatedButtonId ? button.states.activated : button.id === controller.selectedButtonId ? button.states.selected : button.states.normal;
    if (state?.image) context.drawImage(state.image, state.bounds.x, state.bounds.y, state.bounds.width, state.bounds.height);
  }
  context.restore();
}

const menuPageLayers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function menuPageLayer(output: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  let layer = menuPageLayers.get(output);
  if (!layer) {
    layer = output.ownerDocument.createElement("canvas");
    menuPageLayers.set(output, layer);
  }
  if (layer.width !== width) layer.width = width;
  if (layer.height !== height) layer.height = height;
  return layer;
}

function contains(b: Bounds | undefined, x: number, y: number): boolean { return !!b && x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height; }

/** Menu-only action bridge: correlated failures unblock the VM without a fake ended event. */
export class PreviewPlaybackBridge implements PlaybackBridge {
  private currentGeneration = 0;
  constructor(private readonly vm: HdmvVm, private readonly report: (message: string) => void) {}
  dispatch(action: PlaybackAction): void {
    this.currentGeneration = Math.max(this.currentGeneration, action.generation);
    if (["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK", "LINK_PLAY_ITEM", "LINK_PLAY_MARK", "TITLE_SEARCH"].includes(action.type)) {
      this.report(`Playback unavailable in menu-only preview (${action.type}).`);
      this.vm.handleEvent({ type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id });
    }
  }
  isCurrent(generation: number): boolean { return generation === this.currentGeneration; }
}

export interface MenuLoopMediaPackage {
  playlist: number;
  background: { path: string; loop: true };
  /** Each entry is one source audio lane. Same-language lanes remain distinct. */
  audioTracks: Array<{ streamNumber: number; psrStreamNumber?: number; path: string; language: string; pid?: number; variantId?: string }>;
}

export interface MenuLoopPlaybackHooks {
  offerRetry?: (retry: () => void) => void;
  clearRetry?: () => void;
  /** Called only after a local audio variant has loaded, sought, and resumed successfully. */
  audioTrackChanged?: (track: MenuLoopMediaPackage["audioTracks"][number]) => void;
  trackSwitchTimeoutMs?: number;
}

/** Plays the exported menu loop for its matching HDMV playlist and applies primary-audio selections. */
export class MenuLoopPlaybackBridge implements PlaybackBridge {
  private currentGeneration = 0;
  private selectedAudioStream: number;
  private confirmedPrimaryAudioStream: number;
  private switchSequence = 0;
  private started = false;
  private startPromise: Promise<boolean> | null = null;
  private retryGeneration = 0;
  constructor(
    private readonly vm: HdmvVm,
    private readonly video: HTMLVideoElement,
    private readonly audio: HTMLAudioElement,
    private readonly media: MenuLoopMediaPackage,
    private readonly report: (message: string) => void,
    private readonly hooks: MenuLoopPlaybackHooks = {},
  ) {
    this.confirmedPrimaryAudioStream = vm.registers.read({ kind: "psr", index: 1 });
    this.selectedAudioStream = media.audioTracks.find((track) => this.psrStreamNumber(track) === this.confirmedPrimaryAudioStream)?.streamNumber ?? [...media.audioTracks].sort((left, right) => left.streamNumber - right.streamNumber)[0]?.streamNumber ?? 0;
  }

  async dispatch(action: PlaybackAction): Promise<void> {
    if (action.generation < this.currentGeneration) return;
    if (action.generation > this.currentGeneration) this.switchSequence++;
    this.currentGeneration = Math.max(this.currentGeneration, action.generation);
    if (action.type === "SET_STREAM") {
      const stream = action.payload?.primaryAudioStream;
      if (typeof stream === "number" && stream > 0) await this.selectAudioStream(stream, action.generation);
      return;
    }
    if (action.type !== "PLAY_PLAYLIST") return;
    if (action.payload?.playlist !== this.media.playlist) {
      this.report(`Playback unavailable in menu-only preview (PLAY_PLAYLIST ${String(action.payload?.playlist)}).`);
      this.vm.handleEvent({ type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id });
      return;
    }
    if (!this.media.background.path || !this.media.audioTracks.length || !this.findAudioTrack(this.selectedAudioStream)) {
      this.report("Menu background playback assets are unavailable.");
      this.vm.handleEvent({ type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id });
      return;
    }
    await this.startMedia({ id: action.id, generation: action.generation });
  }

  isCurrent(generation: number): boolean { return generation === this.currentGeneration; }
  get selectedPrimaryAudioStream(): number | null { const track = this.findAudioTrack(this.selectedAudioStream); return track ? this.psrStreamNumber(track) : null; }

  /** Starts the local menu loop from the Start gesture when Top Menu emits no matching PLAY_PL action. */
  async startMenuBackground(): Promise<boolean> {
    if (!this.media.background.path || !this.media.audioTracks.length || !this.findAudioTrack(this.selectedAudioStream)) {
      this.report("Menu background playback assets are unavailable."); return false;
    }
    return this.startMedia();
  }

  private async startMedia(response?: { id: string; generation: number }): Promise<boolean> {
    if (this.started) {
      this.hooks.clearRetry?.();
      if (response) this.vm.handleEvent({ type: "MEDIA_STARTED", generation: response.generation, responseTo: response.id });
      return true;
    }
    if (!this.startPromise) {
      this.video.loop = true; this.audio.loop = true;
      this.video.src = this.media.background.path;
      this.audio.src = this.findAudioTrack(this.selectedAudioStream)!.path;
      const attempt = Promise.resolve().then(() => Promise.all([this.video.play(), this.audio.play()])).then(() => {
        this.started = true; this.retryGeneration++; this.hooks.clearRetry?.(); return true;
      }).catch((error: unknown) => {
        const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        if (name === "NotAllowedError") {
          this.report(`Browser blocked menu media playback; use the retry button to start it. (${message})`);
          const retryGeneration = ++this.retryGeneration;
          this.hooks.offerRetry?.(() => {
            if (retryGeneration !== this.retryGeneration || (response && !this.isPending(response))) return;
            void this.startMedia(response);
          });
          return false;
        }
        this.retryGeneration++; this.hooks.clearRetry?.();
        this.report(name === "NotSupportedError"
          ? `Menu media format is not supported: ${message}`
          : `Menu media could not start: ${message}`);
        if (response) this.vm.handleEvent({ type: "MEDIA_ERROR", generation: response.generation, responseTo: response.id, payload: { message } });
        return false;
      });
      this.startPromise = attempt;
    }
    const attempt = this.startPromise;
    const started = await attempt;
    if (this.startPromise === attempt && !started) this.startPromise = null;
    if (started && response) this.vm.handleEvent({ type: "MEDIA_STARTED", generation: response.generation, responseTo: response.id });
    return started;
  }

  private isPending(response: { id: string; generation: number }): boolean {
    const waiting = this.vm.snapshot().waiting;
    return waiting?.id === response.id && waiting.generation === response.generation;
  }

  private findAudioTrack(streamNumber: number): MenuLoopMediaPackage["audioTracks"][number] | undefined {
    const matches = this.media.audioTracks.filter((track) => track.streamNumber === streamNumber);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private findAudioTrackForPsrStream(psrStreamNumber: number): MenuLoopMediaPackage["audioTracks"][number] | undefined {
    const matches = this.media.audioTracks.filter((track) => this.psrStreamNumber(track) === psrStreamNumber);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private psrStreamNumber(track: MenuLoopMediaPackage["audioTracks"][number]): number { return track.psrStreamNumber ?? track.streamNumber + 1; }

  private async selectAudioStream(psrStreamNumber: number, generation: number): Promise<void> {
    const sequence = ++this.switchSequence;
    const previousTrack = this.findAudioTrack(this.selectedAudioStream);
    const previousPsr = this.confirmedPrimaryAudioStream;
    const track = this.findAudioTrackForPsrStream(psrStreamNumber);
    if (!track) {
      this.rollbackPrimaryAudioStream(previousPsr);
      this.report(`Primary audio stream ${psrStreamNumber} is not included in this menu package.`);
      return;
    }
    if (track.streamNumber === this.selectedAudioStream && this.audio.src.endsWith(track.path)) {
      this.confirmedPrimaryAudioStream = psrStreamNumber;
      return;
    }
    const shouldPlay = this.started && !this.video.paused;
    const logicalTime = this.video.currentTime;
    try {
      await this.applyAudioTrack(track, logicalTime, shouldPlay, generation, sequence);
      if (!this.isCurrentTrackSwitch(generation, sequence)) return;
      this.selectedAudioStream = track.streamNumber;
      this.confirmedPrimaryAudioStream = psrStreamNumber;
      this.hooks.audioTrackChanged?.(track);
    } catch (error) {
      if (!this.isCurrentTrackSwitch(generation, sequence)) return;
      this.rollbackPrimaryAudioStream(previousPsr);
      let rollbackError: unknown;
      if (previousTrack) {
        try { await this.applyAudioTrack(previousTrack, logicalTime, shouldPlay, generation, sequence); }
        catch (restoreError) { rollbackError = restoreError; }
      }
      if (!this.isCurrentTrackSwitch(generation, sequence)) return;
      const failure = error instanceof Error ? error.message : String(error);
      const restoreMessage = rollbackError ? ` Previous audio restore failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}` : "";
      this.report(`Primary audio stream ${psrStreamNumber} could not be confirmed: ${failure}.${restoreMessage}`);
    }
  }

  private async applyAudioTrack(track: MenuLoopMediaPackage["audioTracks"][number], logicalTime: number, shouldPlay: boolean, generation: number, sequence: number): Promise<void> {
    this.audio.pause();
    this.audio.src = track.path;
    const metadataWait = this.audio.readyState < 1 ? waitAudioEvent(this.audio, "loadedmetadata", this.hooks.trackSwitchTimeoutMs ?? 15_000) : null;
    this.audio.load();
    if (metadataWait) await metadataWait;
    this.assertCurrentTrackSwitch(generation, sequence);
    const duration = this.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Audio variant reported an invalid duration.");
    const targetTime = logicalTime % duration;
    if (!Number.isFinite(targetTime) || targetTime < 0) throw new Error("Video logical time cannot be mapped to the audio variant.");
    if (Math.abs(this.audio.currentTime - targetTime) > 0.000001) {
      const seekWait = waitAudioEvent(this.audio, "seeked", this.hooks.trackSwitchTimeoutMs ?? 15_000);
      try { this.audio.currentTime = targetTime; }
      catch (error) { seekWait.cancel(); throw error; }
      await seekWait;
    }
    this.assertCurrentTrackSwitch(generation, sequence);
    if (this.audio.readyState < 2) {
      await waitAudioReady(this.audio, this.hooks.trackSwitchTimeoutMs ?? 15_000);
      this.assertCurrentTrackSwitch(generation, sequence);
    }
    if (shouldPlay) {
      await this.audio.play();
      this.assertCurrentTrackSwitch(generation, sequence);
    }
  }

  private isCurrentTrackSwitch(generation: number, sequence: number): boolean { return this.currentGeneration === generation && this.switchSequence === sequence; }
  private assertCurrentTrackSwitch(generation: number, sequence: number): void { if (!this.isCurrentTrackSwitch(generation, sequence)) throw new Error("Audio selection belongs to a stale generation."); }
  private rollbackPrimaryAudioStream(streamNumber: number): void {
    this.confirmedPrimaryAudioStream = streamNumber;
    this.vm.registers.systemWrite(1, streamNumber);
  }
}

interface AudioWait { promise: Promise<void>; cancel(): void; }

function waitAudioEvent(audio: HTMLAudioElement, eventName: "loadedmetadata" | "seeked", timeoutMs: number): AudioWait {
  let cancel = () => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      audio.removeEventListener(eventName, onReady);
      audio.removeEventListener("error", onFailure);
      audio.removeEventListener("abort", onFailure);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) rejectPromise(error); else resolvePromise();
    };
    const onReady = () => finish();
    const onFailure = () => finish(new Error(`Audio ${eventName} failed (${eventName === "loadedmetadata" ? "load" : "seek"}).`));
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for audio ${eventName}.`)), timeoutMs);
    cancel = () => finish(new Error(`Audio ${eventName} was superseded.`));
    audio.addEventListener(eventName, onReady, { once: true });
    audio.addEventListener("error", onFailure, { once: true });
    audio.addEventListener("abort", onFailure, { once: true });
  });
  return { promise, cancel: () => cancel() };
}

function waitAudioReady(audio: HTMLAudioElement, timeoutMs: number): Promise<void> {
  if (audio.readyState >= 2) return Promise.resolve();
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      audio.removeEventListener("loadeddata", onReady);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("error", onFailure);
      audio.removeEventListener("abort", onFailure);
    };
    const finish = (error?: Error) => { if (!settled) { settled = true; cleanup(); error ? rejectPromise(error) : resolvePromise(); } };
    const onReady = () => { if (audio.readyState >= 2) finish(); };
    const onFailure = () => finish(new Error("Audio track could not decode the selected position."));
    const timer = setTimeout(() => finish(new Error("Timed out waiting for decoded audio data.")), timeoutMs);
    audio.addEventListener("loadeddata", onReady);
    audio.addEventListener("canplay", onReady);
    audio.addEventListener("error", onFailure);
    audio.addEventListener("abort", onFailure);
  });
}

export function installKeyboardInput(target: Window, controller: MenuController): () => void {
  const held = new Set<string>();
  const onDown = (event: KeyboardEvent) => {
    if (held.has(event.code)) return; held.add(event.code);
    const mapped: Record<string, InputKind> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "activate", Space: "activate", Escape: "escape", KeyT: "topMenu", KeyP: "popup" };
    const kind = mapped[event.code]; if (kind) { event.preventDefault(); controller.handle(kind); }
  };
  const onUp = (event: KeyboardEvent) => held.delete(event.code);
  const onBlur = () => held.clear(); target.addEventListener("keydown", onDown); target.addEventListener("keyup", onUp); target.addEventListener("blur", onBlur);
  return () => { held.clear(); target.removeEventListener("keydown", onDown); target.removeEventListener("keyup", onUp); target.removeEventListener("blur", onBlur); };
}

export function installCanvasPointerInput(canvas: HTMLCanvasElement, viewport: CanvasViewport, controller: MenuController, cssSize: () => { width: number; height: number }): () => void {
  const point = (event: PointerEvent) => {
    const position = viewport.toSource(event.clientX, event.clientY, canvas.getBoundingClientRect());
    if (position) controller.selectFromPointer(position.x, position.y);
  };
  const activate = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect(); const position = viewport.toSource(event.clientX, event.clientY, rect);
    if (!position) return;
    controller.activatePointer(position.x, position.y);
  };
  const resize = () => {
    const size = cssSize(); viewport.resize(canvas, size.width, size.height, window.devicePixelRatio || 1);
    controller.hooks.render?.();
  };
  canvas.addEventListener("pointermove", point); canvas.addEventListener("pointerdown", activate); window.addEventListener("resize", resize); resize();
  return () => { canvas.removeEventListener("pointermove", point); canvas.removeEventListener("pointerdown", activate); window.removeEventListener("resize", resize); };
}
