import { describe, expect, it } from "vitest";
import { buildNavigationGraph } from "../graph/graph.js";
import { m3Fixtures } from "@bdmv2web/test-fixtures";
import { renderProgramFlowchart } from "./program-mermaid.js";

const source = m3Fixtures.break.source;

describe("renderProgramFlowchart", () => {
  it("renders blocks, playlist targets, and unresolved destinations", () => {
    // [0] MOVE, [1] PLAY_PL(1), [2] MOVE, [3] JUMP_TITLE(imm → unresolved standalone)
    const program = { id: 7, instructions: [m3Fixtures.move5, m3Fixtures.playPlaylist1, m3Fixtures.move5, { ...m3Fixtures.jumpTitle1, source }] };
    const text = renderProgramFlowchart(program, { label: "MOBJ 7" });

    expect(text).toContain("flowchart TB");
    const hex = (id: string) => `n_${Buffer.from(id).toString("hex")}`;
    expect(text).toContain(`${hex("b0")}["b0 · PC 0–1 · 2 cmds`);
    expect(text).toContain(`${hex("playlist:00001")}(["00001<br/>playlist"])`);
    expect(text).toContain(`-. "jump" .-> unknown`);
    expect(text).toContain("classDef playlist");
    expect(text).toContain("linkStyle");
  });

  it("styles a static loop back-edge and caps drawn blocks", () => {
    // [0] MOVE, [1] GOTO 0 — one block whose back edge cycles to itself.
    const program = { id: 9, instructions: [m3Fixtures.move5, { ...m3Fixtures.goto0, source }] };
    const text = renderProgramFlowchart(program, { label: "MOBJ 9", maxBlocks: 4 });
    expect(text).toContain("stroke:#f87171,stroke-width:3px");

    // [EQ, MOVE] × 6 makes twelve blocks; a cap of three keeps the rest out.
    const many = Array.from({ length: 6 }, () => [m3Fixtures.compareEq7, m3Fixtures.move5]).flat();
    const capped = renderProgramFlowchart({ id: 10, instructions: many }, { maxBlocks: 3 });
    expect(capped).toContain("not drawn");
  });

  it("keeps merged-graph cross-program call targets as object nodes", () => {
    const merged = buildNavigationGraph(
      [{ id: 1, instructions: [m3Fixtures.move1, { ...m3Fixtures.callTitleGpr0, source }] }, { id: 15, instructions: [m3Fixtures.break] }],
      [],
      { entries: [{ id: "title:1", kind: "title", source, target: { objectType: "HDMV", playbackType: 0, target: 15, source } }] },
    );
    const text = renderProgramFlowchart({ id: 1, instructions: [m3Fixtures.move1, { ...m3Fixtures.callTitleGpr0, source }] }, { graph: merged, label: "MOBJ 1" });
    const hex = (id: string) => `n_${Buffer.from(id).toString("hex")}`;
    expect(text).toContain(`${hex("object:15")}(["object:15"])`);
    expect(text).toContain(`-->|call|`);
  });
});
