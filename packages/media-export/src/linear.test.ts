import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceLocation } from "@bdmv-web/bdmv-parser";
import type { MediaPlan, MediaPlanRequirement } from "./media-plan.js";
import { exportLinearMedia, type LinearProcessRunner } from "./linear.js";

const playlistSource: SourceLocation = { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "20" };
const streamSource: SourceLocation = { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "100" };

function plannedItem(index: number, clipId: string, inTime45k: number, outTime45k: number, options: { angle?: boolean } = {}): MediaPlanRequirement["playItems"][number] {
  return {
    index, clipId, codecId: "M2TS", stcId: 0, source: streamSource,
    streamFile: { path: `BDMV/STREAM/${clipId}.m2ts`, present: true, source: { path: `BDMV/STREAM/${clipId}.m2ts`, origin: "primary", offset: "0" } },
    clipInfo: { id: clipId, present: true, source: { path: `BDMV/CLIPINF/${clipId}.clpi`, origin: "primary", offset: "0" } },
    sourceIn45k: inTime45k, sourceOut45k: outTime45k, sourceIn90k: String(inTime45k * 2), sourceOut90k: String(outTime45k * 2),
    duration90k: String((outTime45k - inTime45k) * 2), durationSeconds: (outTime45k - inTime45k) / 45_000,
    connectionCondition: 0, stillMode: 0, stillTime: 0, uoMask: "0",
    angle: { multiAngle: options.angle ?? false, angleCount: options.angle ? 2 : 1, differentAudio: false, seamlessAngle: false },
    tracks: [
      { role: "video", streamType: 1, codingType: 0x1b, pid: 0x1011, subPathId: null, subClipId: null, language: null, source: streamSource },
      { role: "audio", streamType: 1, codingType: 0x81, pid: 0x1100, subPathId: null, subClipId: null, language: "eng", source: streamSource },
    ],
    strategy: { grouping: "per-play-item", container: "mp4", video: "h264", audio: "aac", status: "planned", reasons: [] },
    estimate: { bytes: "1000", rateBitsPerSecond: 8_192_000 },
  };
}

function route(playlistId: string): MediaPlanRequirement["routes"][number] {
  return { playlistId: `playlist:${playlistId}`, origin: "entry", entryId: "first-play", entrySource: playlistSource, buttonProgramId: null, navigationEdges: [] };
}

function requirement(playlistId: string, items: MediaPlanRequirement["playItems"], subPaths: MediaPlanRequirement["subPaths"] = []): MediaPlanRequirement {
  return { playlistId, playlistSource, routes: [route(playlistId)], playItems: items, subPaths };
}

function mediaPlan(requirements: MediaPlanRequirement[], complete = true): MediaPlan {
  return {
    schemaVersion: "1.0", status: "partial", reachability: { complete, explored: 4, unknown: [] },
    strategy: { grouping: "per-play-item", container: "mp4", video: "h264", audio: "aac", transcodingStarted: false },
    budget: { estimatedVideoBitsPerSecond: 8_000_000, estimatedAudioBitsPerSecond: 192_000, containerOverheadPercent: 5, estimatedDuration90k: "270000", knownSubtotalBytes: "10000", estimatedTotalBytes: "10000", estimateBasis: "configured-target-bitrate-assumption", status: "estimated", deduplicationApplied: false },
    capabilityReport: { inspectedStages: ["M1"], notInspectedStages: ["M2"], strictUpgradeAllowed: false, impacts: [] },
    requirements, diagnostics: [],
  };
}

async function makeSourceTree(root: string, clipIds: string[]): Promise<void> {
  await mkdir(join(root, "BDMV/STREAM"), { recursive: true });
  for (const clipId of clipIds) await writeFile(join(root, "BDMV/STREAM", `${clipId}.m2ts`), "synthetic fixture source placeholder");
}

function fakeRunner(options: { failOutputPath?: string } = {}): { run: LinearProcessRunner; calls: Array<{ executable: string; args: string[] }> } {
  const calls: Array<{ executable: string; args: string[] }> = [];
  const durationByOutput = new Map<string, string>();
  const run: LinearProcessRunner = async (executable, args) => {
    calls.push({ executable, args: [...args] });
    if (args[0] === "-version") return { stdout: `${executable} version synthetic\n`, stderr: "" };
    if (args.includes("-encoders")) return { stdout: " V....D libx264 H.264 encoder\n A....D aac AAC encoder\n", stderr: "" };
    if (args[0] === "-v") {
      const path = args.at(-1)!;
      if (path.endsWith(".m2ts")) return { stdout: JSON.stringify({ streams: [
        { index: 0, id: "0x1011", codec_type: "video", codec_name: "mpeg2video", width: 1920, height: 1080, display_aspect_ratio: "16:9" },
        { index: 1, id: "0x1100", codec_type: "audio", codec_name: "dts", sample_rate: "48000", channels: 2 },
        { index: 2, id: "0x1101", codec_type: "audio", codec_name: "dts", sample_rate: "48000", channels: 2 },
      ], format: { start_time: "0" } }), stderr: "" };
      const duration = durationByOutput.get(path) ?? "1.000";
      return { stdout: JSON.stringify({ streams: [
        { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9", duration },
        { index: 1, codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, duration },
      ], format: { duration } }), stderr: "" };
    }
    const outputPath = args.at(-1)!;
    const concat = args[args.indexOf("-filter_complex") + 1]?.match(/concat=n=(\d+):/);
    durationByOutput.set(outputPath, `${Number(concat?.[1] ?? 1).toFixed(3)}`);
    await writeFile(outputPath, "synthetic h264 aac output");
    if (outputPath === options.failOutputPath) throw new Error("synthetic second branch failure");
    return { stdout: "", stderr: "" };
  };
  return { run, calls };
}

describe("linear playlist media export", () => {
  it("concatenates PlayItems in order and emits each Playlist branch separately from the looping background", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "bdmv-linear-source-"));
    const output = await mkdtemp(join(tmpdir(), "bdmv-linear-output-"));
    const plan = mediaPlan([
      requirement("00001", [plannedItem(0, "00001", 45_000, 90_000), plannedItem(1, "00002", 135_000, 180_000)]),
      requirement("00002", [plannedItem(0, "00003", 0, 45_000)]),
    ]);
    await makeSourceTree(sourceRoot, ["00001", "00002", "00003"]);
    await mkdir(join(output, "assets/media"), { recursive: true });
    const backgroundPath = join(output, "assets/media/background.mp4");
    await writeFile(backgroundPath, "independent looping menu background");
    const { run, calls } = fakeRunner();
    try {
      const result = await exportLinearMedia(plan, { sourceRoot, outputDirectory: output, runProcess: run, crf: 21, preset: "fast" });
      expect(result.assets.map((asset) => asset.path)).toEqual([
        "assets/media/playlist-00001-audio-eng.mp4", "assets/media/playlist-00002-audio-eng.mp4",
      ]);
      expect(result.assets[0]).toMatchObject({ playlistId: "00001", audioLanguage: "eng", repeat: false, durationSeconds: 2, width: 1920, height: 1080 });
      expect(result.assets[0]!.mappings.map(({ playItemIndex, playlistStart45k, playlistEnd45k }) => ({ playItemIndex, playlistStart45k, playlistEnd45k }))).toEqual([
        { playItemIndex: 0, playlistStart45k: "0", playlistEnd45k: "45000" },
        { playItemIndex: 1, playlistStart45k: "45000", playlistEnd45k: "90000" },
      ]);
      expect(result.plan.strategy).toEqual({ branches: "one-linear-asset-per-playlist-and-audio-language", menuBackground: "separate-looping-asset", menuBackgroundPath: "assets/media/background.mp4", sourceStreamsPackaged: false });
      expect(await readFile(backgroundPath, "utf8")).toBe("independent looping menu background");
      const commands = calls.filter((call) => call.executable === "ffmpeg" && call.args.includes("-filter_complex"));
      expect(commands).toHaveLength(2);
      const branchOne = commands.find((call) => call.args.at(-1)?.endsWith("playlist-00001-audio-eng.mp4"))!.args;
      const branchTwo = commands.find((call) => call.args.at(-1)?.endsWith("playlist-00002-audio-eng.mp4"))!.args;
      expect(branchOne.filter((argument) => argument === "-i")).toHaveLength(2);
      expect(branchOne[branchOne.indexOf("-filter_complex") + 1]).toContain("concat=n=2:v=1:a=1");
      expect(branchOne).toContain(join(sourceRoot, "BDMV/STREAM/00001.m2ts"));
      expect(branchOne).toContain(join(sourceRoot, "BDMV/STREAM/00002.m2ts"));
      expect(branchOne).not.toContain(join(sourceRoot, "BDMV/STREAM/00003.m2ts"));
      expect(branchTwo.filter((argument) => argument === "-i")).toHaveLength(1);
      expect(branchTwo[branchTwo.indexOf("-filter_complex") + 1]).toContain("concat=n=1:v=1:a=1");
      expect(branchTwo).toContain(join(sourceRoot, "BDMV/STREAM/00003.m2ts"));
      expect(branchTwo).not.toContain(join(sourceRoot, "BDMV/STREAM/00001.m2ts"));
      expect(branchOne).toEqual(expect.arrayContaining(["-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", "-aspect", "16:9", "-fps_mode", "passthrough", "-preset", "fast", "-crf", "21"]));
      const saved = await readFile(join(output, "linear-media-plan.json"), "utf8");
      expect(saved).not.toContain("STREAM/00001.m2ts");
      expect(saved).not.toContain("STREAM/00002.m2ts");
      expect(saved).not.toContain("STREAM/00003.m2ts");
      expect(result.plan.assets.map((asset) => asset.path)).not.toContain("assets/media/background.mp4");
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  it("persists per-PlayItem PSR1 stream numbers independently of language-sorted variant order", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "bdmv-linear-stream-map-source-"));
    const output = await mkdtemp(join(tmpdir(), "bdmv-linear-stream-map-output-"));
    const first = plannedItem(0, "00001", 0, 45_000);
    const second = plannedItem(1, "00002", 45_000, 90_000);
    const video = first.tracks[0]!;
    first.tracks = [video, { ...first.tracks[1]!, pid: 0x1100, language: "eng" }, { ...first.tracks[1]!, pid: 0x1101, language: "jpn" }];
    second.tracks = [video, { ...second.tracks[1]!, pid: 0x1101, language: "jpn" }, { ...second.tracks[1]!, pid: 0x1100, language: "eng" }];
    await makeSourceTree(sourceRoot, ["00001", "00002"]);
    try {
      const result = await exportLinearMedia(mediaPlan([requirement("00001", [first, second])]), { sourceRoot, outputDirectory: output, runProcess: fakeRunner().run });
      expect(result.assets.map((asset) => asset.audioLanguage)).toEqual(["eng", "jpn"]);
      expect(result.assets.find((asset) => asset.audioLanguage === "jpn")?.mappings.map((mapping) => mapping.primaryAudioStreamNumber)).toEqual([2, 1]);
      expect(result.assets.find((asset) => asset.audioLanguage === "eng")?.mappings.map((mapping) => mapping.primaryAudioStreamNumber)).toEqual([1, 2]);
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  it("retains advanced subpath limits as diagnostics and does not publish branch assets after an encoding failure", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "bdmv-linear-failure-source-"));
    const output = await mkdtemp(join(tmpdir(), "bdmv-linear-failure-output-"));
    const subPathSource: SourceLocation = { path: "BDMV/PLAYLIST/00002.mpls", origin: "primary", offset: "200" };
    const subPath: MediaPlanRequirement["subPaths"][number] = {
      index: 0, type: 1, repeat: false, source: subPathSource,
      items: [{ clipId: "00004", codecId: "M2TS", stcId: 0, sourceIn45k: 0, sourceOut45k: 45_000, syncPlayItemId: 0, syncPts45k: 0, source: subPathSource, streamFile: { path: "BDMV/STREAM/00004.m2ts", present: true, source: subPathSource }, clipInfo: { id: "00004", present: true, source: subPathSource }, tracks: [] }],
      status: "unsupported", reason: "secondary path behavior remains unsupported",
    };
    const plan = mediaPlan([requirement("00001", [plannedItem(0, "00001", 0, 45_000)]), requirement("00002", [plannedItem(0, "00003", 0, 45_000)], [subPath])]);
    await makeSourceTree(sourceRoot, ["00001", "00003"]);
    const failedPath = join(output, "assets/media/playlist-00002-audio-eng.mp4");
    const { run } = fakeRunner({ failOutputPath: failedPath });
    try {
      await expect(exportLinearMedia(plan, { sourceRoot, outputDirectory: output, runProcess: run })).rejects.toMatchObject({ diagnostic: { code: "MEDIA_PROCESS_FAILED" } });
      expect(await readdir(join(output, "assets/media"))).toEqual([]);
      await expect(readFile(join(output, "linear-media-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  it("keeps uncertain angle and incomplete reachability visible instead of exporting a flattened path", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "bdmv-linear-partial-source-"));
    const output = await mkdtemp(join(tmpdir(), "bdmv-linear-partial-output-"));
    await makeSourceTree(sourceRoot, ["00001"]);
    const { run } = fakeRunner();
    try {
      const result = await exportLinearMedia(mediaPlan([requirement("00001", [plannedItem(0, "00001", 0, 45_000, { angle: true })])], false), { sourceRoot, outputDirectory: output, runProcess: run });
      expect(result.plan.status).toBe("partial");
      expect(result.plan.assets).toEqual([]);
      expect(result.plan.diagnostics.map((item) => item.code)).toContain("MEDIA_REACHABILITY_INCOMPLETE");
      expect(result.plan.diagnostics.map((item) => item.code)).toContain("MEDIA_ANGLE_UNSUPPORTED");
      expect(result.tools.invocations.some(({ executable, args }) => executable === "ffmpeg" && args.includes("-filter_complex"))).toBe(false);
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });
});
