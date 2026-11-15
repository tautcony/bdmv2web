import { describe, expect, it } from "vitest";
import { isDeclaredExternalStreamPath, resolveExternalPlayTarget, type ExternalMediaTargets, type ExternalPlayItem } from "./playback-targets.js";

const source = { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary" as const, offset: "0" };

function item(index: number, clipId: string, sourceIn90k: string, sourceOut90k: string, playlistStart90k: string, playlistEnd90k: string): ExternalPlayItem {
  return {
    index, stcId: 0, clipId, streamPath: `STREAM/${clipId}.m2ts`, present: true, sourceOrigin90k: "0",
    sourceIn90k, sourceOut90k, playlistStart90k, playlistEnd90k, source,
  };
}

function targets(): ExternalMediaTargets {
  return {
    playlists: [{
      id: "00001",
      source,
      routes: [],
      items: [
        item(0, "00004", "90000", "270000", "0", "180000"),
        item(1, "00005", "180000", "450000", "180000", "450000"),
        item(2, "00004", "540000", "630000", "450000", "540000"),
      ],
      marks: [{ index: 0, playItemIndex: 1, sourceTime90k: "225000", source }],
    }],
    unknown: [],
    complete: true,
  };
}

describe("external play target resolution", () => {
  it("resolves playlist, PlayItem and mark requests to the exact source interval", () => {
    const map = targets();
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST", playlist: 1 })).toMatchObject({ status: "available", item: { index: 0 }, remainingItems: [{ index: 1 }, { index: 2 }] });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_ITEM", playlist: 1, playItem: 2 })).toMatchObject({ status: "available", item: { clipId: "00004", index: 2 }, clipTime90k: "540000", seekTime90k: "540000", remainingItems: [] });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_MARK", playlist: 1, playMark: 0 })).toMatchObject({ status: "available", item: { index: 1 }, clipTime90k: "225000", seekTime90k: "225000" });
  });

  it("reports missing files, unknown targets and invalid time ranges", () => {
    const map = targets();
    map.playlists[0]!.items[1]!.present = false;
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_ITEM", playlist: 1, playItem: 1 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_STREAM_MISSING" });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_ITEM", playlist: 1, playItem: 1 }, { allowMissing: true })).toMatchObject({ status: "available", item: { index: 1, present: false }, clipTime90k: "180000" });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_ITEM", playlist: 1, playItem: 9 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_PLAYITEM_UNKNOWN" });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_MARK", playlist: 1, playMark: 9 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_MARK_UNKNOWN" });
    map.playlists[0]!.marks[0]!.sourceTime90k = "450000";
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_MARK", playlist: 1, playMark: 0 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_TIME_INVALID" });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST", playlist: 2 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_PLAYLIST_UNKNOWN" });
    expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST", playlist: -1 })).toMatchObject({ status: "unavailable", code: "EXTERNAL_PLAYLIST_INVALID" });
  });

  it("rejects stream paths that do not match the declared Clip", () => {
    for (const streamPath of ["/etc/passwd", "../STREAM/00004.m2ts", "STREAM\\00004.m2ts", "https://example.com/00004.m2ts", "STREAM/00005.m2ts", "STREAM/%30%30%30%30%34.m2ts", "STREAM/%252e%252e/00004.m2ts"]) {
      const map = targets();
      map.playlists[0]!.items[0]!.streamPath = streamPath;
      expect(resolveExternalPlayTarget(map, { type: "PLAY_PLAYLIST_ITEM", playlist: 1, playItem: 0 }), streamPath).toMatchObject({
        status: "unavailable", code: "EXTERNAL_TARGET_UNDECLARED", source,
      });
    }
    expect(isDeclaredExternalStreamPath("00004", "STREAM/00004.m2ts")).toBe(true);
    expect(isDeclaredExternalStreamPath("00004", "STREAM/00005.m2ts")).toBe(false);
  });
});
