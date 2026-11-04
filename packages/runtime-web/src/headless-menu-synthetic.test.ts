import { describe, expect, it } from "vitest";
import { HdmvVm } from "@bdmv-web/hdmv";
import { MenuController, type MenuButton, type MenuScene } from "./index.js";

function rawCommand(word0: number, word1 = 0, word2 = 0): string {
  return [word0, word1, word2].map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

function button(id: number, commands: string[]): MenuButton {
  return {
    id, bog: 0, enabled: true,
    neighbors: { up: id, down: id, left: Math.max(0, id - 1), right: Math.min(3, id + 1) },
    states: { normal: { bounds: { x: id * 20, y: 0, width: 16, height: 16 } }, selected: { bounds: { x: id * 20, y: 0, width: 16, height: 16 } } },
    commands: commands.map((bytes) => ({ bytes })),
  };
}

function createRig(releasePlayback = true) {
  const source = { path: "synthetic/index.bdmv", origin: "primary" as const, offset: "0" };
  const entries = [
    { id: "firstPlay:0", kind: "firstPlay" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source }, source },
    { id: "topMenu:0", kind: "topMenu" as const, target: { objectType: "HDMV" as const, playbackType: 0, target: 0, source }, source },
    ...[1, 2, 3, 4, 5].map((target, index) => ({
      id: `title:${index}`, kind: "title" as const,
      target: { objectType: "HDMV" as const, playbackType: 0, target, accessType: 0, source }, source,
    })),
  ];
  const markFromFocusedButton = [
    rawCommand(0x50000001, 12, 0x8000000a), // MOVE GPR12, PSR10
    rawCommand(0x50000001, 0x00000fff, 12), // MOVE GPR4095, GPR12
    rawCommand(0x21810000, 1), // JUMP_TITLE #1
  ];
  const dynamicTitleFromFocusedButton = [
    rawCommand(0x50000001, 12, 0x8000000a), // MOVE GPR12, PSR10
    rawCommand(0x50400003, 12, 2), // ADD GPR12, #2
    rawCommand(0x21010000, 12), // JUMP_TITLE GPR12
  ];
  const scene: MenuScene = {
    width: 100, height: 40,
    pages: [
      { id: 0, defaultButtonId: 0, buttons: [button(0, [rawCommand(0x51c00003, 0x80000000, 0x80000001)])] },
      { id: 1, defaultButtonId: 0, buttons: [
        button(0, markFromFocusedButton),
        button(1, markFromFocusedButton),
        button(2, [rawCommand(0x21870000)]), // Unknown branch option, used to exercise menu recovery.
        button(3, dynamicTitleFromFocusedButton),
      ] },
    ],
  };
  const vm = new HdmvVm([
    { id: 0, instructions: [] },
    { id: 1, instructions: [rawCommand(0x42820000, 0, 0x00000fff)] }, // PLAY_PL_PM playlist 0, GPR4095
    ...[2, 3, 4].map((id) => ({ id, instructions: [rawCommand(0x22800000, id)] })),
    { id: 5, instructions: [
      rawCommand(0x51c00003, 0x80000005, 0x80000002), // MovieObject changes PSR10/PSR11.
      rawCommand(0x22800000, 5),
    ] },
  ], { entries });
  const actions: Array<{ type: string; payload: Record<string, number | string | boolean | null> }> = [];
  const diagnostics: string[] = [];
  let controller!: MenuController;
  const dispatchActions = () => {
    const pending = [...vm.drainActions()];
    while (pending.length) {
      const action = pending.shift()!;
      actions.push({ type: action.type, payload: { ...action.payload } });
      if (action.type === "SET_BUTTON_PAGE") {
        const packed = action.payload.packed;
        if (typeof packed === "number") controller.applySetButtonPage(packed);
      } else if (action.type === "TITLE_SEARCH") {
        const title = action.payload.title;
        if (typeof title === "number") {
          const result = vm.selectTitle(title);
          if (result.diagnostic) diagnostics.push(result.diagnostic.message);
        }
      } else if (action.type.startsWith("PLAY_")) {
        if (releasePlayback) vm.releaseExternalPlayback(action);
      }
      pending.push(...vm.drainActions());
    }
  };
  controller = new MenuController(scene, vm, { dispatchActions, diagnostic: (message) => diagnostics.push(message) });
  return { controller, vm, actions, diagnostics };
}

describe("synthetic headless menu to HDMV integration", () => {
  it("carries page and selected-button PSRs across pages into chapter marks", () => {
    const { controller, vm, actions, diagnostics } = createRig();
    controller.handle("activate");
    expect(controller.page.id).toBe(1);
    expect(controller.selectedButtonId).toBe(0);
    expect(vm.snapshot().registers.psr[10]).toBe(0);
    expect(vm.snapshot().registers.psr[11]).toBe(1);

    controller.handle("activate");
    expect(actions).toContainEqual({ type: "PLAY_PLAYLIST_MARK", payload: { playlist: 0, playMark: 0 } });

    controller.handle("right");
    expect(vm.snapshot().registers.psr[10]).toBe(1);
    controller.handle("activate");
    expect(actions).toContainEqual({ type: "PLAY_PLAYLIST_MARK", payload: { playlist: 0, playMark: 1 } });
    expect(diagnostics).toEqual([]);
  });

  it("computes a dynamic title, recovers a failed button, and accepts the next action", () => {
    const { controller, vm, actions, diagnostics } = createRig();
    controller.handle("activate"); // Page 0 command transfers to Page 1.
    controller.handle("right");
    controller.handle("right");
    controller.handle("right");
    expect(controller.selectedButtonId).toBe(3);
    expect(vm.snapshot().registers.psr[10]).toBe(3);
    controller.handle("activate");
    expect(actions).toContainEqual({ type: "TITLE_SEARCH", payload: { title: 5 } });
    expect(actions).toContainEqual({ type: "PLAY_PLAYLIST", payload: { playlist: 5 } });

    controller.handle("left"); // Focus button 2, whose unknown command faults.
    expect(vm.snapshot().registers.psr[10]).toBe(2);
    controller.handle("activate");
    expect(diagnostics.some((message) => message.includes("Cannot execute"))).toBe(true);
    expect(controller.selectedButtonId).toBe(2);
    expect(vm.snapshot().registers.psr[10]).toBe(2);

    controller.handle("left");
    controller.handle("left");
    expect(controller.selectedButtonId).toBe(0);
    controller.handle("activate");
    expect(actions.filter((action) => action.type === "PLAY_PLAYLIST_MARK").at(-1)).toEqual({
      type: "PLAY_PLAYLIST_MARK", payload: { playlist: 0, playMark: 0 },
    });
  });

  it("preserves target MovieObject PSR10/11 writes after a dynamic title search", () => {
    const { controller, vm } = createRig(false);
    controller.handle("activate");
    controller.handle("right");
    controller.handle("right");
    controller.handle("right");
    controller.handle("activate");
    expect(vm.snapshot().status).toBe("suspended");
    expect(vm.snapshot().registers.psr[10]).toBe(5);
    expect(vm.snapshot().registers.psr[11]).toBe(2);
  });
});
