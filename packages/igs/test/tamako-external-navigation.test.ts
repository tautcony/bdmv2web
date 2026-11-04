import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv-web/bdmv-parser";
import { HdmvVm } from "@bdmv-web/hdmv";
import { extractIgsScenes } from "../src/extract.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-data/bdmv/tamako-love-story-bd/BDMV");
const available = await Promise.all(["00005", "00006"].map((id) => access(resolve(root, `STREAM/${id}.m2ts`)).then(() => true, () => false))).then((values) => values.every(Boolean));

describe.skipIf(!available)("Tamako menu-to-feature navigation", () => {
  it("preserves First Play initialization, enters Top Menu, and resolves the film button to playlist 42", async () => {
    const disc = await parseBdmv(root); const extraction = await extractIgsScenes(disc);
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
      const selected = vm.executeButtonProgram(button.commands.map((command) => command.bytes), "ig-button");
      expect(selected.actions).toContainEqual(expect.objectContaining({ type: "TITLE_SEARCH", payload: { title: 1 } }));
      vm.drainActions();
      const feature = vm.selectTitle(1);
      expect(feature.waiting).toMatchObject({ type: "PLAY_PLAYLIST", payload: { playlist: 42 } });
      vm.releaseExternalPlayback(feature.waiting!); vm.drainActions();
      expect(vm.snapshot()).toMatchObject({ status: before.status, programId: before.programId, registers: before.registers, waiting: before.waiting });
    }
  });
});
