import { encodeTimestampForFixture } from "@bdmv2web/igs";

export const PGS_PID = 0x1200;
export const PAT_PID = 0x0000;
export const PMT_PID = 0x0100;

export interface PmtEntry { pid: number; type: number }

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** One BDAV packet: 4-byte TP_extra_header plus a TS packet carrying up to 184 payload bytes. */
function m2tsPacket(pid: number, payload: Uint8Array, options: { cc?: number; pusi?: boolean } = {}): Uint8Array {
  if (payload.length > 184) throw new RangeError("synthetic TS payload exceeds 184 bytes");
  const frame = new Uint8Array(192);
  const ts = frame.subarray(4);
  ts.fill(0xff);
  ts[0] = 0x47;
  ts[1] = ((options.pusi ? 0x40 : 0) | (pid >> 8)) & 0x7f;
  ts[2] = pid & 255;
  ts[3] = 0x10 | (options.cc ?? 0);
  ts.set(payload, 4);
  return frame;
}

function withMpegCrc(section: Uint8Array): Uint8Array {
  let crc = 0xffffffff;
  for (const byte of section) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    crc >>>= 0;
  }
  return concat(section, Uint8Array.of(crc >>> 24, crc >>> 16, crc >>> 8, crc));
}

export function patPacket(cc = 0): Uint8Array {
  const section = withMpegCrc(Uint8Array.of(0x00, 0xb0, 0x0d, 0, 1, 0xc1, 0, 0, 0, 1, (PMT_PID >> 8) | 0xe0, PMT_PID & 255));
  return m2tsPacket(PAT_PID, concat(Uint8Array.of(0), section), { cc, pusi: true });
}

export function pmtPacket(entries: PmtEntry[], cc = 0): Uint8Array {
  const loop = entries.flatMap((entry) => [entry.type, 0xe0 | (entry.pid >> 8), entry.pid & 255, 0xf0, 0]);
  // section_length covers everything after its own field, CRC included.
  const sectionLength = 13 + loop.length;
  const first = entries[0]!.pid;
  const section = withMpegCrc(Uint8Array.of(0x02, 0xb0 | (sectionLength >> 8), sectionLength & 255, 0, 1, 0xc1, 0, 0, 0xe0 | (first >> 8), first & 255, 0xf0, 0, ...loop));
  return m2tsPacket(PMT_PID, concat(Uint8Array.of(0), section), { cc, pusi: true });
}

function pesPacket(payload: Uint8Array, pts: bigint): Uint8Array {
  const length = 8 + payload.length;
  const packet = new Uint8Array(14 + payload.length);
  packet.set([0, 0, 1, 0xbd, length >> 8, length & 255, 0x80, 0x80, 5], 0);
  packet.set(encodeTimestampForFixture(pts), 9);
  packet.set(payload, 14);
  return packet;
}

function segment(type: number, body: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(type, body.length >> 8, body.length & 255), body);
}

/**
 * One minimal PGS display set: an opaque 4x2 white object placed near the canvas bottom.
 *
 * PCS payload: width, height, frame rate, composition number, state, palette
 * update flag, palette id, object count, then 8 bytes per placement
 * (object id, window id, flags, x, y).
 */
export function pgsDisplaySetSegments(options: { number?: number; objectId?: number; placementY?: number; canvasWidth?: number; canvasHeight?: number } = {}): Uint8Array {
  const objectId = options.objectId ?? 1;
  const number = options.number ?? 1;
  const width = options.canvasWidth ?? 1920;
  const height = options.canvasHeight ?? 1080;
  const placementY = options.placementY ?? 1000;
  const pds = Uint8Array.of(0, 0, 1, 235, 128, 128, 255);
  // Four-pixel row: one long run of palette entry 1, then an end-of-line code.
  const row = Uint8Array.of(0x00, 0x84, 0x01, 0x00, 0x00);
  const rle = concat(row, row);
  const objectLength = 4 + rle.length;
  const ods = concat(Uint8Array.of(objectId >> 8, objectId & 255, 0, 0xc0, objectLength >> 16, objectLength >> 8, objectLength, 0, 4, 0, 2), rle);
  const composition = Uint8Array.of(
    width >> 8, width & 255, height >> 8, height & 255, 0x10, number >> 8, number & 255, 0x80, 0, 0, 1,
    objectId >> 8, objectId & 255, 0, 0, 0, 0, placementY >> 8, placementY & 255,
  );
  return concat(segment(0x14, pds), segment(0x15, ods), segment(0x16, composition), segment(0x80, new Uint8Array()));
}

export interface SyntheticPgsStreamOptions {
  displaySets?: number;
  firstPts?: bigint;
  pgsPid?: number;
  pmtEntries?: PmtEntry[];
  trailerJunk?: boolean;
}

/**
 * A synthetic BDAV m2ts byte stream: PAT, PMT, and one PES per PGS display set.
 * The defaults declare a single PGS PID; `pmtEntries` replaces the PMT content
 * (for example a video-only or reserved-PID declaration) and `trailerJunk`
 * appends bytes that no longer carry the 192-byte packet framing.
 */
export function syntheticPgsStream(options: SyntheticPgsStreamOptions = {}): Uint8Array {
  const pgsPid = options.pgsPid ?? PGS_PID;
  const entries = options.pmtEntries ?? [{ pid: pgsPid, type: 0x90 }];
  const packets: Uint8Array[] = [patPacket(), pmtPacket(entries)];
  const firstPts = options.firstPts ?? 1_000_000n;
  for (let index = 0; index < (options.displaySets ?? 2); index++) {
    const payload = pesPacket(pgsDisplaySetSegments({ number: index + 1 }), firstPts + BigInt(index) * 90_000n);
    packets.push(m2tsPacket(pgsPid, payload, { cc: index & 15, pusi: true }));
  }
  if (options.trailerJunk) packets.push(new Uint8Array(384).fill(0x55));
  return concat(...packets);
}

/** Bytes that never carry the 192-byte m2ts framing. */
export function syntheticNonStreamBytes(): Uint8Array {
  return new Uint8Array(1024).fill(0x55);
}
