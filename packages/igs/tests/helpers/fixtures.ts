import { encodeTimestampForFixture } from "../../src/transport.js";

export const IG_PID = 0x120;
export const PMT_PID = 0x100;

export function m2tsPacket(pid: number, payload: Uint8Array, options: { cc?: number; pusi?: boolean; adaptationOnly?: boolean; discontinuity?: boolean } = {}): Uint8Array {
  const frame = new Uint8Array(192); const ts = frame.subarray(4); ts.fill(0xff); ts[0] = 0x47;
  ts[1] = ((options.pusi ? 0x40 : 0) | (pid >> 8)) & 0x7f; ts[2] = pid & 255;
  if (options.adaptationOnly) {
    ts[3] = 0x20 | (options.cc ?? 0); ts[4] = 183; ts[5] = options.discontinuity ? 0x80 : 0; return frame;
  }
  ts[3] = 0x10 | (options.cc ?? 0);
  if (payload.length > 184) throw new RangeError("synthetic TS payload exceeds 184 bytes");
  ts.set(payload, 4); return frame;
}

export function pesPacket(payload: Uint8Array, pts = 0n): Uint8Array {
  const length = 8 + payload.length; const packet = new Uint8Array(14 + payload.length);
  packet.set([0, 0, 1, 0xbd, length >> 8, length & 255, 0x80, 0x80, 5], 0);
  packet.set(encodeTimestampForFixture(pts), 9); packet.set(payload, 14); return packet;
}

export function patPacket(cc = 0): Uint8Array {
  const section = withMpegCrc(Uint8Array.of(0x00, 0xb0, 0x0d, 0, 1, 0xc1, 0, 0, 0, 1, (PMT_PID >> 8) | 0xe0, PMT_PID & 255));
  return m2tsPacket(0, concat(Uint8Array.of(0), section), { cc, pusi: true });
}

export function pmtPacket(streamPid = IG_PID, streamType = 0x91, cc = 0): Uint8Array {
  const section = withMpegCrc(Uint8Array.of(0x02, 0xb0, 0x12, 0, 1, 0xc1, 0, 0, 0xe0 | (streamPid >> 8), streamPid & 255, 0xf0, 0, streamType, 0xe0 | (streamPid >> 8), streamPid & 255, 0xf0, 0));
  return m2tsPacket(PMT_PID, concat(Uint8Array.of(0), section), { cc, pusi: true });
}

export function syntheticMenuSegments(options: { effects?: boolean; richEffects?: boolean; uiModelWithTimeouts?: boolean; animated?: boolean; buttonCommand?: Uint8Array; twoPages?: boolean; includeEnd?: boolean; missingPalette?: boolean; missingObject?: boolean; malformedObject?: boolean; incompleteObject?: boolean; missingPaletteEntry?: boolean; invalidReferences?: boolean; defaultSelectedButtonId?: number; defaultActivatedButtonId?: number } = {}): Uint8Array {
  const page = makePage(options.effects ?? false, 1, options.missingObject ?? false, options.invalidReferences ?? false, options.richEffects ?? false, options.animated ?? false, options.buttonCommand, options.defaultSelectedButtonId, options.defaultActivatedButtonId);
  const inter = concat(Uint8Array.of(0x80, 0, 0, 0, options.twoPages ? 2 : 1), page, ...(options.twoPages ? [makePage(false, 2, options.missingObject ?? false)] : []));
  const compositionData = options.uiModelWithTimeouts
    ? concat(Uint8Array.of(0x40), packBits([[0n, 7], [90_000n, 33], [0n, 7], [45_000n, 33]]), u24(123), Uint8Array.of(options.twoPages ? 2 : 1), page, ...(options.twoPages ? [makePage(false, 2, options.missingObject ?? false)] : []))
    : inter;
  const dataLength = Uint8Array.of(compositionData.length >> 16, compositionData.length >> 8, compositionData.length);
  const ics = concat(u16(1), u16(1), Uint8Array.of(0), u16(7), Uint8Array.of(0), Uint8Array.of(0xc0), dataLength, compositionData);
  const pds = Uint8Array.of(options.missingPalette ? 1 : 0, 0, 1, 235, 128, 128, 255);
  const rle = options.malformedObject ? Uint8Array.of(0) : Uint8Array.of(options.missingPaletteEntry ? 255 : 1);
  const ods = concat(u16(5), Uint8Array.of(0, options.incompleteObject ? 0x80 : 0xc0, 0, 0, 5, 0, 1, 0, 1), rle);
  return concat(segment(0x18, ics), segment(0x14, pds), segment(0x15, ods), ...(options.includeEnd === false ? [] : [segment(0x80, new Uint8Array())]));
}

export function syntheticClip(options: { pts?: bigint; effects?: boolean; richEffects?: boolean; uiModelWithTimeouts?: boolean; animated?: boolean; buttonCommand?: Uint8Array; twoPages?: boolean; includeEnd?: boolean; missingPalette?: boolean; missingObject?: boolean; malformedObject?: boolean; incompleteObject?: boolean; missingPaletteEntry?: boolean; invalidReferences?: boolean; streamPid?: number; streamType?: number; defaultSelectedButtonId?: number; defaultActivatedButtonId?: number } = {}): Uint8Array {
  const payload = pesPacket(syntheticMenuSegments(options), options.pts ?? 90_000n);
  if (payload.length > 184) throw new RangeError("synthetic menu fixture must fit in one PES TS packet");
  return concat(patPacket(), pmtPacket(options.streamPid ?? IG_PID, options.streamType ?? 0x91), m2tsPacket(options.streamPid ?? IG_PID, payload, { cc: 0, pusi: true }));
}

export function syntheticReferenceClip(): Uint8Array {
  const segments = syntheticMenuSegments();
  const packets: Uint8Array[] = [patPacket(), pmtPacket()];
  for (let offset = 0, continuity = 0; offset < segments.length; continuity++) {
    const length = (segments[offset + 1]! << 8) | segments[offset + 2]!;
    const segment = segments.subarray(offset, offset + 3 + length);
    packets.push(m2tsPacketWithExactPayload(IG_PID, pesPacket(segment, 90_000n + BigInt(continuity)), continuity & 0x0f));
    offset += segment.length;
  }
  return concat(...packets);
}

function m2tsPacketWithExactPayload(pid: number, payload: Uint8Array, cc: number): Uint8Array {
  if (payload.length > 183) throw new RangeError("synthetic IG PES packet exceeds one transport packet");
  const frame = new Uint8Array(192); const ts = frame.subarray(4); ts.fill(0xff);
  const adaptationLength = 183 - payload.length;
  ts[0] = 0x47; ts[1] = 0x40 | (pid >> 8); ts[2] = pid & 255;
  ts[3] = 0x30 | cc; ts[4] = adaptationLength;
  if (adaptationLength > 0) ts[5] = 0;
  ts.set(payload, 5 + adaptationLength);
  return frame;
}

export async function* chunks(data: Uint8Array, size: number): AsyncGenerator<Uint8Array> { for (let at = 0; at < data.length; at += size) yield data.subarray(at, Math.min(data.length, at + size)); }

function makePage(effects: boolean, pageId: number, missingObject = false, invalidReferences = false, richEffects = false, animated = false, buttonCommand?: Uint8Array, defaultSelectedButtonId?: number, defaultActivatedButtonId?: number): Uint8Array {
  const effectWindow = concat(Uint8Array.of(3), u16(10), u16(20), u16(30), u16(40));
  const effectObject = concat(u16(5), Uint8Array.of(3, 0x80), u16(1), u16(2), u16(3), u16(4), u16(5), u16(6));
  const enter = effects ? (richEffects ? concat(Uint8Array.of(1), effectWindow, Uint8Array.of(1), Uint8Array.of(0, 0, 1, 1, 1), effectObject) : Uint8Array.of(0, 1, 0, 0, 1, 0, 0)) : Uint8Array.of(0, 0);
  const exit = effects ? (richEffects ? Uint8Array.of(0, 1, 0, 0, 2, 2, 0) : Uint8Array.of(0, 1, 0, 0, 2, 0, 0)) : Uint8Array.of(0, 0);
  const command = buttonCommand ?? Uint8Array.from({ length: 12 }, (_, i) => i + 1);
  const objectId = missingObject ? 9 : 5;
  const button = concat(u16(1), u16(0), Uint8Array.of(invalidReferences ? 0x80 : 0), u16(0), u16(0), u16(invalidReferences ? 2 : 0xffff), u16(0xffff), u16(0xffff), u16(0xffff), u16(objectId), u16(objectId), Uint8Array.of(animated ? 0x80 : 0), Uint8Array.of(6), u16(objectId), u16(objectId), Uint8Array.of(animated ? 0x80 : 0), Uint8Array.of(9), u16(objectId), u16(objectId), u16(1), command);
  return concat(Uint8Array.of(pageId, 0), new Uint8Array(8), enter, exit, Uint8Array.of(1), u16(defaultSelectedButtonId ?? (invalidReferences ? 2 : 1)), u16(defaultActivatedButtonId ?? 0xffff), Uint8Array.of(0, 1), u16(invalidReferences ? 2 : 1), Uint8Array.of(1), button);
}

function segment(type: number, body: Uint8Array): Uint8Array { return concat(Uint8Array.of(type, body.length >> 8, body.length & 255), body); }
function u16(value: number): Uint8Array { return Uint8Array.of(value >> 8, value & 255); }
function u24(value: number): Uint8Array { return Uint8Array.of(value >> 16, value >> 8, value); }
function packBits(fields: Array<[bigint, number]>): Uint8Array {
  const bitLength = fields.reduce((sum, [, width]) => sum + width, 0);
  const result = new Uint8Array(Math.ceil(bitLength / 8)); let bit = 0;
  for (const [value, width] of fields) for (let shift = width - 1; shift >= 0; shift--, bit++) {
    if ((value >> BigInt(shift)) & 1n) { const at = bit >> 3; result[at] = result[at]! | (1 << (7 - (bit & 7))); }
  }
  return result;
}
function concat(...parts: Uint8Array[]): Uint8Array { const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0)); let pos = 0; for (const part of parts) { out.set(part, pos); pos += part.length; } return out; }
function withMpegCrc(section: Uint8Array): Uint8Array { let crc = 0xffffffff; for (const byte of section) { crc ^= byte << 24; for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1; } crc >>>= 0; return concat(section, Uint8Array.of(crc >>> 24, crc >>> 16, crc >>> 8, crc)); }
