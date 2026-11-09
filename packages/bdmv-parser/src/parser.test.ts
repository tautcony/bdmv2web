import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildM1ClipInfoProgramAndCpi, buildM1ClipInfoWithHevcVideo, buildM1ClipInfoWithSequence, buildM1EmptyClipInfo, buildM1EmptyPlaylist, buildM1Index, buildM1MovieObject, buildM1PlaylistGolden, buildM1PlaylistWithAppInfo, buildM1PlaylistWithAudioPid, buildM1PlaylistWithHevcVideo, buildM1PlaylistWithMultiClipSubPlayItem, buildM1PlaylistWithSubPlayItem, buildM1Sound, buildM1SoundTwoRanges, m1MovieObjectExpected } from "@bdmv2web/test-fixtures";
import { discoverBdmvRoot, parseBdmv, traverseGraph, type GraphEdge, type GraphNode } from "./index.js";

async function temp(): Promise<string> { return mkdtemp(join(tmpdir(), "bdmv m1 中文 ")); }
async function skeleton(parent: string, index = buildM1Index()): Promise<string> {
  const root = join(parent, "BDMV");
  await mkdir(join(root, "PLAYLIST"), { recursive: true }); await mkdir(join(root, "CLIPINF"), { recursive: true }); await mkdir(join(root, "STREAM"), { recursive: true });
  await writeFile(join(root, "index.bdmv"), index); await writeFile(join(root, "MovieObject.bdmv"), buildM1MovieObject());
  return realpath(root);
}

describe("M1 BDMV discovery and structure", () => {
  it("traverses resolved graph cycles once and reports unresolved and missing targets", () => {
    const node = (id: string, state: GraphNode["state"] = "present"): GraphNode => ({ id, type: "entry", state, source: null });
    const edge = (from: string, to: string, resolution: GraphEdge["resolution"]): GraphEdge => ({ from, to, kind: "reference", resolution, source: { path: "BDMV/index.bdmv", origin: "primary", offset: "0" } });
    const result = traverseGraph({ nodes: [node("a"), node("b"), node("missingNode", "missing")], edges: [edge("a", "b", "resolved"), edge("b", "a", "resolved"), edge("b", "command:0:0", "unresolved"), edge("b", "missing", "resolved"), edge("b", "missingNode", "missing")] }, ["a"]);
    expect(result.visited).toEqual(["a", "b"]);
    expect(result.unresolvedEdges.map((item) => item.to)).toEqual(["command:0:0", "missing", "missingNode"]);
    expect(result.missingNodes).toEqual(["missing", "missingNode"]);
    expect(result.frontier).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it("stops at the node budget and returns an explicit unvisited frontier", () => {
    const node = (id: string): GraphNode => ({ id, type: "entry", state: "present", source: null });
    const source = { path: "BDMV/index.bdmv", origin: "primary" as const, offset: "0" };
    const result = traverseGraph({ nodes: [node("a"), node("b"), node("c")], edges: [
      { from: "a", to: "b", kind: "reference", resolution: "resolved", source },
      { from: "b", to: "c", kind: "reference", resolution: "resolved", source },
    ] }, ["a"], 2);
    expect(result.visited).toEqual(["a", "b"]);
    expect(result.frontier).toEqual(["c"]);
    expect(result.complete).toBe(false);
  });

  it("finds a direct BDMV root and its direct parent, preserving case and Unicode paths", async () => {
    const parent = await temp(); const root = await skeleton(parent);
    try { expect(await discoverBdmvRoot(root)).toBe(root); expect(await discoverBdmvRoot(parent)).toBe(root); const disc = await parseBdmv(parent); expect(disc.root).toBe(root); expect(disc.entries[0]?.target.target).toBe(0); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("preserves the actual casing of a direct mixed-case BDMV directory", async () => {
    const parent = await temp(); const root = join(parent, "bDmV"); await mkdir(root);
    try { expect(await discoverBdmvRoot(root)).toBe(await realpath(root)); expect(await discoverBdmvRoot(parent)).toBe(await realpath(root)); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("parses the committed metadata-only fixture without STREAM files", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const disc = await parseBdmv(root);
    expect(disc.entries).toHaveLength(33);
    expect(disc.movieObjects).toHaveLength(17);
    expect(disc.movieObjects.reduce((count, object) => count + object.instructions.length, 0)).toBe(4969);
    expect(disc.playlists).toHaveLength(26);
    expect(disc.clips).toHaveLength(18);
    expect(disc.playlists.reduce((count, playlist) => count + playlist.playItems.length, 0)).toBe(1025);
    expect(disc.diagnostics.some((diagnostic) => diagnostic.code === "BDMV_BACKUP_DIFFERS")).toBe(false);
    expect(disc.diagnostics.filter((diagnostic) => diagnostic.code === "BDMV_MISSING_STREAM").length).toBeGreaterThan(0);
    expect(disc.diagnostics.some((diagnostic) => diagnostic.code === "BDMV_MISSING_CLPI")).toBe(false);
    const playlist = disc.playlists.find((item) => item.id === "00001");
    expect(playlist?.playItems.some((item) => item.clipId === "00002")).toBe(true);
    expect(disc.supportPrediction.status).toBe("partial");
    expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "clip:00002", type: "clip", state: "missing" }));
  });

  it("parses and graph-links CLPI referenced by a SubPath", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const disc = await parseBdmv(root);
    const playlist = disc.playlists.find((item) => item.id === "00003")!;
    const cue = playlist.playItems.flatMap((item) => item.streams).find((stream) => stream.streamType === 2)!;
    expect(playlist.subPaths).toMatchObject([{ type: 3, items: [{ clipId: "00005" }] }]);
    expect(cue).toMatchObject({ streamType: 2, subPathId: 0, subClipId: 0 });
    expect(disc.clips.some((clip) => clip.id === "00005")).toBe(true);
    expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "clipInfo:00005", type: "clipInfo", state: "present" }));
    expect(disc.graph.edges).toContainEqual(expect.objectContaining({ from: "subPath:00003:0", to: "clipInfo:00005", kind: "subpath-clip-info-reference", resolution: "resolved" }));
    expect(disc.diagnostics.some((diagnostic) => diagnostic.code === "BDMV_STN_CLPI_PID_CONFLICT" && diagnostic.sourcePath === cue.source.path && diagnostic.offset === cue.source.offset)).toBe(false);
  });

  it("retains mixed HDMV and BD-J title declarations and exact MOBJ bytes and offsets", async () => {
    const parent = await temp(); const root = await skeleton(parent, buildM1Index({ bdjTitle: "00042", titleAccess: 2 }));
    try {
      const disc = await parseBdmv(root);
      expect(disc.entries.map((e) => e.target.objectType)).toEqual(["HDMV", "HDMV", "BDJ"]);
      expect(disc.entries[2]?.target).toMatchObject({ target: "00042", accessType: 2 });
      expect(disc.movieObjects).toHaveLength(m1MovieObjectExpected.objectCount);
      expect(disc.movieObjects[0]).toMatchObject({ resumeIntention: false, menuCallMask: false, titleSearchMask: false });
      expect(disc.movieObjects[0]?.instructions.map((i) => i.bytes)).toEqual(m1MovieObjectExpected.instructionBytes);
      expect(disc.movieObjects[0]?.instructions.map((i) => i.source.offset)).toEqual(m1MovieObjectExpected.instructionOffsets);
      expect(disc.graph.edges.filter((e) => e.kind === "raw-command").every((e) => e.resolution === "unresolved")).toBe(true);
      expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "bdjo:00042", type: "bdjo", state: "missing" }));
      expect(disc.graph.edges).toContainEqual(expect.objectContaining({ to: "bdjo:00042", kind: "bdj-target", resolution: "missing" }));
      expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "movieObject:1", type: "movieObject", state: "missing" }));
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("resolves BD-J targets when the matching BDJO declaration exists", async () => {
    const parent = await temp(); const root = await skeleton(parent, buildM1Index({ bdjTitle: "00042" })); await mkdir(join(root, "BDJO"), { recursive: true }); await writeFile(join(root, "BDJO", "00042.bdjo"), new Uint8Array());
    try { const disc = await parseBdmv(root); expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "bdjo:00042", type: "bdjo", state: "present", source: expect.objectContaining({ path: "BDMV/BDJO/00042.bdjo" }) })); expect(disc.graph.edges).toContainEqual(expect.objectContaining({ to: "bdjo:00042", kind: "bdj-target", resolution: "resolved" })); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("distinguishes a present STREAM clip from missing CLPI in the graph", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAudioPid()); await writeFile(join(root, "STREAM", "00001.m2ts"), new Uint8Array());
    try { const disc = await parseBdmv(root); expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "clip:00001", type: "clip", state: "present" })); expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "clipInfo:00001", type: "clipInfo", state: "missing" })); expect(disc.diagnostics.some((d) => d.code === "BDMV_MISSING_CLPI")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("records missing STREAM and CLPI as separate typed graph nodes", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAudioPid());
    try { const disc = await parseBdmv(root); expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "clip:00001", type: "clip", state: "missing" })); expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "clipInfo:00001", type: "clipInfo", state: "missing" })); expect(disc.diagnostics.some((d) => d.code === "BDMV_MISSING_STREAM")).toBe(true); expect(disc.diagnostics.some((d) => d.code === "BDMV_MISSING_CLPI")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("does not load large STREAM files into metadata buffers", async () => {
    const parent = await temp(); const root = await skeleton(parent);
    try {
      const streamPath = join(root, "STREAM", "large.m2ts"); await writeFile(streamPath, new Uint8Array(9 * 1024 * 1024));
      const disc = await parseBdmv(root); expect(disc.entries).toHaveLength(2); expect((await stat(streamPath)).size).toBeGreaterThan(8 * 1024 * 1024);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("uses a matching backup when the primary index is absent and records its source", async () => {
    const parent = await temp(); const root = await skeleton(parent); await rm(join(root, "index.bdmv"));
    await mkdir(join(root, "BACKUP"), { recursive: true }); await writeFile(join(root, "BACKUP", "index.bdmv"), buildM1Index());
    try { const disc = await parseBdmv(root); expect(disc.entries[0]?.source).toMatchObject({ path: "BDMV/BACKUP/index.bdmv", origin: "backup" }); expect(disc.diagnostics.some((d) => d.code === "BDMV_BACKUP_FALLBACK" && d.sourcePath === "BDMV/BACKUP/index.bdmv")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("recovers from a structurally damaged index as one whole backup file", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "index.bdmv"), new Uint8Array([0, 1, 2])); await mkdir(join(root, "BACKUP"), { recursive: true }); await writeFile(join(root, "BACKUP", "index.bdmv"), buildM1Index({ top: 9 }));
    try { const disc = await parseBdmv(root); expect(disc.entries[1]?.target.target).toBe(9); expect(disc.entries.every((e) => e.source.path === "BDMV/BACKUP/index.bdmv" && e.source.origin === "backup")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps a valid primary when both primary and backup are valid but differ", async () => {
    const parent = await temp(); const root = await skeleton(parent); await mkdir(join(root, "BACKUP"), { recursive: true }); await writeFile(join(root, "BACKUP", "index.bdmv"), buildM1Index({ top: 7 }));
    try { const disc = await parseBdmv(root); expect(disc.entries[1]?.target.target).toBe(1); expect(disc.entries[1]?.source).toMatchObject({ path: "BDMV/index.bdmv", origin: "primary" }); expect(disc.diagnostics.some((d) => d.code === "BDMV_BACKUP_DIFFERS" && d.sourcePath === "BDMV/index.bdmv")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("reports both invalid index copies without inventing entries", async () => {
    const parent = await temp(); const root = await skeleton(parent, new Uint8Array([1, 2, 3])); await mkdir(join(root, "BACKUP"), { recursive: true }); await writeFile(join(root, "BACKUP", "index.bdmv"), new Uint8Array([4, 5, 6]));
    try { const disc = await parseBdmv(root); expect(disc.entries).toHaveLength(0); expect(disc.diagnostics.filter((d) => d.severity === "error").map((d) => d.sourcePath).sort()).toEqual(["BDMV/BACKUP/index.bdmv", "BDMV/index.bdmv"]); expect(disc.diagnostics.some((d) => d.code === "BDMV_REQUIRED_FILE_MISSING")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("reports a three-byte truncated magic as truncated input", async () => {
    const parent = await temp(); const root = await skeleton(parent, Uint8Array.from([0x49, 0x4e, 0x44]));
    try { const disc = await parseBdmv(root); expect(disc.entries).toHaveLength(0); expect(disc.diagnostics.some((d) => d.code === "TRUNCATED_INPUT" && d.sourcePath === "BDMV/index.bdmv")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects an index section too short for the fixed entries and title count", async () => {
    const parent = await temp(); const bytes = buildM1Index(); bytes[88] = 0; bytes[89] = 0; bytes[90] = 0; bytes[91] = 25; const root = await skeleton(parent, bytes);
    try { const disc = await parseBdmv(root); expect(disc.entries).toHaveLength(0); expect(disc.diagnostics.some((d) => d.code === "BDMV_INVALID_SECTION" && d.sourcePath === "BDMV/index.bdmv")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps a valid primary when its backup has an unsupported version", async () => {
    const parent = await temp(); const root = await skeleton(parent); await mkdir(join(root, "BACKUP"), { recursive: true }); await writeFile(join(root, "BACKUP", "index.bdmv"), buildM1Index({ version: "9999" }));
    try { const disc = await parseBdmv(root); expect(disc.entries[0]?.source).toMatchObject({ path: "BDMV/index.bdmv", origin: "primary" }); expect(disc.diagnostics.some((d) => d.code === "BDMV_UNSUPPORTED_VERSION" && d.sourcePath === "BDMV/BACKUP/index.bdmv")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("does not use an older backup to mask an unsupported primary version", async () => {
    const parent = await temp(); const root = await skeleton(parent, buildM1Index({ version: "9999" })); await mkdir(join(root, "BACKUP"), { recursive: true }); await writeFile(join(root, "BACKUP", "index.bdmv"), buildM1Index());
    try { await expect(parseBdmv(root)).rejects.toThrow("BDMV_UNSUPPORTED_VERSION"); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it.each([
    ["MOBJ", "MovieObject.bdmv", () => buildM1MovieObject()],
    ["MPLS", "PLAYLIST/00001.mpls", () => buildM1EmptyPlaylist()],
    ["CLPI", "CLIPINF/00001.clpi", () => buildM1EmptyClipInfo()],
    ["sound", "AUXDATA/sound.bdmv", () => buildM1Sound()],
  ] as const)("rejects an unknown primary %s version", async (_name, relativePath, build) => {
    const parent = await temp(); const root = await skeleton(parent);
    const bytes = build(); bytes.set(new TextEncoder().encode("9999"), 4);
    const file = join(root, relativePath); await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes);
    try { await expect(parseBdmv(root)).rejects.toThrow("BDMV_UNSUPPORTED_VERSION"); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("parses backup-only playlists and CLPI files and preserves backup provenance", async () => {
    const parent = await temp(); const root = await skeleton(parent); const backup = join(root, "BACKUP"); await mkdir(join(backup, "PLAYLIST"), { recursive: true }); await mkdir(join(backup, "CLIPINF"), { recursive: true });
    await writeFile(join(backup, "PLAYLIST", "00001.mpls"), buildM1EmptyPlaylist()); await writeFile(join(backup, "CLIPINF", "00001.clpi"), buildM1EmptyClipInfo());
    try { const disc = await parseBdmv(root); expect(disc.playlists).toHaveLength(1); expect(disc.playlists[0]?.source.origin).toBe("backup"); expect(disc.clips).toHaveLength(1); expect(disc.clips[0]?.source.origin).toBe("backup"); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("falls back to damaged-primary backups for MOBJ, MPLS and CLPI with per-file provenance", async () => {
    const parent = await temp(); const root = await skeleton(parent); const backup = join(root, "BACKUP");
    await mkdir(join(backup, "PLAYLIST"), { recursive: true }); await mkdir(join(backup, "CLIPINF"), { recursive: true });
    await writeFile(join(root, "MovieObject.bdmv"), Uint8Array.from([1, 2, 3])); await writeFile(join(backup, "MovieObject.bdmv"), buildM1MovieObject());
    await writeFile(join(root, "PLAYLIST", "00001.mpls"), Uint8Array.from([1, 2, 3])); await writeFile(join(backup, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithSubPlayItem());
    await writeFile(join(root, "CLIPINF", "00001.clpi"), Uint8Array.from([1, 2, 3])); await writeFile(join(backup, "CLIPINF", "00001.clpi"), buildM1ClipInfoProgramAndCpi());
    try {
      const disc = await parseBdmv(root);
      expect(disc.movieObjects[0]?.source.path).toBe("BDMV/BACKUP/MovieObject.bdmv");
      expect(disc.playlists[0]?.source.path).toBe("BDMV/BACKUP/PLAYLIST/00001.mpls");
      expect(disc.clips[0]?.source.path).toBe("BDMV/BACKUP/CLIPINF/00001.clpi");
      expect(disc.diagnostics.filter((d) => d.code === "BDMV_BACKUP_FALLBACK")).toHaveLength(3);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("preserves two PlayItems, original 45 kHz times, chapter marks, angle flags and SubPath", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistGolden());
    try { const disc = await parseBdmv(root); const playlist = disc.playlists[0]!; expect(playlist.playItems.map((p) => [p.clipId, p.inTime45k, p.outTime45k])).toEqual([["00001", 0, 90_000], ["00003", 0, 45_000]]); expect(playlist.playItems[0]).toMatchObject({ multiAngle: true, angleCount: 2, differentAudio: true, seamlessAngle: true, uoMask: "9223372036854775808" }); expect(playlist.marks.map((m) => [m.playItemRef, m.time45k])).toEqual([[0, 0], [1, 45_000]]); expect(playlist.subPaths).toMatchObject([{ type: 3, repeat: true, items: [] }]); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("preserves a nonempty SubPlayItem and its timing/source mapping", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithSubPlayItem());
    try { const disc = await parseBdmv(root); expect(disc.playlists[0]?.subPaths[0]?.items[0]).toMatchObject({ clipId: "00009", connectionCondition: 1, stcId: 7, multiClip: false, clips: [{ clipId: "00009", codecId: "M2TS", stcId: 7 }], inTime45k: 90_000, outTime45k: 180_000, syncPlayItemId: 1, syncPts45k: 45_000, source: { path: "BDMV/PLAYLIST/00001.mpls", offset: "214" } }); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("parses multi-clip SubPlayItems and each clip STC identifier", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithMultiClipSubPlayItem());
    try { const disc = await parseBdmv(root); expect(disc.playlists[0]?.subPaths[0]?.items[0]).toMatchObject({ clipId: "00009", connectionCondition: 1, stcId: 7, multiClip: true, clips: [{ clipId: "00009", codecId: "M2TS", stcId: 7 }, { clipId: "00010", codecId: "M2TS", stcId: 8 }] }); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects an STN section that crosses its enclosing PlayItem while remaining inside the file", async () => {
    const parent = await temp(); const root = await skeleton(parent); const bytes = buildM1PlaylistGolden(); bytes[136] = 0; bytes[137] = 40; await writeFile(join(root, "PLAYLIST", "00001.mpls"), bytes);
    try { const disc = await parseBdmv(root); expect(disc.playlists).toHaveLength(0); expect(disc.diagnostics.some((d) => d.code === "BDMV_INVALID_SECTION" && d.sourcePath === "BDMV/PLAYLIST/00001.mpls")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects a SubPlayItem that crosses its enclosing SubPath while remaining inside the file", async () => {
    const parent = await temp(); const root = await skeleton(parent); const bytes = buildM1PlaylistWithSubPlayItem(); bytes[212] = 0; bytes[213] = 50; await writeFile(join(root, "PLAYLIST", "00001.mpls"), bytes);
    try { const disc = await parseBdmv(root); expect(disc.playlists).toHaveLength(0); expect(disc.diagnostics.some((d) => d.code === "BDMV_INVALID_SECTION" && d.sourcePath === "BDMV/PLAYLIST/00001.mpls")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects a SubPlayItem shorter than its fixed bit fields", async () => {
    const parent = await temp(); const root = await skeleton(parent); const bytes = buildM1PlaylistWithSubPlayItem(); bytes[212] = 0; bytes[213] = 27; await writeFile(join(root, "PLAYLIST", "00001.mpls"), bytes);
    try { const disc = await parseBdmv(root); expect(disc.playlists).toHaveLength(0); expect(disc.diagnostics.some((d) => d.code === "BDMV_INVALID_SECTION" && d.sourcePath === "BDMV/PLAYLIST/00001.mpls")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("reports an invalid chapter Mark without normalizing it into a playable reference", async () => {
    const parent = await temp(); const root = await skeleton(parent); const bytes = buildM1PlaylistGolden(); bytes[234] = 0; bytes[235] = 9; await writeFile(join(root, "PLAYLIST", "00001.mpls"), bytes);
    try { const disc = await parseBdmv(root); expect(disc.diagnostics.some((d) => d.code === "BDMV_INVALID_REFERENCE" && d.sourcePath === "BDMV/PLAYLIST/00001.mpls" && d.offset === "232")).toBe(true); expect(disc.playlists[0]?.marks[1]?.playItemRef).toBe(9); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("parses nonempty CLPI stream metadata and CPI PTS/SPN access points", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "CLIPINF", "00001.clpi"), buildM1ClipInfoProgramAndCpi());
    try { const disc = await parseBdmv(root); expect(disc.clips[0]?.programs[0]).toMatchObject({ sequenceStartSpn: 32, programMapPid: 0x1000, streams: [{ pid: 0x1100, codingType: 0x80, language: "eng" }] }); expect(disc.clips[0]?.cpi).toMatchObject([{ pid: 0x1100, epStreamType: 1, pts45k: 1280, spn: 7 }]); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("parses MPLS HEVC color metadata and keeps the STN stream source", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithHevcVideo());
    try {
      const stream = (await parseBdmv(root)).playlists[0]?.playItems[0]?.streams[0];
      expect(stream).toMatchObject({ codingType: 0x24, pid: 0x1011, dynamicRangeType: 1, colorSpace: 2, source: { path: "BDMV/PLAYLIST/00001.mpls", offset: "140" } });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("parses CLPI HEVC color metadata, preserves explicit zero codes, and points to the stream record", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "CLIPINF", "00001.clpi"), buildM1ClipInfoWithHevcVideo(0, 0));
    try {
      const stream = (await parseBdmv(root)).clips[0]?.programs[0]?.streams[0];
      expect(stream).toMatchObject({ codingType: 0x24, pid: 0x1100, dynamicRangeType: 0, colorSpace: 0, source: { path: "BDMV/CLIPINF/00001.clpi", offset: "74" } });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("leaves color metadata unknown for non-HEVC streams", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "CLIPINF", "00001.clpi"), buildM1ClipInfoProgramAndCpi());
    try {
      const stream = (await parseBdmv(root)).clips[0]?.programs[0]?.streams[0];
      expect(stream).toMatchObject({ codingType: 0x80, dynamicRangeType: null, colorSpace: null });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("bounds-checks nonempty CLPI CPI sections", async () => {
    const parent = await temp(); const root = await skeleton(parent); const bytes = buildM1ClipInfoProgramAndCpi(); bytes[89] = 0xff; await writeFile(join(root, "CLIPINF", "00001.clpi"), bytes);
    try { const disc = await parseBdmv(root); expect(disc.clips).toHaveLength(0); expect(disc.diagnostics.some((d) => d.code === "BDMV_INVALID_SECTION" && d.sourcePath === "BDMV/CLIPINF/00001.clpi")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("bounds ProgramInfo records by their declared CLPI section", async () => {
    const parent = await temp(); const root = await skeleton(parent); const bytes = buildM1ClipInfoProgramAndCpi(); bytes[60] = 0; bytes[61] = 0; bytes[62] = 0; bytes[63] = 8; await writeFile(join(root, "CLIPINF", "00001.clpi"), bytes);
    try { const disc = await parseBdmv(root); expect(disc.clips).toHaveLength(0); expect(disc.diagnostics.some((d) => d.code === "BDMV_INVALID_COUNT" && d.sourcePath === "BDMV/CLIPINF/00001.clpi")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects CPI entry blocks beyond the declared CPI section while file bytes remain", async () => {
    const parent = await temp(); const root = await skeleton(parent); const original = buildM1ClipInfoProgramAndCpi(); const bytes = new Uint8Array(160); bytes.set(original); bytes[100] = 0; bytes[101] = 0; bytes[102] = 0; bytes[103] = 30; await writeFile(join(root, "CLIPINF", "00001.clpi"), bytes);
    try { const disc = await parseBdmv(root); expect(disc.clips).toHaveLength(0); expect(disc.diagnostics.some((d) => d.code === "BDMV_INVALID_SECTION" && d.sourcePath === "BDMV/CLIPINF/00001.clpi")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps matching STN and CLPI declarations without reporting a conflict", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAudioPid()); await writeFile(join(root, "STREAM", "00001.m2ts"), new Uint8Array()); await writeFile(join(root, "CLIPINF", "00001.clpi"), buildM1ClipInfoProgramAndCpi());
    try { const disc = await parseBdmv(root); const stream = disc.playlists[0]?.playItems[0]?.streams[0]; expect(stream).toMatchObject({ pid: 0x1100, codingType: 0x80 }); expect(disc.diagnostics.some((d) => d.code === "BDMV_STN_CLPI_PID_CONFLICT")).toBe(false); expect(disc.diagnostics.some((d) => d.code === "BDMV_STN_CLPI_CODING_CONFLICT")).toBe(false); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("reports a PID conflict between STN and CLPI declarations", async () => {
    const parent = await temp(); const root = await skeleton(parent); await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAudioPid()); await writeFile(join(root, "STREAM", "00001.m2ts"), new Uint8Array()); const clpi = buildM1ClipInfoProgramAndCpi(); clpi[75] = 0x12; await writeFile(join(root, "CLIPINF", "00001.clpi"), clpi);
    try { const disc = await parseBdmv(root); expect(disc.diagnostics.some((d) => d.code === "BDMV_STN_CLPI_PID_CONFLICT")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("retains bounded sound sample ranges without emitting media bytes", async () => {
    const parent = await temp(); const root = await skeleton(parent); await mkdir(join(root, "AUXDATA"), { recursive: true }); await writeFile(join(root, "AUXDATA", "sound.bdmv"), buildM1Sound());
    try { const disc = await parseBdmv(root); expect(disc.sounds[0]).toMatchObject({ channels: 1, sampleRate: 48000, bitsPerSample: 16, sampleOffset: 64, sampleByteLength: 4 }); expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "sound:0", type: "sound", state: "present" })); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("retains multiple sound table sample ranges and rejects an out-of-file range", async () => {
    const parent = await temp(); const root = await skeleton(parent); await mkdir(join(root, "AUXDATA"), { recursive: true }); const soundPath = join(root, "AUXDATA", "sound.bdmv"); const bytes = buildM1SoundTwoRanges(); await writeFile(soundPath, bytes);
    try { const disc = await parseBdmv(root); expect(disc.sounds.map((s) => [s.sampleOffset, s.sampleByteLength])).toEqual([[80, 4], [84, 4]]); bytes[61] = 0xff; await writeFile(soundPath, bytes); await expect(parseBdmv(root)).rejects.toThrow("TRUNCATED_INPUT"); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects symlinks anywhere in the scanned BDMV tree and a symlink root", async () => {
    const parent = await temp(); const root = await skeleton(parent); const outside = join(parent, "outside"); await mkdir(outside); await symlink(outside, join(root, "STREAM", "escape"));
    try { await expect(parseBdmv(root)).rejects.toThrow("SYMLINK_REJECTED"); await rm(join(root, "STREAM", "escape")); const linkRoot = join(parent, "LinkedBDMV"); await symlink(root, linkRoot); await expect(discoverBdmvRoot(linkRoot)).rejects.toThrow("SYMLINK_REJECTED"); await rm(linkRoot); const candidateParent = join(parent, "candidate parent"); await mkdir(candidateParent); await symlink(root, join(candidateParent, "BDMV")); await expect(discoverBdmvRoot(candidateParent)).rejects.toThrow("SYMLINK_REJECTED"); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects truncated raw MovieObject command records", async () => {
    const parent = await temp(); const root = await skeleton(parent); const broken = buildM1MovieObject(); broken[53] = 3; await writeFile(join(root, "MovieObject.bdmv"), broken);
    try { const disc = await parseBdmv(root); expect(disc.movieObjects).toHaveLength(0); expect(disc.diagnostics.some((d) => d.code === "TRUNCATED_INPUT")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects MOBJ commands beyond the declared data section even when file bytes remain", async () => {
    const parent = await temp(); const root = await skeleton(parent); const bytes = buildM1MovieObject(); bytes[40] = 0; bytes[41] = 0; bytes[42] = 0; bytes[43] = 10; await writeFile(join(root, "MovieObject.bdmv"), bytes);
    try { const disc = await parseBdmv(root); expect(disc.movieObjects).toHaveLength(0); expect(disc.diagnostics.some((d) => d.code === "TRUNCATED_INPUT" && d.sourcePath === "BDMV/MovieObject.bdmv")).toBe(true); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects more than one case-variant candidate when the filesystem permits it", async () => {
    const parent = await temp(); let secondCreated = true;
    try { await mkdir(join(parent, "BDMV")); try { await mkdir(join(parent, "bdmv")); } catch { secondCreated = false; }
      if (secondCreated) await expect(discoverBdmvRoot(parent)).rejects.toThrow("BDMV_ROOT_AMBIGUOUS");
      else expect(await discoverBdmvRoot(parent)).toBe(await realpath(join(parent, "BDMV")));
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("parses INDX app info and the 3.1 UHD extension into disc-level declarations", async () => {
    const parent = await temp();
    const index = buildM1Index({ appInfo: { initialOutputMode: true, contentExist: true, initialDynamicRangeType: 2, videoFormat: 6, frameRate: 4 }, uhd: { discType: 5, exists4k: true, hdrFlags: 3, dolbyVision: true } });
    const root = await skeleton(parent, index);
    try {
      const disc = await parseBdmv(root);
      expect(disc.discInfo.appInfo).toMatchObject({ initialOutputModePreference: true, contentExistFlag: true, initialDynamicRangeType: 2, videoFormat: 6, frameRate: 4, userDataBytes: 32, source: { path: "BDMV/index.bdmv", origin: "primary", offset: "40" } });
      expect(disc.discInfo.uhd).toMatchObject({ discType: 5, exists4k: true, hdrFlags: 3, hdr10Plus: false, dolbyVision: true });
      expect(disc.entries).toHaveLength(2);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("reads the UHD HDR signalling declared by the committed UHD fixture", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV");
    const disc = await parseBdmv(root);
    expect(disc.discInfo.uhd).toMatchObject({ discType: 5, exists4k: true, hdrFlags: 3, hdr10Plus: false, dolbyVision: true });
    expect(disc.discInfo.appInfo).toMatchObject({ userDataBytes: 32, initialOutputModePreference: false, contentExistFlag: false });
    // The 0x24 attribute path must be observable, not just "does not crash": these
    // values come from the real MPLS/CLPI records in the fixture (P1-INFO-3).
    const playlist = disc.playlists.find((item) => item.id === "00006");
    expect(playlist?.playItems[0]?.streams.find((stream) => stream.codingType === 0x24)).toMatchObject({ pid: 4113, dynamicRangeType: 0, colorSpace: 1 });
    const clip = disc.clips.find((item) => item.id === "00011");
    expect(clip?.programs[0]?.streams.find((stream) => stream.codingType === 0x24)).toMatchObject({ pid: 4113, dynamicRangeType: 0, colorSpace: 1 });
    expect(disc.clips.length).toBeGreaterThanOrEqual(13);
  });

  it("keeps navigation entries when the optional INDEX UHD metadata is damaged", async () => {
    const parent = await temp(); const root = await skeleton(parent, buildM1Index({ uhd: { discType: 5 } })); const path = join(root, "index.bdmv");
    try {
      // Declared extension length points past the file: recorded, not fatal.
      const truncated = buildM1Index({ uhd: { discType: 5 } }); truncated[121] = 0xff;
      await writeFile(path, truncated);
      const truncatedDisc = await parseBdmv(root);
      expect(truncatedDisc.entries).toHaveLength(2);
      expect(truncatedDisc.diagnostics).toContainEqual(expect.objectContaining({ code: "BDMV_DECLARED_LENGTH_MISMATCH", severity: "warning", sourcePath: "BDMV/index.bdmv" }));

      // An entry whose bounds leave the file is dropped with a warning; navigation survives.
      const outOfRange = buildM1Index({ uhd: { discType: 5 } }); outOfRange[134] = 0x02;
      await writeFile(path, outOfRange);
      const outOfRangeDisc = await parseBdmv(root);
      expect(outOfRangeDisc.entries).toHaveLength(2);
      expect(outOfRangeDisc.discInfo.uhd).toBeNull();
      expect(outOfRangeDisc.diagnostics).toContainEqual(expect.objectContaining({ code: "BDMV_INVALID_SECTION", severity: "warning", sourcePath: "BDMV/index.bdmv" }));

      // A truncated UHD payload is also optional.
      const payload = buildM1Index({ uhd: { discType: 5 } }); payload[145] = 0xff;
      await writeFile(path, payload);
      const payloadDisc = await parseBdmv(root);
      expect(payloadDisc.entries).toHaveLength(2);
      expect(payloadDisc.discInfo.uhd).toBeNull();
      expect(payloadDisc.diagnostics.some((d) => d.code === "BDMV_INVALID_SECTION" && d.severity === "warning")).toBe(true);

      // An unknown entry type is skipped without discarding the index.
      const unknown = buildM1Index({ uhd: { discType: 5 } }); unknown[131] = 9;
      await writeFile(path, unknown);
      const unknownDisc = await parseBdmv(root);
      expect(unknownDisc.entries).toHaveLength(2);
      expect(unknownDisc.discInfo.uhd).toBeNull();
      expect(unknownDisc.diagnostics.some((d) => d.code === "BDMV_INVALID_SECTION")).toBe(false);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps navigation entries when AppInfoBDMV is malformed", async () => {
    const parent = await temp(); const bytes = buildM1Index(); bytes.set([0x00, 0x00, 0x01, 0x00], 40);
    const root = await skeleton(parent, bytes);
    try {
      const disc = await parseBdmv(root);
      expect(disc.entries).toHaveLength(2);
      expect(disc.discInfo.appInfo).toBeNull();
      expect(disc.diagnostics).toContainEqual(expect.objectContaining({ code: "BDMV_INVALID_SECTION", severity: "warning", sourcePath: "BDMV/index.bdmv" }));
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("bounds the INDEX extension by the file length, not the declared length", async () => {
    const parent = await temp();
    const bytes = buildM1Index({ uhd: { discType: 5 } });
    const extension = 118;
    new DataView(bytes.buffer).setUint32(extension, 20, false); // Under-reported; the entry still ends at the file boundary.
    const root = await skeleton(parent, bytes);
    try {
      const disc = await parseBdmv(root);
      expect(disc.entries).toHaveLength(2);
      expect(disc.discInfo.uhd).toMatchObject({ discType: 5, dolbyVision: false });
      expect(disc.diagnostics).toContainEqual(expect.objectContaining({ code: "BDMV_DECLARED_LENGTH_MISMATCH", severity: "warning" }));
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("parses AppInfoPlayList playback type, count, UO mask and capability flags", async () => {
    const parent = await temp(); const root = await skeleton(parent);
    await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAppInfo({ playbackType: 3, playbackCount: 7, flags: 0xf8 }));
    try {
      const appInfo = (await parseBdmv(root)).playlists[0]?.appInfo;
      expect(appInfo).toMatchObject({ playbackType: 3, playbackCount: 7, uoMask: "4604204941312", randomAccessFlag: true, audioMixFlag: true, losslessBypassFlag: true, mvcBaseViewRFlag: true, sdrConversionNotificationFlag: true, source: { path: "BDMV/PLAYLIST/00001.mpls", offset: "40" } });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps the reserved playback count unknown for non-multi-playback types", async () => {
    const parent = await temp(); const root = await skeleton(parent);
    await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAppInfo({ playbackType: 1, flags: 0 }));
    try {
      const appInfo = (await parseBdmv(root)).playlists[0]?.appInfo;
      expect(appInfo).toMatchObject({ playbackType: 1, playbackCount: null, randomAccessFlag: false, audioMixFlag: false, sdrConversionNotificationFlag: false });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("reads the real Tamako AppInfoPlayList UO mask without inventing a playback count", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const appInfo = (await parseBdmv(root)).playlists.find((playlist) => playlist.id === "00003")?.appInfo;
    expect(appInfo).toMatchObject({ playbackType: 1, playbackCount: null, uoMask: "4604204941312", randomAccessFlag: false, audioMixFlag: true, losslessBypassFlag: false });
  });

  it("treats a zero-length AppInfoPlayList as absent and keeps the playlist", async () => {
    const parent = await temp(); const root = await skeleton(parent); const bytes = buildM1EmptyPlaylist(); bytes[43] = 0;
    await writeFile(join(root, "PLAYLIST", "00001.mpls"), bytes);
    try {
      const disc = await parseBdmv(root);
      expect(disc.playlists[0]?.appInfo).toBeNull();
      expect(disc.playlists[0]?.playItems).toEqual([]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects an AppInfoPlayList too short for its UO mask", async () => {
    const parent = await temp(); const root = await skeleton(parent); const bytes = buildM1EmptyPlaylist(); bytes[43] = 11;
    await writeFile(join(root, "PLAYLIST", "00001.mpls"), bytes);
    try {
      const disc = await parseBdmv(root);
      expect(disc.playlists).toHaveLength(0);
      expect(disc.diagnostics.some((d) => d.code === "BDMV_INVALID_SECTION" && d.sourcePath === "BDMV/PLAYLIST/00001.mpls")).toBe(true);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("parses CLPI clip info header fields and ATC/STC sequence declarations", async () => {
    const parent = await temp(); const root = await skeleton(parent);
    await writeFile(join(root, "CLIPINF", "00001.clpi"), buildM1ClipInfoWithSequence());
    try {
      const clip = (await parseBdmv(root)).clips[0]!;
      expect(clip.header).toMatchObject({ streamType: 1, applicationType: 1, tsRecordingRate: 48_000_000, sourcePacketCount: 12_000, atcDelta: true, tsTypeId: "HDMV", source: { path: "BDMV/CLIPINF/00001.clpi", offset: "40" } });
      expect(clip.sequence).toMatchObject([{
        spnAtcStart: 32, offsetStcId: 0,
        stcs: [
          { pcrPid: 0x1001, spnStcStart: 32, presentationStartPts: 0, presentationEndPts: 4_500_000 },
          { pcrPid: 0x1011, spnStcStart: 8_000, presentationStartPts: 4_500_000, presentationEndPts: 9_000_000 },
        ],
        source: { path: "BDMV/CLIPINF/00001.clpi", offset: "201" },
      }]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("leaves the clip header and sequence empty when the CLPI omits both sections", async () => {
    const parent = await temp(); const root = await skeleton(parent);
    await writeFile(join(root, "CLIPINF", "00001.clpi"), buildM1EmptyClipInfo());
    try {
      const clip = (await parseBdmv(root)).clips[0]!;
      expect(clip.header).toBeNull();
      expect(clip.sequence).toEqual([]);
      expect(clip.programs).toEqual([]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("records an out-of-range CLPI TS type length and retains the clip", async () => {
    const parent = await temp(); const root = await skeleton(parent);
    const tsType = buildM1ClipInfoWithSequence(); tsType[189] = 0xff;
    await writeFile(join(root, "CLIPINF", "00001.clpi"), tsType);
    try {
      const disc = await parseBdmv(root);
      expect(disc.clips).toHaveLength(1);
      expect(disc.clips[0]?.header).toMatchObject({ tsTypeId: null });
      expect(disc.diagnostics).toContainEqual(expect.objectContaining({ code: "BDMV_DECLARED_LENGTH_MISMATCH", severity: "warning", sourcePath: "BDMV/CLIPINF/00001.clpi" }));
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("parses a CLPI whose ATC sequence length field under-reports the records", async () => {
    const parent = await temp(); const root = await skeleton(parent);
    const bytes = buildM1ClipInfoWithSequence();
    const sequenceStart = 195;
    new DataView(bytes.buffer).setUint32(sequenceStart, 1, false); // Declared length 1, records still in the file.
    await writeFile(join(root, "CLIPINF", "00001.clpi"), bytes);
    try {
      const disc = await parseBdmv(root);
      expect(disc.clips).toHaveLength(1);
      expect(disc.clips[0]?.sequence).toHaveLength(1);
      expect(disc.clips[0]?.sequence[0]?.stcs).toHaveLength(2);
      expect(disc.diagnostics).toContainEqual(expect.objectContaining({ code: "BDMV_DECLARED_LENGTH_MISMATCH", severity: "warning" }));
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("still rejects a CLPI whose ATC count exceeds the file", async () => {
    const parent = await temp(); const root = await skeleton(parent);
    const atc = buildM1ClipInfoWithSequence(); atc[200] = 0xff;
    await writeFile(join(root, "CLIPINF", "00001.clpi"), atc);
    try {
      const badAtc = await parseBdmv(root);
      expect(badAtc.clips).toHaveLength(0);
      expect(badAtc.diagnostics.some((d) => d.code === "BDMV_INVALID_COUNT" && d.sourcePath === "BDMV/CLIPINF/00001.clpi")).toBe(true);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("accepts the 0240 3D profile for index, playlist and clip metadata", async () => {
    const parent = await temp(); const root = await skeleton(parent, buildM1Index({ version: "0240" }));
    await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1EmptyPlaylist("0240"));
    await writeFile(join(root, "CLIPINF", "00001.clpi"), buildM1EmptyClipInfo("0240"));
    try {
      const disc = await parseBdmv(root);
      expect([disc.entries.length, disc.playlists.length, disc.clips.length]).toEqual([2, 1, 1]);
      expect(disc.diagnostics.some((d) => d.code === "BDMV_UNSUPPORTED_VERSION")).toBe(false);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it.each([0x00, 0xc0] as const)("rejects an index title with object type byte 0x%#", async (firstByte) => {
    const parent = await temp(); const bytes = buildM1Index({ hdmvTitle: 0, bdjTitle: "00042" }); bytes[118] = firstByte;
    const root = await skeleton(parent, bytes);
    try {
      const disc = await parseBdmv(root);
      expect(disc.entries).toHaveLength(0);
      expect(disc.diagnostics.some((d) => d.code === "BDMV_UNKNOWN_OBJECT_TYPE" && d.sourcePath === "BDMV/index.bdmv")).toBe(true);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});
