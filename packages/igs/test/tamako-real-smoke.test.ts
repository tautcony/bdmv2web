import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv-web/bdmv-parser";
import { extractIgsScenes } from "../src/extract.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const bdmvRoot = resolve(repositoryRoot, "test-data/tamako-love-story-bd/BDMV");
const realSampleAvailable = await access(resolve(bdmvRoot, "STREAM/00005.m2ts")).then(() => true, () => false);

describe.skipIf(!realSampleAvailable)("Tamako real-stream smoke (workspace-local sample)", () => {
  it("extracts the declared IGS composition from Clip 00005 without claiming pixel fidelity", async () => {
    const disc = await parseBdmv(bdmvRoot);
    const menuPlaylist = disc.playlists.find((playlist) => playlist.id === "00003");
    expect(menuPlaylist).toBeDefined();
    expect(menuPlaylist!.playItems).toHaveLength(999);
    expect(new Set(menuPlaylist!.playItems.map((item) => item.clipId))).toEqual(new Set(["00004"]));
    expect(menuPlaylist!.subPaths.flatMap((subPath) => subPath.items.map((item) => item.clipId))).toContain("00005");
    expect(menuPlaylist!.playItems[0]?.streams.filter((stream) => stream.codingType === 0x86).map(({ pid, language }) => ({ pid, language })))
      .toEqual([{ pid: 0x1100, language: "eng" }, { pid: 0x1101, language: "jpn" }]);
    expect(menuPlaylist!.playItems[0]?.streams.find((stream) => stream.codingType === 0x91)).toMatchObject({ pid: 0x1400, subPathId: 0, subClipId: 0 });
    const declaredIgs = disc.clips.find((clip) => clip.id === "00005")?.programs.flatMap((program) => program.streams)
      .find((stream) => stream.codingType === 0x91);
    expect(declaredIgs).toMatchObject({ pid: 0x1400, source: { path: "BDMV/CLIPINF/00005.clpi" } });

    const extraction = await extractIgsScenes(disc);
    const scene = extraction.scenes.find((item) => item.clipId === "00005" && item.pid === 0x1400);
    expect(scene).toMatchObject({ width: 1920, height: 1080, complete: false });
    expect(scene?.pages).toHaveLength(7);
    expect(scene?.objects).toHaveLength(168);
    expect(scene?.palettes).toHaveLength(7);
    expect(extraction.assets.filter((asset) => asset.source.clipId === "00005" && asset.source.pid === 0x1400).length).toBeGreaterThan(0);
    expect(extraction.status).toBe("partial");
    expect(extraction.support.status).toBe("unverified");
    expect(extraction.diagnostics.filter((item) => item.code === "IGS_INVALID_BUTTON_REFERENCE" && item.source?.clipId === "00005"))
      .toHaveLength(2);
    expect(extraction.diagnostics.some((item) => item.code === "BDMV_MISSING_STREAM" && item.message.includes("Clip 00043"))).toBe(true);
  });
});
