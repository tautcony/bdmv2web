import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBdmv, type ParsedDisc } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes, type IgsExtraction } from "@bdmv2web/igs";
import { extractPgsTrack, resolveMenuLoopStart45k } from "@bdmv2web/media-export";
import { convertSounds } from "@bdmv2web/package-builder";
import { decodeInstruction, HdmvVm } from "@bdmv2web/hdmv";
import { adaptIgsScene } from "@bdmv2web/runtime-web";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../test-data/fixtures/synthetic-all-features/BDMV");
const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** The generated disc is a single fixture covering the union of features used by the test-data menus. */
describe("synthetic all-features disc", () => {
  let disc!: ParsedDisc;
  let extraction!: IgsExtraction;
  let output!: string;

  beforeAll(async () => {
    disc = await parseBdmv(ROOT);
    extraction = await extractIgsScenes(disc);
    output = await mkdtemp(join(tmpdir(), "synthetic-all-features-"));
  });

  afterAll(async () => { await rm(output, { recursive: true, force: true }); });

  it("parses index, UHD metadata, movie objects, playlists, clips and sounds without diagnostics", () => {
    expect(disc.diagnostics).toEqual([]);
    expect(disc.discInfo.appInfo).toMatchObject({ contentExistFlag: true, initialDynamicRangeType: 1, videoFormat: 6, frameRate: 1 });
    expect(disc.discInfo.uhd).toMatchObject({ discType: 5, exists4k: true, hdrFlags: 3, hdr10Plus: true, dolbyVision: true });
    expect(disc.entries.map((entry) => [entry.kind, entry.target.target])).toEqual([
      ["firstPlay", 0], ["topMenu", 1], ["title", 2], ["title", 3],
    ]);
    expect(disc.movieObjects.map((object) => object.instructions.length)).toEqual([2, 5, 4, 5]);
    expect(disc.declarations).toMatchObject({ entries: 4, movieObjects: 4, playlists: 3, playItems: 4, clips: 3, streams: 13, sounds: 2 });
    expect(disc.graph.nodes.filter((node) => node.state === "missing")).toEqual([]);
    // libbluray reads CLPI sections from declared addresses and demuxes complete
    // 6144-byte transport units; both invariants were required for its read-back.
    expect(disc.clips.map((clip) => clip.header?.sourcePacketCount)).toEqual([32, 32, 32]);
    expect(disc.clips.every((clip) => clip.cpi.length === 1)).toBe(true);
  });

  it("declares shuffle, random and sequential playlists with chapters, a SubPath and loop marks", () => {
    const loop = disc.playlists.find((playlist) => playlist.id === "00001")!;
    const random = disc.playlists.find((playlist) => playlist.id === "00002")!;
    const sequential = disc.playlists.find((playlist) => playlist.id === "00003")!;
    expect([loop.appInfo?.playbackType, random.appInfo?.playbackType, sequential.appInfo?.playbackType]).toEqual([3, 2, 1]);
    expect(loop.appInfo?.randomAccessFlag).toBe(true);
    expect(loop.playItems[0]?.stillMode).toBe(2);
    expect(loop.subPaths[0]?.items[0]?.clipId).toBe("00003");
    expect(loop.marks.map((mark) => [mark.type, mark.playItemRef, mark.time45k])).toEqual([[1, 0, 0], [1, 0, 85_522], [2, 0, 120_000]]);
    expect(resolveMenuLoopStart45k(loop.playItems[0]!.index, loop.playItems[0]!.inTime45k, loop.playItems[0]!.outTime45k, loop.marks)).toBe(85_522);
    expect(sequential.playItems.map((item) => item.clipId)).toEqual(["00001", "00002"]);
    expect(sequential.marks.map((mark) => mark.playItemRef)).toEqual([0, 1]);
  });

  it("declares HEVC/UHD stream attributes and two languages of audio and subtitles", () => {
    const title = disc.clips.find((clip) => clip.id === "00002")!;
    const streams = title.programs[0]!.streams;
    expect(streams.find((stream) => stream.codingType === 0x24)).toMatchObject({ dynamicRangeType: 1, colorSpace: 2 });
    expect(streams.filter((stream) => stream.codingType === 0x80).map((stream) => stream.language)).toEqual(["eng", "fra"]);
    expect(streams.filter((stream) => stream.codingType === 0x90).map((stream) => stream.language)).toEqual(["eng", "fra"]);
    expect(streams.some((stream) => stream.codingType === 0x91 && stream.pid === 0x1400)).toBe(true);
    expect(disc.sounds).toMatchObject([
      { index: 0, channels: 1, sampleRate: 48000, bitsPerSample: 16, sampleOffset: 80, sampleByteLength: 4 },
      { index: 1, channels: 1, sampleRate: 48000, bitsPerSample: 16, sampleOffset: 84, sampleByteLength: 4 },
    ]);
  });

  it("decodes every HDMV command and executes the RND/PLAY_PL movie object", () => {
    const instructions = disc.movieObjects.flatMap((object) => object.instructions);
    expect(instructions.map((instruction) => decodeInstruction(instruction).issues)).toEqual(instructions.map(() => []));
    expect(disc.movieObjects[2]!.instructions.map((instruction) => decodeInstruction(instruction).opcode)).toEqual(["MOVE", "RND", "PLAY_PL", "BREAK"]);
    const rndObject = disc.movieObjects[2]!;
    const vm = new HdmvVm([{ id: 0, instructions: rndObject.instructions.map((instruction) => instruction.bytes) }], { randomSeed: 1 });
    expect(vm.runTurn()).toMatchObject({ status: "suspended" });
    expect(vm.trace.filter((entry) => entry.decoded?.startsWith("RND"))).toHaveLength(1);
    expect(vm.snapshot().registers.gpr[7]).toBe(3);
    expect(vm.actions.at(-1)).toMatchObject({ type: "PLAY_PLAYLIST", payload: { playlist: 3 } });
  });

  it("extracts a two-page multi-BOG menu with effects, animation, sounds and commands", () => {
    expect(extraction.status).toBe("complete");
    expect(extraction.diagnostics).toEqual([]);
    const menu = extraction.scenes.find((scene) => scene.clipId === "00001")!;
    // compositionState 2 (epoch start) is what makes libbluray initialize the menu.
    expect(menu).toMatchObject({ uiModel: 0, streamModel: 1, compositionNumber: 1, compositionState: 2, pts90k: "90000", complete: true });
    expect(menu.pages.map((page) => page.id)).toEqual([0, 1]);
    const first = menu.pages[0]!;
    expect(first.bogs).toEqual([
      { defaultButtonId: 1, buttonIds: [1, 2, 3] },
      { defaultButtonId: 4, buttonIds: [4] },
    ]);
    expect(first.buttons.map((button) => button.id)).toEqual([1, 2, 3, 4]);
    expect(first.animationFrameRateCode).toBe(1);
    expect(first.effects.enter.windows).toEqual([{ id: 1, x: 0, y: 0, width: 1920, height: 1080 }]);
    expect(first.effects.enter.effects).toEqual([{ duration90k: 90_000, paletteId: 0, objects: [{ objectId: 5, windowId: 1, forcedOn: true, x: 0, y: 0 }] }]);
    expect(first.effects.exit.effects[0]?.duration90k).toBe(45_000);
    expect(first.buttons[1]).toMatchObject({ autoAction: true, visuals: { normal: { repeat: true }, selected: { soundId: 1 }, activated: { soundId: 0 } } });
    expect(first.buttons[0]!.visuals.activated.soundId).toBe(1);
    expect(first.buttons[3]!.commands.map((command) => hex(command.bytes))).toEqual([
      "318000040000000100000000", "428200000000000000000fff",
    ]);
    expect(menu.pages[1]!.defaultActivatedButtonId).toBe(0xfffe);
    expect(extraction.assets).toHaveLength(3);
  });

  it("extracts a timed popup composition from the title clip", () => {
    const popup = extraction.scenes.find((scene) => scene.clipId === "00002")!;
    expect(popup).toMatchObject({
      uiModel: 1, streamModel: 0, compositionNumber: 2, compositionState: 2, complete: true,
      compositionTimeout90k: "90000", selectionTimeout90k: "45000", userTimeoutDuration: 123,
    });
    expect(popup.pages[0]!.buttons.map((button) => button.commands.map((command) => hex(command.bytes)))).toEqual([
      ["110000070000000000000000"], ["514000010000000000000000"],
    ]);
  });

  it("adapts the menu and converts both referenced sounds to 48 kHz 16-bit mono WAV", async () => {
    const menu = extraction.scenes.find((scene) => scene.clipId === "00001")!;
    const adapted = adaptIgsScene(menu, extraction.assets);
    expect(adapted.status).toBe("complete");
    expect(adapted.diagnostics).toEqual([]);
    expect(adapted.scene.pages[0]!.buttons.map((button) => button.bog)).toEqual([0, 0, 0, 1]);
    const source = new Uint8Array(await readFile(join(ROOT, "AUXDATA/sound.bdmv")));
    const converted = convertSounds(disc.sounds, source, adapted.scene);
    expect(converted.diagnostics).toEqual([]);
    expect(converted.assets.map((asset) => asset.path)).toEqual(["assets/audio/sound-0.wav", "assets/audio/sound-1.wav"]);
    expect(converted.files).toHaveLength(2);
    for (const file of converted.files) {
      const wav = file.bytes;
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
      expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
      expect(view.getUint16(22, true)).toBe(1);
      expect(view.getUint32(24, true)).toBe(48_000);
      expect(view.getUint16(34, true)).toBe(16);
      expect(view.getUint32(40, true)).toBe(4);
    }
  });

  it("extracts both declared PGS languages with show and clear display sets", async () => {
    for (const [pid, pts90k] of [[0x1200, 180_000], [0x1201, 270_000]] as const) {
      const track = await extractPgsTrack(join(ROOT, "STREAM/00002.m2ts"), pid, join(output, `pg-${pid}.sup`));
      expect(track.pid).toBe(pid);
      expect(track.displaySets).toHaveLength(2);
      expect(track.displaySets[0]).toMatchObject({ pts90k, compositionNumber: 0, paletteId: 0, width: 1920, height: 1080 });
      expect(track.displaySets[0]!.placements).toEqual([{ objectId: 1, windowId: 0, x: 0, y: 0 }]);
      expect([...track.displaySets[0]!.bitmaps.values()][0]!.pixels).toHaveLength(4);
      expect(track.displaySets[1]).toMatchObject({ pts90k, compositionNumber: 1 });
      expect(track.displaySets[1]!.placements).toEqual([]);
    }
  });
});
