import { describe, expect, it } from "vitest";
import { createIgsSourceMap, mapIgsDiagnosticSource, mapIgsSource } from "./extract.js";

describe("IGS source-map provenance", () => {
  it("keeps structural source location fields separate from transport offsets", () => {
    expect(mapIgsSource({
      clipId: "00001",
      pid: 0x1200,
      path: "PLAYLIST/00001.mpls",
      origin: "backup",
      sourceOffset: "123",
      packetOffset: null,
      pesOffset: null,
      segmentOffset: null,
      segmentFileOffset: null,
      pts90k: null,
      timeDomain: null,
      stage: "structural",
    })).toEqual({
      path: "PLAYLIST/00001.mpls",
      clipId: "00001",
      pid: 0x1200,
      origin: "backup",
      stage: "structural",
      byteOffset: "123",
      sourceOffset: "123",
      packetOffset: null,
      pesOffset: null,
      segmentOffset: null,
      segmentFileOffset: null,
      pts90k: null,
      timeDomain: null,
    });
  });

  it("records a stage when a diagnostic has no known source position", () => {
    expect(mapIgsDiagnosticSource({ code: "IGS_PID_UNRESOLVED", source: null, stage: "transport" })).toEqual({ source: null, stage: "transport" });
  });

  it("serializes structural and unknown diagnostic positions into the source map", () => {
    const sourceMap = JSON.parse(JSON.stringify(createIgsSourceMap({
      scenes: [],
      assets: [],
      diagnostics: [
        {
          severity: "error", code: "IGS_PID_CONFLICT", message: "", affectedSceneIds: [], stage: "structural",
          source: {
            clipId: "00001", pid: 0x1200, path: "CLIPINF/00001.clpi", origin: "backup", sourceOffset: "75",
            packetOffset: null, pesOffset: null, segmentOffset: null, segmentFileOffset: null,
            pts90k: null, timeDomain: null, stage: "structural",
          },
        },
        { severity: "warning", code: "IGS_PID_UNRESOLVED", message: "", affectedSceneIds: [], source: null, stage: "transport" },
      ],
    })));

    expect(sourceMap.diagnostics).toEqual([
      { index: 0, stage: "structural", affectedSceneIds: [], source: expect.objectContaining({ path: "CLIPINF/00001.clpi", origin: "backup", clipId: "00001", pid: 0x1200, byteOffset: "75", packetOffset: null }) },
      { index: 1, stage: "transport", affectedSceneIds: [], source: null },
    ]);
  });

  it("leaves a chunk-only transport location path and origin unknown", () => {
    expect(mapIgsSource({
      clipId: "00002",
      pid: 0x1201,
      packetOffset: "192",
      pesOffset: "196",
      segmentOffset: "0",
      segmentFileOffset: "215",
      pts90k: "90000",
      timeDomain: 0,
    })).toMatchObject({
      path: null,
      origin: null,
      stage: "transport",
      clipId: "00002",
      pid: 0x1201,
      byteOffset: "215",
    });
  });
});
