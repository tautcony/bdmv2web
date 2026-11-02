import { describe, expect, it } from "vitest";
import { buildNavigationGraph, decodeInstruction, disassemble, HdmvVm, m3Fixtures, M3_FIXTURE_IDS, RegisterFile } from "./index.js";

describe("M3 HDMV fixtures", () => {
  it("decodes the shared 12-byte MOBJ/button representation and preserves source/raw", () => {
    const decoded = decodeInstruction(m3Fixtures.move5);
    expect(decoded.bytes).toBe(m3Fixtures.move5.bytes); expect(decoded.words).toEqual(m3Fixtures.move5.words);
    expect(decoded.source).toEqual(m3Fixtures.move5.source); expect(decoded.opcode).toBe("MOVE");
    expect(disassemble(m3Fixtures.move5)).toBe("MOVE GPR[0], IMMEDIATE[5]");
    expect(decodeInstruction(Uint8Array.from(m3Fixtures.move5.bytes.match(/../g)!, (x) => Number.parseInt(x, 16)), m3Fixtures.move5.source)).toEqual(decoded);
    const buttonSource = { ...m3Fixtures.move5.source, path: "M3-test/button.bin", offset: "256" };
    const buttonDecoded = decodeInstruction({ ...m3Fixtures.move5, source: buttonSource });
    expect(buttonDecoded.opcode).toBe(decoded.opcode); expect(buttonDecoded.operands).toEqual(decoded.operands); expect(buttonDecoded.source).toEqual(buttonSource);
  });
  it("runs uint32 register arithmetic and records deltas", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5, m3Fixtures.add7, m3Fixtures.break] }]);
    const state = vm.runTurn(); expect(state.registers.gpr[0]).toBe(12); expect(state.status).toBe("stopped");
    expect(vm.trace.flatMap((x) => Object.entries(x.registerDelta.gpr))).toContainEqual(["0", 12]);
    expect(vm.trace.find((x) => x.decoded?.startsWith("MOVE"))?.pc).toBe(0);
  });
  it("applies compare semantics to the next command only", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5, m3Fixtures.compareEq7, m3Fixtures.move5, m3Fixtures.break] }]);
    const state = vm.runTurn(); expect(state.registers.gpr[0]).toBe(5); expect(state.pc).toBe(4);
    const trueCompare = new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5, { ...m3Fixtures.compareEq7, words: [m3Fixtures.compareEq7.words[0], 0, 5], bytes: [m3Fixtures.compareEq7.words[0], 0, 5].map((x) => x.toString(16).padStart(8, "0")).join("") }, m3Fixtures.add7, m3Fixtures.break] }]);
    expect(trueCompare.runTurn().registers.gpr[0]).toBe(12);
  });
  it("restores the saved object and PC for object call/resume", () => {
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.callObject1, m3Fixtures.move5, m3Fixtures.break] },
      { id: 1, instructions: [m3Fixtures.add7, m3Fixtures.resume] },
    ]);
    const state = vm.runTurn(); expect(state.registers.gpr[0]).toBe(5); expect(state.programId).toBe(0); expect(state.status).toBe("stopped");
  });
  it("suspends on playlist action and resumes once on its matching started response", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }]);
    expect(vm.runTurn().status).toBe("suspended");
    const action = vm.actions[0]!; expect(action.waitFor).toBe("started");
    expect(vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id }).status).toBe("stopped");
    expect(vm.trace.filter((x) => x.event?.type === "MEDIA_STARTED")).toHaveLength(1);
    expect(vm.trace.find((x) => x.action?.id === action.id)?.action?.waitFor).toBe("started");
    vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id });
    expect(vm.trace.at(-1)?.diagnostic?.code).toBe("HDMV_EVENT_AFTER_TERMINAL");
  });
  it("faults unknown opcodes with raw/source evidence and bounds loops", () => {
    const unknownVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.unknown] }]);
    expect(unknownVm.runTurn().diagnostic?.code).toBe("HDMV_UNKNOWN_OPCODE");
    expect(unknownVm.trace.at(-1)?.raw).toBe(m3Fixtures.unknown.bytes);
    const loopVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.goto0] }], { maxInstructionsPerTurn: 4 });
    expect(loopVm.runTurn().diagnostic?.code).toBe("VM_EXECUTION_LIMIT");
  });
  it("rejects nonzero reserved bits and program writes to PSRs", () => {
    const reserved = Uint8Array.from(m3Fixtures.move5.bytes.match(/../g)!, (x) => Number.parseInt(x, 16)); reserved[2] = reserved[2]! | 0x10;
    expect(decodeInstruction(reserved, m3Fixtures.move5.source).issues).toContain("HDMV_RESERVED_BITS_NONZERO");
    const words: [number, number, number] = [m3Fixtures.move5.words[0], 0x80000004, 5]; const bytes = words.map((x) => x.toString(16).padStart(8, "0")).join("");
    const vm = new HdmvVm([{ id: 0, instructions: [{ words, bytes, source: m3Fixtures.move5.source }] }]);
    expect(vm.runTurn().diagnostic?.code).toBe("INVALID_REGISTER_ACCESS");
    const invalidReg = Uint8Array.from(m3Fixtures.move5.bytes.match(/../g)!, (x) => Number.parseInt(x, 16)); invalidReg.set([0, 0, 0x10, 0], 4);
    expect(decodeInstruction(invalidReg, m3Fixtures.move5.source).issues).toContain("HDMV_INVALID_REGISTER_ENCODING");
  });
  it("does not consume a continuation on a wrong event and stops on unavailable media", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }]); vm.runTurn();
    const action = vm.actions[0]!;
    vm.handleEvent({ type: "TIME_UPDATED", generation: action.generation, responseTo: action.id });
    expect(vm.snapshot().status).toBe("suspended");
    vm.handleEvent({ type: "MEDIA_UNAVAILABLE", generation: action.generation, responseTo: action.id });
    expect(vm.snapshot().status).toBe("stopped"); expect(vm.snapshot().diagnostic?.code).toBe("HDMV_MEDIA_UNAVAILABLE");
  });
  it("applies the normalized UO gate to keyboard and pointer input", () => {
    for (const channel of ["keyboard", "pointer"] as const) {
      const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
      vm.handleEvent({ type: "MENU_INPUT", input: "activate", channel, payload: { objectId: 0, uoAllowed: false } });
      expect(vm.snapshot().programId).toBe(0); expect(vm.trace.at(-1)?.diagnostic?.code).toBe("HDMV_UO_BLOCKED");
    }
  });
  it("rejects navigation input while a media continuation is suspended", () => {
    const target = { ...m3Fixtures.move5, words: [m3Fixtures.move5.words[0], 0, 9] as [number, number, number], bytes: [m3Fixtures.move5.words[0], 0, 9].map((x) => x.toString(16).padStart(8, "0")).join("") };
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] },
      { id: 1, instructions: [target, m3Fixtures.break] },
    ]);
    vm.runTurn(); const action = vm.actions[0]!; const pending = vm.snapshot();
    vm.handleEvent({ type: "MENU_INPUT", input: "activate", channel: "keyboard", payload: { objectId: 1 } });
    expect(vm.snapshot().programId).toBe(pending.programId); expect(vm.snapshot().pc).toBe(pending.pc);
    expect(vm.snapshot().waiting?.id).toBe(action.id); expect(vm.trace.at(-1)?.diagnostic?.code).toBe("HDMV_INPUT_WHILE_SUSPENDED");
    vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id });
    expect(vm.snapshot().programId).toBe(0); expect(vm.snapshot().registers.gpr[0]).toBe(0); expect(vm.snapshot().status).toBe("stopped");
  });
  it("keeps stopped and faulted VMs terminal when old events arrive", () => {
    const faulted = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.break] }], { maxQueueDepth: 1 });
    faulted.runTurn(); const oldAction = faulted.actions[0]!;
    faulted.enqueueEvent({ type: "TIME_UPDATED" }); faulted.enqueueEvent({ type: "TIME_UPDATED" });
    expect(faulted.snapshot().status).toBe("faulted"); expect(faulted.snapshot().waiting).toBeNull();
    const faultedBefore = faulted.snapshot();
    faulted.handleEvent({ type: "MEDIA_STARTED", generation: oldAction.generation, responseTo: oldAction.id });
    expect(faulted.snapshot().status).toBe("faulted"); expect(faulted.snapshot().pc).toBe(faultedBefore.pc);
    expect(faulted.snapshot().registers).toEqual(faultedBefore.registers); expect(faulted.trace.at(-1)?.diagnostic?.code).toBe("HDMV_EVENT_AFTER_TERMINAL");

    const stopped = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }, { id: 1, instructions: [m3Fixtures.break] }]);
    stopped.runTurn(); stopped.handleEvent({ type: "MENU_INPUT", payload: { objectId: 1 } });
    expect(stopped.snapshot().status).toBe("stopped"); expect(stopped.snapshot().programId).toBe(0);
  });
  it("turns invalid user targets and action queue overflow into VM diagnostics", () => {
    const badTarget = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    expect(() => badTarget.handleEvent({ type: "MENU_INPUT", payload: { objectId: 77 } })).not.toThrow();
    expect(badTarget.snapshot().status).toBe("faulted"); expect(badTarget.snapshot().diagnostic?.code).toBe("HDMV_INVALID_TARGET");
    expect(badTarget.trace.at(-1)?.event?.type).toBe("MENU_INPUT");

    const fullQueue = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }], { maxQueueDepth: 0 });
    expect(() => fullQueue.handleEvent({ type: "TOP_MENU" })).not.toThrow();
    expect(fullQueue.snapshot().status).toBe("faulted"); expect(fullQueue.snapshot().diagnostic?.code).toBe("VM_QUEUE_LIMIT");
    expect(fullQueue.trace.at(-1)?.event?.type).toBe("TOP_MENU");
  });
  it("installs continuations for menu actions that advertise started waits", () => {
    for (const [input, actionType] of [["TOP_MENU", "TOP_MENU"], ["POPUP_MENU", "MENU_CALL"]] as const) {
      const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
      expect(vm.handleEvent({ type: input }).status).toBe("suspended");
      const pending = vm.snapshot().waiting!; expect(pending.type).toBe(actionType); expect(pending.waitFor).toBe("started");
      expect(vm.handleEvent({ type: "MEDIA_STARTED", generation: pending.generation, responseTo: pending.id }).status).toBe("stopped");
      expect(vm.snapshot().waiting).toBeNull();
    }
  });
  it("uses seeked for link waits and rejects stale generations without state changes", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.linkPlayItem3, m3Fixtures.break] }]); vm.runTurn(); const action = vm.actions[0]!;
    const pc = vm.snapshot().pc;
    vm.handleEvent({ type: "MEDIA_SEEKED", generation: action.generation - 1, responseTo: action.id });
    expect(vm.snapshot().pc).toBe(pc); expect(vm.snapshot().status).toBe("suspended");
    expect(action.waitFor).toBe("seeked");
    expect(vm.handleEvent({ type: "MEDIA_SEEKED", generation: action.generation, responseTo: action.id, payload: { presentationTime: 900 } }).status).toBe("stopped");
    expect(vm.snapshot().registers.psr[8]).toBe(900);
  });
  it("waits for ended on terminate and stops with a diagnostic for media error", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.terminatePlaylist, m3Fixtures.break] }]); vm.runTurn(); const action = vm.actions[0]!;
    expect(action.waitFor).toBe("ended"); vm.handleEvent({ type: "MEDIA_ERROR", generation: action.generation, responseTo: action.id });
    expect(vm.snapshot().status).toBe("stopped"); expect(vm.snapshot().diagnostic?.code).toBe("HDMV_MEDIA_ERROR");
  });
  it("enforces register bounds and resets the player profile deterministically", () => {
    const regs = new RegisterFile({ audioLanguage: 0x656e67, region: 4, capabilityValues: { 15: 0x1234 } });
    expect(regs.read({ kind: "psr", index: 0 })).toBe(1); expect(regs.read({ kind: "psr", index: 16 })).toBe(0x656e67);
    expect(regs.read({ kind: "psr", index: 15 })).toBe(0x1234); expect(regs.read({ kind: "psr", index: 20 })).toBe(4);
    expect(() => regs.read({ kind: "gpr", index: 4096 })).toThrow(/out of range/);
    expect(() => regs.write({ kind: "gpr", index: 0 }, -1)).toThrow(/uint32/);
  });
  it("applies the observed saturation and divide-by-zero results", () => {
    const alter = (base: typeof m3Fixtures.move5, w1: number, w2: number) => {
      const words: [number, number, number] = [base.words[0], w1 >>> 0, w2 >>> 0];
      return { ...base, words, bytes: words.map((x) => x.toString(16).padStart(8, "0")).join("") };
    };
    const moveMax = alter(m3Fixtures.move5, 0, 0xffffffff); const addOne = alter(m3Fixtures.add7, 0, 1); const divZero = alter({ ...m3Fixtures.add7, words: [(m3Fixtures.add7.words[0] & 0xffffffe0) | 6, 0, 0], bytes: "" }, 0, 0);
    const vm = new HdmvVm([{ id: 0, instructions: [moveMax, addOne, divZero, m3Fixtures.break] }]);
    const state = vm.runTurn(); expect(state.registers.gpr[0]).toBe(0xffffffff);
  });
  it("limits recursive calls and queued actions independently", () => {
    const callVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.callObject1] }, { id: 1, instructions: [m3Fixtures.callObject1] }], { maxCallDepth: 1 });
    expect(callVm.runTurn().diagnostic?.code).toBe("VM_CALL_DEPTH_LIMIT");
    const queueVm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.popupOff, m3Fixtures.popupOff, m3Fixtures.popupOff] }], { maxQueueDepth: 2 });
    expect(queueVm.runTurn().diagnostic?.code).toBe("VM_QUEUE_LIMIT");
  });
  it("releases action queue budget when completed or drained actions leave the queue", () => {
    const drained = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.popupOff, m3Fixtures.break] }], { maxQueueDepth: 1 });
    drained.runTurn(); const first = drained.drainActions()[0]!;
    expect(drained.handleEvent({ type: "MEDIA_STARTED", generation: first.generation, responseTo: first.id }).status).toBe("stopped");
    expect(drained.snapshot().diagnostic).toBeNull(); expect(drained.drainActions()).toHaveLength(1);
    const completed = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42, m3Fixtures.popupOff, m3Fixtures.break] }], { maxQueueDepth: 1 });
    completed.runTurn(); const action = completed.actions[0]!;
    expect(completed.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id }).status).toBe("stopped");
    expect(completed.snapshot().diagnostic).toBeNull();
  });
  it("produces stable trace for the same profile and command input", () => {
    const create = () => new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5, m3Fixtures.break] }], { profile: { audioLanguage: 0x656e67 } });
    const a = create(); const b = create(); a.runTurn(); b.runTurn(); expect(a.trace).toEqual(b.trace);
  });
  it("keeps dynamic graph edges unresolved and unknown commands visible", () => {
    const graph = buildNavigationGraph([{ id: 0, instructions: [m3Fixtures.unknown] }]);
    expect(graph.nodes.some((x) => x.status === "unknown")).toBe(true);
    expect(graph.edges.some((x) => x.kind === "unknown" && x.resolution === "unresolved")).toBe(true);
    const raw = m3Fixtures.jumpObject1; const words: [number, number, number] = [raw.words[0] & ~0x00800000, 0, 0];
    const dynamicJump = { ...raw, words, bytes: words.map((x) => x.toString(16).padStart(8, "0")).join("") };
    const dynamic = buildNavigationGraph([{ id: 0, instructions: [dynamicJump] }]);
    expect(dynamic.edges.some((x) => x.kind === "jump" && x.resolution === "unresolved")).toBe(true);
  });
  it("adds button-like programs to the same graph analyzer and marks budget exhaustion unknown", () => {
    const object = { id: 0, instructions: [m3Fixtures.jumpObject1], resumeIntention: false, menuCallMask: false, titleSearchMask: false, source: m3Fixtures.move5.source };
    const appended = { id: 1, instructions: [m3Fixtures.break] };
    const graph = buildNavigationGraph([object], [appended], { maxStates: 1 });
    expect(graph.nodes.some((x) => x.id === "object:1")).toBe(true); expect(graph.complete).toBe(false);
    expect(graph.edges.some((x) => x.kind === "unknown" && x.resolution === "unresolved")).toBe(true);
  });
  it("publishes stable fixture identifiers for parent integration", () => { expect(M3_FIXTURE_IDS).toHaveLength(7); });
});
