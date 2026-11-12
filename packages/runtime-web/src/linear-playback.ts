import type { VmEvent } from "@bdmv2web/hdmv";
import type { PlaybackAction, PlaybackBridge } from "./menu-playback.js";
import { errorMessage } from "./runtime-status.js";

export interface LinearTimelinePosition {
  mapping: { mappingId: string; playlistId: string; assetId: string; playlistStart90k: string; playlistEnd90k: string; mediaStart90k: string; mediaEnd90k: string };
  playlistTime90k: string;
  mediaTime90k: string;
}

/** Structural subset of MediaTimelineMap. Each asset receives its own map so audio variants cannot collide. */
export interface LinearTimelineMapPort {
  readonly mappings: readonly LinearTimelinePosition["mapping"][];
  playlistToSource(playlistId: string, playlistTime90k: string | bigint | number): LinearTimelinePosition | null;
  mediaToSource(assetId: string, mediaTime90k: string | bigint | number, mappingId?: string): LinearTimelinePosition | null;
}

export interface LinearPlaybackAsset {
  /** Explicit VM operand to playlist binding; no filename or ID arithmetic is used. */
  playlistNumber: number;
  playlistId: string;
  /** One-based MPLS/STN stream number, preserved as supplied by the package adapter. */
  audioStreamNumber: number;
  variantId: string;
  /** Exact package-local path emitted by the package builder. */
  path: string;
  timeline: LinearTimelineMapPort;
  /** Explicit VM command operand lookup; avoids assuming zero/one-based PI numbering. */
  playItemOperandToMappingId: Readonly<Record<number, string>>;
  /** Explicit VM command operand to playlist-time lookup. */
  playMarkOperandToPlaylistTime90k: Readonly<Record<number, string>>;
}

export interface LinearPlaybackMedia {
  currentTime: number;
  readonly duration: number;
  readonly readyState: number;
  readonly paused: boolean;
  src: string;
  load?(): void;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface LinearPlaybackHooks {
  report: (message: string) => void;
  timeoutMs?: number;
  primaryAudioStreamNumber?: number;
}

type ActivePlayback = {
  action: PlaybackAction;
  generation: number;
  asset: LinearPlaybackAsset;
  listeners: Array<{ type: string; listener: EventListener }>;
  cancelWaiters: Set<() => void>;
  started: boolean;
};

const PLAY_ACTIONS = new Set(["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"]);

/** Plays only declared, package-local linear assets and maps every target through its supplied timeline. */
export class LinearPlaybackBridge implements PlaybackBridge {
  private currentGeneration = 0;
  private active: ActivePlayback | null = null;
  private selectedAudioStream: number;

  constructor(private readonly vm: Pick<{ handleEvent(event: VmEvent): unknown }, "handleEvent">, private readonly media: LinearPlaybackMedia, private readonly assets: readonly LinearPlaybackAsset[], private readonly hooks: LinearPlaybackHooks) {
    this.selectedAudioStream = hooks.primaryAudioStreamNumber ?? assets[0]?.audioStreamNumber ?? 1;
  }

  isCurrent(generation: number): boolean { return generation === this.currentGeneration; }

  async dispatch(action: PlaybackAction): Promise<void> {
    if (action.generation < this.currentGeneration) return;
    if (action.generation > this.currentGeneration) {
      this.currentGeneration = action.generation;
      if (action.type === "MENU_CALL" && this.active) this.active.generation = action.generation;
      else this.clearActive();
    }
    if (action.type === "PLAY_STOP") { this.stop(); return; }
    if (action.type === "MENU_CALL") {
      if (this.active && this.isActive(this.active)) this.vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id });
      else this.unavailable(action, "Pop-up menu has no active linear playback context.");
      return;
    }
    if (action.type === "SET_STREAM") {
      const stream = action.payload.primaryAudioStream;
      if (typeof stream === "number" && stream > 0) this.selectedAudioStream = stream;
      return;
    }
    if (PLAY_ACTIONS.has(action.type)) {
      const playlistNumber = action.payload.playlist;
      if (typeof playlistNumber !== "number") { this.unavailable(action, "Playback action has no numeric playlist operand."); return; }
      const asset = this.findAsset(playlistNumber);
      if (!asset) { this.unavailable(action, `No packaged linear asset is declared for playlist operand ${playlistNumber} and audio stream ${this.selectedAudioStream}.`); return; }
      const target = this.targetForAction(action, asset);
      if (!target) { this.unavailable(action, `No explicit timeline mapping resolves ${action.type} operand ${String(action.payload.playItem ?? action.payload.playMark ?? "start")} for playlist '${asset.playlistId}'.`); return; }
      await this.start(action, asset, target.mediaSeconds);
      return;
    }
    if (action.type === "LINK_PLAY_ITEM" || action.type === "LINK_PLAY_MARK") {
      const active = this.active;
      if (!active || active.generation !== action.generation) {
        this.hooks.report(`${action.type} has no active linear playlist context.`);
        return;
      }
      const target = this.targetForAction(action, active.asset);
      if (!target) {
        this.hooks.report(`No explicit timeline mapping resolves ${action.type} operand ${String(action.payload.playItem ?? action.payload.playMark)} for playlist '${active.asset.playlistId}'.`);
        return;
      }
      await this.seekActive(active, target.mediaSeconds, action);
    }
  }

  private findAsset(playlistNumber: number): LinearPlaybackAsset | undefined {
    const matches = this.assets.filter((asset) => asset.playlistNumber === playlistNumber && asset.audioStreamNumber === this.selectedAudioStream);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private targetForAction(action: PlaybackAction, asset: LinearPlaybackAsset): { mediaSeconds: number } | null {
    let position: LinearTimelinePosition | null = null;
    if (action.type === "PLAY_PLAYLIST") {
      const first = asset.timeline.mappings.filter((mapping) => mapping.playlistId === asset.playlistId).sort((a, b) => compareTicks(a.playlistStart90k, b.playlistStart90k))[0];
      if (first) position = asset.timeline.playlistToSource(asset.playlistId, first.playlistStart90k);
    } else if (action.type === "PLAY_PLAYLIST_ITEM" || action.type === "LINK_PLAY_ITEM") {
      const operand = action.payload.playItem;
      if (typeof operand !== "number") return null;
      const mappingId = asset.playItemOperandToMappingId[operand];
      const mapping = asset.timeline.mappings.find((item) => item.mappingId === mappingId && item.playlistId === asset.playlistId);
      if (mapping) position = asset.timeline.playlistToSource(asset.playlistId, mapping.playlistStart90k);
      if (position && position.mapping.mappingId !== mappingId) position = null;
    } else if (action.type === "PLAY_PLAYLIST_MARK" || action.type === "LINK_PLAY_MARK") {
      const operand = action.payload.playMark;
      if (typeof operand !== "number") return null;
      const time = asset.playMarkOperandToPlaylistTime90k[operand];
      if (time !== undefined) position = asset.timeline.playlistToSource(asset.playlistId, time);
    }
    if (!position || position.mapping.assetId !== asset.timeline.mappings[0]?.assetId) return null;
    const mediaSeconds = Number(BigInt(position.mediaTime90k)) / 90_000;
    return Number.isFinite(mediaSeconds) && mediaSeconds >= 0 ? { mediaSeconds } : null;
  }

  private async start(action: PlaybackAction, asset: LinearPlaybackAsset, mediaSeconds: number): Promise<void> {
    this.clearActive();
    const active: ActivePlayback = { action, generation: action.generation, asset, listeners: [], cancelWaiters: new Set(), started: false };
    this.active = active;
    try {
      if (this.media.src !== asset.path) {
        this.media.src = asset.path;
        this.media.load?.();
      }
      await this.waitFor(active, "loadedmetadata", () => this.media.readyState >= 1);
      if (!this.isActive(active)) return;
      this.validateTarget(mediaSeconds);
      await this.seekMedia(active, mediaSeconds);
      if (!this.isActive(active)) return;
      this.installEndAndError(active);
      await this.media.play();
      if (!this.isActive(active)) return;
      active.started = true;
      this.vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id });
    } catch (error) {
      if (!this.isActive(active)) return;
      this.fail(active, errorMessage(error));
    }
  }

  private async seekActive(active: ActivePlayback, seconds: number, action: PlaybackAction): Promise<void> {
    if (!this.isActive(active)) return;
    try {
      this.validateTarget(seconds);
      await this.seekMedia(active, seconds);
      if (this.isActive(active)) this.vm.handleEvent({ type: "MEDIA_SEEKED", generation: action.generation, responseTo: action.id, payload: { playlistId: active.asset.playlistId, mediaTimeSeconds: this.media.currentTime, presentationTime: Math.max(0, Math.round(this.media.currentTime * 45_000)) } });
    } catch (error) {
      if (this.isActive(active)) this.hooks.report(`${action.type} failed: ${errorMessage(error)}`);
    }
  }

  private async seekMedia(active: ActivePlayback, seconds: number): Promise<void> {
    if (Math.abs(this.media.currentTime - seconds) <= 0.000001 && this.media.readyState >= 2) return;
    const wait = this.waitFor(active, "seeked", () => this.media.readyState >= 2 && Math.abs(this.media.currentTime - seconds) <= 1 / 90_000);
    this.media.currentTime = seconds;
    await wait;
  }

  private waitFor(active: ActivePlayback, type: "loadedmetadata" | "seeked", ready: () => boolean): Promise<void> {
    if (ready()) return Promise.resolve();
    const timeoutMs = this.hooks.timeoutMs ?? 15_000;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${type}.`)), timeoutMs);
      const listeners: Array<{ type: string; listener: EventListener }> = [
        { type, listener: () => { if (ready()) finish(); } },
        { type: "error", listener: () => finish(new Error("Media element reported an error.")) },
        { type: "abort", listener: () => finish(new Error("Media element aborted the active operation.")) },
      ];
      const cleanup = () => {
        clearTimeout(timer);
        for (const entry of listeners) this.media.removeEventListener(entry.type, entry.listener);
        active.listeners = active.listeners.filter((entry) => !listeners.some((waiter) => waiter.listener === entry.listener));
        active.cancelWaiters.delete(cancel);
      };
      const finish = (error?: Error) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(); };
      const cancel = () => finish(new Error("Media action was superseded."));
      active.cancelWaiters.add(cancel);
      for (const entry of listeners) {
        this.media.addEventListener(entry.type, entry.listener);
        active.listeners.push(entry);
      }
      if (!this.isActive(active)) finish(new Error("Media action was superseded."));
    });
  }

  private installEndAndError(active: ActivePlayback): void {
    const onEnded: EventListener = () => {
      if (!this.isActive(active) || !active.started) return;
      const action = active.action;
      this.vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
      this.clearActive(false);
    };
    const onError: EventListener = () => { if (this.isActive(active)) this.fail(active, "Media element reported a playback error."); };
    this.addListener(active, "ended", onEnded);
    this.addListener(active, "error", onError);
  }

  private addListener(active: ActivePlayback, type: string, listener: EventListener): void {
    this.media.addEventListener(type, listener);
    active.listeners.push({ type, listener });
  }

  private validateTarget(seconds: number): void {
    if (!Number.isFinite(this.media.duration) || this.media.duration <= 0 || seconds >= this.media.duration) throw new Error("Mapped media target is outside the loaded linear asset duration.");
  }

  private fail(active: ActivePlayback, message: string): void {
    if (!this.isActive(active)) return;
    this.hooks.report(`Linear media playback failed: ${message}`);
    if (PLAY_ACTIONS.has(active.action.type)) this.vm.handleEvent({ type: "MEDIA_ERROR", generation: active.action.generation, responseTo: active.action.id, payload: { message } });
    this.clearActive();
  }

  private unavailable(action: PlaybackAction, message: string): void {
    this.hooks.report(message);
    if (action.waitFor || PLAY_ACTIONS.has(action.type)) this.vm.handleEvent({ type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id, payload: { message } });
  }

  private stop(): void {
    this.clearActive();
    this.media.pause();
  }

  private isActive(active: ActivePlayback): boolean { return this.active === active && this.currentGeneration === active.generation; }

  private clearActive(clearMedia = true): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    for (const cancel of [...active.cancelWaiters]) cancel();
    for (const { type, listener } of active.listeners) this.media.removeEventListener(type, listener);
    active.listeners.length = 0;
    if (clearMedia) this.media.pause();
  }
}

function compareTicks(left: string, right: string): number {
  const a = BigInt(left); const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
