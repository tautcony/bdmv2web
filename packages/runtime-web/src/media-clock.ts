import type { MenuScheduler } from "./index.js";

export interface MediaClockSource {
  /** Native media currentTime in seconds. The scheduler never writes this value. */
  readonly currentTime: number;
  readonly paused: boolean;
}

export interface MediaClockHooks {
  /** Rebuild visual state at a seek target. This callback must be a pure reconstruction, not navigation replay. */
  rebuildAt: (mediaTimeMs: number, generation: number) => void;
}

interface ScheduledMediaEvent {
  id: number;
  dueMs: number;
  scope: string;
  generation: number;
  callback: () => void;
}

/**
 * MenuScheduler whose time is sampled from media.currentTime. It does not
 * advance from wall-clock/RAF deltas, so pause freezes the menu media domain.
 * Call seeked() before sampling after a seek to discard historical callbacks.
 */
export class MediaClockScheduler implements MenuScheduler {
  private nextId = 1;
  private currentGeneration = 0;
  private readonly events = new Map<number, ScheduledMediaEvent>();

  constructor(private readonly media: MediaClockSource, private readonly hooks: MediaClockHooks) {}

  get now(): number { return secondsToMilliseconds(this.media.currentTime); }
  get generation(): number { return this.currentGeneration; }

  schedule(delayMs: number, scope: string, callback: () => void): number {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError("delay must be non-negative");
    const id = this.nextId++;
    this.events.set(id, { id, dueMs: this.now + delayMs, scope, generation: this.currentGeneration, callback });
    return id;
  }

  cancelScope(scope: string): void {
    for (const [id, event] of this.events) if (event.scope === scope) this.events.delete(id);
  }

  /** Invalidate work from earlier media generations. Generation numbers cannot go backwards. */
  setGeneration(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < this.currentGeneration) throw new RangeError("generation must be a non-decreasing safe integer");
    if (generation === this.currentGeneration) return;
    this.currentGeneration = generation;
    this.events.clear();
  }

  pause(): void { /* Native currentTime is authoritative and stops advancing while media is paused. */ }
  resume(): void { /* Native currentTime is authoritative and resumes with the media element. */ }
  advanceWhileRunning(_deltaMs: number): void { this.sample(); }

  /** Run events crossed by normal forward media playback. */
  sample(): void {
    const now = this.now;
    const due = [...this.events.values()]
      .filter((event) => event.generation === this.currentGeneration && event.dueMs <= now)
      .sort((a, b) => a.dueMs - b.dueMs || a.id - b.id);
    for (const event of due) {
      if (!this.events.delete(event.id) || event.generation !== this.currentGeneration) continue;
      event.callback();
    }
  }

  /**
   * Discard scheduled callbacks on seek and reconstruct at the target. Neither
   * backward nor forward seeks execute the callbacks that lie in between.
   */
  seeked(generation = this.currentGeneration): void {
    if (generation !== this.currentGeneration) return;
    this.events.clear();
    this.hooks.rebuildAt(this.now, generation);
  }
}

export type StillDuration = { kind: "finite"; durationMs: number } | { kind: "infinite" };
export type StillState = "inactive" | "waiting" | "released" | "cancelled" | "stale";

/** Pausable finite/infinite still-frame wait, driven explicitly by a synthetic or host logical clock. */
export class StillFrameTimer {
  private currentGeneration = 0;
  private remainingMs = 0;
  private paused = false;
  private active = false;
  private infinite = false;
  private stateValue: StillState = "inactive";

  get state(): StillState { return this.stateValue; }
  get remaining(): number | null { return this.active && !this.infinite ? this.remainingMs : null; }

  begin(duration: StillDuration, generation: number): StillState {
    if (!Number.isSafeInteger(generation) || generation < this.currentGeneration) return "stale";
    if (duration.kind === "finite" && (!Number.isFinite(duration.durationMs) || duration.durationMs < 0)) throw new RangeError("finite still duration must be non-negative");
    this.currentGeneration = generation;
    this.infinite = duration.kind === "infinite";
    this.remainingMs = duration.kind === "finite" ? duration.durationMs : 0;
    this.paused = false;
    this.active = this.infinite || this.remainingMs > 0;
    this.stateValue = this.active ? "waiting" : "released";
    return this.stateValue;
  }

  pause(generation: number): StillState {
    if (!this.isCurrent(generation)) return "stale";
    this.paused = true;
    return this.stateValue;
  }

  resume(generation: number): StillState {
    if (!this.isCurrent(generation)) return "stale";
    this.paused = false;
    return this.stateValue;
  }

  /** Advance only from the caller's pausable logical clock, never while paused or for infinite stills. */
  advance(deltaMs: number, generation: number): StillState {
    if (!this.isCurrent(generation)) return "stale";
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError("still delta must be non-negative");
    if (!this.active || this.paused || this.infinite) return this.stateValue;
    this.remainingMs = Math.max(0, this.remainingMs - deltaMs);
    if (this.remainingMs === 0) {
      this.active = false;
      this.stateValue = "released";
    }
    return this.stateValue;
  }

  cancel(generation: number): StillState {
    if (!this.isCurrent(generation)) return "stale";
    this.active = false;
    this.stateValue = "cancelled";
    return this.stateValue;
  }

  private isCurrent(generation: number): boolean { return generation === this.currentGeneration; }
}

export interface BackgroundLoopSample {
  generation: number;
  cycle: number;
  assetTimeMs: number;
  logicalTimeMs: number;
}

/** Unwraps the finite packaged background asset into a cancellable logical loop timeline. */
export class BackgroundLoopClock {
  private currentGeneration = 0;
  private durationMs = 0;
  private cycle = 0;
  private active = false;

  start(durationMs: number, generation: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new RangeError("loop duration must be positive");
    if (!Number.isSafeInteger(generation) || generation < this.currentGeneration) throw new RangeError("generation must be a non-decreasing safe integer");
    this.currentGeneration = generation;
    this.durationMs = durationMs;
    this.cycle = 0;
    this.active = true;
  }

  /** Advance only after the host confirms a natural loop boundary; a currentTime decrease alone may be a seek. */
  advanceCycle(generation: number): boolean {
    if (!this.active || generation !== this.currentGeneration) return false;
    this.cycle++;
    return true;
  }

  sample(assetTimeSeconds: number, generation: number): BackgroundLoopSample | null {
    if (!this.active || generation !== this.currentGeneration) return null;
    const assetTimeMs = secondsToMilliseconds(assetTimeSeconds);
    if (assetTimeMs >= this.durationMs) throw new RangeError("loop media time must be inside the packaged asset duration");
    return { generation, cycle: this.cycle, assetTimeMs, logicalTimeMs: this.cycle * this.durationMs + assetTimeMs };
  }

  cancel(generation: number): void {
    if (generation !== this.currentGeneration) return;
    this.active = false;
  }
}

function secondsToMilliseconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("media currentTime must be a finite non-negative number");
  return seconds * 1000;
}
