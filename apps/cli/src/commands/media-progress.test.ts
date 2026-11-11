import { describe, expect, it } from "vitest";
import type { MediaAssetProgress, MenuLoopMediaInput } from "@bdmv2web/media-export";
import { mediaExportProgress } from "./media-progress.js";

function clip(playlistId: string, playItemIndex: number, clipId: string, audioPids: readonly number[] = []): MenuLoopMediaInput {
  return {
    sourcePath: `/disc/STREAM/${clipId}.m2ts`, sourceFile: `${clipId}.m2ts`,
    playlistId, playItemIndex, clipId, inTime45k: 0, outTime45k: 45_000 * 10,
    stillMode: 0, repeatCount: 1, videoPid: 0x1011,
    audioTracks: audioPids.map((pid, index) => ({ streamNumber: index + 1, pid, language: "zho" })),
  };
}

function report(playlistId: string, playItemIndex: number, clipId: string, outTimeSeconds: number, durationSeconds: number, state: "continue" | "end" = "continue", extra: { videoMode?: "encode" | "copy"; reused?: boolean } = {}): MediaAssetProgress {
  return {
    outTimeSeconds, durationSeconds, state, assetPath: `assets/media/${clipId}.mp4`,
    source: { playlistId, playItemIndex, clipId, kind: "background", pid: 0x1011, ...extra },
  };
}

describe("media export progress", () => {
  it("counts every planned clip before the first one is exported", () => {
    const plan = mediaExportProgress([clip("00001", 0, "00377", [0x1100, 0x1101]), clip("00002", 0, "00378")], () => undefined);
    expect(plan.clips).toBe(2);
  });

  it("advances one clip at a time and ends at 100% on the last clip", () => {
    const ratios: number[] = [];
    const plan = mediaExportProgress([clip("00001", 0, "00377"), clip("00002", 0, "00378")], (ratio) => ratios.push(ratio));
    plan.onMediaProgress(report("00001", 0, "00377", 5, 10));
    plan.onMediaProgress(report("00001", 0, "00377", 10, 10, "end"));
    plan.onMediaProgress(report("00002", 0, "00378", 5, 10));
    plan.onMediaProgress(report("00002", 0, "00378", 10, 10, "end"));
    expect(ratios).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("keeps the bar in step with the clip counter on a six-track clip", () => {
    const ratios: number[] = [];
    // Audio no longer reports separately, so a clip is one unit whatever its track count.
    const plan = mediaExportProgress([clip("00001", 0, "00377", [0x1100, 0x1101, 0x1102, 0x1103, 0x1104, 0x1105]), clip("00002", 0, "00378")], (ratio) => ratios.push(ratio));
    plan.onMediaProgress(report("00001", 0, "00377", 300, 600, "end"));
    plan.onMediaProgress(report("00002", 0, "00378", 30, 60));
    expect(ratios).toEqual([0.5, 0.75]);
  });

  it("counts a reused clip as finished so a resumed run still reaches 100%", () => {
    const details: string[] = [];
    const ratios: number[] = [];
    const plan = mediaExportProgress([clip("00001", 0, "00377"), clip("00002", 0, "00378")], (ratio, detail) => { ratios.push(ratio); details.push(detail); });
    plan.onMediaProgress(report("00001", 0, "00377", 10, 10, "end", { reused: true }));
    expect(ratios).toEqual([0.5]);
    expect(details).toEqual(["clip 1/2 · 00377.m2ts · reused"]);
    plan.onMediaProgress(report("00002", 0, "00378", 10, 10, "end", { videoMode: "copy" }));
    expect(ratios.at(-1)).toBe(1);
  });

  it("names the clip position and the video pipeline of the running clip", () => {
    const details: string[] = [];
    const plan = mediaExportProgress([clip("00001", 0, "00377"), clip("00002", 0, "00378")], (_ratio, detail) => details.push(detail));
    plan.onMediaProgress(report("00002", 0, "00378", 412.44, 596, "continue", { videoMode: "copy" }));
    expect(details).toEqual(["clip 2/2 · 00378.m2ts · background copy 412.4/596.0s"]);
  });

  it("drops the position for a single-clip plan", () => {
    const details: string[] = [];
    const plan = mediaExportProgress([clip("00001", 0, "00377")], (_ratio, detail) => details.push(detail));
    expect(plan.clips).toBe(1);
    plan.onMediaProgress(report("00001", 0, "00377", 1, 2, "continue", { videoMode: "encode" }));
    expect(details).toEqual(["clip 00377.m2ts · background encode 1.0/2.0s"]);
  });

  it("counts a playlist PlayItem once when the plan lists it twice", () => {
    const plan = mediaExportProgress([clip("00001", 0, "00377"), clip("00001", 0, "00377")], () => undefined);
    expect(plan.clips).toBe(1);
  });
});
