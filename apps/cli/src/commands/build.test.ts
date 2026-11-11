import { dirname, join } from "node:path";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { parseDiscIR } from "@bdmv2web/core";
import { HdmvVm } from "@bdmv2web/hdmv";
import { createHdmvSourceMap } from "./extract.js";
import { createMenuDiscIR, createVmPrograms, MENU_MEDIA_AUTO_MAX_SECONDS, menuLoopMediaInput, menuMediaEntryPoint45k, menuMediaScopedOut, playlistDurationSeconds, resumeMediaDirectory } from "./build.js";

describe("menu DiscIR source references", () => {
  it("keeps BD-J PlayItems finite while retaining the static background loop contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdj-finite-menu-"));
    try {
      await mkdir(join(root, "STREAM"), { recursive: true });
      await writeFile(join(root, "STREAM", "00001.m2ts"), "fixture");
      const parsed = {
        root,
        clips: [],
      } as unknown as Awaited<ReturnType<typeof parseBdmv>>;
      const item = (index: number) => ({
        index, clipId: "00001", inTime45k: 45_000, outTime45k: 90_000, multiAngle: false, stillMode: 0,
        streams: [
          { pid: 0x1011, codingType: 0x1b, streamType: 1, language: null },
          { pid: 0x1100, codingType: 0x81, streamType: 1, language: "eng" },
        ],
      });
      const playlist = {
        id: "00007",
        playItems: [item(0), item(1)],
        marks: [{ index: 0, type: 1, playItemRef: 1, time45k: 67_500 }],
      } as unknown as Awaited<ReturnType<typeof parseBdmv>>["playlists"][number];

      const staticBackground = await menuLoopMediaInput(parsed, playlist, { playItemIndex: 1 });
      expect(staticBackground).toMatchObject({ repeatCount: 2, loopBackground: true, loopStart45k: 67_500 });

      const bdjItem0 = await menuLoopMediaInput(parsed, playlist, { playItemIndex: 0, purpose: "bdj-playback" });
      const bdjItem1 = await menuLoopMediaInput(parsed, playlist, { playItemIndex: 1, purpose: "bdj-playback" });
      expect(bdjItem0).toMatchObject({ playItemIndex: 0, inTime45k: 45_000, outTime45k: 90_000, repeatCount: 1, loopBackground: false });
      expect(bdjItem0).not.toHaveProperty("loopStart45k");
      expect(bdjItem1).toMatchObject({ playItemIndex: 1, repeatCount: 1, loopBackground: false });
      expect(bdjItem1).not.toHaveProperty("loopStart45k");
      const stillPlaylist = { ...playlist, playItems: [{ ...item(0), stillMode: 2 }] } as unknown as typeof playlist;
      const stillItem = await menuLoopMediaInput(parsed, stillPlaylist, { playItemIndex: 0, purpose: "bdj-playback" });
      expect(stillItem).toMatchObject({ stillMode: 2, repeatCount: 1, loopBackground: false });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("preserves the parsed index source in a schema-valid menu IR", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const disc = await parseBdmv(root);
    const ir = createMenuDiscIR(disc, [], false);

    expect(ir.entries[0]?.source).toMatchObject({ path: "index.bdmv", origin: "primary", byteOffset: expect.stringMatching(/^(0|[1-9][0-9]*)$/) });
    expect(parseDiscIR(ir)).toBe(ir);
  });

  it("preserves each parsed instruction source and index in the packaged VM program", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const disc = await parseBdmv(root);
    const instruction = createVmPrograms(disc)[0]?.instructions[0];

    expect(instruction).toMatchObject({ source: { path: "MovieObject.bdmv", origin: "primary", offset: expect.stringMatching(/^(0|[1-9][0-9]*)$/), instructionIndex: 0 } });
  });

  it("keeps the instruction source and index on VM trace entries", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const disc = await parseBdmv(root);
    const vm = new HdmvVm(createVmPrograms(disc), { entries: disc.entries });
    vm.reset(0);
    vm.runTurn();

    expect(vm.trace.find((entry) => entry.source?.instructionIndex === 0)).toMatchObject({ source: { path: "MovieObject.bdmv", offset: expect.stringMatching(/^(0|[1-9][0-9]*)$/), instructionIndex: 0 } });
  });

  it("maps an instruction source to its file byte offset", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const disc = await parseBdmv(root);

    expect(createHdmvSourceMap(disc).instructions[0]).toMatchObject({ instructionIndex: 0, source: { path: "MovieObject.bdmv", origin: "primary", byteOffset: expect.stringMatching(/^(0|[1-9][0-9]*)$/), instructionIndex: 0 } });
  });
});

describe("resume media directory", () => {
  it("rejects a directory that does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-resume-missing-"));
    try {
      await expect(resumeMediaDirectory(join(root, "BDMV-menu"), join(root, "absent"))).rejects.toThrow(/CLI_INVALID_RESUME/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reads the newest staging directory left beside the output target", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-resume-staging-"));
    try {
      const older = join(root, ".BDMV-menu.staging-older");
      const newer = join(root, ".BDMV-menu.staging-newer");
      await mkdir(older); await mkdir(newer);
      await utimes(older, new Date(1_000_000), new Date(1_000_000));
      await utimes(newer, new Date(2_000_000), new Date(2_000_000));
      await expect(resumeMediaDirectory(join(root, "BDMV-menu"), true)).resolves.toBe(newer);
      await expect(resumeMediaDirectory(join(root, "BDMV-menu"), root)).resolves.toBe(root);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reports a bare --resume with no staging directory to read", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-resume-none-"));
    try {
      await expect(resumeMediaDirectory(join(root, "BDMV-menu"), true)).rejects.toThrow(/no staging directory/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("menu media scope", () => {
  const playlist = (...secondsPerItem: number[]) => ({
    id: "00001",
    playItems: secondsPerItem.map((seconds, index) => ({ index, inTime45k: 0, outTime45k: seconds * 45_000 })),
  }) as unknown as Awaited<ReturnType<typeof parseBdmv>>["playlists"][number];

  it("adds the PlayItem spans instead of reading the last out-time", () => {
    expect(playlistDurationSeconds(playlist(60, 90))).toBe(150);
    expect(playlistDurationSeconds(playlist())).toBe(0);
  });

  it("keeps menu-length playlists under auto and drops feature-length ones", () => {
    const menu = playlist(30, 30);
    const feature = playlist(MENU_MEDIA_AUTO_MAX_SECONDS + 1);
    expect(menuMediaScopedOut(menu, "auto")).toBe(false);
    expect(menuMediaScopedOut(feature, "auto")).toBe(true);
  });

  it("treats all as no ceiling and none as an empty set", () => {
    const feature = playlist(MENU_MEDIA_AUTO_MAX_SECONDS * 4);
    expect(menuMediaScopedOut(feature, "all")).toBe(false);
    expect(menuMediaScopedOut(playlist(1), "none")).toBe(true);
  });

  it("takes an explicit ceiling for auto", () => {
    const playlist_ = playlist(1200);
    expect(menuMediaScopedOut(playlist_, "auto")).toBe(true);
    expect(menuMediaScopedOut(playlist_, "auto", 1800)).toBe(false);
  });
});

describe("menu media entry point", () => {
  const disc = { clips: [{ id: "00409", cpi: [
    { pid: 0x1011, epStreamType: 1, pts45k: 524032 },
    { pid: 0x1011, epStreamType: 1, pts45k: 552192 },
    { pid: 0x1100, epStreamType: 1, pts45k: 570000 },
    { pid: 0x1011, epStreamType: 0, pts45k: 600000 },
  ] }] } as unknown as Awaited<ReturnType<typeof parseBdmv>>;

  it("takes the latest video entry point at or before the export start", () => {
    expect(menuMediaEntryPoint45k(disc, "00409", 524280)).toBe(524032);
    expect(menuMediaEntryPoint45k(disc, "00409", 552192)).toBe(552192);
  });

  it("ignores entry points of other streams", () => {
    expect(menuMediaEntryPoint45k(disc, "00409", 580000, 0x1011)).toBe(552192);
    expect(menuMediaEntryPoint45k(disc, "00409", 580000, 0x1100)).toBe(570000);
    expect(menuMediaEntryPoint45k(disc, "00409", 580000)).toBe(570000);
  });

  it("names no entry point before the first keyframe or for an unknown clip", () => {
    expect(menuMediaEntryPoint45k(disc, "00409", 100)).toBeUndefined();
    expect(menuMediaEntryPoint45k(disc, "99999", 600000)).toBeUndefined();
  });
});
