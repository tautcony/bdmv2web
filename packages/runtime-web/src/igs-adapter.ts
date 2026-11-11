import type { IgsAsset, IgsScene, IgsSource } from "@bdmv2web/igs";

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
  objects?: Array<{ id: number; width: number; height: number; assetId: string }>;
  effects?: {
    enter: Array<{ duration90k: number; objects: Array<{ objectId: number; x: number; y: number; width: number; height: number; assetId: string; crop?: { x: number; y: number; width: number; height: number } }> }>;
    exit: Array<{ duration90k: number; objects: Array<{ objectId: number; x: number; y: number; width: number; height: number; assetId: string; crop?: { x: number; y: number; width: number; height: number } }> }>;
  };
  defaultActivatedButtonId?: number;
  bogDefaults?: Array<{ bog: number; defaultButtonId: number }>;
  buttons: SerializedMenuButton[];
  allowedActions?: Record<string, boolean>;
}

/** JSON-safe shape accepted by the M4 browser bootloader. */
export interface SerializedScene {
  id?: string;
  clipId?: string;
  pid?: number;
  streamModel?: number;
  uiModel?: number;
  source?: IgsSource;
  width: number;
  height: number;
  frameRateCode?: number;
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

export type PopupSceneSelection =
  | { status: "not-found" }
  | { status: "ambiguous"; scenes: SerializedScene[] }
  | { status: "selected"; scene: SerializedScene };

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
      const hitTestableOrAutoAction = hasSafeHitBounds || button.autoAction;
      if (membership.length === 0) diagnostic("IGS_BUTTON_WITHOUT_BOG", `Button ${button.id} does not belong to a declared BOG and is disabled`, scene, diagnostics, page.id, button.id);
      if (membership.length > 1) diagnostic("IGS_BUTTON_MULTIPLE_BOGS", `Button ${button.id} belongs to multiple BOGs and is disabled`, scene, diagnostics, page.id, button.id);
      if (!hasSafeHitBounds) diagnostic("IGS_BUTTON_WITHOUT_HIT_GEOMETRY", `Button ${button.id} has no rendered normal or selected visual for safe hit geometry and is disabled`, scene, diagnostics, page.id, button.id);
      return {
        id: button.id,
        ...(membership.length === 1 ? { bog: membership[0]! } : {}),
        enabled: membership.length === 1 && hitTestableOrAutoAction,
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
      objects: scene.objects.flatMap((object) => {
        const asset = resolveAsset(scene, page.paletteId, object.id, assets);
        return asset ? [{ id: object.id, width: asset.width, height: asset.height, assetId: asset.id }] : [];
      }),
      effects: {
        enter: adaptEffectSequence(scene, page.effects.enter, assets, page.id, diagnostics),
        exit: adaptEffectSequence(scene, page.effects.exit, assets, page.id, diagnostics),
      },
      defaultActivatedButtonId: page.defaultActivatedButtonId,
      bogDefaults,
      buttons,
    };
  });

  return {
    scene: {
      id: scene.id,
      clipId: scene.clipId,
      pid: scene.pid,
      streamModel: scene.streamModel,
      uiModel: scene.uiModel,
      source: scene.source,
      width: scene.width,
      height: scene.height,
      frameRateCode: scene.frameRateCode,
      compositionTimeout90k: scene.compositionTimeout90k,
      selectionTimeout90k: scene.selectionTimeout90k,
      pages,
    },
    status: scene.complete && diagnostics.length === 0 ? "complete" : "partial",
    diagnostics,
  };
}

function adaptEffectSequence(scene: IgsScene, sequence: IgsScene["pages"][number]["effects"]["enter"], assets: readonly IgsAsset[], pageId: number, diagnostics: IgsAdapterDiagnostic[]): NonNullable<SerializedMenuPage["effects"]>["enter"] {
  return sequence.effects.map((effect, effectIndex) => ({
    duration90k: effect.duration90k,
    objects: effect.objects.flatMap((item) => {
      const object = resolveObject(scene, item.objectId);
      const asset = resolveAsset(scene, effect.paletteId, item.objectId, assets);
      if (!object || !asset) {
        diagnostic("IGS_UNRESOLVED_EFFECT_ASSET", `Page ${pageId} effect ${effectIndex} references object ${item.objectId} without a rendered asset for palette ${effect.paletteId}`, scene, diagnostics, pageId, undefined, { effectIndex, objectId: item.objectId, paletteId: effect.paletteId });
        return [];
      }
      return [{ objectId: item.objectId, x: item.x, y: item.y, width: asset.width, height: asset.height, assetId: asset.id, ...(item.crop ? { crop: item.crop } : {}) }];
    }),
  }));
}

/** Resolve the active title popup by its source clip/PID and composition PTS. */
export function selectPopupScene(scenes: readonly SerializedScene[], clipId: string, pid: number, time90k?: number, timeDomain?: number): PopupSceneSelection {
  const candidates = scenes.filter((scene) => scene.uiModel === 1 && scene.clipId?.toLocaleLowerCase("en-US") === clipId.toLocaleLowerCase("en-US") && scene.pid === pid);
  if (!candidates.length) return { status: "not-found" };
  if (time90k !== undefined) {
    if (!Number.isSafeInteger(time90k) || time90k < 0) throw new RangeError("Popup selection time must be a non-negative 90 kHz timestamp.");
    const active = candidates.filter((scene) => {
      const pts = scene.source?.pts90k;
      return pts !== null && pts !== undefined && (timeDomain === undefined || scene.source?.timeDomain === timeDomain) && BigInt(pts) <= BigInt(time90k);
    });
    if (!active.length) return { status: "not-found" };
    const latestPts = active.reduce((latest, scene) => { const pts = BigInt(scene.source!.pts90k!); return pts > latest ? pts : latest; }, 0n);
    const latest = active.filter((scene) => BigInt(scene.source!.pts90k!) === latestPts);
    return latest.length === 1 ? { status: "selected", scene: latest[0]! } : { status: "ambiguous", scenes: latest };
  }
  return candidates.length === 1 ? { status: "selected", scene: candidates[0]! } : { status: "ambiguous", scenes: [...candidates] };
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
