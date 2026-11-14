import { describe, expect, it } from "vitest";
import { buildNavigationGraph } from "@bdmv2web/hdmv";
import { m3Fixtures } from "@bdmv2web/test-fixtures";
import { renderOverviewMermaid, type OverviewProgram } from "./overview-mermaid.js";

const source = m3Fixtures.break.source;

function discFixture() {
  return {
    entries: [
      { id: "first", kind: "firstPlay", target: { objectType: "HDMV", playbackType: 1, target: 0, source } },
      { id: "app", kind: "title", target: { objectType: "BD-J", playbackType: 1, target: "org.example", source } },
    ],
    playlists: [{ id: "00001", playItems: [{ index: 0 }, { index: 1 }], source }, { id: "00002", playItems: [], source }],
    movieObjects: [{ id: 0, instructions: [m3Fixtures.move5] }],
  } as never;
}

const programs: OverviewProgram[] = [
  { id: 0, kind: "movie-object", label: "MOBJ 0", instructionCount: 2 },
  { id: 1000001, kind: "button-program", label: "Button 1000001", instructionCount: 3, streamClipId: "00025" },
];

function graphFixture() {
  return buildNavigationGraph(
    [{ id: 0, instructions: [m3Fixtures.move5, m3Fixtures.playPlaylist1] }, { id: 1000001, instructions: [m3Fixtures.move1, { ...m3Fixtures.jumpTitleGpr0, source }] }],
    [],
    { entries: [] },
  );
}

describe("renderOverviewMermaid", () => {
  it("renders entries, programs, playlists, and play edges", () => {
    const text = renderOverviewMermaid({ disc: discFixture(), graph: graphFixture(), programs });
    expect(text).toContain("flowchart LR");
    const hex = (id: string) => `n_${Buffer.from(id).toString("hex")}`;
    expect(text).toContain(`${hex("entry:first")}{{`);
    expect(text).toContain(`-->|entry| ${hex("object:0")}`);
    expect(text).toContain(`-->|play| ${hex("playlist:00001")}`);
    expect(text).toContain(`subgraph stream_00025["Buttons · 00025"]`);
    expect(text).toContain("PL 00001<br/>2 items");
    // BD-J entries route to their own node, not the dynamic-unknown node.
    expect(text).toContain(`--> bdj`);
    expect(text).toContain("%% media closure: not computed");
  });

  it("collapses large button sets into one node per stream", () => {
    const manyButtons: OverviewProgram[] = Array.from({ length: 50 }, (_, index) => ({
      id: 1000000 + index, kind: "button-program" as const, label: `Button ${1000000 + index}`, instructionCount: 1, streamClipId: "00024",
    }));
    const text = renderOverviewMermaid({ disc: discFixture(), graph: buildNavigationGraph([{ id: 0, instructions: [m3Fixtures.move5] }], [], { entries: [] }), programs: [programs[0]!, ...manyButtons] });
    expect(text).toContain("Buttons 00024 · 50 buttons");
    expect(text).not.toContain("subgraph stream_00024");
    expect(text).toContain("%% media closure: not computed");
  });

  it("notes closure status in a footer comment", () => {
    const closure = { playlistIds: [], clipIds: [], streamIds: [], requiredNodeIds: [], routes: [], unknown: [{ code: "X", message: "m", source: null }], complete: false, explored: 0 };
    const text = renderOverviewMermaid({ disc: discFixture(), graph: graphFixture(), programs, closure });
    expect(text).toContain("%% media closure: incomplete, 1 unknown entry");
  });
});
