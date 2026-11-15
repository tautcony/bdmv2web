import { describe, expect, it, vi } from "vitest";
import { HdmvVm } from "@bdmv2web/hdmv";
import { m3Fixtures } from "@bdmv2web/test-fixtures";
import { LocalNavigationHost } from "./local-host.js";

describe("local navigation host", () => {
  it("keeps the synchronous VM behaviour for an offline menu", () => {
    const host = new LocalNavigationHost(new HdmvVm([{ id: 0, instructions: [] }]));
    expect(host.snapshot().status).toBe("idle");

    host.beginMenuAction();
    const result = host.executeButtonProgram([m3Fixtures.move5]);
    expect(result).toMatchObject({ status: "running" });
    expect(host.snapshot().registers.gpr[0]).toBe(5);
    expect(host.drainActions()).toEqual([]);
  });

  it("forwards menu events and context to the owned VM", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [] }]);
    const handle = vi.spyOn(vm, "handleEvent");
    const context = vi.spyOn(vm, "applyMenuContext");
    const host = new LocalNavigationHost(vm);

    host.handleEvent({ type: "TOP_MENU" });
    host.applyMenuContext(3, 7);

    expect(handle).toHaveBeenCalledWith({ type: "TOP_MENU" });
    expect(context).toHaveBeenCalledWith(3, 7);
  });
});
