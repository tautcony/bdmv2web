import { describe, expect, it } from "vitest";
import type { PlayItem, Playlist } from "@bdmv2web/bdmv-parser";
import type { InspectionCollection } from "./inspect-collection.js";
import type { BrowserRow, InspectionBrowserModel } from "./inspect-browser-model.js";
import { buildInspectionDetails } from "./inspect-details.js";

function context(): { data: InspectionCollection; model: InspectionBrowserModel } {
  return {
    data: {
      disc: {
        schemaVersion: "1.0", analysisStage: "structural", root: "/disc/BDMV",
        discInfo: { appInfo: null, uhd: null }, entries: [], movieObjects: [], playlists: [], clips: [], sounds: [],
        graph: { nodes: [], edges: [] }, declarations: { entries: 0, movieObjects: 0, playlists: 0, playItems: 0, clips: 0, streams: 0, sounds: 0, unknown: 0 },
        diagnostics: [], supportPrediction: { status: "partial", supported: [], unsupported: [], unverified: [] },
      },
      graphics: null, graphicsStageStatus: "not-run", fileSizes: {}, reachableSup: [], assetSelection: { renderPng: false }, assetType: "all",
    },
    model: { Navigation: [], MPLS: [], M2TS: [], Metadata: [], Diagnostics: [], targets: new Map() },
  };
}
const source = { path: "index.bdmv", offset: "108", origin: "primary" as const };
function lines(row: BrowserRow, contextValue = context()): string[] {
  return buildInspectionDetails(row, contextValue.data, contextValue.model).map((line) => line.text);
}
function playItem(index: number, inTime45k: number, outTime45k: number): PlayItem {
  return { index, clipId: "00001", codecId: "M2TS", stcId: 0, inTime45k, outTime45k, connectionCondition: 1, multiAngle: false, angleCount: 1, differentAudio: false, seamlessAngle: false, uoMask: "0", stillMode: 0, stillTime: 0, streams: [], source };
}

describe("structured inspection details", () => {
  it("shows entry identity, target, command count, static playlist references, and provenance", () => {
    const state = context();
    state.model.targets.set("object:8", { label: "MovieObject 8", cells: [], value: {}, children: [
      { label: "Command 0", cells: [], value: {}, children: [{ label: "play", cells: [], value: {}, navigateTo: "playlist:00057" }] },
    ] });
    const row: BrowserRow = {
      label: "title title:0", cells: [], source: "index.bdmv @ 108 (primary)",
      value: { id: "title:0", kind: "title", target: { objectType: "HDMV", target: 8, playbackType: 0, accessType: 0, source }, source },
    };
    expect(lines(row, state)).toEqual(expect.arrayContaining([
      "Navigation entry", "Entry: title:0", "Target: MovieObject 8", "Playback type: 0", "Commands: 1", "Direct static MPLS targets: 00057", "Source", "index.bdmv @ 108 (primary)",
    ]));
  });

  it("presents playlist duration and marks on the playlist timeline", () => {
    const playlist: Playlist = {
      id: "00001", version: "0200", appInfo: null, source, subPaths: [],
      playItems: [playItem(0, 45_000, 90_000), playItem(1, 180_000, 270_000)],
      marks: [{ index: 0, type: 1, playItemRef: 1, time45k: 225_000, entryEsPid: 0, duration45k: 0, source }],
    };
    expect(lines({ label: "MPLS 00001", cells: [], value: playlist })).toEqual(expect.arrayContaining([
      "Duration: 00:00:03.000", "PlayItems: 2", "Marks: 1", "Referenced clips: 00001", "Marks / playlist timeline", "Mark 0: PlayItem 1 · 00:00:02.000 · type 1",
    ]));
  });

  it("decodes command bytes and describes outgoing navigation references", () => {
    const row: BrowserRow = {
      label: "Command 0", cells: [], value: { bytes: "228000000000000100000000", source },
      children: [{ label: "play", cells: [], value: { kind: "play", to: "playlist:00001", resolution: "resolved", condition: null } }],
    };
    const details = lines(row);
    expect(details.some((line) => line.startsWith("Instruction:") && line.includes("PLAY_PL"))).toBe(true);
    expect(details).toContain("play: playlist:00001 · resolved");
  });

  it("explains structural coverage and the related IGS SubPath clip", () => {
    expect(lines({ label: "M2TS 00004", cells: [], value: { fileSize: 315211776, fileNode: { state: "present" }, scanStatus: "structure-only", relatedIgsClips: ["00005"], scenes: [], reversePlayItems: [] } })).toEqual(expect.arrayContaining([
      "Graphics scan: structure-only", "Coverage: MPLS/CLPI declarations collected; payload measurements unavailable", "IGS clips via SubPath: 00005", "IGS scenes: unknown",
    ]));
  });

  it("distinguishes missing media from known declarations and unavailable measurements", () => {
    expect(lines({ label: "M2TS 00001", cells: [], value: { fileNode: { state: "missing" }, fileSize: null, scanStatus: "missing", scenes: [], reachableSup: [{ pid: 0x1200 }], reversePlayItems: [{ playlist: "00003", playItemIndex: 0, source }] } })).toEqual(expect.arrayContaining([
      "File state: missing", "Graphics scan: missing", "IGS scenes: unknown", "Reachable SUP declarations: 1", "Payload measurements: unavailable", "MPLS 00003: PlayItem 0 · index.bdmv @ 108 (primary)",
    ]));
  });
});
