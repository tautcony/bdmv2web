/** Colour signalling and filter-chain selection for menu media encoding. */

export type VideoCodec = "h264" | "hevc";
export type HdrMode = "tonemap" | "preserve";
export type DynamicRange = "hdr10" | "hlg" | "dolby-vision" | "sdr" | "unknown";
export type ColorFilterChain = "zscale-tonemap" | "libplacebo-tonemap" | "hdr-passthrough-fallback" | "passthrough";

export interface ColorProbeFields {
  pix_fmt?: string | null;
  color_range?: string | null;
  color_space?: string | null;
  color_transfer?: string | null;
  color_primaries?: string | null;
  bits_per_raw_sample?: string | null;
  side_data_list?: Array<{ side_data_type?: string }> | null;
}

export interface SourceColor {
  dynamicRange: DynamicRange;
  primaries: string | null;
  transfer: string | null;
  matrix: string | null;
  range: string | null;
  bitDepth: number | null;
}

export interface OutputColor { primaries: string; transfer: string; matrix: string; range: string; bitDepth: 8 | 10; }

export type ColorWarningCode = "MEDIA_HDR_TONEMAP_UNAVAILABLE" | "MEDIA_HDR_CODEC_UNSUPPORTED";
export interface ColorWarning { code: ColorWarningCode; message: string; }

export interface VideoColorPlan {
  policy: HdrMode;
  source: SourceColor;
  output: OutputColor;
  filterChain: ColorFilterChain;
  /** Complete `-vf` value, including the even-dimension guard. */
  videoFilter: string;
  /** `colorprim=…:transfer=…:colormatrix=…:range=…` for the encoder's private options. */
  encoderColorParams: string;
  warnings: ColorWarning[];
}

export interface ColorPlanOptions {
  policy: HdrMode;
  codec: VideoCodec;
  hasZscale: boolean;
  hasLibplacebo: boolean;
}

/** Even-dimension guard applied to every encoded background. */
export const EVEN_DIMENSION_FILTER = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);

export function videoEncoderName(codec: VideoCodec): "libx264" | "libx265" {
  return codec === "hevc" ? "libx265" : "libx264";
}

/** Bit depth encoded in an ffmpeg pixel-format name, for example `yuv420p10le` → 10. */
export function pixelFormatBitDepth(pixelFormat: string | null | undefined): number | null {
  if (!pixelFormat) return null;
  const match = /(?:p|gbrp|gbrpf)(\d{1,2})(?:le|be)?$/.exec(pixelFormat);
  return match ? Number(match[1]) : 8;
}

export function hasDolbyVision(configuration: ColorProbeFields): boolean {
  return (configuration.side_data_list ?? []).some((entry) => /dovi|dolby\s*vision/i.test(entry.side_data_type ?? ""));
}

/**
 * Classify a source stream's dynamic range from its colour signalling.
 * Untagged streams are reported as `unknown` and encoded as BT.709 SDR.
 */
export function readSourceColor(stream: ColorProbeFields): SourceColor {
  const bitDepth = pixelFormatBitDepth(stream.pix_fmt);
  const transfer = normalise(stream.color_transfer);
  const primaries = normalise(stream.color_primaries);
  const matrix = normalise(stream.color_space);
  const range = normalise(stream.color_range);
  const wideGamut = primaries === "bt2020";
  const highBitDepth = bitDepth !== null && bitDepth > 8;

  let dynamicRange: DynamicRange;
  if (hasDolbyVision(stream)) dynamicRange = "dolby-vision";
  else if (transfer !== null && HDR_TRANSFERS.has(transfer)) dynamicRange = transfer === "arib-std-b67" ? "hlg" : "hdr10";
  else if (wideGamut && highBitDepth) dynamicRange = "hdr10";
  else if (transfer !== null || primaries !== null) dynamicRange = "sdr";
  else dynamicRange = "unknown";

  return { dynamicRange, primaries, transfer, matrix, range, bitDepth };
}

export function isHdrDynamicRange(dynamicRange: DynamicRange): boolean {
  return dynamicRange === "hdr10" || dynamicRange === "hlg" || dynamicRange === "dolby-vision";
}

/**
 * Decide the output colour tags, bit depth and filter chain.
 *
 * HDR sources use `tonemap` (SDR BT.709) by default. When neither zscale nor
 * libplacebo is available the export keeps HDR signalling and reports a warning
 * instead of failing the build.
 */
export function planVideoColor(source: SourceColor, options: ColorPlanOptions): VideoColorPlan {
  const warnings: ColorWarning[] = [];
  if (!isHdrDynamicRange(source.dynamicRange)) {
    const output: OutputColor = {
      primaries: source.primaries ?? "bt709",
      transfer: source.transfer ?? "bt709",
      matrix: source.matrix ?? "bt709",
      range: source.range ?? "tv",
      bitDepth: 8,
    };
    return {
      policy: options.policy, source, output, filterChain: "passthrough",
      videoFilter: EVEN_DIMENSION_FILTER,
      encoderColorParams: encoderColorParams(output),
      warnings,
    };
  }

  if (options.policy === "preserve") return hdrOutput(source, "passthrough", warnings, options.codec, options.policy);

  if (options.hasZscale) {
    return hdrToSdr([
      "zscale=t=linear:npl=100",
      "format=gbrpf32le",
      "zscale=p=bt709",
      "tonemap=tonemap=hable:desat=0",
      "zscale=t=bt709:m=bt709:r=tv",
      "format=yuv420p",
      EVEN_DIMENSION_FILTER,
    ].join(","), "zscale-tonemap");
  }
  if (options.hasLibplacebo) {
    return hdrToSdr([
      "libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p",
      EVEN_DIMENSION_FILTER,
    ].join(","), "libplacebo-tonemap");
  }

  const fallback = hdrOutput(source, "hdr-passthrough-fallback", warnings, options.codec, options.policy);
  fallback.warnings.push({
    code: "MEDIA_HDR_TONEMAP_UNAVAILABLE",
    message: `HDR source (${source.dynamicRange}) cannot be tone mapped because this FFmpeg build provides neither the zscale (libzimg) nor the libplacebo filter. The menu media keeps BT.2020/PQ signalling and appears washed out on SDR displays; install an FFmpeg build with libzimg or libplacebo to convert it.`,
  });
  return fallback;

  function hdrToSdr(filter: string, chain: ColorFilterChain): VideoColorPlan {
    const output: OutputColor = { primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "tv", bitDepth: 8 };
    return {
      policy: options.policy, source, output, filterChain: chain,
      videoFilter: filter, encoderColorParams: encoderColorParams(output), warnings: [...warnings],
    };
  }
}

function hdrOutput(source: SourceColor, chain: ColorFilterChain, warnings: ColorWarning[], codec: VideoCodec, policy: HdrMode): VideoColorPlan {
  const output: OutputColor = { primaries: "bt2020", transfer: "smpte2084", matrix: "bt2020nc", range: "tv", bitDepth: 10 };
  const plan: VideoColorPlan = {
    policy, source, output, filterChain: chain,
    videoFilter: `format=yuv420p10le,${EVEN_DIMENSION_FILTER}`,
    encoderColorParams: encoderColorParams(output), warnings: [...warnings],
  };
  if (codec === "h264") {
    plan.warnings.push({
      code: "MEDIA_HDR_CODEC_UNSUPPORTED",
      message: "H.264 with HDR signalling is not rendered as HDR by browsers; the menu media keeps BT.2020/PQ tags and is decoded as an SDR stream.",
    });
  }
  return plan;
}

function encoderColorParams(output: OutputColor): string {
  return `colorprim=${output.primaries}:transfer=${output.transfer}:colormatrix=${output.matrix}:range=${output.range}`;
}

function normalise(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" || trimmed === "unknown" || trimmed === "unspecified" ? null : trimmed;
}

/** Video encoder arguments for one encoded background. */
export function videoEncoderArgs(plan: VideoColorPlan, codec: VideoCodec, crf: number, preset: string): string[] {
  const encoder = videoEncoderName(codec);
  const privateOptions = codec === "hevc" ? ["-x265-params", `log-level=error:${plan.encoderColorParams}`] : ["-x264-params", plan.encoderColorParams];
  return [
    "-c:v", encoder,
    ...privateOptions,
    "-preset", preset, "-crf", String(crf),
    "-pix_fmt", `yuv420p${plan.output.bitDepth === 10 ? "10le" : ""}`,
    ...(codec === "hevc" ? ["-tag:v", "hvc1"] : []),
  ];
}

/** Throws when an encoded stream does not carry the planned codec and colour tags. */
export function assertEncodedColor(stream: ColorProbeFields & { codec_name?: string }, plan: VideoColorPlan, codec: VideoCodec, subject: string): void {
  if (stream.codec_name !== codec) throw new Error(`Encoded media '${subject}' uses codec ${stream.codec_name ?? "unknown"}; expected ${codec}.`);
  const actual: Array<[string, string | null | undefined, string]> = [
    ["color_primaries", stream.color_primaries, plan.output.primaries],
    ["color_transfer", stream.color_transfer, plan.output.transfer],
    ["color_space", stream.color_space, plan.output.matrix],
  ];
  for (const [field, value, expected] of actual) {
    const normalized = normalise(value);
    if (normalized !== expected) throw new Error(`Encoded media '${subject}' has ${field} ${normalized ?? "unspecified"}; expected ${expected} for the ${plan.filterChain} colour pipeline.`);
  }
  const bitDepth = pixelFormatBitDepth(stream.pix_fmt);
  if (bitDepth !== plan.output.bitDepth) throw new Error(`Encoded media '${subject}' has pixel format ${stream.pix_fmt ?? "unknown"} (${bitDepth ?? "unknown"}-bit); expected ${plan.output.bitDepth}-bit.`);
}
