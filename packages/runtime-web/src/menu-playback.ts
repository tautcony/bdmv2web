import { errorDescription, errorText } from "@bdmv2web/utils";
import type { HdmvVm, NavigationAction, VmEvent } from "@bdmv2web/hdmv";
import { replayMediaAtLoopPoint } from "./media-loop.js";

export type PlaybackAction = Pick<NavigationAction, "id" | "generation" | "type" | "payload"> & Partial<Pick<NavigationAction, "source" | "waitFor">>;

function waitMismatchReason(vm: HdmvVm, action: PlaybackAction, event: VmEvent): string | null {
  const waiting = vm.snapshot().waiting;
  if (!action.waitFor) return `Action ${action.id} has no waitFor; discarded ${event.type}`;
  if (!waiting) return `No continuation is waiting for action ${action.id}; discarded ${event.type}`;
  if (waiting.id !== action.id || waiting.generation !== action.generation || waiting.waitFor !== action.waitFor) return `Action ${action.id} does not match the current VM wait; discarded ${event.type}`;
  return null;
}

function matchingWait(vm: HdmvVm, action: PlaybackAction): boolean {
  return waitMismatchReason(vm, action, { type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id }) === null;
}

function respondToWaitingAction(vm: HdmvVm, action: PlaybackAction, event: VmEvent): void {
  const reason = waitMismatchReason(vm, action, event);
  if (reason) vm.recordDiscardedEvent?.(event, reason, action.source ?? null);
  else vm.handleEvent(event);
}

function discardPlaybackResponse(vm: HdmvVm, action: PlaybackAction, event: VmEvent, reason: string): void {
  vm.recordDiscardedEvent?.(event, reason, action.source ?? null);
}

/** Shared seam for menu playback and a future timeline-backed player. */
export interface PlaybackBridge {
  dispatch(action: PlaybackAction): void | Promise<void>;
  isCurrent(generation: number): boolean;
  /** Primary audio stream number confirmed by the active package media element. */
  readonly selectedPrimaryAudioStream?: number | null;
  startMenuBackground?(): Promise<boolean>;
  /** Switch the background to a packaged PlayItem without a VM playback wait.
   * `LinkPI` moves inside the current playlist and never emits a media response,
   * so the scene switch must not be correlated with a VM event. */
  showMenuItem?(playlist: number, playItem: number): Promise<boolean>;
}

/** Menu action bridge: correlated failures unblock the VM without a fake ended event. */
export class PreviewPlaybackBridge implements PlaybackBridge {
  private currentGeneration = 0;
  constructor(private readonly vm: HdmvVm, private readonly report: (message: string) => void) {}
  dispatch(action: PlaybackAction): void {
    this.currentGeneration = Math.max(this.currentGeneration, action.generation);
    if (["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK", "LINK_PLAY_ITEM", "LINK_PLAY_MARK", "TITLE_SEARCH"].includes(action.type)) {
      this.report(`Playback unavailable in menu preview (${action.type}).`);
      respondToWaitingAction(this.vm, action, { type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id });
    } else if (action.type === "MENU_CALL") {
      this.report("Popup composition is unavailable in menu preview; the package has no in-browser title overlay context.");
    } else if (["STILL_ON", "STILL_OFF", "MENU_RETURN"].includes(action.type)) {
      this.report(`${action.type} is not available in menu preview.`);
    }
  }
  isCurrent(generation: number): boolean { return generation === this.currentGeneration; }
}

export interface MenuLoopMediaPackage {
  playlist: number;
  /** Source PlayItem inside that playlist. A menu playlist can hold several
   * sub-menu PlayItems that `LinkPI` switches between without changing playlist. */
  playItem?: number;
  background: { path: string; durationSeconds?: number; loop: boolean; loopStartSeconds?: number };
  /** Each entry is one source audio lane. Same-language lanes remain distinct. */
  audioTracks: Array<{ streamNumber: number; psrStreamNumber?: number; path: string; language: string; durationSeconds?: number; pid?: number; variantId?: string }>;
}

export interface MenuLoopPlaybackHooks {
  offerRetry?: (retry: () => void) => void;
  clearRetry?: () => void;
  /** Called only after a local audio variant has loaded, sought, and resumed successfully. */
  audioTrackChanged?: (track: MenuLoopMediaPackage["audioTracks"][number]) => void;
  trackSwitchTimeoutMs?: number;
  /** Resolves the PlayItem a playlist request addresses. Play marks and `LinkPI`
   * both need package metadata the bridge does not carry. */
  resolvePlayItem?: (playlist: number, action: PlaybackAction) => number;
}

/** Plays the exported menu loop for its matching HDMV playlist and applies primary-audio selections. */
export class MenuLoopPlaybackBridge implements PlaybackBridge {
  private currentGeneration = 0;
  private selectedAudioStream: number;
  private confirmedPrimaryAudioStream: number;
  private switchSequence = 0;
  private mediaSequence = 0;
  private started = false;
  private startPromise: Promise<boolean> | null = null;
  private retryGeneration = 0;
  private activePlaylistResponse: PlaybackAction | null = null;
  private lastTimeUpdateSecond = -1;
  private activeMedia: MenuLoopMediaPackage | null;
  private readonly playlistMedia: readonly MenuLoopMediaPackage[];
  constructor(
    private readonly vm: HdmvVm,
    private readonly video: HTMLVideoElement,
    private readonly audio: HTMLAudioElement,
    private readonly media: MenuLoopMediaPackage | undefined,
    private readonly report: (message: string) => void,
    private readonly hooks: MenuLoopPlaybackHooks = {},
    playlistMedia: readonly MenuLoopMediaPackage[] = [],
  ) {
    this.playlistMedia = playlistMedia;
    // A package can carry only additional menu playlist media (per-playlist
    // assets) with no Top Menu background; the bridge then serves playlist
    // media from playlistMedia and has no primary background.
    this.activeMedia = media ?? null;
    this.confirmedPrimaryAudioStream = vm.registers.read({ kind: "psr", index: 1 });
    this.selectedAudioStream = media ? this.pickAudioStream(media) : 0;
    this.video.addEventListener?.("ended", () => {
      const media = this.activeMedia;
      if (media?.background.loop) {
        const loopStart = media.background.loopStartSeconds;
        if (loopStart !== undefined) {
          const audioTrack = this.findAudioTrack(this.selectedAudioStream);
          void replayMediaAtLoopPoint(this.video, audioTrack ? this.audio : null, loopStart).catch((error: unknown) => this.report(`Menu loop could not resume: ${errorText(error)}`));
        }
        return;
      }
      const response = this.activePlaylistResponse;
      if (!response) return;
      this.activePlaylistResponse = null;
      respondToWaitingAction(this.vm, response, { type: "MEDIA_ENDED", generation: response.generation, responseTo: response.id });
    });
    for (const type of ["error", "abort"] as const) {
      this.video.addEventListener?.(type, () => {
        const response = this.activePlaylistResponse;
        if (!response) return;
        this.activePlaylistResponse = null;
        this.started = false;
        this.startPromise = null;
        this.retryGeneration++;
        this.hooks.clearRetry?.();
        const message = type === "abort" ? "Menu video loading was aborted." : "Menu video reported a playback error.";
        this.report(message);
        respondToWaitingAction(this.vm, response, { type: "MEDIA_ERROR", generation: response.generation, responseTo: response.id, payload: { message } });
      });
    }
    this.video.addEventListener?.("timeupdate", () => {
      const response = this.activePlaylistResponse;
      if (!response) return;
      if (!matchingWait(this.vm, response)) {
        respondToWaitingAction(this.vm, response, { type: "TIME_UPDATED", generation: response.generation, responseTo: response.id, payload: { presentationTime: Math.max(0, Math.round(this.video.currentTime * 45_000)) } });
        this.activePlaylistResponse = null;
        return;
      }
      const second = Math.floor(this.video.currentTime);
      if (second === this.lastTimeUpdateSecond) return;
      this.lastTimeUpdateSecond = second;
      respondToWaitingAction(this.vm, response, { type: "TIME_UPDATED", generation: response.generation, responseTo: response.id, payload: { presentationTime: Math.max(0, Math.round(this.video.currentTime * 45_000)) } });
    });
  }

  async dispatch(action: PlaybackAction): Promise<void> {
    if (action.generation < this.currentGeneration) {
      if (["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"].includes(action.type)) {
        discardPlaybackResponse(this.vm, action, { type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id }, `Action ${action.id} has stale generation ${action.generation}; discarded playback request`);
      }
      return;
    }
    if (action.generation > this.currentGeneration) this.switchSequence++;
    this.currentGeneration = Math.max(this.currentGeneration, action.generation);
    if (action.type === "SET_STREAM") {
      const stream = action.payload?.primaryAudioStream;
      if (typeof stream === "number" && stream > 0) await this.selectAudioStream(stream, action.generation);
      return;
    }
    if (action.type === "PLAY_STOP") {
      this.stopMedia();
      return;
    }
    if (["LINK_PLAY_ITEM", "LINK_PLAY_MARK", "STILL_ON", "STILL_OFF", "MENU_RETURN"].includes(action.type)) {
      const target = action.type === "LINK_PLAY_ITEM" ? action.payload?.playItem : action.type === "LINK_PLAY_MARK" ? action.payload?.playMark : undefined;
      this.report(`${action.type}${typeof target === "number" ? ` ${target}` : ""} is not available in the packaged menu loop.`);
      return;
    }
    if (action.type !== "PLAY_PLAYLIST" && action.type !== "PLAY_PLAYLIST_ITEM" && action.type !== "PLAY_PLAYLIST_MARK") return;
    const playlist = action.payload?.playlist;
    if (typeof playlist !== "number") {
      this.report("Playback unavailable in menu preview (PLAY_PLAYLIST without a numeric playlist).");
      respondToWaitingAction(this.vm, action, { type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id });
      return;
    }
    const target = this.findMedia(playlist, this.playItemFor(playlist, action));
    if (!target) {
      this.report(`Playback unavailable in menu preview (PLAY_PLAYLIST ${String(playlist)}).`);
      respondToWaitingAction(this.vm, action, { type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id });
      return;
    }
    if (!target.background.path) {
      this.report("Menu background playback assets are unavailable.");
      respondToWaitingAction(this.vm, action, { type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id });
      return;
    }
    const response = action;
    if (target !== this.activeMedia) {
      await this.switchMedia(target, response);
      return;
    }
    this.activePlaylistResponse = response;
    const started = await this.startMedia(response);
    if (!started && this.activePlaylistResponse === response) this.activePlaylistResponse = null;
  }

  isCurrent(generation: number): boolean { return generation === this.currentGeneration; }
  get selectedPrimaryAudioStream(): number | null { const track = this.findAudioTrack(this.selectedAudioStream); return track ? this.psrStreamNumber(track) : null; }

  /** Starts the local menu loop from the Start gesture when Top Menu emits no matching PLAY_PL action. */
  async startMenuBackground(): Promise<boolean> {
    if (!this.media?.background.path) {
      this.report("Menu background playback assets are unavailable."); return false;
    }
    if (this.activeMedia !== this.media) {
      this.mediaSequence++;
      this.activeMedia = this.media;
      this.selectedAudioStream = this.pickAudioStream(this.media);
      this.started = false;
      this.startPromise = null;
      this.activePlaylistResponse = null;
    }
    return this.startMedia();
  }

  private async startMedia(response?: PlaybackAction): Promise<boolean> {
    const mediaSequence = this.mediaSequence;
    const media = this.activeMedia;
    if (this.started) {
      this.hooks.clearRetry?.();
      const audioTrack = this.findAudioTrack(this.selectedAudioStream);
      if (this.video.paused || (audioTrack && this.audio.paused)) {
        try {
          await Promise.all([this.video.play(), ...(audioTrack ? [this.audio.play()] : [])]);
        } catch (error) {
          const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
          const message = errorDescription(error);
          // An autoplay block on resume is recoverable through the same retry
          // gesture as the initial start; it must not terminate the menu VM.
          if (name === "NotAllowedError") {
            this.report(`Browser blocked menu media playback; use the retry button to start it. (${message})`);
            const retryGeneration = ++this.retryGeneration;
            this.hooks.offerRetry?.(() => {
              if (retryGeneration !== this.retryGeneration || (response && !this.isPending(response))) return;
              void this.startMedia(response);
            });
            return false;
          }
          this.report(`Menu media could not resume: ${message}`);
          if (response) respondToWaitingAction(this.vm, response, { type: "MEDIA_ERROR", generation: response.generation, responseTo: response.id, payload: { message } });
          return false;
        }
      }
      if (response) this.confirmStarted(response);
      return true;
    }
    if (!this.startPromise) {
      if (!media) return false;
      const audioTrack = this.findAudioTrack(this.selectedAudioStream);
      this.video.loop = media.background.loop && media.background.loopStartSeconds === undefined;
      if (this.video.src !== media.background.path) {
        this.activePlaylistResponse = null;
        this.video.src = media.background.path;
      }
      if (response) this.activePlaylistResponse = response;
      if (audioTrack) {
        this.audio.loop = media.background.loop && media.background.loopStartSeconds === undefined;
        this.audio.src = audioTrack.path;
      }
      const attempt = Promise.resolve().then(() => Promise.all([this.video.play(), ...(audioTrack ? [this.audio.play()] : [])])).then(() => {
        if (this.mediaSequence !== mediaSequence || this.activeMedia !== media) return false;
        this.started = true; this.retryGeneration++; this.hooks.clearRetry?.(); return true;
      }).catch((error: unknown) => {
        if (this.mediaSequence !== mediaSequence || this.activeMedia !== media) return false;
        const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
        const message = errorDescription(error);
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
        if (response) respondToWaitingAction(this.vm, response, { type: "MEDIA_ERROR", generation: response.generation, responseTo: response.id, payload: { message } });
        return false;
      });
      this.startPromise = attempt;
    }
    const attempt = this.startPromise;
    const started = await attempt;
    if (this.startPromise === attempt && !started) this.startPromise = null;
    if (started && response) this.confirmStarted(response);
    return started;
  }
  private confirmStarted(response: PlaybackAction): void {
    this.activePlaylistResponse = response;
    respondToWaitingAction(this.vm, response, { type: "MEDIA_STARTED", generation: response.generation, responseTo: response.id });
    if (!matchingWait(this.vm, response) && this.activePlaylistResponse === response) this.activePlaylistResponse = null;
  }

  /** Swap the local video/audio source while the VM keeps its current generation. */
  private async switchMedia(target: MenuLoopMediaPackage, response: PlaybackAction): Promise<void> {
    this.switchSequence++;
    this.mediaSequence++;
    this.activeMedia = target;
    this.selectedAudioStream = this.pickAudioStream(target);
    this.started = false;
    this.startPromise = null;
    this.activePlaylistResponse = null;
    this.lastTimeUpdateSecond = -1;
    this.video.pause();
    this.audio.pause();
    try {
      // Reset both elements so the new source starts at the PlayItem boundary.
      this.video.currentTime = 0;
      this.audio.currentTime = 0;
    } catch { /* A media element without metadata rejects seeking; the load below starts at zero. */ }
    const started = await this.startMedia(response);
    if (!started && this.activePlaylistResponse === response) this.activePlaylistResponse = null;
  }

  private findMedia(playlist: number, playItem = 0): MenuLoopMediaPackage | undefined {
    const candidates = [this.media, ...this.playlistMedia]
      .filter((candidate): candidate is MenuLoopMediaPackage => !!candidate && candidate.playlist === playlist);
    const exact = candidates.find((candidate) => (candidate.playItem ?? 0) === playItem);
    if (exact) return exact;
    // A package without PlayItem keys carries one playlist-level entry; keep
    // serving it instead of losing the background on a playlist re-entry.
    const playlistLevel = candidates.find((candidate) => candidate.playItem === undefined);
    if (playlistLevel) return playlistLevel;
    // A playlist whose single packaged PlayItem is not the one requested (the
    // Top Menu entry PlayItem, for example) still owns exactly one background.
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  /** The PlayItem a playlist request addresses; `LinkPI` and play marks are
   * resolved by the caller, which owns the package's mark table. */
  private playItemFor(playlist: number, action: PlaybackAction): number {
    const resolved = this.hooks.resolvePlayItem?.(playlist, action);
    if (typeof resolved === "number" && Number.isSafeInteger(resolved) && resolved >= 0) return resolved;
    const payload = action.payload as { playItem?: unknown } | undefined;
    return typeof payload?.playItem === "number" ? payload.playItem : 0;
  }

  /** Switch the background for a `LinkPI`/`LinkMK` jump. No VM response is
   * expected: those actions move inside the playlist the VM is already playing,
   * so the menu keeps its current playback wait. */
  async showMenuItem(playlist: number, playItem: number): Promise<boolean> {
    const target = this.findMedia(playlist, playItem);
    if (!target?.background.path) return false;
    if (target === this.activeMedia) return this.startMedia();
    this.switchSequence++;
    this.mediaSequence++;
    this.activeMedia = target;
    this.selectedAudioStream = this.pickAudioStream(target);
    this.started = false;
    this.startPromise = null;
    this.activePlaylistResponse = null;
    this.lastTimeUpdateSecond = -1;
    this.video.pause();
    this.audio.pause();
    try {
      this.video.currentTime = 0;
      this.audio.currentTime = 0;
    } catch { /* A media element without metadata rejects seeking; the load below starts at zero. */ }
    return this.startMedia();
  }

  private pickAudioStream(media: MenuLoopMediaPackage): number {
    return this.pickAudioTrackForPsr(media, this.confirmedPrimaryAudioStream)?.streamNumber
      ?? [...media.audioTracks].sort((left, right) => left.streamNumber - right.streamNumber)[0]?.streamNumber
      ?? 0;
  }

  private pickAudioTrackForPsr(media: MenuLoopMediaPackage, psrStreamNumber: number): MenuLoopMediaPackage["audioTracks"][number] | undefined {
    const matches = media.audioTracks.filter((track) => this.psrStreamNumber(track) === psrStreamNumber);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private stopMedia(): void {
    this.activePlaylistResponse = null;
    this.video.pause();
    this.audio.pause();
  }

  private isPending(response: PlaybackAction): boolean {
    return matchingWait(this.vm, response);
  }

  private findAudioTrack(streamNumber: number): MenuLoopMediaPackage["audioTracks"][number] | undefined {
    if (!this.activeMedia) return undefined;
    const matches = this.activeMedia.audioTracks.filter((track) => track.streamNumber === streamNumber);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private findAudioTrackForPsrStream(psrStreamNumber: number): MenuLoopMediaPackage["audioTracks"][number] | undefined {
    if (!this.activeMedia) return undefined;
    const matches = this.activeMedia.audioTracks.filter((track) => this.psrStreamNumber(track) === psrStreamNumber);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private psrStreamNumber(track: MenuLoopMediaPackage["audioTracks"][number]): number { return track.psrStreamNumber ?? track.streamNumber + 1; }

  private async selectAudioStream(psrStreamNumber: number, generation: number): Promise<void> {
    if (!this.activeMedia || this.activeMedia.audioTracks.length === 0) {
      this.rollbackPrimaryAudioStream(this.confirmedPrimaryAudioStream);
      return;
    }
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
      this.vm.registers.systemWrite(1, psrStreamNumber);
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
      const failure = errorText(error);
      const restoreMessage = rollbackError ? ` Previous audio restore failed: ${rollbackError instanceof Error ? rollbackError.message : typeof rollbackError === "string" ? rollbackError : "non-Error value"}` : "";
      this.report(`Primary audio stream ${psrStreamNumber} could not be confirmed: ${failure}.${restoreMessage}`);
    }
  }

  private async applyAudioTrack(track: MenuLoopMediaPackage["audioTracks"][number], logicalTime: number, shouldPlay: boolean, generation: number, sequence: number): Promise<void> {
    this.audio.pause();
    // Wait for metadata from the newly selected resource. readyState can still
    // describe the previous source until load() resets the media element.
    this.audio.src = track.path;
    const expectedSrc = this.audio.src;
    const metadataWait = waitAudioMetadata(this.audio, this.hooks.trackSwitchTimeoutMs ?? 15_000, expectedSrc);
    this.audio.load();
    await metadataWait;
    this.assertCurrentTrackSwitch(generation, sequence);
    const duration = track.durationSeconds ?? this.activeMedia?.background.durationSeconds;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) throw new Error("Menu package is missing a valid generated audio duration.");
    const targetTime = logicalTime % duration;
    if (Math.abs(this.audio.currentTime - targetTime) > 0.000001) {
      const seekWait = waitAudioEvent(this.audio, "seeked", this.hooks.trackSwitchTimeoutMs ?? 15_000);
      try { this.audio.currentTime = targetTime; }
      catch (error) { seekWait.cancel(); throw error; }
      await seekWait.promise;
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

function waitAudioEvent(audio: HTMLAudioElement, eventName: "seeked", timeoutMs: number): AudioWait {
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
    const onFailure = () => finish(new Error("Audio seek failed."));
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for audio ${eventName}.`)), timeoutMs);
    cancel = () => finish(new Error(`Audio ${eventName} was superseded.`));
    audio.addEventListener(eventName, onReady, { once: true });
    audio.addEventListener("error", onFailure, { once: true });
    audio.addEventListener("abort", onFailure, { once: true });
  });
  return { promise, cancel: () => cancel() };
}

function waitAudioMetadata(audio: HTMLAudioElement, timeoutMs: number, expectedSrc: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("error", onFailure);
      audio.removeEventListener("abort", onFailure);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectPromise(error); else resolvePromise();
    };
    const onMetadata = () => {
      if (audio.currentSrc === expectedSrc && audio.readyState >= 1) finish();
    };
    const onFailure = () => finish(new Error(`Audio metadata failed (media error ${audio.error?.code ?? "unknown"}).`));
    const timer = setTimeout(() => finish(new Error("Timed out waiting for target audio metadata.")), timeoutMs);
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("error", onFailure, { once: true });
    audio.addEventListener("abort", onFailure, { once: true });
  });
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
