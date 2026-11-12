import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { within } from "./node-path.js";

describe("within", () => {
  it("accepts the root and its descendants", () => {
    const root = resolve("parent", "disc");
    expect(within(root, root)).toBe(true);
    expect(within(root, resolve(root, "BDMV", "index.bdmv"))).toBe(true);
  });

  it("rejects parent and sibling paths", () => {
    const root = resolve("parent", "disc");
    expect(within(root, resolve(root, ".."))).toBe(false);
    expect(within(root, resolve(root, "..", "disc-other"))).toBe(false);
  });
});
