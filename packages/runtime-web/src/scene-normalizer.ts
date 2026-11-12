import { isRecord } from "@bdmv2web/utils";
import type { MenuButton, MenuPage, MenuScene } from "./menu/menu-runtime.js";
import type { SerializedMenuState, SerializedScene } from "./igs-adapter.js";

export function validateEmbeddedDiscIR(value: unknown): void {
  if (!isRecord(value)) throw new Error("Embedded DiscIR must be a JSON object.");
  if (value.schemaVersion !== "1.0") throw new Error(`Unsupported DiscIR schema version '${typeof value.schemaVersion === "string" ? value.schemaVersion : "missing"}'. Expected 1.0.`);
  for (const key of ["entries", "programs", "menus", "playlists", "mediaAssets", "diagnostics"]) if (!Array.isArray(value[key])) throw new Error(`Embedded DiscIR is invalid: '${key}' must be an array.`);
}

export function normalizeScene(source: SerializedScene, assets: Map<string, HTMLImageElement>): MenuScene {
  if (!source || !Number.isSafeInteger(source.width) || source.width <= 0 || !Number.isSafeInteger(source.height) || source.height <= 0 || !Array.isArray(source.pages) || source.pages.length === 0) throw new Error("Invalid menu scene dimensions or pages.");
  return {
    width: source.width,
    height: source.height,
    ...(source.frameRateCode !== undefined ? { frameRateCode: source.frameRateCode } : {}),
    compositionTimeout90k: source.compositionTimeout90k,
    selectionTimeout90k: source.selectionTimeout90k,
    pages: source.pages.map((page) => ({
    id: page.id, uoMask: page.uoMask, defaultButtonId: page.defaultButtonId,
    ...(page.defaultActivatedButtonId !== undefined ? { defaultActivatedButtonId: page.defaultActivatedButtonId } : {}),
    ...(page.bogDefaults ? { bogDefaults: page.bogDefaults } : {}),
    animationFrameRateCode: page.animationFrameRateCode,
    ...(page.objects ? { objects: new Map(page.objects.flatMap((object) => {
      const image = assets.get(object.assetId);
      return image ? [[object.id, { image, width: object.width, height: object.height }] as const] : [];
    })) } : {}),
    ...(page.effects ? { effects: {
      enter: normalizeEffects(page.effects.enter, assets),
      exit: normalizeEffects(page.effects.exit, assets),
    } } : {}),
    ...(page.allowedActions ? { allowedActions: page.allowedActions } : {}),
    buttons: page.buttons.map((button) => ({
      id: button.id, bog: button.bog ?? 0, enabled: button.enabled ?? true, ...(button.autoAction !== undefined ? { autoAction: button.autoAction } : {}), neighbors: button.neighbors,
      states: {
        ...(button.states.normal ? { normal: normalizeState(button.states.normal, assets) } : {}),
        ...(button.states.selected ? { selected: normalizeState(button.states.selected, assets) } : {}),
        ...(button.states.activated ? { activated: normalizeState(button.states.activated, assets) } : {}),
      }, commands: button.commands ?? [],
    })),
  })) };
}

export function menuSceneKey(scene: SerializedScene): string { return `${scene.clipId ?? scene.id ?? ""}:${scene.pid ?? ""}`; }

function normalizeEffects(effects: NonNullable<SerializedScene["pages"][number]["effects"]>["enter"], assets: Map<string, HTMLImageElement>): NonNullable<MenuPage["effects"]>["enter"] {
  return effects.map((effect) => ({
    duration90k: effect.duration90k,
    objects: effect.objects.flatMap((object) => {
      const image = assets.get(object.assetId);
      return image ? [{ ...object, image }] : [];
    }),
  }));
}

function normalizeState(state: SerializedMenuState, assets: Map<string, HTMLImageElement>): NonNullable<MenuButton["states"]["normal"]> {
  const { x, y, width, height } = state.bounds;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error("Invalid button state bounds.");
  const image = state.assetId === undefined ? undefined : assets.get(state.assetId);
  if (state.assetId !== undefined && !image) throw new Error(`Button state references missing image '${state.assetId}'.`);
  return {
    bounds: { x, y, width, height },
    ...(image ? { image } : {}),
    ...(state.soundId !== undefined ? { soundId: state.soundId } : {}),
    startObjectId: state.startObjectId,
    endObjectId: state.endObjectId,
    ...(state.repeat !== undefined ? { repeat: state.repeat } : {}),
  };
}
