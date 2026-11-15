import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscIR, SerializedScene } from "@bdmv2web/core";
import type { BuildPlan } from "./build-plan.js";
import { buildUseCase } from "./build-use-case.js";

const ir: DiscIR = {
  schemaVersion: "1.0",
  entries: [{ id: "entry-first-play", navigation: { type: "HDMV", movieObjectId: 0 }, source: { path: "BDMV/index.bdmv", origin: "primary", byteOffset: "0" } }],
  programs: [{ id: "program-00001", title: "Test menu" }], menus: [{ id: "menu-00001" }],
  playlists: [{ id: "playlist-00001", programIds: ["program-00001"], menuIds: ["menu-00001"], duration90k: "90000" }], mediaAssets: [], diagnostics: [],
};
const scene: SerializedScene = { width: 1920, height: 1080, compositionTimeout90k: null, selectionTimeout90k: null, pages: [{ id: 0, uoMask: "0", animationFrameRateCode: 0, defaultButtonId: 1, buttons: [] }] };

function plan(): BuildPlan {
  return { packageInput: { ir, scene, graphics: [] }, mediaInputs: [], sceneDetail: "", mediaDetail: "", bundleNote: "", limitations: [] };
}

describe("build use case", () => {
  it("assembles the final package input and keeps the caller's status", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv-use-case-"));
    const writes = vi.spyOn(process.stdout, "write");
    const previousExitCode = process.exitCode;
    try {
      const output = join(parent, "out");
      const result = await buildUseCase({ plan: plan(), outputDirectory: output, title: "Use case", status: "complete" });
      const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as { status: string };
      expect(manifest.status).toBe("complete");
      expect(result.diagnostics).toEqual([]);
      // The command layer owns stdout and the exit code.
      expect(writes).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      writes.mockRestore();
      process.exitCode = previousExitCode;
      await rm(parent, { recursive: true, force: true });
    }
  });
});
