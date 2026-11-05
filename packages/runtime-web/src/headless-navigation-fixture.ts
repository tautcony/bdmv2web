import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { extractIgsFromChunks } from "@bdmv2web/igs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function loadRawIgsFixture(caseId: string, clipId: string, pid: number, options: { renderAssets?: boolean } = {}) {
  const root = resolve(repo, `test-data/fixtures/hdmv-navigation/disc-data/${caseId}/BDMV`);
  const disc = await parseBdmv(root);
  const packetFile = resolve(root, `STREAM/${clipId}.m2ts_ig-packets.bin`);
  const data = await readFile(packetFile);
  const sidecar = JSON.parse(await readFile(`${packetFile}.offset-runs.json`, "utf8")) as {
    sourceM2ts: string; packetSize: number; pids: number[]; runs: Array<{ fixturePacketStart: number; sourcePacketStart: number; packetCount: number }>;
  };
  if (sidecar.packetSize !== 192 || !sidecar.pids.includes(0) || !sidecar.pids.includes(0x100) || !sidecar.pids.includes(pid)) throw new Error(`${caseId} IGS packet fixture sidecar mismatch`);
  if (data.length % 192 !== 0) throw new Error(`${caseId} IGS fixture is not packet aligned`);
  let nextFixture = 0;
  for (const run of sidecar.runs) {
    if (run.fixturePacketStart !== nextFixture || run.packetCount <= 0) throw new Error(`${caseId} IGS offset runs have a gap or overlap`);
    nextFixture += run.packetCount;
  }
  if (nextFixture !== data.length / 192) throw new Error(`${caseId} IGS offset runs do not cover every fixture packet`);
  const sourceOffsetForFixtureOffset = (fixtureByteOffset: bigint): bigint => {
    const packetIndex = Number(fixtureByteOffset / 192n);
    const withinPacket = fixtureByteOffset % 192n;
    const run = sidecar.runs.find((candidate) => packetIndex >= candidate.fixturePacketStart && packetIndex < candidate.fixturePacketStart + candidate.packetCount);
    if (!run) throw new Error(`${caseId} fixture byte offset is not mapped`);
    return BigInt(run.sourcePacketStart + packetIndex - run.fixturePacketStart) * 192n + withinPacket;
  };
  for (const run of sidecar.runs) {
    const fixtureStart = BigInt(run.fixturePacketStart) * 192n;
    const sourceStart = BigInt(run.sourcePacketStart) * 192n;
    const fixtureLastByte = BigInt(run.fixturePacketStart + run.packetCount) * 192n - 1n;
    const sourceLastByte = BigInt(run.sourcePacketStart + run.packetCount) * 192n - 1n;
    if (sourceOffsetForFixtureOffset(fixtureStart) !== sourceStart || sourceOffsetForFixtureOffset(fixtureLastByte) !== sourceLastByte) throw new Error(`${caseId} IGS offset boundary mapping failed`);
  }
  async function* chunks() { for (let offset = 0; offset < data.length; offset += 192 * 97) yield data.subarray(offset, Math.min(offset + 192 * 97, data.length)); }
  const extraction = await extractIgsFromChunks(clipId, chunks(), [{ pid, source: { path: sidecar.sourceM2ts, origin: "primary", offset: "0" } }], options);
  return { disc, extraction, sidecar, packetCount: data.length / 192, sourceOffsetForFixtureOffset };
}
