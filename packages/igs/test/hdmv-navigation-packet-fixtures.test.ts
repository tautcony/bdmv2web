import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractIgsFromChunks } from "../src/extract.js";
import { chunks } from "./fixtures.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureRoot = resolve(repositoryRoot, "test-data/fixtures/hdmv-navigation/disc-data");
const fixtures = [
  { caseId: "tamako", clipId: "00005", pages: 7, objects: 168, palettes: 7, assets: 168 },
  { caseId: "tamako", clipId: "00043", pages: 7, objects: 168, palettes: 7, assets: 168 },
  { caseId: "baja", clipId: "00005", pages: 4, objects: 41, palettes: 4, assets: 41 },
  { caseId: "kyoani-ova", clipId: "00005", pages: 4, objects: 32, palettes: 4, assets: 32 },
  { caseId: "battle-royale-uhd", clipId: "00002", pages: 21, objects: 215, palettes: 21, assets: 215 },
  { caseId: "battle-royale-uhd", clipId: "00005", pages: 4, objects: 55, palettes: 4, assets: 68 },
  { caseId: "bang-dream-mygo-vol1", clipId: "00010", pages: 7, objects: 182, palettes: 6, assets: 188 },
  { caseId: "bang-dream-mygo-vol1", clipId: "00011", pages: 2, objects: 51, palettes: 1, assets: 51 },
] as const;

describe("real-disc IGS packet fixtures", () => {
  it.each(fixtures)("extracts IGS scenes from $caseId clip $clipId packet data", async ({ caseId, clipId, pages, objects, palettes, assets }) => {
    const streamRelative = `STREAM/${clipId}.m2ts_ig-packets.bin`;
    const streamPath = resolve(fixtureRoot, caseId, "BDMV", streamRelative);
    const [bytes, sidecarBytes] = await Promise.all([
      readFile(streamPath),
      readFile(`${streamPath}.offset-runs.json`, "utf8"),
    ]);
    const sidecar = JSON.parse(sidecarBytes) as { sourceM2ts: string; packetSize: number; pids: number[]; runs: Array<{ fixturePacketStart: number; sourcePacketStart: number; packetCount: number }> };

    expect(bytes.byteLength % 192).toBe(0);
    expect(sidecar).toMatchObject({ sourceM2ts: `BDMV/STREAM/${clipId}.m2ts`, packetSize: 192, pids: [0, 0x100, 0x1400] });
    let fixturePacketEnd = 0;
    for (const run of sidecar.runs) {
      expect(run.fixturePacketStart).toBe(fixturePacketEnd);
      expect(run.sourcePacketStart).toBeGreaterThanOrEqual(0);
      expect(run.packetCount).toBeGreaterThan(0);
      fixturePacketEnd += run.packetCount;
    }
    expect(fixturePacketEnd).toBe(bytes.byteLength / 192);
    const packetPids = new Set<number>();
    for (let offset = 0; offset < bytes.byteLength; offset += 192) {
      expect(bytes[offset + 4]).toBe(0x47);
      packetPids.add(((bytes[offset + 5]! & 0x1f) << 8) | bytes[offset + 6]!);
    }
    expect([...packetPids].sort((a, b) => a - b)).toEqual([0, 0x100, 0x1400]);

    const result = await extractIgsFromChunks(clipId, chunks(bytes, 4093), [{
      pid: 0x1400,
      source: { path: `BDMV/CLIPINF/${clipId}.clpi`, origin: "primary", offset: "0" },
    }]);
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code);

    expect(errors).not.toContain("IGS_PID_CONFLICT");
    expect(errors).not.toContain("TS_SYNC_LOST");
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]).toMatchObject({ clipId, pid: 0x1400, complete: true, width: 1920, height: 1080 });
    expect(result.scenes[0]?.pages).toHaveLength(pages);
    expect(result.scenes[0]?.objects).toHaveLength(objects);
    expect(result.scenes[0]?.palettes).toHaveLength(palettes);
    expect(result.assets).toHaveLength(assets);
  });
});
