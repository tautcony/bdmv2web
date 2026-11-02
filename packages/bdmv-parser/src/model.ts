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
export interface StreamDeclaration { streamType: number; pid: number | null; subPathId: number | null; subClipId: number | null; codingType: number | null; language: string | null; source: SourceLocation; }
export interface PlayItem {
  index: number; clipId: string; codecId: string; stcId: number; inTime45k: number; outTime45k: number;
  connectionCondition: number; multiAngle: boolean; angleCount: number; differentAudio: boolean; seamlessAngle: boolean;
  uoMask: string; stillMode: number; stillTime: number; streams: StreamDeclaration[]; source: SourceLocation;
}
export interface PlayMark { index: number; type: number; playItemRef: number; time45k: number; entryEsPid: number; duration45k: number; source: SourceLocation; }
export interface SubPlayItem { clipId: string; codecId: string; stcId: number; inTime45k: number; outTime45k: number; syncPlayItemId: number; syncPts45k: number; source: SourceLocation; }
export interface SubPath { type: number; repeat: boolean; items: SubPlayItem[]; source: SourceLocation; }
export interface Playlist { id: string; version: string; playItems: PlayItem[]; marks: PlayMark[]; subPaths: SubPath[]; source: SourceLocation; }
export interface ClipProgram { sequenceStartSpn: number; programMapPid: number; streams: Array<{ pid: number; codingType: number; language: string | null; source: SourceLocation }>; source: SourceLocation; }
export interface CpiEntry { pid: number; epStreamType: number; pts45k: number; spn: number; angleChange: boolean; source: SourceLocation; }
export interface ClipInfo { id: string; version: string; programs: ClipProgram[]; cpi: CpiEntry[]; source: SourceLocation; }
export interface SoundEntry { index: number; channelCode: number; sampleRateCode: number; bitsPerSampleCode: number; channels: number | null; sampleRate: number | null; bitsPerSample: number | null; sampleOffset: number; sampleByteLength: number; source: SourceLocation; }
export interface GraphNode { id: string; type: "entry" | "title" | "movieObject" | "playlist" | "playItem" | "subPath" | "clip" | "clipInfo" | "stream" | "sound" | "bdjo"; state: "present" | "missing"; source: SourceLocation | null; }
export interface GraphEdge { from: string; to: string; kind: string; resolution: "resolved" | "missing" | "unresolved"; source: SourceLocation; }
export interface ParsedDisc {
  schemaVersion: "1.0";
  analysisStage: "structural";
  root: string;
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
