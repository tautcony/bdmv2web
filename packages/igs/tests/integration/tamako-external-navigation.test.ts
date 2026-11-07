import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { HdmvVm } from "@bdmv2web/hdmv";
import { extractIgsFromChunks } from "../../src/extract.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const root = resolve(repositoryRoot, "test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");

describe("Tamako menu-to-feature navigation", () => {
  it("preserves First Play initialization, enters Top Menu, and resolves the film button to playlist 42", async () => {
    const disc = await parseBdmv(root);
    const packetPath = resolve(root, "STREAM/00005.m2ts_ig-packets.bin");
    const packetBytes = await readFile(packetPath);
    async function* chunks() {
      for (let offset = 0; offset < packetBytes.length; offset += 192 * 97) {
        yield packetBytes.subarray(offset, Math.min(offset + 192 * 97, packetBytes.length));
      }
    }
    const extraction = await extractIgsFromChunks("00005", chunks(), [{
      pid: 0x1400,
      source: { path: "BDMV/CLIPINF/00005.clpi", origin: "primary", offset: "0" },
    }], { renderAssets: false });
    const scene = extraction.scenes.find((item) => item.clipId === "00005")!;
    const first = disc.entries.find((entry) => entry.kind === "firstPlay")!;
    const vm = new HdmvVm(disc.movieObjects, { entries: disc.entries });
    vm.reset(first.target.target as number);
    const startup = vm.runTurn(); expect(startup.waiting?.payload.playlist).toBe(57);
    vm.releaseExternalPlayback(startup.waiting!); vm.drainActions();
    expect(vm.selectTitle(0).waiting?.payload.playlist).toBe(3); vm.drainActions();
    const button = scene.pages.find((page) => page.id === 1)!.buttons.find((item) => item.id === 0)!;
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = vm.snapshot(); vm.beginMenuAction();
      const selected = vm.executeButtonProgram(button.commands.map((command) => command.bytes), "ig_object");
      expect(selected.actions).toContainEqual(expect.objectContaining({ type: "TITLE_SEARCH", payload: { title: 1 } }));
      vm.drainActions();
      const feature = vm.selectTitle(1);
      expect(feature.waiting).toMatchObject({ type: "PLAY_PLAYLIST", payload: { playlist: 42 } });
      vm.releaseExternalPlayback(feature.waiting!); vm.drainActions();
      expect(vm.snapshot()).toMatchObject({ status: before.status, programId: before.programId, registers: before.registers, waiting: before.waiting });
    }
  });
});
