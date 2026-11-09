import { describe, expect, it } from "vitest";
import { m3Fixtures } from "./fixtures.js";
import { buildNavigationGraph } from "./graph.js";

const instructions = {
  LINK_PI: "228400000000000000000000",
  LINK_MK: "228500000000000000000000",
  JUMP_TITLE: "218100000000000000000000",
  TERMINATE_PL: "020300000000000000000000",
} as const;

const cases = [
  ["object", "LINK_PI", true],
  ["object", "LINK_MK", true],
  ["object", "JUMP_TITLE", false],
  ["object", "TERMINATE_PL", true],
  ["playlist", "LINK_PI", false],
  ["playlist", "LINK_MK", false],
  ["playlist", "JUMP_TITLE", false],
  ["playlist", "TERMINATE_PL", false],
] as const;

describe("navigation graph flow termination", () => {
  it.each(cases)("handles %s context %s", (context, opcode, hasNextSequence) => {
    const graph = buildNavigationGraph(
      [{ id: 1, instructions: [instructions[opcode], m3Fixtures.move5] }],
      [],
      { context },
    );

    expect(graph.edges.some((edge) => edge.from === "command:1:0" && edge.to === "command:1:1" && edge.kind === "sequence")).toBe(hasNextSequence);
  });

  it("adds a JUMP_TITLE sequence edge to the target entry program", () => {
    const source = m3Fixtures.break.source;
    const graph = buildNavigationGraph(
      [
        { id: 1, instructions: ["218100000000000100000000", m3Fixtures.move5] },
        { id: 2, instructions: [m3Fixtures.break] },
      ],
      [],
      {
        entries: [{ id: "title:0", kind: "title", source, target: { objectType: "HDMV", playbackType: 0, target: 2, source } }],
      },
    );
    const jumpEdges = graph.edges.filter((edge) => edge.from === "command:1:0");

    expect(jumpEdges).toContainEqual(expect.objectContaining({ kind: "jump", to: "object:2", resolution: "resolved" }));
    expect(jumpEdges).toContainEqual(expect.objectContaining({ kind: "sequence", to: "object:2", origin: "jump-title" }));

    const outgoing = new Map<string, string[]>();
    for (const edge of graph.edges) if (edge.to !== null) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    const reachable = new Set<string>();
    const pending = ["command:1:0"];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(...(outgoing.get(id) ?? []));
    }
    expect(reachable.has("object:2")).toBe(true);
    expect(reachable.has("command:1:1")).toBe(false);
  });
});
