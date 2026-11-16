import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseBdmvWithInputTable, type ParsedDisc } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes, type IgsExtraction } from "@bdmv2web/igs";
import { collectInspection } from "../../src/commands/inspect-collection.js";
import { buildInspectionBrowserModel } from "../../src/commands/inspect-browser-model.js";

vi.mock("@bdmv2web/bdmv-parser", () => ({ parseBdmvWithInputTable: vi.fn() }));
vi.mock("@bdmv2web/igs", () => ({ extractIgsScenes: vi.fn() }));

function disc(): ParsedDisc {
  return {
    schemaVersion: "1.0", analysisStage: "structural", root: "/disc/BDMV",
    discInfo: { appInfo: null, uhd: null }, entries: [], movieObjects: [], playlists: [], clips: [], sounds: [],
    graph: { nodes: [], edges: [] }, declarations: { entries: 0, movieObjects: 0, playlists: 0, playItems: 0, clips: 0, streams: 0, sounds: 0, unknown: 0 },
    diagnostics: [], supportPrediction: { status: "partial", supported: [], unsupported: [], unverified: [] },
  };
}
const extraction: IgsExtraction = { scenes: [], streams: [], assets: [], diagnostics: [], status: "partial", support: { format: "Blu-ray IGS", status: "unverified" }, payloadBytesByClip: new Map() };

beforeEach(() => { vi.clearAllMocks(); });

describe("inspection collection", () => {
  it("reuses one parse and input table for one extraction and subsequent browser indexes", async () => {
    const parsed = disc();
    const table = { root: parsed.root, files: new Map<string, string>() };
    vi.mocked(parseBdmvWithInputTable).mockResolvedValue({ disc: parsed, table });
    vi.mocked(extractIgsScenes).mockResolvedValue(extraction);
    const result = await collectInspection(parsed.root, { renderPng: false }, "all");
    buildInspectionBrowserModel(result);
    buildInspectionBrowserModel(result);
    expect(parseBdmvWithInputTable).toHaveBeenCalledExactlyOnceWith(parsed.root);
    expect(extractIgsScenes).toHaveBeenCalledExactlyOnceWith(parsed, expect.objectContaining({ table, renderAssets: false, measurePayloadBytes: true }));
    expect(result.graphics).toBe(extraction);
    expect(result.graphicsStageStatus).toBe("partial");
  });

  it("retains fatal structural diagnostics with a not-run graphics stage", async () => {
    const parsed = disc();
    parsed.diagnostics.push({ severity: "fatal", code: "BDMV_REQUIRED_FILE_MISSING", message: "index.bdmv is missing", sourcePath: "index.bdmv", offset: null, entityId: null, action: null, recoverable: false, stage: "structural", affectedEntryIds: [] });
    vi.mocked(parseBdmvWithInputTable).mockResolvedValue({ disc: parsed, table: { root: parsed.root, files: new Map() } });
    const result = await collectInspection(parsed.root, { renderPng: false }, "all");
    expect(result).toMatchObject({ disc: { diagnostics: parsed.diagnostics }, graphics: null, graphicsStageStatus: "not-run" });
  });
});
