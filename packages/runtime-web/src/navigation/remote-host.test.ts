import { describe, expect, it } from "vitest";
import type { HdmvUpdate, VmSnapshot } from "@bdmv2web/hdmv";
import { m3Fixtures } from "@bdmv2web/test-fixtures";
import { RemoteNavigationHost, type RemoteNavigationRequest } from "./remote-host.js";

const snapshot = {
  status: "running", programId: 7, pc: 0, registers: { gpr: [], psr: [] },
  callStack: [], playback: { status: "idle", playlist: null, playItem: null, presentationTime: null, pendingActionId: null },
  generation: 1, waiting: null, instructionsThisTurn: 1, diagnostic: null,
} as unknown as VmSnapshot;

describe("remote navigation host", () => {
  it("sends the existing request shapes and keeps the snapshot server-owned", () => {
    const sent: RemoteNavigationRequest[] = [];
    const host = new RemoteNavigationHost((request) => sent.push(request));

    expect(host.snapshot()).toBeUndefined();
    host.handleEvent({ type: "TOP_MENU" });
    host.applyMenuContext(2, 3);
    expect(host.executeButtonProgram([m3Fixtures.popupOff])).toEqual({ kind: "pending" });

    expect(sent).toEqual([
      { kind: "event", event: { type: "TOP_MENU" } },
      { kind: "context", pageId: 2, selectedButtonId: 3 },
      { kind: "button", commands: [m3Fixtures.popupOff] },
    ]);
    expect(host.snapshot()).toBeUndefined();
    expect(host.drainActions()).toEqual([]);
  });

  it("takes its snapshot from the authoritative update", () => {
    const host = new RemoteNavigationHost(() => {});
    const update: HdmvUpdate = { active: true, snapshot, actions: [{ id: "a1" } as HdmvUpdate["actions"][number]], origin: "authored" };

    host.applyUpdate(update);

    expect(host.hasSnapshot).toBe(true);
    expect(host.snapshot()).toBe(snapshot);
    expect(host.isActive).toBe(true);
    // The actions arrive with the update and apply through it.
    expect(host.drainActions()).toEqual([]);

    host.applyUpdate({ active: false, snapshot, actions: [], origin: "authored" });
    expect(host.isActive).toBe(false);
  });
});
