import { describe, expect, it, vi } from "vitest";
import { BackgroundLoopClock, MediaClockScheduler, StillFrameTimer } from "./media-clock.js";

describe("media clock scheduler", () => {
  it("uses native currentTime as its only playback clock and freezes while paused", () => {
    const media = { currentTime: 4, paused: false };
    const scheduler = new MediaClockScheduler(media, { rebuildAt: vi.fn() });
    const fired = vi.fn();
    scheduler.schedule(500, "animation", fired);
    expect(scheduler.now).toBe(4_000);

    media.paused = true;
    scheduler.advanceWhileRunning(60_000);
    expect(scheduler.now).toBe(4_000);
    expect(fired).not.toHaveBeenCalled();

    media.currentTime = 4.5;
    scheduler.sample();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("rebuilds after forward or backward seek without replaying crossed callbacks", () => {
    const media = { currentTime: 10, paused: true };
    const rebuildAt = vi.fn();
    const scheduler = new MediaClockScheduler(media, { rebuildAt });
    const historicalNavigation = vi.fn();
    scheduler.schedule(500, "navigation", historicalNavigation);

    media.currentTime = 2;
    scheduler.seeked();
    expect(rebuildAt).toHaveBeenCalledWith(2_000, 0);
    media.currentTime = 11;
    scheduler.sample();
    expect(historicalNavigation).not.toHaveBeenCalled();

    const futureVisual = vi.fn();
    scheduler.schedule(1_000, "visual", futureVisual);
    media.currentTime = 20;
    scheduler.seeked();
    expect(rebuildAt).toHaveBeenLastCalledWith(20_000, 0);
    expect(futureVisual).not.toHaveBeenCalled();
  });

  it("drops events from stale generations and supports scope cancellation", () => {
    const media = { currentTime: 1, paused: false };
    const scheduler = new MediaClockScheduler(media, { rebuildAt: vi.fn() });
    const stale = vi.fn(); const cancelled = vi.fn(); const current = vi.fn();
    scheduler.schedule(0, "old", stale);
    scheduler.setGeneration(1);
    scheduler.schedule(0, "remove", cancelled);
    scheduler.schedule(0, "keep", current);
    scheduler.cancelScope("remove");
    scheduler.advanceWhileRunning(0);
    expect(stale).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  });
});

describe("still and background loop clocks", () => {
  it("pauses finite still time, keeps infinite still blocked, and rejects stale generations", () => {
    const still = new StillFrameTimer();
    expect(still.begin({ kind: "finite", durationMs: 1_000 }, 1)).toBe("waiting");
    still.advance(300, 1);
    still.pause(1);
    still.advance(50_000, 1);
    expect(still.remaining).toBe(700);
    still.resume(1);
    expect(still.advance(700, 1)).toBe("released");
    expect(still.advance(1, 0)).toBe("stale");

    expect(still.begin({ kind: "infinite" }, 2)).toBe("waiting");
    still.advance(1_000_000, 2);
    expect(still.state).toBe("waiting");
    expect(still.remaining).toBeNull();
    expect(still.cancel(2)).toBe("cancelled");
  });

  it("tracks explicitly signaled background loops without mistaking a seek for a loop", () => {
    const loop = new BackgroundLoopClock();
    loop.start(2_000, 3);
    expect(loop.sample(1.75, 3)).toEqual({ generation: 3, cycle: 0, assetTimeMs: 1_750, logicalTimeMs: 1_750 });
    expect(loop.sample(0.1, 3)).toEqual({ generation: 3, cycle: 0, assetTimeMs: 100, logicalTimeMs: 100 });
    expect(loop.advanceCycle(2)).toBe(false);
    expect(loop.advanceCycle(3)).toBe(true);
    expect(loop.sample(0.1, 3)).toEqual({ generation: 3, cycle: 1, assetTimeMs: 100, logicalTimeMs: 2_100 });
    expect(loop.sample(0.1, 2)).toBeNull();
    loop.cancel(3);
    expect(loop.sample(0.2, 3)).toBeNull();
  });
});
