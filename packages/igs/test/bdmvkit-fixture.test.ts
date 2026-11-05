import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes } from "../src/extract.js";

describe("bdmvkit-generated IGS interoperability disc", () => {
  it("extracts menu and title popup compositions from their declared clips", async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-data/fixtures/bdmvkit-generated/BDMV");
    const disc = await parseBdmv(root);
    const extracted = await extractIgsScenes(disc);
    expect(extracted.scenes).toEqual(expect.arrayContaining([
      expect.objectContaining({ clipId: "00001", pid: 0x1400, uiModel: 1, pages: expect.arrayContaining([expect.objectContaining({ buttons: expect.arrayContaining([expect.objectContaining({ commands: expect.any(Array) })]) })]) }),
      expect.objectContaining({ clipId: "00003", pid: 0x1400, uiModel: 0 }),
    ]));
    expect(extracted.scenes.filter((scene) => scene.uiModel === 1)).toHaveLength(1);
    expect(extracted.scenes.find((scene) => scene.clipId === "00003")!.pages.reduce((sum, page) => sum + page.buttons.length, 0)).toBeGreaterThanOrEqual(3);
    expect(extracted.assets.length).toBeGreaterThanOrEqual(4);
    expect(extracted.assets.some((asset) => asset.source.clipId === "00001" && asset.source.pid === 0x1400)).toBe(true);
  });
});
