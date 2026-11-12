import { concatByteChunks, equalBytes as sameBytes, readU16BE as u16, readU24BE as u24, readU32BE as u32 } from "@bdmv2web/utils";

/** Common Presentation Graphics (PGS) SUP stream parsing primitives. */
export type PgsRgba = readonly [red: number, green: number, blue: number, alpha: number];

export interface PgsBitmap {
  objectId: number;
  width: number;
  height: number;
  /** Row-major, straight-alpha RGBA pixels; decoded from the RLE data on first access. */
  pixels: Uint8Array;
}

export interface PgsPlacement {
  objectId: number;
  windowId: number;
  x: number;
  y: number;
  crop?: { x: number; y: number; width: number; height: number };
}

export interface PgsDisplaySet {
  /** 90 kHz PTS from the SUP PCS packet, extended across 32-bit wrap within the stream. */
  pts90k: number;
  width: number;
  height: number;
  compositionNumber: number;
  compositionState: number;
  paletteId: number;
  palette: ReadonlyMap<number, PgsRgba>;
  bitmaps: ReadonlyMap<number, PgsBitmap>;
  placements: readonly PgsPlacement[];
}

export interface PgsParseOptions {
  /** Bounds untrusted input allocations. Defaults to 16K x 16K and 64 MiB per object. */
  maxDimension?: number;
  maxObjectBytes?: number;
}

interface Segment { pts: number; type: number; payload: Uint8Array; }
interface ObjectData { width: number; height: number; encoded: Uint8Array; }
interface Composition { pts: number; width: number; height: number; number: number; state: number; paletteId: number; placements: PgsPlacement[]; }

const MAX_DIMENSION = 16_384;
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;
const TRANSPARENT: PgsRgba = [0, 0, 0, 0];
const SEGMENT = { PDS: 0x14, ODS: 0x15, PCS: 0x16, END: 0x80 } as const;
const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

/**
 * Parse a Blu-ray SUP byte stream into complete PGS display sets. Repeated identical
 * palette definitions share one map, and each bitmap stays RLE-encoded until its
 * `pixels` are read, so a metadata caller never holds every RGBA bitmap at once.
 */
export function parsePgsSup(data: Uint8Array, options: PgsParseOptions = {}): PgsDisplaySet[] {
  return [...readDisplaySets(data, parseLimits(options), true)];
}

/**
 * The same decode as `parsePgsSup`, one display set at a time. A 5 MB SUP decodes
 * into 53 MB of RGBA, so a caller that renders and drops each set keeps one bitmap
 * set alive instead of the whole stream. The cross-set bitmap cache is dropped:
 * a set is only decoded from object data that the stream has already delivered.
 */
export function* streamPgsSup(data: Uint8Array, options: PgsParseOptions = {}): Generator<PgsDisplaySet> {
  yield* readDisplaySets(data, parseLimits(options), false);
}

function parseLimits(options: PgsParseOptions): { maxDimension: number; maxObjectBytes: number } {
  const maxDimension = options.maxDimension ?? MAX_DIMENSION;
  const maxObjectBytes = options.maxObjectBytes ?? MAX_OBJECT_BYTES;
  if (!Number.isSafeInteger(maxDimension) || maxDimension <= 0 || !Number.isSafeInteger(maxObjectBytes) || maxObjectBytes <= 0) throw new RangeError("PGS allocation limits must be positive safe integers.");
  return { maxDimension, maxObjectBytes };
}

function* readDisplaySets(data: Uint8Array, limits: { maxDimension: number; maxObjectBytes: number }, retainBitmaps: boolean): Generator<PgsDisplaySet> {
  const { maxDimension, maxObjectBytes } = limits;
  const segments = readSegments(data);
  const palettes = new Map<number, Map<number, PgsRgba>>();
  const paletteBytes = new Map<number, Uint8Array>();
  const objects = new Map<number, ObjectData>();
  const decodedByPalette = retainBitmaps ? new WeakMap<Map<number, PgsRgba>, Map<number, { source: ObjectData; bitmap: PgsBitmap }>>() : null;
  const cacheFor = (palette: Map<number, PgsRgba>): Map<number, { source: ObjectData; bitmap: PgsBitmap }> => {
    if (!decodedByPalette) return new Map();
    let cache = decodedByPalette.get(palette);
    if (!cache) { cache = new Map(); decodedByPalette.set(palette, cache); }
    return cache;
  };
  const pending = new Map<number, { width: number; height: number; expected: number; chunks: Uint8Array[]; received: number }>();
  let scratch: Uint8Array = new Uint8Array(0);
  let composition: Composition | undefined;

  for (const segment of segments) {
    const p = segment.payload;
    switch (segment.type) {
      case SEGMENT.PDS: {
        if (p.length < 2 || (p.length - 2) % 5 !== 0) throw new TypeError("Malformed PGS palette definition segment.");
        const paletteId = p[0]!;
        const previous = paletteBytes.get(paletteId);
        if (previous && sameBytes(previous, p)) break;
        const colors = new Map<number, PgsRgba>();
        for (let i = 2; i < p.length; i += 5) colors.set(p[i]!, yCrCbToRgba(p[i + 1]!, p[i + 2]!, p[i + 3]!, p[i + 4]!));
        palettes.set(paletteId, colors);
        paletteBytes.set(paletteId, p);
        break;
      }
      case SEGMENT.ODS: {
        if (p.length < 4) throw new TypeError("Malformed PGS object definition segment.");
        const id = u16(p, 0); const sequence = p[3]!;
        const first = (sequence & 0x80) !== 0; const last = (sequence & 0x40) !== 0;
        if (first) {
          if (p.length < 11) throw new TypeError("Truncated first PGS object segment.");
          const dataLength = u24(p, 4);
          const width = u16(p, 7); const height = u16(p, 9);
          if (width <= 0 || height <= 0 || width > maxDimension || height > maxDimension) throw new RangeError(`PGS object ${id} dimensions exceed configured limits.`);
          const expected = dataLength - 4;
          if (expected < 0 || expected > maxObjectBytes) throw new RangeError(`PGS object ${id} data length is invalid or exceeds configured limit.`);
          const chunk = p.subarray(11);
          if (chunk.length > expected) throw new TypeError(`PGS object ${id} exceeds its declared data length.`);
          pending.set(id, { width, height, expected, chunks: [chunk], received: chunk.length });
        } else {
          const current = pending.get(id);
          if (!current) throw new TypeError(`PGS object ${id} continuation has no first segment.`);
          const chunk = p.subarray(4);
          current.received += chunk.length;
          if (current.received > current.expected) throw new TypeError(`PGS object ${id} exceeds its declared data length.`);
          current.chunks.push(chunk);
        }
        if (last) {
          const current = pending.get(id);
          if (!current || current.received !== current.expected) throw new TypeError(`PGS object ${id} ended before its declared data length was received.`);
          // Copy the object once: the display sets outlive the caller's input buffer,
          // and a fragmented object is joined only once.
          const encoded = current.chunks.length === 1 ? current.chunks[0]!.slice() : concatByteChunks(current.chunks, current.received);
          objects.set(id, { width: current.width, height: current.height, encoded });
          pending.delete(id);
        }
        break;
      }
      case SEGMENT.PCS:
        composition = parseComposition(segment, maxDimension);
        break;
      case SEGMENT.END: {
        if (!composition) break;
        const palette = palettes.get(composition.paletteId) ?? new Map<number, PgsRgba>();
        const decoded = cacheFor(palette);
        const used = new Map<number, PgsBitmap>();
        for (const placement of composition.placements) {
          const object = objects.get(placement.objectId);
          if (!object) continue;
          const cached = decoded.get(placement.objectId);
          if (cached && cached.source === object) { used.set(placement.objectId, cached.bitmap); continue; }
          scratch = decodeIndices(placement.objectId, object, maxObjectBytes, scratch);
          const bitmap = lazyBitmap(placement.objectId, object, maxObjectBytes, palette);
          decoded.set(placement.objectId, { source: object, bitmap });
          used.set(placement.objectId, bitmap);
        }
        yield { pts90k: composition.pts, width: composition.width, height: composition.height, compositionNumber: composition.number, compositionState: composition.state, paletteId: composition.paletteId, palette, bitmaps: used, placements: composition.placements.map((item) => ({ ...item, ...(item.crop ? { crop: { ...item.crop } } : {}) })) };
        composition = undefined;
        break;
      }
      default: break;
    }
  }
  if (pending.size) throw new TypeError("PGS stream ended with incomplete fragmented object data.");
}

/** Select/off and seek over parsed display sets without conflating PG with IG state. */
export class PgsSubtitleTimeline {
  private selected = new Map<string, readonly PgsDisplaySet[]>();
  private activeId: string | null = null;
  private enabled = true;

  register(trackId: string, displaySets: readonly PgsDisplaySet[]): void {
    if (!trackId.trim()) throw new TypeError("PGS trackId is required.");
    this.selected.set(trackId, [...displaySets].sort((a, b) => a.pts90k - b.pts90k));
  }
  select(trackId: string | null): void {
    if (trackId !== null && !this.selected.has(trackId)) throw new RangeError(`Unknown PGS track '${trackId}'.`);
    this.activeId = trackId;
  }
  setEnabled(enabled: boolean): void { this.enabled = enabled; }
  at(time90k: number): PgsDisplaySet | null {
    if (!Number.isSafeInteger(time90k) || time90k < 0) throw new RangeError("PGS lookup time must be a non-negative safe integer.");
    if (!this.enabled || this.activeId === null) return null;
    const sets = this.selected.get(this.activeId)!;
    let found: PgsDisplaySet | null = null;
    for (const set of sets) {
      if (set.pts90k > time90k) break;
      found = set;
    }
    return found?.placements.length ? found : null;
  }
}

function readSegments(data: Uint8Array): Segment[] {
  const segments: Segment[] = [];
  let offset = 0;
  let previousRawPts: number | undefined;
  let epoch = 0n;
  while (offset < data.length) {
    if (offset + 13 > data.length || data[offset] !== 0x50 || data[offset + 1] !== 0x47) throw new TypeError(`Invalid or truncated PGS SUP segment at byte ${offset}.`);
    const rawPts = u32(data, offset + 2);
    if (previousRawPts !== undefined && previousRawPts - rawPts > 0x80000000) epoch += 0x1_0000_0000n;
    previousRawPts = rawPts;
    const pts = Number(epoch + BigInt(rawPts)); const type = data[offset + 10]!; const length = u16(data, offset + 11);
    const start = offset + 13; const end = start + length;
    if (end > data.length) throw new TypeError(`Truncated PGS segment payload at byte ${offset}.`);
    segments.push({ pts, type, payload: data.subarray(start, end) });
    offset = end;
  }
  return segments;
}

function parseComposition(segment: Segment, maxDimension: number): Composition {
  const p = segment.payload;
  if (p.length < 11) throw new TypeError("Malformed PGS presentation composition segment.");
  const width = u16(p, 0); const height = u16(p, 2); const number = u16(p, 5); const state = p[7]! & 0xc0; const paletteId = p[9]!; const count = p[10]!;
  if (width <= 0 || height <= 0 || width > maxDimension || height > maxDimension) throw new RangeError("PGS composition dimensions exceed configured limits.");
  const placements: PgsPlacement[] = []; let offset = 11;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > p.length) throw new TypeError("Truncated PGS composition object entry.");
    const objectId = u16(p, offset); const windowId = p[offset + 2]!; const cropped = (p[offset + 3]! & 0x40) !== 0; const x = u16(p, offset + 4); const y = u16(p, offset + 6); offset += 8;
    let crop: PgsPlacement["crop"];
    if (cropped) {
      if (offset + 8 > p.length) throw new TypeError("Truncated PGS object crop rectangle.");
      crop = { x: u16(p, offset), y: u16(p, offset + 2), width: u16(p, offset + 4), height: u16(p, offset + 6) }; offset += 8;
    }
    placements.push({ objectId, windowId, x, y, ...(crop ? { crop } : {}) });
  }
  if (offset !== p.length) throw new TypeError("Unexpected trailing bytes in PGS composition segment.");
  return { pts: segment.pts, width, height, number, state, paletteId, placements };
}

function decodeIndices(id: number, object: ObjectData, maxObjectBytes: number, target?: Uint8Array): Uint8Array {
  const pixelBytes = object.width * object.height * 4;
  if (!Number.isSafeInteger(pixelBytes) || pixelBytes > maxObjectBytes) throw new RangeError(`PGS object ${id} decoded bitmap exceeds configured byte limit.`);
  const pixelCount = object.width * object.height;
  const indices = target !== undefined && target.length >= pixelCount ? target.subarray(0, pixelCount) : new Uint8Array(pixelCount);
  let x = 0; let y = 0; let offset = 0;
  while (offset < object.encoded.length && y < object.height) {
    const value = object.encoded[offset++]!;
    if (value !== 0) { put(value, 1); continue; }
    if (offset >= object.encoded.length) throw new TypeError(`PGS object ${id} has a truncated RLE escape.`);
    const code = object.encoded[offset++]!;
    if (code === 0) { x = 0; y++; continue; }
    let run = code & 0x3f;
    if ((code & 0x40) !== 0) {
      if (offset >= object.encoded.length) throw new TypeError(`PGS object ${id} has a truncated long RLE run.`);
      run = (run << 8) | object.encoded[offset++]!;
    }
    const color = (code & 0x80) !== 0 ? takeColor() : 0;
    if (run === 0) throw new TypeError(`PGS object ${id} has a zero-length RLE run.`);
    put(color, run);
  }
  if (y !== object.height || x !== 0) throw new TypeError(`PGS object ${id} RLE data does not fill its declared dimensions.`);
  if (offset !== object.encoded.length) throw new TypeError(`PGS object ${id} contains trailing RLE data.`);
  return indices;

  function takeColor(): number { if (offset >= object.encoded.length) throw new TypeError(`PGS object ${id} has a truncated RLE color run.`); return object.encoded[offset++]!; }
  function put(index: number, count: number): void {
    if (y >= object.height || x + count > object.width) throw new TypeError(`PGS object ${id} RLE run exceeds bitmap bounds.`);
    const start = y * object.width + x;
    // `fill` costs more than a store loop for the short runs that anti-aliased
    // subtitles produce; it only pays off for long solid runs.
    if (count >= 16) indices.fill(index, start, start + count);
    else for (let n = 0; n < count; n++) indices[start + n] = index;
    x += count;
  }
}

function lazyBitmap(objectId: number, object: ObjectData, maxObjectBytes: number, palette: ReadonlyMap<number, PgsRgba>): PgsBitmap {
  const { width, height } = object;
  let encoded: ObjectData | null = object;
  let pixels: Uint8Array | null = null;
  return {
    objectId, width, height,
    get pixels(): Uint8Array {
      if (pixels) return pixels;
      const indices = decodeIndices(objectId, encoded!, maxObjectBytes);
      const output = new Uint8Array(width * height * 4);
      const words = LITTLE_ENDIAN ? new Uint32Array(output.buffer) : null;
      if (words) {
        const packed = packPalette(palette);
        for (let i = 0; i < indices.length; i++) words[i] = packed[indices[i]!]!;
      } else for (let i = 0; i < indices.length; i++) output.set(palette.get(indices[i]!) ?? TRANSPARENT, i * 4);
      encoded = null;
      pixels = output;
      return output;
    },
  };
}

function packPalette(palette: ReadonlyMap<number, PgsRgba>): Uint32Array {
  const packed = new Uint32Array(256);
  for (const [index, rgba] of palette) if (index >= 0 && index < 256) packed[index] = (rgba[0] | (rgba[1] << 8) | (rgba[2] << 16) | (rgba[3] << 24)) >>> 0;
  return packed;
}

function yCrCbToRgba(y: number, cr: number, cb: number, alpha: number): PgsRgba {
  const yy = Math.max(0, y - 16); const u = cb - 128; const v = cr - 128;
  return [clamp(Math.round(1.164 * yy + 1.596 * v)), clamp(Math.round(1.164 * yy - 0.813 * v - 0.391 * u)), clamp(Math.round(1.164 * yy + 2.018 * u)), alpha];
}
function clamp(value: number): number { return Math.max(0, Math.min(255, value)); }
