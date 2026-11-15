import { describe, expect, it } from "vitest";
import type { DiscIR } from "./disc-ir.generated.js";
import type { RuntimeDataV1, SerializedScene } from "./runtime-data.js";

const ir = {} as DiscIR;
const scene: SerializedScene = { width: 1920, height: 1080, compositionTimeout90k: null, selectionTimeout90k: null, pages: [] };
type MenuMedia = { playlist: number; background: { path: string; loop: boolean }; audioTracks: Array<{ streamNumber: number; path: string; language: string }> };

// The generator writes these shapes and the browser bootloader reads the same type.
const menuData = {
  ir, scene, vmPrograms: [{ id: 0 }], vmEntries: [{ id: "title:0" }],
  externalTargets: { playlists: [], unknown: [], complete: true },
  media: { playlist: 1, background: { path: "assets/media/background.mp4", loop: true }, audioTracks: [] },
  menuMedia: [],
} satisfies RuntimeDataV1<{ id: number }, { id: string }, { playlists: unknown[]; unknown: unknown[]; complete: boolean }, MenuMedia, unknown>;

const bdjData = {
  ir, scene: null, bdjRuntime: true,
  bdjFiles: [{ path: "BDMV/JAR/00000.jar", packagePath: "bdj/BDMV/JAR/00000.jar" }],
  bdjHostApiPath: "runtime/bdj/bdj-host-api.jar",
} satisfies RuntimeDataV1<{ id: number }, { id: string }, unknown, MenuMedia, unknown>;

describe("runtime data contract", () => {
  it("accepts build output, exposes it to the browser and keeps a pure BD-J scene null", () => {
    // Assignments are the type assertions: the browser reads both through the same DTO.
    const browserScene: SerializedScene | null = menuData.scene;
    const pureBdjScene: SerializedScene | null = bdjData.scene;
    const hostPath: string | undefined = bdjData.bdjHostApiPath;
    expect([browserScene, pureBdjScene, hostPath]).toEqual([scene, null, "runtime/bdj/bdj-host-api.jar"]);
  });
});
