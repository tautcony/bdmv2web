import { describe, expect, it } from "vitest";
import { findStaticNavigationLoops } from "./loops.js";
import type { NavigationGraph } from "./graph.js";

describe("static navigation loop analysis", () => {
  it("reports a back edge and command locations for an object-local cycle", () => {
    const graph: NavigationGraph = {
      nodes: [
        { id: "object:7", kind: "object", objectId: 7, source: null, status: "known" },
        { id: "command:7:0", kind: "command", objectId: 7, commandIndex: 0, source: null, status: "known" },
        { id: "command:7:1", kind: "command", objectId: 7, commandIndex: 1, source: null, status: "known" },
      ],
      edges: [
        { from: "command:7:0", to: "command:7:1", kind: "sequence", condition: null, source: { path: "test", origin: "primary", offset: "0" }, resolution: "resolved" },
        { from: "command:7:1", to: "command:7:0", kind: "jump", condition: null, source: { path: "test", origin: "primary", offset: "12" }, resolution: "resolved" },
      ],
      explored: 2,
      complete: true,
      diagnostics: [],
    };

    expect(findStaticNavigationLoops(graph)).toEqual([{
      backEdge: { from: "command:7:1", to: "command:7:0" },
      cycle: ["command:7:0", "command:7:1", "command:7:0"],
      movieObjects: [7],
      commandLocations: [{ movieObject: 7, pc: 0 }, { movieObject: 7, pc: 1 }, { movieObject: 7, pc: 0 }],
    }]);
  });
});
