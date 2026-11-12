import { describe, expect, it } from "vitest";
import { bytesToHex, concatByteChunks, concatBytes, equalBytes, readU16BE, readU24BE, readU32BE } from "./bytes.js";

describe("byte utilities", () => {
  it("compares and concatenates byte arrays", () => {
    const first = Uint8Array.of(1, 2);
    expect(equalBytes(first, Uint8Array.of(1, 2))).toBe(true);
    expect(equalBytes(first, Uint8Array.of(1, 3))).toBe(false);
    expect(equalBytes(first, Uint8Array.of(1))).toBe(false);
    expect(concatBytes(first, Uint8Array.of(3))).toEqual(Uint8Array.of(1, 2, 3));
    expect(concatByteChunks([first, Uint8Array.of(3)], 3)).toEqual(Uint8Array.of(1, 2, 3));
    expect(concatByteChunks([first, Uint8Array.of(3)])).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("reads unsigned big-endian values at an offset", () => {
    const bytes = Uint8Array.of(0, 0x80, 0xab, 0xcd, 0xef);
    expect(readU16BE(bytes, 1)).toBe(0x80ab);
    expect(readU24BE(bytes, 1)).toBe(0x80abcd);
    expect(readU32BE(bytes, 1)).toBe(0x80abcdef);
  });

  it("formats bytes as two-digit lowercase hexadecimal", () => {
    expect(bytesToHex(Uint8Array.of(0, 10, 255))).toBe("000aff");
  });
});
