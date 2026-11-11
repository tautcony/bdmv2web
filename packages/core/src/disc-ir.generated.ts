export type NavigationDescriptor =
  | {
      type: "HDMV";
      movieObjectId: number;
    }
  | {
      type: "BDJ";
      bdjoId: string;
      status: "unsupported" | "local-jvm";
    };
export type Time90K = string;

export interface DiscIR {
  schemaVersion: "1.0";
  entries: DiscEntry[];
  programs: Program[];
  menus: Menu[];
  playlists: Playlist[];
  mediaAssets: AssetReference[];
  diagnostics: Diagnostic[];
  bdjos?: BdjoInfo[];
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
export interface BdjoInfo {
  path: string;
  version: string;
  terminalInfo: {
    defaultFont: string;
    initialHaviConfigId: number;
    menuCallMask: boolean;
    titleSearchMask: boolean;
    source: SourceRef;
  };
  appCache: {
    type: number;
    reference: string;
    language: string;
    source: SourceRef;
  }[];
  accessiblePlaylists: {
    accessToAll: boolean;
    autostartFirst: boolean;
    playlistIds: string[];
    source: SourceRef;
  };
  applications: BdjoApplication[];
  keyInterest: {
    play: boolean;
    stop: boolean;
    fastForward: boolean;
    rewind: boolean;
    nextTrack: boolean;
    previousTrack: boolean;
    pause: boolean;
    stillOff: boolean;
    secondaryAudioToggle: boolean;
    secondaryVideoToggle: boolean;
    textSubtitleToggle: boolean;
    source: SourceRef;
  };
  fileAccessPaths: {
    path: string;
    source: SourceRef;
  }[];
  source: SourceRef;
}
export interface BdjoApplication {
  organizationId: number;
  applicationId: number;
  controlCode: number;
  type: number;
  profiles: {
    number: number;
    major: number;
    minor: number;
    micro: number;
  }[];
  priority: number;
  binding: number;
  visibility: number;
  names: {
    language: string;
    name: string;
  }[];
  iconLocator: string;
  iconFlags: number;
  basePath: string;
  classPath: string;
  initialClass: string;
  parameters: string[];
  source: SourceRef;
}
