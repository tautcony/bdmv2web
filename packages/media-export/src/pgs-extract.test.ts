import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractPgsTrack } from "./pgs-extract.js";

const roots: string[] = [];
async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bdmv-pgs-extract-"));
  roots.push(root);
  return root;
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("PGS transport extraction", () => {
  it("extracts one PID to SUP with anchored timestamps and parsed display sets", async () => {
    const root = await temp();
    const sourcePath = join(root, "source.m2ts");
    const outputPath = join(root, "nested", "track.sup");
    await writeFile(sourcePath, m2tsPacket(0x1200, pesPacket(pgsDisplaySet(), 90_000n, 88_000n)));

    const result = await extractPgsTrack(sourcePath, 0x1200, outputPath, { timestampOffset90k: 10_000n });
    const output = await readFile(outputPath);

    expect(result).toMatchObject({
      pid: 0x1200,
      sourcePath,
      path: outputPath,
      byteLength: output.byteLength,
      displaySets: [{ pts90k: 2_000, width: 4, height: 3 }],
    });
    expect([...output.subarray(0, 13)]).toEqual([0x50, 0x47, 0, 0, 7, 0xd0, 0, 0, 0, 0, 0x16, 0, 11]);
    expect([...output.subarray(24)]).toEqual([0x50, 0x47, 0, 0, 7, 0xd0, 0, 0, 0, 0, 0x80, 0, 0]);
  });

  it("rejects invalid PID, byte limit, and negative timestamp offset", async () => {
    const root = await temp();
    const sourcePath = join(root, "source.m2ts");
    await writeFile(sourcePath, m2tsPacket(0x1200, pesPacket(pgsDisplaySet(), 90_000n, null)));

    await expect(extractPgsTrack(sourcePath, 0x1fff, join(root, "invalid.sup"))).rejects.toThrow(/valid 13-bit/);
    await expect(extractPgsTrack(sourcePath, 0x1200, join(root, "invalid-limit.sup"), { maxBytes: 0 })).rejects.toThrow(/maxBytes/);
    await expect(extractPgsTrack(sourcePath, 0x1200, join(root, "negative-offset.sup"), { timestampOffset90k: -1n })).rejects.toThrow(/non-negative/);
  });

  it("removes incomplete output when the PES contains a truncated PGS segment", async () => {
    const root = await temp();
    const sourcePath = join(root, "truncated.m2ts");
    const outputPath = join(root, "failed", "track.sup");
    await writeFile(sourcePath, m2tsPacket(0x1200, pesPacket(Uint8Array.of(0x16, 0, 20, 0), 90_000n, null)));

    await expect(extractPgsTrack(sourcePath, 0x1200, outputPath)).rejects.toThrow(/truncated PES segment payload/);
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes output when the extracted track exceeds its configured byte limit", async () => {
    const root = await temp();
    const sourcePath = join(root, "source.m2ts");
    const outputPath = join(root, "bounded", "track.sup");
    await writeFile(sourcePath, m2tsPacket(0x1200, pesPacket(pgsDisplaySet(), 90_000n, null)));

    await expect(extractPgsTrack(sourcePath, 0x1200, outputPath, { maxBytes: 1 })).rejects.toThrow(/exceeds maxBytes/);
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes output when no complete display set is present", async () => {
    const root = await temp();
    const sourcePath = join(root, "empty.m2ts");
    const outputPath = join(root, "empty", "track.sup");
    await writeFile(sourcePath, m2tsPacket(0x1200, pesPacket(Uint8Array.of(0x80, 0, 0), 90_000n, null)));

    await expect(extractPgsTrack(sourcePath, 0x1200, outputPath)).rejects.toThrow(/no complete display sets/);
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function pgsSegment(type: number, payload: number[]): Uint8Array {
  const segment = new Uint8Array(3 + payload.length);
  segment.set([type, payload.length >>> 8, payload.length], 0);
  segment.set(payload, 3);
  return segment;
}

function pgsDisplaySet(): Uint8Array {
  return concat(
    pgsSegment(0x16, [0, 4, 0, 3, 0, 1, 0, 0, 0, 0, 0]),
    pgsSegment(0x80, []),
  );
}

function pesPacket(payload: Uint8Array, pts: bigint, dts: bigint | null): Uint8Array {
  const timestampBytes = dts === null ? 5 : 10;
  const headerData = new Uint8Array(3 + timestampBytes);
  headerData.set([0x80, dts === null ? 0x80 : 0xc0, timestampBytes], 0);
  headerData.set(encodeTimestamp(pts, dts === null ? 2 : 3), 3);
  if (dts !== null) headerData.set(encodeTimestamp(dts, 1), 8);
  const length = headerData.length + payload.length;
  const packet = new Uint8Array(6 + length);
  packet.set([0, 0, 1, 0xbd, length >>> 8, length], 0);
  packet.set(headerData, 6);
  packet.set(payload, 6 + headerData.length);
  return packet;
}

function encodeTimestamp(value: bigint, prefix: number): Uint8Array {
  return Uint8Array.of(
    (prefix << 4) | (Number(value >> 30n) & 7) << 1 | 1,
    Number(value >> 22n) & 0xff,
    (Number(value >> 15n) & 0x7f) << 1 | 1,
    Number(value >> 7n) & 0xff,
    (Number(value) & 0x7f) << 1 | 1,
  );
}

function m2tsPacket(pid: number, payload: Uint8Array): Uint8Array {
  if (payload.byteLength > 184) throw new RangeError("PES payload exceeds a single transport packet");
  const packet = new Uint8Array(192);
  const adaptationLength = 183 - payload.byteLength;
  packet[4] = 0x47;
  packet[5] = 0x40 | (pid >>> 8);
  packet[6] = pid & 0xff;
  packet[7] = 0x30;
  packet[8] = adaptationLength;
  packet.set(payload, 9 + adaptationLength);
  return packet;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
