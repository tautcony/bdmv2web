import { describe, expect, it } from "vitest";
import { HdmvVm } from "../index.js";
import { m3Fixtures } from "@bdmv2web/test-fixtures";

function command(w0: number, w1 = 0, w2 = 0): string {
  return [w0, w1, w2].map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

// GOTO 0 with a NOP fallthrough would end the object, so the program is a single
// self-branch that only stops when the per-turn instruction budget runs out.
const goto0 = command(0x20810000, 0, 0);

describe("HDMV VM checkpoint history", () => {
  it("shares history with a checkpoint and detaches before the next write", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5, m3Fixtures.add7, m3Fixtures.break] }]);
    vm.runTurn();
    const checkpoint = vm.saveCheckpoint();
    const entries = [...checkpoint.trace];

    expect(checkpoint.trace).toHaveLength(entries.length);
    vm.reset();
    vm.runTurn();

    expect(vm.trace.length).toBeGreaterThan(entries.length);
    expect(checkpoint.trace).toHaveLength(entries.length);
    // Entries are immutable values, so the detached checkpoint still aliases them.
    expect(checkpoint.trace[0]).toBe(entries[0]);
  });

  it("keeps the checkpoint stable when a restored VM records more history", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.move5, m3Fixtures.break] }]);
    vm.runTurn();
    const checkpoint = vm.saveCheckpoint();
    const before = checkpoint.trace.map((entry) => entry.sequence);

    vm.restoreCheckpoint(checkpoint);
    vm.runTurn();
    vm.restoreCheckpoint(checkpoint);

    expect(checkpoint.trace.map((entry) => entry.sequence)).toEqual(before);
    expect(vm.trace.map((entry) => entry.sequence)).toEqual(before);
  });

  it("restores a history longer than the engine's spread-argument limit", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [goto0] }], { maxInstructionsPerTurn: 130_000 });
    vm.runTurn();
    expect(vm.trace.length).toBeGreaterThan(130_000);
    const checkpoint = vm.saveCheckpoint();
    const length = checkpoint.trace.length;

    vm.reset();
    expect(() => vm.restoreCheckpoint(checkpoint)).not.toThrow();
    expect(vm.trace).toHaveLength(length);
    expect(checkpoint.trace).toHaveLength(length);
  });
});
