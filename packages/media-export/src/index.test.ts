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
const availableEncoders = " V....D libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10\n A....D aac AAC (Advanced Audio Coding)\n";

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

  it("exports one looping H.264 background and separate AAC files for each declared language", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-export-"));
    const calls: Array<{ executable: string; args: string[] }> = [];
    let encodedDuration = 109.190;
    const run: MediaProcessRunner = async (executable, args) => {
      calls.push({ executable, args });
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
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
          : { index: 0, id: "0x0", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, duration: String(encodedDuration) },
        ], format: { duration: String(encodedDuration) } }), stderr: "" };
      }
      await writeFile(path, Buffer.from("encoded media"));
      return { stdout: "", stderr: "" };
    };

    try {
      const result = await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run, crf: 22, preset: "fast" });
      expect(result.plan).toMatchObject({ status: "partial", playlistId: "00003", playItemIndex: 0, clipId: "00004", repeatCount: 999, backgroundMode: "loop-one-clip" });
      expect(result.plan.limitations).toContain("Multi-PlayItem linear precomposition and branch-specific feature media are unsupported by this menu background export contract.");
      expect(result.plan.encoding).toEqual({
        video: { codec: "h264", pixelFormat: "yuv420p", preset: "fast", crf: 22, aspectRatioPolicy: "preserve-source-display-aspect", frameRatePolicy: "passthrough", evenDimensions: true },
        audio: { codec: "aac", bitrate: "192k" }, container: { video: "mp4", audio: "m4a", faststart: true },
      });
      expect(result.background).toMatchObject({ path: "assets/media/background.mp4", codec: "h264", pid: 4113, width: 1920, height: 1080, loop: true });
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
      expect(videoEncode).toEqual(expect.arrayContaining(["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p", "-aspect", "16:9", "-fps_mode", "passthrough", "-movflags", "+faststart", "-f", "mp4"]));
      const audioEncode = calls.find((call) => call.executable === "ffmpeg" && call.args.includes("0:i:0x1100"))!.args;
      expect(audioEncode).toEqual(expect.arrayContaining(["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "ipod"]));
      expect(calls.find((call) => call.args.at(-1)?.endsWith("background.mp4"))?.args).toContain("0:i:0x1011");
      expect(calls.find((call) => call.args.at(-1)?.endsWith("audio-1100-eng.m4a"))?.args).toContain("0:i:0x1100");
      expect(calls.filter((call) => call.executable === "ffmpeg" && call.args.includes("-map")).every((call) => call.args.includes("-ss") && call.args.includes("0"))).toBe(true);
      expect(JSON.parse(await readFile(join(root, "media-plan.json"), "utf8"))).toMatchObject({ repeatCount: 999, sourceFile: "BDMV/STREAM/00004.m2ts" });
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
        const markedEncode = calls.filter((call) => call.args.at(-1)?.endsWith("background.mp4") && call.args.includes("0:i:0x1011")).at(-1)!;
        expect(Number(markedEncode.args[markedEncode.args.indexOf("-ss") + 1])).toBeCloseTo(1, 4);
      } finally { encodedDuration = 109.190; await rm(markedRoot, { recursive: true, force: true }); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("fails before encoding when a declared PID is absent instead of choosing another stream", async () => {
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
      throw new Error("source probing must not begin when a required encoder is absent");
    };
    try {
      let caught: unknown;
      try { await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run }); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(MediaToolError);
      expect((caught as MediaToolError).diagnostic).toMatchObject({ code: "MEDIA_ENCODER_UNAVAILABLE", executable: "ffmpeg", args: ["-hide_banner", "-encoders"] });
      expect((caught as MediaToolError).message).toMatch(/libx264/);
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
      const path = args.at(-1)!;
      if (args[0] === "-v") {
        if (path === sourcePath) return { stdout: JSON.stringify({ streams: [
          { id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
          { id: "0x1100", codec_type: "audio", codec_name: "dts" },
          { id: "0x1101", codec_type: "audio", codec_name: "dts" },
        ], format: { start_time: "11.650667" } }), stderr: "" };
        const audio = path.endsWith(".m4a");
        return { stdout: JSON.stringify({ streams: [audio ? { codec_type: "audio", codec_name: "aac", duration: "109.19" } : { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, duration: "109.19" }], format: { duration: "109.19" } }), stderr: "" };
      }
      await writeFile(path, Buffer.from("encoded"));
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
      if (args[0] === "-v") return { stdout: JSON.stringify({ streams: [
        { id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9" },
        { id: "0x1100", codec_type: "audio", codec_name: "dts" },
        { id: "0x1101", codec_type: "audio", codec_name: "dts" },
      ], format: { start_time: "11.650667" } }), stderr: "" };
      const path = args.at(-1)!;
      await writeFile(path, Buffer.from("partial bytes"));
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

  it("refuses an existing invalid output at the cache target instead of reusing or overwriting it", async () => {
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

  it("rejects an over-budget package estimate before creating assets and preserves its diagnostic", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-budget-preflight-"));
    await writeFile(join(root, "existing.txt"), "keep");
    let calls = 0;
    const run: MediaProcessRunner = async () => { calls++; return { stdout: "", stderr: "" }; };
    try {
      let caught: unknown;
      try {
        await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run, maxOutputBytes: 1 });
      } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(MediaBudgetError);
      expect((caught as MediaBudgetError).diagnostic).toMatchObject({ code: "MEDIA_OUTPUT_BUDGET_EXCEEDED", scope: "package", phase: "preflight-estimate", limitBytes: "1" });
      expect(calls).toBe(0);
      expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("keep");
      await expect(readFile(join(root, "assets/media/background.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
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
      const path = args.at(-1)!;
      if (args[0] === "-v") return { stdout: JSON.stringify({ streams: [
        { index: 0, id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, duration: "109.234" },
        { index: 1, id: "0x1100", codec_type: "audio", codec_name: "dts", duration: "109.226" },
        { index: 2, id: "0x1101", codec_type: "audio", codec_name: "dts", duration: "109.226" },
      ], format: { start_time: "11.650667", duration: "109.234" } }), stderr: "" };
      if (executable === "ffmpeg") {
        await writeFile(path, Buffer.alloc(2048));
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
      try { await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run, maxAssetBytes: 1024, maxOutputBytes: 10_000, estimatedVideoBitsPerSecond: 1, estimatedAudioBitsPerSecond: 1, containerOverheadPercent: 0 }); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(MediaBudgetError);
      expect((caught as MediaBudgetError).diagnostic).toMatchObject({ code: "MEDIA_ASSET_BUDGET_EXCEEDED", scope: "asset", phase: "write-monitor", actualBytes: "2048", limitBytes: "1024" });
      expect(aborted).toBe(true);
      expect(await readFile(preserved, "utf8")).toBe("keep this package file");
      await expect(readFile(join(root, "assets/media/background.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, "media-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("enforces maxOutputBytes across existing package files plus assets, independently of maxAssetBytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-media-package-budget-write-"));
    const preserved = join(root, "keep.txt");
    await writeFile(preserved, Buffer.alloc(64));
    const run: MediaProcessRunner = async (executable, args, _timeoutMs, signal) => {
      if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: availableEncoders, stderr: "" };
      const path = args.at(-1)!;
      if (args[0] === "-v") return { stdout: JSON.stringify({ streams: [
        { index: 0, id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, duration: "109.234" },
        { index: 1, id: "0x1100", codec_type: "audio", codec_name: "dts", duration: "109.226" },
        { index: 2, id: "0x1101", codec_type: "audio", codec_name: "dts", duration: "109.226" },
      ], format: { start_time: "11.650667", duration: "109.234" } }), stderr: "" };
      if (executable === "ffmpeg") {
        await writeFile(path, Buffer.alloc(9_000));
        await new Promise<void>((resolve) => {
          if (signal?.aborted) { resolve(); return; }
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      return { stdout: "", stderr: "" };
    };
    try {
      let caught: unknown;
      try { await exportMenuLoopMedia(input, { outputDirectory: root, runProcess: run, maxAssetBytes: 10_000, maxOutputBytes: 8_192, estimatedVideoBitsPerSecond: 1, estimatedAudioBitsPerSecond: 1, containerOverheadPercent: 0 }); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(MediaBudgetError);
      expect((caught as MediaBudgetError).diagnostic).toMatchObject({ code: "MEDIA_OUTPUT_BUDGET_EXCEEDED", scope: "package", phase: "write-monitor", limitBytes: "8192" });
      expect(BigInt((caught as MediaBudgetError).diagnostic.actualBytes!)).toBeGreaterThan(8_192n);
      expect(await readFile(preserved)).toHaveLength(64);
      await expect(readFile(join(root, "assets/media/background.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, "media-plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
