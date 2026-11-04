import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildMenuPackage, convertSounds, createAssetBatchScript, createCompatibility, createDataScript, createMenuIndexHtml, createReadme, makePngBatches, packagedMediaMetadata, runtimeAudioTrackMetadata } from "./index.js";
import { m3Fixtures } from "@bdmv-web/hdmv";

const ir = {
  schemaVersion: "1.0" as const,
  entries: [{ id: "entry-first-play", navigation: { type: "HDMV" as const, movieObjectId: 0 }, source: { path: "BDMV/index.bdmv", origin: "primary" as const, byteOffset: "0" } }],
  programs: [{ id: "program-00001", title: "Test menu" }], menus: [{ id: "menu-00001" }],
  playlists: [{ id: "playlist-00001", programIds: ["program-00001"], menuIds: ["menu-00001"], duration90k: "90000" }], mediaAssets: [], diagnostics: [],
};
const scene = { width: 1920, height: 1080, pages: [{ id: 0, defaultButtonId: 1, buttons: [{ id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: { normal: { bounds: { x: 100, y: 100, width: 500, height: 100 }, assetId: "graphic-1" }, selected: { bounds: { x: 100, y: 100, width: 500, height: 100 }, assetId: "graphic-1" } }, commands: [] as Array<{ bytes: string; sourceOffset: string; source: { path: string; origin: "primary"; offset: string } }> }] }] };
const png1x1 = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2ioAAAAASUVORK5CYII=", "base64"));

describe("menu package primitives", () => {
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
    const batches = makePngBatches([{ id: "a", bytes: new Uint8Array(4) }, { id: "b", bytes: new Uint8Array(4) }, { id: "c", bytes: new Uint8Array(1) }], { maxAssetBytes: 4, maxBatchBytes: 5, maxTotalBytes: 9 });
    expect(batches.map((batch) => batch.assets.map((asset) => asset.id))).toEqual([["a"], ["b", "c"]]);
    expect(batches.every((batch) => batch.assets.reduce((sum, asset) => sum + asset.byteLength, 0) <= 5)).toBe(true);
    expect(batches.flatMap((batch) => batch.assets).reduce((sum, asset) => sum + asset.byteLength, 0)).toBe(9);
    expect(createAssetBatchScript(batches[0]!)).toContain("data:image/png;base64,");
    expect(() => makePngBatches([{ id: "too-big", bytes: new Uint8Array(5) }], { maxAssetBytes: 4 })).toThrow(/maxAssetBytes/);
    expect(() => makePngBatches([{ id: "batch-too-big", bytes: new Uint8Array(5) }], { maxAssetBytes: 8, maxBatchBytes: 4 })).toThrow(/maxBatchBytes/);
    expect(() => makePngBatches([{ id: "a", bytes: new Uint8Array(4) }, { id: "b", bytes: new Uint8Array(4) }], { maxTotalBytes: 7 })).toThrow(/maxTotalBytes/);
    expect(() => makePngBatches([], { maxBatchBytes: 0 })).toThrow(/maxBatchBytes/);
  });
  it("marks every generated preview partial with no browser evidence", () => {
    const report = createCompatibility({ schemaVersion: "1.0", runtimeVersion: "0.1.0", title: "Preview", mode: "menu-only", status: "partial", diagnostics: [] });
    expect(report.status).toBe("partial"); expect(report.browserEvidence).toEqual([]); expect(report.coverage).toMatchObject({ browser: "Chrome only; direct file:// not yet verified", igs: "unverified" });
    expect(report.notVerified).toEqual(expect.arrayContaining(["direct file:// launch", "offline directory relocation", "browser support matrix", "media timeline and seek accuracy"]));
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
      await buildMenuPackage({
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
      await buildMenuPackage({ outputDirectory, title: "Test </script> 菜单", ir, scene: fixtureScene, vmPrograms: [{ id: 0, instructions: [m3Fixtures.break] }], vmEntries: [{ id: "title:0", kind: "title", source: commandSource, target: { objectType: "HDMV", playbackType: 0, target: 0, source: commandSource } }], vmInitialProgramId: 0, graphics: [{ id: "graphic-1", bytes: png1x1 }] });
      const html = await readFile(resolve(outputDirectory, "index.html"), "utf8");
      expect(html.indexOf('<video id="menu-background"')).toBeLessThan(html.indexOf('<canvas id="menu-canvas"'));
      const style = await readFile(resolve(outputDirectory, "runtime/style.css"), "utf8");
      expect(style).toMatch(/#menu-background\{z-index:0\}/); expect(style).toMatch(/#menu-canvas\{z-index:1;background:transparent;touch-action:manipulation\}/);
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
      expect(app).toMatch(/heading\.textContent\s*=\s*title/);
      expect(`${html}\n${app}`).not.toMatch(/(?:https?:)?\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}/i);
      expect(app).toContain("Images decoded"); expect(app).toContain("Unsupported DiscIR schema version"); expect(app).toContain("MEDIA_UNAVAILABLE");
      const data = await readFile(resolve(outputDirectory, "runtime/disc-data.js"), "utf8"); expect(data).not.toContain("</script>");
      expect(data).toContain('"inputConfig":{"escapeMapping":"popup"}');
      expect(data).toContain('"vmEntries":[{"id":"title:0"');
      const report = JSON.parse(await readFile(resolve(outputDirectory, "compatibility.json"), "utf8"));
      expect(report.status).toBe("partial"); expect(report.coverage.igs).toBe("unverified");
      expect(await readFile(resolve(outputDirectory, "README.md"), "utf8")).toContain("bdmv-web validate <package-directory> --offline");
      const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8")) as { files: Array<{ path: string; kind: string; byteLength: string; sha256: string }>; payloadFingerprint: string };
      expect(manifest.files.map((file) => file.path)).toEqual(["index.html", "README.md", "runtime/app.bundle.js", "runtime/assets-data-000.js", "runtime/disc-data.js", "runtime/style.css"]);
      const rows: Array<{ path: string; sha256: string }> = [];
      for (const file of manifest.files) {
        const bytes = await readFile(resolve(outputDirectory, file.path)); const digest = createHash("sha256").update(bytes).digest("hex");
        expect(file.byteLength).toBe(String(bytes.byteLength)); expect(file.sha256).toBe(digest);
        if (!new Set(["readme", "compatibility", "report", "evidence", "parsed-disc", "raw-command-table", "dependency-audit", "asset-manifest"]).has(file.kind)) rows.push({ path: file.path, sha256: digest });
      }
      const fingerprint = createHash("sha256");
      for (const row of rows.sort((a, b) => a.path.localeCompare(b.path, "en"))) fingerprint.update(row.path, "utf8").update("\0").update(row.sha256, "ascii").update("\n");
      expect(manifest.payloadFingerprint).toBe(fingerprint.digest("hex")); expect(report.payloadFingerprint).toBe(manifest.payloadFingerprint);
      expect(data).toContain(m3Fixtures.move5.bytes); expect(data).toContain(m3Fixtures.playPlaylist42.bytes); expect(data).toContain('"id":0'); expect(data).toContain('"vmInitialProgramId":0');
      expect(html).toContain('style="aspect-ratio:1920 / 1080"');
    } finally { if (!preserveOutput) await rm(parent, { recursive: true, force: true }); }
  });
});
