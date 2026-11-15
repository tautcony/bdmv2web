/**
 * Runtime data contract shared by the package generator and the browser runtime.
 *
 * These are the JSON-safe shapes written into `runtime/disc-data.js`. Callers
 * supply the HDMV VM program, media and external-target types through the type
 * parameters; `core` defines the shared data shapes.
 */
import type { DiscIR } from "./disc-ir.generated.js";
import type { PlayerProfile } from "./index.js";
import type { Limits } from "./limits.js";

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

/** Serialized IGS composition source, matching the fields written to disc-data. */
export interface SerializedSceneSource {
  clipId: string;
  pid: number;
  packetOffset: string;
  pesOffset: string;
  segmentOffset: string;
  segmentFileOffset: string;
  pts90k: string | null;
  timeDomain: number;
  path?: string | null;
  origin?: "primary" | "backup" | null;
  stage?: "transport";
}

/** JSON-safe shape accepted by the browser bootloader. */
export interface SerializedScene {
  id?: string;
  clipId?: string;
  pid?: number;
  streamModel?: number;
  uiModel?: number;
  source?: SerializedSceneSource;
  width: number;
  height: number;
  frameRateCode?: number;
  compositionTimeout90k: string | null;
  selectionTimeout90k: string | null;
  pages: SerializedMenuPage[];
}

/** One PlayItem's pointer at a composition stored once in `scenes`. */
export interface RuntimeMenuSceneEntry {
  playlistId: number;
  playItem?: number;
  igStreamNumber?: number;
  igStreamCount?: number;
  sceneId: string;
}

export interface RuntimeMenuPlaylistMark {
  playlistId: number;
  marks: Array<{ index: number; playItemRef: number }>;
}

/** BD-J application file mapped into the package virtual filesystem. */
export interface RuntimeBdjFile {
  path: string;
  packagePath: string;
}

export type RuntimeEscapeMapping = "popup" | "topMenu" | "custom" | "none";

export interface RuntimeInputConfig {
  escapeMapping?: RuntimeEscapeMapping;
}

/**
 * `runtime/disc-data.js` payload. `ir` and `scene` are always present; every
 * other field is present when the package has the data.
 */
export interface RuntimeDataV1<TVmProgram, TVmEntry, TExternalTargets, TMedia, TPgsTrack> {
  ir: DiscIR;
  title?: string;
  scene: SerializedScene | null;
  popupScenes?: SerializedScene[];
  scenes?: Record<string, SerializedScene>;
  menuScenes?: RuntimeMenuSceneEntry[];
  menuPlaylistIds?: number[];
  menuPlaylistMarks?: RuntimeMenuPlaylistMark[];
  preMenuPlaylistIds?: number[];
  vmPrograms?: TVmProgram[];
  vmEntries?: TVmEntry[];
  profile?: PlayerProfile;
  limits?: Limits;
  externalTargets?: TExternalTargets;
  vmInitialProgramId?: number;
  vmFirstPlayProgramId?: number;
  sounds?: Record<number, string>;
  media?: TMedia;
  menuMedia?: TMedia[];
  inputConfig?: RuntimeInputConfig;
  bdjRuntime?: boolean;
  bdjFiles?: RuntimeBdjFile[];
  bdjHostApiPath?: string;
  pgsTracks?: TPgsTrack[];
}
