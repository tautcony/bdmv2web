import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "@bdmv-web/core";
import { decodeRle } from "../src/igs.js";
import { M2tsPacketReader, PesAssembler, PsiAssembler, decodeTimestamp, encodeTimestampForFixture } from "../src/transport.js";
import { IG_PID, m2tsPacket, patPacket, pesPacket, syntheticClip } from "./fixtures.js";

describe("M2TS packet and PES reconstruction", () => {
  it("produces identical 192-byte packet records for every input chunk split", () => {
    const bytes = syntheticClip();
    const expected = parseWithChunkSize(bytes, bytes.length);
    for (const size of [1, 7, 187, 191, 192, 193, 511]) expect(parseWithChunkSize(bytes, size)).toEqual(expected);
    expect(expected).toHaveLength(3);
    expect(expected.map((p) => p.pid)).toEqual([0, 0x100, IG_PID]);
  });

  it("diagnoses 188-byte TS instead of silently treating it as M2TS", () => {
    const reader = new M2tsPacketReader("clip");
    expect(reader.feed(new Uint8Array(188).fill(0xff))).toEqual([]);
    reader.end();
    expect(reader.diagnostics.some((d) => d.code === "TS_SYNC_LOST" || d.code === "TS_TRUNCATED_PACKET")).toBe(true);
  });

  it("discards a partial PSI section on continuity damage instead of splicing later bytes", () => {
    const reader = new M2tsPacketReader("clip");
    const section = reader.feed(patPacket())[0]!.payload.subarray(1, 17);
    const diagnostics = [];
    const psi = new PsiAssembler(diagnostics, "clip");
    expect(psi.push(psiPacket(0, true, concat(Uint8Array.of(0), section.subarray(0, 6)))).length).toBe(0);
    expect(psi.push(psiPacket(0, false, section.subarray(6), true)).length).toBe(0);
    expect(psi.programs.size).toBe(0);
    expect(diagnostics.map((item) => item.code)).toContain("PSI_INVALIDATED");
    psi.push(psiPacket(0, true, concat(Uint8Array.of(0), section)));
    expect(psi.programs.get(1)).toBe(0x100);
  });

  it("ignores adaptation-only CC, discards exact duplicates and diagnoses changed/missing payload CC", () => {
    const reader = new M2tsPacketReader("clip");
    const payload = Uint8Array.of(1, 2, 3);
    const packets = [
      m2tsPacket(IG_PID, payload, { cc: 0 }),
      m2tsPacket(IG_PID, new Uint8Array(), { cc: 7, adaptationOnly: true }),
      m2tsPacket(IG_PID, payload, { cc: 0 }),
      m2tsPacket(IG_PID, new Uint8Array(), { cc: 8, adaptationOnly: true, discontinuity: true }),
      m2tsPacket(IG_PID, Uint8Array.of(4), { cc: 2 }),
    ].flatMap((frame) => reader.feed(frame));
    expect(packets).toHaveLength(4);
    expect(packets[1]?.hasPayload).toBe(false);
    expect(packets[2]?.discontinuity).toBe(true);
    expect(reader.diagnostics.map((d) => d.code)).toContain("TS_DUPLICATE_PACKET");
    expect(reader.diagnostics.map((d) => d.code)).toContain("TS_CONTINUITY_ERROR");
  });

  it("parses PTS and extends a 33-bit wrap into the next epoch", () => {
    const nearWrap = (1n << 33n) - 5n;
    const assembler = new PesAssembler("clip");
    const packets = [nearWrap, 10n, 11n].map((pts, i) => ({
      packetOffset: BigInt(i * 192), payloadOffset: 4, pid: IG_PID, payloadUnitStart: true,
      continuityCounter: i, hasPayload: true, discontinuity: false, transportError: false,
      continuityError: false, payload: pesPacket(Uint8Array.of(i), pts),
    }));
    const complete = packets.flatMap((packet) => assembler.push(packet));
    expect(complete.map((p) => p.pts?.raw)).toEqual([nearWrap, 10n, 11n]);
    expect(complete.map((p) => p.pts?.epoch)).toEqual([0n, 1n, 1n]);
    expect(complete[1]?.pts?.normalized).toBe((1n << 33n) + 10n);
    expect(decodeTimestamp(pesPacket(Uint8Array.of(0), 123n).subarray(9, 14))).toBe(123n);
    const ptsDts = pesPacket(Uint8Array.of(7), 123n);
    const withDts = new Uint8Array(ptsDts.length + 5); withDts.set(ptsDts.subarray(0, 9));
    withDts[7] = 0xc0; withDts[8] = 10; withDts.set(encodeTimestampForFixture(99n, 1), 14); withDts.set(ptsDts.subarray(14), 19);
    const pesLength = ((withDts[4]! << 8) | withDts[5]!) + 5; withDts[4] = pesLength >> 8; withDts[5] = pesLength & 255;
    const dtsPacket = { packetOffset: 1000n, payloadOffset: 4, pid: IG_PID, payloadUnitStart: true, continuityCounter: 0, hasPayload: true, discontinuity: false, transportError: false, continuityError: false, payload: withDts };
    expect(new PesAssembler("clip").push(dtsPacket)[0]?.dtsRaw).toBe(99n);
  });

  it("reassembles a PES whose declared payload crosses TS packets", () => {
    const body = Uint8Array.from({ length: 240 }, (_, i) => i & 255);
    const encoded = pesPacket(body, 77n);
    const assembler = new PesAssembler("clip");
    const first = { packetOffset: 0n, payloadOffset: 4, pid: IG_PID, payloadUnitStart: true, continuityCounter: 0, hasPayload: true, discontinuity: false, transportError: false, continuityError: false, payload: encoded.subarray(0, 184) };
    const second = { ...first, packetOffset: 192n, payloadUnitStart: false, continuityCounter: 1, payload: encoded.subarray(184) };
    expect(assembler.push(first)).toEqual([]);
    const complete = assembler.push(second);
    expect(complete).toHaveLength(1);
    expect(complete[0]?.payload).toEqual(body);
    expect(complete[0]?.pts?.raw).toBe(77n);
    expect(complete[0]?.payloadOffset).toBe(22n);
  });

  it("does not join PES bytes across an explicit TS discontinuity", () => {
    const assembler = new PesAssembler("clip");
    const damaged = { packetOffset: 0n, payloadOffset: 4, pid: IG_PID, payloadUnitStart: true, continuityCounter: 0, hasPayload: true, discontinuity: false, transportError: false, continuityError: false, payload: pesPacket(Uint8Array.of(1, 2, 3), 10n).subarray(0, 12) };
    const clean = { ...damaged, packetOffset: 192n, payloadUnitStart: true, continuityCounter: 7, discontinuity: true, payload: pesPacket(Uint8Array.of(9), 20n) };
    expect(assembler.push(damaged)).toEqual([]);
    const result = assembler.push(clean);
    expect(result).toHaveLength(1);
    expect(result[0]?.payload).toEqual(Uint8Array.of(9));
    expect(result[0]?.pts?.timeDomain).toBe(1);
    expect(assembler.diagnostics.map((d) => d.code)).toContain("PES_INVALIDATED");
  });

  it("starts a new time domain on explicit discontinuity", () => {
    const assembler = new PesAssembler("clip");
    const make = (offset: number, pts: bigint, discontinuity = false) => ({ packetOffset: BigInt(offset), payloadOffset: 4, pid: IG_PID, payloadUnitStart: true, continuityCounter: 0, hasPayload: true, discontinuity, transportError: false, continuityError: false, payload: pesPacket(Uint8Array.of(1), pts) });
    const complete = [make(0, 100_000n), make(192, 2n, true), make(384, 3n)].flatMap((packet) => assembler.push(packet));
    expect(complete.map((p) => p.pts?.timeDomain)).toEqual([0, 1, 1]);
    expect(complete[1]?.pts?.normalized).toBe(2n);
  });
});

describe("bounded IGS RLE", () => {
  it("decodes transparent runs and explicit row ends", () => {
    expect([...decodeRle(Uint8Array.of(0, 2, 0, 0, 1, 2), 2, 2)]).toEqual([0, 0, 1, 2]);
  });

  it("rejects row overflow, incomplete rows, and dimensions above the pixel budget", () => {
    expect(() => decodeRle(Uint8Array.of(1, 2), 1, 1)).toThrowError(expect.objectContaining({ code: "IGS_RLE_OVERRUN" }));
    expect(() => decodeRle(Uint8Array.of(1), 2, 1)).toThrowError(expect.objectContaining({ code: "IGS_RLE_TRUNCATED" }));
    expect(() => decodeRle(Uint8Array.of(1), 100, 100, { ...DEFAULT_LIMITS, maxObjectPixels: 8_000 })).toThrow();
  });
});

function parseWithChunkSize(bytes: Uint8Array, size: number) {
  const reader = new M2tsPacketReader("fixture"); const out = [];
  for (let at = 0; at < bytes.length; at += size) out.push(...reader.feed(bytes.subarray(at, Math.min(bytes.length, at + size))));
  reader.end(); return out.map((p) => ({ pid: p.pid, offset: p.packetOffset.toString(), cc: p.continuityCounter, start: p.payloadUnitStart }));
}

function psiPacket(pid: number, payloadUnitStart: boolean, payload: Uint8Array, continuityError = false) {
  return { packetOffset: 0n, payloadOffset: 4, pid, payloadUnitStart, continuityCounter: 0, hasPayload: true, discontinuity: false, transportError: false, continuityError, payload };
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
