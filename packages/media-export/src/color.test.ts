import { describe, expect, it } from "vitest";
import { assertEncodedColor, pixelFormatBitDepth, planVideoColor, readSourceColor, videoEncoderArgs } from "./color.js";

const hdr10Source = () => readSourceColor({ pix_fmt: "yuv420p10le", color_primaries: "bt2020", color_transfer: "smpte2084", color_space: "bt2020nc", color_range: "tv" });

describe("menu media colour pipeline", () => {
  it("classifies HDR10, HLG, Dolby Vision, SDR and untagged sources", () => {
    expect(readSourceColor({ pix_fmt: "yuv420p10le", color_primaries: "bt2020", color_transfer: "smpte2084", color_space: "bt2020nc" }).dynamicRange).toBe("hdr10");
    expect(readSourceColor({ pix_fmt: "yuv420p10le", color_transfer: "arib-std-b67" }).dynamicRange).toBe("hlg");
    expect(readSourceColor({ pix_fmt: "yuv420p10le", side_data_list: [{ side_data_type: "DOVI configuration record" }] }).dynamicRange).toBe("dolby-vision");
    expect(readSourceColor({ pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709" }).dynamicRange).toBe("sdr");
    expect(readSourceColor({ pix_fmt: "yuv420p" }).dynamicRange).toBe("unknown");
    expect(readSourceColor({ pix_fmt: "yuv420p10le", color_primaries: "bt2020", color_space: "bt2020nc" }).dynamicRange).toBe("hdr10");
  });

  it("tone maps HDR10 to BT.709 through zscale when the filter is available", () => {
    const plan = planVideoColor(hdr10Source(), { policy: "tonemap", codec: "hevc", hasZscale: true });
    expect(plan.filterChain).toBe("zscale-tonemap");
    expect(plan.output).toEqual({ primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "tv", bitDepth: 8 });
    expect(plan.videoFilter).toContain("zscale=t=linear:npl=100");
    expect(plan.videoFilter).toContain("tonemap=tonemap=hable:desat=0");
    expect(plan.videoFilter.endsWith("scale=trunc(iw/2)*2:trunc(ih/2)*2")).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  it("keeps HDR signalling and warns when no tone mapping filter exists", () => {
    const plan = planVideoColor(hdr10Source(), { policy: "tonemap", codec: "hevc", hasZscale: false });
    expect(plan.filterChain).toBe("hdr-passthrough-fallback");
    expect(plan.output).toEqual({ primaries: "bt2020", transfer: "smpte2084", matrix: "bt2020nc", range: "tv", bitDepth: 10 });
    expect(plan.videoFilter).toBe("format=yuv420p10le,scale=trunc(iw/2)*2:trunc(ih/2)*2");
    expect(plan.warnings.map((warning) => warning.code)).toEqual(["MEDIA_HDR_TONEMAP_UNAVAILABLE"]);
    expect(plan.warnings[0]!.message).toMatch(/zscale|libzimg/i);
  });

  it("preserves HDR for an explicit preserve request without needing a tone mapping filter", () => {
    const plan = planVideoColor(hdr10Source(), { policy: "preserve", codec: "hevc", hasZscale: false });
    expect(plan.filterChain).toBe("passthrough");
    expect(plan.output.transfer).toBe("smpte2084");
    expect(plan.warnings).toEqual([]);
  });

  it("warns when H.264 carries HDR signalling", () => {
    const plan = planVideoColor(hdr10Source(), { policy: "preserve", codec: "h264", hasZscale: false });
    expect(plan.warnings.map((warning) => warning.code)).toEqual(["MEDIA_HDR_CODEC_UNSUPPORTED"]);
  });

  it("passes SDR tags through and encodes 8-bit", () => {
    const plan = planVideoColor(readSourceColor({ pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709", color_range: "tv" }), { policy: "tonemap", codec: "hevc", hasZscale: true });
    expect(plan.filterChain).toBe("passthrough");
    expect(plan.output).toEqual({ primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "tv", bitDepth: 8 });
    expect(plan.videoFilter).toBe("scale=trunc(iw/2)*2:trunc(ih/2)*2");
  });

  it("writes colour signalling through the encoder private options", () => {
    const plan = planVideoColor(hdr10Source(), { policy: "tonemap", codec: "hevc", hasZscale: false });
    const args = videoEncoderArgs(plan, "hevc", 24, "veryfast");
    expect(args).toEqual(["-c:v", "libx265", "-x265-params", "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=tv", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1"]);
    const h264 = videoEncoderArgs(planVideoColor(readSourceColor({ pix_fmt: "yuv420p", color_primaries: "bt709" }), { policy: "tonemap", codec: "h264", hasZscale: true }), "h264", 18, "fast");
    expect(h264).toEqual(["-c:v", "libx264", "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p"]);
  });

  it("rejects encoded output whose codec or colour tags differ from the plan", () => {
    const plan = planVideoColor(hdr10Source(), { policy: "tonemap", codec: "hevc", hasZscale: true });
    expect(() => assertEncodedColor({ codec_name: "hevc", pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709" }, plan, "hevc", "background.mp4")).not.toThrow();
    expect(() => assertEncodedColor({ codec_name: "hevc", pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "unknown", color_space: "bt709" }, plan, "hevc", "background.mp4")).toThrow(/color_transfer/);
    expect(() => assertEncodedColor({ codec_name: "h264", pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709" }, plan, "hevc", "background.mp4")).toThrow(/expected hevc/);
    expect(() => assertEncodedColor({ codec_name: "hevc", pix_fmt: "yuv420p10le", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709" }, plan, "hevc", "background.mp4")).toThrow(/8-bit/);
  });

  it("reads bit depth from pixel formats", () => {
    expect(pixelFormatBitDepth("yuv420p")).toBe(8);
    expect(pixelFormatBitDepth("yuv420p10le")).toBe(10);
    expect(pixelFormatBitDepth("yuv422p12le")).toBe(12);
    expect(pixelFormatBitDepth(null)).toBeNull();
  });
});
