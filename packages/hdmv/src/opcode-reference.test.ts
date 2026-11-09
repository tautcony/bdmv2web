import { describe, expect, it } from "vitest";
import { HdmvVm, m3Fixtures } from "./index.js";
import type { OpcodeName } from "./decode.js";

const source = m3Fixtures.move5.source;

function rawCommand(opCount: number, group: number, subGroup: number, option: number, w1 = 0, w2 = 0, immediate1 = false, immediate2 = false): string {
  const w0 = (((opCount & 7) << 29) | ((group & 3) << 27) | ((subGroup & 7) << 24)
    | (Number(immediate1) << 23) | (Number(immediate2) << 22) | ((group === 0 ? option : 0) << 16)
    | ((group === 1 ? option : 0) << 8) | (group === 2 ? option : 0)) >>> 0;
  return [w0, w1, w2].map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

function opcodeCase<Name extends OpcodeName>(opcode: Name, bytes: string) { return { opcode, bytes } as const; }
const branch = (subGroup: number, option: number, count: number, first = 0, second = 0) => rawCommand(count, 0, subGroup, option, first, second, count > 0, count > 1);
const compare = (option: number) => rawCommand(2, 1, 0, option, 1, 1, true, true);
const arithmetic = (option: number, swap = false) => rawCommand(2, 2, 0, option, 0, 1, false, !swap);
const system = (option: number, count: number) => rawCommand(count, 2, 1, option, 1, 1, count > 0, count > 1);

const OPCODE_CASES = [
  opcodeCase("NOP", branch(0, 0, 0)),
  opcodeCase("GOTO", branch(0, 1, 1, 1)),
  opcodeCase("BREAK", branch(0, 2, 0)),
  opcodeCase("JUMP_OBJECT", branch(1, 0, 1, 1)),
  opcodeCase("JUMP_TITLE", branch(1, 1, 1, 1)),
  opcodeCase("CALL_OBJECT", branch(1, 2, 1, 1)),
  opcodeCase("CALL_TITLE", branch(1, 3, 1, 1)),
  opcodeCase("RESUME", branch(1, 4, 0)),
  opcodeCase("PLAY_PL", branch(2, 0, 1, 1)),
  opcodeCase("PLAY_PL_PI", branch(2, 1, 2, 1, 2)),
  opcodeCase("PLAY_PL_PM", branch(2, 2, 2, 1, 2)),
  opcodeCase("TERMINATE_PL", branch(2, 3, 0)),
  opcodeCase("LINK_PI", branch(2, 4, 1, 1)),
  opcodeCase("LINK_MK", branch(2, 5, 1, 1)),
  opcodeCase("BC", compare(1)),
  opcodeCase("EQ", compare(2)),
  opcodeCase("NE", compare(3)),
  opcodeCase("GE", compare(4)),
  opcodeCase("GT", compare(5)),
  opcodeCase("LE", compare(6)),
  opcodeCase("LT", compare(7)),
  opcodeCase("MOVE", arithmetic(1)),
  opcodeCase("SWAP", arithmetic(2, true)),
  opcodeCase("ADD", arithmetic(3)),
  opcodeCase("SUB", arithmetic(4)),
  opcodeCase("MUL", arithmetic(5)),
  opcodeCase("DIV", arithmetic(6)),
  opcodeCase("MOD", arithmetic(7)),
  opcodeCase("RND", arithmetic(8)),
  opcodeCase("AND", arithmetic(9)),
  opcodeCase("OR", arithmetic(10)),
  opcodeCase("XOR", arithmetic(11)),
  opcodeCase("BITSET", arithmetic(12)),
  opcodeCase("BITCLR", arithmetic(13)),
  opcodeCase("SHL", arithmetic(14)),
  opcodeCase("SHR", arithmetic(15)),
  opcodeCase("SET_STREAM", system(1, 2)),
  opcodeCase("SET_NV_TIMER", system(2, 2)),
  opcodeCase("SET_BUTTON_PAGE", system(3, 2)),
  opcodeCase("ENABLE_BUTTON", system(4, 1)),
  opcodeCase("DISABLE_BUTTON", system(5, 1)),
  opcodeCase("SET_SEC_STREAM", system(6, 2)),
  opcodeCase("POPUP_OFF", system(7, 0)),
  opcodeCase("STILL_ON", system(8, 0)),
  opcodeCase("STILL_OFF", system(9, 0)),
  opcodeCase("SET_OUTPUT_MODE", system(10, 1)),
  opcodeCase("SET_STREAM_SS", system(11, 2)),
  opcodeCase("SETSYSTEM_0x10", system(0x10, 2)),
] as const;

type Assert<T extends true> = T;
export type OpcodeAuditIsExhaustive = Assert<Exclude<OpcodeName, typeof OPCODE_CASES[number]["opcode"]> extends never ? true : false>;

describe("HDMV opcode reference coverage", () => {
  it.each(OPCODE_CASES)("decodes $opcode from its reference option fields", ({ opcode, bytes }) => {
    const vm = new HdmvVm([{ id: 0, instructions: [bytes] }]);
    const state = vm.runTurn();
    expect(vm.trace.find((entry) => entry.raw === bytes)?.decoded?.split(/[ ,]/, 1)[0]).toBe(opcode);
    expect(state.diagnostic?.code).not.toBe("HDMV_UNKNOWN_OPCODE");
  });

  it("executes NOP as an empty register operation and BREAK as object termination", () => {
    const nop = rawCommand(0, 0, 0, 0);
    const nopVm = new HdmvVm([{ id: 0, instructions: [nop, m3Fixtures.move5] }]);
    const nopState = nopVm.runTurn();
    expect(nopState.registers.gpr[0]).toBe(5);
    expect(nopVm.trace.find((entry) => entry.raw === nop)).toMatchObject({ pc: 0, registerDelta: { gpr: {}, psr: {} }, status: "running" });
    expect(nopVm.trace.find((entry) => entry.raw === m3Fixtures.move5.bytes)?.pc).toBe(1);

    const brk = rawCommand(0, 0, 0, 2);
    const breakVm = new HdmvVm([{ id: 0, instructions: [brk, m3Fixtures.move5] }]);
    const breakState = breakVm.runTurn();
    expect(breakState.status).toBe("idle"); expect(breakState.registers.gpr[0]).toBe(0);
    expect(breakVm.trace.find((entry) => entry.raw === brk)).toMatchObject({ pc: 0, status: "running" });
    expect(breakVm.trace.some((entry) => entry.raw === m3Fixtures.move5.bytes)).toBe(false);
  });

  it("swaps both destination registers and records both register deltas", () => {
    const swap = rawCommand(2, 2, 0, 2, 0, 1);
    const vm = new HdmvVm([{ id: 0, instructions: [swap] }]);
    vm.registers.write({ kind: "gpr", index: 0 }, 11);
    vm.registers.write({ kind: "gpr", index: 1 }, 29);
    const state = vm.runTurn();
    expect(state.registers.gpr.slice(0, 2)).toEqual([29, 11]);
    expect(vm.trace.find((entry) => entry.raw === swap)).toMatchObject({ decoded: "SWAP gpr[0],gpr[1]", registerDelta: { gpr: { 0: 29, 1: 11 }, psr: {} } });
  });
});
