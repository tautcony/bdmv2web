import { describe, expect, it } from "vitest";
import type { ParsedDisc, PlayItem, SourceLocation } from "@bdmv2web/bdmv-parser";
import type { MediaClosure } from "./closure.js";
import { createExternalMediaTargets, resolveExternalPlayTarget } from "./external-targets.js";

const source: SourceLocation = { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" };
function fixture(): { disc: ParsedDisc; closure: MediaClosure } {
  const item = (index: number, clipId: string, inTime45k: number, outTime45k: number): PlayItem => ({
    index, clipId, codecId: "M2TS", stcId: 0, inTime45k, outTime45k, connectionCondition: 1,
    multiAngle: false, angleCount: 1, differentAudio: false, seamlessAngle: false, uoMask: "0", stillMode: 0, stillTime: 0, streams: [], source,
  });
  const disc = {
    clips: ["00004", "00005"].map((id) => ({ id, sequence: [{ offsetStcId: 0, stcs: [{ presentationStartPts: 0 }] }] })),
    playlists: [{ id: "00001", version: "0200", source, playItems: [item(0, "00004", 45000, 135000), item(1, "00005", 90000, 225000), item(2, "00004", 270000, 315000)],
      marks: [{ index: 0, type: 1, playItemRef: 1, time45k: 112500, entryEsPid: 0, duration45k: 0, source }] }],
    graph: { nodes: [{ id: "clip:00004", type: "clip", state: "present", source }, { id: "clip:00005", type: "clip", state: "present", source }], edges: [] },
  } as unknown as ParsedDisc;
  const closure: MediaClosure = { playlistIds: ["playlist:00001"], clipIds: [], streamIds: [], requiredNodeIds: [], routes: [], unknown: [], complete: true, explored: 1 };
  return { disc, closure };
}

describe("external source playlist boundaries", () => {
  it("preserves ordered half-open intervals and repeated clips without claiming concatenated playback", () => {
    const { disc, closure } = fixture(); const map = createExternalMediaTargets(disc, closure);
    expect(map.playlists[0]?.items.map((item) => [item.clipId, item.sourceIn90k, item.sourceOut90k, item.playlistStart90k, item.playlistEnd90k])).toEqual([
      ["00004", "90000", "270000", "0", "180000"], ["00005", "180000", "450000", "180000", "450000"], ["00004", "540000", "630000", "450000", "540000"],
    ]);
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST", playlist: 1 })).toMatchObject({ status: "available", item: { index: 0 }, remainingItems: [{ index: 1 }, { index: 2 }] });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_ITEM", playlist: 1, playItem: 2 })).toMatchObject({ status: "available", item: { clipId: "00004", index: 2 }, clipTime90k: "540000", seekTime90k: "540000", remainingItems: [] });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_MARK", playlist: 1, playMark: 0 })).toMatchObject({ status: "available", item: { index: 1 }, clipTime90k: "225000", seekTime90k: "225000" });
  });
  it("reports missing files, unknown items and out-of-range marks without guessing", () => {
    const { disc, closure } = fixture(); disc.graph.nodes[1]!.state = "missing";
    const map = createExternalMediaTargets(disc, closure);
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_ITEM", playlist: 1, playItem: 1 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_STREAM_MISSING" });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_ITEM", playlist: 1, playItem: 9 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_PLAYITEM_UNKNOWN" });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_MARK", playlist: 1, playMark: 9 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_MARK_UNKNOWN" });
    map.playlists[0]!.marks[0]!.sourceTime90k = "450000";
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_MARK", playlist: 1, playMark: 0 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_TIME_INVALID" });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST", playlist: 2 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_PLAYLIST_UNKNOWN" });
  });
});
