import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes } from "@bdmv2web/igs";
import { adaptIgsScene, selectPopupScene } from "./igs-adapter.js";

describe("bdmvkit-generated popup scene runtime metadata", () => {
  it("retains popup classification and source clip/PID in the serialized scene", async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-data/fixtures/bdmvkit-generated/BDMV");
    const disc = await parseBdmv(root);
    const extraction = await extractIgsScenes(disc);
    const popup = extraction.scenes.find((scene) => scene.uiModel === 1);
    expect(popup).toBeDefined();
    const result = adaptIgsScene(popup!, extraction.assets);
    expect(result.scene).toMatchObject({ id: popup!.id, clipId: "00001", pid: 0x1400, uiModel: 1, streamModel: popup!.streamModel, source: popup!.source });
    expect(selectPopupScene([result.scene], "00001", 0x1400, Number(popup!.pts90k), popup!.timeDomain)).toEqual({ status: "selected", scene: result.scene });
    expect(selectPopupScene([result.scene], "00002", 0x1400).status).toBe("not-found");
  });
});
