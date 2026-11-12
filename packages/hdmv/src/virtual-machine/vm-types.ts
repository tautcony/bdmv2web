import type { MovieInstruction, ParsedDisc, SourceLocation } from "@bdmv2web/bdmv-parser";
import type { Limits } from "@bdmv2web/core/limits";
import type { RegisterFile, PlayerProfile } from "./registers.js";
import type { RawCommand } from "../bytecode/decode.js";

export type VmStatus = "idle" | "running" | "suspended" | "stopped" | "faulted";
export type ActionType = "PLAY_PLAYLIST" | "PLAY_PLAYLIST_ITEM" | "PLAY_PLAYLIST_MARK" | "LINK_PLAY_ITEM" | "LINK_PLAY_MARK" | "PLAY_STOP" | "SET_STREAM" | "SET_SECONDARY_STREAM" | "SET_BUTTON_PAGE" | "ENABLE_BUTTON" | "DISABLE_BUTTON" | "POPUP_OFF" | "STILL_ON" | "STILL_OFF" | "SET_NV_TIMER" | "SET_OUTPUT_MODE" | "SET_STREAM_SS" | "TOP_MENU" | "TITLE_SEARCH" | "MENU_CALL" | "MENU_RETURN";
export type WaitFor = "started" | "seeked" | "ended" | "still-completed";
export interface NavigationAction { id: string; type: ActionType; generation: number; payload: Record<string, number | string | boolean | null>; source: SourceLocation; waitFor?: WaitFor; }
export type MediaEventType = "MEDIA_STARTED" | "MEDIA_SEEKED" | "PLAYITEM_CHANGED" | "TIME_UPDATED" | "MEDIA_ENDED" | "MEDIA_ERROR" | "MEDIA_UNAVAILABLE" | "STILL_COMPLETED" | "MENU_INPUT" | "TOP_MENU" | "POPUP_MENU" | "RETURN";
export interface VmEvent { type: MediaEventType; generation?: number; responseTo?: string; payload?: Record<string, unknown>; input?: string | number; channel?: "keyboard" | "pointer" | "system"; }
export interface VmDiagnostic { code: string; message: string; source: SourceLocation | null; }
export interface PlaybackContext { status: "idle" | "requested" | "playing" | "ended" | "error" | "unavailable"; playlist: number | null; playItem: number | null; presentationTime: number | null; pendingActionId: string | null; }
export interface TraceEntry { sequence: number; generation: number; programId: number; pc: number; source: SourceLocation | null; raw: string | null; decoded: string | null; input?: VmEvent; action?: NavigationAction; event?: VmEvent; registerDelta: { gpr: Record<number, number>; psr: Record<number, number> }; callDepth: number; callStack: Array<{ programId: number; pc: number }>; playback: PlaybackContext; limits: Readonly<Limits>; status: VmStatus; diagnostic?: VmDiagnostic; }
export interface VmSnapshot { status: VmStatus; programId: number; pc: number; registers: ReturnType<RegisterFile["snapshot"]>; callStack: Array<{ programId: number; pc: number }>; playback: PlaybackContext; generation: number; waiting: NavigationAction | null; instructionsThisTurn: number; diagnostic: VmDiagnostic | null; }
export interface HdmvVmCheckpoint {
  status: VmStatus; programId: number; pc: number; registers: ReturnType<RegisterFile["snapshot"]>;
  callStack: Array<{ programId: number; pc: number }>; continuation: Continuation | null;
  suspendedPlaylistContinuation: Continuation | null; suspendedPlaylistPlayback: PlaybackContext | null;
  pendingTitleCall: number | null; titleTransition: boolean; menuCheckpoint: MenuCheckpoint | null; playback: PlaybackContext;
  generation: number; instructionsThisTurn: number; diagnostic: VmDiagnostic | null; sequence: number;
  profile: PlayerProfile; lastAction: NavigationAction | undefined; resumeAfterPlaylistStop: boolean;
  randomSeed: number; randomState: bigint;
  consumedResponses: string[]; eventQueue: VmEvent[]; actionQueue: NavigationAction[];
  trace: TraceEntry[]; actions: NavigationAction[]; diagnostics: VmDiagnostic[];
}
export interface VmOptions { limits?: Limits; maxInstructionsPerTurn?: number; maxCallDepth?: number; maxQueueDepth?: number; profile?: PlayerProfile; entries?: ParsedDisc["entries"]; onTrace?: (entry: TraceEntry) => void; randomSeed?: number; }
export interface VmProgram { id: number; instructions: Array<MovieInstruction | RawCommand | Uint8Array | string>; resumeIntention?: boolean; menuCallMask?: boolean; titleSearchMask?: boolean; }
export type ButtonCommand = MovieInstruction | RawCommand | Uint8Array | string;
export type ButtonCommandContext = "object" | "ig_object";
export type ButtonCommandResult = VmSnapshot & { buttonCommandTerminated: boolean };
export type ButtonProgramResult = VmSnapshot & { actions: NavigationAction[]; terminated: boolean; buttonCommandTerminated: boolean; fault: VmDiagnostic | null };
export type Continuation = { action: NavigationAction; nextProgramId: number; nextPc: number; };
export type MenuCheckpoint = {
  programId: number; pc: number; status: VmStatus; registers: ReturnType<RegisterFile["snapshot"]>;
  callStack: Array<{ programId: number; pc: number }>; continuation: Continuation | null;
  suspendedPlaylistContinuation: Continuation | null; suspendedPlaylistPlayback: PlaybackContext | null;
  pendingTitleCall: number | null; titleTransition: boolean; playback: PlaybackContext; queuedActionIds: Set<string>;
  diagnostic: VmDiagnostic | null; firstAction: number; firstDiagnostic: number; randomState: bigint;
};
export type VmTuning = { maxInstructionsPerTurn: number; maxCallDepth: number; maxQueueDepth: number };
