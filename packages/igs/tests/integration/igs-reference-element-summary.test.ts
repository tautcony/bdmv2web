/**
 * Compare re-rendered IGS assets with the pinned SAPikachu/igstools reference
 * PNGs recorded in test-data/baselines/igs-reference-element-summary.json. The golden
 * holds exact RGBA pixel samples and per-channel distributions from that
 * independent renderer. Test runs read only the golden and the checked-in
 * packet fixtures under test-data/fixtures/.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractIgsFromChunks } from "../../src/scene/extract.js";
import { chunks } from "../helpers/fixtures.js";
import { decodePng } from "../helpers/decode-png.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const goldenPath = resolve(repositoryRoot, "test-data/baselines/igs-reference-element-summary.json");
const fixtureRoot = resolve(repositoryRoot, "test-data/fixtures/hdmv-navigation/disc-data");

type PixelAnchor = [number, number, string] | null;
type ElementRow = [string, number, number, number, string, string, PixelAnchor, PixelAnchor, number[]];
type Golden = {
  reference: { tool: string; commit: string; matrix: string; reduction: string; source: string };
  encoding: Record<string, string>;
  cases: Array<{ case: string; clip: string; assets: ElementRow[] }>;
};

const SAMPLE_COUNT = 48;
const cases = [
  { caseId: "bang-dream-mygo-vol1", clipId: "00010", pid: 0x1400 },
  { caseId: "bang-dream-mygo-vol1", clipId: "00011", pid: 0x1400 },
  { caseId: "battle-royale-uhd", clipId: "00002", pid: 0x1400 },
  { caseId: "battle-royale-uhd", clipId: "00005", pid: 0x1400 },
  { caseId: "kyoani-ova", clipId: "00005", pid: 0x1400 },
  { caseId: "synthetic-all-features", clipId: "00002", pid: 0x1400 },
  { caseId: "synthetic-igs-parser", clipId: "00001", pid: 0x120 },
  { caseId: "tamako", clipId: "00005", pid: 0x1400 },
  { caseId: "tamako", clipId: "00043", pid: 0x1400 },
] as const;

const hex2 = (value: number): string => value.toString(16).padStart(2, "0");
const pixelHex = (rgba: Uint8Array, index: number): string => {
  const base = index * 4;
  return hex2(rgba[base]!) + hex2(rgba[base + 1]!) + hex2(rgba[base + 2]!) + hex2(rgba[base + 3]!);
};

function summarizePng(input: Uint8Array, id: string): ElementRow {
  const { width, height, rgba } = decodePng(input);
  const count = width * height;
  const bins = Array<number>(64).fill(0);
  let firstOpaque: PixelAnchor = null, lastOpaque: PixelAnchor = null;
  for (let i = 0; i < count; i++) {
    const base = i * 4;
    for (let channel = 0; channel < 4; channel++) bins[channel * 16 + (rgba[base + channel]! >> 4)]!++;
    if (rgba[base + 3]) {
      const anchor: PixelAnchor = [i % width, Math.floor(i / width), pixelHex(rgba, i)];
      if (!firstOpaque) firstOpaque = anchor;
      lastOpaque = anchor;
    }
  }
  let samples = "";
  for (let k = 0; k < SAMPLE_COUNT; k++) samples += pixelHex(rgba, Math.floor(k * (count - 1) / (SAMPLE_COUNT - 1)));
  let anchors = "";
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) {
    anchors += pixelHex(rgba, Math.floor((height - 1) * gy / 2) * width + Math.floor((width - 1) * gx / 2));
  }
  return [id, width, height, count, samples, anchors, firstOpaque, lastOpaque, bins];
}

describe("independent igstools reference pixels", () => {
  it.each(cases)("renders $caseId/$clipId pixel-for-pixel like the independent reference", async ({ caseId, clipId, pid }) => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as Golden;
    const expectedCase = golden.cases.find((entry) => entry.case === caseId && entry.clip === clipId);
    expect(expectedCase, `missing independent reference summary for ${caseId}/${clipId}`).toBeDefined();
    const expectedById = new Map(expectedCase!.assets.map((asset) => [asset[0], asset]));

    const source = caseId === "synthetic-igs-parser"
      ? resolve(repositoryRoot, "test-data/fixtures/igs-parser/synthetic-single-object.m2ts")
      : caseId === "synthetic-all-features"
        ? resolve(repositoryRoot, "test-data/fixtures/synthetic-all-features/BDMV/STREAM", `${clipId}.m2ts_ig-packets.bin`)
        : resolve(fixtureRoot, caseId, "BDMV", "STREAM", `${clipId}.m2ts_ig-packets.bin`);
    const bytes = await readFile(source);
    const result = await extractIgsFromChunks(clipId, chunks(bytes, 4093), [{
      pid,
      source: { path: `BDMV/CLIPINF/${clipId}.clpi`, origin: "primary", offset: "0" },
    }]);

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.scenes).toHaveLength(1);
    expect(result.assets.map((asset) => asset.id).sort()).toEqual([...expectedById.keys()].sort());
    for (const asset of result.assets) {
      expect(summarizePng(asset.pngBytes, asset.id), asset.id).toEqual(expectedById.get(asset.id));
    }
  }, 120_000);
});
