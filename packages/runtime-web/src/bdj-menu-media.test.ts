import { afterEach, expect, it, vi } from "vitest";
import { startBdjMenuMedia } from "./bdj-menu-media.js";
import type { BdjMenuMediaEvent } from "./bdj-runtime.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("reports Started only after video playing and ends after every actual playlist item ends", async () => {
  const events = new Map<string, Array<() => void>>();
  const srcHistory: string[] = [];
  const video = {
    className: "", preload: "", playsInline: false, paused: false, src: "",
    setAttribute: vi.fn(), addEventListener: (type: string, listener: () => void) => events.set(type, [...(events.get(type) ?? []), listener]),
    removeAttribute: vi.fn(function(this: { src: string }) { this.src = ""; }), load: vi.fn(),
    play: vi.fn(() => Promise.resolve()), pause: vi.fn(function(this: { paused: boolean }) { this.paused = true; }), fire: (type: string) => { for (const listener of events.get(type) ?? []) listener(); },
  };
  Object.defineProperty(video, "src", { get() { return srcHistory.at(-1) ?? ""; }, set(value: string) { srcHistory.push(value); } });
  vi.stubGlobal("document", { baseURI: "http://127.0.0.1:4173/", createElement: () => video });
  const event: BdjMenuMediaEvent = {
    playerId: "menu-player", mode: "menu", bdjoId: "00001", title: 2, playlistId: "00100",
    source: { path: "BDMV/PLAYLIST/00100.mpls", offset: "70" },
    items: [0, 1].map((index) => ({ index, clipId: "00100", source: { path: "BDMV/PLAYLIST/00100.mpls", offset: String(70 + index) }, start90k: "90000", end90k: "180000", url: `/api/bdj/menu-media/${index}` })),
  };
  const observed: string[] = [];
  const handle = startBdjMenuMedia(event, video as unknown as HTMLVideoElement, null, (_playerId, kind) => observed.push(kind), () => undefined)!;
  await Promise.resolve();
  expect(video.play).toHaveBeenCalledTimes(1);
  expect(observed).toEqual([]);

  video.fire("playing");
  expect(observed.slice(0, 2)).toEqual(["started", "presented"]);
  video.fire("playing");
  expect(observed.slice(0, 2)).toEqual(["started", "presented"]);
  video.fire("ended");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(video.play).toHaveBeenCalledTimes(2);
  expect(observed).toEqual(["started", "presented"]);
  video.fire("playing");
  video.fire("ended");
  expect(observed).toEqual(["started", "presented", "ended"]);
  expect(video.removeAttribute).toHaveBeenCalledWith("src");
  expect(srcHistory).toEqual(["http://127.0.0.1:4173/api/bdj/menu-media/0", "http://127.0.0.1:4173/api/bdj/menu-media/1", ""]);
  handle.stop();
  expect(observed).toEqual(["started", "presented", "ended"]);
});

it("plays a loop-mark intro once then repeats the marked segment without reporting EndOfMedia", async () => {
  const events = new Map<string, Array<() => void>>();
  const video = {
    className: "", preload: "", playsInline: false, paused: false, src: "", currentTime: 0,
    setAttribute: vi.fn(), addEventListener: (type: string, listener: () => void) => events.set(type, [...(events.get(type) ?? []), listener]),
    removeAttribute: vi.fn(function(this: { src: string }) { this.src = ""; }), load: vi.fn(),
    play: vi.fn(() => Promise.resolve()), pause: vi.fn(function(this: { paused: boolean }) { this.paused = true; }), fire: (type: string) => { for (const listener of events.get(type) ?? []) listener(); },
  };
  vi.stubGlobal("document", { baseURI: "http://127.0.0.1:4173/" });
  const event: BdjMenuMediaEvent = {
    playerId: "menu-loop-player", mode: "menu", bdjoId: "00001", title: 2, playlistId: "00100",
    source: { path: "BDMV/PLAYLIST/00100.mpls", offset: "70" },
    items: [{ index: 0, clipId: "00100", source: { path: "BDMV/PLAYLIST/00100.mpls", offset: "70" }, start90k: "1048560", end90k: "2347356", loopStartOffset90k: "1276274", loopMarkIndex: 45, marks: [{ index: 45, offset90k: "1276274" }], url: "/api/bdj/menu-media/intro" }],
  };
  const observed: string[] = [];
  const handle = startBdjMenuMedia(event, video as unknown as HTMLVideoElement, null, (_playerId, kind) => observed.push(kind), () => undefined)!;
  await Promise.resolve();
  video.fire("playing");
  expect(observed).toEqual(["started", "presented"]);
  video.currentTime = 14.431;
  video.fire("timeupdate");
  expect(observed.at(-1)).toBe(`position|${((1048560n + 1298790n) * 1_000_000_000n / 90000n).toString()}|0|45`);

  video.currentTime = 14.431;
  video.fire("ended");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(video.currentTime).toBeCloseTo(1276274 / 90000);
  expect(video.play).toHaveBeenCalledTimes(2);
  expect(observed.slice(0, 2)).toEqual(["started", "presented"]);
  video.fire("playing");
  expect(observed).toContain(`position|${((1048560n + 1298790n) * 1_000_000_000n / 90000n).toString()}|0|45`);
  expect(observed.at(-1)).toBe(`position|${((1048560n + 1276274n) * 1_000_000_000n / 90000n).toString()}|0|45`);

  video.currentTime = 14.431;
  video.fire("ended");
  await Promise.resolve();
  expect(video.currentTime).toBeCloseTo(1276274 / 90000);
  expect(video.play).toHaveBeenCalledTimes(3);
  expect(observed.slice(0, 2)).toEqual(["started", "presented"]);
  handle.stop();
  expect(observed.at(-1)).toBe("stopped");
  expect(observed).not.toContain("ended");
});

it("warns and immediately skips a missing PlayItem before real media, then ends once", async () => {
  const events = new Map<string, Array<() => void>>();
  const video = {
    className: "", preload: "", playsInline: false, paused: false, src: "", currentTime: 0,
    setAttribute: vi.fn(), addEventListener: (type: string, listener: () => void) => events.set(type, [...(events.get(type) ?? []), listener]),
    removeAttribute: vi.fn(function(this: { src: string }) { this.src = ""; }), load: vi.fn(),
    play: vi.fn(() => Promise.resolve()), pause: vi.fn(function(this: { paused: boolean }) { this.paused = true; }),
    fire: (type: string) => { for (const listener of events.get(type) ?? []) listener(); },
  };
  vi.stubGlobal("document", { baseURI: "http://127.0.0.1:4173/" });
  const event: BdjMenuMediaEvent = {
    playerId: "blank-menu-player", mode: "menu", bdjoId: "00000", title: 3, playlistId: "00355",
    source: { path: "BDMV/PLAYLIST/00355.mpls", offset: "120" },
    items: [
      { index: 0, clipId: "00356", source: { path: "BDMV/PLAYLIST/00355.mpls", offset: "120" }, start90k: "1000", end90k: "91000", mediaStart90k: "0", missing: true, warning: "BD-J media is missing: BDJO 00000, title 3, playlist 00355, PlayItem 0, source STREAM/00356.m2ts. Skipping this item.", audioUrls: [], marks: [{ index: 0, offset90k: "0" }, { index: 1, offset90k: "45000" }] },
      { index: 1, clipId: "00357", source: { path: "BDMV/PLAYLIST/00355.mpls", offset: "150" }, start90k: "91000", end90k: "181000", mediaStart90k: "90000", url: "/video/next", audioUrls: [], marks: [] },
    ],
  };
  const observed: string[] = []; const warnings: string[] = [];
  const handle = startBdjMenuMedia(event, video as unknown as HTMLVideoElement, null, (_playerId, kind) => observed.push(kind), (message) => warnings.push(message))!;
  expect(warnings).toEqual(["BD-J media is missing: BDJO 00000, title 3, playlist 00355, PlayItem 0, source STREAM/00356.m2ts. Skipping this item."]);
  expect(video.play).toHaveBeenCalledTimes(1);
  expect(video.src).toBe("http://127.0.0.1:4173/video/next");
  video.fire("timeupdate"); video.fire("ended");
  expect(observed).toEqual([]);
  video.fire("playing"); video.fire("ended");
  expect(observed.filter((item) => item.startsWith("missing-ended|")).length).toBe(1);
  expect(observed).toEqual(["started", "presented", "missing-ended|0|BDMV%2FPLAYLIST%2F00355.mpls"]);
  handle.stop();
});

it("skips consecutive missing PlayItems immediately and reports one missing terminal", () => {
  const events = new Map<string, Array<() => void>>();
  const video = {
    className: "", preload: "", playsInline: false, paused: false, src: "",
    setAttribute: vi.fn(), addEventListener: (type: string, listener: () => void) => events.set(type, [...(events.get(type) ?? []), listener]),
    removeAttribute: vi.fn(function(this: { src: string }) { this.src = ""; }), load: vi.fn(), play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(function(this: { paused: boolean }) { this.paused = true; }),
  };
  const event: BdjMenuMediaEvent = {
    playerId: "blank-stop-player", mode: "menu", bdjoId: "00000", title: 3, playlistId: "00355",
    source: { path: "BDMV/PLAYLIST/00355.mpls", offset: "120" },
    items: [0, 1, 2].map((index) => ({ index, clipId: `0035${index + 6}`, source: { path: `STREAM/0035${index + 6}.m2ts`, offset: "120" }, start90k: "0", end90k: "450000", missing: true as const, warning: `missing-${index}`, audioUrls: [], marks: [] })),
  };
  const observed: string[] = [];
  const warnings: string[] = [];
  const handle = startBdjMenuMedia(event, video as unknown as HTMLVideoElement, null, (_playerId, kind) => observed.push(kind), (message) => warnings.push(message));
  expect(handle).toBeUndefined();
  expect(warnings).toEqual(["missing-0", "missing-1", "missing-2"]);
  expect(video.play).not.toHaveBeenCalled();
  expect(observed).toEqual(["missing-ended|2|STREAM%2F00358.m2ts"]);
});

it("stops a real playlist without emitting a terminal event for skipped or stale media", () => {
  const events = new Map<string, Array<() => void>>();
  const video = {
    className: "", preload: "", playsInline: false, paused: false, src: "", currentTime: 0,
    setAttribute: vi.fn(), addEventListener: (type: string, listener: () => void) => events.set(type, [...(events.get(type) ?? []), listener]),
    removeAttribute: vi.fn(function(this: { src: string }) { this.src = ""; }), load: vi.fn(), play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(function(this: { paused: boolean }) { this.paused = true; }), fire: (type: string) => { for (const listener of events.get(type) ?? []) listener(); },
  };
  vi.stubGlobal("document", { baseURI: "http://127.0.0.1:4173/" });
  const event: BdjMenuMediaEvent = {
    playerId: "missing-stop-player", mode: "menu", bdjoId: "00000", title: 3, playlistId: "00355", source: { path: "BDMV/PLAYLIST/00355.mpls", offset: "120" },
    items: [{ index: 0, clipId: "00356", source: { path: "STREAM/00356.m2ts" }, start90k: "0", end90k: "1000", missing: true, audioUrls: [], marks: [] },
      { index: 1, clipId: "00357", source: { path: "STREAM/00357.m2ts" }, start90k: "1000", end90k: "2000", url: "/video/next", audioUrls: [], marks: [] }],
  };
  const observed: string[] = [];
  const handle = startBdjMenuMedia(event, video as unknown as HTMLVideoElement, null, (_playerId, kind) => observed.push(kind), () => undefined)!;
  video.fire("playing");
  handle.stop();
  video.fire("timeupdate"); video.fire("ended");
  expect(observed).toEqual(["started", "presented", "stopped"]);
});
