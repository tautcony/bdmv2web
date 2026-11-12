import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { buildMenuPackage, convertSounds, createAssetBatchScript, createCompatibility, createDataScript, createMenuIndexHtml, createReadme, makePngBatches, menuMediaPaths, packagedMediaMetadata, priorMenuMediaPaths, runtimeAudioTrackMetadata } from "./index.js";
import type { MediaProcessRunner } from "@bdmv2web/media-export";
import { m3Fixtures } from "@bdmv2web/test-fixtures";

const ir = {
  schemaVersion: "1.0" as const,
  entries: [{ id: "entry-first-play", navigation: { type: "HDMV" as const, movieObjectId: 0 }, source: { path: "BDMV/index.bdmv", origin: "primary" as const, byteOffset: "0" } }],
  programs: [{ id: "program-00001", title: "Test menu" }], menus: [{ id: "menu-00001" }],
  playlists: [{ id: "playlist-00001", programIds: ["program-00001"], menuIds: ["menu-00001"], duration90k: "90000" }], mediaAssets: [], diagnostics: [],
};
const scene = { width: 1920, height: 1080, pages: [{ id: 0, defaultButtonId: 1, buttons: [{ id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: { normal: { bounds: { x: 100, y: 100, width: 500, height: 100 }, assetId: "graphic-1" }, selected: { bounds: { x: 100, y: 100, width: 500, height: 100 }, assetId: "graphic-1" } }, commands: [] as Array<{ bytes: string; sourceOffset: string; source: { path: string; origin: "primary"; offset: string } }> }] }] };
const png1x1 = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2ioAAAAASUVORK5CYII=", "base64"));
function compactCss(css: string): string { return css.replace(/\s*([{}:;,])\s*/g, "$1").trim(); }
const mediaOutputs = (args: string[]): string[] => args.filter((arg) => arg.endsWith(".mp4") || arg.endsWith(".m4a"));

describe("menu package primitives", () => {
  it("loads the BD-J transport as a separate local-jvm package script", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "bdmv2web-bdj-client-"));
    const outputDirectory = resolve(parent, "native package");
    try {
      await buildMenuPackage({
        outputDirectory, title: "Native menu", ir, scene, graphics: [],
        bdjFiles: [{ path: "BDMV/JAR/00000.jar", sourcePath: "BDMV/JAR/00000.jar", bytes: new Uint8Array([0]) }],
        bdjHostApiJar: new Uint8Array([0x50, 0x4b]),
        bdjLaunch: { discId: "00000000000000000000000000000000", initialBdjoId: "00000", applications: [{ bdjoId: "00000", controlCode: 1, binding: 1, organizationId: 1, applicationId: 1, initialClass: "fixture.Menu", basePath: "00000", classPath: "", parameters: [] }] },
      });
      const html = await readFile(resolve(outputDirectory, "index.html"), "utf8");
      const appBundle = await readFile(resolve(outputDirectory, "runtime/app.bundle.js"), "utf8");
      const bdjClient = await readFile(resolve(outputDirectory, "runtime/bdj-client.js"), "utf8");
      const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8")) as { launchMode: string; files: Array<{ path: string }> };
      expect(manifest.launchMode).toBe("local-jvm");
      expect(manifest.files.map((file) => file.path)).toContain("runtime/bdj-client.js");
      expect(html.indexOf("runtime/bdj-client.js")).toBeLessThan(html.indexOf("runtime/app.bundle.js"));
      expect(appBundle).not.toMatch(/\bfetch\s*\(|new EventSource/);
      expect(bdjClient).toContain('fetch("/api/bdj/start"');
      expect(bdjClient).toContain('new EventSource("/api/bdj/events")');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  it("describes looped and infinite-still menu backgrounds accurately", () => {
    expect(createReadme("Loop", true, false)).toContain("repeated single-clip background loop");
    expect(createReadme("Still", false, false)).toContain("holds the final video frame after its single PlayItem");
    expect(createReadme("No media", undefined, false)).toContain("No menu background media was exported");
  });
  it("writes each audio variant with its explicit one-based PSR stream in runtime data and manifest metadata", () => {
    const audioTracks = [
      runtimeAudioTrackMetadata({ streamNumber: 0, path: "assets/media/audio-1100-eng.m4a", language: "eng" }),
      runtimeAudioTrackMetadata({ streamNumber: 1, path: "assets/media/audio-1101-jpn.m4a", language: "jpn" }),
    ];
    expect(audioTracks.map(({ streamNumber, psrStreamNumber }) => [streamNumber, psrStreamNumber])).toEqual([[0, 1], [1, 2]]);

    const embedded: { __BDMV_MENU_DATA__?: { media?: { audioTracks?: unknown[] } } } = {};
    runInNewContext(createDataScript({ media: { audioTracks } }), embedded);
    expect(embedded.__BDMV_MENU_DATA__?.media?.audioTracks).toEqual(audioTracks);

    const media = {
      plan: {},
      background: { path: "assets/media/background.mp4", byteLength: 10, codec: "h264", pid: 0x1011, width: 1920, height: 1080, durationSeconds: 10, loop: true },
      audioTracks: audioTracks.map((track) => ({ ...track, absolutePath: `/tmp/${track.path}`, byteLength: 5, codec: "aac", pid: track.streamNumber === 0 ? 0x1100 : 0x1101, durationSeconds: 10 })),
      files: [], tools: {},
    } as unknown as Parameters<typeof packagedMediaMetadata>[0];
    const packaged = packagedMediaMetadata(media) as { audioTracks: Array<{ streamNumber: number; psrStreamNumber: number; path: string; pid: number }> };
    expect(packaged.audioTracks.map(({ streamNumber, psrStreamNumber, pid }) => [streamNumber, psrStreamNumber, pid])).toEqual([[0, 1, 0x1100], [1, 2, 0x1101]]);
  });
  it("escapes script termination sequences as data and escapes HTML titles", () => {
    const maliciousTitle = "</script><script>globalThis.pwned=1</script>&\u2028\u2029";
    const source = createDataScript({ title: maliciousTitle });
    expect(source).not.toContain("</script>"); expect(source).toContain("\\u003c/script\\u003e");
    expect(source).not.toContain("<script>"); expect(source).toContain("\\u0026\\u2028\\u2029");
    const scriptContext: { __BDMV_MENU_DATA__?: { title?: string }; pwned?: number } = {};
    runInNewContext(source, scriptContext);
    expect(scriptContext.__BDMV_MENU_DATA__?.title).toBe(maliciousTitle);
    expect(scriptContext.pwned).toBeUndefined();
    expect(createDataScript({ bytes: new Uint8Array([0x01, 0xab]) })).toContain('"bytes":"01ab"');
    const html = createMenuIndexHtml("</title><script>globalThis.pwned=1</script> & 'quote' \"menu\"");
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;globalThis.pwned=1&lt;/script&gt; &amp; &#39;quote&#39; &quot;menu&quot;");
    expect(html).not.toContain("<script>globalThis.pwned");
  });
  it("keeps PNG data batches within per-asset, per-batch and total byte limits", () => {
    const size = png1x1.byteLength;
    const batches = makePngBatches([{ id: "a", bytes: png1x1 }, { id: "b", bytes: png1x1 }, { id: "c", bytes: png1x1 }], { maxAssetBytes: size, maxBatchBytes: size * 2 - 1, maxTotalBytes: size * 3 });
    expect(batches.map((batch) => batch.assets.map((asset) => asset.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(batches.every((batch) => batch.assets.reduce((sum, asset) => sum + asset.byteLength, 0) <= size * 2 - 1)).toBe(true);
    expect(batches.flatMap((batch) => batch.assets).reduce((sum, asset) => sum + asset.byteLength, 0)).toBe(size * 3);
    expect(createAssetBatchScript(batches[0]!)).toContain("data:image/png;base64,");
    expect(() => makePngBatches([{ id: "too-big", bytes: png1x1 }], { maxAssetBytes: size - 1 })).toThrow(/maxAssetBytes/);
    expect(() => makePngBatches([{ id: "batch-too-big", bytes: png1x1 }], { maxAssetBytes: size, maxBatchBytes: size - 1 })).toThrow(/maxBatchBytes/);
    expect(() => makePngBatches([{ id: "a", bytes: png1x1 }, { id: "b", bytes: png1x1 }], { maxTotalBytes: size * 2 - 1 })).toThrow(/maxTotalBytes/);
    expect(() => makePngBatches([{ id: "raw-rgba", bytes: new Uint8Array(4) }])).toThrow(/encoded as PNG/);
    expect(() => makePngBatches([], { maxBatchBytes: 0 })).toThrow(/maxBatchBytes/);
  });
  it("marks every generated preview partial without media or timeline evidence", () => {
    const report = createCompatibility({ schemaVersion: "1.0", runtimeVersion: "0.1.0", title: "Preview", status: "partial", diagnostics: [] });
    expect(report.status).toBe("partial"); expect(report).not.toHaveProperty("browserEvidence"); expect(report.coverage).toEqual({ igs: "unverified" });
    expect(report.notVerified).toEqual(expect.arrayContaining(["package directory relocation", "real-disc rendering", "media timeline and seek accuracy"]));
  });
  it("reports player requirements for the selected package launch mode", () => {
    const metadata = { schemaVersion: "1.0" as const, runtimeVersion: "0.1.0", title: "Preview", status: "partial" as const, diagnostics: [] };
    expect(createCompatibility(metadata, true).externalDependencies).toEqual(["configured BDMV STREAM files", "IINA 1.4.4 or later on macOS or PotPlayer on Windows"]);
    expect(createCompatibility(metadata, true, true).externalDependencies).toEqual(["configured BDMV STREAM files", "an operating-system file association for whole-file playback or a configured mpv executable for bounded playlists"]);
    expect(createReadme("Preview", undefined, true, "partial", true)).toContain("bdmv2web serve <package-directory> --player system");
    expect(createReadme("Preview", undefined, true)).toContain("IINA 1.4.4 or later on macOS and PotPlayer on Windows");
  });
  it("converts only M1-declared 48 kHz 16-bit PCM ranges into WAV and reports affected sound references", () => {
    const bytes = new Uint8Array(70); bytes.set([0x12, 0x34, 0xab, 0xcd], 64);
    const soundScene = { pages: [{ id: 3, buttons: [{ id: 8, states: { selected: { soundId: 0 }, activated: { soundId: 1 } } }] }] };
    const entries = [{ index: 0, channelCode: 1, sampleRateCode: 1, bitsPerSampleCode: 1, channels: 1, sampleRate: 48000, bitsPerSample: 16, sampleOffset: 64, sampleByteLength: 4 }, { index: 2, channelCode: 3, sampleRateCode: 1, bitsPerSampleCode: 1, channels: 2, sampleRate: 48000, bitsPerSample: 16, sampleOffset: 64, sampleByteLength: 4 }];
    const result = convertSounds(entries, bytes, soundScene);
    expect(result.assets).toEqual([{ index: 0, path: "assets/audio/sound-0.wav", byteLength: 48, format: "wav-pcm" }]);
    expect([...result.files[0]!.bytes.slice(0, 4)]).toEqual([82, 73, 70, 70]);
    expect(new DataView(result.files[0]!.bytes.buffer).getUint32(24, true)).toBe(48000);
    expect([...result.files[0]!.bytes.slice(44)]).toEqual([0x34, 0x12, 0xcd, 0xab]);
    expect(result.diagnostics).toEqual([
      { code: "SOUND_REFERENCE_MISSING", message: "Sound 1 is referenced by page 3, button 8 but has no M1 sound entry." },
    ]);
    const unsupported = convertSounds([{ ...entries[0]!, channels: null, channelCode: 2 }], bytes, soundScene);
    expect(unsupported.assets).toEqual([]); expect(unsupported.diagnostics[0]?.code).toBe("SOUND_FORMAT_UNSUPPORTED"); expect(unsupported.diagnostics[0]?.message).toContain("button 8");
    const truncated = convertSounds([entries[0]!], bytes.subarray(0, 66), soundScene);
    expect(truncated.assets).toEqual([]); expect(truncated.diagnostics[0]?.code).toBe("SOUND_RANGE_INVALID");
  });
  it("writes converted M1 sounds and reports missing or unsupported scene references in package manifests", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "bdmv-menu-sound-package-")); const outputDirectory = resolve(parent, "sound preview");
    try {
      const soundBytes = new Uint8Array(88);
      soundBytes.set(Buffer.from("BCLK0100", "ascii"));
      const put32 = (offset: number, value: number) => new DataView(soundBytes.buffer).setUint32(offset, value, false);
      put32(8, 80); put32(40, 8); soundBytes[45] = 2;
      soundBytes[46] = 0x11; soundBytes[47] = 0x40; put32(48, 0); put32(52, 4);
      soundBytes[56] = 0x21; soundBytes[57] = 0x40; put32(58, 4); put32(62, 4);
      soundBytes.set([0x12, 0x34, 0xab, 0xcd, 0x56, 0x78, 0xef, 0x01], 80);
      const soundScene = { width: 1920, height: 1080, pages: [{ id: 0, defaultButtonId: 1, buttons: [
        { id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: { normal: { bounds: { x: 0, y: 0, width: 1, height: 1 } }, selected: { bounds: { x: 100, y: 100, width: 500, height: 100 }, soundId: 0 }, activated: { bounds: { x: 100, y: 100, width: 500, height: 100 }, soundId: 1 } }, commands: [] },
        { id: 2, bog: 0, enabled: true, neighbors: { up: 2, down: 2, left: 2, right: 2 }, states: { normal: { bounds: { x: 0, y: 0, width: 1, height: 1 }, soundId: 2 } }, commands: [] },
      ] }] };
      const packaged = await buildMenuPackage({
        outputDirectory, title: "Sound preview", ir, scene: soundScene, graphics: [], soundBytes, inputConfig: { escapeMapping: "topMenu" },
        soundEntries: [
          { index: 0, channelCode: 1, sampleRateCode: 1, bitsPerSampleCode: 1, channels: 1, sampleRate: 48000, bitsPerSample: 16, sampleOffset: 80, sampleByteLength: 4 },
          { index: 1, channelCode: 2, sampleRateCode: 1, bitsPerSampleCode: 1, channels: null, sampleRate: 48000, bitsPerSample: 16, sampleOffset: 84, sampleByteLength: 4 },
        ],
      });
      const wavPath = resolve(outputDirectory, "assets/audio/sound-0.wav"); const wav = await readFile(wavPath);
      expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF"); expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
      expect([...wav.subarray(44)]).toEqual([0x34, 0x12, 0xcd, 0xab]);
      const embedded: { __BDMV_MENU_DATA__?: { sounds?: Record<number, string>; inputConfig?: { escapeMapping: string } } } = {};
      runInNewContext(await readFile(resolve(outputDirectory, "runtime/disc-data.js"), "utf8"), embedded);
      expect(embedded.__BDMV_MENU_DATA__?.sounds).toEqual({ 0: "assets/audio/sound-0.wav" });
      expect(embedded.__BDMV_MENU_DATA__?.inputConfig).toEqual({ escapeMapping: "topMenu" });
      const assets = JSON.parse(await readFile(resolve(outputDirectory, "asset-manifest.json"), "utf8")) as { sounds: Array<{ index: number; path: string; byteLength: number; format: string }> };
      expect(assets.sounds).toEqual([{ index: 0, path: "assets/audio/sound-0.wav", byteLength: 48, format: "wav-pcm" }]);
      const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8")) as { files: Array<{ path: string }>; assets: { sounds: Array<{ index: number; path: string }> }; diagnostics: Array<{ code: string; message: string }> };
      expect(manifest.files.map((file) => file.path)).toContain("assets/audio/sound-0.wav");
      expect(manifest.assets.sounds).toEqual([{ index: 0, path: "assets/audio/sound-0.wav", byteLength: 48, format: "wav-pcm" }]);
      expect(manifest.diagnostics).toEqual([
        { code: "SOUND_FORMAT_UNSUPPORTED", message: "Sound 1 referenced by page 0, button 1 has unsupported M1 PCM attributes (channel=2, rate=1, bits=1)." },
        { code: "SOUND_REFERENCE_MISSING", message: "Sound 2 is referenced by page 0, button 2 but has no M1 sound entry." },
      ]);
      // Diagnostics that are only known once assets exist (media colour warnings)
      // have to come back to the caller, which alone can put them in the report.
      expect(packaged.diagnostics).toEqual(manifest.diagnostics);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("embeds the player profile in runtime data so the packaged VM matches conversion", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "bdmv-menu-profile-"));
    const outputDirectory = resolve(parent, "profile preview");
    try {
      const playerProfile = { menuLanguage: "jpn", audioLanguage: "jpn", subtitleLanguage: "eng", country: "JP", region: "A" as const, outputProfile: "portable" as const, videoProfiles: [], audioProfiles: [] };
      await buildMenuPackage({ outputDirectory, title: "Profile preview", ir, scene, graphics: [], playerProfile });
      const embedded: { __BDMV_MENU_DATA__?: { profile?: unknown } } = {};
      runInNewContext(await readFile(resolve(outputDirectory, "runtime/disc-data.js"), "utf8"), embedded);
      expect(embedded.__BDMV_MENU_DATA__?.profile).toEqual(playerProfile);
      const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8")) as { profile?: unknown };
      expect(manifest.profile).toEqual(playerProfile);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("encodes and stores one media set for 999 equivalent menu PlayItems", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "bdmv-menu-media-dedup-"));
    const outputDirectory = resolve(parent, "menu package");
    const sourcePath = resolve(parent, "00004.m2ts");
    await writeFile(sourcePath, new Uint8Array([0x47]));
    const encodeOutputs: string[] = [];
    let ffmpegCalls = 0;
    const durations = new Map<string, string>();
    const mediaProcessRunner: MediaProcessRunner = async (executable, args) => {
      if (args[0] === "-version") return { stdout: `${executable} version test`, stderr: "" };
      if (args.includes("-encoders")) return { stdout: " V....D libx264\n V....D libx265\n A....D aac\n", stderr: "" };
      if (args.includes("-filters")) return { stdout: "", stderr: "" };
      if (executable === "ffmpeg") {
        ffmpegCalls += 1;
        const durationIndex = args.indexOf("-t");
        for (const outputPath of mediaOutputs(args)) {
          if (durationIndex >= 0) durations.set(outputPath, args[durationIndex + 1]!);
          encodeOutputs.push(outputPath);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, new Uint8Array([0x42, 0x44, 0x4d, 0x56]));
        }
        return { stdout: "", stderr: "" };
      }
      const outputPath = args.at(-1)!;
      const duration = durations.get(outputPath) ?? "109.2341111111111";
      if (outputPath.endsWith(".m2ts")) {
        return {
          stdout: JSON.stringify({ format: { start_time: "0", duration }, streams: [
            { index: 0, id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9", duration, color_range: "tv", color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709", bits_per_raw_sample: "8", pix_fmt: "yuv420p" },
            { index: 1, id: "0x1100", codec_type: "audio", codec_name: "aac", duration },
            { index: 2, id: "0x1101", codec_type: "audio", codec_name: "aac", duration },
          ] }),
          stderr: "",
        };
      }
      if (outputPath.endsWith(".mp4")) {
        return { stdout: JSON.stringify({ format: { duration }, streams: [{ index: 0, id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9", duration, color_range: "tv", color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709", bits_per_raw_sample: "8", pix_fmt: "yuv420p" }] }), stderr: "" };
      }
      const pid = outputPath.includes("1100-eng") ? "0x1100" : "0x1101";
      return { stdout: JSON.stringify({ format: { duration }, streams: [{ index: 0, id: pid, codec_type: "audio", codec_name: "aac", duration }] }), stderr: "" };
    };
    const equivalentMedia = Array.from({ length: 999 }, (_, playItemIndex) => ({
      sourcePath, sourceFile: "BDMV/STREAM/00004.m2ts", playlistId: "00003", playItemIndex, clipId: "00004",
      inTime45k: 524_280, outTime45k: 5_439_815, stillMode: 0, repeatCount: 999, loopBackground: true, videoPid: 0x1011,
      audioTracks: [{ streamNumber: 0, pid: 0x1100, language: "eng" }, { streamNumber: 1, pid: 0x1101, language: "jpn" }],
    }));
    const mediaWithDistinctSegment = [...equivalentMedia, { ...equivalentMedia[0]!, playItemIndex: 999, inTime45k: 569_280, outTime45k: 5_484_815 }];
    try {
      await buildMenuPackage({ outputDirectory, title: "Repeated menu", ir, scene, graphics: [], additionalMenuMedia: mediaWithDistinctSegment, mediaEncoding: { codec: "h264" }, mediaProcessRunner });
      const assetManifest = JSON.parse(await readFile(resolve(outputDirectory, "asset-manifest.json"), "utf8")) as {
        menuMedia: Array<{ plan: { playlistId: string; playItemIndex: number }; background: { path: string }; audioTracks: Array<{ path: string }> }>;
      };
      const runtime: { __BDMV_MENU_DATA__?: { menuMedia?: Array<{ playlist: number; playItem: number; background: { path: string }; audioTracks: Array<{ path: string }> }> } } = {};
      runInNewContext(await readFile(resolve(outputDirectory, "runtime/disc-data.js"), "utf8"), runtime);
      const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8")) as { files: Array<{ path: string; kind: string }> };
      const physicalMediaFiles = manifest.files.filter((file) => file.kind === "media");
      expect(ffmpegCalls).toBe(2);
      expect(encodeOutputs).toHaveLength(6);
      expect(encodeOutputs.filter((path) => path.endsWith(".mp4"))).toHaveLength(2);
      expect(encodeOutputs.filter((path) => path.endsWith(".m4a"))).toHaveLength(4);
      expect(physicalMediaFiles).toHaveLength(6);
      expect(new Set(physicalMediaFiles.map((file) => file.path)).size).toBe(6);
      expect(manifest.files.filter((file) => file.kind === "media-plan")).toHaveLength(1000);
      expect(assetManifest.menuMedia).toHaveLength(1000);
      expect(assetManifest.menuMedia.map((item) => item.plan.playItemIndex)).toEqual(mediaWithDistinctSegment.map((item) => item.playItemIndex));
      expect(new Set(assetManifest.menuMedia.slice(0, 999).map((item) => item.background.path)).size).toBe(1);
      expect(assetManifest.menuMedia[999]!.background.path).not.toBe(assetManifest.menuMedia[0]!.background.path);
      expect(new Set(assetManifest.menuMedia.slice(0, 999).flatMap((item) => item.audioTracks.map((track) => track.path))).size).toBe(2);
      expect(assetManifest.menuMedia[999]!.audioTracks.map((track) => track.path)).not.toEqual(assetManifest.menuMedia[0]!.audioTracks.map((track) => track.path));
      expect(runtime.__BDMV_MENU_DATA__?.menuMedia).toHaveLength(1000);
      expect(runtime.__BDMV_MENU_DATA__?.menuMedia?.map((item) => item.playItem)).toEqual(mediaWithDistinctSegment.map((item) => item.playItemIndex));
      expect(new Set(runtime.__BDMV_MENU_DATA__?.menuMedia?.slice(0, 999).map((item) => item.background.path)).size).toBe(1);
      expect(runtime.__BDMV_MENU_DATA__?.menuMedia?.[999]?.background.path).not.toBe(runtime.__BDMV_MENU_DATA__?.menuMedia?.[0]?.background.path);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("embeds the configured HDMV limits in runtime data", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "bdmv-menu-limits-"));
    const outputDirectory = resolve(parent, "limits preview");
    try {
      const vmLimits = { maxReadWindowBytes: 4096, maxSegmentBytes: 8192, maxReassemblyBytes: 16384, maxObjectPixels: 1024, maxInstructionsPerTurn: 77, maxQueueDepth: 12, maxCallDepth: 0, maxExplorationStates: 100, maxOutputBytes: null };
      await buildMenuPackage({ outputDirectory, title: "Limits preview", ir, scene, graphics: [], vmLimits });
      const embedded: { __BDMV_MENU_DATA__?: { limits?: unknown } } = {};
      runInNewContext(await readFile(resolve(outputDirectory, "runtime/disc-data.js"), "utf8"), embedded);
      expect(embedded.__BDMV_MENU_DATA__?.limits).toEqual(vmLimits);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("generates a complete local folder with a classic ES2020 IIFE and no dangling HTML references", async () => {
    const preserveOutput = process.env.BDMV_MENU_FIXTURE_OUT;
    const parent = preserveOutput ? resolve(preserveOutput) : await mkdtemp(resolve(tmpdir(), "bdmv-menu-package-"));
    const outputDirectory = resolve(parent, "menu preview");
    try {
      const commandSource = { path: "BDMV/STREAM/00001.m2ts", origin: "primary" as const, offset: "128" };
      const fixtureScene = structuredClone(scene);
      fixtureScene.pages[0]!.buttons[0]!.commands = [
        { bytes: m3Fixtures.move5.bytes, sourceOffset: "128", source: commandSource },
        { bytes: m3Fixtures.playPlaylist42.bytes, sourceOffset: "140", source: { ...commandSource, offset: "140" } },
      ];
      const popupScene = { ...fixtureScene, id: "popup-title-1", clipId: "00001", pid: 0x1400, streamModel: 0, uiModel: 1, source: { clipId: "00001", pid: 0x1400, packetOffset: "192", pesOffset: "208", segmentOffset: "4", segmentFileOffset: "400", pts90k: "9000", timeDomain: 0 } };
      await buildMenuPackage({ outputDirectory, title: "Test </script> 菜单", ir, scene: fixtureScene, popupScenes: [popupScene], vmPrograms: [{ id: 0, instructions: [m3Fixtures.break] }], vmEntries: [{ id: "title:0", kind: "title", source: commandSource, target: { objectType: "HDMV", playbackType: 0, target: 0, source: commandSource } }], vmInitialProgramId: 0, graphics: [{ id: "graphic-1", bytes: png1x1 }] });
      const html = await readFile(resolve(outputDirectory, "index.html"), "utf8");
      expect(html.indexOf('<video id="menu-background"')).toBeLessThan(html.indexOf('<canvas id="menu-canvas"'));
      const style = await readFile(resolve(outputDirectory, "runtime/style.css"), "utf8");
      const compactStyle = compactCss(style);
      expect(compactStyle).toMatch(/#menu-background\{z-index:0;?\}/); expect(compactStyle).toMatch(/#menu-canvas\{z-index:1;background:transparent;touch-action:manipulation;?\}/);
      const localPaths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]!);
      expect(localPaths.length).toBeGreaterThan(0);
      for (const path of localPaths) expect((await stat(resolve(outputDirectory, path))).isFile()).toBe(true);
      const scriptTags = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g)];
      expect(scriptTags.map((match) => match[2])).toEqual(["runtime/disc-data.js", "runtime/assets-data-000.js", "runtime/app.bundle.js"]);
      expect(scriptTags.every((match) => /\bdefer\b/.test(`${match[1]} ${match[3]}`) && !/\btype=["']module["']/i.test(`${match[1]} ${match[3]}`))).toBe(true);
      expect(html).toContain("<title>Test &lt;/script&gt; 菜单</title>"); expect(html).not.toContain("<script>Test");
      const files = (await readdir(resolve(outputDirectory, "runtime"))).sort();
      expect(files).toEqual(["app.bundle.js", "assets-data-000.js", "disc-data.js", "style.css"]);
      const app = await readFile(resolve(outputDirectory, "runtime/app.bundle.js"), "utf8");
      expect(app).toMatch(/^"use strict";\n\(\(\) => \{/); expect(app).not.toMatch(/^\s*(?:import|export)\s/m); expect(app).not.toMatch(/\bimport\s*\(/);
      expect(app).not.toMatch(/\bfetch\s*\(/i); expect(app).not.toMatch(/\bXMLHttpRequest\b/); expect(app).not.toMatch(/\b(?:eval|Function)\s*\(/);
      expect(app).not.toMatch(/heading\.textContent\s*=\s*title/);
      expect(`${html}\n${app}`).not.toMatch(/(?:https?:)?\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}/i);
      expect(app).toContain("Images decoded"); expect(app).toContain("Unsupported DiscIR schema version"); expect(app).toContain("MEDIA_UNAVAILABLE");
      const data = await readFile(resolve(outputDirectory, "runtime/disc-data.js"), "utf8"); expect(data).not.toContain("</script>");
      expect(data).toContain('"inputConfig":{"escapeMapping":"popup"}');
      expect(data).toContain('"popupScenes":[{"width":1920,"height":1080');
      expect(data).toContain('"clipId":"00001","pid":5120');
      expect(data).toContain('"uiModel":1');
      expect(data).toContain('"vmEntries":[{"id":"title:0"');
      const report = JSON.parse(await readFile(resolve(outputDirectory, "compatibility.json"), "utf8"));
      expect(report.status).toBe("partial"); expect(report.coverage.igs).toBe("unverified");
      expect(await readFile(resolve(outputDirectory, "README.md"), "utf8")).toContain("bdmv2web validate <package-directory>");
      const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8")) as { files: Array<{ path: string; kind: string; byteLength: string }> };
      expect(manifest.files.map((file) => file.path)).toEqual(["index.html", "README.md", "runtime/app.bundle.js", "runtime/assets-data-000.js", "runtime/disc-data.js", "runtime/style.css"]);
      for (const file of manifest.files) {
        const bytes = await readFile(resolve(outputDirectory, file.path));
        expect(file.byteLength).toBe(String(bytes.byteLength));
      }
      expect(data).toContain(m3Fixtures.move5.bytes); expect(data).toContain(m3Fixtures.playPlaylist42.bytes); expect(data).toContain('"id":0'); expect(data).toContain('"vmInitialProgramId":0');
      expect(html).toContain('style="aspect-ratio:1920 / 1080"');
      // The exported page keeps no chrome of its own: the title is the document
      // title and the stage fills the viewport, letterboxing the scene instead of
      // shrinking to it. The page renders no in-page heading at all (D-8).
      expect(html).not.toContain("<h1");
      expect(html).toContain('<p id="runtime-status" role="status" aria-live="polite"');
      expect(html).toContain('<span id="runtime-status-message">');
      expect(html).toContain('id="runtime-status-copy" type="button"');
      expect(compactStyle).toMatch(/#menu-stage\{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;/);
      expect(compactStyle).toContain("object-fit:contain");
      expect(compactStyle).toMatch(/#runtime-status\{[^}]*position:fixed[^}]*opacity:0/);
      expect(compactStyle).toMatch(/#runtime-status\.is-visible\{opacity:1/);
      // A persistent notice is the only text a user may need to copy (a file path or
      // a manual command), so it must accept the pointer again (P3-P2-1).
      expect(compactStyle).toMatch(/#runtime-status\.is-persistent\{[^}]*pointer-events:auto[^}]*user-select:text/);
      // The copy button takes the pointer while the toast is visible; the rest of the
      // toast keeps passing clicks through to the menu beneath it.
      expect(compactStyle).toMatch(/#runtime-status\.is-visible #runtime-status-copy\{display:grid/);
      expect(compactStyle).toMatch(/#runtime-status-copy\{[^}]*pointer-events:auto/);
    } finally { if (!preserveOutput) await rm(parent, { recursive: true, force: true }); }
  });
});

describe("menu media package paths", () => {
  it("names each exported clip after its playlist, PlayItem, and source clip", () => {
    expect(menuMediaPaths({ playlistId: "00001", playItemIndex: 2, clipId: "00377" })).toEqual({
      directory: "assets/media/playlist-00001-pi02-clip-00377",
      planPath: "media-plans/playlist-00001-pi02-clip-00377.json",
    });
  });

  it("pads the PlayItem so a listing follows playback order", () => {
    const paths = [0, 2, 10].map((playItemIndex) => menuMediaPaths({ playlistId: "00003", playItemIndex, clipId: "00004" }).directory);
    expect(paths).toEqual([
      "assets/media/playlist-00003-pi00-clip-00004",
      "assets/media/playlist-00003-pi02-clip-00004",
      "assets/media/playlist-00003-pi10-clip-00004",
    ]);
    expect([...paths].sort()).toEqual(paths);
  });

  it("lists the layouts an older run wrote, so its assets stay reusable", () => {
    expect(priorMenuMediaPaths({ playlistId: "00001", playItemIndex: 2 })).toEqual([
      { assetDirectory: "assets/media/playlist-00001-pi2", planPath: "media-plans/playlist-00001-pi2.json" },
      { assetDirectory: "assets/media", planPath: "media-plan.json" },
    ]);
  });

  it("keeps an unexpected id from escaping the media directory", () => {
    const { directory, planPath } = menuMediaPaths({ playlistId: "00001", playItemIndex: 0, clipId: "../00002" });
    expect(directory).toBe("assets/media/playlist-00001-pi00-clip-.._00002");
    expect(planPath.startsWith("media-plans/")).toBe(true);
  });
});

describe("menu media layout", () => {
  const encoders = " V....D libx264 H.264\n V....D libx265 H.265\n A....D aac AAC\n";
  const runner = (durations: Map<string, string>): MediaProcessRunner => async (executable, args) => {
    if (args[0] === "-version") return { stdout: `${executable} version test\n`, stderr: "" };
    if (args.includes("-encoders")) return { stdout: encoders, stderr: "" };
    if (args.includes("-filters")) return { stdout: "", stderr: "" };
    const path = args.at(-1)!;
    if (args[0] === "-v") {
      const audio = path.endsWith(".m4a");
      const duration = [...durations].find(([source]) => path.includes(source))?.[1] ?? "10";
      const source = durations.has(path) ? path : undefined;
      if (source !== undefined) return { stdout: JSON.stringify({ streams: [
        { index: 0, id: "0x1011", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, display_aspect_ratio: "16:9", duration: "10" },
        { index: 1, id: "0x1100", codec_type: "audio", codec_name: "ac3", duration: "10" },
      ], format: { start_time: "0", duration: "10" } }), stderr: "" };
      return { stdout: JSON.stringify({ streams: [audio
        ? { index: 0, id: "0x0", codec_type: "audio", codec_name: "aac", duration }
        : { index: 0, id: "0x0", codec_type: "video", codec_name: "h264", width: 1920, height: 1080, duration, pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709" }], format: { duration } }), stderr: "" };
    }
    for (const output of mediaOutputs(args)) await writeFile(output, "encoded media");
    return { stdout: "", stderr: "" };
  };

  it("names the Top Menu background and extra menu clips after their playlist, PlayItem, and clip", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "bdmv2web-media-layout-"));
    const outputDirectory = resolve(parent, "package");
    const media = (playlistId: string, playItemIndex: number, clipId: string) => ({
      sourcePath: resolve(parent, `BDMV/STREAM/${clipId}.m2ts`), sourceFile: `BDMV/STREAM/${clipId}.m2ts`,
      playlistId, playItemIndex, clipId, inTime45k: 0, outTime45k: 450_000, stillMode: 0, repeatCount: 1,
      videoPid: 0x1011, audioTracks: [{ streamNumber: 0, pid: 0x1100, language: "eng" }],
    });
    const top = media("00003", 0, "00004");
    const extra = media("00001", 2, "00377");
    try {
      await buildMenuPackage({
        outputDirectory, title: "Layout", ir, scene, graphics: [],
        menuLoopMedia: top, additionalMenuMedia: [extra],
        mediaEncoding: { codec: "h264" },
        mediaProcessRunner: runner(new Map([[top.sourcePath, "10"], [extra.sourcePath, "10"]])),
      });
      const topDirectory = resolve(outputDirectory, "assets/media/playlist-00003-pi00-clip-00004");
      expect((await readdir(topDirectory)).sort()).toEqual(["audio-1100-eng.m4a", "background.mp4"]);
      const extraDirectory = resolve(outputDirectory, "assets/media/playlist-00001-pi02-clip-00377");
      expect((await readdir(extraDirectory)).sort()).toEqual(["audio-1100-eng.m4a", "background.mp4"]);
      expect(JSON.parse(await readFile(resolve(outputDirectory, "media-plans/playlist-00003-pi00-clip-00004.json"), "utf8"))).toMatchObject({ playlistId: "00003", clipId: "00004" });
      const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8")) as { files: Array<{ path: string; kind: string }> };
      expect(manifest.files.filter((file) => file.kind === "media-plan").map((file) => file.path).sort()).toEqual([
        "media-plans/playlist-00001-pi02-clip-00377.json",
        "media-plans/playlist-00003-pi00-clip-00004.json",
      ]);
      const data = await readFile(resolve(outputDirectory, "runtime/disc-data.js"), "utf8");
      expect(data).toContain('"path":"assets/media/playlist-00003-pi00-clip-00004/background.mp4"');
      expect(data).toContain('"path":"assets/media/playlist-00001-pi02-clip-00377/background.mp4"');
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});
