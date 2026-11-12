import type { MovieObject, MovieInstruction, ParsedDisc, SourceLocation } from "@bdmv2web/bdmv-parser";
import { DEFAULT_PLAYER_PROFILE } from "@bdmv2web/core/defaults";
import { DEFAULT_LIMITS, validateLimits, type Limits } from "@bdmv2web/core/limits";
import type { PlayerProfile as CorePlayerProfile } from "@bdmv2web/core";
import { decodeInstruction, type DecodedInstruction, type Operand, type RawCommand } from "./decode.js";
import { RegisterFile, RegisterFault, type PlayerProfile } from "./registers.js";

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
type Continuation = { action: NavigationAction; nextProgramId: number; nextPc: number; };
type MenuCheckpoint = {
  programId: number; pc: number; status: VmStatus; registers: ReturnType<RegisterFile["snapshot"]>;
  callStack: Array<{ programId: number; pc: number }>; continuation: Continuation | null;
  suspendedPlaylistContinuation: Continuation | null; suspendedPlaylistPlayback: PlaybackContext | null;
  pendingTitleCall: number | null; titleTransition: boolean; playback: PlaybackContext; queuedActionIds: Set<string>;
  diagnostic: VmDiagnostic | null; firstAction: number; firstDiagnostic: number; randomState: bigint;
};
type VmTuning = { maxInstructionsPerTurn: number; maxCallDepth: number; maxQueueDepth: number };
const EMPTY_DELTA: TraceEntry["registerDelta"] = { gpr: {}, psr: {} };
const WAIT_BY_ACTION: Partial<Record<ActionType, WaitFor>> = { PLAY_PLAYLIST: "ended", PLAY_PLAYLIST_ITEM: "ended", PLAY_PLAYLIST_MARK: "ended" };
const COMPARE_OPCODES = new Set(["BC", "EQ", "NE", "GE", "GT", "LE", "LT"]);
const PSR_TIME_TICKS_PER_SECOND = 45_000;
const RANDOM_MULTIPLIER = 6_364_136_223_846_793_005n;
const RANDOM_MASK = 0xffff_ffff_ffff_ffffn;

function textInstruction(d: DecodedInstruction): string { return `${d.opcode ?? "UNKNOWN"} ${d.operands.filter((x) => x !== null).map((x) => x.kind === "immediate" ? `#${x.value}` : `${x.kind}[${x.value}]`).join(",")}`.trim(); }

export class HdmvVm {
  readonly limits: Readonly<Limits>;
  readonly registers: RegisterFile;
  readonly trace: TraceEntry[] = [];
  readonly actions: NavigationAction[] = [];
  readonly diagnostics: VmDiagnostic[] = [];
  status: VmStatus = "idle";
  programId = 0; pc = 0; generation = 0; instructionsThisTurn = 0; diagnostic: VmDiagnostic | null = null;
  private readonly programs = new Map<number, VmProgram>(); private readonly callStack: Array<{ programId: number; pc: number }> = [];
  private continuation: Continuation | null = null; private suspendedPlaylistContinuation: Continuation | null = null; private suspendedPlaylistPlayback: PlaybackContext | null = null; private pendingTitleCall: number | null = null; private titleTransition = false; private menuCheckpoint: MenuCheckpoint | null = null; private sequence = 0; private readonly opts: VmTuning;
  private readonly consumedResponses = new Set<string>(); private readonly eventQueue: VmEvent[] = []; private readonly actionQueue: NavigationAction[] = [];
  private profile: PlayerProfile; private lastAction: NavigationAction | undefined; private instructionDiagnostic: VmDiagnostic | null = null; private resumeAfterPlaylistStop = false;
  private randomSeed: number; private randomState: bigint;
  private readonly entries: VmOptions["entries"];
  private readonly onTrace: VmOptions["onTrace"];
  private playback: PlaybackContext = { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null };
  constructor(programs: Array<VmProgram | MovieObject>, options: VmOptions = {}) {
    this.limits = Object.freeze(validateLimits(options.limits ?? {
      ...DEFAULT_LIMITS,
      ...(options.maxInstructionsPerTurn === undefined ? {} : { maxInstructionsPerTurn: options.maxInstructionsPerTurn }),
      ...(options.maxCallDepth === undefined ? {} : { maxCallDepth: options.maxCallDepth }),
      ...(options.maxQueueDepth === undefined ? {} : { maxQueueDepth: options.maxQueueDepth }),
    }));
    this.opts = {
      maxInstructionsPerTurn: this.limits.maxInstructionsPerTurn,
      maxCallDepth: this.limits.maxCallDepth,
      maxQueueDepth: this.limits.maxQueueDepth,
    };
    this.entries = options.entries; this.onTrace = options.onTrace; this.profile = normalizeProfile(options.profile); this.registers = new RegisterFile(this.profile);
    if (options.limits && [options.maxInstructionsPerTurn, options.maxCallDepth, options.maxQueueDepth].some((value) => value !== undefined)) {
      const diagnostic = { code: "VM_LIMITS_OVERRIDDEN", message: "The limits object takes precedence over scalar VM limit options.", source: null };
      this.diagnostics.push(diagnostic);
      this.record({ source: null, raw: null, decoded: "LIMITS", registerDelta: EMPTY_DELTA, status: "idle", diagnostic });
    }
    this.randomSeed = normalizeRandomSeed(options.randomSeed); this.randomState = BigInt(this.randomSeed);
    for (const p of programs) this.addProgram(p);
    this.record({ source: null, raw: null, decoded: `RESET profile=${stableProfile(this.profile)} seed=${this.randomSeed}`, registerDelta: EMPTY_DELTA, status: "idle" });
  }
  addProgram(program: VmProgram | MovieObject): void {
    const p = program;
    if (!Number.isInteger(p.id) || p.id < 0) throw new TypeError("Program id must be a non-negative integer");
    this.programs.set(p.id, { id: p.id, instructions: p.instructions, ...(p.resumeIntention !== undefined ? { resumeIntention: p.resumeIntention } : {}), ...(p.menuCallMask !== undefined ? { menuCallMask: p.menuCallMask } : {}), ...(p.titleSearchMask !== undefined ? { titleSearchMask: p.titleSearchMask } : {}) });
  }
  reset(programId = 0, profile: PlayerProfile = this.profile, randomSeed = this.randomSeed): void {
    const seed = normalizeRandomSeed(randomSeed);
    this.randomSeed = seed;
    this.randomState = BigInt(seed);
    this.profile = normalizeProfile(profile); this.registers.reset(this.profile); this.programId = programId; this.pc = 0; this.status = "idle"; this.generation++;
    this.callStack.length = 0; this.continuation = null; this.suspendedPlaylistContinuation = null; this.suspendedPlaylistPlayback = null; this.pendingTitleCall = null; this.titleTransition = false; this.menuCheckpoint = null; this.eventQueue.length = 0; this.actionQueue.length = 0; this.actions.length = 0; this.consumedResponses.clear(); this.instructionsThisTurn = 0; this.diagnostic = null; this.lastAction = undefined; this.resumeAfterPlaylistStop = false;
    this.playback = { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null };
    this.record({ source: null, raw: null, decoded: `RESET profile=${stableProfile(this.profile)} seed=${seed}`, registerDelta: EMPTY_DELTA, status: "idle" });
  }
  snapshot(): VmSnapshot { return { status: this.status, programId: this.programId, pc: this.pc, registers: this.registers.snapshot(), callStack: this.callStack.map((x) => ({ ...x })), playback: { ...this.playback }, generation: this.generation, waiting: this.continuation?.action ?? null, instructionsThisTurn: this.instructionsThisTurn, diagnostic: this.diagnostic }; }
  /** Save all mutable execution state so a navigation branch can resume from this point. */
  saveCheckpoint(): HdmvVmCheckpoint {
    return structuredClone({
      status: this.status, programId: this.programId, pc: this.pc, registers: this.registers.snapshot(),
      callStack: this.callStack, continuation: this.continuation, suspendedPlaylistContinuation: this.suspendedPlaylistContinuation,
      suspendedPlaylistPlayback: this.suspendedPlaylistPlayback, pendingTitleCall: this.pendingTitleCall, titleTransition: this.titleTransition,
      menuCheckpoint: this.menuCheckpoint, playback: this.playback, generation: this.generation,
      instructionsThisTurn: this.instructionsThisTurn, diagnostic: this.diagnostic, sequence: this.sequence,
      profile: this.profile, lastAction: this.lastAction, resumeAfterPlaylistStop: this.resumeAfterPlaylistStop,
      randomSeed: this.randomSeed, randomState: this.randomState,
      consumedResponses: [...this.consumedResponses], eventQueue: this.eventQueue, actionQueue: this.actionQueue,
      trace: this.trace, actions: this.actions, diagnostics: this.diagnostics,
    });
  }
  /** Restore a checkpoint created by this VM's matching program set and options. */
  restoreCheckpoint(checkpoint: HdmvVmCheckpoint): void {
    if (checkpoint.registers.gpr.length !== this.registers.gpr.length || checkpoint.registers.psr.length !== this.registers.psr.length) throw new TypeError("VM checkpoint has incompatible register state");
    normalizeRandomSeed(checkpoint.randomSeed);
    const state = structuredClone(checkpoint);
    this.status = state.status; this.programId = state.programId; this.pc = state.pc;
    this.registers.gpr.set(state.registers.gpr); this.registers.psr.set(state.registers.psr);
    this.callStack.splice(0, this.callStack.length, ...state.callStack);
    this.continuation = state.continuation; this.suspendedPlaylistContinuation = state.suspendedPlaylistContinuation;
    this.suspendedPlaylistPlayback = state.suspendedPlaylistPlayback; this.pendingTitleCall = state.pendingTitleCall; this.titleTransition = state.titleTransition;
    this.menuCheckpoint = state.menuCheckpoint; this.playback = state.playback; this.generation = state.generation;
    this.instructionsThisTurn = state.instructionsThisTurn; this.diagnostic = state.diagnostic; this.sequence = state.sequence;
    this.profile = state.profile; this.lastAction = state.lastAction; this.resumeAfterPlaylistStop = state.resumeAfterPlaylistStop; this.randomSeed = state.randomSeed; this.randomState = state.randomState;
    this.consumedResponses.clear(); for (const response of state.consumedResponses) this.consumedResponses.add(response);
    this.eventQueue.splice(0, this.eventQueue.length, ...state.eventQueue);
    this.actionQueue.splice(0, this.actionQueue.length, ...state.actionQueue);
    this.trace.splice(0, this.trace.length, ...state.trace);
    this.actions.splice(0, this.actions.length, ...state.actions);
    this.diagnostics.splice(0, this.diagnostics.length, ...state.diagnostics);
  }
  /** Synchronize the active interactive-graphics page and focus into PSR11/PSR10. */
  applyMenuContext(pageId: number, selectedButtonId: number | null): void {
    if (!Number.isInteger(pageId) || pageId < 0 || pageId > 0xff) throw new RangeError("Menu page ID must be an 8-bit unsigned integer");
    if (selectedButtonId !== null && (!Number.isInteger(selectedButtonId) || selectedButtonId < 0 || selectedButtonId > 0xffff)) {
      throw new RangeError("Selected button ID must be a 16-bit unsigned integer or null");
    }
    const before = this.registers.snapshot();
    this.registers.systemWrite(10, selectedButtonId ?? 0xffff);
    this.registers.systemWrite(11, pageId);
    this.record({
      source: null, raw: null, decoded: `MENU_CONTEXT page=${pageId} button=${selectedButtonId ?? "none"}`,
      registerDelta: delta(before, this.registers.snapshot()), status: this.status,
    });
  }
  /** Capture the live menu context before a user action can transfer control to a feature. */
  beginMenuAction(): void {
    if (this.status === "faulted" || this.status === "stopped") return;
    this.menuCheckpoint = {
      programId: this.programId, pc: this.pc, status: this.status, registers: this.registers.snapshot(),
      callStack: this.callStack.map((frame) => ({ ...frame })), continuation: this.continuation,
      suspendedPlaylistContinuation: this.suspendedPlaylistContinuation, suspendedPlaylistPlayback: this.suspendedPlaylistPlayback ? { ...this.suspendedPlaylistPlayback } : null,
      pendingTitleCall: this.pendingTitleCall, titleTransition: this.titleTransition, playback: { ...this.playback },
      queuedActionIds: new Set(this.actionQueue.map((action) => action.id)), diagnostic: this.diagnostic, randomState: this.randomState,
      firstAction: this.actions.length, firstDiagnostic: this.diagnostics.length,
    };
    this.diagnostic = null;
  }
  /** Restore the menu without fabricating an external player's completion event. */
  recoverMenuAction(action?: NavigationAction): boolean {
    const saved = this.menuCheckpoint;
    if (!saved || (action && !this.actions.slice(saved.firstAction).some((candidate) => candidate.id === action.id))) return false;
    this.registers.gpr.set(saved.registers.gpr); this.registers.psr.set(saved.registers.psr);
    this.programId = saved.programId; this.pc = saved.pc; this.status = saved.status;
    this.callStack.splice(0, this.callStack.length, ...saved.callStack.map((frame) => ({ ...frame })));
    this.continuation = saved.continuation; this.suspendedPlaylistContinuation = saved.suspendedPlaylistContinuation;
    this.suspendedPlaylistPlayback = saved.suspendedPlaylistPlayback ? { ...saved.suspendedPlaylistPlayback } : null; this.pendingTitleCall = saved.pendingTitleCall;
    this.playback = { ...saved.playback }; this.diagnostic = saved.diagnostic; this.resumeAfterPlaylistStop = false; this.lastAction = undefined;
    this.titleTransition = saved.titleTransition; this.randomState = saved.randomState;
    if (this.diagnostics.length > saved.firstDiagnostic) this.diagnostics.splice(saved.firstDiagnostic);
    if (saved.continuation) this.consumedResponses.delete(`${saved.continuation.action.generation}:${saved.continuation.action.id}`);
    const retained = this.actionQueue.filter((queued) => saved.queuedActionIds.has(queued.id));
    this.actionQueue.splice(0, this.actionQueue.length, ...retained);
    this.menuCheckpoint = null;
    this.record({ source: null, raw: null, decoded: "MENU_ACTION_RECOVERED", registerDelta: EMPTY_DELTA, status: this.status });
    return true;
  }
  /** Execute one selected button's command in the current VM register/object context. Ordinary commands leave PC unchanged; object/title control transfers use the current VM context. GOTO and compare require executeButtonProgram(). The button identity is not an object ID. */
  executeButtonCommand(command: ButtonCommand, source?: SourceLocation, context: ButtonCommandContext = "object"): ButtonCommandResult {
    if (this.status === "faulted" || this.status === "stopped" || this.inputBlocked()) {
      const diagnostic = { code: this.status === "suspended" ? "HDMV_INPUT_WHILE_SUSPENDED" : "HDMV_EVENT_AFTER_TERMINAL", message: `Button command rejected while VM is ${this.status}`, source: source ?? null };
      this.record({ source: source ?? null, raw: null, decoded: null, registerDelta: EMPTY_DELTA, status: this.status, diagnostic });
      return { ...this.snapshot(), buttonCommandTerminated: false };
    }
    this.resumeAfterPlaylistStop = false;
    this.instructionsThisTurn = 0;
    const savedPlaylistContinuation = this.hasPlaylistContinuation() ? this.continuation : null;
    const before = this.registers.snapshot(); const from = { programId: this.programId, pc: this.pc };
    let d: DecodedInstruction;
    try { d = decodeInstruction(command, source); }
    catch (error) {
      this.failButtonProgram("HDMV_INVALID_INSTRUCTION", error instanceof Error ? error.message : String(error), source ?? null);
      return { ...this.snapshot(), buttonCommandTerminated: false };
    }
    if (d.status === "invalid" || !d.opcode) {
      this.failButtonProgram(d.issues[0] ?? "HDMV_UNKNOWN_OPCODE", `Cannot execute ${d.opcode ?? "unknown encoding"}: ${d.issues.join(", ") || d.bytes}`, d.source, d, before, from);
      return { ...this.snapshot(), buttonCommandTerminated: false };
    }
    const program = this.programs.get(this.programId);
    if (!program) {
      this.failButtonProgram("HDMV_INVALID_TARGET", `No program/object ${this.programId}`, d.source, d, before, from);
      return { ...this.snapshot(), buttonCommandTerminated: false };
    }
    if (this.instructionsThisTurn >= this.opts.maxInstructionsPerTurn) {
      this.failButtonProgram("VM_EXECUTION_LIMIT", `Exceeded ${this.opts.maxInstructionsPerTurn} instructions in one turn`, d.source, d, before, from);
      return { ...this.snapshot(), buttonCommandTerminated: false };
    }
    this.instructionsThisTurn++;
    this.instructionDiagnostic = null;
    if (d.opcode === "GOTO" || COMPARE_OPCODES.has(d.opcode)) {
      // GOTO and compare operate on a button command sequence, not on the
      // MovieObject PC. executeButtonProgram() owns that sequence-local PC.
      this.noteIgnoredInstruction("HDMV_BUTTON_COMMAND_REQUIRES_PROGRAM", `${d.opcode} requires a button command sequence; use executeButtonProgram()`, d.source);
      this.record({ programId: from.programId, pc: from.pc, source: d.source, raw: d.bytes, decoded: textInstruction(d), registerDelta: delta(before, this.registers.snapshot()), status: this.status, ...(this.instructionDiagnostic ? { diagnostic: this.instructionDiagnostic } : {}) });
      this.instructionDiagnostic = null;
      return { ...this.snapshot(), buttonCommandTerminated: false };
    }
    let buttonCommandTerminated: boolean;
    if (d.opcode === "BREAK") {
      // BREAK ends the current button command object; it must not change the
      // MovieObject PC or make the shared VM terminal.
      buttonCommandTerminated = true;
      this.record({ programId: from.programId, pc: from.pc, source: d.source, raw: d.bytes, decoded: textInstruction(d), registerDelta: EMPTY_DELTA, status: this.status });
      return { ...this.snapshot(), buttonCommandTerminated };
    }
    if (this.status === "idle") this.status = "running";
    try { buttonCommandTerminated = this.execute(d, program, context) === true; }
    catch (error) {
      this.failButtonProgram(error instanceof RegisterFault ? error.code : "HDMV_EXECUTION_FAULT", error instanceof Error ? error.message : String(error), d.source, d, before, from);
      return { ...this.snapshot(), buttonCommandTerminated: false };
    }
    this.record({ programId: from.programId, pc: from.pc, source: d.source, raw: d.bytes, decoded: textInstruction(d), ...(this.lastAction ? { action: this.lastAction } : {}), registerDelta: delta(before, this.registers.snapshot()), status: this.status, ...(this.instructionDiagnostic ? { diagnostic: this.instructionDiagnostic } : {}) });
    this.lastAction = undefined; this.instructionDiagnostic = null;
    if (this.resumeAfterPlaylistStop && this.status === "running") {
      this.resumeAfterPlaylistStop = false;
      return { ...this.runTurn(), buttonCommandTerminated };
    }
    if (savedPlaylistContinuation && this.continuation === savedPlaylistContinuation && this.status === "running") this.status = "suspended";
    return { ...this.snapshot(), buttonCommandTerminated };
  }
  /** Execute a button's complete command array with a sequence-local PC. */
  executeButtonProgram(commands: ButtonCommand[], context: ButtonCommandContext = "object"): ButtonProgramResult {
    const firstAction = this.actions.length;
    if (this.status === "faulted" || this.status === "stopped" || this.inputBlocked()) {
      const diagnostic = { code: this.status === "suspended" ? "HDMV_INPUT_WHILE_SUSPENDED" : "HDMV_EVENT_AFTER_TERMINAL", message: `Button program rejected while VM is ${this.status}`, source: null };
      this.record({ source: null, raw: null, decoded: null, registerDelta: EMPTY_DELTA, status: this.status, diagnostic });
      return { ...this.snapshot(), actions: [], terminated: false, buttonCommandTerminated: false, fault: this.status === "faulted" ? this.diagnostic : null };
    }

    const ownerProgramId = this.programId; const ownerPc = this.pc;
    // A button command object executes while the MovieObject stays suspended
    // on its playlist action. Keep that action and restore the suspended
    // playback state if the button program leaves it untouched.
    const savedPlaylistContinuation = this.hasPlaylistContinuation() ? this.continuation : null;
    if (this.status === "suspended") this.status = "running";
    const program = this.programs.get(ownerProgramId) ?? { id: ownerProgramId, instructions: [] };
    let pc = 0; let terminated = false; let buttonCommandTerminated = false;
    this.resumeAfterPlaylistStop = false;
    this.instructionsThisTurn = 0;
    if (this.status === "idle") this.status = "running";
    while (pc < commands.length && this.status === "running") {
      if (this.instructionsThisTurn >= this.opts.maxInstructionsPerTurn) {
        this.failButtonProgram("VM_EXECUTION_LIMIT", `Exceeded ${this.opts.maxInstructionsPerTurn} instructions in one turn`, null, undefined, undefined, { programId: ownerProgramId, pc });
        break;
      }
      let d: DecodedInstruction;
      try { d = decodeInstruction(commands[pc]!); }
      catch (error) {
        this.failButtonProgram("HDMV_INVALID_INSTRUCTION", error instanceof Error ? error.message : String(error), null, undefined, undefined, { programId: ownerProgramId, pc });
        break;
      }
      const instructionPc = pc; pc += 1; this.instructionsThisTurn++;
      this.instructionDiagnostic = null;
      const before = this.registers.snapshot(); const [a, b] = d.operands;
      if (d.status === "invalid" || !d.opcode) {
        this.failButtonProgram(d.issues[0] ?? "HDMV_UNKNOWN_OPCODE", `Cannot execute ${d.opcode ?? "unknown encoding"}: ${d.issues.join(", ") || d.bytes}`, d.source, d, before, { programId: ownerProgramId, pc: instructionPc });
        break;
      }
      try {
        if (d.opcode === "GOTO") {
          // libbluray sets PC to the target and treats any target at or past
          // the command count as the end of the button command object.
          pc = a ? this.value(a) : 0;
        } else if (COMPARE_OPCODES.has(d.opcode)) {
          const av = a ? this.value(a) : 0; const bv = b ? this.value(b) : 0;
          if (comparisonSkips(d.opcode, av, bv)) pc += 1;
        } else if (d.opcode === "BREAK") {
          terminated = true;
        } else {
          buttonCommandTerminated = this.execute(d, program, context) === true;
          if (buttonCommandTerminated) terminated = true;
        }
      } catch (error) {
        this.failButtonProgram(error instanceof RegisterFault ? error.code : "HDMV_EXECUTION_FAULT", error instanceof Error ? error.message : String(error), d.source, d, before, { programId: ownerProgramId, pc: instructionPc });
        break;
      }
      this.record({ programId: ownerProgramId, pc: instructionPc, source: d.source, raw: d.bytes, decoded: textInstruction(d), ...(this.lastAction ? { action: this.lastAction } : {}), registerDelta: delta(before, this.registers.snapshot()), status: this.status, ...(this.instructionDiagnostic ? { diagnostic: this.instructionDiagnostic } : {}) });
      this.lastAction = undefined; this.instructionDiagnostic = null;
      if (terminated || this.status !== "running" || this.programId !== ownerProgramId || this.pc !== ownerPc) break;
    }
    if (!terminated && this.status === "running" && pc >= commands.length) terminated = true;
    if (savedPlaylistContinuation && this.continuation === savedPlaylistContinuation && this.status === "running") this.status = "suspended";
    if ((!savedPlaylistContinuation || this.continuation !== savedPlaylistContinuation) && this.status === "running" && (this.programId !== ownerProgramId || this.pc !== ownerPc)) this.runTurn();
    if (this.resumeAfterPlaylistStop && this.status === "running") {
      this.resumeAfterPlaylistStop = false;
      this.runTurn();
    }
    const snapshot = this.snapshot();
    return { ...snapshot, actions: this.actions.slice(firstAction), terminated, buttonCommandTerminated, fault: snapshot.status === "faulted" ? snapshot.diagnostic : null };
  }
  runTurn(): VmSnapshot {
    if (this.status === "faulted" || this.status === "stopped" || this.status === "suspended") return this.snapshot();
    this.status = "running"; this.instructionsThisTurn = 0;
    while (this.status === "running") {
      if (this.instructionsThisTurn >= this.opts.maxInstructionsPerTurn) { this.fail("VM_EXECUTION_LIMIT", `Exceeded ${this.opts.maxInstructionsPerTurn} instructions in one turn`, this.currentSource()); break; }
      const program = this.programs.get(this.programId);
      if (!program) { this.fail("HDMV_INVALID_TARGET", `No program/object ${this.programId}`, null); break; }
      const row = program.instructions[this.pc];
      if (!row) {
        // PC at or past the instruction count is the object end. libbluray
        // uses pc = 1 << 17 for BREAK and treats the same condition as END.
        if (this.pc >= program.instructions.length) {
          this.status = "idle";
          this.record({ source: null, raw: null, decoded: "PROGRAM_END", registerDelta: EMPTY_DELTA, status: this.status });
          break;
        }
        this.fail("HDMV_INVALID_PC", `PC ${this.pc} is outside object ${this.programId}`, program.instructions.at(-1) ? decodeInstruction(program.instructions.at(-1)!).source : null); break;
      }
      let d: DecodedInstruction;
      try { d = decodeInstruction(row); } catch (error) { this.fail("HDMV_INVALID_INSTRUCTION", String(error), null); break; }
      this.instructionsThisTurn++;
      const before = this.registers.snapshot(); const from = { programId: this.programId, pc: this.pc }; this.pc++;
      this.instructionDiagnostic = null;
      if (d.status === "invalid" || !d.opcode) { this.fail(d.issues[0] ?? "HDMV_UNKNOWN_OPCODE", `Cannot execute ${d.opcode ?? "unknown encoding"}: ${d.issues.join(", ") || d.bytes}`, d.source, d, before, from); break; }
      try {
        this.execute(d, program);
      } catch (error) {
        this.fail(error instanceof RegisterFault ? error.code : "HDMV_EXECUTION_FAULT", error instanceof Error ? error.message : String(error), d.source, d, before, from); break;
      }
      this.record({ programId: from.programId, pc: from.pc, source: d.source, raw: d.bytes, decoded: textInstruction(d), ...(this.lastAction ? { action: this.lastAction } : {}), registerDelta: delta(before, this.registers.snapshot()), status: this.status, ...(this.instructionDiagnostic ? { diagnostic: this.instructionDiagnostic } : {}) }); this.lastAction = undefined; this.instructionDiagnostic = null;
    }
    return this.snapshot();
  }
  /** Resolve a title-search action using the disc index without inventing a media-ended event. */
  selectTitle(title: number): VmSnapshot {
    if (this.pendingTitleCall !== null && this.pendingTitleCall !== title) {
      const diagnostic = { code: "HDMV_TITLE_RESPONSE_MISMATCH", message: `CALL_TITLE is waiting for title ${this.pendingTitleCall}, received title ${title}`, source: null };
      this.record({ source: null, raw: null, decoded: "TITLE_SEARCH_RESPONSE_IGNORED", registerDelta: EMPTY_DELTA, status: this.status, diagnostic });
      return this.snapshot();
    }
    try {
      if (!this.entries) throw new RegisterFault("HDMV_UNVERIFIED_OPCODE", "Title navigation requires the disc title table");
      this.validateTitleTarget(title);
      const entry = title === 0 ? this.entries.find((item) => item.kind === "topMenu")
        : title === 0xffff ? this.entries.find((item) => item.kind === "firstPlay")
          : this.entries.filter((item) => item.kind === "title")[title - 1];
      if (!entry) throw new RegisterFault("HDMV_INVALID_TARGET", `Title ${title} has no index entry`);
      if (entry.target.objectType === "BDJ") throw new RegisterFault("HDMV_UNVERIFIED_OPCODE", `Title ${title} resolves to unsupported BD-J`);
      if (entry.target.objectType !== "HDMV" || typeof entry.target.target !== "number") throw new RegisterFault("HDMV_INVALID_TARGET", `Title ${title} has no resolved HDMV object target`);
      this.validateTarget(entry.target.target, 0);
      const isCallReturn = this.pendingTitleCall !== null;
      if (!isCallReturn && this.continuation) {
        const action = this.continuation.action;
        this.consumedResponses.add(`${action.generation}:${action.id}`);
        this.removeAction(action.id);
      }
      if (!isCallReturn) this.continuation = null;
      this.pendingTitleCall = null; this.titleTransition = false;
      this.playback = { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null };
      const before = this.registers.snapshot();
      this.registers.systemWrite(4, title);
      this.programId = entry.target.target; this.pc = 0; this.status = "running";
      this.record({ source: entry.source, raw: null, decoded: `TITLE_SELECTED title=${title} object=${entry.target.target}`, registerDelta: delta(before, this.registers.snapshot()), status: this.status });
      return this.runTurn();
    } catch (error) {
      // A title search that cannot be resolved is a rejected player request,
      // not a VM execution fault. libbluray returns from _play_title without
      // selecting an object. Leave the VM available for menu input.
      const issue = { code: error instanceof RegisterFault ? error.code : "HDMV_EXECUTION_FAULT", message: error instanceof Error ? error.message : String(error), source: null };
      this.pendingTitleCall = null; this.titleTransition = false;
      this.diagnostic = issue; this.diagnostics.push(issue);
      if (this.status === "suspended" && !this.continuation) this.status = "idle";
      this.record({ source: null, raw: null, decoded: "TITLE_SELECTION_REJECTED", registerDelta: EMPTY_DELTA, status: this.status, diagnostic: issue });
      return this.snapshot();
    }
  }
  /** Select a BD-J INDEX entry while retaining the shared player registers for the Java runtime. */
  selectBdjTitle(title: number): VmSnapshot {
    try {
      if (!this.entries) throw new RegisterFault("HDMV_UNVERIFIED_OPCODE", "BD-J title navigation requires the disc title table");
      this.validateTitleTarget(title);
      const entry = title === 0 ? this.entries.find((item) => item.kind === "topMenu")
        : title === 0xffff ? this.entries.find((item) => item.kind === "firstPlay")
          : this.entries.filter((item) => item.kind === "title")[title - 1];
      if (!entry) throw new RegisterFault("HDMV_INVALID_TARGET", `Title ${title} has no index entry`);
      if (entry.target.objectType !== "BDJ" || typeof entry.target.target !== "string") throw new RegisterFault("HDMV_INVALID_TARGET", `Title ${title} does not resolve to a BD-J object`);
      if (this.continuation) this.consumedResponses.add(`${this.continuation.action.generation}:${this.continuation.action.id}`);
      this.actionQueue.length = 0; this.continuation = null; this.suspendedPlaylistContinuation = null; this.suspendedPlaylistPlayback = null;
      this.pendingTitleCall = null; this.titleTransition = false; this.eventQueue.length = 0;
      this.playback = { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null };
      this.programId = 0; this.pc = 0; this.status = "idle";
      const before = this.registers.snapshot();
      this.registers.systemWrite(4, title);
      this.record({ source: entry.source, raw: null, decoded: `BDJ_TITLE_SELECTED title=${title} bdjo=${entry.target.target}`, registerDelta: delta(before, this.registers.snapshot()), status: this.status });
      return this.snapshot();
    } catch (error) {
      const issue = { code: error instanceof RegisterFault ? error.code : "HDMV_EXECUTION_FAULT", message: error instanceof Error ? error.message : String(error), source: null };
      this.pendingTitleCall = null; this.titleTransition = false;
      if (this.status === "suspended" && !this.continuation) this.status = "idle";
      this.diagnostic = issue; this.diagnostics.push(issue);
      this.record({ source: null, raw: null, decoded: "BDJ_TITLE_SELECTION_REJECTED", registerDelta: EMPTY_DELTA, status: this.status, diagnostic: issue });
      return this.snapshot();
    }
  }
  /** Queue a BD-J playback operation through the same correlated action bridge as HDMV commands. */
  requestHostAction(type: ActionType, payload: Record<string, number | string | boolean | null>, source: SourceLocation): NavigationAction {
    if (!["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK", "PLAY_STOP", "SET_STREAM", "SET_SECONDARY_STREAM"].includes(type)) throw new TypeError(`BD-J cannot request HDMV action '${type}'.`);
    this.actionAndSuspend(type, payload, source);
    const action = this.lastAction;
    if (!action) throw new Error(`BD-J action '${type}' was not queued.`);
    return action;
  }
  /** Stop waiting for an external player whose playback state is not observable. */
  releaseExternalPlayback(action: NavigationAction): void {
    if (!this.continuation || this.continuation.action.id !== action.id || this.continuation.action.generation !== action.generation) return;
    this.consumedResponses.add(`${action.generation}:${action.id}`);
    this.removeAction(action.id); this.continuation = null;
    if (this.recoverMenuAction(action)) return;
    this.playback = { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null };
    this.status = "idle";
    this.record({ source: action.source, raw: null, decoded: "EXTERNAL_PLAYER_HANDOFF", registerDelta: EMPTY_DELTA, status: this.status });
  }
  /** Record a playback response discarded by a bridge without changing VM state. */
  recordDiscardedEvent(event: VmEvent, message: string, source: SourceLocation | null = null): void {
    const diagnostic = { code: "HDMV_EVENT_DISCARDED", message, source };
    this.record({ source, raw: null, decoded: "DISCARDED_EVENT", input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic });
  }
  enqueueEvent(event: VmEvent): void {
    if (this.eventQueue.length >= this.opts.maxQueueDepth) { this.fail("VM_QUEUE_LIMIT", `Event queue exceeds ${this.opts.maxQueueDepth}`, null); return; }
    this.eventQueue.push(event);
  }
  drainActions(): NavigationAction[] { return this.actionQueue.splice(0); }
  processNextEvent(): VmSnapshot {
    const event = this.eventQueue.shift(); if (event) this.handleEvent(event); return this.snapshot();
  }
  handleEvent(event: VmEvent): VmSnapshot {
    if (this.status === "faulted" || this.status === "stopped") {
      this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_EVENT_AFTER_TERMINAL", message: `Ignoring ${event.type} after VM entered ${this.status}`, source: null } });
      return this.snapshot();
    }
    if (event.type === "MENU_INPUT" || event.type === "TOP_MENU" || event.type === "POPUP_MENU" || event.type === "RETURN") return this.handleUserEvent(event);
    if (this.titleTransition && !this.continuation && (event.type === "MEDIA_UNAVAILABLE" || event.type === "MEDIA_ERROR")) {
      // A player that cannot start the selected title releases the transition
      // and returns the VM to `idle` with a media diagnostic.
      this.titleTransition = false; this.status = "idle";
      const issue = { code: event.type === "MEDIA_ERROR" ? "HDMV_MEDIA_ERROR" : "HDMV_MEDIA_UNAVAILABLE", message: `Title transition failed: ${event.type}`, source: null };
      this.diagnostic = issue; this.diagnostics.push(issue);
      this.record({ source: null, raw: null, decoded: "TITLE_TRANSITION_RELEASED", input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: issue });
      return this.snapshot();
    }
    const pending = this.continuation; const eventKey = event.responseTo ? `${event.generation}:${event.responseTo}` : "";
    const matchesPending = !!pending && event.generation === pending.action.generation && event.responseTo === pending.action.id;
    if (event.type === "PLAYITEM_CHANGED" || event.type === "TIME_UPDATED" || event.type === "MEDIA_SEEKED") {
      // Playback progress updates PSR7/PSR8 even when no VM continuation is
      // waiting. libbluray updates these registers from the player side.
      this.applyPlaybackStatusEvent(event);
      const resumesWait = matchesPending && eventMatches(pending.action.waitFor, event.type);
      if (!resumesWait) {
        this.record({ source: pending?.action.source ?? null, raw: null, decoded: pending?.action.type ?? null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status });
        return this.snapshot();
      }
    }
    if (eventKey && this.consumedResponses.has(eventKey)) {
      this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_DUPLICATE_EVENT", message: "Response already consumed", source: null } });
      return this.snapshot();
    }
    if (!matchesPending) {
      this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_IGNORED_EVENT", message: !pending ? "No continuation is waiting" : "Generation or responseTo does not match current action", source: null } });
      return this.snapshot();
    }
    if (event.type === "MEDIA_STARTED" && pending.action.type.startsWith("PLAY_")) {
      // A started acknowledgement does not satisfy the ended wait; it only
      // records that playback is running. The continuation stays pending.
      this.playback.status = "playing";
      this.record({ source: pending.action.source, raw: null, decoded: pending.action.type, input: event, event, registerDelta: EMPTY_DELTA, status: this.status });
      return this.snapshot();
    }
    if (event.type === "MEDIA_ERROR" || event.type === "MEDIA_UNAVAILABLE") {
      this.consumedResponses.add(eventKey); this.removeAction(pending.action.id);
      this.playback.status = event.type === "MEDIA_ERROR" ? "error" : "unavailable"; this.playback.pendingActionId = null;
      this.continuation = null; this.status = "stopped"; this.diagnostic = { code: event.type === "MEDIA_ERROR" ? "HDMV_MEDIA_ERROR" : "HDMV_MEDIA_UNAVAILABLE", message: `Action ${pending.action.id} failed: ${event.type}`, source: pending.action.source }; this.diagnostics.push(this.diagnostic);
      this.record({ source: pending.action.source, raw: null, decoded: pending.action.type, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: this.diagnostic });
      this.recoverMenuAction(pending.action); return this.snapshot();
    }
    if (!eventMatches(pending.action.waitFor, event.type)) { this.record({ source: pending.action.source, raw: null, decoded: pending.action.type, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_EVENT_NOT_READY", message: `Waiting for ${pending.action.waitFor}; received ${event.type}`, source: pending.action.source } }); return this.snapshot(); }
    this.consumedResponses.add(eventKey); this.removeAction(pending.action.id);
    const before = this.registers.snapshot(); this.continuation = null; this.programId = pending.nextProgramId; this.pc = pending.nextPc;
    if (event.type === "MEDIA_ENDED") this.playback.status = "ended";
    this.playback.pendingActionId = null;
    this.status = "running";
    this.record({ source: pending.action.source, raw: null, decoded: pending.action.type, input: event, event, registerDelta: delta(before, this.registers.snapshot()), status: this.status });
    return this.runTurn();
  }
  private applyPlaybackStatusEvent(event: VmEvent): void {
    if (event.type === "PLAYITEM_CHANGED") {
      const n = Number(event.payload?.playItem);
      if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
        this.registers.systemWrite(7, n);
        this.playback.playItem = n;
        this.playback.status = "playing";
      }
      return;
    }
    const ticks = playbackTicks(event);
    if (ticks === null) return;
    this.registers.systemWrite(8, ticks);
    this.playback.presentationTime = ticks;
  }
  private inputBlocked(): boolean {
    return this.titleTransition || this.pendingTitleCall !== null;
  }
  private handleUserEvent(event: VmEvent): VmSnapshot {
    if (this.inputBlocked()) {
      this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_INPUT_WHILE_SUSPENDED", message: "Navigation input is rejected while a title or menu transition is pending", source: null } });
      return this.snapshot();
    }
    try {
      const program = this.programs.get(this.programId);
      const source: SourceLocation = { path: "<user-event>", origin: "primary", offset: "0" };
      if (event.type === "MENU_INPUT") {
        if (event.payload?.uoAllowed === false) { this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_UO_BLOCKED", message: "User operation is prohibited by the current UO mask", source: null } }); return this.snapshot(); }
        const target = Number(event.payload?.objectId);
        // libbluray runs the button program as an interactive composition while
        // the MovieObject waits for playlist end (hdmv_vm_set_object()).
        // _jump_object() drops that wait: playing_object = NULL, and a later
        // playlist end finds no playing object and leaves the VM untouched
        // (_resume_from_play_pl()). Stop the wait before entering the target
        // object at PC 0 so the pending MEDIA_ENDED cannot overwrite the
        // transfer.
        if (Number.isInteger(target) && target >= 0 && this.tryTransfer(target, 0, source)) {
          if (this.hasPlaylistContinuation()) this.stopPlayingContinuation(this.continuation!, source);
          this.status = "running";
          this.runTurn();
        }
      } else if (event.type === "TOP_MENU") {
        // libbluray treats the top-menu key as a player operation: bd_menu_call
        // checks the Menu Call Mask, suspends the playing MovieObject when its
        // resume intention is set, and starts the Top Menu index entry. The
        // player performs the suspend and the title start under one lock, so no
        // user input can interleave between the menu call and the title
        // selection. Block input until selectTitle() consumes the emitted
        // TITLE_SEARCH.
        if (event.payload?.uoAllowed === false || program?.menuCallMask === true) { this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_UO_BLOCKED", message: "TOP_MENU is blocked by UO/menu-call mask state", source: null } }); return this.snapshot(); }
        this.suspendPlayingForMenuCall();
        this.emit("TITLE_SEARCH", { title: 0 }, source);
        this.status = "suspended";
        this.titleTransition = true;
      } else if (event.type === "POPUP_MENU") {
        // Popup availability is governed by the playlist/page UO mask, which
        // the runtime checks before dispatching this event.
        if (event.payload?.uoAllowed === false) { this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_UO_BLOCKED", message: "POPUP_MENU is blocked by UO mask state", source: null } }); return this.snapshot(); }
        this.emit("MENU_CALL", {}, source);
      } else {
        if (!this.replayParkedPlayback()) this.emit("MENU_RETURN", {}, source);
      }
      this.record({ source: null, raw: null, decoded: null, ...(this.lastAction ? { action: this.lastAction } : {}), input: event, event, registerDelta: EMPTY_DELTA, status: this.status, ...(this.instructionDiagnostic ? { diagnostic: this.instructionDiagnostic } : {}) }); this.lastAction = undefined; this.instructionDiagnostic = null; return this.snapshot();
    } catch (error) {
      const code = error instanceof RegisterFault ? error.code : "HDMV_USER_EVENT_FAULT";
      const message = error instanceof Error ? error.message : String(error);
      const issue = { code, message, source: null };
      this.fail(code, message, null);
      this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: issue });
      return this.snapshot();
    }
  }
  private execute(d: DecodedInstruction, program: VmProgram, context: ButtonCommandContext = "object"): boolean | void {
    const op = d.opcode!; const [a, b] = d.operands;
    const av = a ? (op === "SET_BUTTON_PAGE" ? this.buttonPageValue(a, d.immOp1) : this.value(a)) : 0;
    const bv = b ? (op === "SET_BUTTON_PAGE" ? this.buttonPageValue(b, d.immOp2) : this.value(b)) : 0;
    switch (op) {
      case "NOP": return;
      case "BREAK":
        // libbluray sets PC to 1 << 17; the next run-loop iteration treats any
        // PC at or past the instruction count as the end of the object.
        this.pc = program.instructions.length;
        return;
      case "GOTO": this.pc = av; return;
      case "BC": this.skipIf((av & ~bv) !== 0); return;
      case "EQ": this.skipIf(av !== bv); return;
      case "NE": this.skipIf(av === bv); return;
      case "GE": this.skipIf(av < bv); return;
      case "GT": this.skipIf(av <= bv); return;
      case "LE": this.skipIf(av > bv); return;
      case "LT": this.skipIf(av >= bv); return;
      case "MOVE": this.write(a!, bv); return;
      case "SWAP": this.write(a!, bv); this.write(b!, av); return;
      case "ADD": this.write(a!, Math.min(0xffffffff, av + bv)); return;
      case "SUB": this.write(a!, av > bv ? av - bv : 0); return;
      case "MUL": this.write(a!, Math.min(0xffffffff, av * bv)); return;
      case "DIV": this.write(a!, bv ? Math.floor(av / bv) : 0xffffffff); return;
      case "MOD": this.write(a!, bv ? av % bv : 0xffffffff); return;
      case "RND": this.write(a!, this.nextRandom(bv, d.source)); return;
      case "AND": this.write(a!, av & bv); return;
      case "OR": this.write(a!, av | bv); return;
      case "XOR": this.write(a!, av ^ bv); return;
      case "BITSET": case "BITCLR": if (bv >= 32) throw new RegisterFault("HDMV_ILLEGAL_OPERAND", `Bit index ${bv} exceeds 31`); this.write(a!, op === "BITSET" ? av | (1 << bv) : av & ~(1 << bv)); return;
      case "SHL": case "SHR": if (bv >= 32) throw new RegisterFault("HDMV_ILLEGAL_OPERAND", `Shift count ${bv} exceeds 31`); this.write(a!, op === "SHL" ? av << bv : av >>> bv); return;
      case "JUMP_OBJECT":
        if (!this.programs.has(av)) { this.noteIgnoredInstruction("HDMV_INVALID_TARGET", `Target object ${av} does not exist`, d.source); return; }
        // _jump_object() keeps the suspended call object, stops the playing
        // object, and queues PLAY_STOP before entering the target at PC 0.
        if (context === "ig_object" && this.hasPlaylistContinuation()) this.stopPlayingContinuation(this.continuation!, d.source);
        this.tryTransfer(av, 0, d.source);
        return;
      case "CALL_OBJECT": {
        if (!this.programs.has(av)) { this.noteIgnoredInstruction("HDMV_INVALID_TARGET", `Target object ${av} does not exist`, d.source); return; }
        if (this.opts.maxCallDepth < 1) throw new RegisterFault("VM_CALL_DEPTH_LIMIT", `Call depth exceeds ${this.opts.maxCallDepth}`);
        this.saveCallPsrState();
        // libbluray keeps one suspended object; a later CALL replaces that context.
        const playing = context === "ig_object" && this.hasPlaylistContinuation() ? this.continuation : null;
        if (playing) {
          this.suspendedPlaylistContinuation = playing;
          this.suspendedPlaylistPlayback = { ...this.playback };
          this.stopPlayingContinuation(playing, d.source);
          this.callStack.splice(0, this.callStack.length, { programId: playing.nextProgramId, pc: playing.nextPc });
        } else {
          this.callStack.splice(0, this.callStack.length, { programId: this.programId, pc: this.pc });
        }
        this.tryTransfer(av, 0, d.source);
        return;
      }
      case "RESUME": {
        const frame = this.callStack.pop();
        if (!frame) {
          if (!this.replayParkedPlayback()) this.noteIgnoredInstruction("HDMV_RESUME_WITHOUT_CALL", "RESUME has no saved call context", d.source);
          return;
        }
        this.restoreCallPsrState(); this.programId = frame.programId; this.pc = frame.pc;
        if (this.suspendedPlaylistContinuation) { this.replayParkedPlayback(); return; }
        return;
      }
      case "JUMP_TITLE": {
        if (!this.tryValidateTitle(av, d.source)) return;
        if (this.hasPlaylistContinuation()) this.stopPlayingContinuation(this.continuation!, d.source);
        this.callStack.length = 0;
        this.suspendedPlaylistContinuation = null;
        this.suspendedPlaylistPlayback = null;
        this.resetCallPsrBackup();
        this.emit("TITLE_SEARCH", { title: av }, d.source);
        // libbluray returns the title event from the VM run. Suspend here so
        // the next instruction cannot execute before title selection. A VM
        // without a title table still stops; selectTitle() reports the
        // unresolved table and releases the transition.
        this.status = "suspended";
        this.titleTransition = true;
        return;
      }
      case "CALL_TITLE": {
        if (!this.entries) { this.unsupportedOperation("HDMV_UNVERIFIED_OPCODE", "CALL_TITLE requires a known HDMV title table", d.source); return; }
        if (!this.tryValidateTitle(av, d.source)) return;
        const entry = av === 0 ? this.entries.find((item) => item.kind === "topMenu")
          : av === 0xffff ? this.entries.find((item) => item.kind === "firstPlay")
            : this.entries.filter((item) => item.kind === "title")[av - 1];
        if (!entry) { this.noteIgnoredInstruction("HDMV_INVALID_TARGET", `CALL_TITLE target ${av} has no index entry`, d.source); return; }
        if (entry.target.objectType === "BDJ") { this.unsupportedOperation("HDMV_UNVERIFIED_OPCODE", `CALL_TITLE target ${av} resolves to unsupported BD-J`, d.source); return; }
        if (entry.target.objectType !== "HDMV" || typeof entry.target.target !== "number") { this.noteIgnoredInstruction("HDMV_INVALID_TARGET", `CALL_TITLE target ${av} has no resolved HDMV object target`, d.source); return; }
        if (!this.programs.has(entry.target.target)) { this.noteIgnoredInstruction("HDMV_INVALID_TARGET", `CALL_TITLE target object ${entry.target.target} does not exist`, d.source); return; }
        if (this.opts.maxCallDepth < 1) throw new RegisterFault("VM_CALL_DEPTH_LIMIT", `Call depth exceeds ${this.opts.maxCallDepth}`);
        this.saveCallPsrState();
        const playing = context === "ig_object" && this.hasPlaylistContinuation() ? this.continuation : null;
        if (playing) {
          this.suspendedPlaylistContinuation = playing;
          this.suspendedPlaylistPlayback = { ...this.playback };
          this.stopPlayingContinuation(playing, d.source);
          this.callStack.splice(0, this.callStack.length, { programId: playing.nextProgramId, pc: playing.nextPc });
        } else {
          this.callStack.splice(0, this.callStack.length, { programId: this.programId, pc: this.pc });
        }
        // A title call suspends this object while the player resolves and starts
        // the title. The title event bridge re-enters through selectTitle().
        this.pendingTitleCall = av;
        this.status = "suspended";
        this.emit("TITLE_SEARCH", { title: av }, d.source);
        return;
      }
      case "PLAY_PL": if (context !== "object") { this.noteInstructionDiagnostic(op, context, d.source); return; } this.actionAndSuspend("PLAY_PLAYLIST", { playlist: av }, d.source); return;
      case "PLAY_PL_PI": if (context !== "object") { this.noteInstructionDiagnostic(op, context, d.source); return; } this.actionAndSuspend("PLAY_PLAYLIST_ITEM", { playlist: av, playItem: bv }, d.source); return;
      case "PLAY_PL_PM": if (context !== "object") { this.noteInstructionDiagnostic(op, context, d.source); return; } this.actionAndSuspend("PLAY_PLAYLIST_MARK", { playlist: av, playMark: bv }, d.source); return;
      case "LINK_PI": if (context !== "ig_object") { this.noteInstructionDiagnostic(op, context, d.source); return; } this.emit("LINK_PLAY_ITEM", { playItem: av }, d.source); return;
      case "LINK_MK": if (context !== "ig_object") { this.noteInstructionDiagnostic(op, context, d.source); return; } this.emit("LINK_PLAY_MARK", { playMark: av }, d.source); return;
      case "TERMINATE_PL": {
        if (context !== "ig_object") { this.noteInstructionDiagnostic(op, context, d.source); return; }
        if (this.hasPlaylistContinuation()) this.resumeMovieObjectAfterPlaylistStop(d.source);
        else this.emit("PLAY_STOP", {}, d.source);
        return true;
      }
      case "SET_STREAM": {
        const destination = this.streamOperand(a, d.immOp1); const source = this.streamOperand(b, d.immOp2);
        const primaryAudioStream = destination & 0x80000000 ? (destination >>> 16) & 0x0fff : null;
        const interactiveGraphicsStream = source & 0x80000000 ? (source >>> 16) & 0xff : null;
        const angle = source & 0x8000 ? source & 0xff : null;
        if (primaryAudioStream !== null) this.registers.systemWrite(1, primaryAudioStream);
        if (interactiveGraphicsStream !== null) this.registers.systemWrite(0, interactiveGraphicsStream);
        if (angle !== null) this.registers.systemWrite(3, angle);
        const currentPg = this.registers.read({ kind: "psr", index: 2 });
        const pgSubtitleStream = destination & 0x8000 ? destination & 0x0fff : null;
        const pgSubtitleDisplay = (destination & 0x4000) !== 0;
        const nextPg = ((pgSubtitleDisplay ? 0x80000000 : 0) | (currentPg & 0x7fffffff & (pgSubtitleStream === null ? 0xffffffff : 0xfffff000)) | (pgSubtitleStream ?? 0)) >>> 0;
        this.registers.systemWrite(2, nextPg);
        this.emit("SET_STREAM", {
          destinationRaw: a?.raw ?? 0, sourceRaw: b?.raw ?? 0,
          destinationImmediate: d.immOp1, sourceImmediate: d.immOp2,
          destinationValue: destination, sourceValue: source,
          primaryAudioStream, interactiveGraphicsStream, angle, pgSubtitleStream, pgSubtitleDisplay,
        }, d.source);
        return;
      }
      case "SET_SEC_STREAM": {
        const destination = this.streamOperand(a, d.immOp1); const source = this.streamOperand(b, d.immOp2);
        let psr14 = this.registers.read({ kind: "psr", index: 14 });
        const secondaryVideoStream = destination & 0x80000000 ? destination & 0xff : null;
        const secondaryVideoSize = destination & 0x00800000 ? (destination >>> 16) & 0x0f : null;
        const secondaryAudioStream = source & 0x80000000 ? (source >>> 16) & 0xff : null;
        if (secondaryVideoStream !== null) psr14 = (secondaryVideoStream << 8) | (psr14 & 0xffff00ff);
        if (secondaryVideoSize !== null) psr14 = (secondaryVideoSize << 24) | (psr14 & 0xf0ffffff);
        if (secondaryAudioStream !== null) psr14 = secondaryAudioStream | (psr14 & 0xffffff00);
        psr14 = (((destination >>> 30) & 1) << 31) | (psr14 & 0x7fffffff);
        psr14 = (((source >>> 30) & 1) << 30) | (psr14 & 0xbfffffff);
        this.registers.systemWrite(14, psr14 >>> 0);
        let psr2 = this.registers.read({ kind: "psr", index: 2 });
        const pipPgStream = source & 0x8000 ? source & 0x0fff : null;
        if (pipPgStream !== null) psr2 = (pipPgStream << 16) | (psr2 & 0xf000ffff);
        const textSubtitleFlags = (source >>> 13) & 3;
        psr2 = (textSubtitleFlags << 30) | (psr2 & 0x3fffffff);
        this.registers.systemWrite(2, psr2 >>> 0);
        this.emit("SET_SECONDARY_STREAM", {
          destinationRaw: a?.raw ?? 0, sourceRaw: b?.raw ?? 0,
          destinationImmediate: d.immOp1, sourceImmediate: d.immOp2,
          destinationValue: destination, sourceValue: source,
          secondaryVideoStream, secondaryVideoSize, secondaryAudioStream,
          displayVideo: (destination & 0x40000000) !== 0,
          displayAudio: (source & 0x40000000) !== 0,
          pipPgStream, textSubtitleFlags,
        }, d.source);
        return;
      }
      case "SET_NV_TIMER": {
        const objectId = av & 0xffff; const timeout = bv & 0xffff;
        if (timeout === 0) { this.registers.systemWrite(9, 0); return; }
        if (timeout > 300 || !this.programs.has(objectId)) return;
        // libbluray records the requested timeout in PSR9 but leaves timer expiry disabled.
        this.registers.systemWrite(9, timeout);
        return;
      }
      case "SET_BUTTON_PAGE": return this.setButtonPage(av, bv, d.source, context);
      case "ENABLE_BUTTON": if (context === "ig_object") this.emit("ENABLE_BUTTON", { button: av }, d.source); else this.noteInstructionDiagnostic(op, context, d.source); return;
      case "DISABLE_BUTTON": if (context === "ig_object") this.emit("DISABLE_BUTTON", { button: av }, d.source); else this.noteInstructionDiagnostic(op, context, d.source); return;
      case "POPUP_OFF": if (context === "ig_object") this.emit("POPUP_OFF", {}, d.source); else this.noteInstructionDiagnostic(op, context, d.source); return;
      case "STILL_ON": if (context === "ig_object") this.emit("STILL_ON", {}, d.source); else this.noteInstructionDiagnostic(op, context, d.source); return;
      case "STILL_OFF": if (context === "ig_object") this.emit("STILL_OFF", {}, d.source); else this.noteInstructionDiagnostic(op, context, d.source); return;
      case "SET_OUTPUT_MODE": {
        if ((this.registers.read({ kind: "psr", index: 31 }) & 0x00130240) !== 0x00130240) return;
        const current = this.registers.read({ kind: "psr", index: 22 });
        this.registers.systemWrite(22, (av & 1) ? current | 1 : current & ~1);
        return;
      }
      case "SET_STREAM_SS": {
        if ((this.registers.read({ kind: "psr", index: 22 }) & 1) === 0) return;
        this.noteInstructionDiagnostic(op, context, d.source, "3D subtitle alignment is unimplemented by pinned libbluray", "HDMV_3D_SUBTITLE_ALIGNMENT_UNIMPLEMENTED");
        return;
      }
      case "SETSYSTEM_0x10": this.registers.systemWrite(103, av); return;
      default: throw new RegisterFault("HDMV_UNVERIFIED_OPCODE", `${op} is decoded but is outside the executable subset`);
    }
  }
  private value(op: Operand): number {
    if (op.kind === "immediate" || op.kind === "encoded") return op.value >>> 0;
    if (op.invalid) return 0; // libbluray _read_reg() returns 0 for an invalid selector.
    return this.registers.read({ kind: op.kind, index: op.value });
  }
  private streamOperand(op: Operand | null, immediate: boolean): number {
    if (!op) return 0;
    if (immediate) return op.raw >>> 0;
    // libbluray's SET_STREAM operand encodes two GPR indices and four preserved flag nibbles.
    const encoded = op.raw >>> 0;
    const flags = encoded & 0xf000f000;
    const lowRegister = encoded & 0x0fff;
    const highRegister = (encoded >>> 16) & 0x0fff;
    const lowValue = this.registers.read({ kind: "gpr", index: lowRegister }) & 0x0fff;
    const highValue = this.registers.read({ kind: "gpr", index: highRegister }) & 0x0fff;
    return (flags | lowValue | (highValue << 16)) >>> 0;
  }
  private buttonPageValue(op: Operand, immediate: boolean): number {
    if (immediate) return op.raw >>> 0;
    const flags = op.raw & 0xc0000000;
    const value = this.registers.read({ kind: "gpr", index: op.raw & 0x00000fff }) & 0x3fffffff;
    return (flags | value) >>> 0;
  }
  private setButtonPage(destination: number, source: number, location: SourceLocation, context: ButtonCommandContext): boolean {
    if (context === "ig_object") {
      const packed = ((source & 0xc0000000) | ((destination & 0x80000000) >>> 2) | ((source & 0xff) << 16) | (destination & 0xffff)) >>> 0;
      this.emit("SET_BUTTON_PAGE", { packed }, location);
      return true;
    }
    if (destination & 0x80000000) this.registers.systemWrite(10, destination & 0xffff);
    if (source & 0x80000000) this.registers.systemWrite(11, source & 0xff);
    return false;
  }
  private hasPlaylistContinuation(): boolean {
    const action = this.continuation?.action;
    return action?.waitFor === "ended" && (action.type === "PLAY_PLAYLIST" || action.type === "PLAY_PLAYLIST_ITEM" || action.type === "PLAY_PLAYLIST_MARK");
  }
  private stopPlayingContinuation(playing: Continuation, source: SourceLocation): void {
    this.removeAction(playing.action.id);
    // The response key stays unconsumed: a menu checkpoint that restores this
    // continuation remains resumable by a late MEDIA_ENDED. A response with no
    // restored continuation has no matching pending action and is ignored.
    this.continuation = null;
    this.playback = { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null };
    this.emit("PLAY_STOP", {}, source);
  }
  /** Apply bd_menu_call()/hdmv_vm_suspend_pl(): keep the playing position when the MovieObject resume-intention flag is set. */
  private suspendPlayingForMenuCall(): void {
    const playing = this.hasPlaylistContinuation() ? this.continuation : null;
    if (!playing) return;
    const playback = { ...this.playback };
    // Remove the queued request but keep the response key live so a late
    // MEDIA_ENDED can still resume a checkpoint that restores this action.
    this.removeAction(playing.action.id);
    this.continuation = null;
    this.playback = { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null };
    const program = this.programs.get(playing.nextProgramId);
    if (program?.resumeIntention === true) {
      this.saveCallPsrState();
      this.suspendedPlaylistContinuation = playing;
      this.suspendedPlaylistPlayback = playback;
      this.callStack.splice(0, this.callStack.length, { programId: playing.nextProgramId, pc: playing.nextPc });
    }
    if (this.status === "suspended") this.status = "idle";
  }
  /** Re-issue the saved playlist action with a fresh generation. */
  private replayParkedPlayback(): boolean {
    const parked = this.suspendedPlaylistContinuation;
    if (!parked) return false;
    const playback = this.suspendedPlaylistPlayback;
    this.suspendedPlaylistContinuation = null; this.suspendedPlaylistPlayback = null;
    this.playback = playback ? { ...playback } : { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null };
    const action = this.emit(parked.action.type, parked.action.payload, parked.action.source);
    const waitFor = WAIT_BY_ACTION[action.type];
    if (waitFor) {
      this.playback.status = "requested"; this.playback.pendingActionId = action.id;
      this.continuation = { action: { ...action, waitFor }, nextProgramId: parked.nextProgramId, nextPc: parked.nextPc };
      this.status = "suspended";
    } else {
      this.continuation = null; this.status = "running";
    }
    return true;
  }
  private resumeMovieObjectAfterPlaylistStop(source: SourceLocation): void {
    const pending = this.continuation;
    if (!pending || !this.hasPlaylistContinuation()) throw new RegisterFault("HDMV_INVALID_CONTINUATION", "PLAY_STOP has no playlist continuation to resume");
    // The old playlist completion must not later resume the same MovieObject twice.
    this.removeAction(pending.action.id);
    const responseKey = `${pending.action.generation}:${pending.action.id}`;
    this.consumedResponses.add(responseKey);
    this.emit("PLAY_STOP", {}, source);
    this.continuation = null;
    this.programId = pending.nextProgramId; this.pc = pending.nextPc;
    this.playback.status = "ended"; this.playback.pendingActionId = null;
    this.status = "running"; this.resumeAfterPlaylistStop = true;
  }
  private noteInstructionDiagnostic(opcode: string, context: ButtonCommandContext, source: SourceLocation, detail?: string, code = "HDMV_OPCODE_CONTEXT_SKIPPED"): void {
    const message = detail ? `${opcode} is not implemented for ${context} context: ${detail}` : `${opcode} is not valid in ${context} context`;
    this.instructionDiagnostic = { code, message, source };
    this.diagnostics.push(this.instructionDiagnostic);
  }
  /** Record a non-fatal instruction outcome; the VM continues with the next command. */
  private noteIgnoredInstruction(code: string, message: string, source: SourceLocation | null): void {
    const issue = { code, message, source };
    this.instructionDiagnostic = issue;
    this.diagnostics.push(issue);
  }
  /** Unsupported player capability: report, stop the current run, keep the VM reusable. */
  private unsupportedOperation(code: string, message: string, source: SourceLocation | null): void {
    // libbluray logs an unsupported operation in _hdmv_step and continues the
    // current object (_call_title() returns -1 for an invalid title and the
    // step loop advances); status and pending transitions stay untouched.
    const issue = { code, message, source };
    this.instructionDiagnostic = issue;
    this.diagnostics.push(issue);
    this.diagnostic = issue;
  }
  private tryValidateTitle(title: number, source: SourceLocation): boolean {
    try {
      this.validateTitleTarget(title);
      return true;
    } catch (error) {
      this.noteIgnoredInstruction(error instanceof RegisterFault ? error.code : "HDMV_INVALID_TARGET", error instanceof Error ? error.message : String(error), source);
      return false;
    }
  }
  private tryTransfer(programId: number, pc: number, source: SourceLocation): boolean {
    const target = this.programs.get(programId);
    if (!target) {
      this.noteIgnoredInstruction("HDMV_INVALID_TARGET", `Target object ${programId} does not exist`, source);
      return false;
    }
    if (!Number.isInteger(pc) || pc < 0 || pc > target.instructions.length) {
      this.noteIgnoredInstruction("HDMV_INVALID_PC", `Target PC ${pc} is invalid for object ${programId}`, source);
      return false;
    }
    this.programId = programId; this.pc = pc;
    this.record({ source, raw: null, decoded: "TRANSFER", registerDelta: EMPTY_DELTA, status: this.status });
    return true;
  }
  private applyPlaybackPsrs(payload: Record<string, number | string | boolean | null>): void {
    const playlist = typeof payload.playlist === "number" ? payload.playlist : null;
    if (playlist !== null) this.registers.systemWrite(6, playlist);
    this.registers.systemWrite(5, 0xffff);
    this.registers.systemWrite(7, typeof payload.playItem === "number" ? payload.playItem : 0);
    this.registers.systemWrite(8, 0);
  }
  private write(op: Operand, value: number): void {
    // libbluray _store_result() ignores writes to immediate or invalid
    // destinations and rejects program PSR writes without stopping the VM.
    if (op.kind !== "gpr" || op.invalid) { this.noteIgnoredInstruction("HDMV_ILLEGAL_OPERAND", `Cannot write result to ${op.kind} operand`, null); return; }
    this.registers.write({ kind: "gpr", index: op.value }, value >>> 0);
  }
  private nextRandom(range: number, source: SourceLocation): number {
    this.randomState = (this.randomState * RANDOM_MULTIPLIER + 1n) & RANDOM_MASK;
    if (range === 0) {
      this.diagnostics.push({ code: "HDMV_RND_ZERO_RANGE", message: "RND range is zero; reference behavior returns 1", source });
      return 1;
    }
    return Number((this.randomState >> 32n) & 0xffff_ffffn) % range + 1;
  }
  private skipIf(skip: boolean): void { if (skip) this.pc++; }
  private saveCallPsrState(): void {
    for (let offset = 0; offset < 5; offset += 1) this.registers.systemWrite(36 + offset, this.registers.read({ kind: "psr", index: 4 + offset }));
    for (let offset = 0; offset < 3; offset += 1) this.registers.systemWrite(42 + offset, this.registers.read({ kind: "psr", index: 10 + offset }));
  }
  private restoreCallPsrState(): void {
    for (let offset = 0; offset < 5; offset += 1) this.registers.systemWrite(4 + offset, this.registers.read({ kind: "psr", index: 36 + offset }));
    for (let offset = 0; offset < 3; offset += 1) this.registers.systemWrite(10 + offset, this.registers.read({ kind: "psr", index: 42 + offset }));
    this.resetCallPsrBackup();
  }
  private resetCallPsrBackup(): void {
    const backupDefaults = [0xffff, 0xffff, 0, 0, 0, 0xffff, 0, 0xff];
    const backupIndices = [36, 37, 38, 39, 40, 42, 43, 44];
    backupIndices.forEach((index, offset) => this.registers.systemWrite(index, backupDefaults[offset]!));
  }
  private validateTitleTarget(title: number): void {
    if (!this.entries) return; // Preserve the unresolved title-table case.
    const firstPlay = this.entries.find((entry) => entry.kind === "firstPlay")?.target;
    const topMenu = this.entries.find((entry) => entry.kind === "topMenu")?.target;
    const titleCount = this.entries.filter((entry) => entry.kind === "title").length;
    const specialEntryAvailable = (target: typeof firstPlay): boolean => target?.objectType === "HDMV"
      ? typeof target.target === "number" && target.target !== 0xffff
      : target?.objectType === "BDJ" && typeof target.target === "string" && /^\d{5}(?:\.bdjo)?$/i.test(target.target);
    const valid = title === 0
      ? specialEntryAvailable(topMenu)
      : title === 0xffff
        ? specialEntryAvailable(firstPlay)
        : title > 0 && title <= titleCount;
    if (!valid) throw new RegisterFault("HDMV_INVALID_TARGET", `Title target ${title} is not present in the supplied ParsedDisc entries`);
  }
  private validateTarget(programId: number, pc: number): void {
    const target = this.programs.get(programId); if (!target) throw new RegisterFault("HDMV_INVALID_TARGET", `Target object ${programId} does not exist`);
    if (!Number.isInteger(pc) || pc < 0 || pc > target.instructions.length) throw new RegisterFault("HDMV_INVALID_PC", `Target PC ${pc} is invalid for object ${programId}`);
  }
  private actionAndSuspend(type: ActionType, payload: Record<string, number | string | boolean | null>, source: SourceLocation): void {
    const action = this.emit(type, payload, source); const waitFor = WAIT_BY_ACTION[type];
    if (type.startsWith("PLAY_")) {
      this.applyPlaybackPsrs(payload);
      this.playback.status = "requested";
      this.playback.playlist = typeof payload.playlist === "number" ? payload.playlist : this.playback.playlist;
      this.playback.playItem = typeof payload.playItem === "number" ? payload.playItem : this.playback.playItem;
      this.playback.pendingActionId = action.id;
    }
    if (waitFor) { this.continuation = { action: { ...action, waitFor }, nextProgramId: this.programId, nextPc: this.pc }; this.status = "suspended"; }
  }
  private emit(type: ActionType, payload: Record<string, number | string | boolean | null>, source: SourceLocation): NavigationAction {
    if (this.actionQueue.length >= this.opts.maxQueueDepth) throw new RegisterFault("VM_QUEUE_LIMIT", `Pending action queue exceeds ${this.opts.maxQueueDepth}`);
    const generation = ++this.generation; const action: NavigationAction = { id: `hdmv-${generation}-${this.sequence + 1}`, type, generation, payload, source, ...(WAIT_BY_ACTION[type] ? { waitFor: WAIT_BY_ACTION[type] } : {}) };
    this.actions.push(action); this.actionQueue.push(action); this.lastAction = action; return action;
  }
  private removeAction(id: string): void { const index = this.actionQueue.findIndex((action) => action.id === id); if (index >= 0) this.actionQueue.splice(index, 1); }
  private currentSource(): SourceLocation | null { const row = this.programs.get(this.programId)?.instructions[this.pc]; if (!row) return null; try { return decodeInstruction(row).source; } catch { return null; } }
  private fail(code: string, message: string, source: SourceLocation | null, d?: DecodedInstruction, before?: ReturnType<RegisterFile["snapshot"]>, location?: { programId: number; pc: number }): void {
    if (this.continuation) this.removeAction(this.continuation.action.id);
    this.continuation = null; this.pendingTitleCall = null; this.titleTransition = false; this.suspendedPlaylistContinuation = null; this.suspendedPlaylistPlayback = null; this.playback.pendingActionId = null;
    const issue = { code, message, source }; this.diagnostic = issue; this.diagnostics.push(issue); this.status = code === "HDMV_UNVERIFIED_OPCODE" ? "idle" : "faulted";
    this.record({ ...(location ? { programId: location.programId, pc: location.pc } : {}), source, raw: d?.bytes ?? null, decoded: d ? textInstruction(d) : null, registerDelta: before ? delta(before, this.registers.snapshot()) : EMPTY_DELTA, status: this.status, diagnostic: issue });
  }
  /** Record a fault raised while executing a button (interactive composition) program. libbluray _vm_run() clears only the faulting object (p->object = NULL); the MovieObject waiting for playlist end (playing_object) and any suspended call object stay untouched, so the pending playlist end can still resume the MovieObject. */
  private failButtonProgram(code: string, message: string, source: SourceLocation | null, d?: DecodedInstruction, before?: ReturnType<RegisterFile["snapshot"]>, location?: { programId: number; pc: number }): void {
    const issue = { code, message, source };
    this.diagnostic = issue; this.diagnostics.push(issue);
    this.status = this.continuation ? "suspended" : "faulted";
    this.record({ ...(location ? { programId: location.programId, pc: location.pc } : {}), source, raw: d?.bytes ?? null, decoded: d ? textInstruction(d) : null, registerDelta: before ? delta(before, this.registers.snapshot()) : EMPTY_DELTA, status: this.status, diagnostic: issue });
  }
  private record(entry: Omit<TraceEntry, "sequence" | "generation" | "programId" | "pc" | "callDepth" | "callStack" | "playback" | "limits"> & Partial<Pick<TraceEntry, "programId" | "pc">>): void {
    const trace: TraceEntry = { sequence: ++this.sequence, generation: this.generation, programId: entry.programId ?? this.programId, pc: entry.pc ?? this.pc, source: entry.source, raw: entry.raw, decoded: entry.decoded, ...(entry.input ? { input: entry.input } : {}), ...(entry.action ? { action: entry.action } : {}), ...(entry.event ? { event: entry.event } : {}), registerDelta: entry.registerDelta, callDepth: this.callStack.length, callStack: this.callStack.map((x) => ({ ...x })), playback: { ...this.playback }, limits: this.limits, status: entry.status, ...(entry.diagnostic ? { diagnostic: entry.diagnostic } : {}) };
    this.trace.push(trace);
    try { this.onTrace?.(trace); } catch { /* Trace observers cannot change VM execution. */ }
  }
}
function playbackTicks(event: VmEvent): number | null {
  const presentationTime = event.payload?.presentationTime;
  if (typeof presentationTime === "number" && Number.isFinite(presentationTime) && presentationTime >= 0) return Math.min(0xffffffff, Math.floor(presentationTime));
  const seconds = event.payload?.mediaTimeSeconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) return Math.min(0xffffffff, Math.round(seconds * PSR_TIME_TICKS_PER_SECOND));
  return null;
}
function delta(before: ReturnType<RegisterFile["snapshot"]>, after: ReturnType<RegisterFile["snapshot"]>): TraceEntry["registerDelta"] {
  const gpr: Record<number, number> = {}, psr: Record<number, number> = {};
  before.gpr.forEach((v, i) => { if (v !== after.gpr[i]) gpr[i] = after.gpr[i]!; }); before.psr.forEach((v, i) => { if (v !== after.psr[i]) psr[i] = after.psr[i]!; }); return { gpr, psr };
}
function eventMatches(wait: WaitFor | undefined, event: MediaEventType): boolean { return wait === "started" ? event === "MEDIA_STARTED" : wait === "seeked" ? event === "MEDIA_SEEKED" : wait === "ended" ? event === "MEDIA_ENDED" : wait === "still-completed" ? event === "STILL_COMPLETED" : false; }
function comparisonSkips(opcode: string, a: number, b: number): boolean {
  switch (opcode) {
    case "BC": return (a & ~b) !== 0;
    case "EQ": return a !== b;
    case "NE": return a === b;
    case "GE": return a < b;
    case "GT": return a <= b;
    case "LE": return a > b;
    case "LT": return a >= b;
    default: return false;
  }
}
function stableProfile(profile: PlayerProfile): string {
  const normalized: Record<string, unknown> = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "capabilityValues").sort(([a], [b]) => a.localeCompare(b)));
  if (profile.capabilityValues) normalized.capabilityValues = Object.fromEntries(Object.entries(profile.capabilityValues).sort(([a], [b]) => Number(a) - Number(b)));
  return JSON.stringify(normalized);
}

function normalizeProfile(profile: PlayerProfile | undefined): PlayerProfile {
  const defaults: CorePlayerProfile = DEFAULT_PLAYER_PROFILE;
  return {
    ...defaults,
    ...profile,
    videoProfiles: [...(profile?.videoProfiles ?? defaults.videoProfiles)],
    audioProfiles: [...(profile?.audioProfiles ?? defaults.audioProfiles)],
    ...(profile?.capabilityValues ? { capabilityValues: { ...profile.capabilityValues } } : {}),
  };
}

function normalizeRandomSeed(value: number | undefined): number {
  const seed = value ?? 1;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new TypeError("randomSeed must be an unsigned 32-bit integer");
  return seed;
}

