import type { Limits } from "@bdmv2web/core";

export interface IgsSource {
  clipId: string;
  pid: number;
  packetOffset: string;
  pesOffset: string;
  segmentOffset: string;
  segmentFileOffset: string;
  pts90k: string | null;
  timeDomain: number;
}

export interface IgsDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  source: IgsSource | null;
  affectedSceneIds: string[];
  details?: Record<string, number | string | boolean | null>;
}

export interface TsPacket {
  packetOffset: bigint;
  payloadOffset: number;
  pid: number;
  payloadUnitStart: boolean;
  continuityCounter: number;
  hasPayload: boolean;
  discontinuity: boolean;
  transportError: boolean;
  continuityError: boolean;
  payload: Uint8Array;
}

export interface PtsValue {
  raw: bigint;
  epoch: bigint;
  normalized: bigint;
  timeDomain: number;
}

export interface IgsObject {
  id: number;
  version: number;
  width: number;
  height: number;
  indices: Uint8Array;
  source: IgsSource;
}

export interface IgsPaletteEntry { y: number; cr: number; cb: number; alpha: number; }
export interface IgsPalette {
  id: number;
  version: number;
  entries: Map<number, IgsPaletteEntry>;
  source: IgsSource;
}

export interface IgsButton {
  id: number;
  numericSelectValue: number;
  scopeId?: string;
  x: number;
  y: number;
  autoAction: boolean;
  neighbors: { up: number; down: number; left: number; right: number };
  visuals: {
    normal: { startObjectId: number; endObjectId: number; repeat: boolean };
    selected: { startObjectId: number; endObjectId: number; repeat: boolean; soundId: number };
    activated: { startObjectId: number; endObjectId: number; soundId: number };
  };
  commands: Array<{ bytes: Uint8Array; recordIndex: number; sourceOffset: string }>;
}

export interface IgsPage {
  id: number;
  scopeId?: string;
  version: number;
  uoMask: bigint;
  defaultSelectedButtonId: number;
  defaultActivatedButtonId: number;
  paletteId: number;
  buttons: IgsButton[];
  bogs: Array<{ defaultButtonId: number; buttonIds: number[] }>;
  animationFrameRateCode: number;
  rawEffects: { enter: Uint8Array; exit: Uint8Array; enterEffectCount: number; exitEffectCount: number };
}

export interface IgsScene {
  id: string;
  clipId: string;
  pid: number;
  compositionNumber: number;
  compositionState: number;
  width: number;
  height: number;
  frameRateCode: number;
  timeDomain: number;
  pts90k: string | null;
  streamModel: number;
  uiModel: number;
  compositionTimeout90k: string | null;
  selectionTimeout90k: string | null;
  userTimeoutDuration: number;
  rawIcs: Uint8Array;
  pages: IgsPage[];
  objects: IgsObject[];
  palettes: IgsPalette[];
  complete: boolean;
  source: IgsSource;
}

export interface IgsExtraction {
  scenes: IgsScene[];
  assets: IgsAsset[];
  /** igstools-compatible MNU bytes recovered from each declared IG PID. */
  streams: Array<{ clipId: string; pid: number; byteLength: number; bytes?: Uint8Array }>;
  diagnostics: IgsDiagnostic[];
  status: "complete" | "partial" | "failed";
  support: { format: "Blu-ray IGS"; status: "unverified" };
}

export interface IgsAsset {
  id: string;
  relativePath: string;
  mimeType: "image/png";
  width: number;
  height: number;
  pngBytes: Uint8Array;
  objectId: number;
  objectVersion: number;
  paletteId: number;
  paletteVersion: number;
  source: IgsSource;
  colorConversion: "bt709-limited-round-nearest";
}

export interface IgsOptions {
  limits?: Limits;
  chunkSize?: number;
  /** Skip PNG asset generation so callers can parse/navigation-process scenes separately. Defaults to true. */
  renderAssets?: boolean;
  /** Retain igstools-compatible MNU bytes for explicit asset export. Defaults to false. */
  captureStreams?: boolean;
}
