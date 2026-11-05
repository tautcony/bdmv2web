/** Common Presentation Graphics (PGS) SUP stream parsing primitives. */
export type PgsRgba = readonly [red: number, green: number, blue: number, alpha: number];

export interface PgsBitmap {
  objectId: number;
  width: number;
  height: number;
  /** Row-major, straight-alpha RGBA pixels. */
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

/** Parse a Blu-ray SUP byte stream into complete PGS display sets. */
export function parsePgsSup(data: Uint8Array, options: PgsParseOptions = {}): PgsDisplaySet[] {
  const maxDimension = options.maxDimension ?? MAX_DIMENSION;
  const maxObjectBytes = options.maxObjectBytes ?? MAX_OBJECT_BYTES;
  if (!Number.isSafeInteger(maxDimension) || maxDimension <= 0 || !Number.isSafeInteger(maxObjectBytes) || maxObjectBytes <= 0) throw new RangeError("PGS allocation limits must be positive safe integers.");
  const segments = readSegments(data);
  const palettes = new Map<number, Map<number, PgsRgba>>();
  const objects = new Map<number, ObjectData>();
  const pending = new Map<number, { width: number; height: number; expected: number; chunks: Uint8Array[]; received: number }>();
  const result: PgsDisplaySet[] = [];
  let composition: Composition | undefined;

  for (const segment of segments) {
    const p = segment.payload;
    switch (segment.type) {
      case 0x14: { // PDS
        if (p.length < 2 || (p.length - 2) % 5 !== 0) throw new TypeError("Malformed PGS palette definition segment.");
        const paletteId = p[0]!;
        const colors = new Map<number, PgsRgba>();
        for (let i = 2; i < p.length; i += 5) colors.set(p[i]!, yCrCbToRgba(p[i + 1]!, p[i + 2]!, p[i + 3]!, p[i + 4]!));
        palettes.set(paletteId, colors);
        break;
      }
      case 0x15: { // ODS
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
          pending.set(id, { width, height, expected, chunks: [chunk.slice()], received: chunk.length });
        } else {
          const current = pending.get(id);
          if (!current) throw new TypeError(`PGS object ${id} continuation has no first segment.`);
          const chunk = p.subarray(4);
          current.received += chunk.length;
          if (current.received > current.expected) throw new TypeError(`PGS object ${id} exceeds its declared data length.`);
          current.chunks.push(chunk.slice());
        }
        if (last) {
          const current = pending.get(id);
          if (!current || current.received !== current.expected) throw new TypeError(`PGS object ${id} ended before its declared data length was received.`);
          const encoded = concat(current.chunks, current.received);
          objects.set(id, { width: current.width, height: current.height, encoded });
          pending.delete(id);
        }
        break;
      }
      case 0x16: // PCS
        composition = parseComposition(segment, maxDimension);
        break;
      case 0x80: { // END completes the current display set
        if (!composition) break;
        const palette = palettes.get(composition.paletteId) ?? new Map<number, PgsRgba>();
        const used = new Map<number, PgsBitmap>();
        for (const placement of composition.placements) {
          const object = objects.get(placement.objectId);
          if (object) used.set(placement.objectId, decodeObject(placement.objectId, object, palette, maxObjectBytes));
        }
        result.push({ pts90k: composition.pts, width: composition.width, height: composition.height, compositionNumber: composition.number, compositionState: composition.state, paletteId: composition.paletteId, palette: new Map(palette), bitmaps: used, placements: composition.placements.map((item) => ({ ...item, ...(item.crop ? { crop: { ...item.crop } } : {}) })) });
        composition = undefined;
        break;
      }
      // Window definitions and unknown extension segments do not change the ordinary bitmap result.
      default: break;
    }
  }
  if (pending.size) throw new TypeError("PGS stream ended with incomplete fragmented object data.");
  return result;
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

function decodeObject(id: number, object: ObjectData, palette: ReadonlyMap<number, PgsRgba>, maxObjectBytes: number): PgsBitmap {
  const pixelBytes = object.width * object.height * 4;
  if (!Number.isSafeInteger(pixelBytes) || pixelBytes > maxObjectBytes) throw new RangeError(`PGS object ${id} decoded bitmap exceeds configured byte limit.`);
  const pixels = new Uint8Array(pixelBytes);
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
  return { objectId: id, width: object.width, height: object.height, pixels };

  function takeColor(): number { if (offset >= object.encoded.length) throw new TypeError(`PGS object ${id} has a truncated RLE color run.`); return object.encoded[offset++]!; }
  function put(index: number, count: number): void {
    if (y >= object.height || x + count > object.width) throw new TypeError(`PGS object ${id} RLE run exceeds bitmap bounds.`);
    const rgba = palette.get(index) ?? [0, 0, 0, 0];
    for (let n = 0; n < count; n++) pixels.set(rgba, (y * object.width + x + n) * 4);
    x += count;
  }
}

function yCrCbToRgba(y: number, cr: number, cb: number, alpha: number): PgsRgba {
  const yy = Math.max(0, y - 16); const u = cb - 128; const v = cr - 128;
  return [clamp(Math.round(1.164 * yy + 1.596 * v)), clamp(Math.round(1.164 * yy - 0.813 * v - 0.391 * u)), clamp(Math.round(1.164 * yy + 2.018 * u)), alpha];
}
function clamp(value: number): number { return Math.max(0, Math.min(255, value)); }
function u16(data: Uint8Array, offset: number): number { return (data[offset]! << 8) | data[offset + 1]!; }
function u24(data: Uint8Array, offset: number): number { return (data[offset]! << 16) | (data[offset + 1]! << 8) | data[offset + 2]!; }
function u32(data: Uint8Array, offset: number): number { return (data[offset]! * 0x1000000) + (data[offset + 1]! << 16) + (data[offset + 2]! << 8) + data[offset + 3]!; }
function concat(chunks: readonly Uint8Array[], length: number): Uint8Array { const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result; }
