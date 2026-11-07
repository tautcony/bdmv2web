import { describe, expect, it } from "vitest";
import { HdmvVm, buildNavigationGraph, type NavigationAction } from "@bdmv2web/hdmv";
import { resolveExternalPlayTarget, createExternalMediaTargets, computeMediaClosure } from "@bdmv2web/media-export";
import { loadRawIgsFixture } from "./headless-navigation-fixture.js";
import { adaptIgsScene, MenuController, type MenuPage, type MenuScene } from "./index.js";

describe("Tamako current-source headless navigation", () => {
  it("executes First Play, user-visible menu routes, VM context, and feature playback with recovery", async () => {
    const fixture = await loadRawIgsFixture("tamako", "00005", 0x1400, { renderAssets: false });
    const disc = fixture.disc;
    const extraction = fixture.extraction;
    expect(fixture.packetCount).toBeGreaterThan(0);
    expect(extraction.status).toBe("complete");
    expect(extraction.diagnostics).toEqual([]);
    const extractedScene = extraction.scenes.find((scene) => scene.clipId === "00005");
    expect(extractedScene).toBeDefined();
    const fixturePacketOffset = BigInt(extractedScene!.source.packetOffset);
    const fixturePacketIndex = Number(fixturePacketOffset / 192n);
    const sourceRun = fixture.sidecar.runs.find((run) => fixturePacketIndex >= run.fixturePacketStart && fixturePacketIndex < run.fixturePacketStart + run.packetCount);
    expect(sourceRun, "scene source packet has an offset-map run").toBeDefined();
    const expectedSourceOffset = BigInt(sourceRun!.sourcePacketStart + fixturePacketIndex - sourceRun!.fixturePacketStart) * 192n + fixturePacketOffset % 192n;
    expect(fixture.sourceOffsetForFixtureOffset(fixturePacketOffset)).toBe(expectedSourceOffset);
    expect(extractedScene!.pages.some((page) => page.buttons.some((button) => button.commands.length > 0))).toBe(true);
    const menuPlaylist = disc.playlists.find((playlist) => playlist.id === "00003");
    expect(menuPlaylist, "playlist selected by First Play's Top Menu title search").toBeDefined();
    const menuClipIds = new Set(menuPlaylist!.playItems.flatMap((item) => item.streams.flatMap((stream) => {
      if (stream.codingType !== 0x91) return [];
      if (stream.streamType === 1) return [item.clipId];
      if (stream.streamType === 2 && stream.subPathId !== null && stream.subClipId !== null) {
        const linked = menuPlaylist!.subPaths[stream.subPathId]?.items[stream.subClipId];
        return linked ? [linked.clipId] : [];
      }
      return [];
    })));
    expect(menuClipIds.size, "declared IGS clips linked from Top Menu playlist items/subpaths").toBeGreaterThan(0);
    const rawScene = extraction.scenes.find((scene) => menuClipIds.has(scene.clipId));
    expect(rawScene, `IGS scene linked from playlist ${menuPlaylist!.id}; no unrelated clip fallback`).toBeDefined();
    const adapted = adaptIgsScene(rawScene!, extraction.assets, { allowMissingAssets: true });
    const scene = adapted.scene as unknown as MenuScene;
    const vmPrograms = disc.movieObjects.map(({ id, instructions, resumeIntention, menuCallMask, titleSearchMask }) => ({ id, instructions: instructions.map(({ words, bytes, source }) => ({ words, bytes, source: { path: "<MovieObject>", origin: source.origin, offset: source.offset } })), resumeIntention, menuCallMask, titleSearchMask }));
    const movieGraph = buildNavigationGraph(disc.movieObjects, [], { entries: disc.entries });
    // IGS command sourceOffset is inside the decoded ICS command records; scene.packetOffset is a transport byte offset mapped by the sparse-packet sidecar.
    const buttonGraphs = rawScene!.pages.flatMap((page) => page.buttons.filter((button) => button.commands.length).map((button, id) => buildNavigationGraph([{ id, instructions: button.commands.map((command) => {
      const bytes = Buffer.from(command.bytes);
      return { bytes: bytes.toString("hex"), words: [bytes.readUInt32BE(0), bytes.readUInt32BE(4), bytes.readUInt32BE(8)] as [number, number, number], source: { path: `BDMV/STREAM/${rawScene!.clipId}.m2ts`, origin: "primary" as const, offset: command.sourceOffset } };
    }) }])));
    const targets = createExternalMediaTargets(disc, computeMediaClosure(disc, movieGraph, buttonGraphs));
    const firstPlay = disc.entries.find((entry) => entry.kind === "firstPlay" && typeof entry.target.target === "number");
    expect(firstPlay).toBeDefined();
    type RouteStep = { page: number; button: number; via: "keyboard" | "pointer" };
    type EventRecord = { type: string; payload: Record<string, unknown>; result?: unknown; context: string };
    type ActionRecord = EventRecord;
    type BranchCheckpoint = {
      vm: ReturnType<HdmvVm["saveCheckpoint"]>;
      menu: ReturnType<MenuController["saveCheckpoint"]>;
      events: EventRecord[];
      activations: Array<{ page: number; button: number }>;
      diagnostics: string[];
      selectedTopMenu: ReturnType<HdmvVm["snapshot"]>;
      initialMenuPage: number;
      startActions: ActionRecord[];
      startFinalPage: number;
    };
    const launch = (route: RouteStep[], checkpoint?: BranchCheckpoint) => {
      const vm = new HdmvVm(vmPrograms, { entries: disc.entries });
      const events: EventRecord[] = checkpoint ? [...checkpoint.events] : [];
      const activations: Array<{ page: number; button: number }> = checkpoint ? [...checkpoint.activations] : [];
      const diagnostics: string[] = checkpoint ? [...checkpoint.diagnostics] : [];
      const dispatch = () => {
        const queue: NavigationAction[] = [...vm.drainActions()];
        for (let budget = 0; queue.length && budget < 256; budget++) {
          const action = queue.shift()!;
          const context = action.source.path.includes("STREAM/") ? "ig_object" : "object";
          if (action.type === "SET_BUTTON_PAGE" && typeof action.payload.packed === "number") menu.applySetButtonPage(action.payload.packed);
          else if ((action.type === "ENABLE_BUTTON" || action.type === "DISABLE_BUTTON") && typeof action.payload.button === "number") menu.setButtonEnabled(action.payload.button, action.type === "ENABLE_BUTTON");
          if (action.type === "TITLE_SEARCH" && typeof action.payload.title === "number") {
            const result = vm.selectTitle(action.payload.title); events.push({ type: action.type, payload: { ...action.payload }, result: { status: result.status, programId: result.programId }, context });
            if (result.diagnostic) { diagnostics.push(result.diagnostic.message); vm.recoverMenuAction(); }
          } else if (["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"].includes(action.type)) {
            if (action.type === "PLAY_PLAYLIST" && action.payload.playlist === 3) {
              // Match MenuLoopPlaybackBridge: successful menu media playback
              // acknowledges the suspended action with MEDIA_STARTED.
              vm.handleEvent({ type: "MEDIA_STARTED", generation: action.generation, responseTo: action.id });
              events.push({ type: action.type, payload: { ...action.payload }, result: { status: "menu-loop-started", playlistId: "00003" }, context });
              queue.push(...vm.drainActions());
              continue;
            }
            const result = resolveExternalPlayTarget(targets, { type: action.type, ...action.payload } as never);
            events.push({ type: action.type, payload: { ...action.payload }, result: result.status === "available" ? { status: result.status, playlistId: result.playlistId, clipId: result.item.clipId } : { status: result.status, code: result.code }, context });
            vm.releaseExternalPlayback(action);
          } else events.push({ type: action.type, payload: { ...action.payload }, context });
          queue.push(...vm.drainActions());
        }
        if (queue.length) diagnostics.push("action queue limit reached");
      };
      const menu: MenuController = new MenuController(scene, vm, { dispatchActions: dispatch, diagnostic: (message) => diagnostics.push(message), activateButton: (page, button) => activations.push({ page, button: button.id }) });
      let selectedTopMenu: ReturnType<HdmvVm["snapshot"]>;
      let initialMenuPage: number;
      let startActions: ActionRecord[];
      let startFinalPage: number;
      if (checkpoint) {
        vm.restoreCheckpoint(checkpoint.vm);
        menu.restoreCheckpoint(checkpoint.menu);
        selectedTopMenu = checkpoint.selectedTopMenu;
        initialMenuPage = checkpoint.initialMenuPage;
        startActions = [...checkpoint.startActions];
        startFinalPage = checkpoint.startFinalPage;
      } else {
        vm.reset(firstPlay!.target.target as number);
        const startup = vm.runTurn();
        if (startup.waiting) {
          const result = resolveExternalPlayTarget(targets, { type: startup.waiting.type, ...startup.waiting.payload } as never);
          events.push({ type: startup.waiting.type, payload: { ...startup.waiting.payload }, result: result.status === "available" ? { status: result.status, playlistId: result.playlistId, clipId: result.item.clipId } : { status: result.status, code: result.code }, context: "first-play" });
          vm.releaseExternalPlayback(startup.waiting);
        }
        dispatch();
        selectedTopMenu = vm.selectTitle(0); dispatch();
        initialMenuPage = menu.page.id;
        const startEventOffset = events.length;
        menu.start(); dispatch();
        startActions = events.slice(startEventOffset);
        startFinalPage = menu.page.id;
      }
      const routeErrors: string[] = [];
      for (const step of route) {
        if (menu.page.id !== step.page) { routeErrors.push(`wanted page ${step.page}, arrived at ${menu.page.id}`); break; }
        const button = menu.page.buttons.find((item) => item.id === step.button);
        if (!button || !button.enabled || !menu.isDisplayed(button)) { routeErrors.push(`page ${step.page} button ${step.button} is hidden or disabled`); break; }
        if (step.via === "pointer") {
          const bounds = button.states.selected?.bounds ?? button.states.normal?.bounds;
          if (!bounds) { routeErrors.push(`page ${step.page} button ${step.button} has no hit bounds`); break; }
          const x = bounds.x + bounds.width / 2; const y = bounds.y + bounds.height / 2;
          const hit = menu.hit(x, y);
          if (hit !== button.id) { routeErrors.push(hitEvidence(menu.page, button, bounds, hit, x, y, menu.page.buttons.filter((item) => item.enabled && menu.isDisplayed(item)))); break; }
          menu.activatePointer(x, y); dispatch();
        } else {
          for (const direction of focusPath(menu.page, menu.button?.id ?? menu.page.defaultButtonId, button.id)) menu.handle(direction);
          if (menu.page.id !== step.page && button.autoAction) {
            // Selecting an autoAction button executes it as part of the focus move.
          } else if (button.autoAction && menu.button?.id === button.id) {
            // The target's autoAction ran on focus; do not invoke it twice.
          } else if (menu.button?.id !== button.id) {
            const bounds = button.states.selected?.bounds ?? button.states.normal?.bounds;
            const x = bounds ? bounds.x + bounds.width / 2 : Number.NaN;
            const y = bounds ? bounds.y + bounds.height / 2 : Number.NaN;
            const hit = bounds ? menu.hit(x, y) : null;
            if (!bounds || hit !== button.id) { routeErrors.push(hitEvidence(menu.page, button, bounds ?? null, hit, x, y, menu.page.buttons.filter((item) => item.enabled && menu.isDisplayed(item)))); break; }
            menu.activatePointer(x, y); dispatch();
          } else { menu.handle("activate"); dispatch(); }
        }
      }
      const registers = vm.snapshot().registers;
      const visible = menu.page.buttons.filter((button) => button.enabled && menu.isDisplayed(button) && (button.states.selected?.bounds || button.states.normal?.bounds) && button.commands.length > 0);
      const nonzeroGpr = registers.gpr.flatMap((value, index) => value === 0 ? [] : [[index, value]]);
      const state = JSON.stringify({ page: menu.page.id, visible: visible.map((button) => button.id), bogs: visible.map((button) => [button.bog, button.id]), psr: [registers.psr[1], registers.psr[2], registers.psr[11]], nonzeroGpr });
      const saveCheckpoint = (): BranchCheckpoint => {
        return {
          vm: vm.saveCheckpoint(), menu: menu.saveCheckpoint(), events: [...events],
          activations: [...activations], diagnostics: [...diagnostics], selectedTopMenu,
          initialMenuPage, startActions: [...startActions], startFinalPage,
        };
      };
      return { vm, menu, events, activations, diagnostics, routeErrors, selectedTopMenu, initialMenuPage, startActions, startFinalPage, visible, state, saveCheckpoint };
    };

    const first = launch([]);
    const queued: Array<{ route: RouteStep[]; checkpoint?: BranchCheckpoint }> = [{ route: [], checkpoint: first.saveCheckpoint() }];
    const knownStates = new Set<string>();
    const tested = new Set<string>();
    const reachedPages = new Set<number>();
    const outcomes: Array<{ route: string; from: number; button: number; to: number; result: unknown; diagnostics: string[] }> = [];
    let cursor = 0;
    for (; cursor < queued.length && cursor < 64; cursor++) {
      const { route, checkpoint } = queued[cursor]!;
      const current = launch([], checkpoint);
      expect(current.routeErrors, `replay route ${JSON.stringify(route)}`).toEqual([]);
      if (knownStates.has(current.state)) continue;
      knownStates.add(current.state);
      reachedPages.add(current.initialMenuPage);
      reachedPages.add(current.menu.page.id);
      const currentCheckpoint = current.saveCheckpoint();
      for (const button of current.visible) {
        const key = `${current.state}/${button.id}`;
        if (tested.has(key)) continue;
        tested.add(key);
        const from = current.menu.page.id;
        const focus = current.menu.button?.id ?? current.menu.page.defaultButtonId;
        let via: RouteStep["via"] = "keyboard";
        try { focusPath(current.menu.page, focus, button.id); }
        catch {
          via = "pointer";
          const bounds = button.states.selected?.bounds ?? button.states.normal?.bounds;
          expect(bounds, `visible button ${from}/${button.id} has pointer bounds`).toBeDefined();
          expect(current.menu.hit(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2), `visible button ${from}/${button.id} pointer hit`).toBe(button.id);
        }
        const step = { page: from, button: button.id, via };
        const branch = launch([step], currentCheckpoint);
        if (branch.routeErrors.length) {
        outcomes.push({ route: JSON.stringify(route), from, button: button.id, to: branch.menu.page.id, result: { skipped: branch.routeErrors }, diagnostics: branch.diagnostics });
          continue;
        }
        const to = branch.menu.page.id;
        const actionResult = branch.events.slice(current.events.length).map((event) => ({ type: event.type, payload: event.payload, result: event.result }));
        const afterRegisters = branch.vm.snapshot().registers;
        outcomes.push({ route: JSON.stringify(route), from, button: button.id, to, result: { actions: actionResult, psr: { psr1: afterRegisters.psr[1], psr2: afterRegisters.psr[2], psr10: afterRegisters.psr[10], psr11: afterRegisters.psr[11] }, nonzeroGpr: afterRegisters.gpr.flatMap((value, index) => value === 0 ? [] : [[index, value]]) }, diagnostics: branch.diagnostics });
        if (branch.state !== current.state && !knownStates.has(branch.state)) queued.push({ route: [...route, step], checkpoint: branch.saveCheckpoint() });
      }
    }
    expect(first.events).toContainEqual(expect.objectContaining({ context: "first-play", type: "PLAY_PLAYLIST", payload: { playlist: 57 }, result: { status: "unavailable", code: "EXTERNAL_STREAM_MISSING" } }));
    expect(first.selectedTopMenu.waiting?.payload.playlist).toBe(3);
    const reachedPageIds = [...reachedPages].sort((a, b) => a - b);
    expect(scene.pages.map((page) => page.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(reachedPageIds).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const pageZeroButtons = scene.pages.find((page) => page.id === 0)?.buttons ?? [];
    expect(pageZeroButtons).toHaveLength(1);
    expect(pageZeroButtons[0]).toMatchObject({ id: 0, autoAction: true });
    expect(pageZeroButtons[0]!.commands.length).toBeGreaterThan(0);
    expect(first.initialMenuPage).toBe(0);
    expect(first.startFinalPage).toBe(1);
    expect(first.activations).toContainEqual({ page: 0, button: 0 });
    expect(first.startActions.some((action) => action.type === "SET_BUTTON_PAGE" && ((Number(action.payload.packed) >>> 16) & 0xff) === 1)).toBe(true);
    const pageEntries = new Set(outcomes.flatMap((outcome) => {
      const result = outcome.result as { actions?: Array<{ type: string; payload: Record<string, unknown> }> };
      return (result.actions ?? []).filter((action) => action.type === "SET_BUTTON_PAGE" && typeof action.payload.packed === "number")
        .map((action) => ((Number(action.payload.packed) >>> 16) & 0xff));
    }));
    expect(pageEntries.has(0)).toBe(false);
    for (const pageId of reachedPageIds) {
      const page = scene.pages.find((item) => item.id === pageId)!;
      const expectedControls = pageId === 0
        ? page.buttons.filter((button) => button.enabled && button.autoAction && button.commands.length > 0).map((button) => button.id).sort((a, b) => a - b)
        : page.buttons.filter((button) => button.enabled && button.commands.length > 0 && (button.states.selected?.bounds || button.states.normal?.bounds)).map((button) => button.id).sort((a, b) => a - b);
      const testedControls = [...new Set([
        ...outcomes.filter((outcome) => outcome.from === pageId).map((outcome) => outcome.button),
        ...first.activations.filter((activation) => activation.page === pageId).map((activation) => activation.button),
      ])].sort((a, b) => a - b);
      expect(testedControls, `page ${pageId} visible command button coverage`).toEqual(expectedControls);
    }
    expect(outcomes.some((outcome) => JSON.stringify(outcome.result).includes('"playlist":42'))).toBe(true);
    expect(outcomes.some((outcome) => outcome.to !== outcome.from)).toBe(true);
    expect(outcomes.every((outcome) => outcome.diagnostics.length === 0)).toBe(true);
    expect(outcomes).not.toHaveLength(0);
    expect(cursor).toBe(queued.length);
    expect(queued.length).toBeLessThanOrEqual(64);
    const gaps = outcomes.filter((outcome) => (outcome.result as { skipped?: string[] } | null)?.skipped).map(({ from, button, result }) => ({ page: from, button, detail: (result as { skipped: string[] }).skipped[0] }));
    const uniqueGaps = gaps.filter((gap, index, all) => all.findIndex((item) => item.page === gap.page && item.button === gap.button) === index);
    expect(uniqueGaps).toEqual([]);
  }, 120_000);
});

function hitEvidence(page: MenuPage, button: MenuPage["buttons"][number], bounds: { x: number; y: number; width: number; height: number } | null, hit: number | null, x: number, y: number, displayed: MenuPage["buttons"]): string {
  const overlaps = displayed.filter((item) => contains(item.states.selected?.bounds ?? item.states.normal?.bounds, x, y)).map((item) => ({ id: item.id, bog: item.bog, bounds: item.states.selected?.bounds ?? item.states.normal?.bounds }));
  return `page ${page.id} button ${button.id} is neither keyboard nor pointer reachable; target=${JSON.stringify({ bog: button.bog, neighbors: button.neighbors, bounds })}; hit=${String(hit)}; overlapping=${JSON.stringify(overlaps)}; bogDefaults=${JSON.stringify(page.bogDefaults)}`;
}

function contains(bounds: { x: number; y: number; width: number; height: number } | undefined, x: number, y: number): boolean {
  return !!bounds && x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
}

function focusPath(page: MenuPage, start: number, target: number): Array<"up" | "down" | "left" | "right"> {
  const queue: Array<{ id: number; path: Array<"up" | "down" | "left" | "right"> }> = [{ id: start, path: [] }];
  const seen = new Set([start]);
  while (queue.length) {
    const current = queue.shift()!; if (current.id === target) return current.path;
    const button = page.buttons.find((item) => item.id === current.id); if (!button) continue;
    for (const direction of ["up", "down", "left", "right"] as const) {
      const id = button.neighbors[direction];
      const candidate = page.buttons.find((item) => item.id === id);
      if (seen.has(id) || !candidate?.enabled || (candidate.autoAction && candidate.id !== target)) continue;
      seen.add(id); queue.push({ id, path: [...current.path, direction] });
    }
  }
  throw new Error(`Button ${target} is not keyboard reachable on page ${page.id}`);
}
