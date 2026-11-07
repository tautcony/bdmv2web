import { describe, expect, it } from "vitest";
import { parseIgsMnu } from "./mnu.js";
import { parseSegments } from "./igs.js";
import { IG_PID, syntheticMenuSegments } from "../tests/helpers/fixtures.js";

describe("MNU parsing", () => {
  it("parses one header per segment and renders the menu element", () => {
    const input = perSegmentMnu(syntheticMenuSegments());
    const result = parseIgsMnu(input, { clipId: "manual-menu", pid: IG_PID });
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]).toMatchObject({ clipId: "manual-menu", pid: IG_PID, compositionNumber: 7, complete: true, pts90k: "90000" });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({ objectId: 5, width: 1, height: 1 });
    expect(result.assets[0]!.relativePath).toContain("igs-manual-menu-");
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts the legacy header-per-PES form with multiple segments", () => {
    const segments = syntheticMenuSegments();
    const input = concat(Uint8Array.of(0x49, 0x47, 0, 1, 0x5f, 0x90, 0, 0, 0, 0), segments);
    const result = parseIgsMnu(input, { clipId: "legacy", pid: IG_PID });
    expect(result.scenes).toHaveLength(1);
    expect(result.assets).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });
});

function perSegmentMnu(segments: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let offset = 0;
  const parsed = parseSegments(segments).segments;
  for (const segment of parsed) {
    const length = (segments[offset + 1]! << 8) | segments[offset + 2]!;
    const body = segments.subarray(offset + 3, offset + 3 + length);
    parts.push(Uint8Array.of(0x49, 0x47, 0, 1, 0x5f, 0x90, 0, 0, 0, 0, segment.type, length >> 8, length & 255), body);
    offset += 3 + length;
  }
  return concat(...parts);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
