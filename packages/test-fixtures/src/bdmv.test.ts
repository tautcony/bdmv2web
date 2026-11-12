import { describe, expect, it } from "vitest";
import { buildM1EmptyPlaylist, buildM1Index, buildM1MovieObject } from "./bdmv.js";

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe("BDMV binary fixture builders", () => {
  it("writes index entry addresses, targets and UHD extension fields at their declared offsets", () => {
    const bytes = buildM1Index({ version: "0200", first: 5, top: 9, hdmvTitle: 12, bdjTitle: "00042", titleAccess: 2,
      appInfo: { initialOutputMode: true, contentExist: true, initialDynamicRangeType: 3, videoFormat: 6, frameRate: 4 },
      uhd: { discType: 2, exists4k: true, hdr10Plus: true, dolbyVision: true, hdrFlags: 3 } });
    const data = view(bytes);
    expect(text(bytes.subarray(0, 8))).toBe("INDX0200");
    expect(data.getUint32(8)).toBe(88);
    expect(data.getUint32(12)).toBe(142);
    expect([...bytes.subarray(44, 46)]).toEqual([0x63, 0x64]);
    expect(data.getUint16(98)).toBe(5);
    expect(data.getUint16(110)).toBe(9);
    expect(data.getUint16(116)).toBe(2);
    expect(data.getUint16(124)).toBe(12);
    expect(bytes[130]).toBe(0xa0);
    expect(text(bytes.subarray(136, 141))).toBe("00042");
    expect(data.getUint32(142)).toBe(32);
    expect([...bytes.subarray(170, 173)]).toEqual([0x21, 0, 0x17]);
  });

  it("writes the supplied MovieObject instructions in order and records their count", () => {
    const first = Uint8Array.from({ length: 12 }, (_, index) => index);
    const second = Uint8Array.from({ length: 12 }, (_, index) => 0xf0 + index);
    const bytes = buildM1MovieObject([first, second]);
    expect(text(bytes.subarray(0, 8))).toBe("MOBJ0100");
    expect(view(bytes).getUint32(40)).toBe(34);
    expect(view(bytes).getUint16(48)).toBe(1);
    expect(view(bytes).getUint16(52)).toBe(2);
    expect(bytes.subarray(54, 66)).toEqual(first);
    expect(bytes.subarray(66, 78)).toEqual(second);
  });

  it("writes an empty playlist with explicit section addresses and zero counts", () => {
    const bytes = buildM1EmptyPlaylist("0300");
    const data = view(bytes);
    expect(text(bytes.subarray(0, 8))).toBe("MPLS0300");
    expect([data.getUint32(8), data.getUint32(12), data.getUint32(16)]).toEqual([80, 90, 0]);
    expect([data.getUint32(80), data.getUint16(86), data.getUint16(88)]).toEqual([6, 0, 0]);
    expect([data.getUint32(90), data.getUint16(94)]).toEqual([2, 0]);
  });
});
