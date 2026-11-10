import { describe, expect, it } from "vitest";
import { assertPngLevel, DEFAULT_ASSET_PNG_LEVEL, DEFAULT_CANVAS_PNG_LEVEL, encodeIndexedPng, encodeRgbaPng, paletteRgbaTable } from "../src/png.js";
import { decodePng } from "../tests/helpers/decode-png.js";

/** A palette whose entries are easy to recognise once decoded. */
const palette = { id: 0, version: 0, entries: new Map([[0, { y: 16, cr: 128, cb: 128, alpha: 0 }], [1, { y: 235, cr: 128, cb: 128, alpha: 255 }], [7, { y: 81, cr: 240, cb: 90, alpha: 128 }]]) } as never;

describe("PNG encoders", () => {
  it("writes an indexed file that decodes to the palette's own colours", () => {
    const table = paletteRgbaTable(palette);
    const indices = Uint8Array.from([0, 1, 7, 1, 0, 7]);
    const png = encodeIndexedPng(3, 2, indices, table);
    // IHDR colour type 3, then PLTE and tRNS before IDAT: the palette carries the alpha.
    expect(png[25]).toBe(3);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe("PLTE");
    const { width, height, rgba } = decodePng(png);
    expect([width, height]).toEqual([3, 2]);
    for (let index = 0; index < indices.length; index++) {
      const from = indices[index]! * 4;
      expect([...rgba.subarray(index * 4, index * 4 + 4)]).toEqual([...table.subarray(from, from + 4)]);
    }
  });

  it("keeps the tuned levels distinct per shape", () => {
    expect(DEFAULT_ASSET_PNG_LEVEL).toBe(3);
    expect(DEFAULT_CANVAS_PNG_LEVEL).toBe(6);
  });

  it("rejects levels zlib would clamp instead of guessing", () => {
    for (const level of [-1, 10, 1.5, Number.NaN]) expect(() => assertPngLevel(level)).toThrow(RangeError);
    expect(assertPngLevel(0)).toBe(0);
    expect(assertPngLevel(9)).toBe(9);
  });

  it("encodes the same pixels at every level, with level 0 larger than level 9", () => {
    const rgba = new Uint8Array(64 * 64 * 4);
    for (let index = 0; index < rgba.length; index += 4) { rgba[index] = index & 255; rgba[index + 3] = 255; }
    const stored = encodeRgbaPng(64, 64, rgba, { level: 0 });
    const packed = encodeRgbaPng(64, 64, rgba, { level: 9 });
    expect(packed.length).toBeLessThan(stored.length);
    expect([...decodePng(stored).rgba]).toEqual([...decodePng(packed).rgba]);
  });

  it("refuses an indexed palette that is not a full 256-entry table", () => {
    expect(() => encodeIndexedPng(1, 1, Uint8Array.of(0), new Uint8Array(4))).toThrow(RangeError);
    expect(() => encodeIndexedPng(2, 2, Uint8Array.of(0), new Uint8Array(256 * 4))).toThrow(RangeError);
  });
});
