import type { MovieObject, MovieInstruction, SourceLocation } from "@bdmv-web/bdmv-parser";
import { decodeInstruction, type DecodedInstruction, type Operand, type RawCommand } from "./decode.js";
import { RegisterFile, RegisterFault, type PlayerProfile, type RegisterRef } from "./registers.js";

export type VmStatus = "idle" | "running" | "suspended" | "stopped" | "faulted";
export type ActionType = "PLAY_PLAYLIST" | "PLAY_PLAYLIST_ITEM" | "PLAY_PLAYLIST_MARK" | "LINK_PLAY_ITEM" | "LINK_PLAY_MARK" | "PLAY_STOP" | "SET_STREAM" | "SET_SECONDARY_STREAM" | "SET_BUTTON_PAGE" | "ENABLE_BUTTON" | "DISABLE_BUTTON" | "POPUP_OFF" | "STILL_ON" | "STILL_OFF" | "SET_NV_TIMER" | "SET_OUTPUT_MODE" | "SET_STREAM_SS" | "TOP_MENU" | "TITLE_SEARCH" | "MENU_CALL" | "MENU_RETURN";
export type WaitFor = "started" | "seeked" | "ended" | "still-completed";
export interface NavigationAction { id: string; type: ActionType; generation: number; payload: Record<string, number | string | boolean | null>; source: SourceLocation; waitFor?: WaitFor; }
export type MediaEventType = "MEDIA_STARTED" | "MEDIA_SEEKED" | "PLAYITEM_CHANGED" | "TIME_UPDATED" | "MEDIA_ENDED" | "MEDIA_ERROR" | "MEDIA_UNAVAILABLE" | "STILL_COMPLETED" | "MENU_INPUT" | "TOP_MENU" | "POPUP_MENU" | "RETURN";
export interface VmEvent { type: MediaEventType; generation?: number; responseTo?: string; payload?: Record<string, unknown>; input?: string | number; channel?: "keyboard" | "pointer" | "system"; }
export interface VmDiagnostic { code: string; message: string; source: SourceLocation | null; }
export interface PlaybackContext { status: "idle" | "requested" | "playing" | "ended" | "error" | "unavailable"; playlist: number | null; playItem: number | null; presentationTime: number | null; pendingActionId: string | null; }
export interface TraceEntry { sequence: number; generation: number; programId: number; pc: number; source: SourceLocation | null; raw: string | null; decoded: string | null; input?: VmEvent; action?: NavigationAction; event?: VmEvent; registerDelta: { gpr: Record<number, number>; psr: Record<number, number> }; callDepth: number; callStack: Array<{ programId: number; pc: number }>; playback: PlaybackContext; status: VmStatus; diagnostic?: VmDiagnostic; }
export interface VmSnapshot { status: VmStatus; programId: number; pc: number; registers: ReturnType<RegisterFile["snapshot"]>; callStack: Array<{ programId: number; pc: number }>; playback: PlaybackContext; generation: number; waiting: NavigationAction | null; instructionsThisTurn: number; diagnostic: VmDiagnostic | null; }
export interface VmOptions { maxInstructionsPerTurn?: number; maxCallDepth?: number; maxQueueDepth?: number; profile?: PlayerProfile; }
export interface VmProgram { id: number; instructions: Array<MovieInstruction | RawCommand | Uint8Array | string>; resumeIntention?: boolean; menuCallMask?: boolean; titleSearchMask?: boolean; }
export type ButtonCommand = MovieInstruction | RawCommand | Uint8Array | string;
type Continuation = { action: NavigationAction; nextProgramId: number; nextPc: number; };
const DEFAULTS = { maxInstructionsPerTurn: 10_000, maxCallDepth: 64, maxQueueDepth: 256 };
const EMPTY_DELTA: TraceEntry["registerDelta"] = { gpr: {}, psr: {} };
const WAIT_BY_ACTION: Partial<Record<ActionType, WaitFor>> = { PLAY_PLAYLIST: "started", PLAY_PLAYLIST_ITEM: "started", PLAY_PLAYLIST_MARK: "started", LINK_PLAY_ITEM: "seeked", LINK_PLAY_MARK: "seeked", PLAY_STOP: "ended", STILL_ON: "still-completed", TITLE_SEARCH: "started", TOP_MENU: "started", MENU_CALL: "started" };

function textInstruction(d: DecodedInstruction): string { return `${d.opcode ?? "UNKNOWN"} ${d.operands.filter((x) => x !== null).map((x) => x.kind === "immediate" ? `#${x.value}` : `${x.kind}[${x.value}]`).join(",")}`.trim(); }

export class HdmvVm {
  readonly registers: RegisterFile;
  readonly trace: TraceEntry[] = [];
  readonly actions: NavigationAction[] = [];
  readonly diagnostics: VmDiagnostic[] = [];
  status: VmStatus = "idle";
  programId = 0; pc = 0; generation = 0; instructionsThisTurn = 0; diagnostic: VmDiagnostic | null = null;
  private readonly programs = new Map<number, VmProgram>(); private readonly callStack: Array<{ programId: number; pc: number }> = [];
  private continuation: Continuation | null = null; private sequence = 0; private readonly opts: typeof DEFAULTS;
  private readonly consumedResponses = new Set<string>(); private readonly eventQueue: VmEvent[] = []; private readonly actionQueue: NavigationAction[] = [];
  private profile: PlayerProfile; private lastAction: NavigationAction | undefined;
  private playback: PlaybackContext = { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null };
  constructor(programs: Array<VmProgram | MovieObject>, options: VmOptions = {}) {
    this.opts = { ...DEFAULTS, ...options }; this.profile = options.profile ?? {}; this.registers = new RegisterFile(this.profile);
    for (const p of programs) this.addProgram(p as VmProgram);
    this.record({ source: null, raw: null, decoded: `RESET profile=${stableProfile(this.profile)}`, registerDelta: EMPTY_DELTA, status: "idle" });
  }
  addProgram(program: VmProgram | MovieObject): void {
    const p = program as VmProgram;
    if (!Number.isInteger(p.id) || p.id < 0) throw new TypeError("Program id must be a non-negative integer");
    this.programs.set(p.id, { id: p.id, instructions: p.instructions, ...(p.resumeIntention !== undefined ? { resumeIntention: p.resumeIntention } : {}), ...(p.menuCallMask !== undefined ? { menuCallMask: p.menuCallMask } : {}), ...(p.titleSearchMask !== undefined ? { titleSearchMask: p.titleSearchMask } : {}) });
  }
  reset(programId = 0, profile: PlayerProfile = this.profile): void {
    this.profile = profile; this.registers.reset(profile); this.programId = programId; this.pc = 0; this.status = "idle"; this.generation++;
    this.callStack.length = 0; this.continuation = null; this.eventQueue.length = 0; this.actionQueue.length = 0; this.actions.length = 0; this.consumedResponses.clear(); this.instructionsThisTurn = 0; this.diagnostic = null; this.lastAction = undefined;
    this.playback = { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null };
    this.record({ source: null, raw: null, decoded: `RESET profile=${stableProfile(profile)}`, registerDelta: EMPTY_DELTA, status: "idle" });
  }
  snapshot(): VmSnapshot { return { status: this.status, programId: this.programId, pc: this.pc, registers: this.registers.snapshot(), callStack: this.callStack.map((x) => ({ ...x })), playback: { ...this.playback }, generation: this.generation, waiting: this.continuation?.action ?? null, instructionsThisTurn: this.instructionsThisTurn, diagnostic: this.diagnostic }; }
  /** Execute one selected button's command in the current VM register/object context. Ordinary commands leave PC unchanged; control-transfer commands use the current VM context. The button identity is not an object ID. */
  executeButtonCommand(command: ButtonCommand, source?: SourceLocation): VmSnapshot {
    if (this.status === "faulted" || this.status === "stopped" || this.status === "suspended") {
      const diagnostic = { code: this.status === "suspended" ? "HDMV_INPUT_WHILE_SUSPENDED" : "HDMV_EVENT_AFTER_TERMINAL", message: `Button command rejected while VM is ${this.status}`, source: source ?? null };
      this.record({ source: source ?? null, raw: null, decoded: null, registerDelta: EMPTY_DELTA, status: this.status, diagnostic });
      return this.snapshot();
    }
    this.instructionsThisTurn = 0;
    const before = this.registers.snapshot(); const from = { programId: this.programId, pc: this.pc };
    let d: DecodedInstruction;
    try { d = decodeInstruction(command, source); }
    catch (error) {
      this.fail("HDMV_INVALID_INSTRUCTION", error instanceof Error ? error.message : String(error), source ?? null);
      return this.snapshot();
    }
    if (d.status === "invalid" || !d.opcode) {
      this.fail(d.issues[0] ?? "HDMV_UNKNOWN_OPCODE", `Cannot execute ${d.opcode ?? "unknown encoding"}: ${d.issues.join(", ") || d.bytes}`, d.source, d, before, from);
      return this.snapshot();
    }
    const program = this.programs.get(this.programId);
    if (!program) {
      this.fail("HDMV_INVALID_TARGET", `No program/object ${this.programId}`, d.source, d, before, from);
      return this.snapshot();
    }
    if (this.instructionsThisTurn >= this.opts.maxInstructionsPerTurn) {
      this.fail("VM_EXECUTION_LIMIT", `Exceeded ${this.opts.maxInstructionsPerTurn} instructions in one turn`, d.source, d, before, from);
      return this.snapshot();
    }
    this.instructionsThisTurn++;
    if (this.status === "idle") this.status = "running";
    try { this.execute(d, program); }
    catch (error) {
      this.fail(error instanceof RegisterFault ? error.code : "HDMV_EXECUTION_FAULT", error instanceof Error ? error.message : String(error), d.source, d, before, from);
      return this.snapshot();
    }
    this.record({ programId: from.programId, pc: from.pc, source: d.source, raw: d.bytes, decoded: textInstruction(d), ...(this.lastAction ? { action: this.lastAction } : {}), registerDelta: delta(before, this.registers.snapshot()), status: this.status });
    this.lastAction = undefined;
    return this.snapshot();
  }
  runTurn(): VmSnapshot {
    if (this.status === "faulted" || this.status === "stopped" || this.status === "suspended") return this.snapshot();
    this.status = "running"; this.instructionsThisTurn = 0;
    while (this.status === "running") {
      if (this.instructionsThisTurn >= this.opts.maxInstructionsPerTurn) { this.fail("VM_EXECUTION_LIMIT", `Exceeded ${this.opts.maxInstructionsPerTurn} instructions in one turn`, this.currentSource()); break; }
      const program = this.programs.get(this.programId);
      if (!program) { this.fail("HDMV_INVALID_TARGET", `No program/object ${this.programId}`, null); break; }
      const row = program.instructions[this.pc];
      if (!row) { this.fail("HDMV_INVALID_PC", `PC ${this.pc} is outside object ${this.programId}`, program.instructions.at(-1) ? decodeInstruction(program.instructions.at(-1)!).source : null); break; }
      let d: DecodedInstruction;
      try { d = decodeInstruction(row); } catch (error) { this.fail("HDMV_INVALID_INSTRUCTION", String(error), null); break; }
      this.instructionsThisTurn++;
      const before = this.registers.snapshot(); const from = { programId: this.programId, pc: this.pc }; this.pc++;
      if (d.status === "invalid" || !d.opcode) { this.fail(d.issues[0] ?? "HDMV_UNKNOWN_OPCODE", `Cannot execute ${d.opcode ?? "unknown encoding"}: ${d.issues.join(", ") || d.bytes}`, d.source, d, before, from); break; }
      try {
        this.execute(d, program);
      } catch (error) {
        this.fail(error instanceof RegisterFault ? error.code : "HDMV_EXECUTION_FAULT", error instanceof Error ? error.message : String(error), d.source, d, before, from); break;
      }
      this.record({ programId: from.programId, pc: from.pc, source: d.source, raw: d.bytes, decoded: textInstruction(d), ...(this.lastAction ? { action: this.lastAction } : {}), registerDelta: delta(before, this.registers.snapshot()), status: this.status }); this.lastAction = undefined;
      if (this.programId !== from.programId || this.pc !== from.pc + 1) { /* control transfer recorded in resulting snapshot */ }
    }
    return this.snapshot();
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
    const pending = this.continuation; const eventKey = event.responseTo ? `${event.generation}:${event.responseTo}` : "";
    if (eventKey && this.consumedResponses.has(eventKey)) {
      this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_DUPLICATE_EVENT", message: "Response already consumed", source: null } });
      return this.snapshot();
    }
    if (!pending || event.generation !== pending.action.generation || event.responseTo !== pending.action.id) {
      this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_IGNORED_EVENT", message: !pending ? "No continuation is waiting" : "Generation or responseTo does not match current action", source: null } });
      return this.snapshot();
    }
    if (event.type === "MEDIA_ERROR" || event.type === "MEDIA_UNAVAILABLE") {
      this.consumedResponses.add(eventKey); this.removeAction(pending.action.id);
      this.playback.status = event.type === "MEDIA_ERROR" ? "error" : "unavailable"; this.playback.pendingActionId = null;
      this.continuation = null; this.status = "stopped"; this.diagnostic = { code: event.type === "MEDIA_ERROR" ? "HDMV_MEDIA_ERROR" : "HDMV_MEDIA_UNAVAILABLE", message: `Action ${pending.action.id} failed: ${event.type}`, source: pending.action.source }; this.diagnostics.push(this.diagnostic);
      this.record({ source: pending.action.source, raw: null, decoded: pending.action.type, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: this.diagnostic }); return this.snapshot();
    }
    if (!eventMatches(pending.action.waitFor, event.type)) { this.record({ source: pending.action.source, raw: null, decoded: pending.action.type, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_EVENT_NOT_READY", message: `Waiting for ${pending.action.waitFor}; received ${event.type}`, source: pending.action.source } }); return this.snapshot(); }
    this.consumedResponses.add(eventKey); this.removeAction(pending.action.id);
    const before = this.registers.snapshot(); this.continuation = null; this.programId = pending.nextProgramId; this.pc = pending.nextPc;
    if (event.type === "MEDIA_STARTED") this.playback.status = "playing";
    if (event.type === "PLAYITEM_CHANGED") { const n = Number(event.payload?.playItem); if (Number.isInteger(n) && n >= 0) { this.registers.systemWrite(7, n); this.playback.playItem = n; } this.playback.status = "playing"; }
    if (event.type === "TIME_UPDATED" || event.type === "MEDIA_SEEKED") { const n = Number(event.payload?.presentationTime); if (Number.isInteger(n) && n >= 0) { this.registers.systemWrite(8, n); this.playback.presentationTime = n; } }
    if (event.type === "MEDIA_ENDED") this.playback.status = "ended";
    this.playback.pendingActionId = null;
    this.status = "running";
    this.record({ source: pending.action.source, raw: null, decoded: pending.action.type, input: event, event, registerDelta: delta(before, this.registers.snapshot()), status: this.status });
    return this.runTurn();
  }
  private handleUserEvent(event: VmEvent): VmSnapshot {
    if (this.status === "suspended") {
      this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_INPUT_WHILE_SUSPENDED", message: "Navigation input is rejected while a correlated media continuation is pending", source: null } });
      return this.snapshot();
    }
    try {
      const program = this.programs.get(this.programId);
      if (event.type === "MENU_INPUT") {
        // MOBJ menu-call mask is a bit field in the source. Only an explicit normalized denial blocks it.
        if (event.payload?.uoAllowed === false) { this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_UO_BLOCKED", message: "User operation is prohibited by the current UO mask", source: null } }); return this.snapshot(); }
        const target = Number(event.payload?.objectId);
        if (Number.isInteger(target) && target >= 0) this.transfer(target, 0, false, null);
      } else {
        const type: ActionType = event.type === "TOP_MENU" ? "TOP_MENU" : event.type === "POPUP_MENU" ? "MENU_CALL" : "MENU_RETURN";
        const allowed = event.payload?.uoAllowed !== false && (event.type !== "TOP_MENU" || program?.titleSearchMask !== true) && (event.type !== "POPUP_MENU" || program?.menuCallMask !== true);
        if (!allowed) { this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: { code: "HDMV_UO_BLOCKED", message: `${type} is blocked by UO/mask state`, source: null } }); return this.snapshot(); }
        if (WAIT_BY_ACTION[type]) this.actionAndSuspend(type, {}, { path: "<user-event>", origin: "primary", offset: "0" });
        else this.emit(type, {}, { path: "<user-event>", origin: "primary", offset: "0" });
      }
      this.record({ source: null, raw: null, decoded: null, ...(this.lastAction ? { action: this.lastAction } : {}), input: event, event, registerDelta: EMPTY_DELTA, status: this.status }); this.lastAction = undefined; return this.snapshot();
    } catch (error) {
      const code = error instanceof RegisterFault ? error.code : "HDMV_USER_EVENT_FAULT";
      const message = error instanceof Error ? error.message : String(error);
      const issue = { code, message, source: null };
      this.fail(code, message, null);
      this.record({ source: null, raw: null, decoded: null, input: event, event, registerDelta: EMPTY_DELTA, status: this.status, diagnostic: issue });
      return this.snapshot();
    }
  }
  private execute(d: DecodedInstruction, program: VmProgram): void {
    const op = d.opcode!; const [a, b] = d.operands; const av = a ? this.value(a) : 0; const bv = b ? this.value(b) : 0;
    switch (op) {
      case "NOP": return;
      case "BREAK": this.status = "stopped"; return;
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
      case "AND": this.write(a!, av & bv); return;
      case "OR": this.write(a!, av | bv); return;
      case "XOR": this.write(a!, av ^ bv); return;
      case "BITSET": case "BITCLR": if (bv >= 32) throw new RegisterFault("HDMV_ILLEGAL_OPERAND", `Bit index ${bv} exceeds 31`); this.write(a!, op === "BITSET" ? av | (1 << bv) : av & ~(1 << bv)); return;
      case "SHL": case "SHR": if (bv >= 32) throw new RegisterFault("HDMV_ILLEGAL_OPERAND", `Shift count ${bv} exceeds 31`); this.write(a!, op === "SHL" ? av << bv : av >>> bv); return;
      case "JUMP_OBJECT": this.transfer(av, 0, false, d.source); return;
      case "CALL_OBJECT": if (this.callStack.length >= this.opts.maxCallDepth) throw new RegisterFault("VM_CALL_DEPTH_LIMIT", `Call depth exceeds ${this.opts.maxCallDepth}`); this.validateTarget(av, 0); this.callStack.push({ programId: this.programId, pc: this.pc }); this.transfer(av, 0, false, d.source); return;
      case "RESUME": { const frame = this.callStack.pop(); if (!frame) throw new RegisterFault("HDMV_RESUME_WITHOUT_CALL", "RESUME has no saved call context"); this.programId = frame.programId; this.pc = frame.pc; return; }
      case "JUMP_TITLE": this.actionAndSuspend("TITLE_SEARCH", { title: av }, d.source); return;
      case "CALL_TITLE": throw new RegisterFault("HDMV_UNVERIFIED_OPCODE", "CALL_TITLE resume context is not implemented without independent semantic evidence");
      case "PLAY_PL": this.actionAndSuspend("PLAY_PLAYLIST", { playlist: av }, d.source); return;
      case "PLAY_PL_PI": this.actionAndSuspend("PLAY_PLAYLIST_ITEM", { playlist: av, playItem: bv }, d.source); return;
      case "PLAY_PL_PM": this.actionAndSuspend("PLAY_PLAYLIST_MARK", { playlist: av, playMark: bv }, d.source); return;
      case "LINK_PI": this.actionAndSuspend("LINK_PLAY_ITEM", { playItem: av }, d.source); return;
      case "LINK_MK": this.actionAndSuspend("LINK_PLAY_MARK", { playMark: av }, d.source); return;
      case "TERMINATE_PL": this.actionAndSuspend("PLAY_STOP", {}, d.source); return;
      case "SET_STREAM": this.emit("SET_STREAM", { destinationRaw: a?.raw ?? 0, sourceRaw: b?.raw ?? 0, destinationImmediate: d.immOp1, sourceImmediate: d.immOp2 }, d.source); return;
      case "SET_SEC_STREAM": this.emit("SET_SECONDARY_STREAM", { destinationRaw: a?.raw ?? 0, sourceRaw: b?.raw ?? 0, destinationImmediate: d.immOp1, sourceImmediate: d.immOp2 }, d.source); return;
      case "SET_NV_TIMER": this.emit("SET_NV_TIMER", { object: av, timeout: bv }, d.source); return;
      case "SET_BUTTON_PAGE": this.emit("SET_BUTTON_PAGE", { destinationRaw: a?.raw ?? 0, sourceRaw: b?.raw ?? 0, destinationImmediate: d.immOp1, sourceImmediate: d.immOp2 }, d.source); return;
      case "ENABLE_BUTTON": this.emit("ENABLE_BUTTON", { button: av }, d.source); return;
      case "DISABLE_BUTTON": this.emit("DISABLE_BUTTON", { button: av }, d.source); return;
      case "POPUP_OFF": this.emit("POPUP_OFF", {}, d.source); return;
      case "STILL_ON": this.actionAndSuspend("STILL_ON", {}, d.source); return;
      case "STILL_OFF": this.emit("STILL_OFF", {}, d.source); return;
      default: throw new RegisterFault("HDMV_UNVERIFIED_OPCODE", `${op} is decoded but is outside the executable subset`);
    }
  }
  private value(op: Operand): number { return op.kind === "immediate" || op.kind === "encoded" ? op.value >>> 0 : this.registers.read({ kind: op.kind, index: op.value }); }
  private write(op: Operand, value: number): void { const ref = op.kind === "immediate" ? null : { kind: op.kind, index: op.value } as RegisterRef; if (!ref) throw new RegisterFault("HDMV_ILLEGAL_OPERAND", "Cannot write to an immediate operand"); this.registers.write(ref, value >>> 0); }
  private skipIf(skip: boolean): void { if (skip) this.pc++; }
  private transfer(programId: number, pc: number, call: boolean, source: SourceLocation | null): void {
    this.validateTarget(programId, pc);
    const target = this.programs.get(programId)!;
    if (call) this.callStack.push({ programId: this.programId, pc: this.pc }); this.programId = programId; this.pc = pc;
    if (source) this.record({ source, raw: null, decoded: "TRANSFER", registerDelta: EMPTY_DELTA, status: this.status });
  }
  private validateTarget(programId: number, pc: number): void {
    const target = this.programs.get(programId); if (!target) throw new RegisterFault("HDMV_INVALID_TARGET", `Target object ${programId} does not exist`);
    if (!Number.isInteger(pc) || pc < 0 || pc >= target.instructions.length) throw new RegisterFault("HDMV_INVALID_PC", `Target PC ${pc} is invalid for object ${programId}`);
  }
  private actionAndSuspend(type: ActionType, payload: Record<string, number | string | boolean | null>, source: SourceLocation): void {
    const action = this.emit(type, payload, source); const waitFor = WAIT_BY_ACTION[type];
    if (type.startsWith("PLAY_") || type.startsWith("LINK_")) { this.playback.status = "requested"; this.playback.playlist = typeof payload.playlist === "number" ? payload.playlist : this.playback.playlist; this.playback.playItem = typeof payload.playItem === "number" ? payload.playItem : this.playback.playItem; this.playback.pendingActionId = action.id; }
    if (type === "STILL_ON") this.playback.pendingActionId = action.id;
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
    this.continuation = null; this.playback.pendingActionId = null;
    const issue = { code, message, source }; this.diagnostic = issue; this.diagnostics.push(issue); this.status = "faulted";
    this.record({ ...(location ? { programId: location.programId, pc: location.pc } : {}), source, raw: d?.bytes ?? null, decoded: d ? textInstruction(d) : null, registerDelta: before ? delta(before, this.registers.snapshot()) : EMPTY_DELTA, status: this.status, diagnostic: issue });
  }
  private record(entry: Omit<TraceEntry, "sequence" | "generation" | "programId" | "pc" | "callDepth" | "callStack" | "playback"> & Partial<Pick<TraceEntry, "programId" | "pc">>): void {
    this.trace.push({ sequence: ++this.sequence, generation: this.generation, programId: entry.programId ?? this.programId, pc: entry.pc ?? this.pc, source: entry.source, raw: entry.raw, decoded: entry.decoded, ...(entry.input ? { input: entry.input } : {}), ...(entry.action ? { action: entry.action } : {}), ...(entry.event ? { event: entry.event } : {}), registerDelta: entry.registerDelta, callDepth: this.callStack.length, callStack: this.callStack.map((x) => ({ ...x })), playback: { ...this.playback }, status: entry.status, ...(entry.diagnostic ? { diagnostic: entry.diagnostic } : {}) });
  }
}
function delta(before: ReturnType<RegisterFile["snapshot"]>, after: ReturnType<RegisterFile["snapshot"]>): TraceEntry["registerDelta"] {
  const gpr: Record<number, number> = {}, psr: Record<number, number> = {};
  before.gpr.forEach((v, i) => { if (v !== after.gpr[i]) gpr[i] = after.gpr[i]!; }); before.psr.forEach((v, i) => { if (v !== after.psr[i]) psr[i] = after.psr[i]!; }); return { gpr, psr };
}
function eventMatches(wait: WaitFor | undefined, event: MediaEventType): boolean { return wait === "started" ? event === "MEDIA_STARTED" : wait === "seeked" ? event === "MEDIA_SEEKED" : wait === "ended" ? event === "MEDIA_ENDED" : wait === "still-completed" ? event === "STILL_COMPLETED" : false; }
function stableProfile(profile: PlayerProfile): string {
  const normalized: Record<string, unknown> = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "capabilityValues").sort(([a], [b]) => a.localeCompare(b)));
  if (profile.capabilityValues) normalized.capabilityValues = Object.fromEntries(Object.entries(profile.capabilityValues).sort(([a], [b]) => Number(a) - Number(b)));
  return JSON.stringify(normalized);
}

