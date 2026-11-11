import { dirname, join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { parseDiscIR } from "@bdmv2web/core";
import { HdmvVm } from "@bdmv2web/hdmv";
import { createHdmvSourceMap } from "./extract.js";
import { createMenuDiscIR, createVmPrograms, menuLoopMediaInput } from "./build.js";

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
