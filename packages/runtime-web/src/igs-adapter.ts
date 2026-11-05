import type { IgsAsset, IgsScene, IgsSource } from "@bdmv-web/igs";

export interface SerializedMenuState {
  bounds: { x: number; y: number; width: number; height: number };
  assetId?: string;
  soundId?: number;
  startObjectId: number;
  endObjectId: number;
  repeat?: boolean;
}

export interface SerializedMenuButton {
  id: number;
  bog?: number;
  enabled?: boolean;
  autoAction?: boolean;
  neighbors: { up: number; down: number; left: number; right: number };
  states: { normal?: SerializedMenuState; selected?: SerializedMenuState; activated?: SerializedMenuState };
  commands?: Array<{ bytes: string; sourceOffset?: string }>;
}

export interface SerializedMenuPage {
  id: number;
  uoMask: string;
  defaultButtonId: number;
  animationFrameRateCode: number;
  /** Raw effect records as lowercase hex; embedded flag bits remain uninterpreted. */
  rawEffects: { enterBytesHex: string; exitBytesHex: string; enterEffectCount: number; exitEffectCount: number };
  defaultActivatedButtonId?: number;
  bogDefaults?: Array<{ bog: number; defaultButtonId: number }>;
  buttons: SerializedMenuButton[];
  allowedActions?: Record<string, boolean>;
}

/** JSON-safe shape accepted by the M4 browser bootloader. */
export interface SerializedScene {
  width: number;
  height: number;
  compositionTimeout90k: string | null;
  selectionTimeout90k: string | null;
  pages: SerializedMenuPage[];
}

export interface IgsAdapterDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  sceneId: string;
  pageId?: number;
  buttonId?: number;
  source: IgsSource | null;
  details?: Record<string, number | string | boolean | null>;
}

export interface IgsSceneAdapterResult {
  scene: SerializedScene;
  status: "complete" | "partial";
  diagnostics: IgsAdapterDiagnostic[];
}

const NO_OBJECT = 0xffff;

/** Convert one decoded IGS scene to the M4 browser scene contract. */
export function adaptIgsScene(scene: IgsScene, assets: readonly IgsAsset[], options: { allowMissingAssets?: boolean } = {}): IgsSceneAdapterResult {
  const diagnostics: IgsAdapterDiagnostic[] = [];
  const pages = scene.pages.map((page) => {
    const bogByButton = new Map<number, number[]>();
    const bogDefaults = page.bogs.map((bog, index) => ({ bog: index, defaultButtonId: bog.defaultButtonId }));
    page.bogs.forEach((bog, index) => {
      for (const buttonId of bog.buttonIds) {
        const memberships = bogByButton.get(buttonId) ?? [];
        memberships.push(index);
        bogByButton.set(buttonId, memberships);
      }
    });

    const buttons = page.buttons.map((button) => {
      const membership = bogByButton.get(button.id) ?? [];
      const state = (name: "normal" | "selected" | "activated"): SerializedMenuState | undefined => {
        const visual = button.visuals[name];
        if (visual.startObjectId === NO_OBJECT) {
          if (visual.endObjectId !== NO_OBJECT) diagnostic("IGS_UNSUPPORTED_ANIMATION", `Button ${button.id} ${name} visual has no initial object; state omitted`, scene, diagnostics, page.id, button.id, { startObjectId: visual.startObjectId, endObjectId: visual.endObjectId });
          return undefined;
        }

        const asset = resolveAsset(scene, page.paletteId, visual.startObjectId, assets);
        if (!asset) {
          const object = options.allowMissingAssets ? resolveObject(scene, visual.startObjectId) : undefined;
          const palette = options.allowMissingAssets ? resolvePalette(scene, page.paletteId) : undefined;
          if (!object || !palette) {
            diagnostic("IGS_UNRESOLVED_VISUAL_ASSET", `Button ${button.id} ${name} visual references object ${visual.startObjectId} without a matching rendered asset`, scene, diagnostics, page.id, button.id);
            return undefined;
          }
          return {
            bounds: { x: button.x, y: button.y, width: object.width, height: object.height },
            startObjectId: visual.startObjectId,
            endObjectId: visual.endObjectId,
            ...("repeat" in visual ? { repeat: visual.repeat } : {}),
            ...(name === "selected" ? { soundId: button.visuals.selected.soundId } : name === "activated" ? { soundId: button.visuals.activated.soundId } : {}),
          };
        }

        if (visual.endObjectId !== visual.startObjectId || ("repeat" in visual && visual.repeat)) {
          diagnostic("IGS_UNSUPPORTED_ANIMATION", `Button ${button.id} ${name} animation is represented by its declared starting frame only`, scene, diagnostics, page.id, button.id, { startObjectId: visual.startObjectId, endObjectId: visual.endObjectId, repeat: "repeat" in visual ? visual.repeat : false });
        }
        return {
          bounds: { x: button.x, y: button.y, width: asset.width, height: asset.height },
          assetId: asset.id,
          startObjectId: visual.startObjectId,
          endObjectId: visual.endObjectId,
          ...("repeat" in visual ? { repeat: visual.repeat } : {}),
          ...(name === "selected" ? { soundId: button.visuals.selected.soundId } : name === "activated" ? { soundId: button.visuals.activated.soundId } : {}),
        };
      };

      const normal = state("normal"); const selected = state("selected"); const activated = state("activated");
      const states: SerializedMenuButton["states"] = {
        ...(normal ? { normal } : {}), ...(selected ? { selected } : {}), ...(activated ? { activated } : {}),
      };
      const hasSafeHitBounds = !!(states.selected ?? states.normal);
      if (membership.length === 0) diagnostic("IGS_BUTTON_WITHOUT_BOG", `Button ${button.id} does not belong to a declared BOG and is disabled`, scene, diagnostics, page.id, button.id);
      if (membership.length > 1) diagnostic("IGS_BUTTON_MULTIPLE_BOGS", `Button ${button.id} belongs to multiple BOGs and is disabled`, scene, diagnostics, page.id, button.id);
      if (!hasSafeHitBounds) diagnostic("IGS_BUTTON_WITHOUT_HIT_GEOMETRY", `Button ${button.id} has no rendered normal or selected visual for safe hit geometry and is disabled`, scene, diagnostics, page.id, button.id);
      return {
        id: button.id,
        ...(membership.length === 1 ? { bog: membership[0]! } : {}),
        // A no-visual auto-action button cannot be pointer-hit, but it still
        // needs to execute when selected as the page default or by the VM.
        enabled: membership.length === 1 && (hasSafeHitBounds || button.autoAction),
        autoAction: button.autoAction,
        neighbors: { ...button.neighbors },
        states,
        commands: button.commands.map((command) => ({ bytes: toHex(command.bytes), sourceOffset: command.sourceOffset })),
      };
    });

    page.bogs.forEach((bog, bogIndex) => {
      if (!page.buttons.some((button) => button.id === bog.defaultButtonId && (bogByButton.get(button.id) ?? []).includes(bogIndex))) {
        diagnostic("IGS_INVALID_BOG_DEFAULT", `BOG default button ${bog.defaultButtonId} is not a member of that BOG`, scene, diagnostics, page.id);
      }
    });

    return {
      id: page.id,
      uoMask: page.uoMask.toString(10),
      defaultButtonId: page.defaultSelectedButtonId,
      animationFrameRateCode: page.animationFrameRateCode,
      rawEffects: {
        enterBytesHex: toHex(page.rawEffects.enter),
        exitBytesHex: toHex(page.rawEffects.exit),
        enterEffectCount: page.rawEffects.enterEffectCount,
        exitEffectCount: page.rawEffects.exitEffectCount,
      },
      defaultActivatedButtonId: page.defaultActivatedButtonId,
      bogDefaults,
      buttons,
    };
  });

  for (const page of scene.pages) {
    if (page.rawEffects.enterEffectCount || page.rawEffects.exitEffectCount) {
      diagnostic("IGS_UNSUPPORTED_EFFECT", `Page ${page.id} has unsupported enter/exit effects (${page.rawEffects.enterEffectCount}/${page.rawEffects.exitEffectCount})`, scene, diagnostics, page.id, undefined, { enterEffectCount: page.rawEffects.enterEffectCount, exitEffectCount: page.rawEffects.exitEffectCount });
    }
  }

  return {
    scene: {
      width: scene.width,
      height: scene.height,
      compositionTimeout90k: scene.compositionTimeout90k,
      selectionTimeout90k: scene.selectionTimeout90k,
      pages,
    },
    status: scene.complete && diagnostics.length === 0 ? "complete" : "partial",
    diagnostics,
  };
}

function resolveAsset(scene: IgsScene, paletteId: number, objectId: number, assets: readonly IgsAsset[]): IgsAsset | undefined {
  const object = resolveObject(scene, objectId);
  const palette = resolvePalette(scene, paletteId);
  if (!object || !palette) return undefined;
  return assets.find((asset) => asset.objectId === objectId && asset.objectVersion === object.version && asset.paletteId === paletteId && asset.paletteVersion === palette.version && sameSource(asset.source, object.source));
}

function resolveObject(scene: IgsScene, objectId: number): IgsScene["objects"][number] | undefined {
  return [...scene.objects].reverse().find((item) => item.id === objectId);
}

function resolvePalette(scene: IgsScene, paletteId: number): IgsScene["palettes"][number] | undefined {
  return [...scene.palettes].reverse().find((item) => item.id === paletteId);
}

function sameSource(a: IgsSource, b: IgsSource): boolean {
  return a.clipId === b.clipId && a.pid === b.pid && a.packetOffset === b.packetOffset && a.pesOffset === b.pesOffset && a.segmentOffset === b.segmentOffset && a.segmentFileOffset === b.segmentFileOffset && a.pts90k === b.pts90k && a.timeDomain === b.timeDomain;
}

function toHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function diagnostic(code: string, message: string, scene: IgsScene, output: IgsAdapterDiagnostic[], pageId?: number, buttonId?: number, details?: Record<string, number | string | boolean | null>): void {
  output.push({ severity: code.startsWith("IGS_UNRESOLVED") || code.startsWith("IGS_INVALID") ? "error" : "warning", code, message, sceneId: scene.id, ...(pageId === undefined ? {} : { pageId }), ...(buttonId === undefined ? {} : { buttonId }), source: scene.source, ...(details ? { details } : {}) });
}
