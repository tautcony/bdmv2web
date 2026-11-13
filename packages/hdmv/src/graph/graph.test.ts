import { describe, expect, it } from "vitest";
import { m3Fixtures } from "@bdmv2web/test-fixtures";
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

describe("navigation graph register constant propagation", () => {
  const source = m3Fixtures.break.source;
  const titleEntries = (target: number) => [{ id: "title:1", kind: "title" as const, source, target: { objectType: "HDMV" as const, playbackType: 0, target, source } }];

  it("resolves JUMP_TITLE through a preceding MOVE immediate to the same register", () => {
    const graph = buildNavigationGraph(
      [{ id: 1, instructions: [m3Fixtures.move1, m3Fixtures.jumpTitleGpr0] }, { id: 2, instructions: [m3Fixtures.break] }],
      [],
      { entries: titleEntries(2) },
    );
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: "command:1:1", kind: "jump", to: "object:2", resolution: "resolved" }));
  });

  it("resolves CALL_TITLE, CALL_OBJECT and PLAY_PL through the same propagation", () => {
    const callTitle = buildNavigationGraph(
      [{ id: 1, instructions: [m3Fixtures.move1, m3Fixtures.callTitleGpr0] }, { id: 2, instructions: [m3Fixtures.break] }],
      [],
      { entries: titleEntries(2) },
    );
    expect(callTitle.edges).toContainEqual(expect.objectContaining({ from: "command:1:1", kind: "call", to: "object:2", resolution: "resolved" }));

    const callObject = buildNavigationGraph([{ id: 1, instructions: [m3Fixtures.move1, m3Fixtures.callObjectGpr0] }]);
    expect(callObject.edges).toContainEqual(expect.objectContaining({ from: "command:1:1", kind: "call", to: "object:1", resolution: "resolved" }));

    const playPlaylist = buildNavigationGraph([{ id: 1, instructions: [m3Fixtures.move5, m3Fixtures.playPlaylistGpr0] }]);
    expect(playPlaylist.edges).toContainEqual(expect.objectContaining({ from: "command:1:1", kind: "play", to: "playlist:00005", resolution: "resolved" }));
  });

  it("keeps a register jump unresolved when a GOTO lands on it", () => {
    const graph = buildNavigationGraph(
      [{ id: 1, instructions: [m3Fixtures.move1, m3Fixtures.jumpTitleGpr0, m3Fixtures.goto1] }, { id: 2, instructions: [m3Fixtures.break] }],
      [],
      { entries: titleEntries(2) },
    );
    expect(graph.edges.filter((edge) => edge.from === "command:1:1" && edge.kind === "jump")).toEqual([
      expect.objectContaining({ from: "command:1:1", kind: "jump", to: null, resolution: "unresolved" }),
    ]);
  });

  it("keeps a register jump unresolved when a compare skips the MOVE", () => {
    const graph = buildNavigationGraph(
      [{ id: 1, instructions: [m3Fixtures.compareEq7, m3Fixtures.move1, m3Fixtures.jumpTitleGpr0] }, { id: 2, instructions: [m3Fixtures.break] }],
      [],
      { entries: titleEntries(2) },
    );
    expect(graph.edges.filter((edge) => edge.from === "command:1:2" && edge.kind === "jump")).toEqual([
      expect.objectContaining({ from: "command:1:2", kind: "jump", to: null, resolution: "unresolved" }),
    ]);
  });

  it("keeps register jumps unresolved for mismatched registers, register sources and non-MOVE arithmetic", () => {
    const mismatched = buildNavigationGraph(
      [{ id: 1, instructions: [m3Fixtures.move1, m3Fixtures.jumpTitleGpr1] }, { id: 2, instructions: [m3Fixtures.break] }],
      [],
      { entries: titleEntries(2) },
    );
    expect(mismatched.edges).toContainEqual(expect.objectContaining({ from: "command:1:1", kind: "jump", to: null, resolution: "unresolved" }));

    const registerSource = buildNavigationGraph(
      [{ id: 1, instructions: [m3Fixtures.moveGpr1ToGpr0, m3Fixtures.jumpTitleGpr0] }, { id: 2, instructions: [m3Fixtures.break] }],
      [],
      { entries: titleEntries(2) },
    );
    expect(registerSource.edges).toContainEqual(expect.objectContaining({ from: "command:1:1", kind: "jump", to: null, resolution: "unresolved" }));

    const arithmetic = buildNavigationGraph(
      [{ id: 1, instructions: [m3Fixtures.add7, m3Fixtures.jumpTitleGpr0] }, { id: 2, instructions: [m3Fixtures.break] }],
      [],
      { entries: titleEntries(2) },
    );
    expect(arithmetic.edges).toContainEqual(expect.objectContaining({ from: "command:1:1", kind: "jump", to: null, resolution: "unresolved" }));
  });
});
