import { decodeInstruction, type ButtonCommandContext, type ButtonProgramResult, type RawCommand, type VmEvent, type VmSnapshot } from "@bdmv2web/hdmv";
import type { SourceLocation } from "@bdmv2web/bdmv-parser";
export { adaptIgsScene, selectPopupScene } from "./igs-adapter.js";
export type { IgsAdapterDiagnostic, IgsSceneAdapterResult, PopupSceneSelection, SerializedMenuButton, SerializedMenuPage, SerializedMenuState, SerializedScene } from "./igs-adapter.js";
export { MenuLoopPlaybackBridge, PreviewPlaybackBridge } from "./menu-playback.js";
export type { MenuLoopMediaPackage, MenuLoopPlaybackHooks, PlaybackAction, PlaybackBridge } from "./menu-playback.js";
export { LinearPlaybackBridge } from "./linear-playback.js";
export type { LinearPlaybackAsset, LinearPlaybackHooks, LinearPlaybackMedia, LinearTimelineMapPort, LinearTimelinePosition } from "./linear-playback.js";
export interface Bounds { x: number; y: number; width: number; height: number }
export interface ButtonState { bounds: Bounds; image?: CanvasImageSource; soundId?: number; startObjectId?: number; endObjectId?: number; repeat?: boolean }
export interface MenuObject { image: CanvasImageSource; width: number; height: number }
export interface MenuEffectObject { image: CanvasImageSource; x: number; y: number; width: number; height: number; crop?: { x: number; y: number; width: number; height: number } }
export interface MenuEffectFrame { duration90k: number; objects: MenuEffectObject[] }
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
  objects?: ReadonlyMap<number, MenuObject>;
  effects?: { enter: MenuEffectFrame[]; exit: MenuEffectFrame[] };
  buttons: MenuButton[];
  allowedActions?: Partial<Record<"activate" | "move" | "popup" | "topMenu", boolean>>;
}
export interface MenuScene { width: number; height: number; frameRateCode?: number; compositionTimeout90k?: string | null; selectionTimeout90k?: string | null; pages: MenuPage[] }
export interface RuntimeVmPort {
  handleEvent(event: VmEvent): unknown;
  snapshot?(): VmSnapshot;
  applyMenuContext?(pageId: number, selectedButtonId: number | null): void;
  beginMenuAction?(): void;
  recoverMenuAction?(): boolean;
  executeButtonProgram?(commands: RawCommand[], context?: ButtonCommandContext): ButtonProgramResult;
  executeButtonCommand?(command: string | Uint8Array, source?: SourceLocation, context?: ButtonCommandContext): { status?: string; diagnostic?: { message?: string } | null; buttonCommandTerminated?: boolean };
}
export type InputKind = "up" | "down" | "left" | "right" | "activate" | "popup" | "topMenu" | "escape";
export type EscapeMapping = "popup" | "topMenu" | "custom" | "none";
export interface MenuInputConfig { escapeMapping: EscapeMapping }
export const DEFAULT_MENU_INPUT_CONFIG: Readonly<MenuInputConfig> = Object.freeze({ escapeMapping: "popup" });

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
  saveCheckpoint(): { now: number; nextId: number; pausedAt: number | null; events: Array<[number, { due: number; scope: string; callback: () => void }]> } {
    return { now: this.nowValue, nextId: this.nextId, pausedAt: this.pausedAt, events: [...this.events].map(([id, event]) => [id, { ...event }]) };
  }
  restoreCheckpoint(checkpoint: ReturnType<EventScheduler["saveCheckpoint"]>): void {
    this.nowValue = checkpoint.now; this.nextId = checkpoint.nextId; this.pausedAt = checkpoint.pausedAt;
    this.events.clear(); for (const [id, event] of checkpoint.events) this.events.set(id, { ...event });
  }
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
  saveCheckpoint?(): unknown;
  restoreCheckpoint?(checkpoint: unknown): void;
}

export interface MenuControllerCheckpoint {
  pageIndex: number; selectedButtonId: number | null; activatedButtonId: number | null;
  disabled: number[]; bogSelections: Array<[string, number]>; invalidUoMaskPages: number[];
  unsupportedTimeoutActivationPages: number[]; started: boolean; autoActionDepth: number;
  animationIndices: Array<[number, number]>; animationElapsedMs: number; paused: boolean;
  activeEffect: { frames: MenuEffectFrame[]; index: number; remainingMs: number; next: MenuEffectFrame[]; pendingAutoAction: boolean } | null;
  scheduler: unknown;
}

export interface RuntimeHooks { playSound?: (soundId: number, buttonId: number) => void; invalidateSound?: () => void; activateButton?: (pageId: number, button: MenuButton) => void; dispatchActions?: () => void; diagnostic?: (message: string) => void; render?: () => void; popup?: () => void; topMenu?: () => void; escape?: () => void }

export interface SoundAudioPort { muted?: boolean; play(): Promise<void> | void; addEventListener?(type: "error" | "ended", listener: () => void, options?: { once?: boolean }): void }
export interface SoundPlayerHooks { report: (kind: "blocked" | "unsupported" | "asset" | "playback", message: string) => void; offerRetry: (retry: () => void) => void; isCurrent: (soundId: number, buttonId: number) => boolean }

/** Plays package-local WAVs and exposes an explicit, correlated gesture retry for autoplay blocks. */
export class MenuSoundPlayer {
  private requestId = 0;
  private muted = false;
  private readonly activeAudio = new Set<SoundAudioPort>();
  constructor(private readonly sounds: Readonly<Record<number, string>>, private readonly createAudio: (url: string) => SoundAudioPort, private readonly hooks: SoundPlayerHooks) {}
  setMuted(muted: boolean): void { this.muted = muted; for (const audio of this.activeAudio) audio.muted = muted; }
  invalidate(): void { this.requestId++; }
  play(soundId: number, buttonId: number): void {
    const requestId = ++this.requestId; const url = this.sounds[soundId];
    if (!url) { this.hooks.report("asset", `Sound ${soundId} for button ${buttonId} has no packaged WAV asset.`); return; }
    let audio: SoundAudioPort;
    try { audio = this.createAudio(url); }
    catch (error) { this.hooks.report("asset", `Could not load sound ${soundId}: ${errorMessage(error)}`); return; }
    audio.muted = this.muted;
    this.trackAudio(audio);
    audio.addEventListener?.("error", () => { if (requestId === this.requestId) this.hooks.report("asset", `Sound ${soundId} asset failed to load (${url}).`); }, { once: true });
    const start = (retry: boolean) => {
      audio.muted = this.muted;
      let result: Promise<void> | void;
      try { result = audio.play(); } catch (error) { this.handleFailure(error, soundId, buttonId, url, requestId, audio, retry); return; }
      Promise.resolve(result).catch((error: unknown) => this.handleFailure(error, soundId, buttonId, url, requestId, audio, retry));
    };
    start(false);
  }
  private handleFailure(error: unknown, soundId: number, buttonId: number, url: string, requestId: number, audio: SoundAudioPort, retry: boolean): void {
    this.activeAudio.delete(audio);
    if (requestId !== this.requestId) return;
    const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
    if (name === "NotAllowedError") {
      if (!this.hooks.isCurrent(soundId, buttonId)) return;
      this.hooks.report("blocked", `Browser blocked sound ${soundId}; use the retry button to play it.`);
      this.hooks.offerRetry(() => { if (requestId === this.requestId && this.hooks.isCurrent(soundId, buttonId)) this.handleRetry(audio, soundId, buttonId, url, requestId); });
    } else if (name === "NotSupportedError") this.hooks.report("unsupported", `Browser does not support packaged sound ${soundId} (${url}).`);
    else this.hooks.report("playback", `Sound ${soundId} ${retry ? "retry" : "playback"} failed: ${errorMessage(error)}`);
  }
  private handleRetry(audio: SoundAudioPort, soundId: number, buttonId: number, url: string, requestId: number): void {
    this.trackAudio(audio);
    audio.muted = this.muted;
    let result: Promise<void> | void;
    try { result = audio.play(); } catch (error) { this.handleFailure(error, soundId, buttonId, url, requestId, audio, true); return; }
    Promise.resolve(result).catch((error: unknown) => this.handleFailure(error, soundId, buttonId, url, requestId, audio, true));
  }
  private trackAudio(audio: SoundAudioPort): void {
    if (!audio.addEventListener) return;
    this.activeAudio.add(audio);
    const release = () => this.activeAudio.delete(audio);
    audio.addEventListener("ended", release, { once: true });
    audio.addEventListener("error", release, { once: true });
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }

/** Owns page/BOG/selection state and routes all activation through HDMV VM input. */
export class MenuController {
  pageIndex = 0; selectedButtonId: number | null = null; activatedButtonId: number | null = null;
  private readonly disabled = new Set<number>(); private bogSelections = new Map<string, number>(); private readonly scheduler: MenuScheduler; private readonly invalidUoMaskPages = new Set<number>(); private readonly unsupportedTimeoutActivationPages = new Set<number>(); private started = false; private autoActionDepth = 0; private readonly inputConfig: MenuInputConfig;
  private animationIndices = new Map<number, number>(); private animationElapsedMs = 0; private paused = false;
  private activeEffect: MenuControllerCheckpoint["activeEffect"] = null;
  constructor(readonly scene: MenuScene, readonly vm: RuntimeVmPort, readonly hooks: RuntimeHooks = {}, schedulerOrConfig: MenuScheduler | Partial<MenuInputConfig> = new EventScheduler()) {
    if (!scene.pages.length) throw new TypeError("menu scene must contain a page");
    const scheduler = isMenuScheduler(schedulerOrConfig);
    this.scheduler = scheduler ? schedulerOrConfig : new EventScheduler();
    const inputConfig = scheduler ? DEFAULT_MENU_INPUT_CONFIG : { ...DEFAULT_MENU_INPUT_CONFIG, ...schedulerOrConfig };
    if (!["popup", "topMenu", "custom", "none"].includes(inputConfig.escapeMapping)) throw new TypeError(`Invalid Escape mapping '${String(inputConfig.escapeMapping)}'.`);
    this.inputConfig = inputConfig;
    this.selectPageDefault(false);
  }
  get page(): MenuPage { return this.scene.pages[this.pageIndex]!; }
  get button(): MenuButton | null { return this.page.buttons.find((b) => b.id === this.selectedButtonId) ?? null; }
  saveCheckpoint(): MenuControllerCheckpoint {
    if (!this.scheduler.saveCheckpoint || !this.scheduler.restoreCheckpoint) throw new TypeError("Menu scheduler does not support checkpoints");
    return {
      pageIndex: this.pageIndex, selectedButtonId: this.selectedButtonId, activatedButtonId: this.activatedButtonId,
      disabled: [...this.disabled], bogSelections: [...this.bogSelections], invalidUoMaskPages: [...this.invalidUoMaskPages],
      unsupportedTimeoutActivationPages: [...this.unsupportedTimeoutActivationPages], started: this.started,
      animationIndices: [...this.animationIndices], animationElapsedMs: this.animationElapsedMs, paused: this.paused,
      activeEffect: this.activeEffect ? { ...this.activeEffect, frames: [...this.activeEffect.frames], next: [...this.activeEffect.next] } : null,
      autoActionDepth: this.autoActionDepth, scheduler: this.scheduler.saveCheckpoint(),
    };
  }
  restoreCheckpoint(checkpoint: MenuControllerCheckpoint): void {
    if (!Number.isInteger(checkpoint.pageIndex) || checkpoint.pageIndex < 0 || checkpoint.pageIndex >= this.scene.pages.length) throw new TypeError("Menu checkpoint has an invalid page index");
    if (!this.scheduler.restoreCheckpoint) throw new TypeError("Menu scheduler does not support checkpoints");
    const { scheduler: schedulerCheckpoint, ...state } = checkpoint;
    this.pageIndex = state.pageIndex; this.selectedButtonId = state.selectedButtonId; this.activatedButtonId = state.activatedButtonId;
    this.disabled.clear(); for (const id of state.disabled) this.disabled.add(id);
    this.bogSelections.clear(); for (const [key, button] of state.bogSelections) this.bogSelections.set(key, button);
    this.animationIndices = new Map(state.animationIndices); this.animationElapsedMs = state.animationElapsedMs; this.paused = state.paused;
    this.activeEffect = state.activeEffect ? { ...state.activeEffect, frames: [...state.activeEffect.frames], next: [...state.activeEffect.next] } : null;
    this.invalidUoMaskPages.clear(); for (const page of state.invalidUoMaskPages) this.invalidUoMaskPages.add(page);
    this.unsupportedTimeoutActivationPages.clear(); for (const page of state.unsupportedTimeoutActivationPages) this.unsupportedTimeoutActivationPages.add(page);
    this.started = state.started; this.autoActionDepth = state.autoActionDepth;
    this.scheduler.restoreCheckpoint(schedulerCheckpoint);
  }
  schedulePageEffect(delayMs: number, callback: () => void): number { return this.scheduler.schedule(delayMs, `page:${this.page.id}`, callback); }
  pause(): void { this.paused = true; this.scheduler.pause(); }
  resume(): void { this.paused = false; this.scheduler.resume(); }
  advanceWhileRunning(deltaMs: number): void {
    this.scheduler.advanceWhileRunning(deltaMs);
    if (!this.started || this.paused || !Number.isFinite(deltaMs) || deltaMs < 0) return;
    if (this.activeEffect) { this.advanceEffect(deltaMs); return; }
    const interval = animationFrameIntervalMs(this.scene.frameRateCode ?? 0, this.page.animationFrameRateCode ?? 0);
    if (!this.hasActiveAnimation()) return;
    this.animationElapsedMs += deltaMs;
    let steps = 0;
    while ((interval === 0 ? steps === 0 : this.animationElapsedMs >= interval) && steps < 256) {
      if (interval > 0) this.animationElapsedMs -= interval;
      this.advanceButtonAnimations();
      steps++;
    }
    if (steps) this.hooks.render?.();
  }
  get effectFrame(): MenuEffectFrame | null { return this.activeEffect?.frames[this.activeEffect.index] ?? null; }
  get isAnimating(): boolean { return !!this.activeEffect || this.hasActiveAnimation(); }
  visualState(button: MenuButton): ButtonState | undefined {
    const state = !button.enabled ? button.states.normal : button.id === this.activatedButtonId ? button.states.activated : button.id === this.selectedButtonId ? button.states.selected : button.states.normal;
    if (!state || state.startObjectId === undefined || state.endObjectId === undefined) return state;
    const index = this.animationIndices.get(button.bog) ?? 0;
    const objectId = index < 0 && state.endObjectId < 0xfffe ? state.endObjectId : state.startObjectId + Math.max(0, index);
    const object = this.page.objects?.get(objectId);
    if (!object) {
      const { image: _image, ...withoutImage } = state;
      return this.page.objects ? withoutImage : state;
    }
    return { ...state, image: object.image, bounds: { x: state.bounds.x, y: state.bounds.y, width: object.width, height: object.height } };
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.syncMenuContext();
    this.beginPageEffects([], this.page.effects?.enter ?? [], this.button?.autoAction === true);
    if (!this.activeEffect && this.button?.autoAction) this.runAutomaticAction(this.button);
  }
  syncVmContext(): void { this.syncMenuContext(); }
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
    if (pageFlag) {
      if (pageId === this.page.id) return;
      const pageIndex = this.scene.pages.findIndex((page) => page.id === pageId);
      if (pageIndex < 0) { this.hooks.diagnostic?.(`SET_BUTTON_PAGE references missing page ${pageId}.`); return; }
      this.changePage(pageIndex, !buttonFlag, !effectsFlag);
    }
    if (!buttonFlag) return;
    if (buttonId === 0xffff) {
      this.selectedButtonId = null; this.activatedButtonId = null; this.syncMenuContext(); this.hooks.invalidateSound?.(); this.hooks.render?.(); return;
    }
    const target = this.page.buttons.find((button) => button.id === buttonId);
    if (!target) { this.hooks.diagnostic?.(`SET_BUTTON_PAGE references unusable button ${buttonId} on page ${this.page.id}.`); return; }
    this.activateBogButton(target);
  }
  private changePage(index: number, runAutoAction: boolean, playOutEffects = true): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.scene.pages.length) throw new RangeError("page index out of range");
    const oldPage = this.page;
    this.scheduler.cancelScope(`page:${oldPage.id}`); this.hooks.invalidateSound?.(); this.pageIndex = index; this.activatedButtonId = null; this.selectPageDefault(false);
    const out = playOutEffects ? oldPage.effects?.exit ?? [] : [];
    const enter = this.page.effects?.enter ?? [];
    this.beginPageEffects(out, enter, runAutoAction && this.started);
    if (!this.activeEffect && runAutoAction && this.started && this.button?.autoAction) this.runAutomaticAction(this.button);
    this.hooks.render?.();
  }
  private beginPageEffects(out: MenuEffectFrame[], enter: MenuEffectFrame[], pendingAutoAction: boolean): void {
    const frames = out.length ? out : enter;
    this.activeEffect = frames.length ? {
      frames: [...frames], index: 0, remainingMs: frames[0]!.duration90k / 90,
      next: out.length ? [...enter] : [], pendingAutoAction,
    } : null;
  }
  private advanceEffect(deltaMs: number): void {
    let remainingDelta = deltaMs;
    let transitions = 0;
    while (this.activeEffect && transitions < 512) {
      const active = this.activeEffect;
      if (active.remainingMs > remainingDelta) { active.remainingMs -= remainingDelta; break; }
      remainingDelta = Math.max(0, remainingDelta - active.remainingMs);
      if (active.index + 1 < active.frames.length) {
        active.index++;
        active.remainingMs = active.frames[active.index]!.duration90k / 90;
      } else if (active.next.length) {
        active.frames = active.next; active.next = []; active.index = 0;
        active.remainingMs = active.frames[0]!.duration90k / 90;
      } else {
        const runAutoAction = active.pendingAutoAction;
        this.activeEffect = null;
        if (runAutoAction && this.button?.autoAction) this.runAutomaticAction(this.button);
      }
      transitions++;
      if (remainingDelta === 0 && this.activeEffect?.remainingMs !== 0) break;
    }
    this.hooks.render?.();
  }
  private hasActiveAnimation(): boolean {
    return this.page.buttons.some((button) => {
      if (!this.isDisplayed(button)) return false;
      const state = !button.enabled ? button.states.normal : button.id === this.activatedButtonId ? button.states.activated : button.id === this.selectedButtonId ? button.states.selected : button.states.normal;
      return !!state && (this.animationIndices.get(button.bog) ?? 0) >= 0 && state.endObjectId !== undefined && state.startObjectId !== undefined && state.endObjectId > state.startObjectId;
    });
  }
  private advanceButtonAnimations(): void {
    const visibleBogs = new Set(this.page.buttons.filter((button) => this.isDisplayed(button)).map((button) => button.bog));
    for (const bog of visibleBogs) {
      const button = this.page.buttons.find((candidate) => candidate.bog === bog && this.isDisplayed(candidate));
      if (!button) continue;
      const state = !button.enabled ? button.states.normal : button.id === this.activatedButtonId ? button.states.activated : button.id === this.selectedButtonId ? button.states.selected : button.states.normal;
      if (!state || state.startObjectId === undefined || state.endObjectId === undefined) continue;
      const range = state.endObjectId - state.startObjectId;
      if (range <= 0 || state.startObjectId >= 0xffff || state.endObjectId >= 0xffff) continue;
      const current = this.animationIndices.get(bog) ?? 0;
      if (current < 0) continue;
      const next = current + 1;
      if (state.repeat) this.animationIndices.set(bog, next % (range + 1));
      else this.animationIndices.set(bog, next > range ? -1 : next);
    }
  }
  setButtonEnabled(id: number, enabled: boolean): void {
    const target = this.page.buttons.find((button) => button.id === id);
    if (!target) return;
    if (!this.page.bogDefaults) {
      enabled ? this.disabled.delete(id) : this.disabled.add(id);
      if (!enabled && this.selectedButtonId === id) {
        this.hooks.invalidateSound?.(); this.activatedButtonId = null; this.selectedButtonId = null; this.syncMenuContext();
      }
      this.hooks.render?.();
      return;
    }
    const key = this.bogSelectionKey(this.page.id, target.bog);
    const current = this.bogSelections.get(key);
    if (enabled) {
      this.animationIndices.set(target.bog, 0);
      this.bogSelections.set(key, id);
      if (current === this.selectedButtonId) this.selectButton(id);
      else if (!this.isUsable(this.button)) {
        const fallback = this.firstUsablePageButton();
        if (fallback) this.selectButton(fallback.id);
      }
    } else if (current === id) {
      this.bogSelections.set(key, 0xffff);
      if (this.selectedButtonId === id) {
        this.hooks.invalidateSound?.(); this.activatedButtonId = null;
        this.selectedButtonId = this.firstUsablePageButton()?.id ?? null;
        this.syncMenuContext();
      }
    }
    this.hooks.render?.();
  }
  handle(kind: InputKind): void {
    if (this.activeEffect) return;
    if (kind === "escape") {
      if (!this.isUoAllowed(25)) return;
      const escapeTarget = this.escapeTarget();
      if (escapeTarget) { this.selectButton(escapeTarget.id); return; }
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
    this.syncMenuContext();
    this.vm.beginMenuAction?.();
    this.activatedButtonId = button.id; const state = button.states.selected;
    if (state?.soundId !== undefined && state.soundId !== 0xff) this.hooks.playSound?.(state.soundId, button.id);
    if (this.vm.executeButtonProgram) {
      try {
        const commands = button.commands.map(({ bytes, source }) => {
          const decoded = decodeInstruction(bytes, source);
          return { bytes: decoded.bytes, words: decoded.words, source: decoded.source };
        });
        const result = this.vm.executeButtonProgram(commands, "ig_object");
        if (result.fault?.message) { this.hooks.diagnostic?.(result.fault.message); this.recoverMenuAction(); }
        else if (result.diagnostic?.message) { this.hooks.diagnostic?.(result.diagnostic.message); this.recoverMenuAction(); }
        else this.hooks.dispatchActions?.();
      } catch (error) {
        this.recoverMenuAction();
        this.hooks.diagnostic?.(error instanceof Error ? error.message : String(error));
      }
      this.hooks.activateButton?.(activatedPageId, button);
    } else if (this.vm.executeButtonCommand) {
      for (const command of button.commands) {
        const result = this.vm.executeButtonCommand(command.bytes, command.source, "ig_object");
        if (result.diagnostic?.message) this.hooks.diagnostic?.(result.diagnostic.message);
        if (result.status === "faulted" || result.diagnostic?.message) this.recoverMenuAction();
        else this.hooks.dispatchActions?.();
        if (result.buttonCommandTerminated || result.status === "faulted" || result.status === "suspended" || result.status === "stopped") break;
      }
      this.hooks.activateButton?.(activatedPageId, button);
    } else if (button.commands.length) this.hooks.diagnostic?.(`Button ${button.id} has commands, but no HDMV button-command executor is connected.`);
    this.hooks.render?.();
  }
  hit(x: number, y: number): number | null {
    // libbluray selects a pointer target only from BOGs whose active button has
    // a selected-object visual, and tests that visual's geometry. A normal-only
    // button is display content; making it the pointer target would move focus
    // to a button that cannot show a selected state.
    return this.buttonsInBogScanOrder().find((button) => this.isUsable(button) && contains(button.states.selected?.bounds, x, y))?.id ?? null;
  }
  // libbluray scans BOGs in page order.
  private buttonsInBogScanOrder(): MenuButton[] {
    return this.page.bogDefaults
      ? this.page.bogDefaults.flatMap(({ bog }) => this.page.buttons.filter((button) => button.bog === bog))
      : this.page.buttons;
  }
  private escapeTarget(): MenuButton | null {
    const current = this.button;
    if (!current) return null;
    const candidates = [...new Set(Object.values(current.neighbors))]
      .map((id) => this.page.buttons.find((button) => button.id === id))
      .filter((button): button is MenuButton => !!button && this.isUsable(button) && button.autoAction === true && button.commands.length > 0 && button.states.selected?.bounds === undefined);
    return candidates.length === 1 ? candidates[0]! : null;
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
    if (!button || !button.enabled || this.disabled.has(button.id) || !this.isBogEnabled(button)) return false;
    // When the serialized page declares BOG defaults, they also describe which BOG IDs exist.
    return !this.page.bogDefaults || this.page.bogDefaults.some((entry) => entry.bog === button.bog);
  }
  private isBogEnabled(button: MenuButton): boolean {
    return !this.page.bogDefaults || this.bogSelections.get(this.bogSelectionKey(this.page.id, button.bog)) === button.id;
  }
  isDisplayed(button: MenuButton): boolean { return this.isBogEnabled(button); }
  private activateBogButton(button: MenuButton): void {
    this.bogSelections.set(this.bogSelectionKey(this.page.id, button.bog), button.id);
    this.selectButton(button.id, false);
    if (button.autoAction && this.selectedButtonId === button.id) this.runAutomaticAction(button);
    this.hooks.render?.();
  }
  private firstUsablePageButton(): MenuButton | undefined {
    const declaredDefault = this.page.buttons.find((button) => button.id === this.page.defaultButtonId && this.isUsable(button));
    return declaredDefault ?? this.page.buttons.find((button) => this.isUsable(button));
  }
  private bogSelectionKey(pageId: number, bog: number): string { return `${pageId}:${bog}`; }
  private recoverMenuAction(): void {
    if (this.vm.recoverMenuAction?.()) this.syncMenuContext();
  }
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
      this.animationIndices.set(target.bog, 0);
      this.syncMenuContext();
      this.hooks.render?.();
      // Pointer selection passes false, so hover never activates an auto-action button.
      // Other selection sources retain the immediate flag behavior; timing is not inferred.
      if (runAutoAction && target.autoAction) this.runAutomaticAction(target);
    }
  }
  private selectPageDefault(runAutoAction: boolean): void {
    const page = this.page;
    this.animationIndices = new Map((page.bogDefaults ?? [...new Set(page.buttons.map((button) => button.bog))].map((bog) => ({ bog }))).map(({ bog }) => [bog, 0]));
    this.animationElapsedMs = 0;
    const previousSelection = this.selectedButtonId;
    for (const key of [...this.bogSelections.keys()]) if (key.startsWith(`${page.id}:`)) this.bogSelections.delete(key);
    // The per-BOG default valid refs establish which button variant is enabled.
    for (const entry of page.bogDefaults ?? []) {
      const member = page.buttons.find((candidate) => candidate.id === entry.defaultButtonId && candidate.bog === entry.bog);
      if (member) {
        this.bogSelections.set(this.bogSelectionKey(page.id, entry.bog), member.id);
        // Empty, invisible, commandless defaults are structural placeholders.
        // They cannot receive input and do not displace page focus.
        const inertPlaceholder = !member.enabled && !member.autoAction && !member.states.normal && !member.states.selected && !member.commands.length;
        if (!member.enabled && !inertPlaceholder) this.hooks.diagnostic?.(`Page ${page.id} BOG ${entry.bog} default button ${entry.defaultButtonId} belongs to the BOG but is disabled or has no usable hit geometry.`);
      } else if (entry.defaultButtonId !== 0xffff) {
        this.hooks.diagnostic?.(`Page ${page.id} BOG ${entry.bog} default button ${entry.defaultButtonId} is not a member of that BOG.`);
      }
    }
    const declaredDefault = page.defaultButtonId === 0xffff ? undefined : page.buttons.find((b) => b.id === page.defaultButtonId && this.isUsable(b));
    const psrSelection = this.vm.snapshot?.().registers.psr[10];
    const preservedSelection = psrSelection === undefined ? previousSelection : psrSelection === 0xffff ? null : psrSelection;
    const priorEnabled = preservedSelection === null ? undefined : page.buttons.find((b) => b.id === preservedSelection && this.isUsable(b));
    const firstEnabled = page.bogDefaults ? page.buttons.find((b) => this.isUsable(b)) : undefined;
    const initialSelection = declaredDefault ?? priorEnabled ?? firstEnabled;
    this.selectedButtonId = initialSelection?.id ?? null;
    this.activatedButtonId = null;
    this.syncMenuContext();
    const defaultActivatedButtonId = page.defaultActivatedButtonId;
    if (defaultActivatedButtonId !== undefined && defaultActivatedButtonId !== 0xfffe && defaultActivatedButtonId !== 0xffff) {
      this.hooks.diagnostic?.(`Page ${page.id} declares default activated button ${defaultActivatedButtonId}, but its runtime semantics are unverified.`);
    }
    if (defaultActivatedButtonId === 0xfffe && this.hasSelectionTimeout() && !this.unsupportedTimeoutActivationPages.has(page.id)) {
      this.unsupportedTimeoutActivationPages.add(page.id);
      this.hooks.diagnostic?.(`Page ${page.id} requests activation of the selected button after the selection timeout, but timeout activation is not implemented.`);
    }
    if (initialSelection) this.bogSelections.set(this.bogSelectionKey(page.id, initialSelection.bog), initialSelection.id);
    if (runAutoAction && initialSelection?.autoAction) this.runAutomaticAction(initialSelection);
  }
  private runAutomaticAction(button: MenuButton): void {
    if (this.activeEffect) { this.activeEffect.pendingAutoAction = true; return; }
    if (this.autoActionDepth >= 32) {
      this.hooks.diagnostic?.("Menu auto-action chain exceeded 32 nested activations and was stopped.");
      return;
    }
    this.autoActionDepth++;
    try { this.handle("activate"); }
    finally { this.autoActionDepth--; }
  }
  private hasSelectionTimeout(): boolean { return this.scene.selectionTimeout90k !== null && this.scene.selectionTimeout90k !== undefined && this.scene.selectionTimeout90k !== "0"; }
  private syncMenuContext(): void { this.vm.applyMenuContext?.(this.page.id, this.selectedButtonId); }
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
    const effect = controller.effectFrame;
    if (effect) drawEffectFrame(layerContext, effect);
    else for (const button of controller.page.buttons) {
      if (!controller.isDisplayed(button)) continue;
      const state = controller.visualState(button);
      if (state?.image) layerContext.drawImage(state.image, state.bounds.x, state.bounds.y, state.bounds.width, state.bounds.height);
    }
  }
  viewport.toCss(context, cssWidth, cssHeight, dpr); context.save(); context.beginPath(); context.rect(0, 0, scene.width, scene.height); context.clip();
  if (layerContext && pageLayer) context.drawImage(pageLayer, 0, 0, scene.width, scene.height);
  else if (controller.effectFrame) drawEffectFrame(context, controller.effectFrame);
  else for (const button of controller.page.buttons) {
    if (!controller.isDisplayed(button)) continue;
    const state = controller.visualState(button);
    if (state?.image) context.drawImage(state.image, state.bounds.x, state.bounds.y, state.bounds.width, state.bounds.height);
  }
  context.restore();
}

function drawEffectFrame(context: CanvasRenderingContext2D, frame: MenuEffectFrame): void {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  for (const object of frame.objects) {
    if (object.crop) context.drawImage(object.image, object.crop.x, object.crop.y, object.crop.width, object.crop.height, object.x, object.y, object.crop.width, object.crop.height);
    else context.drawImage(object.image, object.x, object.y, object.width, object.height);
  }
}

function animationFrameIntervalMs(videoFrameRateCode: number, animationFrameRateCode: number): number {
  const frameTicks = [0, (90_000 / 1001) * 24, (90_000 / 1000) * 24, (90_000 / 1000) * 25, (90_000 / 1001) * 30, (90_000 / 1000) * 50, (90_000 / 1001) * 60, 0][videoFrameRateCode] ?? 0;
  return frameTicks * (animationFrameRateCode + 1) / 90;
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
