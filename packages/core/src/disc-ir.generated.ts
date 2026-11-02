export type NavigationDescriptor =
  | {
      type: "HDMV";
      movieObjectId: number;
    }
  | {
      type: "BDJ";
      bdjoId: string;
      status: "unsupported";
    };
export type Time90K = string;
export type Sha256 = string;

export interface DiscIR {
  schemaVersion: "1.0";
  entries: DiscEntry[];
  programs: Program[];
  menus: Menu[];
  playlists: Playlist[];
  mediaAssets: AssetReference[];
  diagnostics: Diagnostic[];
}
export interface DiscEntry {
  id: string;
  navigation: NavigationDescriptor;
  source: SourceRef;
}
export interface SourceRef {
  path: string;
  origin: "primary" | "backup";
  byteOffset: Time90K;
  entityId?: string | null;
  packetOffset?: string | null;
  pid?: number | null;
  instructionIndex?: number | null;
}
export interface Program {
  id: string;
  title: string;
}
export interface Menu {
  id: string;
}
export interface Playlist {
  id: string;
  programIds: string[];
  menuIds: string[];
  duration90k?: Time90K;
}
export interface AssetReference {
  id: string;
  kind: string;
  relativePath: string;
  mime: string;
  byteLength: string;
  sha256: Sha256;
  sources: SourceRef[];
}
export interface Diagnostic {
  severity: "debug" | "info" | "warning" | "error" | "fatal";
  code: string;
  message: string;
  sourcePath: string | null;
  offset: string | null;
  entityId: string | null;
  action: string | null;
  recoverable: boolean;
  stage: string;
  affectedEntryIds: string[];
}
