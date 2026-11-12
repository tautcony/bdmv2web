import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { durationSeconds, exportMenuLoopMedia, MediaBudgetError, MediaToolError, pidSpecifier, resolveMenuLoopStart45k, type MediaProcessRunner, type MenuLoopMediaInput } from "./index.js";

const input: MenuLoopMediaInput = {
  sourcePath: "/source/BDMV/STREAM/00004.m2ts", sourceFile: "BDMV/STREAM/00004.m2ts", playlistId: "00003",
  playItemIndex: 0, clipId: "00004", inTime45k: 524_280, outTime45k: 5_439_815, stillMode: 0, repeatCount: 999,
  videoPid: 4113, audioTracks: [{ streamNumber: 0, pid: 4352, language: "eng" }, { streamNumber: 1, pid: 4353, language: "jpn" }],
};
const availableEncoders = " V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10\n V....D libx265 H.265 / HEVC\n A....D aac AAC (Advanced Audio Coding)\n";
const availableFilters = " TS zscale            V->V       Apply resizing, colorspace and dithering.\n .. tonemap           V->V       Conversion to/from different dynamic ranges.\n";
const encodedVideo = (codec = "hevc", duration = "109.190") => ({ index: 0, id: "0x0", codec_type: "video", codec_name: codec, width: 1920, height: 1080, duration, pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709" });
const outputPaths = (args: string[]) => args.filter((arg) => arg.endsWith(".mp4") || arg.endsWith(".m4a"));

function mediaRunner(forInput: MenuLoopMediaInput, calls: Array<{ executable: string; args: string[] }> = []): MediaProcessRunner {
  return async (executable, args) => {
    calls.push({ executable, args });
    if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
    if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
    if (args.includes("-filters")) return { stdout: availableFilters, stderr: "" };
    const path = args.at(-1)!;
    if (args[0] === "-v") {
      const duration = String(durationSeconds(forInput));
      if (path === forInput.sourcePath) return { stdout: JSON.stringify({ streams: [
        { index: 0, id: `0x${forInput.videoPid.toString(16)}`, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9", duration: "109.234" },
        ...forInput.audioTracks.map((track, index) => ({ index: index + 1, id: `0x${track.pid.toString(16)}`, codec_type: "audio", codec_name: "dts", duration: "109.226" })),
      ], format: { start_time: "11.650667", duration: "109.234" } }), stderr: "" };
      const audio = path.endsWith(".m4a");
      return { stdout: JSON.stringify({ streams: [audio
        ? { index: 0, id: "0x0", codec_type: "audio", codec_name: "aac", duration }
        : encodedVideo("hevc", duration),
      ], format: { duration } }), stderr: "" };
    }
    for (const out of outputPaths(args)) await writeFile(out, "encoded media");
    return { stdout: "", stderr: "" };
  };
}

async function writeReusableMediaManifest(directory: string, result: Awaited<ReturnType<typeof exportMenuLoopMedia>>): Promise<void> {
  await writeFile(join(directory, "asset-manifest.json"), JSON.stringify({ media: {
    plan: { playlistId: result.plan.playlistId, playItemIndex: result.plan.playItemIndex },
    background: result.background,
    audioTracks: result.audioTracks,
  } }));
}

describe("menu-loop media export", () => {
  it("maps the first PlayItem range to seconds and selects streams by declared MPEG-TS PID", () => {
    expect(durationSeconds(input)).toBeCloseTo(109.2341111111, 8);
    expect(pidSpecifier(0x1011)).toBe("0:i:0x1011");
    expect(pidSpecifier(0x1100)).toBe("0:i:0x1100");
    expect(() => pidSpecifier(0x2000)).toThrow(/out of range/);
  });

  it("uses a valid nonzero PlayMark as the menu loop segment start", () => {
    const marks = [
      { index: 0, type: 1, playItemRef: 0, time45k: 63_000 },
      { index: 1, type: 1, playItemRef: 0, time45k: 85_522 },
      { index: 2, type: 1, playItemRef: 1, time45k: 90_000 },
      { index: 3, type: 1, playItemRef: 0, time45k: 110_000 },
    ];
    expect(resolveMenuLoopStart45k(0, 63_000, 108_045, marks)).toBe(85_522);
    expect(resolveMenuLoopStart45k(1, 63_000, 108_045, marks)).toBe(90_000);
    expect(durationSeconds({ ...input, loopStart45k: 85_522 })).toBeCloseTo((input.outTime45k - 85_522) / 45_000, 8);
  });

  it("exports the intro once and preserves the loop mark as output-relative metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-intro-loop-"));
    try {
      const markedInput = { ...input, loopStart45k: input.inTime45k + 45_000, includeIntro: true };
      const calls: Array<{ executable: string; args: string[] }> = [];
      const result = await exportMenuLoopMedia(markedInput, { outputDirectory: root, runProcess: mediaRunner(markedInput, calls) });
      expect(result.plan).toMatchObject({ includeIntro: true, loopStart45k: markedInput.loopStart45k, durationSeconds: durationSeconds(input) });
      expect(result.background).toMatchObject({ loop: true, loopStartSeconds: 1, durationSeconds: durationSeconds(input) });
      const videoEncode = calls.find((call) => call.executable === "ffmpeg" && call.args.includes("0:i:0x1011"))!.args;
      expect(Number(videoEncode[videoEncode.indexOf("-ss") + 1])).toBeCloseTo(0, 5);
      expect(Number(videoEncode[videoEncode.indexOf("-t") + 1])).toBeCloseTo(durationSeconds(input), 5);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("exports one looping H.264 background and separate AAC files for each declared language", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-export-"));
    const calls: Array<{ executable: string; args: string[] }> = [];
    let encodedDuration = 109.190;
    const run: MediaProcessRunner = async (executable, args) => {
      calls.push({ executable, args });
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
      if (args.includes("-filters")) return { stdout: availableFilters, stderr: "" };
      const path = args.at(-1)!;
      if (args[0] === "-v") {
        if (path.endsWith("00004.m2ts")) return { stdout: JSON.stringify({ streams: [
          { index: 0, id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9", duration: "109.234" },
          { index: 1, id: "0x1100", codec_type: "audio", codec_name: "dts", duration: "109.226" },
          { index: 2, id: "0x1101", codec_type: "audio", codec_name: "dts", duration: "109.226" },
        ], format: { start_time: "11.650667", duration: "109.234" } }), stderr: "" };
        const audio = path.endsWith(".m4a");
        return { stdout: JSON.stringify({ streams: [audio
          ? { index: 0, id: "0x0", codec_type: "audio", codec_name: "aac", duration: String(encodedDuration) }
          : encodedVideo("hevc", String(encodedDuration)),
        ], format: { duration: String(encodedDuration) } }), stderr: "" };
      }
      for (const out of outputPaths(args)) await writeFile(out, Buffer.from("encoded media"));
      return { stdout: "", stderr: "" };
    };

    try {
      const result = await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run, crf: 22, preset: "fast" });
      expect(result.plan).toMatchObject({ status: "partial", playlistId: "00003", playItemIndex: 0, clipId: "00004", repeatCount: 999, backgroundMode: "loop-one-clip" });
      expect(result.plan.limitations).toContain("Multi-PlayItem linear precomposition and branch-specific feature media are unsupported by this menu background export contract.");
      expect(result.plan.encoding).toMatchObject({
        video: {
          codec: "hevc", pixelFormat: "yuv420p", preset: "fast", crf: 22, aspectRatioPolicy: "preserve-source-display-aspect", frameRatePolicy: "passthrough", evenDimensions: true,
          color: { policy: "tonemap", filterChain: "passthrough", output: { primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "tv", bitDepth: 8 } },
        },
        audio: { codec: "aac", bitrate: "192k" }, container: { video: "mp4", audio: "m4a", faststart: true },
      });
      expect(result.background).toMatchObject({ path: "assets/media/background.mp4", codec: "hevc", pid: 4113, width: 1920, height: 1080, loop: true });
      expect(result.audioTracks.map(({ streamNumber, pid, language, codec }) => ({ streamNumber, pid, language, codec }))).toEqual([
        { streamNumber: 0, pid: 4352, language: "eng", codec: "aac" }, { streamNumber: 1, pid: 4353, language: "jpn", codec: "aac" },
      ]);
      expect(result.files.map((file) => file.path)).toEqual([
        "assets/media/background.mp4", "assets/media/audio-1100-eng.m4a", "assets/media/audio-1101-jpn.m4a",
      ]);
      expect(calls.filter((call) => call.executable === "ffmpeg" && call.args.includes("-map")).every((call) => call.args.includes("-t"))).toBe(true);
      expect(result.tools).toMatchObject({ ffmpeg: "ffmpeg version test", ffprobe: "ffprobe version test" });
      expect(result.tools.invocations).toEqual(calls);
      expect(result.tools.invocations.some(({ executable, args }) => executable === "ffmpeg" && args.includes("-encoders"))).toBe(true);
      const stillRoot = await mkdtemp(join(tmpdir(), "bdmv-media-still-"));
      try {
        const still = await exportMenuLoopMedia({ ...input, stillMode: 2, repeatCount: 1 }, { outputDirectory: stillRoot, runProcess: run });
        expect(still.plan).toMatchObject({ repeatCount: 1, backgroundMode: "still-last-frame" });
        expect(still.background.loop).toBe(false);
        expect(still.audioTracks).toHaveLength(2);
      } finally { await rm(stillRoot, { recursive: true, force: true }); }
      const videoEncode = calls.find((call) => call.executable === "ffmpeg" && call.args.includes("-map") && call.args.includes("0:i:0x1011"))!.args;
      expect(videoEncode).toEqual(expect.arrayContaining(["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx265", "-x265-params", "log-level=error:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p", "-tag:v", "hvc1", "-aspect", "16:9", "-fps_mode", "passthrough", "-movflags", "+faststart", "-f", "mp4"]));
      const audioEncode = calls.find((call) => call.executable === "ffmpeg" && call.args.includes("0:i:0x1100"))!.args;
      expect(audioEncode).toEqual(expect.arrayContaining(["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "ipod"]));
      expect(audioEncode).toEqual(expect.arrayContaining(["0:i:0x1011", "0:i:0x1100", "0:i:0x1101"]));
      expect(audioEncode.some((arg) => arg.endsWith("background.mp4"))).toBe(true);
      expect(audioEncode.some((arg) => arg.endsWith("audio-1100-eng.m4a"))).toBe(true);
      // The plan on disk is what a later --overwrite run compares against, so the
      // explicit encoder settings must survive the write, not only the return value.
      expect(JSON.parse(await readFile(join(root, "media-plan.json"), "utf8"))).toMatchObject({
        repeatCount: 999, sourceFile: "BDMV/STREAM/00004.m2ts",
        encoding: { video: { codec: "hevc", preset: "fast", crf: 22, color: { policy: "tonemap" } } },
      });
      const scopedRoot = await mkdtemp(join(tmpdir(), "bdmv-media-scoped-"));
      try {
        const scoped = await exportMenuLoopMedia(input, { outputDirectory: scopedRoot, runProcess: run, assetDirectory: "assets/media/playlist-00018", planPath: "media-plans/playlist-00018.json" });
        expect(scoped.files.map((file) => file.path)).toEqual([
          "assets/media/playlist-00018/background.mp4", "assets/media/playlist-00018/audio-1100-eng.m4a", "assets/media/playlist-00018/audio-1101-jpn.m4a",
        ]);
        expect(JSON.parse(await readFile(join(scopedRoot, "media-plans/playlist-00018.json"), "utf8"))).toMatchObject({ playlistId: "00003", clipId: "00004" });
      } finally { await rm(scopedRoot, { recursive: true, force: true }); }
      const markedRoot = await mkdtemp(join(tmpdir(), "bdmv-media-loop-mark-"));
      try {
        encodedDuration = 1;
        const markedInput = { ...input, loopStart45k: input.inTime45k + 45_000, outTime45k: input.inTime45k + 2 * 45_000 };
        const marked = await exportMenuLoopMedia(markedInput, { outputDirectory: markedRoot, runProcess: run });
        expect(marked.plan).toMatchObject({ sourceIn45k: markedInput.inTime45k, loopStart45k: markedInput.loopStart45k, durationSeconds: 1 });
        const markedEncode = calls.filter((call) => call.args.some((arg) => arg.endsWith("background.mp4")) && call.args.includes("0:i:0x1011")).at(-1)!;
        expect(Number(markedEncode.args[markedEncode.args.indexOf("-ss") + 1])).toBeCloseTo(1, 4);
      } finally { encodedDuration = 109.190; await rm(markedRoot, { recursive: true, force: true }); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("re-encodes when the existing media plan does not match the requested PlayItem", async () => {
    const sourceDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-reuse-plan-source-"));
    const outputDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-reuse-plan-output-"));
    try {
      const previous = await exportMenuLoopMedia(input, { outputDirectory: sourceDirectory, runProcess: mediaRunner(input) });
      await writeReusableMediaManifest(sourceDirectory, previous);
      const changedInput = { ...input, outTime45k: input.outTime45k - 45_000 };
      const calls: Array<{ executable: string; args: string[] }> = [];
      const result = await exportMenuLoopMedia(changedInput, { outputDirectory, reuseFromDirectory: sourceDirectory, runProcess: mediaRunner(changedInput, calls) });
      expect(result.tools.ffmpeg).toBe("ffmpeg version test");
      expect(result.tools.invocations).toEqual(calls);
      expect(calls.some(({ executable, args }) => executable === "ffmpeg" && args.includes("-map"))).toBe(true);
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("reports the output directory size around a successful encode", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-output-size-success-"));
    try {
      const result = await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: mediaRunner(input) });
      expect(result.files).toHaveLength(3);
      expect(result.outputSize.beforeBytes).toBe("0");
      expect(BigInt(result.outputSize.afterBytes)).toBeGreaterThan(0n);
      expect(result.warnings).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reuses a clip from a directory that holds the media plan and assets only", async () => {
    const sourceDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-resume-source-"));
    const outputDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-resume-output-"));
    try {
      await exportMenuLoopMedia(input, { outputDirectory: sourceDirectory, runProcess: mediaRunner(input) });
      const calls: Array<{ executable: string; args: string[] }> = [];
      const result = await exportMenuLoopMedia(input, { outputDirectory, reuseFromDirectory: sourceDirectory, runProcess: mediaRunner(input, calls) });
      expect(calls).toHaveLength(3);
      expect(calls.every((call) => call.executable === "ffprobe" && call.args[0] === "-v")).toBe(true);
      expect(result.tools).toMatchObject({ ffmpeg: "reused", ffprobe: "reused" });
      expect(result.background).toMatchObject({ path: "assets/media/background.mp4", codec: "hevc", width: 1920, height: 1080 });
      expect(result.background.durationSeconds).toBeCloseTo(durationSeconds(input), 3);
      expect(result.audioTracks.map((track) => track.path)).toEqual(["assets/media/audio-1100-eng.m4a", "assets/media/audio-1101-jpn.m4a"]);
      expect(result.files).toHaveLength(3);
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("reuses a clip whose duration does not survive a seconds round trip", async () => {
    const sourceDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-reuse-tick-source-"));
    const outputDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-reuse-tick-output-"));
    // 3_514_500 ticks is 78.1 s, and 78.1 * 45_000 is 3_514_499.9999999995, so the
    // reuse budget has to keep the span in ticks.
    const tickInput = { ...input, inTime45k: 0, outTime45k: 3_514_500 };
    try {
      await exportMenuLoopMedia(tickInput, { outputDirectory: sourceDirectory, runProcess: mediaRunner(tickInput) });
      const result = await exportMenuLoopMedia(tickInput, { outputDirectory, reuseFromDirectory: sourceDirectory, runProcess: mediaRunner(tickInput) });
      expect(result.tools).toMatchObject({ ffmpeg: "reused", ffprobe: "reused" });
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("reuses a clip stored under a previous directory layout", async () => {
    const sourceDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-legacy-source-"));
    const outputDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-legacy-output-"));
    const legacy = { assetDirectory: "assets/media/playlist-00003-pi0", planPath: "media-plans/playlist-00003-pi0.json" };
    const current = { assetDirectory: "assets/media/playlist-00003-pi00-clip-00004", planPath: "media-plans/playlist-00003-pi00-clip-00004.json" };
    try {
      await exportMenuLoopMedia(input, { outputDirectory: sourceDirectory, ...legacy, runProcess: mediaRunner(input) });
      const calls: Array<{ executable: string; args: string[] }> = [];
      const result = await exportMenuLoopMedia(input, {
        outputDirectory, ...current, reuseFromDirectory: sourceDirectory,
        reuseAlternatives: [legacy], runProcess: mediaRunner(input, calls),
      });
      expect(result.tools).toMatchObject({ ffmpeg: "reused", ffprobe: "reused" });
      expect(result.background.path).toBe(`${current.assetDirectory}/background.mp4`);
      expect(await readFile(join(outputDirectory, result.background.path), "utf8")).toBe("encoded media");
      expect(await readFile(join(outputDirectory, current.planPath), "utf8")).toContain('"clipId": "00004"');
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("re-encodes when the stored asset duration differs from the media plan", async () => {
    const sourceDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-resume-partial-source-"));
    const outputDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-resume-partial-output-"));
    try {
      await exportMenuLoopMedia(input, { outputDirectory: sourceDirectory, runProcess: mediaRunner(input) });
      const planPath = join(sourceDirectory, "media-plan.json");
      const plan = JSON.parse(await readFile(planPath, "utf8")) as { durationSeconds: number };
      await writeFile(planPath, JSON.stringify({ ...plan, durationSeconds: plan.durationSeconds - 5 }));
      const calls: Array<{ executable: string; args: string[] }> = [];
      const result = await exportMenuLoopMedia(input, { outputDirectory, reuseFromDirectory: sourceDirectory, runProcess: mediaRunner(input, calls) });
      expect(result.tools.ffmpeg).toBe("ffmpeg version test");
      expect(calls.some(({ executable, args }) => executable === "ffmpeg" && args.includes("-map"))).toBe(true);
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("re-encodes when a required asset in the previous package is missing", async () => {
    const sourceDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-reuse-asset-source-"));
    const outputDirectory = await mkdtemp(join(tmpdir(), "bdmv-media-reuse-asset-output-"));
    try {
      const previous = await exportMenuLoopMedia(input, { outputDirectory: sourceDirectory, runProcess: mediaRunner(input) });
      await writeReusableMediaManifest(sourceDirectory, previous);
      await rm(previous.background.absolutePath);
      const calls: Array<{ executable: string; args: string[] }> = [];
      const result = await exportMenuLoopMedia(input, { outputDirectory, reuseFromDirectory: sourceDirectory, runProcess: mediaRunner(input, calls) });
      expect(result.tools.ffmpeg).toBe("ffmpeg version test");
      expect(result.tools.invocations).toEqual(calls);
      expect(calls.some(({ executable, args }) => executable === "ffmpeg" && args.includes("-map"))).toBe(true);
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("fails before encoding when a declared PID is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-export-missing-"));
    const calls: string[][] = [];
    const run: MediaProcessRunner = async (_executable, args) => {
      calls.push(args);
      if (args[0] === "-version") return { stdout: "tool version test\n", stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
      return { stdout: JSON.stringify({ streams: [{ id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }], format: { start_time: "11.650667" } }), stderr: "" };
    };
    try {
      await expect(exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run })).rejects.toThrow(/no audio stream for declared PID 4352/);
      expect(calls.some((args) => args.includes("-map"))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reports an unavailable FFmpeg executable before creating media outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-tool-missing-"));
    const run: MediaProcessRunner = async () => { throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }); };
    try {
      let caught: unknown;
      try { await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run }); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(MediaToolError);
      expect((caught as MediaToolError).diagnostic).toMatchObject({ code: "MEDIA_TOOL_UNAVAILABLE", executable: "ffmpeg", args: ["-version"] });
      await expect(readFile(join(root, "assets/media/background.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reports an unavailable FFprobe executable before creating media outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-probe-tool-missing-"));
    const run: MediaProcessRunner = async (executable, args) => {
      if (executable === "ffmpeg" && args[0] === "-version") return { stdout: "ffmpeg version test\n", stderr: "" };
      throw Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" });
    };
    try {
      let caught: unknown;
      try { await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run }); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(MediaToolError);
      expect((caught as MediaToolError).diagnostic).toMatchObject({ code: "MEDIA_TOOL_UNAVAILABLE", executable: "ffprobe", args: ["-version"] });
      await expect(readFile(join(root, "assets/media/background.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reports missing required encoders before probing or creating media outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-encoder-missing-"));
    const calls: Array<{ executable: string; args: string[] }> = [];
    const run: MediaProcessRunner = async (executable, args) => {
      calls.push({ executable, args });
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: " A..... aac AAC\n", stderr: "" };
      if (args.includes("-filters")) return { stdout: availableFilters, stderr: "" };
      throw new Error("source probing must not begin when a required encoder is absent");
    };
    try {
      let caught: unknown;
      try { await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run }); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(MediaToolError);
      expect((caught as MediaToolError).diagnostic).toMatchObject({ code: "MEDIA_ENCODER_UNAVAILABLE", executable: "ffmpeg", args: ["-hide_banner", "-encoders"] });
      expect((caught as MediaToolError).message).toMatch(/libx265/);
      expect(calls.some(({ args }) => args[0] === "-v")).toBe(false);
      await expect(readFile(join(root, "assets/media/background.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("passes paths with spaces and shell metacharacters as individual unchanged arguments", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-special-path-"));
    const sourcePath = "/disc/source clip; $(should-not-run) [menu].m2ts";
    const specialInput = { ...input, sourcePath, sourceFile: "source clip; $(should-not-run) [menu].m2ts" };
    const run: MediaProcessRunner = async (executable, args) => {
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
      if (args.includes("-filters")) return { stdout: availableFilters, stderr: "" };
      const path = args.at(-1)!;
      if (args[0] === "-v") {
        if (path === sourcePath) return { stdout: JSON.stringify({ streams: [
          { id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
          { id: "0x1100", codec_type: "audio", codec_name: "dts" },
          { id: "0x1101", codec_type: "audio", codec_name: "dts" },
        ], format: { start_time: "11.650667" } }), stderr: "" };
        const audio = path.endsWith(".m4a");
        return { stdout: JSON.stringify({ streams: [audio ? { codec_type: "audio", codec_name: "aac", duration: "109.19" } : encodedVideo("hevc", "109.19")], format: { duration: "109.19" } }), stderr: "" };
      }
      for (const out of outputPaths(args)) await writeFile(out, Buffer.from("encoded"));
      return { stdout: "", stderr: "" };
    };
    try {
      const result = await exportMenuLoopMedia(specialInput, { outputDirectory: root, runProcess: run });
      expect(result.tools.invocations.some(({ executable, args }) => executable === "ffprobe" && args.at(-1) === sourcePath)).toBe(true);
      expect(result.tools.invocations.some(({ executable, args }) => executable === "ffmpeg" && args.includes("-i") && args[args.indexOf("-i") + 1] === sourcePath)).toBe(true);
      expect(result.tools.invocations.every(({ args }) => Array.isArray(args))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("cleans a failed partial encode without writing source paths into package artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-failed-source-path-"));
    const sourcePath = "/disc/private source; $HOME/[disc].m2ts";
    const failingInput = { ...input, sourcePath };
    const run: MediaProcessRunner = async (executable, args) => {
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
      if (args.includes("-filters")) return { stdout: availableFilters, stderr: "" };
      if (args[0] === "-v") return { stdout: JSON.stringify({ streams: [
        { id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9" },
        { id: "0x1100", codec_type: "audio", codec_name: "dts" },
        { id: "0x1101", codec_type: "audio", codec_name: "dts" },
      ], format: { start_time: "11.650667" } }), stderr: "" };
      for (const out of outputPaths(args)) await writeFile(out, Buffer.from("partial bytes"));
      throw new Error(`simulated encoder failure for ${sourcePath}`);
    };
    try {
      await expect(exportMenuLoopMedia(failingInput, { outputDirectory: root, runProcess: run })).rejects.toMatchObject({
        diagnostic: { code: "MEDIA_PROCESS_FAILED", executable: "ffmpeg" },
      });
      expect(await readdir(join(root, "assets/media"))).toEqual([]);
      await expect(readFile(join(root, "media-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("cancels an active encode from AbortSignal and removes its partial output", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-cancel-job-"));
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const run: MediaProcessRunner = async (executable, args, _timeoutMs, signal) => {
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
      if (args.includes("-filters")) return { stdout: availableFilters, stderr: "" };
      if (args[0] === "-v") return { stdout: JSON.stringify({ streams: [
        { id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9" },
        { id: "0x1100", codec_type: "audio", codec_name: "dts" },
        { id: "0x1101", codec_type: "audio", codec_name: "dts" },
      ], format: { start_time: "11.650667" } }), stderr: "" };
      await writeFile(args.at(-1)!, Buffer.from("partial encode"));
      markStarted();
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
      return { stdout: "", stderr: "" };
    };
    try {
      const exporting = exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run, signal: controller.signal });
      await started;
      controller.abort();
      await expect(exporting).rejects.toMatchObject({ diagnostic: { code: "MEDIA_JOB_CANCELLED" } });
      expect(await readdir(join(root, "assets/media"))).toEqual([]);
      await expect(readFile(join(root, "media-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("times out an active fake process, reports the timeout, and cleans its output", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-timeout-job-"));
    const run: MediaProcessRunner = async (executable, args, _timeoutMs, signal) => {
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
      if (args.includes("-filters")) return { stdout: availableFilters, stderr: "" };
      if (args[0] === "-v") return { stdout: JSON.stringify({ streams: [
        { id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9" },
        { id: "0x1100", codec_type: "audio", codec_name: "dts" },
        { id: "0x1101", codec_type: "audio", codec_name: "dts" },
      ], format: { start_time: "11.650667" } }), stderr: "" };
      await writeFile(args.at(-1)!, Buffer.from("partial encode"));
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
      return { stdout: "", stderr: "" };
    };
    try {
      await expect(exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run, timeoutMs: 100 })).rejects.toMatchObject({
        diagnostic: { code: "MEDIA_JOB_TIMEOUT", executable: "ffmpeg" },
      });
      expect(await readdir(join(root, "assets/media"))).toEqual([]);
      await expect(readFile(join(root, "media-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects malformed ffprobe output even when the fake process exits successfully", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-bad-probe-"));
    const run: MediaProcessRunner = async (executable, args) => {
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
      if (args.includes("-filters")) return { stdout: availableFilters, stderr: "" };
      if (args[0] === "-v") {
        if (args.at(-1) === input.sourcePath) return { stdout: JSON.stringify({ streams: [
          { id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9" },
          { id: "0x1100", codec_type: "audio", codec_name: "dts" },
          { id: "0x1101", codec_type: "audio", codec_name: "dts" },
        ], format: { start_time: "11.650667" } }), stderr: "" };
        return { stdout: "not ffprobe json", stderr: "" };
      }
      await writeFile(args.at(-1)!, Buffer.from("encoded bytes"));
      return { stdout: "", stderr: "" };
    };
    try {
      await expect(exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run })).rejects.toMatchObject({
        diagnostic: { code: "MEDIA_OUTPUT_INVALID", executable: "ffprobe" },
      });
      expect(await readdir(join(root, "assets/media"))).toEqual([]);
      await expect(readFile(join(root, "media-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("refuses an existing invalid output at the cache target", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-invalid-cache-target-"));
    const cachedTarget = join(root, "assets/media/background.mp4");
    await mkdir(join(root, "assets/media"), { recursive: true });
    await writeFile(cachedTarget, "corrupt cached bytes");
    let calls = 0;
    const run: MediaProcessRunner = async () => { calls++; return { stdout: "", stderr: "" }; };
    try {
      await expect(exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run })).rejects.toThrow(/target already exists/);
      expect(calls).toBe(0);
      expect(await readFile(cachedTarget, "utf8")).toBe("corrupt cached bytes");
      await expect(readFile(join(root, "media-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("probes the installed tools once for a whole package", async () => {
    const first = await mkdtemp(join(tmpdir(), "bdmv-media-probe-once-a-"));
    const second = await mkdtemp(join(tmpdir(), "bdmv-media-probe-once-b-"));
    const calls: Array<{ executable: string; args: string[] }> = [];
    const run = mediaRunner(input, calls);
    const probes = (flag: string) => calls.filter((call) => call.args.includes(flag)).length;
    try {
      await exportMenuLoopMedia(input, { outputDirectory: first, runProcess: run });
      expect(probes("-encoders")).toBe(1);
      await exportMenuLoopMedia(input, { outputDirectory: second, runProcess: run });
      expect(probes("-encoders")).toBe(1);
      expect(probes("-filters")).toBe(1);
      expect(calls.filter((call) => call.args[0] === "-version")).toHaveLength(2);
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });

  it("reuses source probes when clip exports share a source cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-source-probe-cache-"));
    const calls: Array<{ executable: string; args: string[] }> = [];
    const run = mediaRunner(input, calls);
    const sourceProbeCache = new Map<string, Promise<{ stdout: string; stderr: string }>>();
    const sourceProbeCount = () => calls.filter((call) => call.executable === "ffprobe" && call.args.includes("-probesize") && call.args.at(-1) === input.sourcePath).length;
    try {
      await exportMenuLoopMedia(input, { outputDirectory: join(root, "first"), runProcess: run, sourceProbeCache });
      await exportMenuLoopMedia({ ...input, playlistId: "00002", playItemIndex: 1 }, { outputDirectory: join(root, "second"), runProcess: run, sourceProbeCache });
      expect(sourceProbeCount()).toBe(1);

      const freshBuildCache = new Map<string, Promise<{ stdout: string; stderr: string }>>();
      await exportMenuLoopMedia({ ...input, playlistId: "00003", playItemIndex: 2 }, { outputDirectory: join(root, "third"), runProcess: run, sourceProbeCache: freshBuildCache });
      expect(sourceProbeCount()).toBe(2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reports the output directory size before and after export", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-output-size-threshold-"));
    await writeFile(join(root, "existing.txt"), "keep");
    try {
      const result = await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: mediaRunner(input) });
      expect(result.outputSize.beforeBytes).toBe("4");
      expect(BigInt(result.outputSize.afterBytes)).toBeGreaterThan(4n);
      expect(result.warnings).toEqual([]);
      expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("keep");
      expect(result.plan.budget.existingOutputBytes).toBe("4");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("aborts and removes only this export's files when a media asset exceeds its cap while writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-budget-write-"));
    const preserved = join(root, "keep.txt");
    await writeFile(preserved, "keep this package file");
    let aborted = false;
    const run: MediaProcessRunner = async (executable, args, _timeoutMs, signal) => {
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
      if (args.includes("-filters")) return { stdout: availableFilters, stderr: "" };
      if (args[0] === "-v") return { stdout: JSON.stringify({ streams: [
        { index: 0, id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, duration: "109.234" },
        { index: 1, id: "0x1100", codec_type: "audio", codec_name: "dts", duration: "109.226" },
        { index: 2, id: "0x1101", codec_type: "audio", codec_name: "dts", duration: "109.226" },
      ], format: { start_time: "11.650667", duration: "109.234" } }), stderr: "" };
      if (executable === "ffmpeg") {
        for (const out of outputPaths(args)) await writeFile(out, Buffer.alloc(2048));
        await new Promise<void>((resolve) => {
          if (signal?.aborted) { aborted = true; resolve(); return; }
          signal?.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true });
        });
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };
    try {
      let caught: unknown;
      try { await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run, maxAssetBytes: 1024, estimatedVideoBitsPerSecond: 1, estimatedAudioBitsPerSecond: 1, containerOverheadPercent: 0 }); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(MediaBudgetError);
      expect((caught as MediaBudgetError).diagnostic).toMatchObject({ code: "MEDIA_ASSET_BUDGET_EXCEEDED", scope: "asset", phase: "write-monitor", actualBytes: "2048", limitBytes: "1024" });
      expect(aborted).toBe(true);
      expect(await readFile(preserved, "utf8")).toBe("keep this package file");
      await expect(readFile(join(root, "assets/media/background.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, "media-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("tone maps HDR menu sources to BT.709 and keeps HDR signalling when no tone mapping filter exists", async () => {
    const runWith = (filters: string, tonemapped: boolean): { run: MediaProcessRunner; calls: string[][] } => {
      const calls: string[][] = [];
      const run: MediaProcessRunner = async (executable, args) => {
        calls.push(args);
        if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
        if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
        if (args.includes("-filters")) return { stdout: filters, stderr: "" };
        const path = args.at(-1)!;
        if (args[0] === "-v") {
          if (path.endsWith("00004.m2ts")) return { stdout: JSON.stringify({ streams: [
            { index: 0, id: "0x1011", codec_type: "video", codec_name: "hevc", width: 3840, height: 2160, pix_fmt: "yuv420p10le", color_primaries: "bt2020", color_transfer: "smpte2084", color_space: "bt2020nc", color_range: "tv" },
            { index: 1, id: "0x1100", codec_type: "audio", codec_name: "dts" },
            { index: 2, id: "0x1101", codec_type: "audio", codec_name: "dts" },
          ], format: { start_time: "11.650667" } }), stderr: "" };
          if (path.endsWith(".m4a")) return { stdout: JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "aac", duration: "109.19" }], format: { duration: "109.19" } }), stderr: "" };
          return { stdout: JSON.stringify({ streams: [tonemapped
            ? encodedVideo("hevc", "109.19")
            : { ...encodedVideo("hevc", "109.19"), pix_fmt: "yuv420p10le", color_primaries: "bt2020", color_transfer: "smpte2084", color_space: "bt2020nc" }], format: { duration: "109.19" } }), stderr: "" };
        }
        for (const out of outputPaths(args)) await writeFile(out, Buffer.from("encoded"));
        return { stdout: "", stderr: "" };
      };
      return { run, calls };
    };

    const tonemapRoot = await mkdtemp(join(tmpdir(), "bdmv-media-hdr-tonemap-"));
    const fallbackRoot = await mkdtemp(join(tmpdir(), "bdmv-media-hdr-fallback-"));
    try {
      const tonemapped = runWith(availableFilters, true);
      const mapped = await exportMenuLoopMedia(input, { outputDirectory: tonemapRoot, runProcess: tonemapped.run });
      expect(mapped.plan.encoding.video.color).toMatchObject({ policy: "tonemap", filterChain: "zscale-tonemap", output: { primaries: "bt709", transfer: "bt709", matrix: "bt709", bitDepth: 8 } });
      expect(mapped.plan.encoding.video.pixelFormat).toBe("yuv420p");
      expect(mapped.warnings).toEqual([]);
      const mappedEncode = tonemapped.calls.find((args) => args.includes("0:i:0x1011"))!;
      const filter = mappedEncode[mappedEncode.indexOf("-vf") + 1]!;
      expect(filter).toContain("zscale=t=linear:npl=100");
      expect(filter).toContain("tonemap=tonemap=hable:desat=0");
      expect(mappedEncode).toEqual(expect.arrayContaining(["-pix_fmt", "yuv420p", "-x265-params", "log-level=error:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv"]));

      const fallback = runWith(" .. tonemap           V->V       Conversion only; no resampling filter here\n", false);
      const kept = await exportMenuLoopMedia(input, { outputDirectory: fallbackRoot, runProcess: fallback.run });
      expect(kept.plan.encoding.video.color).toMatchObject({ policy: "tonemap", filterChain: "hdr-passthrough-fallback", output: { primaries: "bt2020", transfer: "smpte2084", matrix: "bt2020nc", bitDepth: 10 } });
      expect(kept.plan.encoding.video.pixelFormat).toBe("yuv420p10le");
      expect(kept.warnings.map((warning) => warning.code)).toEqual(["MEDIA_HDR_TONEMAP_UNAVAILABLE"]);
      expect(kept.plan.limitations.some((limitation) => /tone mapping filter/.test(limitation))).toBe(true);
      const keptEncode = fallback.calls.find((args) => args.includes("0:i:0x1011"))!;
      expect(keptEncode).toEqual(expect.arrayContaining(["-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=tv"]));
    } finally {
      await rm(tonemapRoot, { recursive: true, force: true });
      await rm(fallbackRoot, { recursive: true, force: true });
    }
  });

  it("reports the measured package size after encoding", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-output-size-after-"));
    const preserved = join(root, "keep.txt");
    await writeFile(preserved, Buffer.alloc(64));
    const baseRun = mediaRunner(input);
    const run: MediaProcessRunner = async (executable, args, timeoutMs, signal, onProgress) => {
      const result = await baseRun(executable, args, timeoutMs, signal, onProgress);
      if (executable === "ffmpeg" && args.includes("-map")) for (const out of outputPaths(args)) await writeFile(out, Buffer.alloc(9_000));
      return result;
    };
    try {
      const result = await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run, maxAssetBytes: 10_000, estimatedVideoBitsPerSecond: 1, estimatedAudioBitsPerSecond: 1, containerOverheadPercent: 0 });
      expect(result.outputSize.beforeBytes).toBe("64");
      expect(BigInt(result.outputSize.afterBytes)).toBeGreaterThan(64n);
      expect(result.warnings).toEqual([]);
      expect(await readFile(preserved)).toHaveLength(64);
      expect(await readFile(join(root, "assets/media/audio-1100-eng.m4a"))).toHaveLength(9_000);
      expect(result.plan.budget.existingOutputBytes).toBe("64");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("video stream copy", () => {
  const planDuration = durationSeconds(input);
  const sourceColour = { color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709" };

  function copyRunner(copy: Partial<{ codec: string; duration: number; width: number; height: number; color_primaries: string | null }> = {}, outputDuration = planDuration): { run: MediaProcessRunner; calls: Array<{ executable: string; args: string[] }> } {
    const calls: Array<{ executable: string; args: string[] }> = [];
    // The same path is copied first and encoded after a refused copy, so the
    // probe answers for whichever command ran last.
    let lastVideo = { copy: false, codec: "hevc" };
    const run: MediaProcessRunner = async (executable, args) => {
      calls.push({ executable, args });
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
      if (args.includes("-filters")) return { stdout: availableFilters, stderr: "" };
      if (executable === "ffmpeg" && args.includes("-map")) lastVideo = { copy: args.includes("copy"), codec: args.includes("libx264") ? "h264" : "hevc" };
      const path = args.at(-1)!;
      if (args[0] === "-v") {
        if (path === input.sourcePath) return { stdout: JSON.stringify({ streams: [
          { index: 0, id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9", duration: "109.234", pix_fmt: "yuv420p", avg_frame_rate: "24000/1001", ...sourceColour },
          { index: 1, id: "0x1100", codec_type: "audio", codec_name: "dts", duration: "109.226" },
          { index: 2, id: "0x1101", codec_type: "audio", codec_name: "dts", duration: "109.226" },
        ], format: { start_time: "11.650667", duration: "109.234" } }), stderr: "" };
        if (path.endsWith(".m4a")) return { stdout: JSON.stringify({ streams: [{ index: 0, id: "0x0", codec_type: "audio", codec_name: "aac", duration: String(outputDuration) }], format: { duration: String(outputDuration) } }), stderr: "" };
        const video = lastVideo.copy
          ? { index: 0, id: "0x0", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, pix_fmt: "yuv420p", ...sourceColour, ...copy }
          : { index: 0, id: "0x0", codec_type: "video", codec_name: lastVideo.codec, width: 1920, height: 1080, pix_fmt: "yuv420p", ...sourceColour };
        const duration = String(video.duration ?? outputDuration);
        return { stdout: JSON.stringify({ streams: [{ ...video, duration }], format: { duration } }), stderr: "" };
      }
      for (const out of outputPaths(args)) await writeFile(out, Buffer.from("encoded media"));
      return { stdout: "", stderr: "" };
    };
    return { run, calls };
  }

  const videoCommands = (calls: Array<{ executable: string; args: string[] }>) => calls.filter((call) => call.executable === "ffmpeg" && call.args.includes("0:i:0x1011")).map((call) => call.args);

  it("copies the source H.264 stream when the export starts on a clip entry point", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-copy-"));
    const { run, calls } = copyRunner();
    const onEntry = { ...input, copyStart45k: input.inTime45k };
    try {
      const result = await exportMenuLoopMedia(onEntry, { outputDirectory: root, runProcess: run, videoMode: "copy" });
      expect(result.plan.encoding.video).toMatchObject({ mode: "copy", codec: "h264", pixelFormat: "yuv420p" });
      expect(result.plan.limitations).toContain("The background video is a bit-exact copy of the source H.264 stream; only its dimensions, colour signalling, and duration are verified.");
      expect(result.warnings).toEqual([]);
      expect(result.background).toMatchObject({ codec: "h264", width: 1920, height: 1080 });
      const video = videoCommands(calls)[0]!;
      expect(video).toEqual(expect.arrayContaining(["-c:v", "copy", "-movflags", "+faststart", "-f", "mp4"]));
      expect(video).not.toContain("-vf");
      expect(video.includes("-ss") ? Number(video[video.indexOf("-ss") + 1]) : 0).toBeCloseTo(0, 6);
      const audio = calls.find((call) => call.args.includes("0:i:0x1100"))!.args;
      expect(audio).toEqual(expect.arrayContaining(["-c:a", "aac", "-b:a", "192k"]));
      expect(await readFile(join(root, result.background.path))).toHaveLength(13);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("encodes instead when the segment starts well after the covering keyframe", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-copy-trimmed-"));
    const trimmed = { ...input, loopStart45k: input.inTime45k + 45_000, copyStart45k: input.inTime45k };
    const { run, calls } = copyRunner({}, durationSeconds(trimmed));
    try {
      const result = await exportMenuLoopMedia(trimmed, { outputDirectory: root, runProcess: run, videoMode: "copy" });
      expect(result.plan.encoding.video.mode).toBe("encode");
      expect(result.warnings.map((warning) => warning.code)).toEqual(["MEDIA_REMUX_UNAVAILABLE"]);
      expect(result.warnings[0]!.message).toMatch(/starts 1\.000s after the covering keyframe/);
      expect(result.plan.limitations.join("\n")).toMatch(/Video stream copy is unavailable for this clip: the segment starts 1\.000s after the covering keyframe/);
      const [video] = videoCommands(calls);
      expect(video).toEqual(expect.arrayContaining(["-c:v", "libx264"]));
      expect(video).not.toContain("copy");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("copies from the covering keyframe when the start sits inside that frame", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-copy-entry-"));
    // A menu start is a presentation time inside a frame, not a frame timestamp:
    // it lands 248 ticks (5.5 ms) after the entry point the player decodes from.
    const entry45k = input.inTime45k + 6 * 45_000 - 248;
    const started = { ...input, loopStart45k: input.inTime45k + 6 * 45_000, copyStart45k: entry45k };
    const copyDuration = (input.outTime45k - started.loopStart45k) / 45_000 + 248 / 45_000;
    const { run, calls } = copyRunner({}, copyDuration);
    try {
      const result = await exportMenuLoopMedia(started, { outputDirectory: root, runProcess: run, videoMode: "copy" });
      expect(result.plan.encoding.video.mode).toBe("copy");
      expect(result.warnings).toEqual([]);
      const video = videoCommands(calls)[0]!;
      expect(video).toEqual(expect.arrayContaining(["-c:v", "copy"]));
      const seek = Number(video[video.indexOf("-ss") + 1]);
      expect(seek).toBeCloseTo(started.loopStart45k / 45_000 - 11.650667, 6);
      const duration = Number(video[video.indexOf("-t") + 1]);
      expect(duration).toBeCloseTo(copyDuration, 6);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("encodes when the start sits past the entry-point grid", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-copy-grid-"));
    // 512 ticks is 11.4 ms: still inside the 41.7 ms frame, but outside the
    // 256-tick grid entry-point times are stored on, so it is not that frame.
    const started = { ...input, loopStart45k: input.inTime45k + 6 * 45_000, copyStart45k: input.inTime45k + 6 * 45_000 - 512 };
    const { run, calls } = copyRunner({}, durationSeconds(started));
    try {
      const result = await exportMenuLoopMedia(started, { outputDirectory: root, runProcess: run, videoMode: "copy" });
      expect(result.plan.encoding.video.mode).toBe("encode");
      expect(result.warnings[0]!.message).toMatch(/starts 0\.011s after the covering keyframe/);
      const commands = videoCommands(calls);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual(expect.arrayContaining(["-c:v", "libx264"]));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("encodes when the segment has no declared entry point to copy from", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-copy-no-entry-"));
    const { run } = copyRunner();
    try {
      const result = await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run, videoMode: "copy" });
      expect(result.plan.encoding.video.mode).toBe("encode");
      expect(result.warnings[0]!.message).toMatch(/the clip entry point for the segment is unknown/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("falls back to encoding when the copy ends at the wrong duration", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-copy-short-"));
    const { run, calls } = copyRunner({ duration: planDuration + 1 });
    try {
      const result = await exportMenuLoopMedia({ ...input, copyStart45k: input.inTime45k }, { outputDirectory: root, runProcess: run, videoMode: "copy" });
      expect(result.plan.encoding.video.mode).toBe("encode");
      expect(result.warnings.map((warning) => warning.code)).toEqual(["MEDIA_REMUX_UNAVAILABLE"]);
      expect(result.warnings[0]!.message).toMatch(/discarded after verification/);
      const commands = videoCommands(calls);
      expect(commands).toHaveLength(2);
      expect(commands[0]).toEqual(expect.arrayContaining(["-c:v", "copy"]));
      expect(commands[1]).toEqual(expect.arrayContaining(["-c:v", "libx264"]));
      expect(result.background).toMatchObject({ width: 1920, height: 1080 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("falls back to encoding when the copy loses the source colour signalling", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-copy-colour-"));
    const { run } = copyRunner({ color_primaries: null });
    try {
      const result = await exportMenuLoopMedia({ ...input, copyStart45k: input.inTime45k }, { outputDirectory: root, runProcess: run, videoMode: "copy" });
      expect(result.plan.encoding.video.mode).toBe("encode");
      expect(result.warnings[0]!.message).toMatch(/changed color_primaries from bt709 to unspecified/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("leaves an unrequested copy out of the plan and the warnings", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-copy-default-"));
    const { run, calls } = copyRunner();
    try {
      const result = await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run });
      expect(result.plan.encoding.video.mode).toBe("encode");
      expect(result.warnings).toEqual([]);
      expect(videoCommands(calls)[0]).not.toContain("copy");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
