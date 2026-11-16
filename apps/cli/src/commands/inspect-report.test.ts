import type { ParsedDisc, PlayItem, Playlist, PlayMark } from "@bdmv2web/bdmv-parser";
import { describe, expect, it } from "vitest";
import { format45kTime, projectInspectReport, renderInspectReport } from "./inspect-report.js";

function item(index: number, inTime45k: number, outTime45k: number): PlayItem {
  return {
    index, clipId: "00001", codecId: "M2TS", stcId: 0, inTime45k, outTime45k,
    connectionCondition: 1, multiAngle: false, angleCount: 1, differentAudio: false, seamlessAngle: false,
    uoMask: "0", stillMode: 0, stillTime: 0, streams: [], source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: String(100 + index) },
  };
}

function mark(playItemRef: number, time45k: number): PlayMark {
  return { index: 0, type: 1, playItemRef, time45k, entryEsPid: 0, duration45k: 0, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "200" } };
}

function disc(playItems: PlayItem[], marks: PlayMark[] = []): ParsedDisc {
  const playlist: Playlist = {
    id: "00001", version: "0200", appInfo: null, playItems, marks, subPaths: [],
    source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "80" },
  };
  return {
    schemaVersion: "1.0", analysisStage: "structural", root: "/disc/BDMV",
    discInfo: { appInfo: null, uhd: null }, entries: [], movieObjects: [], metadata: [], playlists: [playlist], clips: [], sounds: [],
    graph: { nodes: [], edges: [] }, declarations: { entries: 0, movieObjects: 0, playlists: 1, playItems: playItems.length, clips: 0, streams: 0, sounds: 0, unknown: 0 },
    diagnostics: [], supportPrediction: { status: "partial", supported: [], unsupported: [], unverified: [] },
  };
}

describe("inspect report projection", () => {
  it("formats 45 kHz ticks with integer millisecond truncation", () => {
    expect(format45kTime(0)).toBe("00:00:00.000");
    expect(format45kTime(45_044)).toBe("00:00:01.000");
    expect(format45kTime(45_045)).toBe("00:00:01.001");
    expect(format45kTime(162_000_000)).toBe("01:00:00.000");
    expect(format45kTime(-1)).toBe("unknown");
    expect(format45kTime(Number.MAX_SAFE_INTEGER + 1)).toBe("unknown");
  });

  it("sums multiple valid PlayItems and maps mark times across item boundaries", () => {
    const projected = projectInspectReport(disc(
      [item(0, 45_000, 90_000), item(1, 180_000, 270_000)],
      [mark(0, 45_000), mark(1, 225_000)],
    )).playlists[0]!;
    expect(projected.duration45k).toBe(135_000n);
    expect(projected.marks.map(({ chapterTime45k }) => chapterTime45k)).toEqual([0n, 90_000n]);
  });

  it("keeps invalid playlist durations and chapter references unknown", () => {
    const projected = projectInspectReport(disc(
      [item(0, 90_000, 45_000), item(1, 0, 45_000)],
      [mark(0, 45_000), mark(2, 10), mark(1, 90_000)],
    )).playlists[0]!;
    expect(projected.duration45k).toBeNull();
    expect(projected.marks.map(({ chapterTime45k }) => chapterTime45k)).toEqual([null, null, null]);
    const text = renderInspectReport(projectInspectReport(disc([item(0, 90_000, 45_000)], [mark(0, 45_000)])), "partial");
    expect(text).toContain("invalid: PlayItem 0 has an invalid interval");
  });

  it("renders navigation, ordered playlists, language, angles and MPLS/CLPI provenance", () => {
    const parsed = disc([item(0, 0, 45_000)]);
    parsed.entries.push({ id: "first-play", kind: "firstPlay", target: { objectType: "HDMV", playbackType: 1, target: 2, source: { path: "index.bdmv", origin: "primary", offset: "60" } }, source: { path: "index.bdmv", origin: "primary", offset: "64" } });
    parsed.metadata!.push({ language: "jpn", discName: "作品", alternativeName: null, numberOfSets: null, setNumber: null, titles: [], thumbnails: [], source: { path: "META/DL/bdmt_jpn.xml", origin: "primary", offset: "0" } });
    parsed.playlists[0]!.playItems[0]!.streams.push({ streamType: 1, pid: 0x1011, subPathId: null, subClipId: null, codingType: 0x24, language: null, dynamicRangeType: 1, colorSpace: 2, category: "primaryVideo", categoryIndex: 0, source: { path: "PLAYLIST/00001.mpls", origin: "primary", offset: "142" } });
    parsed.playlists[0]!.playItems[0]!.angles = [{ index: 1, clipId: "00002", codecId: "M2TS", stcId: 0, source: { path: "PLAYLIST/00001.mpls", origin: "primary", offset: "150" } }];
    parsed.clips.push({ id: "00001", version: "0200", header: null, sequence: [], programs: [{ sequenceStartSpn: 0, programMapPid: 0x100, streams: [{ pid: 0x1011, codingType: 0x24, language: "jpn", dynamicRangeType: null, colorSpace: null, source: { path: "CLIPINF/00001.clpi", origin: "primary", offset: "74" } }], source: { path: "CLIPINF/00001.clpi", origin: "primary", offset: "70" } }], cpi: [], source: { path: "CLIPINF/00001.clpi", origin: "primary", offset: "0" } });

    const text = renderInspectReport(projectInspectReport(parsed), "partial");
    expect(text.indexOf("Navigation entries:")).toBeLessThan(text.indexOf("Playlists (1):"));
    expect(text).toContain("jpn: 作品");
    expect(text).toContain("primaryVideo[0]  PID 0x1011  coding 0x24  language unknown");
    expect(text).toContain("Angle 1: 00002.M2TS");
    expect(text).toContain("PLAYLIST/00001.mpls @ 142 (primary)");
    expect(text).toContain("CLPI program stream declarations:");
    expect(text).toContain("CLIPINF/00001.clpi @ 74 (primary)");
  });

  it("retains invalid marks and partial diagnostics with their source offsets", () => {
    const parsed = disc([item(0, 0, 45_000)], [mark(0, 46_000), mark(3, 1_000)]);
    parsed.diagnostics.push({ severity: "warning", code: "BDMV_MARK_INVALID", message: "Mark time is outside its PlayItem.", sourcePath: "PLAYLIST/00001.mpls", offset: "208", entityId: "playlist:00001", action: null, recoverable: true, stage: "structural", affectedEntryIds: [] });
    parsed.diagnostics.push({ severity: "info", code: "BDMV_CLIPINFO_MISSING", message: "CLPI is unavailable.", sourcePath: "CLIPINF/00001.clpi", offset: null, entityId: "clipInfo:00001", action: null, recoverable: true, stage: "structural", affectedEntryIds: [] });
    parsed.clips.push({ id: "00001", version: "0200", header: null, sequence: [], programs: [], cpi: [], source: { path: "CLIPINF/00001.clpi", origin: "primary", offset: "0" }, clipMarks: [{ index: 0, markType: 1, spn: 1, pts90k: 90_000, duration45k: 45_000, source: { path: "CLIPINF/00001.clpi", origin: "primary", offset: "300" } }] });

    const text = renderInspectReport(projectInspectReport(parsed), "partial");
    expect(text).toContain("invalid: time outside PlayItem 0");
    expect(text).toContain("invalid: PlayItem reference 3 is out of range");
    expect(text).toContain("chapter unknown");
    expect(text).toContain("PTS90k 00:00:01.000 (90000 ticks)  duration45k 45000 ticks");
    expect(text).toContain("warning BDMV_MARK_INVALID — Mark time is outside its PlayItem.");
    expect(text).toContain("source PLAYLIST/00001.mpls @ 208");
    expect(text).toContain("source CLIPINF/00001.clpi\n");
  });

  it("pins the complete deterministic report with long paths and wide characters", () => {
    const parsed = disc([item(0, 0, 90_000)], [mark(0, 45_000)]);
    parsed.discInfo = {
      appInfo: { initialOutputModePreference: true, contentExistFlag: true, initialDynamicRangeType: 1, videoFormat: 6, frameRate: 1, userDataBytes: 0, source: { path: "index.bdmv", origin: "primary", offset: "48" } },
      uhd: { discType: 1, exists4k: true, hdrFlags: 1, hdr10Plus: false, dolbyVision: false, source: { path: "index.bdmv", origin: "primary", offset: "96" } },
    };
    parsed.metadata!.push({ language: "jpn", discName: "映画作品・字幕", alternativeName: "劇場版", numberOfSets: 1, setNumber: 1, titles: [], thumbnails: [], source: { path: "META/DL/bdmt_jpn.xml", origin: "primary", offset: "0" } });
    parsed.entries.push({ id: "00000", kind: "topMenu", target: { objectType: "HDMV", playbackType: 1, target: 0, source: { path: "index.bdmv", origin: "primary", offset: "64" } }, source: { path: "index.bdmv", origin: "primary", offset: "60" } });
    parsed.movieObjects.push({ id: 0, resumeIntention: false, menuCallMask: true, titleSearchMask: true, instructions: [{ words: [0, 0, 0], bytes: "000000000000", source: { path: "MovieObject.bdmv", origin: "primary", offset: "40", instructionIndex: 0 } }], source: { path: "MovieObject.bdmv", origin: "primary", offset: "32" } });
    parsed.diagnostics.push({ severity: "warning", code: "BDMV_SOURCE_WARNING", message: "Recovered declaration from a partially readable source.", sourcePath: `BACKUP/${"長いパス".repeat(22)}/00001.mpls`, offset: "420", entityId: "playlist:00001", action: null, recoverable: true, stage: "structural", affectedEntryIds: ["00000"] });
    const streamSource = { path: "PLAYLIST/00001.mpls", origin: "primary" as const, offset: "142" };
    parsed.playlists[0]!.playItems[0]!.streams.push({ streamType: 1, pid: 0x1011, subPathId: null, subClipId: null, codingType: 0x24, language: "jpn", dynamicRangeType: 1, colorSpace: 2, category: "primaryVideo", categoryIndex: 0, source: streamSource });
    parsed.playlists[0]!.playItems[0]!.angles = [{ index: 1, clipId: "00002", codecId: "M2TS", stcId: 0, source: { path: "PLAYLIST/00001.mpls", origin: "primary", offset: "150" } }];
    parsed.clips.push({ id: "00001", version: "0200", header: null, sequence: [], programs: [{ sequenceStartSpn: 0, programMapPid: 0x100, streams: [{ pid: 0x1011, codingType: 0x24, language: "jpn", dynamicRangeType: 1, colorSpace: 2, source: { path: "CLIPINF/00001.clpi", origin: "primary", offset: "74" } }], source: { path: "CLIPINF/00001.clpi", origin: "primary", offset: "70" } }], cpi: [], source: { path: "CLIPINF/00001.clpi", origin: "primary", offset: "0" }, clipMarks: [{ index: 0, markType: 1, spn: 0, pts90k: 90_000, duration45k: 0, source: { path: "CLIPINF/00001.clpi", origin: "primary", offset: "300" } }] });

    const projection = projectInspectReport(parsed);
    const actual = renderInspectReport(projection, "partial");
    expect(renderInspectReport(projection, "partial")).toBe(actual);
    expect(actual).toMatchInlineSnapshot(`
      "BDMV inspection (structural analysis; stage partial)
      Disc: jpn: 映画作品・字幕 (META/DL/bdmt_jpn.xml @ 0 (primary)) | UHD: yes
      Disc source: index.bdmv @ 96 (primary)
      Disc application: content exists yes, initial output mode yes, dynamic range type 1, video format code 6, frame-rate code 1 (index.bdmv @ 48 (primary))

      Navigation entries:
        topMenu 00000 → HDMV 0 (index.bdmv @ 60 (primary))
      Movie objects: 0 (1 instructions; MovieObject.bdmv @ 32 (primary))

      Playlists (1):
        00001  duration 00:00:02.000  1 PlayItem(s)  source BDMV/PLAYLIST/00001.mpls @ 80 (primary)

      Playlist 00001 details:
        PlayItem 0  clip 00001.M2TS  IN 00:00:00.000  OUT 00:00:02.000  source BDMV/PLAYLIST/00001.mpls @ 100 (primary)
          Angle: count 1, multi-angle no, seamless no
          Declared angles:
            Angle 1: 00002.M2TS, STC 0 (PLAYLIST/00001.mpls @ 150 (primary))
          MPLS stream declarations:
            primaryVideo[0]  PID 0x1011  coding 0x24  language jpn  (PLAYLIST/00001.mpls @ 142 (primary))
          CLPI program stream declarations:
            PID 0x1011  coding 0x24  language jpn  (CLIPINF/00001.clpi @ 74 (primary))
        Playlist marks:
          Mark 0 type 1  PlayItem 0  raw 00:00:01.000 (45000 ticks)  chapter 00:00:01.000  valid  (BDMV/PLAYLIST/00001.mpls @ 200 (primary))

      CLPI clip marks:
        00001 mark 0 type 1  PTS90k 00:00:01.000 (90000 ticks)  duration45k 0 ticks  (CLIPINF/00001.clpi @ 300 (primary))

      Diagnostics (1):
        warning BDMV_SOURCE_WARNING — Recovered declaration from a partially readable source.
          source BACKUP/長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス長いパス/00001.mpls @ 420
      "
    `);
  });
});
