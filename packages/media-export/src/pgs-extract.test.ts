import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractPgsTrack, extractPgsTracks } from "./pgs-extract.js";

const roots: string[] = [];
async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bdmv-pgs-extract-"));
  roots.push(root);
  return root;
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("PGS transport extraction", () => {
  it("extracts multiple PIDs and source intervals from one clip scan", async () => {
    const root = await temp();
    const sourcePath = join(root, "source.m2ts");
    const outputPaths = [join(root, "one.sup"), join(root, "two.sup"), join(root, "three.sup")];
    await writeFile(sourcePath, concat(
      m2tsPacket(0x1200, pesPacket(pgsDisplaySet(), 90_000n, 88_000n)),
      m2tsPacket(0x1201, pesPacket(pgsDisplaySet(), 90_000n, 88_000n)),
    ));

    const tracks = await extractPgsTracks(sourcePath, [
      { pid: 0x1200, outputPath: outputPaths[0]!, timestampOffset90k: 10_000n },
      { pid: 0x1200, outputPath: outputPaths[1]!, timestampOffset90k: 200_000n },
      { pid: 0x1201, outputPath: outputPaths[2]!, timestampOffset90k: 10_000n },
    ]);
    const [anchored, unanchored] = await Promise.all(outputPaths.slice(0, 2).map((path) => readFile(path)));

    expect(tracks.map(({ pid, displaySets }) => [pid, displaySets[0]?.pts90k])).toEqual([[0x1200, 2_000], [0x1200, 4_294_857_296], [0x1201, 2_000]]);
    expect([...anchored!.subarray(0, 6)]).toEqual([0x50, 0x47, 0, 0, 7, 0xd0]);
    expect([...unanchored!.subarray(0, 6)]).toEqual([0x50, 0x47, 0xff, 0xfe, 0x52, 0x50]);
  });

  it("extracts a valid track larger than 64 MiB by default and enforces an explicit limit", async () => {
    const root = await temp();
    const sourcePath = join(root, "large-source.m2ts");
    const outputPath = join(root, "large.sup");
    const existingOutput = join(root, "bounded.sup");
    await writeLargeValidPgsClip(sourcePath);
    await writeFile(existingOutput, "preserve this output on failure");

    const result = await extractPgsTrack(sourcePath, 0x1200, outputPath);
    expect(result.byteLength).toBeGreaterThan(64 * 1024 * 1024);
    expect(result.displaySets).toMatchObject([{ pts90k: 0, width: 4, height: 3, placements: [] }]);
    await expect(extractPgsTrack(sourcePath, 0x1200, existingOutput, { maxBytes: 64 * 1024 * 1024 })).rejects.toThrow(/exceeds maxBytes/);
    expect(await readFile(existingOutput, "utf8")).toBe("preserve this output on failure");
  }, 120_000);

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

  it("rejects the source clip as an output path", async () => {
    const root = await temp();
    const sourcePath = join(root, "source.m2ts");
    const original = m2tsPacket(0x1200, pesPacket(pgsDisplaySet(), 90_000n, null));
    await writeFile(sourcePath, original);

    await expect(extractPgsTrack(sourcePath, 0x1200, sourcePath)).rejects.toThrow(/must differ from the source clip path/);
    expect([...await readFile(sourcePath)]).toEqual([...original]);
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

function pgsSegment(type: number, payload: number[] | Uint8Array): Uint8Array {
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

async function writeLargeValidPgsClip(path: string): Promise<void> {
  const file = await open(path, "w");
  let continuity = 0;
  try {
    const writeSegment = async (type: number, payload: number[] | Uint8Array) => {
      continuity = await writePes(file, 0x1200, pgsSegment(type, payload), continuity);
    };
    await writeSegment(0x16, [0, 4, 0, 3, 0, 1, 0, 0, 0, 0, 0]);
    for (let version = 0; version < 1_025; version++) {
      const palette = new Uint8Array(65_522);
      palette[0] = 0;
      palette[1] = version & 0xff;
      for (let offset = 2; offset < palette.length; offset += 5) {
        palette[offset] = ((offset - 2) / 5) & 0xff;
        palette[offset + 1] = (version + offset) & 0xff;
        palette[offset + 2] = 128;
        palette[offset + 3] = 128;
        palette[offset + 4] = 255;
      }
      await writeSegment(0x14, palette);
    }
    await writeSegment(0x80, []);
  } finally {
    await file.close();
  }
}

async function writePes(file: Awaited<ReturnType<typeof open>>, pid: number, payload: Uint8Array, continuity: number): Promise<number> {
  const pes = new Uint8Array(9 + payload.byteLength);
  pes.set([0, 0, 1, 0xbd, 0, 0, 0x80, 0, 0]);
  pes.set(payload, 9);
  const packets = new Uint8Array(Math.ceil(pes.byteLength / 184) * 192);
  let offset = 0;
  let packetOffset = 0;
  while (offset < pes.byteLength) {
    const payloadLength = Math.min(184, pes.byteLength - offset);
    const packet = packets.subarray(packetOffset, packetOffset + 192);
    packet[4] = 0x47;
    packet[5] = (offset === 0 ? 0x40 : 0) | (pid >>> 8);
    packet[6] = pid & 0xff;
    packet[7] = (payloadLength === 184 ? 0x10 : 0x30) | (continuity & 0x0f);
    const payloadOffset = payloadLength === 184 ? 8 : 9 + (183 - payloadLength);
    if (payloadLength !== 184) packet[8] = 183 - payloadLength;
    packet.set(pes.subarray(offset, offset + payloadLength), payloadOffset);
    offset += payloadLength;
    packetOffset += packet.byteLength;
    continuity++;
  }
  let written = 0;
  while (written < packets.byteLength) {
    const result = await file.write(packets, written, packets.byteLength - written, null);
    if (result.bytesWritten === 0) throw new Error("Test fixture write made no progress.");
    written += result.bytesWritten;
  }
  return continuity;
}
