import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertEncodedColor, planVideoColor, readSourceColor, videoEncoderArgs, type ColorProbeFields, type VideoColorPlan } from "./color.js";

/**
 * Real-command colour pipeline checks for the HDR/SDR export path.
 *
 * These cases encode synthetic sources with the same plan and encoder arguments
 * the exporter uses, then read the result back with `ffprobe`. They need an
 * FFmpeg build with libx264 and ffprobe; without one they are skipped instead
 * of failing the build. The tone-mapping branch additionally needs `zscale`
 * (libzimg) or `libplacebo` and is skipped when the build has neither.
 */

const FFMPEG = process.env.BDMV2WEB_FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.BDMV2WEB_FFPROBE ?? "ffprobe";

/** Source and re-encode of the same 8-bit BT.709 frame must stay within this luma difference. */
export const SDR_LUMA_TOLERANCE = 2;
/** Studio-swing limits for 8-bit luma. */
const LEGAL_LUMA = { min: 16, max: 235 };

interface Capabilities {
  ffmpeg: boolean;
  ffprobe: boolean;
  x264: boolean;
  zscale: boolean;
  libplacebo: boolean;
}

function capture(executable: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync(executable, args, { encoding: "utf8", maxBuffer: 16 << 20 });
  return { ok: result.status === 0 && !result.error, stdout: result.stdout ?? "" };
}

const capabilities: Capabilities = (() => {
  const version = capture(FFMPEG, ["-version"]);
  if (!version.ok) return { ffmpeg: false, ffprobe: false, x264: false, zscale: false, libplacebo: false };
  const filters = capture(FFMPEG, ["-hide_banner", "-filters"]).stdout;
  const encoders = capture(FFMPEG, ["-hide_banner", "-encoders"]).stdout;
  return {
    ffmpeg: true,
    ffprobe: capture(FFPROBE, ["-version"]).ok,
    x264: /\blibx264\b/.test(encoders),
    zscale: /\bzscale\b/.test(filters),
    libplacebo: /\blibplacebo\b/.test(filters),
  };
})();

const hasEncoder = capabilities.ffmpeg && capabilities.ffprobe && capabilities.x264;
const hasToneMapper = hasEncoder && (capabilities.zscale || capabilities.libplacebo);

function run(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { maxBuffer: 16 << 20 }, (error, stdout) => {
      if (error) reject(new Error(error.message));
      else resolve(stdout);
    });
  });
}

async function probeVideo(file: string): Promise<ColorProbeFields & { codec_name?: string }> {
  const output = await run(FFPROBE, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,pix_fmt,color_range,color_space,color_transfer,color_primaries,bits_per_raw_sample",
    "-of", "json",
    file,
  ]);
  const parsed = JSON.parse(output) as { streams?: Array<ColorProbeFields & { codec_name?: string }> };
  const stream = parsed.streams?.[0];
  if (!stream) throw new Error(`ffprobe reported no video stream for ${file}`);
  return stream;
}

async function encode(source: string, target: string, plan: VideoColorPlan, codec: "h264" | "hevc", crf: number): Promise<void> {
  await run(FFMPEG, [
    "-y", "-v", "error",
    "-i", source,
    "-an",
    "-vf", plan.videoFilter,
    ...videoEncoderArgs(plan, codec, crf, "ultrafast"),
    "-movflags", "+faststart",
    target,
  ]);
}

interface LumaStats { mean: number; min: number; max: number; frames: number }

async function lumaStats(file: string): Promise<LumaStats> {
  const output = await run(FFMPEG, [
    "-v", "error",
    "-i", file,
    "-vf", "signalstats,metadata=print:file=-",
    "-f", "null", "-",
  ]);
  const values = (key: string): number[] =>
    [...output.matchAll(new RegExp(`lavfi\\.signalstats\\.${key}=([0-9.]+)`, "g"))].map((match) => Number(match[1]));
  const means = values("YAVG");
  const mins = values("YMIN");
  const maxs = values("YMAX");
  if (means.length === 0) throw new Error(`no signalstats output for ${file}`);
  const average = (input: number[]): number => input.reduce((total, value) => total + value, 0) / input.length;
  return { mean: average(means), min: Math.min(...mins), max: Math.max(...maxs), frames: means.length };
}

describe.skipIf(!hasEncoder)("colour pipeline with a real FFmpeg", () => {
  let workdir = "";

  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), "bdmv2web-color-"));
  });

  afterAll(async () => {
    if (workdir !== "") await rm(workdir, { recursive: true, force: true });
  });

  it("writes BT.709 tags and keeps frame luma within tolerance for an SDR source", async () => {
    const source = join(workdir, "sdr-source.mp4");
    const encoded = join(workdir, "sdr-encoded.mp4");
    await run(FFMPEG, [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=10:duration=1",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16",
      "-pix_fmt", "yuv420p",
      "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv",
      source,
    ]);

    const sourceProbe = await probeVideo(source);
    const sourceColor = readSourceColor(sourceProbe);
    expect(sourceColor.dynamicRange).toBe("sdr");

    const plan = planVideoColor(sourceColor, {
      policy: "tonemap",
      codec: "h264",
      hasZscale: capabilities.zscale,
      hasLibplacebo: capabilities.libplacebo,
    });
    expect(plan.filterChain).toBe("passthrough");
    expect(plan.output).toEqual({ primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "tv", bitDepth: 8 });

    await encode(source, encoded, plan, "h264", 18);

    const probe = await probeVideo(encoded);
    expect(() => assertEncodedColor(probe, plan, "h264", "sdr-encoded.mp4")).not.toThrow();
    expect(probe.color_primaries).toBe("bt709");
    expect(probe.color_transfer).toBe("bt709");
    expect(probe.color_space).toBe("bt709");

    const before = await lumaStats(source);
    const after = await lumaStats(encoded);
    expect(after.frames).toBe(before.frames);
    expect(Math.abs(after.mean - before.mean)).toBeLessThanOrEqual(SDR_LUMA_TOLERANCE);
    expect(after.min).toBeGreaterThanOrEqual(LEGAL_LUMA.min);
    expect(after.max).toBeLessThanOrEqual(LEGAL_LUMA.max);
  });

  it("keeps BT.2020/PQ signalling when no tone mapping filter exists", async () => {
    if (capabilities.zscale || capabilities.libplacebo) return;
    const source = join(workdir, "hdr-source.mp4");
    const encoded = join(workdir, "hdr-fallback.mp4");
    await run(FFMPEG, [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=10:duration=1",
      "-vf", "format=yuv420p10le",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16",
      "-pix_fmt", "yuv420p10le",
      "-x264-params", "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=tv",
      source,
    ]);

    const sourceProbe = await probeVideo(source);
    expect(readSourceColor(sourceProbe).dynamicRange).toBe("hdr10");

    const plan = planVideoColor(readSourceColor(sourceProbe), {
      policy: "tonemap",
      codec: "h264",
      hasZscale: false,
      hasLibplacebo: false,
    });
    expect(plan.filterChain).toBe("hdr-passthrough-fallback");
    expect(plan.warnings.map((warning) => warning.code)).toContain("MEDIA_HDR_TONEMAP_UNAVAILABLE");

    await encode(source, encoded, plan, "h264", 18);

    const probe = await probeVideo(encoded);
    expect(() => assertEncodedColor(probe, plan, "h264", "hdr-fallback.mp4")).not.toThrow();
    expect(probe.color_primaries).toBe("bt2020");
    expect(probe.color_transfer).toBe("smpte2084");
  });

  it.skipIf(!hasToneMapper)("tone maps HDR to BT.709 with measurable 8-bit output", async () => {
    const source = join(workdir, "hdr-tonemap-source.mp4");
    const encoded = join(workdir, "hdr-tonemapped.mp4");
    await run(FFMPEG, [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=10:duration=1",
      "-vf", "format=yuv420p10le",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16",
      "-pix_fmt", "yuv420p10le",
      "-x264-params", "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=tv",
      source,
    ]);

    const sourceColor = readSourceColor(await probeVideo(source));
    expect(sourceColor.dynamicRange).toBe("hdr10");

    const plan = planVideoColor(sourceColor, {
      policy: "tonemap",
      codec: "h264",
      hasZscale: capabilities.zscale,
      hasLibplacebo: capabilities.libplacebo,
    });
    expect(plan.filterChain).toBe(capabilities.zscale ? "zscale-tonemap" : "libplacebo-tonemap");
    expect(plan.output).toEqual({ primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "tv", bitDepth: 8 });

    await encode(source, encoded, plan, "h264", 18);

    const probe = await probeVideo(encoded);
    expect(() => assertEncodedColor(probe, plan, "h264", "hdr-tonemapped.mp4")).not.toThrow();
    const stats = await lumaStats(encoded);
    expect(stats.mean).toBeGreaterThan(LEGAL_LUMA.min);
    expect(stats.mean).toBeLessThan(LEGAL_LUMA.max);
    expect(stats.max - stats.min).toBeGreaterThan(10);
  });
});
