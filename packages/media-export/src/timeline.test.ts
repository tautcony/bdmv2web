import { describe, expect, it } from "vitest";
import { MediaTimelineMap, normalizeSourceTime, type MediaTimelineMapping } from "./timeline.js";

const mappings: MediaTimelineMapping[] = [
  {
    mappingId: "playlist-1:pi-0:main", playlistId: "1", playItemId: "0", clipId: "clip-a", variantId: "main",
    sourceIn90k: "900000", sourceOut90k: "1080000", playlistStart90k: "0", playlistEnd90k: "180000",
    assetId: "asset-linear", mediaStart90k: "0", mediaEnd90k: "180000", timestampEpoch: "clip-a:epoch-0", sourceTimebase: "90k",
  },
  {
    mappingId: "playlist-1:pi-1:main", playlistId: "1", playItemId: "1", clipId: "clip-a", variantId: "main",
    sourceIn90k: "450000", sourceOut90k: "720000", playlistStart90k: "180000", playlistEnd90k: "450000",
    assetId: "asset-linear", mediaStart90k: "180000", mediaEnd90k: "450000", timestampEpoch: "clip-a:epoch-1", sourceTimebase: "45k",
  },
];

describe("MediaTimelineMap", () => {
  it("matches the cross-PlayItem chapter golden in both directions", () => {
    const map = new MediaTimelineMap(mappings);
    const atChapter = map.playlistToSource("1", "225000");
    expect(atChapter).toMatchObject({ mapping: { playItemId: "1", clipId: "clip-a" }, sourceTime90k: "495000", playlistTime90k: "225000", mediaTime90k: "225000" });
    expect(Number(BigInt(atChapter!.mediaTime90k)) / 90_000).toBe(2.5);
    expect(map.sourceToPlaylist("playlist-1:pi-1:main", "247500", "clip-a:epoch-1")).toMatchObject({ sourceTime90k: "495000", playlistTime90k: "225000", mediaTime90k: "225000" });
    expect(map.mediaToSource("asset-linear", "225000")).toMatchObject({ mapping: { playItemId: "1" }, sourceTime90k: "495000", playlistTime90k: "225000" });
  });

  it("uses half-open boundaries so exactly 180000 belongs to PI1", () => {
    const map = new MediaTimelineMap(mappings);
    expect(map.playlistToSource("1", "179999")?.mapping.playItemId).toBe("0");
    expect(map.playlistToSource("1", "180000")?.mapping.playItemId).toBe("1");
    expect(map.playlistToSource("1", "450000")).toBeNull();
    expect(map.sourceToPlaylist("playlist-1:pi-1:main", "360000", "clip-a:epoch-1")).toBeNull();
  });

  it("keeps repeated Clip references distinct and refuses a mismatched timestamp epoch", () => {
    const repeated: MediaTimelineMapping = {
      ...mappings[1]!, mappingId: "playlist-2:pi-0:main", playlistId: "2", playItemId: "0",
      playlistStart90k: "0", playlistEnd90k: "270000", mediaStart90k: "0", mediaEnd90k: "270000",
      sourceIn90k: "450000", sourceOut90k: "720000", timestampEpoch: "clip-a:epoch-2",
    };
    const map = new MediaTimelineMap([...mappings, repeated]);
    expect(map.sourceToPlaylist("playlist-1:pi-1:main", "247500", "clip-a:epoch-2")).toBeNull();
    expect(map.sourceToPlaylist("playlist-1:pi-1:main", "247500", "clip-a:epoch-1")?.playlistTime90k).toBe("225000");
    expect(map.sourceToPlaylist("playlist-2:pi-0:main", "247500", "clip-a:epoch-2")).toMatchObject({ mapping: { mappingId: "playlist-2:pi-0:main", playlistId: "2" }, playlistTime90k: "45000" });
    expect(() => new MediaTimelineMap([...mappings, { ...mappings[1]!, mappingId: mappings[0]!.mappingId }])).toThrow(/Duplicate timeline mappingId/);
  });

  it("normalizes 45 kHz values exactly and rejects noncanonical or unsafe numeric timestamps", () => {
    expect(normalizeSourceTime("247500", "45k")).toBe("495000");
    expect(normalizeSourceTime(247500n, "45k")).toBe("495000");
    expect(() => normalizeSourceTime("0247500", "45k")).toThrow(/canonical/);
    expect(() => normalizeSourceTime(Number.MAX_SAFE_INTEGER + 1, "45k")).toThrow(/safe integer/);
  });

  it("rejects overlapping playlist ranges and unequal-duration inferred mappings", () => {
    expect(() => new MediaTimelineMap([...mappings, { ...mappings[1]!, mappingId: "overlap", playlistStart90k: "179999", playlistEnd90k: "449999" }])).toThrow(/overlap/);
    expect(() => new MediaTimelineMap([{ ...mappings[0]!, mediaEnd90k: "180001" }])).toThrow(/equal-duration/);
  });
});
