import { describe, expect, it } from "vitest";
import { seekTimeline, type SeekMediaElement } from "./index.js";
import { MediaTimelineMap, type MediaTimelineMapping } from "./timeline.js";

const mapping: MediaTimelineMapping[] = [
  {
    mappingId: "p:pi0", playlistId: "p", playItemId: "0", clipId: "a", variantId: "main",
    sourceIn90k: "900000", sourceOut90k: "1080000", playlistStart90k: "0", playlistEnd90k: "180000",
    assetId: "linear", mediaStart90k: "0", mediaEnd90k: "180000", timestampEpoch: "a:0", sourceTimebase: "90k",
  },
  {
    mappingId: "p:pi1", playlistId: "p", playItemId: "1", clipId: "b", variantId: "main",
    sourceIn90k: "450000", sourceOut90k: "720000", playlistStart90k: "180000", playlistEnd90k: "450000",
    assetId: "linear", mediaStart90k: "9000", mediaEnd90k: "279000", timestampEpoch: "b:3", sourceTimebase: "90k",
  },
];

class FakeMedia implements SeekMediaElement {
  currentTime = 0;
  duration = 5;
  readyState = 0;
  autoSeeked = true;
  actualOffsetSeconds = 0;
  readyStateAfterSeek = 2;
  listeners = new Map<string, Set<(event?: unknown) => void>>();
  setCalls = 0;

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const bucket = this.listeners.get(type) ?? new Set(); bucket.add(listener); this.listeners.set(type, bucket);
  }
  removeEventListener(type: string, listener: (event?: unknown) => void): void { this.listeners.get(type)?.delete(listener); }
  emit(type: string): void { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(); }
  setCurrentTime(value: number): void {
    this.setCalls++;
    (this as unknown as { __time: number }).__time = value + this.actualOffsetSeconds;
    this.readyState = this.readyStateAfterSeek;
    if (this.autoSeeked) this.emit("seeked");
  }
}

function createMedia(): FakeMedia {
  const media = new FakeMedia();
  Object.defineProperty(media, "currentTime", {
    get() { return this.__time ?? 0; },
    set(value: number) { this.__time = value; this.setCurrentTime(value); },
    configurable: true,
  });
  return media;
}

function request(media: FakeMedia, isCurrent: (generation: number) => boolean = () => true) {
  return { timeline: new MediaTimelineMap(mapping), playlistId: "p", playlistTime90k: "225000", media, generation: 7, isCurrent, targetFrameDuration90k: "3000", timeoutMs: 100 };
}

describe("timeline calibrated seek", () => {
  it("maps a cross-PlayItem chapter with a non-zero output PTS after loadedmetadata and seeked", async () => {
    const media = createMedia();
    const resultPromise = seekTimeline(request(media));
    await Promise.resolve();
    expect(media.setCalls).toBe(0);
    media.readyState = 1;
    media.emit("loadedmetadata");
    const result = await resultPromise;

    expect(result).toMatchObject({ status: "completed", generation: 7, requestedSeconds: 0.6, actualSeconds: 0.6, errorSeconds: 0, toleranceSeconds: 1 / 30, position: { mapping: { playItemId: "1" }, sourceTime90k: "495000", playlistTime90k: "225000", mediaTime90k: "54000" } });
    expect(media.setCalls).toBe(1);
  });

  it("does not report success when decoded seek position is more than one frame away", async () => {
    const media = createMedia();
    media.readyState = 1;
    media.actualOffsetSeconds = 4000 / 90_000;
    const result = await seekTimeline(request(media));
    expect(result).toMatchObject({ status: "failed", reason: expect.stringContaining("more than one target-video frame") });
    expect(result.status === "failed" ? result.errorSeconds : -1).toBeCloseTo(4000 / 90_000, 12);
  });

  it("reports a media seek error without a successful completion", async () => {
    const media = createMedia();
    media.readyState = 1;
    media.autoSeeked = false;
    media.readyStateAfterSeek = 1;
    const promise = seekTimeline(request(media));
    await Promise.resolve();
    media.emit("error");
    expect(await promise).toMatchObject({ status: "failed", reason: expect.stringContaining("Media error") });
  });

  it("drops a generation that becomes stale while waiting for metadata", async () => {
    const media = createMedia();
    let current = true;
    const promise = seekTimeline(request(media, () => current));
    await Promise.resolve();
    current = false;
    media.readyState = 1;
    media.emit("loadedmetadata");
    expect(await promise).toMatchObject({ status: "stale", generation: 7 });
    expect(media.setCalls).toBe(0);
  });

  it("drops a seeked response from an obsolete generation", async () => {
    const media = createMedia();
    media.readyState = 1;
    media.autoSeeked = false;
    let current = true;
    const promise = seekTimeline(request(media, () => current));
    await Promise.resolve();
    current = false;
    media.emit("seeked");
    expect(await promise).toMatchObject({ status: "stale", generation: 7 });
  });

  it("waits for loadeddata when seeked arrives before the target frame is decoded", async () => {
    const media = createMedia();
    media.readyState = 1;
    media.autoSeeked = false;
    media.readyStateAfterSeek = 1;
    const promise = seekTimeline(request(media));
    await Promise.resolve();
    media.emit("seeked");
    media.readyState = 2;
    media.emit("loadeddata");
    expect(await promise).toMatchObject({ status: "completed", requestedSeconds: 0.6, actualSeconds: 0.6 });
  });

  it("completes an already decoded target position without waiting for a seeked event", async () => {
    const media = createMedia();
    media.readyState = 2;
    media.autoSeeked = false;
    (media as unknown as { __time: number }).__time = 0.6;
    const result = await seekTimeline(request(media));
    expect(result).toMatchObject({ status: "completed", requestedSeconds: 0.6, actualSeconds: 0.6 });
    expect(media.setCalls).toBe(0);
  });
});
