import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv-web/bdmv-parser";
import { createExternalMediaTargets, resolveExternalPlayTarget } from "./external-targets.js";
import type { MediaClosure } from "./closure.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-data/bdmv/tamako-love-story-bd/BDMV");
const present = await access(resolve(root, "STREAM/00006.m2ts")).then(() => true, () => false);

describe.skipIf(!present)("Tamako local 00006 replacement source", () => {
  it("maps playlists 00004 and 00042 to the present file and retains playlist and chapter source times", async () => {
    const disc = await parseBdmv(root);
    const closure: MediaClosure = { playlistIds: ["playlist:00004", "playlist:00042"], clipIds: [], streamIds: [], requiredNodeIds: [], routes: [], unknown: [], complete: true, explored: 0 };
    const targets = createExternalMediaTargets(disc, closure);
    for (const playlist of [4, 42]) {
      expect(resolveExternalPlayTarget(targets, { type: "PLAY_PLAYLIST", playlist })).toMatchObject({
        status: "available", playlistId: String(playlist).padStart(5, "0"), item: { clipId: "00006", streamPath: "STREAM/00006.m2ts", sourceIn90k: "1048560", sourceOut90k: "432669750" },
        sourceStart90k: "1048560", remainingItems: [], limitations: [expect.stringContaining("not enforced")],
      });
      expect(resolveExternalPlayTarget(targets, { type: "PLAY_PLAYLIST_MARK", playlist, playMark: 1 })).toMatchObject({ status: "available", sourceStart90k: "17647642" });
    }
  });
});
