import type { ParseDiagnostic } from "@bdmv2web/bdmv-parser";
import type { IgsDiagnostic } from "@bdmv2web/igs";
import { describe, expect, it } from "vitest";
import { renderListDiagnostics } from "./list-report.js";

describe("list report diagnostics", () => {
  it("renders parser and extraction provenance with available offsets", () => {
    const parsed: ParseDiagnostic[] = [{
      severity: "warning", code: "BDMV_BACKUP_FALLBACK", message: "Recovered from backup.", sourcePath: "BACKUP/PLAYLIST/00001.mpls", offset: "88",
      entityId: "playlist:00001", action: null, recoverable: true, stage: "structural", affectedEntryIds: [],
    }];
    const extraction: IgsDiagnostic[] = [{
      severity: "error", code: "TS_SYNC_LOST", message: "Transport synchronization was lost.", stage: "transport", affectedSceneIds: [],
      source: { clipId: "00001", pid: 0x1400, path: "STREAM/00001.m2ts", origin: "primary", packetOffset: "12", pesOffset: "48", segmentOffset: "3", segmentFileOffset: "72", pts90k: null, timeDomain: 0, stage: "transport" },
    }];
    expect(renderListDiagnostics(parsed, extraction)).toEqual([
      "Diagnostics (2):",
      "  warning BDMV_BACKUP_FALLBACK — Recovered from backup.",
      "    source BACKUP/PLAYLIST/00001.mpls @ 88",
      "  error TS_SYNC_LOST — Transport synchronization was lost.",
      "    source STREAM/00001.m2ts @ 72, packet 12",
    ]);
  });

  it("marks an empty diagnostic collection explicitly", () => {
    expect(renderListDiagnostics([], [])).toEqual(["Diagnostics (0):", "  none"]);
  });
});
