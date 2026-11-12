import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes } from "@bdmv2web/igs";
import { extractPgsTrack } from "@bdmv2web/media-export";
import { minimalHdmvGolden } from "@bdmv2web/test-fixtures";
import { adaptIgsScene } from "@bdmv2web/runtime-web";
import { buildMenuPackage } from "../../src/index.js";

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../test-data/fixtures/synthetic-all-features/BDMV");

describe("package builder with the existing synthetic BDMV fixture", () => {
  let outputRoot: string;

  beforeAll(async () => {
    outputRoot = await mkdtemp(join(tmpdir(), "package-builder-existing-fixture-"));
  });

  afterAll(async () => {
    await rm(outputRoot, { recursive: true, force: true });
  });

  it("packages parsed menus, graphics and sounds into the runtime package", async () => {
    const disc = await parseBdmv(fixtureRoot);
    const extraction = await extractIgsScenes(disc);
    const menu = extraction.scenes.find((scene) => scene.clipId === "00001" && scene.uiModel === 0);
    expect(menu).toBeDefined();
    const adaptedMenu = adaptIgsScene(menu!, extraction.assets).scene;
    const popupScenes = extraction.scenes
      .filter((scene) => scene.uiModel === 1)
      .map((scene) => adaptIgsScene(scene, extraction.assets).scene);
    const sourceSounds = new Uint8Array(await readFile(join(fixtureRoot, "AUXDATA/sound.bdmv")));
    const subtitlePath = "assets/subtitles/english.sup";
    const subtitle = await extractPgsTrack(join(fixtureRoot, "STREAM/00002.m2ts"), 0x1200, join(outputRoot, subtitlePath));
    const subtitlePlaylist = disc.playlists.find((playlist) => playlist.playItems.some((item) => item.clipId === "00002" && item.streams.some((stream) => stream.pid === subtitle.pid)))!;
    const subtitlePlayItem = subtitlePlaylist.playItems.find((item) => item.clipId === "00002" && item.streams.some((stream) => stream.pid === subtitle.pid))!;
    const subtitleDeclaration = subtitlePlayItem.streams.find((stream) => stream.pid === subtitle.pid)!;
    const phases: string[] = [];

    const result = await buildMenuPackage({
      outputDirectory: outputRoot,
      title: "Synthetic all-features fixture",
      ir: minimalHdmvGolden,
      scene: adaptedMenu,
      popupScenes,
      menuScenes: [{ playlistId: 1, scene: adaptedMenu }],
      menuPlaylistIds: [1],
      menuPlaylistMarks: [{ playlistId: 1, marks: disc.playlists.find((playlist) => playlist.id === "00001")!.marks.map((mark) => ({ index: mark.index, playItemRef: mark.playItemRef })) }],
      soundEntries: disc.sounds,
      soundBytes: sourceSounds,
      graphics: extraction.assets.map((asset) => ({ id: asset.id, bytes: asset.pngBytes })),
      pgsTracks: [{
        playlistId: subtitlePlaylist.id, playlistNumber: Number(subtitlePlaylist.id), playItemIndex: subtitlePlayItem.index,
        clipId: subtitlePlayItem.clipId, pid: subtitle.pid, streamNumber: (subtitleDeclaration.categoryIndex ?? 0) + 1,
        language: subtitleDeclaration.language ?? "und", sourceIn90k: String(subtitlePlayItem.inTime45k * 2),
        sourceOut90k: String(subtitlePlayItem.outTime45k * 2), source: subtitleDeclaration.source.path,
        path: subtitlePath, displaySets: subtitle.displaySets,
      }],
      status: "complete",
      entryCounts: { declared: disc.entries.length, hdmv: disc.entries.filter((entry) => entry.target.objectType === "HDMV").length },
      diagnostics: extraction.diagnostics,
      onPhase: (phase) => phases.push(phase),
    });

    const manifest = JSON.parse(await readFile(join(outputRoot, "manifest.json"), "utf8")) as {
      status: string;
      declaredEntryCount: number;
      hdmvEntryCount: number;
      files: Array<{ path: string; kind: string }>;
      assets: { sounds: Array<{ path: string }>; pgsTracks: Array<{ path: string; displaySetCount: number }> };
    };
    const data = await readFile(join(outputRoot, "runtime/disc-data.js"), "utf8");

    expect(result.diagnostics).toEqual(extraction.diagnostics);
    expect(manifest).toMatchObject({ status: "complete", declaredEntryCount: 4, hdmvEntryCount: 4 });
    expect(manifest.files.some((file) => file.path === "runtime/app.bundle.js")).toBe(true);
    expect(manifest.files.some((file) => file.path.startsWith("runtime/assets-data-"))).toBe(true);
    expect(manifest.assets.sounds.map((sound) => sound.path)).toEqual(["assets/audio/sound-0.wav", "assets/audio/sound-1.wav"]);
    expect(manifest.assets.pgsTracks).toMatchObject([{ path: subtitlePath, displaySetCount: subtitle.displaySets.length }]);
    expect(data).toContain('"menuPlaylistIds":[1]');
    expect(data).toContain('"menuScenes":[{"playlistId":1');
    expect((await readdir(join(outputRoot, "assets/audio"))).sort()).toEqual(["sound-0.wav", "sound-1.wav"]);
    expect(phases).toEqual(["media", "assets", "bundle", "manifest"]);
  });
});
