export interface SourceLocation { path: string; origin: "primary" | "backup"; offset: string; instructionIndex?: number; }
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
export interface StreamDeclaration { streamType: number; pid: number | null; subPathId: number | null; subClipId: number | null; codingType: number | null; language: string | null; dynamicRangeType: number | null; colorSpace: number | null; category?: MplsStreamCategory; categoryIndex?: number; videoAttributes?: MplsVideoAttributes; primaryAudioReferences?: number[]; secondaryAudioReferences?: number[]; presentationGraphicsReferences?: number[]; source: SourceLocation; }
export type MplsStreamCategory = "primaryVideo" | "primaryAudio" | "primaryPresentationGraphics" | "primaryInteractiveGraphics" | "secondaryAudio" | "secondaryVideo" | "secondaryPresentationGraphics" | "dolbyVision";
export interface MplsVideoAttributes {
  videoFormat: number; frameRate: number; aspectRatio?: number; crFlag?: boolean; ocFlag?: boolean; hdrPlus?: boolean;
  dynamicRangeType: number | null; colorSpace: number | null;
}
export interface AlternativeAngle { index: number; clipId: string; codecId: string; stcId: number; source: SourceLocation; }
export interface ExtensionDataEntry {
  id1: number; id2: number; version: string; offset: string; length: number;
  kind: string | null; parsed: boolean; data: Record<string, unknown> | null; source: SourceLocation;
}
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
  angles?: AlternativeAngle[];
}
export interface PlayMark { index: number; type: number; playItemRef: number; time45k: number; entryEsPid: number; duration45k: number; source: SourceLocation; }
export interface SubPlayItemClip { clipId: string; codecId: string; stcId: number; }
export interface SubPlayItem { clipId: string; codecId: string; connectionCondition: number; stcId: number; multiClip: boolean; clips: SubPlayItemClip[]; inTime45k: number; outTime45k: number; syncPlayItemId: number; syncPts45k: number; source: SourceLocation; }
export interface SubPath { type: number; repeat: boolean; items: SubPlayItem[]; source: SourceLocation; }
export interface Playlist { id: string; version: string; appInfo: PlaylistAppInfo | null; playItems: PlayItem[]; marks: PlayMark[]; subPaths: SubPath[]; source: SourceLocation; extensionData?: ExtensionDataEntry[]; }
export interface ClipStreamDeclaration { pid: number; codingType: number; language: string | null; dynamicRangeType: number | null; colorSpace: number | null; videoAttributes?: MplsVideoAttributes; charCode?: number; isrc?: string; source: SourceLocation; }
export interface ClipProgram { sequenceStartSpn: number; programMapPid: number; groupCount?: number; streams: ClipStreamDeclaration[]; source: SourceLocation; }
export interface CpiEntry { pid: number; epStreamType: number; pts45k: number; spn: number; angleChange: boolean; source: SourceLocation; }
export interface CpiFineEntry { angleChange: boolean; endPositionOffset: number; pts: number; spnOffset: number; source: SourceLocation; }
export interface CpiCoarseEntry { refFine: number; pts: number; spn: number; source: SourceLocation; }
export interface CpiMapEntry { pid: number; epStreamType: number; fine: CpiFineEntry[]; coarse: CpiCoarseEntry[]; source: SourceLocation; }
export interface ClipMark { index: number; markType: number; spn: number; pts90k: number; duration45k: number; source: SourceLocation; }
/** CLPI ClipInfo header fields; the 128 reserved bytes and font table are not retained. */
export interface ClipHeader { streamType: number; applicationType: number; tsRecordingRate: number; sourcePacketCount: number; atcDelta: boolean; tsTypeId: string | null; tsTypeValidity?: number | null; atcDeltaEntries?: Array<{ delta: number; fileId: string; fileCode: string; source: SourceLocation }>; fontFiles?: string[]; source: SourceLocation; }
/** CLPI STC presentation times are 32-bit 45 kHz Clip timestamps (as used by libbluray clpi_lookup_spn). */
export interface StcSequence { pcrPid: number; spnStcStart: number; presentationStartPts: number; presentationEndPts: number; }
export interface AtcSequence { spnAtcStart: number; offsetStcId: number; stcs: StcSequence[]; source: SourceLocation; }
export interface ClipInfo { id: string; version: string; header: ClipHeader | null; sequence: AtcSequence[]; programs: ClipProgram[]; cpi: CpiEntry[]; source: SourceLocation; clipMarks?: ClipMark[]; cpiMaps?: CpiMapEntry[]; extensionData?: ExtensionDataEntry[]; }
export interface BdjoApplication {
  organizationId: number; applicationId: number; controlCode: number; type: number;
  profiles: Array<{ number: number; major: number; minor: number; micro: number }>;
  priority: number; binding: number; visibility: number; names: Array<{ language: string; name: string }>;
  iconLocator: string; iconFlags: number; basePath: string; classPath: string; initialClass: string;
  parameters: string[]; source: SourceLocation;
}
export interface BdjoKeyInterest {
  play: boolean; stop: boolean; fastForward: boolean; rewind: boolean; nextTrack: boolean; previousTrack: boolean;
  pause: boolean; stillOff: boolean; secondaryAudioToggle: boolean; secondaryVideoToggle: boolean; textSubtitleToggle: boolean;
  source: SourceLocation;
}
export interface BdjoInfo {
  path: string; version: string;
  terminalInfo: { defaultFont: string; initialHaviConfigId: number; menuCallMask: boolean; titleSearchMask: boolean; source: SourceLocation };
  appCache: Array<{ type: number; reference: string; language: string; source: SourceLocation }>;
  accessiblePlaylists: { accessToAll: boolean; autostartFirst: boolean; playlistIds: string[]; source: SourceLocation };
  applications: BdjoApplication[];
  keyInterest: BdjoKeyInterest;
  fileAccessPaths: Array<{ path: string; source: SourceLocation }>;
  source: SourceLocation;
}
export interface MetaDlTitle { titleNumber: number; titleName: string; source: SourceLocation; }
export interface MetaDlManifest {
  language: string; discName: string | null; alternativeName: string | null; numberOfSets: number | null;
  setNumber: number | null; titles: MetaDlTitle[]; thumbnails: Array<{ href: string; size: string | null; width: number | null; height: number | null; source: SourceLocation }>;
  source: SourceLocation;
}
export interface SoundEntry { index: number; channelCode: number; sampleRateCode: number; bitsPerSampleCode: number; channels: number | null; sampleRate: number | null; bitsPerSample: number | null; sampleOffset: number; sampleByteLength: number; source: SourceLocation; }
export interface GraphNode { id: string; type: "entry" | "title" | "movieObject" | "playlist" | "playItem" | "subPath" | "clip" | "clipInfo" | "stream" | "sound" | "bdjo" | "metaDl"; state: "present" | "missing"; source: SourceLocation | null; }
export interface GraphEdge { from: string; to: string; kind: string; resolution: "resolved" | "missing" | "unresolved"; source: SourceLocation; }
export interface ParsedDisc {
  schemaVersion: "1.0";
  analysisStage: "structural";
  root: string;
  /** Disc-level declarations from index.bdmv; null when the corresponding section is absent. */
  discInfo: { appInfo: DiscAppInfo | null; uhd: UhdMetadata | null };
  entries: { id: string; kind: "firstPlay" | "topMenu" | "title"; target: EntryTarget; source: SourceLocation }[];
  movieObjects: MovieObject[];
  bdjos?: BdjoInfo[];
  metadata?: MetaDlManifest[];
  playlists: Playlist[];
  clips: ClipInfo[];
  sounds: SoundEntry[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  declarations: { entries: number; movieObjects: number; playlists: number; playItems: number; clips: number; streams: number; sounds: number; unknown: number; bdjos?: number; metadata?: number; extensionData?: number; clipMarks?: number };
  diagnostics: ParseDiagnostic[];
  supportPrediction: { status: "partial"; supported: string[]; unsupported: string[]; unverified: string[] };
}
