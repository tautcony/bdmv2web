import { describe, expect, it } from "vitest";
import { buildNavigationGraph } from "@bdmv2web/hdmv";
import { m3Fixtures } from "@bdmv2web/test-fixtures";
import { createViewerPayload, type ViewerProgramSource } from "./viewer-data.js";

const source = m3Fixtures.break.source;

function discFixture() {
  return {
    root: "/disc",
    entries: [{ id: "first", kind: "firstPlay", target: { objectType: "HDMV", playbackType: 1, target: 0, source } }],
    movieObjects: [{ id: 0, instructions: [m3Fixtures.move5] }],
    playlists: [{ id: "00001", playItems: [{ index: 0, clipId: "00001", inTime45k: 0, outTime45k: 45_000, stcId: 0, source }], source }],
  } as never;
}

describe("createViewerPayload", () => {
  it("assembles programs with blocks, playlists with media bounds, and counts", () => {
    const sources: ViewerProgramSource[] = [
      { program: { id: 0, instructions: [m3Fixtures.move5, m3Fixtures.playPlaylist1, m3Fixtures.move5] } as never, kind: "movie-object", label: "MOBJ 0" },
      { program: { id: 1000001, instructions: [m3Fixtures.move1, { ...m3Fixtures.jumpTitleGpr0, source }] } as never, kind: "button-program", label: "Button 1000001", streamClipId: "00025" },
    ];
    const graph = buildNavigationGraph(
      [sources[0]!.program as never, sources[1]!.program as never],
      [],
      { entries: [{ id: "title:1", kind: "title", source, target: { objectType: "HDMV", playbackType: 0, target: 0, source } }] },
    );
    const payload = createViewerPayload({ disc: discFixture(), graph, sources, generatedFrom: "/disc" });

    expect(payload.schemaVersion).toBe("1.0");
    expect(payload.counts).toMatchObject({ movieObjects: 1, buttonPrograms: 1, commands: 5, playlists: 1 });
    const mobj = payload.programs[0]!;
    expect(mobj.label).toBe("MOBJ 0");
    expect(mobj.blocks.map((block) => block.startPc)).toEqual([0, 2]);
    expect(mobj.edges.some((edge) => edge.toPlaylist === "playlist:00001")).toBe(true);
    // The button's register jump resolves through the merged graph.
    expect(payload.programs[1]!.edges.some((edge) => edge.toObject === "object:0")).toBe(true);
    expect(payload.playlists[0]).toMatchObject({ id: "00001", itemCount: 1, routes: [] });
    expect(payload.playlists[0]!.items[0]).toMatchObject({ clipId: "00001", streamPath: "STREAM/00001.m2ts", inTime90k: "0", outTime90k: "90000" });
    expect(payload.entries[0]).toMatchObject({ id: "first", kind: "firstPlay", objectType: "HDMV", target: 0 });
    expect(payload.mediaClosure).toBeNull();
    // Payload is JSON-serializable.
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it("attaches route provenance when a closure is present", () => {
    const closure = {
      playlistIds: ["playlist:00001"], clipIds: [], streamIds: [], requiredNodeIds: [],
      routes: [{ playlistId: "playlist:00001", origin: "button-program" as const, entryId: null, entrySource: null, buttonProgramId: 3, navigationEdges: [] }],
      unknown: [], complete: true, explored: 0,
    };
    const graph = buildNavigationGraph([{ id: 0, instructions: [m3Fixtures.move5] }], [], { entries: [] });
    const payload = createViewerPayload({
      disc: discFixture(), graph,
      sources: [{ program: { id: 0, instructions: [m3Fixtures.move5] } as never, kind: "movie-object", label: "MOBJ 0" }],
      closure, generatedFrom: "/disc",
    });
    expect(payload.playlists[0]!.routes).toEqual([{ origin: "button-program", entryId: null, buttonProgramId: 3 }]);
    expect(payload.mediaClosure).toMatchObject({ complete: true, unknownCount: 0 });
  });
});
