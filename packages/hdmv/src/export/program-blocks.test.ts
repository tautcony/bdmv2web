import { describe, expect, it } from "vitest";
import { buildNavigationGraph } from "../graph/graph.js";
import { m3Fixtures } from "@bdmv2web/test-fixtures";
import { partitionProgramBlocks } from "./program-blocks.js";

const source = m3Fixtures.break.source;

describe("partitionProgramBlocks", () => {
  it("collapses straight-line commands and splits at control-flow boundaries", () => {
    // [0] MOVE, [1] PLAY_PL(1), [2] MOVE, [3] JUMP_TITLE(imm), [4] MOVE (unreachable tail)
    const program = { id: 1, instructions: [
      m3Fixtures.move5, m3Fixtures.playPlaylist1, m3Fixtures.move5,
      { ...m3Fixtures.jumpTitle1, source }, m3Fixtures.move5,
    ] };
    const partition = partitionProgramBlocks(program);

    // Boundaries: entry at 0; play at 1 ends its block (pc 2 starts through the
    // return edge); jump at 3 ends its block (pc 4 starts); the tail merges nothing.
    expect(partition.blocks.map((block) => [block.startPc, block.commandCount])).toEqual([[0, 2], [2, 2], [4, 1]]);
    expect(partition.entryBlock).toBe("b0");
    expect(partition.blocks[0]!.summary).toBe("MOVE → PLAY_PL");
    // Media targets surface as playlist edges, not block targets.
    expect(partition.edges.filter((edge) => edge.toPlaylist)).toEqual([
      expect.objectContaining({ fromBlock: "b0", toPlaylist: "playlist:00001", kind: "play", resolution: "resolved" }),
    ]);
    expect(partition.edges.filter((edge) => edge.kind === "jump" && edge.fromBlock === "b2")).toEqual([
      expect.objectContaining({ fromBlock: "b2", toBlock: null, toPlaylist: null, toObject: null, resolution: "unresolved" }),
    ]);
    expect(partition.blocks[2]!.summary).toBe("MOVE"); // single-command blocks do not repeat their opcode
    expect(partition.unreachableBlocks).toEqual(["b4"]);
  });

  it("maps conditional skip targets onto block starts", () => {
    // [0] EQ, [1] MOVE (executed on true, skipped on false), [2] JUMP_TITLE(imm)
    const program = { id: 2, instructions: [m3Fixtures.compareEq7, m3Fixtures.move5, { ...m3Fixtures.jumpTitle1, source }] };
    const partition = partitionProgramBlocks(program, { entries: [{ id: "title:1", kind: "title", source, target: { objectType: "HDMV", playbackType: 0, target: 3, source } }] });

    expect(partition.blocks.map((block) => block.startPc)).toEqual([0, 1, 2]);
    const conditional = partition.edges.filter((edge) => edge.kind === "conditional");
    expect(conditional).toEqual([
      expect.objectContaining({ fromBlock: "b0", toBlock: "b1", condition: expect.stringContaining("true") }),
      expect.objectContaining({ fromBlock: "b0", toBlock: "b2", condition: expect.stringContaining("false") }),
    ]);
    // The conditional fall-through continues into the true-path block.
    expect(partition.blocks[1]!.commands.map((command) => command.opcode)).toEqual(["MOVE"]);
  });

  it("keeps resolved cross-program call targets when given the merged graph", () => {
    const merged = buildNavigationGraph(
      [{ id: 1, instructions: [m3Fixtures.move1, { ...m3Fixtures.callTitleGpr0, source }] }, { id: 15, instructions: [m3Fixtures.break] }],
      [],
      { entries: [{ id: "title:1", kind: "title", source, target: { objectType: "HDMV", playbackType: 0, target: 15, source } }] },
    );
    const partition = partitionProgramBlocks({ id: 1, instructions: [m3Fixtures.move1, { ...m3Fixtures.callTitleGpr0, source }] }, { graph: merged });
    expect(partition.edges.filter((edge) => edge.toObject)).toEqual([
      expect.objectContaining({ fromBlock: "b0", toObject: "object:15", kind: "call", resolution: "resolved" }),
    ]);
  });
});
