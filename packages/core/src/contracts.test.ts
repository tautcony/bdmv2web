import { describe, expect, it } from "vitest";
import { allocateBoundedBytes, assertWithinLimit, BinaryCursor, checkedObjectPixels, ContractError, DEFAULT_LIMITS, DEFAULT_PLAYER_PROFILE, from45k, parseDiscIR, parseOffset, parseTime90k, serializeOffset, serializeTime90k, validateLimits } from "./index.js";

const source = { path: "BDMV/index.bdmv", origin: "primary", byteOffset: "0" } as const;
const valid = {
  schemaVersion: "1.0", sourceFingerprint: "a".repeat(64),
  entries: [{ id: "entry-0", navigation: { type: "HDMV", movieObjectId: 0 }, source }, { id: "entry-bdj", navigation: { type: "BDJ", bdjoId: "00001", status: "unsupported" }, source }],
  programs: [{ id: "program-0", title: "Title" }], menus: [{ id: "menu-0" }],
  playlists: [{ id: "playlist-0", programIds: ["program-0"], menuIds: ["menu-0"], duration90k: "9007199254740993" }],
  mediaAssets: [{ id: "asset-0", kind: "video", relativePath: "assets/电影 #1.mp4", mime: "video/mp4", byteLength: "3", sha256: "b".repeat(64), sources: [source] }],
  diagnostics: [],
};

describe("DiscIR schema and semantic checks", () => {
  it("accepts minimal HDMV and mixed BD-J entries", () => { expect(parseDiscIR(valid).entries).toHaveLength(2); });
  it("locates mixed navigation fields", () => {
    const bad = structuredClone(valid); (bad.entries[0]!.navigation as Record<string, unknown>).bdjoId = "x";
    expect(() => parseDiscIR(bad)).toThrow(ContractError);
  });
  it("reports duplicate IDs and dangling references after schema validation", () => {
    const duplicate = structuredClone(valid); duplicate.menus.push({ id: "program-0" });
    expect(() => parseDiscIR(duplicate)).toThrow(/DUPLICATE_ID/);
    const dangling = structuredClone(valid); dangling.playlists[0]!.programIds = ["missing"];
    expect(() => parseDiscIR(dangling)).toThrow(/DANGLING_REFERENCE/);
  });
  it("locates an unknown schema version", () => {
    expect(() => parseDiscIR({ ...valid, schemaVersion: "2.0" })).toThrow(/UNKNOWN_SCHEMA_VERSION/);
  });
});

describe("exact time and byte offsets", () => {
  it("preserves values beyond Number.MAX_SAFE_INTEGER through JSON", () => {
    let value = "9007199254740993";
    for (let i = 0; i < 5; i += 1) value = JSON.parse(JSON.stringify({ time90k: serializeTime90k(parseTime90k(value)) })).time90k;
    expect(value).toBe("9007199254740993");
    expect(from45k("4503599627370497")).toBe("9007199254740994");
    expect(parseOffset(serializeOffset(9007199254740993n))).toBe(9007199254740993n);
  });
  it.each(["-1", "1.0", "1e3", "01", "", " 1"]) ("rejects invalid absolute time %s", (value) => {
    expect(() => parseTime90k(value)).toThrow();
  });
  it("provides required bounded defaults and rejects disabled bounds", () => {
    expect(DEFAULT_LIMITS.maxReadWindowBytes).toBe(8 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxOutputBytes).toBeNull();
    expect(DEFAULT_PLAYER_PROFILE.menuLanguage).toBe("eng");
    expect(() => validateLimits({ maxReadWindowBytes: 0 })).toThrow(/INVALID_LIMIT/);
    expect(() => assertWithinLimit(DEFAULT_LIMITS.maxSegmentBytes + 1, "maxSegmentBytes")).toThrow(/LIMIT_EXCEEDED/);
    expect(() => assertWithinLimit(DEFAULT_LIMITS.maxObjectPixels + 1, "maxObjectPixels")).toThrow(/LIMIT_EXCEEDED/);
    expect(allocateBoundedBytes(4, "maxReadWindowBytes")).toHaveLength(4);
    expect(() => allocateBoundedBytes(DEFAULT_LIMITS.maxSegmentBytes + 1, "maxSegmentBytes")).toThrow(/LIMIT_EXCEEDED/);
    expect(() => checkedObjectPixels(4097, 4096)).toThrow(/LIMIT_EXCEEDED/);
  });
});

describe("BinaryCursor", () => {
  it("reads all integer byte orders and nested source offsets", () => {
    const cursor = new BinaryCursor(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 100);
    expect(cursor.u8()).toBe(1); expect(cursor.u16be()).toBe(0x0203); expect(cursor.u32be()).toBe(0x04050607);
    const child = cursor.subview(4); expect(cursor.offset).toBe(11); expect(child.sourceOffset).toBe(107);
    const nested = child.subview(3); expect(child.offset).toBe(3); expect(nested.u16be()).toBe(0x0809); expect(nested.sourceOffset).toBe(109);
    expect(child.u8()).toBe(11);
    expect(new BinaryCursor(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])).u64be()).toBe(0x0102030405060708n);
  });
  it("does not advance on truncation or invalid arithmetic", () => {
    const cursor = new BinaryCursor(new Uint8Array([1, 2])); cursor.seek(1);
    expect(() => cursor.u32be()).toThrow(/TRUNCATED_INPUT/); expect(cursor.offset).toBe(1);
    expect(() => cursor.seek(-1)).toThrow(); expect(cursor.offset).toBe(1);
    expect(() => cursor.bytes(1.5)).toThrow(); expect(cursor.offset).toBe(1);
    expect(() => cursor.checkedProduct(Number.MAX_SAFE_INTEGER, 2)).toThrow(/INTEGER_OVERFLOW/);
    expect(cursor.offset).toBe(1);
  });
});
