import { expect, it } from "vitest";
import { HdmvVm, type VmOptions } from "./vm.js";

const source = { path: "index.bdmv", origin: "primary" as const, offset: "82" };
const entries: NonNullable<VmOptions["entries"]> = [
  { id: "firstPlay:0", kind: "firstPlay", target: { objectType: "BDJ", playbackType: 2, target: "00001", source }, source },
  { id: "topMenu:0", kind: "topMenu", target: { objectType: "BDJ", playbackType: 3, target: "00001", source }, source },
];

it.each([65535, 0])("selects the BD-J special title %i and retains shared registers", (title) => {
  const vm = new HdmvVm([], { entries });
  vm.registers.write({ kind: "gpr", index: 1000 }, 13);
  const result = vm.selectBdjTitle(title);
  expect(result).toMatchObject({ status: "idle", diagnostic: null });
  expect(vm.registers.read({ kind: "psr", index: 4 })).toBe(title);
  expect(vm.registers.read({ kind: "gpr", index: 1000 })).toBe(13);
  expect(vm.trace.at(-1)?.decoded).toBe(`BDJ_TITLE_SELECTED title=${title} bdjo=00001`);
});
