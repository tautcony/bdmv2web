import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { resolveMenuLoopStart45k } from "@bdmv2web/media-export";

describe("bdmvkit-generated motion menu loop", () => {
  it("maps the nonzero authored PlayMark to the source media timeline", async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-data/fixtures/bdmvkit-generated/BDMV");
    const disc = await parseBdmv(root);
    const playlist = disc.playlists.find((candidate) => candidate.playItems.some((playItem) => playItem.clipId === "00003"))!;
    const item = playlist.playItems[0]!;
    expect(resolveMenuLoopStart45k(item.index, item.inTime45k, item.outTime45k, playlist.marks)).toBe(85_522);
    expect(item.inTime45k).toBe(63_000);
    expect(85_522).toBeGreaterThan(item.inTime45k);
    expect(85_522).toBeLessThan(item.outTime45k);
  });
});
