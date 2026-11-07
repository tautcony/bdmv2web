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
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractIgsFromChunks } from "../src/extract.js";
import { chunks } from "./fixtures.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
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
  { caseId: "synthetic-igs-parser", clipId: "00001", pid: 0x120 },
  { caseId: "tamako", clipId: "00005", pid: 0x1400 },
  { caseId: "tamako", clipId: "00043", pid: 0x1400 },
] as const;

/** Decode a non-interlaced 8-bit RGBA PNG. Mirrors the summary extracted from the igstools reference PNGs. */
function decodeRgbaPng(input: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const bytes = Buffer.from(input);
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("not a PNG");
  const idat: Buffer[] = [];
  let width = 0, height = 0, at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("ascii", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error("expected 8-bit RGBA non-interlaced PNG");
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride), offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    const line = new Uint8Array(raw.subarray(offset, offset + stride));
    offset += stride;
    if (filter === 1) for (let i = 4; i < stride; i++) line[i] = (line[i] + line[i - 4]!) & 255;
    else if (filter === 2) for (let i = 0; i < stride; i++) line[i] = (line[i] + previous[i]!) & 255;
    else if (filter === 3) for (let i = 0; i < stride; i++) line[i] = (line[i] + (((i >= 4 ? line[i - 4]! : 0) + previous[i]!) >> 1)) & 255;
    else if (filter === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? line[i - 4]! : 0, b = previous[i]!, c = i >= 4 ? previous[i - 4]! : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    rgba.set(line, y * stride);
    previous = line;
  }
  return { width, height, rgba };
}

const hex2 = (value: number): string => value.toString(16).padStart(2, "0");
const pixelHex = (rgba: Uint8Array, index: number): string => {
  const base = index * 4;
  return hex2(rgba[base]!) + hex2(rgba[base + 1]!) + hex2(rgba[base + 2]!) + hex2(rgba[base + 3]!);
};

function summarizePng(input: Uint8Array, id: string): ElementRow {
  const { width, height, rgba } = decodeRgbaPng(input);
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
