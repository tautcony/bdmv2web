import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildM1Index, buildM1MovieObject } from "@bdmv2web/test-fixtures";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function buildEmptyBdjo(): Uint8Array {
  const output = new Uint8Array(90);
  output.set(new TextEncoder().encode("BDJO0200"));
  const view = new DataView(output.buffer);
  let offset = 48;

  view.setUint32(offset, 10, false); offset += 4;
  output.set(new TextEncoder().encode("*****"), offset); offset += 5;
  output[offset++] = 0; offset += 4;

  view.setUint32(offset, 2, false); offset += 4;
  output[offset++] = 0; offset++;

  view.setUint32(offset, 4, false); offset += 4;
  output[offset++] = 0; output[offset++] = 0x18; offset += 2;

  view.setUint32(offset, 2, false); offset += 4;
  output[offset++] = 0; offset++;

  output[offset++] = 0x80; offset += 3;
  view.setUint16(offset, 2, false); offset += 2;
  output.set(new TextEncoder().encode("./"), offset);
  return output;
}

describe("inspect structural records", () => {
  it("prints source-linked BDJO and META/DL records with graph nodes and counts", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv inspect records "));
    const discRoot = join(parent, "BDMV");
    try {
      await mkdir(join(discRoot, "BDJO"), { recursive: true });
      await mkdir(join(discRoot, "META", "DL"), { recursive: true });
      await mkdir(join(discRoot, "PLAYLIST"), { recursive: true });
      await mkdir(join(discRoot, "CLIPINF"), { recursive: true });
      await mkdir(join(discRoot, "STREAM"), { recursive: true });
      await writeFile(join(discRoot, "index.bdmv"), buildM1Index({ bdjTitle: "00042" }));
      await writeFile(join(discRoot, "MovieObject.bdmv"), buildM1MovieObject());
      await writeFile(join(discRoot, "BDJO", "00042.bdjo"), buildEmptyBdjo());
      await writeFile(join(discRoot, "META", "DL", "bdmt_eng.xml"),
        "<meta><title><name>Example &amp; Title</name></title><tableOfContents><titleName titleNumber=\"1\">Opening</titleName></tableOfContents></meta>");

      const result = spawnSync(process.execPath, [resolve(cliRoot, "dist/index.js"), "inspect", discRoot, "--format", "json"]);
      expect(result.status, result.stderr.toString()).toBe(0);
      expect(result.stderr.toString()).toBe("");
      const parsed = JSON.parse(result.stdout.toString());
      expect(parsed.declarations).toMatchObject({ bdjos: 1, metadata: 1 });
      expect(parsed.bdjos[0]).toMatchObject({
        path: "BDJO/00042.bdjo",
        source: { path: "BDJO/00042.bdjo", origin: "primary", offset: "0" },
      });
      expect(parsed.metadata[0]).toMatchObject({
        language: "eng",
        discName: "Example & Title",
        titles: [{ titleNumber: 1, titleName: "Opening", source: { path: "META/DL/bdmt_eng.xml" } }],
        source: { path: "META/DL/bdmt_eng.xml", origin: "primary", offset: "0" },
      });
      expect(parsed.graph.nodes).toContainEqual(expect.objectContaining({
        id: "bdjo:00042", type: "bdjo", state: "present", source: parsed.bdjos[0].source,
      }));
      expect(parsed.graph.nodes).toContainEqual(expect.objectContaining({
        id: "metaDl:eng", type: "metaDl", state: "present", source: parsed.metadata[0].source,
      }));
      expect(parsed.supportPrediction.status).toBe("partial");
      expect(parsed.supportPrediction.unverified).toContain("INDX candidate versions 0100 and 0240; AppInfoBDMV and UHD extension fields outside compared samples");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
