import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBdmv } from "./parser.js";

describe("bdmvkit-generated interoperability disc", () => {
  it("parses authored index, MovieObjects, random playlist, PGS and IG declarations", async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-data/fixtures/bdmvkit-generated/BDMV");
    const disc = await parseBdmv(root);
    expect(disc.entries.length).toBeGreaterThanOrEqual(3);
    expect(disc.movieObjects.length).toBeGreaterThan(0);
    expect(disc.playlists.some((playlist) => playlist.playItems.length === 3)).toBe(true);
    expect(disc.playlists.some((playlist) => playlist.playItems.some((item) => item.index === 0) && playlist.playItems.length === 2)).toBe(true);
    expect(disc.clips.some((clip) => clip.programs.some((program) => program.streams.some((stream) => stream.codingType === 0x91)))).toBe(true);
    expect(disc.playlists.some((playlist) => playlist.playItems.some((item) => item.streams.filter((stream) => stream.codingType === 0x90).length >= 2))).toBe(true);
    expect(disc.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });
});
