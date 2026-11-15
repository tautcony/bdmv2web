import { describe, expect, it } from "vitest";
import { diagnosticKey, uniqueDiagnostics } from "../../src/diagnostics.js";
import type { IgsDiagnostic } from "../../src/scene/types.js";

function transportDiagnostic(options: { pid?: number; packetOffset?: string; message?: string; sceneIds?: string[] } = {}): IgsDiagnostic {
  const pid = options.pid ?? 0x1011;
  return {
    severity: "error",
    code: "TS_CONTINUITY_ERROR",
    message: options.message ?? `PID ${pid} expected CC 8, got 9`,
    source: { clipId: "00005", pid, packetOffset: options.packetOffset ?? "4096", pesOffset: "4096", segmentOffset: "0", segmentFileOffset: "0", pts90k: null, timeDomain: 0, path: null, origin: "primary", stage: "transport" },
    affectedSceneIds: options.sceneIds ?? [],
  };
}

describe("diagnostic identity", () => {
  it("gives two readers of the same packet damage one key", () => {
    expect(diagnosticKey(transportDiagnostic())).toBe(diagnosticKey(transportDiagnostic()));
  });

  it("keeps the same wording at a different packet offset a distinct event", () => {
    expect(diagnosticKey(transportDiagnostic({ packetOffset: "4096" }))).not.toBe(diagnosticKey(transportDiagnostic({ packetOffset: "6144" })));
  });
});

describe("uniqueDiagnostics", () => {
  it("collapses the copies a probe and an extraction report for one event", () => {
    const merged = uniqueDiagnostics([transportDiagnostic(), transportDiagnostic({ packetOffset: "6144" }), transportDiagnostic()]);
    expect(merged.map((item) => (item.source as { packetOffset: string }).packetOffset)).toEqual(["4096", "6144"]);
  });

  it("keeps first-sighting order across different codes", () => {
    const warning: IgsDiagnostic = { severity: "warning", code: "PES_TRUNCATED_EOF", message: "PID 256 has 12 pending PES bytes at EOF", source: null, affectedSceneIds: [] };
    const merged = uniqueDiagnostics([warning, transportDiagnostic(), warning]);
    expect(merged.map((item) => item.code)).toEqual(["PES_TRUNCATED_EOF", "TS_CONTINUITY_ERROR"]);
  });

  it("unions scene references without mutating either input", () => {
    const seen = transportDiagnostic({ sceneIds: ["scene-a"] });
    const other = transportDiagnostic({ sceneIds: ["scene-b"] });
    const merged = uniqueDiagnostics([seen, other]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.affectedSceneIds).toEqual(["scene-a", "scene-b"]);
    expect(seen.affectedSceneIds).toEqual(["scene-a"]);
    expect(other.affectedSceneIds).toEqual(["scene-b"]);
  });

  it("returns the input diagnostics unchanged when nothing repeats", () => {
    const first = transportDiagnostic();
    const second = transportDiagnostic({ pid: 0x1100, message: "PID 4352 expected CC 3, got 5" });
    const merged = uniqueDiagnostics([first, second]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(first);
    expect(merged[1]).toBe(second);
  });
});
