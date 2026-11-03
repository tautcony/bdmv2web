import { describe, expect, it, vi } from "vitest";
import { HdmvVm } from "@bdmv-web/hdmv";
import { LinearPlaybackBridge, type LinearPlaybackAsset, type LinearPlaybackMedia, type LinearTimelineMapPort } from "./index.js";

class FakeMedia implements LinearPlaybackMedia {
  private time = 0;
  currentTime = 0;
  autoSeeked = true;
  duration = 30;
  readyState = 2;
  paused = true;
  src = "";
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly load = vi.fn();
  readonly play = vi.fn(async () => { this.paused = false; });
  readonly pause = vi.fn(() => { this.paused = true; });

  constructor() {
    Object.defineProperty(this, "currentTime", {
      get: () => this.time,
      set: (value: number) => { this.time = value; if (this.autoSeeked) this.emit("seeked"); },
      configurable: true,
    });
  }

  addEventListener(type: string, listener: EventListener): void {
    const bucket = this.listeners.get(type) ?? new Set<EventListener>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: EventListener): void { this.listeners.get(type)?.delete(listener); }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(new Event(type));
  }
}

const timeline: LinearTimelineMapPort = {
  mappings: [{ mappingId: "pi-0", playlistId: "playlist-3", assetId: "asset-3", playlistStart90k: "0", playlistEnd90k: "2700000", mediaStart90k: "0", mediaEnd90k: "2700000" }],
  playlistToSource: (_playlistId, playlistTime90k) => ({ mapping: timeline.mappings[0]!, playlistTime90k: String(playlistTime90k), mediaTime90k: String(playlistTime90k) }),
  mediaToSource: () => null,
};

function asset(path = "assets/video.mp4"): LinearPlaybackAsset {
  return {
    playlistNumber: 3,
    playlistId: "playlist-3",
    audioStreamNumber: 1,
    variantId: "main",
    path,
    timeline,
    playItemOperandToMappingId: { 0: "pi-0" },
    playMarkOperandToPlaylistTime90k: { 1: "900000" },
  };
}

function nextPlaylistAction(vm: HdmvVm) {
  vm.reset(9);
  vm.runTurn();
  return vm.drainActions()[0]!;
}

function makeVm(): HdmvVm { return new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]); }

describe("linear playback generation cancellation", () => {
  it("keeps the menu canvas over the current video context when a pop-up action arrives", async () => {
    const vm = makeVm();
    const video = new FakeMedia();
    const canvasOverlay = {};
    const overlayStage = { video, canvas: canvasOverlay };
    const bridge = new LinearPlaybackBridge(vm, overlayStage.video, [asset()], { report: vi.fn() });
    const play = nextPlaylistAction(vm);

    await bridge.dispatch(play);
    const sourceWhilePlaying = video.src;
    const popUp = { id: "popup", generation: play.generation + 1, type: "MENU_CALL", payload: {} } as const;
    await bridge.dispatch(popUp);

    expect(video.src).toBe(sourceWhilePlaying);
    expect(video.pause).not.toHaveBeenCalled();
    expect(overlayStage.canvas).toBe(canvasOverlay);
    video.emit("ended");
    expect(vm.trace.some((entry) => entry.event?.type === "MEDIA_ENDED" && entry.event.responseTo === play.id)).toBe(true);
  });

  it("ignores old loadedmetadata and timeout completion after a replacement generation", async () => {
    vi.useFakeTimers();
    try {
      const vm = makeVm();
      const media = new FakeMedia(); media.readyState = 0;
      const bridge = new LinearPlaybackBridge(vm, media, [asset()], { report: vi.fn(), timeoutMs: 20 });
      const oldAction = nextPlaylistAction(vm);
      const oldStart = bridge.dispatch(oldAction);
      const currentAction = nextPlaylistAction(vm);
      const currentStart = bridge.dispatch(currentAction);

      media.readyState = 2;
      media.emit("loadedmetadata");
      await currentStart;
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(25);
      await oldStart;

      expect(vm.snapshot().waiting?.id).toBe(currentAction.id);
      expect(vm.trace.some((entry) => entry.event?.responseTo === oldAction.id && entry.event.type === "MEDIA_STARTED")).toBe(false);
      expect(vm.snapshot().playback.pendingActionId).toBe(currentAction.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a captured old ended callback after a new playlist takes over the video", async () => {
    const vm = makeVm();
    const media = new FakeMedia();
    const bridge = new LinearPlaybackBridge(vm, media, [asset()], { report: vi.fn() });
    const oldAction = nextPlaylistAction(vm);
    await bridge.dispatch(oldAction);
    const oldEnded = [...(media.listeners.get("ended") ?? [])][0]!;
    const currentAction = nextPlaylistAction(vm);
    await bridge.dispatch({ ...currentAction, payload: { playlist: 3 } });

    oldEnded(new Event("ended"));

    expect(vm.snapshot().waiting?.id).toBe(currentAction.id);
    expect(vm.snapshot().playback.status).toBe("requested");
    expect(vm.trace.some((entry) => entry.event?.type === "MEDIA_ENDED" && entry.event.responseTo === oldAction.id)).toBe(false);
  });

  it("ignores a seeked completion captured before a replacement generation", async () => {
    const vm = makeVm();
    const media = new FakeMedia();
    const bridge = new LinearPlaybackBridge(vm, media, [asset()], { report: vi.fn() });
    const oldAction = nextPlaylistAction(vm);
    await bridge.dispatch(oldAction);
    media.autoSeeked = false;
    const linkAction = { id: "link", generation: oldAction.generation, type: "LINK_PLAY_MARK", payload: { playlist: 3, playMark: 1 } } as const;
    const oldSeek = bridge.dispatch(linkAction);
    const oldSeeked = [...(media.listeners.get("seeked") ?? [])][0]!;
    const currentAction = nextPlaylistAction(vm);
    media.autoSeeked = true;
    await bridge.dispatch(currentAction);

    media.currentTime = 10;
    oldSeeked(new Event("seeked"));
    await oldSeek;

    expect(vm.snapshot().waiting?.id).toBe(currentAction.id);
    expect(vm.trace.some((entry) => entry.event?.responseTo === "link" && entry.event.type === "MEDIA_SEEKED")).toBe(false);
  });
});
