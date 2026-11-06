import { describe, expect, it } from "vitest";
import { buildNavigationGraph, HdmvVm, m3Fixtures } from "./index.js";

function command(w0: number, w1 = 0, w2 = 0): string {
  return [w0, w1, w2].map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

const source = m3Fixtures.break.source;
function entries(titleTarget: { objectType: "HDMV" | "BDJ" | "unknown"; target: number | string | null } = { objectType: "HDMV", target: 2 }) {
  const target = (value: typeof titleTarget) => ({ ...value, playbackType: 0, source });
  return [
    { id: "firstPlay:0", kind: "firstPlay" as const, target: target({ objectType: "HDMV", target: 0 }), source },
    { id: "topMenu:0", kind: "topMenu" as const, target: target({ objectType: "HDMV", target: 1 }), source },
    { id: "title:0", kind: "title" as const, target: target(titleTarget), source },
  ];
}

describe("HDMV control-flow boundaries", () => {
  it("executes GOTO at the encoded PC and ends the object when the destination is outside the program", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [command(0x20810000, 3), m3Fixtures.move5, m3Fixtures.add7, m3Fixtures.break] }]);
    const result = vm.runTurn();
    expect(result).toMatchObject({ status: "idle", programId: 0, pc: 4, registers: { gpr: expect.arrayContaining([0]) } });
    expect(vm.trace.find((item) => item.raw === command(0x20810000, 3))).toMatchObject({ programId: 0, pc: 0, status: "running", callStack: [] });
    expect(vm.trace.some((item) => item.decoded?.startsWith("MOVE"))).toBe(false);

    const invalid = new HdmvVm([{ id: 0, instructions: [command(0x20810000, 4), m3Fixtures.break] }]);
    expect(invalid.runTurn()).toMatchObject({ status: "idle", programId: 0, pc: 4 });
    expect(invalid.snapshot().diagnostic).toBeNull();
    expect(invalid.trace.find((item) => item.raw === command(0x20810000, 4))).toMatchObject({ pc: 0, status: "running" });
    expect(invalid.trace.at(-1)).toMatchObject({ pc: 4, raw: null, status: "idle", decoded: "PROGRAM_END" });
  });

  it("keeps the saved caller across JUMP_OBJECT and RESUME returns to the command after CALL_OBJECT", () => {
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.callObject1, m3Fixtures.add7, m3Fixtures.break] },
      { id: 1, instructions: [command(0x21800000, 2)] },
      { id: 2, instructions: [m3Fixtures.add7, m3Fixtures.resume] },
    ]);
    // Object 1 jumps to object 2 while retaining the existing saved call context.
    const state = vm.runTurn();
    expect(state).toMatchObject({ status: "idle", programId: 0, pc: 3, callStack: [], registers: { gpr: expect.arrayContaining([14]) } });
    expect(vm.trace.find((item) => item.decoded?.startsWith("CALL_OBJECT"))).toMatchObject({ pc: 0, callStack: [{ programId: 0, pc: 1 }] });
    expect(vm.trace.find((item) => item.decoded?.startsWith("JUMP_OBJECT"))).toMatchObject({ programId: 1, pc: 0, callStack: [{ programId: 0, pc: 1 }] });
    expect(vm.trace.find((item) => item.decoded?.startsWith("RESUME"))).toMatchObject({ programId: 2, pc: 1, callStack: [] });
    expect(vm.trace.find((item) => item.programId === 0 && item.decoded?.startsWith("ADD"))).toMatchObject({ programId: 0, pc: 1 });
  });

  it("uses one saved call context for nested CALL_OBJECT and ignores a resume without a saved context", () => {
    const vm = new HdmvVm([
      { id: 0, instructions: [m3Fixtures.callObject1, m3Fixtures.break] },
      { id: 1, instructions: [command(0x21820000, 2), m3Fixtures.resume] },
      { id: 2, instructions: [m3Fixtures.resume] },
    ]);
    const state = vm.runTurn();
    expect(state).toMatchObject({ status: "idle", programId: 1, pc: 2 });
    expect(state.diagnostic).toBeNull();
    expect(vm.trace.find((item) => item.decoded?.startsWith("CALL_OBJECT") && item.programId === 1)).toMatchObject({
      callStack: [{ programId: 1, pc: 1 }],
    });
    expect(vm.trace.find((item) => item.decoded?.startsWith("RESUME") && item.programId === 2)).toMatchObject({
      pc: 0, callStack: [], status: "running",
    });
    expect(vm.trace.find((entry) => entry.programId === 1 && entry.decoded === "RESUME")).toMatchObject({
      programId: 1, pc: 1, status: "running", diagnostic: { code: "HDMV_RESUME_WITHOUT_CALL" },
    });
  });

  it("preserves title sentinel boundaries and ignores an out-of-range computed title", () => {
    const sentinelEntries = entries();
    sentinelEntries[0] = { ...sentinelEntries[0]!, target: { ...sentinelEntries[0]!.target, target: 1 } };
    for (const title of [0, 0xffff] as const) {
      const vm = new HdmvVm([{ id: 0, instructions: [command(0x21810000, title), m3Fixtures.break] }, { id: 1, instructions: [m3Fixtures.break] }], { entries: sentinelEntries });
      const state = vm.runTurn();
      expect(state.status).toBe("suspended");
      expect(vm.actions).toHaveLength(1);
      expect(vm.actions[0]).toMatchObject({ type: "TITLE_SEARCH", payload: { title } });
      expect(vm.trace.find((item) => item.decoded?.startsWith("JUMP_TITLE"))).toMatchObject({ pc: 0, status: "suspended" });
      expect(vm.snapshot().callStack).toEqual([]);
      const selected = vm.selectTitle(title);
      expect(selected).toMatchObject({ status: "idle", programId: 1, pc: 1 });
    }

    const computedOutOfRange = new HdmvVm([{ id: 0, instructions: [command(0x50400001, 12, 65537), command(0x21010000, 12), m3Fixtures.break] }], { entries: entries() });
    const failed = computedOutOfRange.runTurn();
    expect(failed).toMatchObject({ status: "idle", programId: 0, pc: 3, callStack: [] });
    expect(failed.diagnostic).toBeNull();
    expect(computedOutOfRange.actions).toHaveLength(0);
    expect(computedOutOfRange.trace.find((item) => item.pc === 1 && item.decoded?.startsWith("JUMP_TITLE"))).toMatchObject({ status: "running", diagnostic: { code: "HDMV_INVALID_TARGET" } });
  });

  it("routes playlist 00000 mark 65535 without truncation and classifies BD-J title navigation as unsupported", () => {
    const mark = new HdmvVm([{ id: 0, instructions: [command(0x42c20000, 0, 0xffff)] }]);
    const waiting = mark.runTurn();
    expect(waiting).toMatchObject({ status: "suspended", programId: 0, pc: 1, waiting: { type: "PLAY_PLAYLIST_MARK", payload: { playlist: 0, playMark: 0xffff }, waitFor: "ended" } });
    expect(mark.actions[0]?.payload).toEqual({ playlist: 0, playMark: 0xffff });
    expect(mark.trace.find((item) => item.decoded?.startsWith("PLAY_PL_PM"))).toMatchObject({ pc: 0, status: "suspended", action: { type: "PLAY_PLAYLIST_MARK", payload: { playlist: 0, playMark: 0xffff } } });

    const bdjEntries = entries({ objectType: "BDJ", target: "00001" });
    const titleVm = new HdmvVm([{ id: 0, instructions: [command(0x21830000, 1), m3Fixtures.break] }], { entries: bdjEntries });
    expect(titleVm.runTurn()).toMatchObject({ status: "idle", programId: 0, pc: 1, diagnostic: { code: "HDMV_UNVERIFIED_OPCODE" } });
    expect(titleVm.actions).toHaveLength(0);
    expect(titleVm.trace.at(-1)).toMatchObject({ pc: 0, decoded: "CALL_TITLE #1", status: "idle", diagnostic: { code: "HDMV_UNVERIFIED_OPCODE" } });
    const graph = buildNavigationGraph([{ id: 0, instructions: [command(0x21830000, 1)] }], [], { entries: bdjEntries });
    expect(graph.edges).toContainEqual(expect.objectContaining({ kind: "call", to: null, resolution: "unresolved" }));
  });

  it("stops after JUMP_TITLE and does not execute the following title command", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [] }], { entries: entries() });
    vm.registers.gpr[5] = 1;
    const result = vm.executeButtonProgram([
      "484007000000000500000002", // LT GPR[5], #2
      "218100000000000000000000", // JUMP_TITLE #0
      "210100000000000500000000", // JUMP_TITLE GPR[5]
    ], "ig_object");
    expect(result.status).toBe("suspended");
    expect(result.actions.map((action) => action.type)).toEqual(["TITLE_SEARCH"]);
    expect(result.actions[0]).toMatchObject({ payload: { title: 0 } });
    expect(vm.trace.filter((entry) => entry.decoded?.startsWith("JUMP_TITLE"))).toHaveLength(1);
  });

  it("continues a button program when CALL_OBJECT targets a missing object", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    const result = vm.executeButtonProgram([command(0x21820000, 9), m3Fixtures.move5], "ig_object");
    expect(result.registers.gpr[0]).toBe(5);
    expect(result.status).not.toBe("faulted");
    expect(vm.trace.find((entry) => entry.decoded?.startsWith("CALL_OBJECT"))?.diagnostic?.code).toBe("HDMV_INVALID_TARGET");
  });

  it("emits LINK_PLAY_MARK as a non-waiting action for the maximum mark operand", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    const result = vm.executeButtonCommand(command(0x22850000, 0xffff), undefined, "ig_object");
    expect(result).toMatchObject({ status: "running", pc: 0, buttonCommandTerminated: false });
    expect(vm.actions).toHaveLength(1);
    expect(vm.actions[0]).toMatchObject({ type: "LINK_PLAY_MARK", payload: { playMark: 0xffff } });
    expect(vm.actions[0]).not.toHaveProperty("waitFor");
    expect(vm.trace.at(-1)).toMatchObject({ programId: 0, pc: 0, decoded: "LINK_MK #65535", action: { type: "LINK_PLAY_MARK" } });
  });
});
