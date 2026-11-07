import { describe, expect, it } from "vitest";
import { parsePgsSup, PgsSubtitleTimeline } from "./pgs.js";

describe("PGS SUP parsing", () => {
  it("assembles palette, fragmented object, PCS placement, pixels and 90 kHz timeline", () => {
    const first = segment(90_000, 0x15, [0, 7, 0, 0x80, 0, 0, 14, 0, 2, 0, 2, 1, 0, 1, 0, 0]);
    const continuation = segment(90_000, 0x15, [0, 7, 0, 0x40, 0, 1, 2, 0, 0]);
    const display = parsePgsSup(join(
      segment(90_000, 0x14, [0, 0, 1, 235, 128, 128, 255, 2, 81, 128, 128, 255]),
      first,
      continuation,
      segment(90_000, 0x16, [0, 4, 0, 3, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0, 0, 1, 0, 2]),
      segment(90_000, 0x80, []),
    ));
    expect(display).toHaveLength(1);
    expect(display[0]).toMatchObject({ pts90k: 90_000, width: 4, height: 3, paletteId: 0, placements: [{ objectId: 7, x: 1, y: 2 }] });
    expect([...display[0]!.bitmaps.get(7)!.pixels]).toEqual([
      255, 255, 255, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 76, 76, 76, 255,
    ]);
    const timeline = new PgsSubtitleTimeline();
    timeline.register("eng-pgs", display);
    timeline.select("eng-pgs");
    expect(timeline.at(89_999)).toBeNull();
    expect(timeline.at(90_000)).toBe(display[0]);
    timeline.setEnabled(false);
    expect(timeline.at(90_000)).toBeNull();
    timeline.setEnabled(true);
    timeline.select(null);
    expect(timeline.at(90_000)).toBeNull();
  });

  it("treats an empty PCS as a clearing display set for subsequent seeks", () => {
    const sets = parsePgsSup(join(
      segment(10, 0x16, [0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0, 0, 0, 0, 0]),
      segment(10, 0x80, []),
      segment(20, 0x16, [0, 1, 0, 1, 0, 2, 0, 0, 0, 0, 0]),
      segment(20, 0x80, []),
    ));
    const timeline = new PgsSubtitleTimeline(); timeline.register("track", sets); timeline.select("track");
    expect(timeline.at(10)).toBe(sets[0]);
    expect(timeline.at(20)).toBeNull();
    expect(timeline.at(19)).toBe(sets[0]);
  });

  it("extends 32-bit SUP PTS across the 90 kHz wrap point", () => {
    const sets = parsePgsSup(join(
      segment(0xfffffff0, 0x16, [0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0, 0, 0, 0, 0]),
      segment(0xfffffff0, 0x80, []),
      segment(0x10, 0x16, [0, 1, 0, 1, 0, 2, 0, 0, 0, 0, 0]),
      segment(0x10, 0x80, []),
    ));
    expect(sets.map((set) => set.pts90k)).toEqual([0xfffffff0, 0x1_0000_0010]);
    const timeline = new PgsSubtitleTimeline(); timeline.register("wrap", sets); timeline.select("wrap");
    expect(timeline.at(0xfffffff0)).toBe(sets[0]);
    expect(timeline.at(0x1_0000_0010)).toBeNull();
  });

  it("reads the PCS crop flag and crop rectangle", () => {
    const sets = parsePgsSup(join(
      segment(1, 0x16, [0, 4, 0, 3, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0x40, 0, 1, 0, 2, 0, 0, 0, 0, 0, 1, 0, 2]),
      segment(1, 0x80, []),
    ));
    expect(sets[0]?.placements).toEqual([{ objectId: 7, windowId: 0, x: 1, y: 2, crop: { x: 0, y: 0, width: 1, height: 2 } }]);
  });

  it("rejects truncated segments and malformed or out-of-bounds RLE", () => {
    expect(() => parsePgsSup(new Uint8Array([0x50, 0x47]))).toThrow(/Invalid or truncated/);
    const badObject = segment(1, 0x15, [0, 7, 0, 0xc0, 0, 0, 6, 0, 1, 0, 1, 0x82, 2]);
    const input = join(badObject, segment(1, 0x16, [0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0, 0, 0, 0, 0]), segment(1, 0x80, []));
    expect(() => parsePgsSup(input)).toThrow(/RLE run exceeds bitmap bounds/);
  });

  it("bounds decoded RGBA allocation and rejects trailing RLE bytes", () => {
    const rle = [1, 0, 1, 0, 0, 0, 1, 2, 0, 0];
    const object = segment(1, 0x15, [0, 7, 0, 0xc0, 0, 0, 14, 0, 2, 0, 2, ...rle]);
    const composition = segment(1, 0x16, [0, 2, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0, 0, 0, 0, 0]);
    const trailing = join(object, composition, segment(1, 0x80, []));
    expect(() => parsePgsSup(trailing, { maxObjectBytes: 10 })).toThrow(/decoded bitmap exceeds configured byte limit/);

    const extraData = segment(2, 0x15, [0, 7, 0, 0xc0, 0, 0, 15, 0, 2, 0, 2, ...rle, 0]);
    expect(() => parsePgsSup(join(extraData, composition, segment(2, 0x80, [])))).toThrow(/trailing RLE data/);
  });
});

function segment(pts: number, type: number, payload: number[]): Uint8Array {
  const data = new Uint8Array(13 + payload.length);
  data.set([0x50, 0x47, pts >>> 24, pts >>> 16, pts >>> 8, pts, 0, 0, 0, 0, type, payload.length >>> 8, payload.length], 0);
  data.set(payload, 13);
  return data;
}
function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
