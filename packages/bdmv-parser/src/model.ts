export interface SourceLocation { path: string; origin: "primary" | "backup"; offset: string; }
export interface ParseDiagnostic {
  severity: "info" | "warning" | "error" | "fatal";
  code: string;
  message: string;
  sourcePath: string | null;
  offset: string | null;
  entityId: string | null;
  action: string | null;
  recoverable: boolean;
  stage: "structural";
  affectedEntryIds: string[];
}
export interface EntryTarget { objectType: "HDMV" | "BDJ" | "unknown"; playbackType: number; target: number | string | null; accessType?: number; source: SourceLocation; }
export interface MovieInstruction { words: [number, number, number]; bytes: string; source: SourceLocation; }
export interface MovieObject { id: number; resumeIntention: boolean; menuCallMask: boolean; titleSearchMask: boolean; instructions: MovieInstruction[]; source: SourceLocation; }
export interface StreamDeclaration { streamType: number; pid: number | null; subPathId: number | null; subClipId: number | null; codingType: number | null; language: string | null; dynamicRangeType: number | null; colorSpace: number | null; source: SourceLocation; }
/** INDX AppInfoBDMV. Field layout follows the pinned libbluray `_parse_app_info`. */
export interface DiscAppInfo {
  initialOutputModePreference: boolean; contentExistFlag: boolean; initialDynamicRangeType: number;
  videoFormat: number; frameRate: number; userDataBytes: number; source: SourceLocation;
}
/** INDX extension 3.1 (UHD metadata), as parsed by libbluray `_parse_indx_extension_hevc`. */
export interface UhdMetadata { discType: number; exists4k: boolean; hdrFlags: number; hdr10Plus: boolean; dolbyVision: boolean; source: SourceLocation; }
/** MPLS AppInfoPlayList. `playbackCount` is only meaningful for playback types 2 and 3. */
export interface PlaylistAppInfo {
  playbackType: number; playbackCount: number | null; uoMask: string;
  randomAccessFlag: boolean; audioMixFlag: boolean; losslessBypassFlag: boolean; mvcBaseViewRFlag: boolean; sdrConversionNotificationFlag: boolean;
  source: SourceLocation;
}
export interface PlayItem {
  index: number; clipId: string; codecId: string; stcId: number; inTime45k: number; outTime45k: number;
  connectionCondition: number; multiAngle: boolean; angleCount: number; differentAudio: boolean; seamlessAngle: boolean;
  uoMask: string; stillMode: number; stillTime: number; streams: StreamDeclaration[]; source: SourceLocation;
}
export interface PlayMark { index: number; type: number; playItemRef: number; time45k: number; entryEsPid: number; duration45k: number; source: SourceLocation; }
export interface SubPlayItemClip { clipId: string; codecId: string; stcId: number; }
export interface SubPlayItem { clipId: string; codecId: string; connectionCondition: number; stcId: number; multiClip: boolean; clips: SubPlayItemClip[]; inTime45k: number; outTime45k: number; syncPlayItemId: number; syncPts45k: number; source: SourceLocation; }
export interface SubPath { type: number; repeat: boolean; items: SubPlayItem[]; source: SourceLocation; }
export interface Playlist { id: string; version: string; appInfo: PlaylistAppInfo | null; playItems: PlayItem[]; marks: PlayMark[]; subPaths: SubPath[]; source: SourceLocation; }
export interface ClipProgram { sequenceStartSpn: number; programMapPid: number; streams: Array<{ pid: number; codingType: number; language: string | null; dynamicRangeType: number | null; colorSpace: number | null; source: SourceLocation }>; source: SourceLocation; }
export interface CpiEntry { pid: number; epStreamType: number; pts45k: number; spn: number; angleChange: boolean; source: SourceLocation; }
/** CLPI ClipInfo header fields; the 128 reserved bytes and font table are not retained. */
export interface ClipHeader { streamType: number; applicationType: number; tsRecordingRate: number; sourcePacketCount: number; atcDelta: boolean; tsTypeId: string | null; source: SourceLocation; }
/** CLPI STC presentation times are 32-bit 45 kHz Clip timestamps (as used by libbluray clpi_lookup_spn). */
export interface StcSequence { pcrPid: number; spnStcStart: number; presentationStartPts: number; presentationEndPts: number; }
export interface AtcSequence { spnAtcStart: number; offsetStcId: number; stcs: StcSequence[]; source: SourceLocation; }
export interface ClipInfo { id: string; version: string; header: ClipHeader | null; sequence: AtcSequence[]; programs: ClipProgram[]; cpi: CpiEntry[]; source: SourceLocation; }
export interface SoundEntry { index: number; channelCode: number; sampleRateCode: number; bitsPerSampleCode: number; channels: number | null; sampleRate: number | null; bitsPerSample: number | null; sampleOffset: number; sampleByteLength: number; source: SourceLocation; }
export interface GraphNode { id: string; type: "entry" | "title" | "movieObject" | "playlist" | "playItem" | "subPath" | "clip" | "clipInfo" | "stream" | "sound" | "bdjo"; state: "present" | "missing"; source: SourceLocation | null; }
export interface GraphEdge { from: string; to: string; kind: string; resolution: "resolved" | "missing" | "unresolved"; source: SourceLocation; }
export interface ParsedDisc {
  schemaVersion: "1.0";
  analysisStage: "structural";
  root: string;
  /** Disc-level declarations from index.bdmv; null when the corresponding section is absent. */
  discInfo: { appInfo: DiscAppInfo | null; uhd: UhdMetadata | null };
  entries: { id: string; kind: "firstPlay" | "topMenu" | "title"; target: EntryTarget; source: SourceLocation }[];
  movieObjects: MovieObject[];
  playlists: Playlist[];
  clips: ClipInfo[];
  sounds: SoundEntry[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  declarations: { entries: number; movieObjects: number; playlists: number; playItems: number; clips: number; streams: number; sounds: number; unknown: number };
  diagnostics: ParseDiagnostic[];
  supportPrediction: { status: "partial"; supported: string[]; unsupported: string[]; unverified: string[] };
}
