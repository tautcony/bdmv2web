import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "@bdmv2web/core";
import type { TsPacket } from "@bdmv2web/igs";
import { fanOutPackets } from "./packet-fanout.js";

function frame(pid: number, cc: number): Uint8Array {
  const bytes = new Uint8Array(192);
  bytes.fill(0xaa, 8);
  bytes[4] = 0x47;
  bytes[5] = (pid >> 8) & 0x1f;
  bytes[6] = pid & 0xff;
  bytes[7] = 0x10 | (cc & 15);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

async function* chunks(...groups: Uint8Array[][]): AsyncGenerator<Uint8Array> {
  for (const group of groups) yield concat(...group);
}

async function collect(stream: AsyncIterable<readonly TsPacket[]>): Promise<TsPacket[]> {
  const packets: TsPacket[] = [];
  for await (const batch of stream) for (const packet of batch) packets.push(packet);
  return packets;
}

const limits = { ...DEFAULT_LIMITS };

describe("fanOutPackets", () => {
  it("gives both consumers the same parsed packets in order", async () => {
    const scan = fanOutPackets(chunks([frame(0x100, 0), frame(0x100, 1)], [frame(0x100, 2)]), "clip", 2, limits);
    const [left, right] = await Promise.all([collect(scan.batches[0]!), collect(scan.batches[1]!)]);
    expect(left.map((packet) => Number(packet.packetOffset))).toEqual([0, 192, 384]);
    expect(right.map((packet) => Number(packet.packetOffset))).toEqual([0, 192, 384]);
    expect(left[0]).toBe(right[0]);
    expect(scan.transportDiagnostics).toHaveLength(0);
  });

  it("keeps scanning to EOF when one consumer leaves early", async () => {
    const scan = fanOutPackets(chunks([frame(0x100, 0)], [frame(0x100, 1)], [frame(0x100, 2)]), "clip", 2, limits);
    const [early, full] = await Promise.all([
      (async () => { for await (const batch of scan.batches[0]!) return batch; return []; })(),
      collect(scan.batches[1]!),
    ]);
    expect(early).toHaveLength(1);
    expect(full).toHaveLength(3);
  });

  it("reports a truncated tail from the shared reader", async () => {
    const scan = fanOutPackets(chunks([frame(0x100, 0)], [new Uint8Array(20)]), "clip", 1, limits);
    await collect(scan.batches[0]!);
    expect(scan.transportDiagnostics.map((item) => item.code)).toContain("TS_TRUNCATED_PACKET");
  });

  it("reports trailing damage after the only consumer leaves early", async () => {
    const scan = fanOutPackets(chunks([frame(0x100, 0)], [frame(0x100, 1)], [new Uint8Array(20)]), "clip", 1, limits);
    for await (const batch of scan.batches[0]!) {
      expect(batch).toHaveLength(1);
      break;
    }
    await scan.done;
    expect(scan.transportDiagnostics.map((item) => item.code)).toContain("TS_TRUNCATED_PACKET");
  });

  it("rethrows a read failure in every open consumer", async () => {
    const source = (async function* () {
      yield frame(0x100, 0);
      throw new Error("disk went away");
    })();
    const scan = fanOutPackets(source, "clip", 2, limits);
    const results = await Promise.allSettled([collect(scan.batches[0]!), collect(scan.batches[1]!)]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toMatchObject({ message: "disk went away" });
    }
  });
});
