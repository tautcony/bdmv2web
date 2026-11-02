import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildM1ClipInfoProgramAndCpi, buildM1EmptyClipInfo, buildM1EmptyPlaylist, buildM1Index, buildM1MovieObject, buildM1PlaylistGolden, buildM1PlaylistWithAudioPid, buildM1PlaylistWithSubPlayItem, buildM1Sound, buildM1SoundTwoRanges, m1MovieObjectExpected } from "@bdmv-web/test-fixtures";
import { discoverBdmvRoot, parseBdmv } from "./index.js";

async function temp(): Promise<string> { return mkdtemp(join(tmpdir(), "bdmv m1 中文 ")); }
async function write(path: string, bytes: Uint8Array): Promise<void> { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, bytes); }
async function skeleton(parent: string, index = buildM1Index()): Promise<string> {
  const root = join(parent, "BDMV");
  await mkdir(join(root, "PLAYLIST"), { recursive: true }); await mkdir(join(root, "CLIPINF"), { recursive: true }); await mkdir(join(root, "STREAM"), { recursive: true });
  await writeFile(join(root, "index.bdmv"), index); await writeFile(join(root, "MovieObject.bdmv"), buildM1MovieObject());
  return realpath(root);
}

describe("M1 BDMV discovery and structure", () => {
  it("finds a direct BDMV root and its direct parent, preserving case and Unicode paths", async () => {
    const parent = await temp(); const root = await skeleton(parent);
    try { expect(await discoverBdmvRoot(root)).toBe(root); expect(await discoverBdmvRoot(parent)).toBe(root); const disc = await parseBdmv(parent); expect(disc.root).toBe(root); expect(disc.entries[0]?.target.target).toBe(0); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("smokes the committed Tamako Love Story metadata sample without treating counts as protocol goldens", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../test-data/tamako-love-story-bd/BDMV");
    const disc = await parseBdmv(root);
    expect(disc.entries).toHaveLength(33);
    expect(disc.movieObjects).toHaveLength(17);
    expect(disc.movieObjects.reduce((count, object) => count + object.instructions.length, 0)).toBe(4969);
    const playlist = disc.playlists.find((item) => item.id === "00001");
    expect(playlist?.playItems.some((item) => item.clipId === "00002")).toBe(true);
    expect(disc.supportPrediction.status).toBe("partial");
    expect(disc.graph.nodes).toContainEqual(expect.objectContaining({ id: "clip:00002", type: "clip", state: "missing" }));
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
    try { const disc = await parseBdmv(root); expect(disc.playlists[0]?.subPaths[0]?.items[0]).toMatchObject({ clipId: "00009", inTime45k: 90_000, outTime45k: 180_000, syncPlayItemId: 1, syncPts45k: 45_000, source: { path: "BDMV/PLAYLIST/00001.mpls", offset: "214" } }); }
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
    try { await expect(parseBdmv(root)).rejects.toThrow("SYMLINK_REJECTED"); await rm(join(root, "STREAM", "escape")); const linkRoot = join(parent, "LinkedBDMV"); await symlink(root, linkRoot); await expect(discoverBdmvRoot(linkRoot)).rejects.toThrow("SYMLINK_REJECTED"); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects truncated raw MovieObject command records rather than padding them", async () => {
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
});
