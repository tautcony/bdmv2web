import { describe, expect, it } from "vitest";
import type { IgsAsset, IgsScene, IgsSource } from "@bdmv2web/igs";
import { adaptIgsScene, selectPopupScene } from "./index.js";

const source: IgsSource = { clipId: "00001", pid: 0x18, packetOffset: "192", pesOffset: "208", segmentOffset: "4", segmentFileOffset: "400", pts90k: "9000", timeDomain: 0 };

function fixture(): { scene: IgsScene; assets: IgsAsset[] } {
  const scene: IgsScene = {
    id: "00001:24:7:0:9000", clipId: "00001", pid: 0x18, compositionNumber: 7, compositionState: 0,
    width: 1920, height: 1080, frameRateCode: 1, timeDomain: 0, pts90k: "9000", streamModel: 0, uiModel: 0,
    compositionTimeout90k: "90000", selectionTimeout90k: "4500", userTimeoutDuration: 0, rawIcs: new Uint8Array(),
    pages: [{
      id: 2, version: 1, uoMask: 0n, defaultSelectedButtonId: 11, defaultActivatedButtonId: 12, paletteId: 3,
      buttons: [{
        id: 11, x: 100, y: 200, autoAction: true, numericSelectValue: 11,
        neighbors: { up: 12, down: 13, left: 14, right: 15 },
        visuals: {
          normal: { startObjectId: 21, endObjectId: 21, repeat: false },
          selected: { startObjectId: 22, endObjectId: 22, repeat: false, soundId: 6 },
          activated: { startObjectId: 23, endObjectId: 23, soundId: 9 },
        },
        commands: [{ bytes: Uint8Array.of(0, 1, 2, 10, 15, 255), recordIndex: 0, sourceOffset: "417" }],
      }],
      bogs: [{ defaultButtonId: 11, buttonIds: [11] }],
      rawEffects: { enter: new Uint8Array(), exit: new Uint8Array(), enterEffectCount: 0, exitEffectCount: 0 },
      animationFrameRateCode: 5,
    }],
    objects: [21, 22, 23].map((id) => ({ id, version: 1, width: 30 + id, height: 40 + id, indices: new Uint8Array(), source })),
    palettes: [{ id: 3, version: 4, entries: new Map(), source }], complete: true, source,
  };
  const assets: IgsAsset[] = [21, 22, 23].map((objectId) => ({
    id: `igs-00001-24-7-p2-o${objectId}v1-pal3v4`, relativePath: `assets/${objectId}.png`, mimeType: "image/png",
    width: 30 + objectId, height: 40 + objectId, pngBytes: new Uint8Array(), objectId, objectVersion: 1,
    paletteId: 3, paletteVersion: 4, source, colorConversion: "bt709-limited-round-nearest",
  }));
  return { scene, assets };
}

describe("adaptIgsScene", () => {
  it("preserves M2 page, BOG, state assets, sounds, neighbors and raw command offsets", () => {
    const { scene, assets } = fixture();
    const result = adaptIgsScene(scene, assets);
    expect(result.status).toBe("complete");
    expect(result.diagnostics).toEqual([]);
    expect(result.scene).toEqual({
      id: scene.id, clipId: scene.clipId, pid: scene.pid, streamModel: 0, uiModel: 0, source,
      width: 1920, height: 1080, compositionTimeout90k: "90000", selectionTimeout90k: "4500",
      pages: [{
        id: 2, uoMask: "0", defaultButtonId: 11, defaultActivatedButtonId: 12, bogDefaults: [{ bog: 0, defaultButtonId: 11 }],
        animationFrameRateCode: 5,
        rawEffects: { enterBytesHex: "", exitBytesHex: "", enterEffectCount: 0, exitEffectCount: 0 },
        buttons: [{
          id: 11, bog: 0, enabled: true, autoAction: true,
          neighbors: { up: 12, down: 13, left: 14, right: 15 },
          states: {
            normal: { bounds: { x: 100, y: 200, width: 51, height: 61 }, assetId: assets[0]!.id, startObjectId: 21, endObjectId: 21, repeat: false },
            selected: { bounds: { x: 100, y: 200, width: 52, height: 62 }, assetId: assets[1]!.id, startObjectId: 22, endObjectId: 22, repeat: false, soundId: 6 },
            activated: { bounds: { x: 100, y: 200, width: 53, height: 63 }, assetId: assets[2]!.id, startObjectId: 23, endObjectId: 23, soundId: 9 },
          },
          commands: [{ bytes: "0001020a0fff", sourceOffset: "417" }],
        }],
      }],
    });
  });

  it("selects the latest popup composition for the active clip, PID, time and domain", () => {
    const { scene, assets } = fixture();
    scene.uiModel = 1;
    const first = adaptIgsScene(scene, assets).scene;
    const later = structuredClone(first); later.id = "later"; later.source = { ...source, pts90k: "18000" };
    const before = selectPopupScene([first, later], "00001", 0x18, 17_999, 0);
    const atMark = selectPopupScene([first, later], "00001", 0x18, 18_000, 0);
    expect(before.status).toBe("selected"); if (before.status === "selected") expect(before.scene).toEqual(first);
    expect(atMark.status).toBe("selected"); if (atMark.status === "selected") expect(atMark.scene).toEqual(later);
    expect(selectPopupScene([first, later], "00001", 0x18, 18_000, 1).status).toBe("not-found");
  });

  it("preserves dynamic-selection and activate-current-selection sentinels", () => {
    const { scene, assets } = fixture();
    scene.pages[0]!.defaultSelectedButtonId = 0xffff;
    scene.pages[0]!.defaultActivatedButtonId = 0xfffe;
    const result = adaptIgsScene(scene, assets);
    expect(result.scene.pages[0]).toMatchObject({ defaultButtonId: 0xffff, defaultActivatedButtonId: 0xfffe });
    expect(result.diagnostics).toEqual([]);
  });

  it("marks unsupported animation and page effects partial while using only the declared starting frame", () => {
    const { scene, assets } = fixture(); const button = scene.pages[0]!.buttons[0]!;
    button.visuals.selected.endObjectId = 23;
    button.visuals.selected.repeat = true;
    scene.pages[0]!.rawEffects.enterEffectCount = 1;
    scene.pages[0]!.rawEffects.enter = new Uint8Array([0xa5, 0x02]);
    scene.pages[0]!.rawEffects.exit = new Uint8Array([0xe0]);
    scene.pages[0]!.rawEffects.exitEffectCount = 2;
    const result = adaptIgsScene(scene, assets);
    expect(result.status).toBe("partial");
    expect(result.scene.pages[0]!.buttons[0]!.states.selected?.assetId).toBe(assets[1]!.id);
    expect(result.scene.pages[0]!.buttons[0]!.states.selected).toMatchObject({ startObjectId: 22, endObjectId: 23, repeat: true });
    expect(result.scene.pages[0]!.rawEffects).toEqual({ enterBytesHex: "a502", exitBytesHex: "e0", enterEffectCount: 1, exitEffectCount: 2 });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["IGS_UNSUPPORTED_ANIMATION", "IGS_UNSUPPORTED_EFFECT"]);
  });

  it("preserves all source UO mask bits as an exact decimal string", () => {
    const { scene, assets } = fixture();
    scene.pages[0]!.uoMask = (1n << 63n) | (1n << 43n) | (1n << 7n);
    const result = adaptIgsScene(scene, assets);
    expect(result.scene.pages[0]!.uoMask).toBe(((1n << 63n) | (1n << 43n) | (1n << 7n)).toString(10));
  });

  it("disables buttons without a uniquely declared BOG or safely rendered hit bounds", () => {
    const { scene } = fixture();
    scene.pages[0]!.bogs[0]!.buttonIds = [];
    const result = adaptIgsScene(scene, []);
    const button = result.scene.pages[0]!.buttons[0]!;
    expect(button.enabled).toBe(false);
    expect(button.bog).toBeUndefined();
    expect(button.states).toEqual({});
    expect(result.diagnostics.map(({ code }) => code)).toContain("IGS_BUTTON_WITHOUT_BOG");
    expect(result.diagnostics.map(({ code }) => code)).toContain("IGS_BUTTON_WITHOUT_HIT_GEOMETRY");
    expect(result.diagnostics.map(({ code }) => code)).toContain("IGS_UNRESOLVED_VISUAL_ASSET");
  });

  it("keeps a declared geometry-free auto-action executable while leaving it un-hittable", () => {
    const { scene } = fixture();
    const result = adaptIgsScene(scene, []);
    const button = result.scene.pages[0]!.buttons[0]!;
    expect(button.enabled).toBe(true);
    expect(button.autoAction).toBe(true);
    expect(button.states).toEqual({});
    expect(result.diagnostics.map(({ code }) => code)).toContain("IGS_BUTTON_WITHOUT_HIT_GEOMETRY");
  });
});
