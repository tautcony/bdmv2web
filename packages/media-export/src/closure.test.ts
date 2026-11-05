import { describe, expect, it } from "vitest";
import type { ParsedDisc, SourceLocation } from "@bdmv2web/bdmv-parser";
import { buildNavigationGraph, m3Fixtures, type NavigationGraph } from "@bdmv2web/hdmv";
import { computeMediaClosure, createMediaPlan } from "./index.js";

const source: SourceLocation = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };

function discFixture(): ParsedDisc {
  const nodes = [
    { id: "entry:first", type: "entry" as const, state: "present" as const, source },
    { id: "movieObject:0", type: "movieObject" as const, state: "present" as const, source },
    ...["00001", "00002"].flatMap((playlistId) => [
      { id: `playlist:${playlistId}`, type: "playlist" as const, state: "present" as const, source },
      { id: `playItem:${playlistId}:0`, type: "playItem" as const, state: "present" as const, source },
      { id: `clip:${playlistId}`, type: "clip" as const, state: "present" as const, source },
      { id: `clipInfo:${playlistId}`, type: "clipInfo" as const, state: "present" as const, source },
      { id: `stream:${playlistId}:4113`, type: "stream" as const, state: "present" as const, source },
    ]),
  ];
  const edges = [
    { from: "entry:first", to: "movieObject:0", kind: "entry-target", resolution: "resolved" as const, source },
    ...["00001", "00002"].flatMap((playlistId) => [
      { from: `playlist:${playlistId}`, to: `playItem:${playlistId}:0`, kind: "contains", resolution: "resolved" as const, source },
      { from: `playItem:${playlistId}:0`, to: `clip:${playlistId}`, kind: "clip-reference", resolution: "resolved" as const, source },
      { from: `playItem:${playlistId}:0`, to: `clipInfo:${playlistId}`, kind: "clip-info-reference", resolution: "resolved" as const, source },
    ]),
  ];
  return {
    schemaVersion: "1.0", analysisStage: "structural", root: "/disc", discInfo: { appInfo: null, uhd: null }, entries: [
      { id: "first", kind: "firstPlay", target: { objectType: "HDMV", playbackType: 1, target: 0, source }, source },
    ], movieObjects: [], playlists: [], clips: [], sounds: [], graph: { nodes, edges },
    declarations: { entries: 1, movieObjects: 1, playlists: 2, playItems: 2, clips: 2, streams: 2, sounds: 0, unknown: 0 }, diagnostics: [],
    supportPrediction: { status: "partial", supported: [], unsupported: [], unverified: [] },
  };
}

function navigationGraph(args: Partial<NavigationGraph> & Pick<NavigationGraph, "nodes" | "edges">): NavigationGraph {
  return { explored: args.nodes.length, complete: true, diagnostics: [], ...args };
}

describe("conservative M1/M3 media closure", () => {
  it("unions both conditional destinations and button-program media targets", () => {
    const movieGraph = navigationGraph({
      nodes: [
        { id: "object:0", kind: "object", objectId: 0, source, status: "known" },
        { id: "command:0:0", kind: "command", objectId: 0, commandIndex: 0, source, status: "known" },
        { id: "command:0:1", kind: "command", objectId: 0, commandIndex: 1, source, status: "known" },
        { id: "command:0:2", kind: "command", objectId: 0, commandIndex: 2, source, status: "known" },
      ],
      edges: [
        { from: "object:0", to: "command:0:0", kind: "sequence", condition: null, source, resolution: "resolved" },
        { from: "command:0:0", to: "command:0:1", kind: "conditional", condition: "true branch", source, resolution: "unresolved" },
        { from: "command:0:0", to: "command:0:2", kind: "conditional", condition: "false branch", source, resolution: "unresolved" },
        { from: "command:0:1", to: "playlist:00001", kind: "play", condition: "true branch", source, resolution: "resolved" },
        { from: "command:0:2", to: "playlist:00002", kind: "play", condition: "false branch", source, resolution: "resolved" },
      ],
    });
    const buttonGraph = navigationGraph({
      nodes: [{ id: "object:99", kind: "object", objectId: 99, source, status: "known" }],
      edges: [{ from: "object:99", to: "playlist:00002", kind: "play", condition: null, source, resolution: "resolved" }],
    });

    const closure = computeMediaClosure(discFixture(), movieGraph, [buttonGraph]);
    expect(closure.playlistIds).toEqual(["playlist:00001", "playlist:00002"]);
    expect(closure.clipIds).toEqual(["00001", "00002"]);
    expect(closure.streamIds).toEqual(["stream:00001:4113", "stream:00002:4113"]);
    expect(closure.complete).toBe(true);
    expect(closure.unknown).toEqual([]);
  });

  it("keeps unresolved title/dynamic navigation unknown and widens to all structural media", () => {
    const graph = navigationGraph({
      nodes: [{ id: "object:0", kind: "object", objectId: 0, source, status: "known" }],
      edges: [{ from: "object:0", to: null, kind: "play", condition: "dynamic title target", source, resolution: "unresolved" }],
      complete: false,
      diagnostics: ["title navigation target unresolved"],
    });
    const closure = computeMediaClosure(discFixture(), graph);
    expect(closure.playlistIds).toEqual(["playlist:00001", "playlist:00002"]);
    expect(closure.clipIds).toEqual(["00001", "00002"]);
    expect(closure.complete).toBe(false);
    expect(closure.unknown.some((item) => item.code === "MEDIA_PLAY_TARGET_UNKNOWN")).toBe(true);
    expect(closure.unknown.some((item) => item.code === "MEDIA_NAVIGATION_INCOMPLETE")).toBe(true);
  });

  it("widens when a statically named playlist is absent from the structure", () => {
    const graph = buildNavigationGraph([{ id: 0, instructions: [m3Fixtures.playPlaylist42] }]);
    const closure = computeMediaClosure(discFixture(), graph);
    expect(graph.edges).toContainEqual(expect.objectContaining({ kind: "play", to: "playlist:00042", resolution: "resolved" }));
    expect(closure.playlistIds).toEqual(["playlist:00001", "playlist:00002"]);
    expect(closure.complete).toBe(false);
    expect(closure.unknown.some((item) => item.code === "MEDIA_PLAY_TARGET_UNKNOWN")).toBe(true);
  });

  it("widens media roots when the exploration budget is exhausted", () => {
    const graph = navigationGraph({
      nodes: [
        { id: "object:0", kind: "object", objectId: 0, source, status: "known" },
        { id: "command:0:1", kind: "command", objectId: 0, commandIndex: 1, source, status: "known" },
      ],
      edges: [{ from: "object:0", to: "command:0:1", kind: "sequence", condition: null, source, resolution: "resolved" }],
    });
    const closure = computeMediaClosure(discFixture(), graph, [], { maxStates: 1 });
    expect(closure.playlistIds).toEqual(["playlist:00001", "playlist:00002"]);
    expect(closure.requiredNodeIds).toContain("clip:00002");
    expect(closure.complete).toBe(false);
    expect(closure.unknown.some((item) => item.code === "MEDIA_CLOSURE_BUDGET")).toBe(true);
  });
});

function playlistFixture(id: string, items: Array<{ index: number; clipId: string; inTime45k: number; outTime45k: number; multiAngle?: boolean; angleCount?: number; streamPid?: number | null; codingType?: number | null }>, withSubPath = false): ParsedDisc["playlists"][number] {
  const stream = (codingType: number | null, pid: number | null, language: string | null) => ({ streamType: 1, pid, subPathId: null, subClipId: null, codingType, language, dynamicRangeType: null, colorSpace: null, source });
  return {
    id, version: "0200", appInfo: null, source,
    playItems: items.map((item) => ({
      index: item.index, clipId: item.clipId, codecId: "M2TS", stcId: 0, inTime45k: item.inTime45k, outTime45k: item.outTime45k,
      connectionCondition: 1, multiAngle: item.multiAngle ?? false, angleCount: item.angleCount ?? 1, differentAudio: false, seamlessAngle: item.multiAngle ?? false,
      uoMask: "0", stillMode: 0, stillTime: 0,
      streams: [stream(item.codingType === undefined ? 0x1b : item.codingType, item.streamPid === undefined ? 0x1011 : item.streamPid, null), stream(0x80, 0x1100, "eng")], source,
    })),
    marks: [],
    subPaths: withSubPath ? [{ type: 1, repeat: false, source, items: [{ clipId: "00002", codecId: "M2TS", stcId: 0, connectionCondition: 0, multiClip: false, clips: [{ clipId: "00002", codecId: "M2TS", stcId: 0 }], inTime45k: 0, outTime45k: 45_000, syncPlayItemId: 0, syncPts45k: 0, source }] }] : [],
  } as ParsedDisc["playlists"][number];
}

describe("media plan adaptation", () => {
  it("hands advanced M1 PlayItem and SubPath declarations to M5 without losing raw markers", () => {
    const disc = discFixture();
    const playlist = playlistFixture("00001", [{ index: 0, clipId: "00001", inTime45k: 45_000, outTime45k: 90_000, multiAngle: true, angleCount: 3 }], true);
    Object.assign(playlist.playItems[0]!, {
      codecId: "M2TS", stcId: 7, connectionCondition: 5, uoMask: "281474976710655", stillMode: 1, stillTime: 321,
      differentAudio: true, seamlessAngle: true,
    });
    Object.assign(playlist.subPaths[0]!, { type: 3, repeat: true });
    Object.assign(playlist.subPaths[0]!.items[0]!, { codecId: "M2TS", stcId: 9, syncPts45k: 12345 });
    disc.playlists = [playlist];
    const graph = navigationGraph({
      nodes: [{ id: "object:0", kind: "object", objectId: 0, source, status: "known" }],
      edges: [{ from: "object:0", to: "playlist:00001", kind: "play", condition: null, source, resolution: "resolved" }],
    });

    const plan = createMediaPlan(disc, computeMediaClosure(disc, graph));
    expect(plan.requirements[0]?.playItems[0]).toMatchObject({
      clipId: "00001", codecId: "M2TS", stcId: 7, connectionCondition: 5, uoMask: "281474976710655", stillMode: 1, stillTime: 321,
      angle: { multiAngle: true, angleCount: 3, differentAudio: true, seamlessAngle: true },
      strategy: { status: "partial", reasons: [expect.stringContaining("Multi-angle")] },
    });
    expect(plan.requirements[0]?.subPaths[0]).toMatchObject({
      type: 3, repeat: true, status: "unsupported",
      items: [{ clipId: "00002", codecId: "M2TS", stcId: 9, syncPts45k: 12345 }],
    });
    expect(plan.diagnostics.map(({ code }) => code)).toContain("MEDIA_SUBPATH_UNSUPPORTED");
  });

  it("records entry/edge provenance, clip ranges, PIDs, repeated clips, strategy and estimates", () => {
    const disc = discFixture();
    disc.playlists = [
      playlistFixture("00001", [
        { index: 0, clipId: "00001", inTime45k: 45_000, outTime45k: 90_000 },
        { index: 1, clipId: "00001", inTime45k: 90_000, outTime45k: 135_000 },
      ]),
      playlistFixture("00002", [{ index: 0, clipId: "00002", inTime45k: 0, outTime45k: 45_000 }]),
    ];
    const movieGraph = navigationGraph({
      nodes: [{ id: "object:0", kind: "object", objectId: 0, source, status: "known" }],
      edges: [
        { from: "object:0", to: "playlist:00001", kind: "play", condition: "condition A", source, resolution: "resolved" },
        { from: "object:0", to: "playlist:00002", kind: "play", condition: "condition B", source, resolution: "resolved" },
      ],
    });
    const buttonGraph = navigationGraph({
      nodes: [{ id: "object:99", kind: "object", objectId: 99, source, status: "known" }],
      edges: [{ from: "object:99", to: "playlist:00002", kind: "play", condition: null, source, resolution: "resolved" }],
    });
    const closure = computeMediaClosure(disc, movieGraph, [buttonGraph]);
    const plan = createMediaPlan(disc, closure, { estimatedVideoBitsPerSecond: 1_000_000, estimatedAudioBitsPerSecond: 100_000, containerOverheadPercent: 0 });
    expect(plan.requirements.map((requirement) => requirement.playlistId)).toEqual(["00001", "00002"]);
    const first = plan.requirements[0]!;
    expect(first.routes[0]).toMatchObject({ origin: "entry", entryId: "first", entrySource: source, navigationEdges: [{ from: "object:0", to: "playlist:00001", condition: "condition A", source }] });
    expect(first.playItems).toHaveLength(2);
    expect(first.playItems.map((item) => item.clipId)).toEqual(["00001", "00001"]);
    expect(plan.requirements[1]?.routes).toEqual(expect.arrayContaining([expect.objectContaining({ origin: "button-program", buttonProgramId: 99, navigationEdges: [expect.objectContaining({ from: "object:99", to: "playlist:00002", source })] })]));
    expect(first.playItems[0]).toMatchObject({ sourceIn45k: 45_000, sourceOut45k: 90_000, sourceIn90k: "90000", sourceOut90k: "180000", duration90k: "90000", streamFile: { present: true }, strategy: { grouping: "per-play-item", container: "mp4", video: "h264", audio: "aac", status: "planned" } });
    expect(first.playItems[0]?.tracks.map((track) => [track.role, track.pid])).toEqual([["video", 0x1011], ["audio", 0x1100]]);
    expect(plan.budget).toMatchObject({ status: "estimated", estimatedDuration90k: "270000", estimatedTotalBytes: "412500", deduplicationApplied: false });
  });

  it("reports angle and SubPath limitations before transcoding and withholds a complete budget", () => {
    const disc = discFixture();
    disc.playlists = [playlistFixture("00001", [{ index: 0, clipId: "00001", inTime45k: 45_000, outTime45k: 90_000, multiAngle: true, angleCount: 2 }], true)];
    const graph = navigationGraph({
      nodes: [{ id: "object:0", kind: "object", objectId: 0, source, status: "known" }],
      edges: [{ from: "object:0", to: "playlist:00001", kind: "play", condition: null, source, resolution: "resolved" }],
    });
    const plan = createMediaPlan(disc, computeMediaClosure(disc, graph));
    expect(plan.requirements[0]?.playItems[0]).toMatchObject({ angle: { multiAngle: true, angleCount: 2 }, strategy: { status: "partial", reasons: [expect.stringContaining("Multi-angle")] }, estimate: { bytes: null, reason: expect.stringContaining("Angle alternatives") } });
    expect(plan.requirements[0]?.subPaths[0]).toMatchObject({ status: "unsupported", items: [{ clipId: "00002", streamFile: { path: "BDMV/STREAM/00002.m2ts" } }] });
    expect(plan.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["MEDIA_ANGLE_UNSUPPORTED", "MEDIA_SUBPATH_UNSUPPORTED"]));
    expect(plan.budget).toMatchObject({ status: "unknown", estimatedTotalBytes: null, knownSubtotalBytes: "0" });
  });

  it("reports reachable unsupported capabilities without allowing strict completion", () => {
    const disc = discFixture();
    const playlist = playlistFixture("00001", [{ index: 0, clipId: "00001", inTime45k: 0, outTime45k: 45_000, multiAngle: true, angleCount: 2 }], true);
    playlist.playItems[0]!.seamlessAngle = true;
    playlist.playItems[0]!.streams.push({ streamType: 1, pid: 0x1200, subPathId: null, subClipId: null, codingType: 0x90, language: "eng", dynamicRangeType: null, colorSpace: null, source });
    disc.playlists = [playlist];
    const graph = navigationGraph({
      nodes: [{ id: "object:0", kind: "object", objectId: 0, source, status: "known" }],
      edges: [{ from: "object:0", to: "playlist:00001", kind: "play", condition: null, source, resolution: "resolved" }],
    });
    const plan = createMediaPlan(disc, computeMediaClosure(disc, graph));
    const impacts = Object.fromEntries(plan.capabilityReport.impacts.map((impact) => [impact.capability, impact]));
    expect(plan.status).toBe("partial");
    expect(plan.capabilityReport).toMatchObject({ inspectedStages: ["M1"], notInspectedStages: ["M2"], strictUpgradeAllowed: false });
    expect(impacts.angle).toMatchObject({ status: "unsupported", inspection: "inspected", affected: [{ playlistId: "00001", playItemIndex: 0, source }] });
    expect(impacts.seamless).toMatchObject({ status: "unsupported", inspection: "inspected" });
    expect(impacts.pip).toMatchObject({ status: "unknown", inspection: "partially-inspected" });
    expect(impacts["forced-subtitle"]).toMatchObject({ status: "unknown", inspection: "partially-inspected" });
    expect(impacts.textst).toMatchObject({ status: "unknown", inspection: "partially-inspected" });
    expect(impacts.hdr).toMatchObject({ status: "unknown", inspection: "not-inspected" });
  });

  it("keeps unrepresented capabilities unknown when no M1 marker is present", () => {
    const disc = discFixture();
    disc.playlists = [playlistFixture("00001", [{ index: 0, clipId: "00001", inTime45k: 0, outTime45k: 45_000 }])];
    const graph = navigationGraph({
      nodes: [{ id: "object:0", kind: "object", objectId: 0, source, status: "known" }],
      edges: [{ from: "object:0", to: "playlist:00001", kind: "play", condition: null, source, resolution: "resolved" }],
    });
    const plan = createMediaPlan(disc, computeMediaClosure(disc, graph));
    expect(plan.status).toBe("partial");
    expect(plan.capabilityReport.strictUpgradeAllowed).toBe(false);
    expect(plan.capabilityReport.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "angle", status: "unknown", inspection: "inspected" }),
      expect.objectContaining({ capability: "seamless", status: "unknown", inspection: "partially-inspected" }),
      expect.objectContaining({ capability: "pip", status: "unknown", inspection: "not-inspected" }),
      expect.objectContaining({ capability: "hdr", status: "unknown", inspection: "not-inspected" }),
      expect.objectContaining({ capability: "forced-subtitle", status: "unknown", inspection: "not-inspected" }),
      expect.objectContaining({ capability: "textst", status: "unknown", inspection: "not-inspected" }),
    ]));
  });

  it("surfaces missing stream metadata and leaves the total estimate unknown", () => {
    const disc = discFixture();
    disc.graph.nodes = disc.graph.nodes.map((node) => node.id === "clip:00002" || node.id === "clipInfo:00002" ? { ...node, state: "missing" as const } : node);
    disc.playlists = [playlistFixture("00002", [{ index: 0, clipId: "00002", inTime45k: 45_000, outTime45k: 90_000, streamPid: null, codingType: null }])];
    const graph = navigationGraph({
      nodes: [{ id: "object:0", kind: "object", objectId: 0, source, status: "known" }],
      edges: [{ from: "object:0", to: "playlist:00002", kind: "play", condition: null, source, resolution: "resolved" }],
    });
    const closure = computeMediaClosure(disc, graph);
    const plan = createMediaPlan(disc, closure);
    const missingRequirement = plan.requirements.find((item) => item.playlistId === "00002");
    expect(missingRequirement?.playItems[0]).toMatchObject({ streamFile: { path: "BDMV/STREAM/00002.m2ts", present: false }, clipInfo: { present: false }, estimate: { bytes: null } });
    expect(plan.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["MEDIA_STREAM_FILE_MISSING", "MEDIA_CLIP_INFO_MISSING", "MEDIA_PID_UNRESOLVED", "MEDIA_CODING_TYPE_UNKNOWN"]));
    expect(plan.budget).toMatchObject({ status: "unknown", estimatedTotalBytes: null, knownSubtotalBytes: "0", estimatedDuration90k: "90000" });
    expect(missingRequirement?.playItems[0]?.strategy.status).toBe("partial");
  });
});
