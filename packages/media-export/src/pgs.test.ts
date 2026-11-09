import { describe, expect, it } from "vitest";
import { parsePgsSup, PgsSubtitleTimeline, streamPgsSup } from "./pgs.js";

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

  it("reuses a decoded bitmap across display sets but not after the object is redefined", () => {
    const palette = segment(1, 0x14, [0, 0, 1, 235, 128, 128, 255, 2, 81, 128, 128, 255]);
    // RLE: two opaque pixels of index 1, end of line, two transparent pixels, end of line.
    const firstObject = segment(1, 0x15, [0, 7, 0, 0xc0, 0, 0, 13, 0, 2, 0, 2, 0, 0x82, 1, 0, 0, 0, 0x02, 0, 0]);
    const secondObject = segment(2, 0x15, [0, 7, 0, 0xc0, 0, 0, 13, 0, 2, 0, 2, 0, 0x82, 2, 0, 0, 0, 0x02, 0, 0]);
    const composition = (pts: number) => segment(pts, 0x16, [0, 2, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0, 0, 0, 0, 0]);
    const sets = parsePgsSup(join(
      palette, firstObject, composition(1), segment(1, 0x80, []),
      composition(2), segment(2, 0x80, []),
      secondObject, composition(3), segment(3, 0x80, []),
      composition(4), segment(4, 0x80, []),
    ));
    expect(sets).toHaveLength(4);
    expect([...sets[0]!.bitmaps.get(7)!.pixels]).toEqual([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Same palette and object data: the repeated display set shares the first bitmap.
    expect(sets[1]!.bitmaps.get(7)).toBe(sets[0]!.bitmaps.get(7));
    // A redefined ODS keeps the object ID but must decode to the new colour.
    expect([...sets[2]!.bitmaps.get(7)!.pixels]).toEqual([76, 76, 76, 255, 76, 76, 76, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sets[2]!.bitmaps.get(7)).not.toBe(sets[1]!.bitmaps.get(7));
    expect(sets[3]!.bitmaps.get(7)).toBe(sets[2]!.bitmaps.get(7));
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

  it("streams the same display sets one at a time", () => {
    const palette = segment(1, 0x14, [0, 0, 1, 235, 128, 128, 255, 2, 81, 128, 128, 255]);
    const object = segment(1, 0x15, [0, 7, 0, 0xc0, 0, 0, 13, 0, 2, 0, 2, 0, 0x82, 1, 0, 0, 0, 0x02, 0, 0]);
    const composition = (pts: number) => segment(pts, 0x16, [0, 2, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 7, 0, 0, 0, 0, 0, 0]);
    const stream = join(palette, object, composition(1), segment(1, 0x80, []), composition(2), segment(2, 0x80, []), composition(3), segment(3, 0x80, []));
    const parsed = parsePgsSup(stream);
    const streamed = [...streamPgsSup(stream)];
    expect(streamed.map((set) => set.pts90k)).toEqual(parsed.map((set) => set.pts90k));
    // A streaming caller gets the same decoded pixels, but no bitmap is shared with a
    // later set, so dropping a set releases its RGBA.
    expect([...streamed[2]!.bitmaps.get(7)!.pixels]).toEqual([...parsed[2]!.bitmaps.get(7)!.pixels]);
    expect(streamed[2]!.bitmaps.get(7)).not.toBe(streamed[1]!.bitmaps.get(7));
    expect(parsed[2]!.bitmaps.get(7)).toBe(parsed[0]!.bitmaps.get(7));
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
