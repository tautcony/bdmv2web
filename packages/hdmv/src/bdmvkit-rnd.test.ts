import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { HdmvVm } from "./index.js";

describe("bdmvkit-generated HDMV random-playback fixture", () => {
  it("executes the authored RND command and continues into playlist playback", async () => {
    const bdmvRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-data/fixtures/bdmvkit-generated/BDMV");
    const disc = await parseBdmv(bdmvRoot);
    const vm = new HdmvVm(disc.movieObjects, { entries: disc.entries, randomSeed: 1 });
    vm.reset(2);

    let result = vm.runTurn();
    const randomTrace = vm.trace.find((entry) => entry.decoded?.startsWith("RND"));
    expect(randomTrace?.registerDelta.gpr[7]).toBe(3);
    expect(result.status).not.toBe("faulted");

    const played: number[] = [];
    for (let count = 0; count < 20 && result.status !== "stopped" && result.status !== "faulted"; count += 1) {
      const pending = vm.drainActions();
      for (const action of pending) {
        if (action.type === "PLAY_PLAYLIST") played.push(Number(action.payload.playlist));
        result = vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
      }
      if (pending.length === 0) result = vm.runTurn();
    }
    expect(played).toHaveLength(3);
    expect(new Set(played)).toEqual(new Set([6, 7, 8]));
  });
});
