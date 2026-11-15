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
  const closure: MediaClosure = {
    playlistIds: ["playlist:00001"], clipIds: [], streamIds: [], requiredNodeIds: [],
    routes: [
      { playlistId: "playlist:00001", origin: "entry", entryId: "firstPlay", entrySource: source, buttonProgramId: null,
        navigationEdges: [{ from: "entry:first", to: "playlist:00001", kind: "play", condition: "branch A", source }] },
      { playlistId: "playlist:00001", origin: "button-program", entryId: null, entrySource: null, buttonProgramId: 7,
        navigationEdges: [{ from: "button:7", to: "playlist:00001", kind: "play", condition: "branch B", source }] },
    ],
    unknown: [{ code: "NAVIGATION_TARGET_UNKNOWN", message: "dynamic target", source }], complete: false, explored: 1,
  };
  return { disc, closure };
}

describe("external source playlist boundaries", () => {
  it("preserves ordered half-open intervals and repeated clips", () => {
    const { disc, closure } = fixture(); const map = createExternalMediaTargets(disc, closure);
    expect(map.playlists[0]?.items.map((item) => [item.clipId, item.sourceIn90k, item.sourceOut90k, item.playlistStart90k, item.playlistEnd90k])).toEqual([
      ["00004", "90000", "270000", "0", "180000"], ["00005", "180000", "450000", "180000", "450000"], ["00004", "540000", "630000", "450000", "540000"],
    ]);
    expect(map).toMatchObject({
      complete: false,
      unknown: [{ code: "NAVIGATION_TARGET_UNKNOWN", message: "dynamic target", source }],
      playlists: [{
        id: "00001", source,
        routes: [
          { origin: "entry", navigationEdges: [{ condition: "branch A", source }] },
          { origin: "button-program", navigationEdges: [{ condition: "branch B", source }] },
        ],
        items: [{ source }, { source }, { source }], marks: [{ source }],
      }],
    });
    // The creation path feeds the core resolver directly.
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_ITEM", playlist: 1, playItem: 2 })).toMatchObject({ status: "available", clipTime90k: "540000", seekTime90k: "540000" });
  });

  it("records each PlayItem's presence from the structural graph", () => {
    const { disc, closure } = fixture(); disc.graph.nodes[1]!.state = "missing";
    const map = createExternalMediaTargets(disc, closure);
    expect(map.playlists[0]?.items.map((item) => item.present)).toEqual([true, false, true]);
  });
});
