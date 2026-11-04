import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HdmvVm } from "./vm.js";

const golden = JSON.parse(readFileSync(new URL("./fixtures/libbluray-1.5.0-source-derived-reference-golden.json", import.meta.url), "utf8")) as {
  reference: { project: string; version: string; commit: string; license: string; execution: string };
  scenarios: Array<{
    id: string;
    programs: Array<{ id: number; instructions: string[] }>;
    runs?: Array<{ id: string; initialGpr: Record<string, number>; expectedTrace: Array<Record<string, unknown>>; expectedGpr: Record<string, number>; expectedStatus: string }>;
    initialPsr?: Record<string, number>;
    expectedTrace?: Array<Record<string, unknown>>;
    expectedPsr?: Record<string, number>;
    expectedGpr?: Record<string, number>;
    expectedStatus?: string;
    expectedBeforeCompletion?: { programId: number; pc: number; status: string; waiting: Record<string, unknown> };
    startedRemainsSuspended?: boolean;
    expectedAfterCompletion?: { programId: number; pc: number; status: string; registers: { gpr: Record<string, number> }; waiting: null };
  }>;
};

function expectTraceCheckpoints(vm: HdmvVm, expected: Array<Record<string, unknown>>): void {
  const actual = vm.trace.filter((entry) => entry.raw !== null);
  expect(actual, "instruction checkpoint count").toHaveLength(expected.length);
  expected.forEach((checkpoint, index) => {
    const entry = actual[index];
    if (entry === undefined) throw new Error(`Missing instruction checkpoint ${index}`);
    expect(entry, `first differing instruction checkpoint: ${index}`).toMatchObject(checkpoint);
  });
}

describe("source-derived reference golden: pinned libbluray 1.5.0", () => {
  it("records the exact reference and labels derivation honestly", () => {
    expect(golden.reference).toMatchObject({
      project: "VideoLAN libbluray",
      version: "1.5.0",
      commit: "d75c88e54c893e5cbf4c61d356477655eb435769",
      license: "LGPL-2.1",
    });
    expect(golden.reference.execution).toMatch(/not produced by running libbluray/);
  });

  it("compares true and false Compare-next-command paths checkpoint by checkpoint", () => {
    const scenario = golden.scenarios.find((item) => item.id === "compare-eq-taken-and-not-taken")!;
    for (const run of scenario.runs!) {
      const vm = new HdmvVm(scenario.programs);
      for (const [index, value] of Object.entries(run.initialGpr)) vm.registers.write({ kind: "gpr", index: Number(index) }, value);
      const final = vm.runTurn();
      expectTraceCheckpoints(vm, run.expectedTrace);
      expect(final.status).toBe(run.expectedStatus);
      for (const [index, value] of Object.entries(run.expectedGpr)) expect(final.registers.gpr[Number(index)]).toBe(value);
    }
  });

  it("checks Call/Resume PC and PSR backup restore checkpoints", () => {
    const scenario = golden.scenarios.find((item) => item.id === "call-resume-restores-registers-and-next-pc")!;
    const vm = new HdmvVm(scenario.programs);
    for (const [index, value] of Object.entries(scenario.initialPsr!)) vm.registers.systemWrite(Number(index), value);
    const final = vm.runTurn();
    expectTraceCheckpoints(vm, scenario.expectedTrace!);
    expect(final.status).toBe(scenario.expectedStatus);
    for (const [index, value] of Object.entries(scenario.expectedGpr!)) expect(final.registers.gpr[Number(index)]).toBe(value);
    for (const [index, value] of Object.entries(scenario.expectedPsr!)) expect(final.registers.psr[Number(index)]).toBe(value);
  });

  it("checks PLAY_PL suspension, action consumption, and media completion resume", () => {
    const scenario = golden.scenarios.find((item) => item.id === "playlist-completion-restores-next-command")!;
    const vm = new HdmvVm(scenario.programs);
    const suspended = vm.runTurn();
    expect(suspended).toMatchObject(scenario.expectedBeforeCompletion!);
    expect(vm.drainActions()).toMatchObject([scenario.expectedBeforeCompletion!.waiting]);
    const action = suspended.waiting!;
    const started = vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id });
    expect(started.status).toBe(scenario.startedRemainsSuspended ? "suspended" : "running");
    const ended = vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
    expect(ended).toMatchObject(scenario.expectedAfterCompletion!);
    expect(vm.drainActions()).toEqual([]);
    expectTraceCheckpoints(vm, [
      { programId: 0, pc: 0, decoded: "PLAY_PL #42", status: "suspended" },
      { programId: 0, pc: 1, decoded: "ADD gpr[0],#1", status: "running" },
      { programId: 0, pc: 2, decoded: "BREAK", status: "stopped" },
    ]);
  });
});
