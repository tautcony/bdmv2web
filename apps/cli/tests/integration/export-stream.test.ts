import { runCommand } from "../helpers/run-cli.js";
import { PGS_PID, syntheticNonStreamBytes, syntheticPgsStream } from "../helpers/synthetic-streams.js";
import { parsePgsSup } from "@bdmv2web/media-export";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const syntheticIgsFixture = resolve(cliRoot, "../../test-data/fixtures/igs-parser/synthetic-single-object.m2ts");
const bdmvFixture = resolve(cliRoot, "../../test-data/fixtures/synthetic-all-features/BDMV");

interface ExportStdout { stageStatus: string; output: string; assetCount: number }

async function writeStream(parent: string, name: string, bytes: Uint8Array): Promise<string> {
  const path = join(parent, name);
  await writeFile(path, bytes);
  return path;
}

describe("export from standalone stream files", async () => {
  it("exports a source-timestamped SUP track from a .rsks stream file", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-stream "));
    const output = join(parent, "out");
    try {
      const stream = await writeStream(parent, "00005.SumiSora.sc.rsks", syntheticPgsStream({ displaySets: 2, firstPts: 1_000_000n }));
      const result = await runCommand(["export", stream, "--out", output, "--type", "sup"]);
      expect(result.status, String(result.stderr)).toBe(0);
      const stdout = JSON.parse(String(result.stdout)) as ExportStdout;
      expect(stdout.stageStatus).toBe("complete");
      expect(stdout.assetCount).toBe(1);

      const sup = await readFile(join(output, "assets/subtitles/00005.SumiSora.sc-pid-1200.sup"));
      const displaySets = parsePgsSup(sup);
      expect(displaySets).toHaveLength(2);
      expect(displaySets.map((set) => set.pts90k)).toEqual([1_000_000, 1_090_000]);
      expect(displaySets[0]!.bitmaps.get(1)?.pixels).toContain(255);

      const manifest = JSON.parse(await readFile(join(output, "assets-manifest.json"), "utf8")) as { assets: Array<Record<string, unknown>> };
      expect(manifest.assets).toEqual([
        { type: "sup", path: "assets/subtitles/00005.SumiSora.sc-pid-1200.sup", byteLength: sup.byteLength, language: "und", streamNumber: 1, displaySetCount: 2 },
      ]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps the assets and reports partial when the stream carries trailing garbage", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-stream "));
    const output = join(parent, "out");
    try {
      const stream = await writeStream(parent, "clip.rsks", syntheticPgsStream({ displaySets: 2, trailerJunk: true }));
      const result = await runCommand(["export", stream, "--out", output, "--type", "sup"]);
      expect(result.status, String(result.stderr)).toBe(0);
      const stdout = JSON.parse(String(result.stdout)) as ExportStdout;
      expect(stdout.stageStatus).toBe("partial");
      expect(stdout.assetCount).toBe(1);
      const sup = await readFile(join(output, "assets/subtitles/clip-pid-1200.sup"));
      expect(parsePgsSup(sup)).toHaveLength(2);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("exports .mnu and decoded PNGs from an IGS stream file", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-stream "));
    const output = join(parent, "out");
    try {
      const result = await runCommand(["export", syntheticIgsFixture, "--out", output, "--type", "igs", "--render"]);
      expect(result.status, String(result.stderr)).toBe(0);
      const stdout = JSON.parse(String(result.stdout)) as ExportStdout;
      expect(stdout.stageStatus).toBe("complete");
      expect(stdout.assetCount).toBe(2);
      const manifest = JSON.parse(await readFile(join(output, "assets-manifest.json"), "utf8")) as { assets: Array<{ type: string; path: string; format?: string }> };
      expect(manifest.assets.map((asset) => [asset.type, asset.format ?? null])).toEqual([["igs", "mnu"], ["igs-png", null]]);
      expect(existsSync(join(output, "assets/igs/synthetic-single-object-pid-0120.mnu"))).toBe(true);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("renders display-set PNGs with seconds measured from the first display set", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-stream "));
    const output = join(parent, "out");
    try {
      const stream = await writeStream(parent, "clip.rsks", syntheticPgsStream({ displaySets: 2, firstPts: 1_000_000n }));
      const result = await runCommand(["export", stream, "--out", output, "--type", "sup", "--render"]);
      expect(result.status, String(result.stderr)).toBe(0);
      const manifest = JSON.parse(await readFile(join(output, "assets-manifest.json"), "utf8")) as { assets: Array<Record<string, unknown>> };
      const pngs = manifest.assets.filter((asset) => asset.type === "sup-png") as Array<{ path: string; displaySet: number; startSeconds: number; endSeconds: number | null }>;
      expect(pngs.map((png) => [png.displaySet, png.startSeconds, png.endSeconds])).toEqual([[1, 0, 1], [2, 1, null]]);
      expect(existsSync(join(output, pngs[0]!.path))).toBe(true);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("completes with zero assets and a warning for a stream without graphics", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-stream "));
    const output = join(parent, "out");
    try {
      const stream = await writeStream(parent, "video-only.m2ts", syntheticPgsStream({ pmtEntries: [{ pid: 0x1011, type: 0x1b }] }));
      const result = await runCommand(["export", stream, "--out", output, "--type", "all"]);
      expect(result.status, String(result.stderr)).toBe(0);
      const stdout = JSON.parse(String(result.stdout)) as ExportStdout;
      expect(stdout.stageStatus).toBe("complete");
      expect(stdout.assetCount).toBe(0);
      const manifest = JSON.parse(await readFile(join(output, "assets-manifest.json"), "utf8")) as { assets: unknown[] };
      expect(manifest.assets).toEqual([]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("honours --type when one stream declares both PGS and IGS", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-stream "));
    const output = join(parent, "out");
    try {
      const stream = await writeStream(parent, "mixed.rsks", syntheticPgsStream({ pmtEntries: [{ pid: PGS_PID, type: 0x90 }, { pid: 0x1100, type: 0x91 }] }));
      const result = await runCommand(["export", stream, "--out", output, "--type", "igs"]);
      expect(result.status, String(result.stderr)).toBe(0);
      const manifest = JSON.parse(await readFile(join(output, "assets-manifest.json"), "utf8")) as { assets: unknown[] };
      expect(manifest.assets).toEqual([]);
      expect(existsSync(join(output, "assets/subtitles"))).toBe(false);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects clip selection and undeclared PIDs with CLI_EXPORT_SELECTION", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-stream "));
    const output = join(parent, "out");
    try {
      const stream = await writeStream(parent, "clip.rsks", syntheticPgsStream({ displaySets: 1 }));
      const clipResult = await runCommand(["export", stream, "--out", output, "--m2ts", "00005"]);
      expect(clipResult.status).toBe(1);
      expect(String(clipResult.stderr)).toContain("CLI_EXPORT_SELECTION");
      expect(existsSync(output)).toBe(false);

      const pidResult = await runCommand(["export", stream, "--out", output, "--pid", "0x1100"]);
      expect(pidResult.status).toBe(1);
      expect(String(pidResult.stderr)).toContain("CLI_EXPORT_SELECTION");
      expect(existsSync(output)).toBe(false);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("fails EXPORT_INVALID_STREAM before writing output for a non-stream file", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-stream "));
    const output = join(parent, "out");
    try {
      const garbage = await writeStream(parent, "garbage.rsks", syntheticNonStreamBytes());
      const result = await runCommand(["export", garbage, "--out", output, "--type", "sup"]);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain("EXPORT_INVALID_STREAM");
      expect(existsSync(output)).toBe(false);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("fails EXPORT_INVALID_STREAM when a declared PGS PID carries no display sets", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-stream "));
    const output = join(parent, "out");
    try {
      const stream = await writeStream(parent, "empty-pgs.rsks", syntheticPgsStream({ displaySets: 0 }));
      const result = await runCommand(["export", stream, "--out", output, "--type", "sup"]);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain("EXPORT_INVALID_STREAM");
      expect(existsSync(output)).toBe(false);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps stderr silent unless --progress asks for step lines", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-stream "));
    try {
      const stream = await writeStream(parent, "clip.rsks", syntheticPgsStream({ displaySets: 2, firstPts: 1_000_000n }));
      const quiet = await runCommand(["export", stream, "--out", join(parent, "quiet"), "--type", "sup", "--render"]);
      expect(quiet.status, String(quiet.stderr)).toBe(0);
      expect(String(quiet.stderr)).toBe("");

      // A piped stderr cannot host a live line, so --progress degrades to one plain
      // line per started step plus a tenth of ratio reports, matching `build`.
      const loud = await runCommand(["export", stream, "--out", join(parent, "loud"), "--type", "sup", "--render", "--progress"]);
      expect(loud.status, String(loud.stderr)).toBe(0);
      const lines = String(loud.stderr).split("\n");
      expect(lines[0]).toContain("bdmv2web export");
      for (const step of ["Probe stream tables", "Extract graphics streams", "Decode display sets", "Write manifest and commit"]) {
        expect(lines).toContainEqual(expect.stringContaining(step));
      }
      expect(lines).toContainEqual(expect.stringMatching(/\s+100% {2}\d+\/2 display sets$/));
      expect(JSON.parse(String(loud.stdout))).toMatchObject({ stageStatus: "complete", assetCount: 3 });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});

describe("export input detection and analysis", async () => {
  it("rejects a standalone .sup file and points at render", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-analysis "));
    try {
      const sup = join(parent, "track.sup");
      await writeFile(sup, Buffer.from("PG\u0000\u0000", "latin1"));
      const result = await runCommand(["export", sup, "--out", join(parent, "out")]);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain("CLI_EXPORT_SELECTION");
      expect(String(result.stderr)).toContain("Use render");
      expect(existsSync(join(parent, "out"))).toBe(false);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("writes the metadata artifact set for --type metadata and for --type all", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-metadata "));
    const output = join(parent, "out");
    try {
      const result = await runCommand(["export", bdmvFixture, "--out", output, "--type", "metadata"]);
      expect(result.status, String(result.stderr)).toBe(0);
      // Metadata-only runs keep the old analysis stdout contract and write no asset manifest.
      const stdout = JSON.parse(String(result.stdout)) as Record<string, unknown>;
      expect(stdout).toMatchObject({ stageStatus: "complete" });
      expect(stdout.assetCount).toBeUndefined();
      expect(String(stdout.output).endsWith("/out")).toBe(true);
      expect(existsSync(join(output, "assets-manifest.json"))).toBe(false);
      const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as { selectedTypes: string[]; files: Array<{ path: string; kind: string }> };
      expect(manifest.selectedTypes).toEqual(["hdmv", "igs", "sup"]);
      expect(manifest.files.map((file) => file.kind).sort()).toEqual(["external-media-targets", "hdmv-command-table", "hdmv-source-map", "igs-diagnostics", "igs-scenes", "parsed-disc", "source-map", "sup-track-index"]);
      expect(existsSync(join(output, "assets"))).toBe(false);

      // `all` is the same metadata set plus the containers it already wrote.
      const combined = join(parent, "all");
      const both = await runCommand(["export", bdmvFixture, "--out", combined, "--type", "all"]);
      expect(both.status, String(both.stderr)).toBe(0);
      expect(existsSync(join(combined, "manifest.json"))).toBe(true);
      expect(existsSync(join(combined, "assets-manifest.json"))).toBe(true);
      expect(existsSync(join(combined, "assets/igs"))).toBe(true);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("exports structural metadata from a stream file without writing containers", async () => {
    const parent = await mkdtemp(join(tmpdir(), "export-analysis "));
    const output = join(parent, "out");
    try {
      const stream = await writeStream(parent, "clip.rsks", syntheticPgsStream({ displaySets: 2 }));
      const result = await runCommand(["export", stream, "--out", output, "--type", "sup", "--metadata-only"]);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(existsSync(join(output, "assets-manifest.json"))).toBe(false);
      expect(existsSync(join(output, "assets"))).toBe(false);
      const tracks = JSON.parse(await readFile(join(output, "sup/tracks.json"), "utf8")) as { tracks: Array<Record<string, unknown>> };
      expect(tracks.tracks).toEqual([{ clipId: "clip", pid: PGS_PID, language: "und", streamNumber: 1, displaySetCount: 2, byteLength: expect.any(Number) }]);
      const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as { selectedTypes: string[] };
      expect(manifest.selectedTypes).toEqual(["sup"]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});
