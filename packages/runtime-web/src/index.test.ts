import { describe, expect, it, vi } from "vitest";
import { HdmvVm, m3Fixtures } from "@bdmv2web/hdmv";
import { menuInteractionFixture } from "@bdmv2web/test-fixtures";
import { CanvasViewport, drawMenu, EventScheduler, installCanvasPointerInput, installKeyboardInput, MenuController, MenuLoopPlaybackBridge, MenuSoundPlayer, PreviewPlaybackBridge, type MenuScheduler, type MenuScene, type PlaybackAction, type PlaybackBridge } from "./index.js";

const bounds = (x: number) => ({ x, y: 10, width: 20, height: 20 });
function scene(): MenuScene {
  const button = (id: number, bog = 0) => ({ id, bog, enabled: true, neighbors: { up: id, down: id, left: id, right: id === 1 ? 2 : 1 }, states: { normal: { bounds: bounds(id * 30) }, selected: { bounds: bounds(id * 30), soundId: 0xff }, activated: { bounds: bounds(id * 30) } }, commands: [] });
  return { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [button(1), button(2)] }, { id: 1, defaultButtonId: 99, buttons: [button(9)] }] };
}

function maskFor(...fieldIndexes: number[]): string {
  return fieldIndexes.reduce((mask, fieldIndex) => mask | (1n << BigInt(63 - fieldIndex)), 0n).toString(10);
}

function fakeWindow(): { target: Window; emit(type: string, event: Event): void } {
  const listeners = new Map<string, Set<EventListener>>();
  const target = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (typeof listener === "function") { const set = listeners.get(type) ?? new Set<EventListener>(); set.add(listener); listeners.set(type, set); }
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) { if (typeof listener === "function") listeners.get(type)?.delete(listener); },
    devicePixelRatio: 1,
  } as unknown as Window;
  return { target, emit: (type, event) => { for (const listener of listeners.get(type) ?? []) listener(event); } };
}

function keyEvent(code: string): KeyboardEvent {
  return { code, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

class FakeAudioElement {
  src = "";
  get currentSrc(): string { return this.src; }
  duration = 109.234;
  readyState = 1;
  paused = true;
  autoSeeked = true;
  autoMetadata = true;
  failLoadForPath: string | null = null;
  loadReadyStates: number[] = [];
  listeners = new Map<string, Set<(event: Event) => void>>();
  private time = 0;
  currentTime = 0;
  readonly play = vi.fn(async () => { this.paused = false; });
  readonly pause = vi.fn(() => { this.paused = true; });
  readonly load = vi.fn(() => {
    this.loadReadyStates.push(this.readyState);
    if (this.failLoadForPath && this.src.includes(this.failLoadForPath)) this.emit("error");
    else if (this.autoMetadata) { this.readyState = Math.max(this.readyState, 1); this.emit("loadedmetadata"); }
  });

  constructor() {
    Object.defineProperty(this, "currentTime", {
      get: () => this.time,
      set: (value: number) => { this.time = value; this.readyState = 2; if (this.autoSeeked) this.emit("seeked"); },
      configurable: true,
    });
  }
  addEventListener(type: string, listener: (event: Event) => void): void { const bucket = this.listeners.get(type) ?? new Set(); bucket.add(listener); this.listeners.set(type, bucket); }
  removeEventListener(type: string, listener: (event: Event) => void): void { this.listeners.get(type)?.delete(listener); }
  emit(type: string): void { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(new Event(type)); }
}

function pointerRuntime(controller: MenuController): { move(): void; down(): void; dispose(): void } {
  const fakeWin = fakeWindow(); vi.stubGlobal("window", fakeWin.target);
  const listeners = new Map<string, EventListener>();
  const canvas = {
    addEventListener(type: string, listener: EventListener) { listeners.set(type, listener); },
    removeEventListener(type: string) { listeners.delete(type); },
    getBoundingClientRect: () => ({ left: 0, top: 0 } as DOMRect),
  } as unknown as HTMLCanvasElement;
  const viewport = { toSource: (x: number, y: number) => ({ x, y }), resize: () => {} } as unknown as CanvasViewport;
  const dispose = installCanvasPointerInput(canvas, viewport, controller, () => ({ width: 100, height: 60 }));
  const event = { clientX: 61, clientY: 15 } as PointerEvent;
  return { move: () => listeners.get("pointermove")?.(event), down: () => listeners.get("pointerdown")?.(event), dispose: () => { dispose(); vi.unstubAllGlobals(); } };
}

describe("offline menu primitives", () => {
  it("maps clicks through letterboxing and rejects the bars", () => {
    const view = new CanvasViewport(100, 50); view.scale = 2; view.offsetX = 50; view.offsetY = 0;
    const rect = { left: 0, top: 0 } as DOMRect;
    expect(view.toSource(70, 20, rect)).toEqual({ x: 10, y: 10 });
    expect(view.toSource(25, 20, rect)).toBeNull();
  });
  it("matches the source-space clipping, draw-order, and HiDPI pixel-coordinate golden", () => {
    const image = (label: string) => ({ label }) as unknown as CanvasImageSource;
    const sceneForRender: MenuScene = { width: 100, height: 50, pages: [{ id: 0, defaultButtonId: 0xffff, buttons: [
      { id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: { normal: { bounds: { x: -10, y: 0, width: 30, height: 20 }, image: image("rear") } }, commands: [] },
      { id: 2, bog: 0, enabled: true, neighbors: { up: 2, down: 2, left: 2, right: 2 }, states: { normal: { bounds: { x: 20, y: 10, width: 30, height: 20 }, image: image("middle") } }, commands: [] },
      { id: 3, bog: 0, enabled: true, neighbors: { up: 3, down: 3, left: 3, right: 3 }, states: { normal: { bounds: { x: 30, y: 10, width: 30, height: 20 }, image: image("front") } }, commands: [] },
    ] }] };
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const record = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
    const context = {
      setTransform: record("setTransform"), clearRect: record("clearRect"), save: record("save"), beginPath: record("beginPath"),
      rect: record("rect"), clip: record("clip"), drawImage: record("drawImage"), restore: record("restore"),
    } as unknown as CanvasRenderingContext2D;
    const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
    const view = new CanvasViewport(100, 50); const cssRect = { left: 0, top: 0, width: 200, height: 200 } as DOMRect;
    const expectedSourceDraws = [["rear", -10, 0, 30, 20], ["middle", 20, 10, 30, 20], ["front", 30, 10, 30, 20]];
    const expectedDpr2Pixels: Array<[string, number, number, number, number]> = [["rear", -40, 100, 120, 80], ["middle", 80, 140, 120, 80], ["front", 120, 140, 120, 80]];

    for (const dpr of [1, 2]) {
      calls.length = 0;
      view.resize(canvas, 200, 200, dpr);
      const controller = new MenuController(sceneForRender, { handleEvent: vi.fn() });
      drawMenu(context, sceneForRender, controller, view, 200, 200, dpr);
      expect([canvas.width, canvas.height]).toEqual([200 * dpr, 200 * dpr]);
      expect(calls.filter((call) => call.method === "rect").map((call) => call.args)).toEqual([[0, 0, 100, 50]]);
      expect(calls.filter((call) => call.method === "clip")).toHaveLength(1);
      const draws = calls.filter((call) => call.method === "drawImage");
      expect(draws.map(({ args }) => [(args[0] as { label: string }).label, ...args.slice(1)])).toEqual(expectedSourceDraws);
      const sourceScale = 2; const letterboxY = 50;
      const projected: Array<[string, number, number, number, number]> = draws.map(({ args }) => {
        const [x, y, width, height] = args.slice(1) as [number, number, number, number];
        return [(args[0] as { label: string }).label, x * sourceScale * dpr, (y * sourceScale + letterboxY) * dpr, width * sourceScale * dpr, height * sourceScale * dpr];
      });
      const expectedPixels = dpr === 2 ? expectedDpr2Pixels : expectedDpr2Pixels.map(([label, px, py, width, height]) => [label, px / 2, py / 2, width / 2, height / 2] as [string, number, number, number, number]);
      expect(projected).toEqual(expectedPixels);
      expect(view.toSource(30, 80, cssRect)).toEqual({ x: 15, y: 15 });
      expect(view.toSource(30, 20, cssRect)).toBeNull();
    }
  });
  it("composites menu art at native coordinates before scaling the page once", () => {
    const rear = { label: "rear" } as unknown as CanvasImageSource;
    const front = { label: "front" } as unknown as CanvasImageSource;
    const layerCalls: unknown[][] = [];
    const outputCalls: unknown[][] = [];
    const pageLayer = { width: 0, height: 0, getContext: () => layerContext } as unknown as HTMLCanvasElement;
    const layerContext = {
      setTransform: vi.fn(), clearRect: vi.fn(),
      drawImage: (...args: unknown[]) => { layerCalls.push(args); },
    } as unknown as CanvasRenderingContext2D;
    const createElement = vi.fn(() => pageLayer);
    const outputCanvas = { ownerDocument: { createElement } } as unknown as HTMLCanvasElement;
    const outputContext = {
      canvas: outputCanvas,
      setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), beginPath: vi.fn(),
      rect: vi.fn(), clip: vi.fn(), drawImage: (...args: unknown[]) => { outputCalls.push(args); }, restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const testScene: MenuScene = { width: 100, height: 50, pages: [{ id: 0, defaultButtonId: 0xffff, buttons: [
      { id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: { normal: { bounds: { x: 0, y: 0, width: 40, height: 50 }, image: rear } }, commands: [] },
      { id: 2, bog: 0, enabled: true, neighbors: { up: 2, down: 2, left: 2, right: 2 }, states: { normal: { bounds: { x: 40, y: 0, width: 60, height: 50 }, image: front } }, commands: [] },
    ] }] };
    const controller = new MenuController(testScene, { handleEvent: vi.fn() });
    drawMenu(outputContext, testScene, controller, new CanvasViewport(100, 50), 200, 100, 2);
    expect(createElement).toHaveBeenCalledOnce();
    expect(layerCalls.map(([image, ...bounds]) => [(image as { label: string }).label, ...bounds])).toEqual([
      ["rear", 0, 0, 40, 50], ["front", 40, 0, 60, 50],
    ]);
    expect(outputCalls).toEqual([[pageLayer, 0, 0, 100, 50]]);
  });
  it("keeps menu input working after an unsupported MovieObject call", () => {
    const testScene = scene();
    testScene.pages[0]!.buttons[0]!.neighbors.down = 2;
    testScene.pages[0]!.buttons[1]!.commands = [{ bytes: m3Fixtures.move5.bytes }];
    const vm = new HdmvVm([{ id: 0, instructions: ["218300000000000100000000", m3Fixtures.add7] }]);
    expect(vm.runTurn()).toMatchObject({ status: "idle", pc: 1, diagnostic: { code: "HDMV_UNVERIFIED_OPCODE" } });
    expect(vm.handleEvent({ type: "RETURN" })).toMatchObject({ status: "idle", diagnostic: { code: "HDMV_UNVERIFIED_OPCODE" } });
    expect(vm.actions.at(-1)?.type).toBe("MENU_RETURN");

    const controller = new MenuController(testScene, vm);
    controller.handle("down");
    expect(controller.button?.id).toBe(2);
    controller.handle("activate");
    expect(vm.snapshot().registers.gpr[0]).toBe(5);
    expect(vm.snapshot().status).not.toBe("faulted");
  });
  it("keeps the menu usable after an ignored invalid button target", () => {
    const testScene = scene();
    testScene.pages[0]!.buttons[0]!.neighbors.down = 2;
    testScene.pages[0]!.buttons[0]!.commands = [{ bytes: m3Fixtures.move5.bytes }, { bytes: "210000000000000000000000" }];
    testScene.pages[0]!.buttons[1]!.commands = [{ bytes: m3Fixtures.move5.bytes }];
    const vm = new HdmvVm([{ id: 0, instructions: [] }]);
    const diagnostic = vi.fn(); const controller = new MenuController(testScene, vm, { diagnostic });
    controller.handle("activate");
    expect(diagnostic).not.toHaveBeenCalled();
    expect(vm.snapshot().status).not.toBe("faulted");
    expect(vm.snapshot().registers.gpr[0]).toBe(5);
    expect(vm.trace.find((entry) => entry.decoded?.startsWith("JUMP_OBJECT"))?.diagnostic?.code).toBe("HDMV_INVALID_TARGET");
    controller.handle("down"); controller.handle("activate");
    expect(vm.snapshot().registers.gpr[0]).toBe(5);
  });
  it("does not let pointer input activate through letterbox bars", () => {
    const testScene = scene(); const controller = new MenuController(testScene, { handleEvent: vi.fn() });
    const viewport = new CanvasViewport(100, 50); const listeners = new Map<string, EventListener>();
    const canvas = {
      addEventListener(type: string, listener: EventListener) { listeners.set(type, listener); },
      removeEventListener(type: string) { listeners.delete(type); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 } as DOMRect), getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const fakeWin = fakeWindow(); vi.stubGlobal("window", fakeWin.target);
    const remove = installCanvasPointerInput(canvas, viewport, controller, () => ({ width: 200, height: 200 }));
    const pointer = (x: number, y: number) => ({ clientX: x, clientY: y } as PointerEvent);
    listeners.get("pointerdown")?.(pointer(30, 20));
    expect(controller.selectedButtonId).toBe(1); expect(controller.activatedButtonId).toBeNull();
    listeners.get("pointerdown")?.(pointer(130, 70));
    expect(controller.selectedButtonId).toBe(2); expect(controller.activatedButtonId).toBe(2);
    remove(); vi.unstubAllGlobals();
  });
  it("uses explicit neighbors, drops selection when the new page has no usable button, and applies enabled state", () => {
    const vm = new HdmvVm([{ id: 0, instructions: ["000000000000000000000000"] }]); const menu = new MenuController(scene(), vm);
    expect(menu.selectedButtonId).toBe(1); menu.handle("right"); expect(menu.selectedButtonId).toBe(2);
    menu.setButtonEnabled(2, false); expect(menu.selectedButtonId).toBeNull(); menu.setPage(1); expect(menu.selectedButtonId).toBeNull();
  });
  it("keeps PSR menu page and selected button synchronized through focus changes", () => {
    const applyMenuContext = vi.fn();
    const vm = { handleEvent: vi.fn(), applyMenuContext };
    const menu = new MenuController(scene(), vm);
    expect(applyMenuContext).toHaveBeenLastCalledWith(0, 1);
    menu.handle("right");
    expect(applyMenuContext).toHaveBeenLastCalledWith(0, 2);
    menu.setPage(1);
    expect(applyMenuContext).toHaveBeenLastCalledWith(1, null);
    menu.applySetButtonPage(0x20000009);
    expect(applyMenuContext).toHaveBeenLastCalledWith(1, 9);
    menu.applySetButtonPage(0x2000ffff);
    expect(applyMenuContext).toHaveBeenLastCalledWith(1, null);
    expect(applyMenuContext).toHaveBeenCalledTimes(5);
    applyMenuContext.mockClear();
    menu.start();
    expect(applyMenuContext).toHaveBeenCalledWith(1, null);
  });
  it("ignores same-page SET_BUTTON_PAGE requests while allowing button-only selection", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [] }]);
    const page = (id: number, defaultButtonId: number, autoActionButton = false): MenuScene["pages"][number] => ({
      id, defaultButtonId, bogDefaults: [{ bog: 0, defaultButtonId }], buttons: [
        { id: defaultButtonId, bog: 0, enabled: true, neighbors: { up: defaultButtonId, down: defaultButtonId, left: defaultButtonId, right: defaultButtonId }, states: {}, commands: [] },
        ...(autoActionButton ? [{ id: 2, bog: 0, enabled: true, autoAction: true, neighbors: { up: 2, down: 2, left: 2, right: 2 }, states: {}, commands: [{ bytes: m3Fixtures.move5.bytes }] }] : []),
      ],
    });
    const menu = new MenuController({ width: 100, height: 60, pages: [page(0, 1, true), page(1, 3)] }, vm);

    // A repeated page-only request is a no-op and must not auto-activate its default.
    menu.applySetButtonPage(0x80000000);
    expect(menu.page.id).toBe(0);
    expect(menu.button?.id).toBe(1);
    expect(vm.snapshot().registers.gpr[0]).toBe(0);

    // libbluray ignores the whole request when its page flag names the current page.
    menu.applySetButtonPage(0xa0000002);
    expect(menu.page.id).toBe(0);
    expect(menu.button?.id).toBe(1);
    expect(vm.snapshot().registers.gpr[0]).toBe(0);
    expect(vm.snapshot().registers.psr[10]).toBe(1);
    expect(vm.snapshot().registers.psr[11]).toBe(0);

    // Without a page flag the same button reference is applied and auto-activated.
    menu.applySetButtonPage(0x20000002);
    expect(menu.button?.id).toBe(2);
    expect(vm.snapshot().registers.gpr[0]).toBe(5);
    expect(vm.snapshot().registers.psr[10]).toBe(2);

    // A page+button request changes page, then selects the requested button there.
    menu.applySetButtonPage(0xa0010003);
    expect(menu.page.id).toBe(1);
    expect(menu.button?.id).toBe(3);
    expect(vm.snapshot().registers.psr[10]).toBe(3);
    expect(vm.snapshot().registers.psr[11]).toBe(1);
  });
  it("reasserts the visible menu context after a failed button command restores VM state", () => {
    const visibleContext = { pageId: -1, buttonId: null as number | null };
    const applyMenuContext = vi.fn((pageId: number, selectedButtonId: number | null) => {
      visibleContext.pageId = pageId; visibleContext.buttonId = selectedButtonId;
    });
    const vm = {
      handleEvent: vi.fn(), applyMenuContext,
      beginMenuAction: vi.fn(),
      executeButtonProgram: vi.fn(() => {
        visibleContext.pageId = 99; visibleContext.buttonId = 65535;
        const fault = { code: "TEST_FAILURE", message: "failed", source: null };
        return {
          status: "faulted" as const, programId: 0, pc: 0, registers: { gpr: [], psr: [] }, callStack: [],
          playback: { status: "idle" as const, playlist: null, playItem: null, presentationTime: null, pendingActionId: null },
          generation: 0, waiting: null, instructionsThisTurn: 0, diagnostic: fault,
          actions: [], terminated: false, buttonCommandTerminated: false, fault,
        };
      }),
      recoverMenuAction: vi.fn(() => { visibleContext.pageId = 0; visibleContext.buttonId = 65535; return true; }),
    };
    const testScene = scene(); testScene.pages[0]!.buttons[0]!.commands = [{ bytes: "000000000000000000000000" }];
    const menu = new MenuController(testScene, vm);
    menu.handle("activate");
    expect(vm.beginMenuAction).toHaveBeenCalledOnce();
    expect(applyMenuContext.mock.invocationCallOrder.some((callOrder) => callOrder < vm.beginMenuAction.mock.invocationCallOrder[0]!)).toBe(true);
    expect(vm.recoverMenuAction).toHaveBeenCalledOnce();
    expect(visibleContext).toEqual({ pageId: 0, buttonId: 1 });
    expect(applyMenuContext).toHaveBeenLastCalledWith(0, 1);
  });
  it("preserves PSR side effects from a successful title or MovieObject route", () => {
    const vmContext = { pageId: 0, buttonId: 1 as number | null };
    const vm = {
      handleEvent: vi.fn(), applyMenuContext: vi.fn((pageId: number, selectedButtonId: number | null) => {
        vmContext.pageId = pageId; vmContext.buttonId = selectedButtonId;
      }),
      beginMenuAction: vi.fn(), recoverMenuAction: vi.fn(() => false),
      executeButtonProgram: vi.fn(() => {
        vmContext.pageId = 88; vmContext.buttonId = 6;
        return {
          status: "idle" as const, programId: 2, pc: 4, registers: { gpr: [], psr: [] }, callStack: [],
          playback: { status: "idle" as const, playlist: null, playItem: null, presentationTime: null, pendingActionId: null },
          generation: 0, waiting: null, instructionsThisTurn: 1, diagnostic: null,
          actions: [], terminated: false, buttonCommandTerminated: false, fault: null,
        };
      }),
    };
    const testScene = scene(); testScene.pages[0]!.buttons[0]!.commands = [{ bytes: "000000000000000000000000" }];
    const dispatchActions = vi.fn();
    const menu = new MenuController(testScene, vm, { dispatchActions });
    menu.handle("activate");
    expect(dispatchActions).toHaveBeenCalledOnce();
    expect(vmContext).toEqual({ pageId: 88, buttonId: 6 });
    expect(vm.applyMenuContext).toHaveBeenCalledTimes(2); // constructor default and activation preflight
  });
  it("clears held keys on blur and ignores repeated keydown while a key is held", () => {
    const controller = new MenuController(scene(), { handleEvent: vi.fn() }); const input = fakeWindow();
    const remove = installKeyboardInput(input.target, controller);
    const right = keyEvent("ArrowRight");
    input.emit("keydown", right); expect(controller.selectedButtonId).toBe(2);
    input.emit("keydown", right); expect(controller.selectedButtonId).toBe(2);
    input.emit("blur", new Event("blur"));
    input.emit("keydown", right); expect(controller.selectedButtonId).toBe(1);
    remove();
  });
  it("does not guess a focus when the declared default button is invalid", () => {
    const vm = new HdmvVm([{ id: 0, instructions: ["000000000000000000000000"] }]); const menu = new MenuController(scene(), vm);
    menu.setPage(1); expect(menu.page.buttons.map((button) => button.id)).toEqual([9]); expect(menu.page.defaultButtonId).toBe(99); expect(menu.selectedButtonId).toBeNull();
  });
  it("distinguishes an unusable BOG member from a default button outside the BOG", () => {
    const testScene: MenuScene = { width: 100, height: 60, pages: [{
      id: 8, defaultButtonId: 1, bogDefaults: [{ bog: 10, defaultButtonId: 10 }, { bog: 11, defaultButtonId: 12 }, { bog: 12, defaultButtonId: 11 }], buttons: [
        { id: 1, bog: 10, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: {}, commands: [] },
        { id: 10, bog: 10, enabled: false, neighbors: { up: 10, down: 10, left: 10, right: 10 }, states: {}, commands: [] },
        { id: 11, bog: 12, enabled: false, neighbors: { up: 11, down: 11, left: 11, right: 11 }, states: {}, commands: [{ bytes: "000000000000000000000000" }] },
      ],
    }] };
    const diagnostic = vi.fn();
    const menu = new MenuController(testScene, { handleEvent: vi.fn() }, { diagnostic });
    expect(menu.selectedButtonId).toBeNull();
    expect(menu.button).toBeNull();
    expect(diagnostic).not.toHaveBeenCalledWith(expect.stringContaining("BOG 10 default button 10"));
    expect(diagnostic).toHaveBeenCalledWith("Page 8 BOG 11 default button 12 is not a member of that BOG.");
    expect(diagnostic).toHaveBeenCalledWith("Page 8 BOG 12 default button 11 belongs to the BOG but is disabled or has no usable hit geometry.");
  });
  it("uses the BOG default as the only visible and hittable member until VM enables its alternative", () => {
    const makeButton = (id: number) => ({
      id, bog: 0, enabled: true, neighbors: { up: id, down: id, left: id, right: id },
      states: { normal: { bounds: bounds(10) }, selected: { bounds: bounds(10) } }, commands: [],
    });
    const testScene: MenuScene = { width: 100, height: 60, pages: [{
      id: 6, defaultButtonId: 1, bogDefaults: [{ bog: 0, defaultButtonId: 1 }], buttons: [makeButton(1), makeButton(2)],
    }] };
    const menu = new MenuController(testScene, { handleEvent: vi.fn() });
    expect(menu.isDisplayed(menu.page.buttons[0]!)).toBe(true);
    expect(menu.isDisplayed(menu.page.buttons[1]!)).toBe(false);
    expect(menu.hit(15, 15)).toBe(1);
    expect(menu.selectFromPointer(15, 15)).toBe(true);
    menu.setButtonEnabled(2, true);
    expect(menu.button?.id).toBe(2);
    expect(menu.isDisplayed(menu.page.buttons[0]!)).toBe(false);
    expect(menu.isDisplayed(menu.page.buttons[1]!)).toBe(true);
    expect(menu.hit(15, 15)).toBe(2);
    menu.setButtonEnabled(2, false);
    expect(menu.hit(15, 15)).toBeNull();
  });
  it("hits only selected-state geometry and resolves overlaps by BOG order", () => {
    const overlap = bounds(10);
    const button = (id: number, bog: number, selected: boolean) => ({
      id, bog, enabled: true, neighbors: { up: id, down: id, left: id, right: id },
      states: { normal: { bounds: overlap }, ...(selected ? { selected: { bounds: overlap } } : {}) }, commands: [],
    });
    const testScene: MenuScene = { width: 100, height: 60, pages: [{
      id: 4, defaultButtonId: 1, bogDefaults: [{ bog: 0, defaultButtonId: 1 }, { bog: 1, defaultButtonId: 2 }],
      // Deliberately reverse serialized button order; the BOG declarations own hit priority.
      buttons: [button(2, 1, true), button(1, 0, true)],
    }] };
    const menu = new MenuController(testScene, { handleEvent: vi.fn() });
    expect(menu.hit(15, 15)).toBe(1);

    testScene.pages[0]!.buttons[1]!.states = { normal: { bounds: overlap } };
    expect(menu.hit(15, 15)).toBe(2);
    testScene.pages[0]!.buttons[0]!.states = { normal: { bounds: overlap } };
    expect(menu.hit(15, 15)).toBeNull();
  });
  it("activates an autoAction selected by SET_BUTTON_PAGE", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [] }]);
    const testScene: MenuScene = { width: 100, height: 60, pages: [{
      id: 0, defaultButtonId: 1, bogDefaults: [{ bog: 0, defaultButtonId: 1 }], buttons: [
        { id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: {}, commands: [] },
        { id: 2, bog: 0, enabled: true, autoAction: true, neighbors: { up: 2, down: 2, left: 2, right: 2 }, states: {}, commands: [{ bytes: m3Fixtures.move5.bytes }] },
      ],
    }] };
    const menu = new MenuController(testScene, vm);
    menu.applySetButtonPage(0x20000002);
    expect(menu.button?.id).toBe(2);
    expect(vm.snapshot().registers.gpr[0]).toBe(5);
  });
  it("stops a cyclic SET_BUTTON_PAGE autoAction chain at the documented depth limit", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [] }]);
    const makePage = (id: number): MenuScene["pages"][number] => ({
      id, defaultButtonId: 1, bogDefaults: [{ bog: 0, defaultButtonId: 1 }], buttons: [
        { id: 1, bog: 0, enabled: true, autoAction: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: {}, commands: [] },
      ],
    });
    const testScene: MenuScene = { width: 100, height: 60, pages: [makePage(0), makePage(1)] };
    const diagnostic = vi.fn(); let menu!: MenuController; let dispatchCount = 0;
    menu = new MenuController(testScene, vm, {
      diagnostic,
      dispatchActions: () => {
        dispatchCount++;
        const destination = menu.page.id === 0 ? 1 : 0;
        const packed = (0xa0000001 | (destination << 16)) >>> 0;
        menu.applySetButtonPage(packed);
      },
    });
    menu.start();
    expect(dispatchCount).toBe(32);
    expect(diagnostic).toHaveBeenCalledWith("Menu auto-action chain exceeded 32 nested activations and was stopped.");
  });
  it("tracks BOG focus, draws normal-selected-activated states, and resets focus to each page default", () => {
    const img = (label: string) => ({ label }) as unknown as CanvasImageSource;
    const button = (id: number, bog: number, states: MenuScene["pages"][number]["buttons"][number]["states"]) => ({
      id, bog, enabled: true, neighbors: { up: id, down: id, left: id, right: id }, states, commands: [],
    });
    const testScene: MenuScene = { width: 100, height: 60, pages: [
      { id: 0, defaultButtonId: 1, bogDefaults: [{ bog: 0, defaultButtonId: 1 }, { bog: 1, defaultButtonId: 2 }], buttons: [
        button(1, 0, { normal: { bounds: bounds(10), image: img("p0-b1-normal") }, selected: { bounds: bounds(10), image: img("p0-b1-selected") }, activated: { bounds: bounds(10), image: img("p0-b1-activated") } }),
        button(2, 1, { normal: { bounds: bounds(40), image: img("p0-b2-normal") }, selected: { bounds: bounds(40), image: img("p0-b2-selected") }, activated: { bounds: bounds(40), image: img("p0-b2-activated") } }),
      ] },
      { id: 1, defaultButtonId: 9, bogDefaults: [{ bog: 0, defaultButtonId: 9 }], buttons: [
        button(9, 0, { normal: { bounds: bounds(30), image: img("p1-b9-normal") }, selected: { bounds: bounds(30), image: img("p1-b9-selected") }, activated: { bounds: bounds(30), image: img("p1-b9-activated") } }),
      ] },
      { id: 2, defaultButtonId: 1, buttons: [button(3, 0, { normal: { bounds: bounds(40), image: img("p2-b3-normal") } })] },
    ] };
    const drawImage = vi.fn();
    const context = { setTransform() {}, clearRect() {}, save() {}, beginPath() {}, rect() {}, clip() {}, drawImage, restore() {} } as unknown as CanvasRenderingContext2D;
    const view = new CanvasViewport(100, 60); const menu = new MenuController(testScene, { handleEvent: vi.fn() });
    const draw = (...expectedImages: string[]) => {
      drawImage.mockClear(); drawMenu(context, testScene, menu, view, 100, 60);
      expect(drawImage.mock.calls.map(([image]) => (image as { label: string }).label)).toEqual(expectedImages);
    };

    expect(menu.selectedButtonId).toBe(1); draw("p0-b1-selected", "p0-b2-normal");
    menu.handle("activate"); expect(menu.activatedButtonId).toBe(1); draw("p0-b1-activated", "p0-b2-normal");
    expect(menu.selectFromPointer(41, 15)).toBe(true); expect(menu.selectedButtonId).toBe(2); expect(menu.activatedButtonId).toBeNull(); draw("p0-b1-normal", "p0-b2-selected");
    menu.handle("activate"); draw("p0-b1-normal", "p0-b2-activated");
    menu.setPage(1); expect(menu.selectedButtonId).toBe(9); expect(menu.page.buttons.some(({ id }) => id === 2)).toBe(false); expect(menu.activatedButtonId).toBeNull(); draw("p1-b9-selected");
    menu.setPage(2); expect(menu.selectedButtonId).toBeNull(); expect(menu.activatedButtonId).toBeNull(); draw("p2-b3-normal");
  });
  it("uses the page default for focus and recognizes default-activation sentinels", () => {
    const testScene = scene();
    testScene.pages[0]!.defaultButtonId = 0xffff;
    testScene.pages[0]!.defaultActivatedButtonId = 0xfffe;
    testScene.pages[0]!.bogDefaults = [{ bog: 0, defaultButtonId: 1 }];
    testScene.pages[0]!.buttons[1]!.bog = 1;
    testScene.pages[0]!.bogDefaults.push({ bog: 1, defaultButtonId: 2 });
    testScene.pages[1]!.defaultButtonId = 9;
    testScene.pages[1]!.defaultActivatedButtonId = 9;
    testScene.pages[1]!.bogDefaults = [{ bog: 0, defaultButtonId: 9 }];
    const executeButtonCommand = vi.fn(() => ({ status: "running" }));
    const port = { handleEvent: vi.fn(), executeButtonCommand };
    const diagnostic = vi.fn(); const menu = new MenuController(testScene, port, { diagnostic });
    // FFFF means the page does not force a selected button; use the valid BOG
    // default (equivalent to libbluray's first valid button fallback).
    expect(menu.selectedButtonId).toBe(1);
    expect(menu.activatedButtonId).toBeNull();
    expect(executeButtonCommand).not.toHaveBeenCalled();
    menu.selectFromPointer(61, 15);
    expect(menu.selectedButtonId).toBe(2);
    menu.setPage(1);
    expect(menu.selectedButtonId).toBe(9);
    expect(menu.activatedButtonId).toBeNull();
    expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining("runtime semantics are unverified"));
  });
  it("reports a nonzero selection timeout when default activation targets the current focus", () => {
    const testScene = scene(); testScene.selectionTimeout90k = "4500";
    testScene.pages[0]!.defaultActivatedButtonId = 0xfffe;
    const diagnostic = vi.fn(); const executeButtonCommand = vi.fn();
    const menu = new MenuController(testScene, { handleEvent: vi.fn(), executeButtonCommand }, { diagnostic });
    expect(menu.selectedButtonId).toBe(1);
    expect(menu.activatedButtonId).toBeNull();
    expect(executeButtonCommand).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith("Page 0 requests activation of the selected button after the selection timeout, but timeout activation is not implemented.");
  });
  it("uses the live PSR10 value for dynamic page focus before falling back to the first BOG button", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [] }]);
    const makeButton = (id: number, bog: number): MenuScene["pages"][number]["buttons"][number] => ({
      id, bog, enabled: true, neighbors: { up: id, down: id, left: id, right: id }, states: {}, commands: [],
    });
    const testScene: MenuScene = { width: 100, height: 60, pages: [
      { id: 0, defaultButtonId: 1, bogDefaults: [{ bog: 0, defaultButtonId: 1 }], buttons: [makeButton(1, 0)] },
      { id: 1, defaultButtonId: 0xffff, bogDefaults: [{ bog: 0, defaultButtonId: 1 }, { bog: 1, defaultButtonId: 2 }], buttons: [makeButton(1, 0), makeButton(2, 1)] },
    ] };
    const menu = new MenuController(testScene, vm);
    expect(menu.selectedButtonId).toBe(1);

    // Model a MovieObject PSR10 write after the controller last synchronized focus.
    vm.registers.systemWrite(10, 2);
    menu.setPage(1);
    expect(menu.selectedButtonId).toBe(2);
    expect(vm.snapshot().registers.psr[10]).toBe(2);
  });
  it("runs autoAction on non-pointer focus transitions without repeating the same focus", () => {
    const testScene = scene();
    testScene.pages[0]!.buttons[1]!.autoAction = true;
    testScene.pages[0]!.buttons[1]!.neighbors.left = 1;
    testScene.pages[0]!.buttons[1]!.commands = [{ bytes: "0102030405060708090a0b0c" }];
    const executeButtonCommand = vi.fn(() => ({ status: "running" }));
    const menu = new MenuController(testScene, { handleEvent: vi.fn(), executeButtonCommand });
    menu.handle("right");
    expect(menu.selectedButtonId).toBe(2);
    expect(executeButtonCommand).toHaveBeenCalledTimes(1);
    menu.selectFromPointer(61, 15);
    expect(executeButtonCommand).toHaveBeenCalledTimes(1);
    menu.handle("left");
    expect(menu.selectedButtonId).toBe(1);
    menu.handle("right");
    expect(executeButtonCommand).toHaveBeenCalledTimes(2);
  });
  it("does not run a pointer autoAction on hover and runs it once on pointer down", () => {
    const testScene = scene();
    testScene.pages[0]!.buttons[1]!.autoAction = true;
    testScene.pages[0]!.buttons[1]!.commands = [{ bytes: m3Fixtures.move5.bytes }];
    const vm = new HdmvVm([{ id: 0, instructions: [] }]);
    const menu = new MenuController(testScene, vm);
    const pointer = pointerRuntime(menu);

    pointer.move();
    expect(menu.selectedButtonId).toBe(2);
    expect(vm.trace.filter((entry) => entry.decoded?.startsWith("MOVE"))).toHaveLength(0);

    pointer.down();
    expect(vm.trace.filter((entry) => entry.decoded?.startsWith("MOVE"))).toHaveLength(1);
    pointer.dispose();
  });
  it("starts a geometry-free default autoAction and applies its VM page/button request", () => {
    const pageChange = [0x51c00003, 0x80000001, 0x80000001].map((word) => word.toString(16).padStart(8, "0")).join("");
    const testScene: MenuScene = { width: 100, height: 60, pages: [
      { id: 0, defaultButtonId: 0, buttons: [{ id: 0, bog: 0, enabled: true, autoAction: true, neighbors: { up: 0, down: 0, left: 0, right: 0 }, states: {}, commands: [{ bytes: pageChange }] }] },
      { id: 1, defaultButtonId: 0xffff, buttons: [{ id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: { normal: { bounds: bounds(10) }, selected: { bounds: bounds(10) } }, commands: [] }] },
    ] };
    const vm = new HdmvVm([{ id: 0, instructions: [] }]);
    let menu: MenuController;
    const dispatchActions = () => {
      for (const action of vm.drainActions()) if (action.type === "SET_BUTTON_PAGE" && typeof action.payload.packed === "number") menu.applySetButtonPage(action.payload.packed);
    };
    menu = new MenuController(testScene, vm, { dispatchActions });
    expect(menu.page.id).toBe(0); expect(vm.actions).toHaveLength(0);
    menu.start();
    expect(menu.page.id).toBe(1); expect(menu.selectedButtonId).toBe(1); expect(menu.activatedButtonId).toBeNull();
    expect(vm.actions[0]?.payload.packed).toBe(0xa0010001);
  });
  it("blocks each keyboard direction only when its corresponding MSB-first UO bit is set", () => {
    const directions = [
      ["ArrowUp", "up", 14], ["ArrowDown", "down", 15], ["ArrowLeft", "left", 16], ["ArrowRight", "right", 17],
    ] as const;
    for (const [key, direction, fieldBit] of directions) {
      const testScene = scene(); testScene.pages[0]!.uoMask = maskFor(fieldBit);
      testScene.pages[0]!.buttons[0]!.neighbors[direction] = 2;
      const controller = new MenuController(testScene, { handleEvent: vi.fn() });
      const input = fakeWindow(); const remove = installKeyboardInput(input.target, controller);
      input.emit("keydown", keyEvent(key));
      expect(controller.selectedButtonId, key).toBe(1);
      remove();
    }
  });
  it("blocks keyboard activate, Top Menu, Popup and Escape by their documented UO bits", () => {
    const testScene = scene(); testScene.pages[0]!.uoMask = maskFor(0, 19, 24, 25);
    testScene.pages[0]!.buttons[0]!.commands = [{ bytes: "0102030405060708090a0b0c" }];
    const vmEvents = vi.fn(); const hooks = { popup: vi.fn(), topMenu: vi.fn(), escape: vi.fn() };
    const executeButtonCommand = vi.fn(() => ({ status: "running" }));
    const controller = new MenuController(testScene, { handleEvent: vmEvents, executeButtonCommand }, hooks);
    const input = fakeWindow(); const remove = installKeyboardInput(input.target, controller);
    for (const key of ["Enter", "Space", "KeyT", "KeyP", "Escape"]) {
      input.emit("keydown", keyEvent(key)); input.emit("keyup", keyEvent(key));
    }
    expect(executeButtonCommand).not.toHaveBeenCalled();
    expect(vmEvents).not.toHaveBeenCalled();
    expect(hooks.popup).not.toHaveBeenCalled(); expect(hooks.topMenu).not.toHaveBeenCalled(); expect(hooks.escape).not.toHaveBeenCalled();
    remove();
  });
  it("routes Top Menu, Pop-up, and Escape through configured menu actions", () => {
    const vmEvents = vi.fn(); const popup = vi.fn(); const topMenu = vi.fn();
    const controller = new MenuController(scene(), { handleEvent: vmEvents }, { popup, topMenu });
    const input = fakeWindow(); const remove = installKeyboardInput(input.target, controller);
    for (const key of ["KeyT", "KeyP", "Escape"]) {
      input.emit("keydown", keyEvent(key)); input.emit("keyup", keyEvent(key));
    }
    expect(vmEvents.mock.calls.map(([event]) => event)).toEqual([
      { type: "TOP_MENU", channel: "keyboard" },
      { type: "POPUP_MENU", channel: "keyboard" },
      { type: "POPUP_MENU", channel: "keyboard" },
    ]);
    expect(topMenu).toHaveBeenCalledTimes(1); expect(popup).toHaveBeenCalledTimes(2);
    remove();

    const configuredEvents = vi.fn();
    new MenuController(scene(), { handleEvent: configuredEvents }, {}, { escapeMapping: "topMenu" }).handle("escape");
    expect(configuredEvents).toHaveBeenCalledWith({ type: "TOP_MENU", channel: "keyboard" });
    const customEscape = vi.fn();
    new MenuController(scene(), { handleEvent: vi.fn() }, { escape: customEscape }, { escapeMapping: "custom" }).handle("escape");
    expect(customEscape).toHaveBeenCalledOnce();
    const ignoredEvents = vi.fn(); const ignoredEscape = vi.fn();
    new MenuController(scene(), { handleEvent: ignoredEvents }, { escape: ignoredEscape }, { escapeMapping: "none" }).handle("escape");
    expect(ignoredEvents).not.toHaveBeenCalled(); expect(ignoredEscape).not.toHaveBeenCalled();
  });
  it("applies the mapped operation and Escape UO gates identically to keyboard aliases", () => {
    const popupBlocked = scene(); popupBlocked.pages[0]!.uoMask = maskFor(24);
    const popupEvents = vi.fn(); const popupHooks = { popup: vi.fn() };
    const popupController = new MenuController(popupBlocked, { handleEvent: popupEvents }, popupHooks);
    popupController.handle("popup"); popupController.handle("escape");
    expect(popupEvents).not.toHaveBeenCalled(); expect(popupHooks.popup).not.toHaveBeenCalled();

    const topMenuBlocked = scene(); topMenuBlocked.pages[0]!.uoMask = maskFor(0);
    const topMenuEvents = vi.fn(); const topMenuController = new MenuController(topMenuBlocked, { handleEvent: topMenuEvents }, {}, { escapeMapping: "topMenu" });
    topMenuController.handle("topMenu"); topMenuController.handle("escape");
    expect(topMenuEvents).not.toHaveBeenCalled();

    const escapeOnlyBlocked = scene(); escapeOnlyBlocked.pages[0]!.uoMask = maskFor(25);
    const escapeOnlyEvents = vi.fn(); const escapeOnly = new MenuController(escapeOnlyBlocked, { handleEvent: escapeOnlyEvents });
    escapeOnly.handle("escape"); escapeOnly.handle("popup");
    expect(escapeOnlyEvents).toHaveBeenCalledTimes(1);
    expect(escapeOnlyEvents).toHaveBeenCalledWith({ type: "POPUP_MENU", channel: "keyboard" });

    const actionDisabled = scene(); actionDisabled.pages[0]!.allowedActions = { popup: false };
    const disabledEvents = vi.fn(); new MenuController(actionDisabled, { handleEvent: disabledEvents }).handle("escape");
    expect(disabledEvents).not.toHaveBeenCalled();
  });
  it("does not infer a directional neighbor from button geometry", () => {
    const testScene = scene(); testScene.pages[0]!.buttons[0]!.neighbors.right = 99;
    const controller = new MenuController(testScene, { handleEvent: vi.fn() });
    controller.handle("right");
    expect(controller.selectedButtonId).toBe(1);
  });
  it("applies select and activate UO bits to pointer hover and click without activating stale focus", () => {
    const selectBlockedScene = scene(); selectBlockedScene.pages[0]!.uoMask = maskFor(18);
    const selectBlocked = new MenuController(selectBlockedScene, { handleEvent: vi.fn() });
    const pointer = pointerRuntime(selectBlocked);
    pointer.move(); pointer.down();
    expect(selectBlocked.selectedButtonId).toBe(1);
    expect(selectBlocked.activatedButtonId).toBeNull();
    pointer.dispose();

    const activateBlockedScene = scene(); activateBlockedScene.pages[0]!.uoMask = maskFor(19);
    const activateBlocked = new MenuController(activateBlockedScene, { handleEvent: vi.fn() });
    const secondPointer = pointerRuntime(activateBlocked);
    secondPointer.move(); secondPointer.down();
    expect(activateBlocked.selectedButtonId).toBe(2);
    expect(activateBlocked.activatedButtonId).toBeNull();
    secondPointer.dispose();

    const combinedBlockedScene = scene(); combinedBlockedScene.pages[0]!.uoMask = maskFor(20);
    const combinedBlocked = new MenuController(combinedBlockedScene, { handleEvent: vi.fn() });
    const thirdPointer = pointerRuntime(combinedBlocked);
    thirdPointer.down();
    expect(combinedBlocked.selectedButtonId).toBe(1);
    expect(combinedBlocked.activatedButtonId).toBeNull();
    thirdPointer.dispose();

    const allowed = new MenuController(scene(), { handleEvent: vi.fn() });
    const allowedPointer = pointerRuntime(allowed);
    allowedPointer.down();
    expect(allowed.selectedButtonId).toBe(2);
    expect(allowed.activatedButtonId).toBe(2);
    allowedPointer.dispose();
  });
  it("preserves unknown mask bits without treating them as menu-operation prohibitions", () => {
    const testScene = scene(); testScene.pages[0]!.uoMask = maskFor(10);
    const controller = new MenuController(testScene, { handleEvent: vi.fn() });
    controller.handle("right");
    expect(controller.selectedButtonId).toBe(2);
  });
  it("keeps a disabled button's normal graphic visible without making it selectable", () => {
    const menuScene = scene(); const normal = {} as CanvasImageSource; const selected = {} as CanvasImageSource;
    menuScene.pages[0]!.buttons[0]!.states.normal!.image = normal; menuScene.pages[0]!.buttons[0]!.states.selected!.image = selected;
    const vm = new HdmvVm([{ id: 0, instructions: ["000000000000000000000000"] }]); const menu = new MenuController(menuScene, vm); menu.setButtonEnabled(1, false);
    const drawImage = vi.fn(); const context = { setTransform() {}, fillRect() {}, clearRect() {}, save() {}, beginPath() {}, rect() {}, clip() {}, drawImage, restore() {} } as unknown as CanvasRenderingContext2D;
    drawMenu(context, menuScene, menu, new CanvasViewport(100, 60), 100, 60);
    expect(menu.selectedButtonId).toBeNull(); expect(drawImage.mock.calls[0]?.[0]).toBe(normal);
  });
  it("executes button commands in source order through the raw command seam without treating the button as a MovieObject ID", () => {
    const commands: Array<{ command: string | Uint8Array; source?: { path: string; origin: "primary" | "backup"; offset: string }; context?: string }> = [];
    const port = { handleEvent: () => { throw new Error("activation must not emit MENU_INPUT"); }, executeButtonCommand: (command: string | Uint8Array, source?: { path: string; origin: "primary" | "backup"; offset: string }, context?: string) => { commands.push({ command, ...(source ? { source } : {}), ...(context ? { context } : {}) }); return { status: "running" }; } };
    const testScene = scene(); testScene.pages[0]!.buttons[0]!.commands = [
      { bytes: "0102030405060708090a0b0c", sourceOffset: "40", source: { path: "BDMV/STREAM/00001.m2ts", origin: "primary", offset: "40" } },
      { bytes: "1112131415161718191a1b1c", sourceOffset: "52", source: { path: "BDMV/STREAM/00001.m2ts", origin: "primary", offset: "52" } },
    ];
    const menu = new MenuController(testScene, port); menu.handle("activate");
    expect(commands).toEqual(testScene.pages[0]!.buttons[0]!.commands.map(({ bytes, source }) => ({ command: bytes, source, context: "ig_object" })));
  });
  it("runs an activated button as one conditional program and dispatches only the selected SET_STREAM branch", () => {
    const make = (words: [number, number, number]) => { const normalized = words.map((word) => word >>> 0) as [number, number, number]; return { words: normalized, bytes: normalized.map((word) => word.toString(16).padStart(8, "0")).join(""), source: m3Fixtures.move5.source }; };
    const compare = make([m3Fixtures.compareEq7.words[0], 0, 1]);
    const setAudio = (track: number) => make([0x51c00001, 0x80000000 | (track << 16), 0]);
    const gotoEnd = make([m3Fixtures.goto0.words[0], 4, 0]);
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    vm.registers.write({ kind: "gpr", index: 0 }, 1);
    const testScene = scene();
    testScene.pages[0]!.buttons[0]!.commands = [compare, setAudio(2), gotoEnd, setAudio(3), m3Fixtures.break].map(({ bytes, source }) => ({ bytes, source }));
    const dispatchActions = vi.fn();
    const diagnostic = vi.fn();
    const menu = new MenuController(testScene, vm, { dispatchActions, diagnostic });
    expect(menu.selectedButtonId).toBe(1);
    expect(vm.executeButtonProgram).toBeTypeOf("function");

    menu.handle("activate");

    expect(menu.activatedButtonId).toBe(1);
    expect(vm.actions.filter((action) => action.type === "SET_STREAM").map((action) => action.payload.primaryAudioStream)).toEqual([2]);
    expect(diagnostic).not.toHaveBeenCalled();
    expect(dispatchActions).toHaveBeenCalledTimes(1);
    expect(vm.snapshot().registers.psr[1]).toBe(2);
  });
  it("stops dispatching the current button sequence when the VM reports termination", () => {
    const calls: string[] = [];
    const testScene = scene(); testScene.pages[0]!.buttons[0]!.commands = [{ bytes: "first" }, { bytes: "second" }];
    const menu = new MenuController(testScene, { handleEvent: vi.fn(), executeButtonCommand: (command) => { calls.push(String(command)); return { status: "running", buttonCommandTerminated: true }; } });
    menu.handle("activate");
    expect(calls).toEqual(["first"]);
  });
  it("cancels page work and freezes logical time while paused", () => {
    const scheduler = new EventScheduler(); let called = 0;
    scheduler.schedule(20, "page:1", () => called++); scheduler.cancelScope("page:1"); scheduler.advance(30); expect(called).toBe(0);
    scheduler.pause(); scheduler.advanceWhileRunning(100); expect(scheduler.now).toBe(30); scheduler.resume(); scheduler.advanceWhileRunning(5); expect(scheduler.now).toBe(35);
  });
  it("injects the logical scheduler and cancels old-page effects after a page transition", () => {
    const scheduler = new EventScheduler(); const controller = new MenuController(scene(), { handleEvent: vi.fn() }, {}, scheduler);
    let staleCompletion = 0;
    controller.schedulePageEffect(10, () => { staleCompletion++; controller.setPage(0); });
    controller.setPage(1);
    controller.advanceWhileRunning(10);
    expect(staleCompletion).toBe(0); expect(controller.page.id).toBe(1); expect(scheduler.now).toBe(10);
  });
  it("freezes page-effect time while paused and resumes from the same logical time", () => {
    const scheduler = new EventScheduler(); const controller = new MenuController(scene(), { handleEvent: vi.fn() }, {}, scheduler);
    let completionCount = 0; controller.schedulePageEffect(10, () => completionCount++);
    controller.pause(); controller.advanceWhileRunning(50);
    expect(scheduler.now).toBe(0); expect(completionCount).toBe(0);
    controller.resume(); controller.advanceWhileRunning(9);
    expect(scheduler.now).toBe(9); expect(completionCount).toBe(0);
    controller.advanceWhileRunning(1);
    expect(scheduler.now).toBe(10); expect(completionCount).toBe(1);
  });
  it("advances button object frames on the source frame interval and restores the animation checkpoint", () => {
    const testScene = scene(); testScene.frameRateCode = 2;
    testScene.pages[0]!.animationFrameRateCode = 1;
    const imageA = {} as CanvasImageSource; const imageB = {} as CanvasImageSource;
    testScene.pages[0]!.objects = new Map([[10, { image: imageA, width: 8, height: 9 }], [11, { image: imageB, width: 12, height: 13 }]]);
    testScene.pages[0]!.buttons[0]!.states = { selected: { bounds: bounds(0), startObjectId: 10, endObjectId: 11, repeat: true } };
    testScene.pages[0]!.buttons[1]!.states = {};
    const controller = new MenuController(testScene, { handleEvent: vi.fn() }, { render: vi.fn() }); controller.start();
    expect(controller.visualState(controller.button!)?.image).toBe(imageA);
    controller.advanceWhileRunning(47); expect(controller.visualState(controller.button!)?.image).toBe(imageA);
    const checkpoint = controller.saveCheckpoint(); controller.advanceWhileRunning(1);
    expect(controller.visualState(controller.button!)?.image).toBe(imageB);
    controller.advanceWhileRunning(48); expect(controller.visualState(controller.button!)?.image).toBe(imageA);
    controller.restoreCheckpoint(checkpoint); expect(controller.visualState(controller.button!)?.image).toBe(imageA);
    controller.advanceWhileRunning(48); expect(controller.visualState(controller.button!)?.image).toBe(imageB);
  });
  it("runs page out then in effects by duration and blocks input until the sequence ends", () => {
    const testScene = scene(); const render = vi.fn(); const executeButtonProgram = vi.fn();
    const imageA = {} as CanvasImageSource; const imageB = {} as CanvasImageSource;
    testScene.pages[1]!.defaultButtonId = 9;
    testScene.pages[0]!.effects = { enter: [], exit: [{ duration90k: 45_000, objects: [{ image: imageA, x: 1, y: 2, width: 3, height: 4 }] }] };
    testScene.pages[1]!.effects = { enter: [{ duration90k: 90_000, objects: [{ image: imageB, x: 5, y: 6, width: 7, height: 8 }] }], exit: [] };
    const controller = new MenuController(testScene, { handleEvent: vi.fn(), executeButtonProgram }, { render }); controller.start(); controller.setPage(1);
    expect(controller.effectFrame?.objects[0]?.image).toBe(imageA);
    controller.handle("activate"); expect(executeButtonProgram).not.toHaveBeenCalled();
    controller.advanceWhileRunning(500); expect(controller.effectFrame?.objects[0]?.image).toBe(imageB);
    controller.advanceWhileRunning(999); expect(controller.isAnimating).toBe(true);
    controller.advanceWhileRunning(1); expect(controller.isAnimating).toBe(false);
    controller.handle("activate"); expect(executeButtonProgram).toHaveBeenCalledOnce();
  });
  it("returns an unavailable media response correlated to the waiting VM action", () => {
    const vm = new HdmvVm([{ id: 0, instructions: ["220000000000000100000000"] }]);
    vm.runTurn(); const action = vm.drainActions()[0]!;
    expect(vm.snapshot().status).toBe("suspended"); expect(vm.snapshot().waiting).toMatchObject({ id: action.id, type: "PLAY_PLAYLIST", waitFor: "ended" });
    const messages: string[] = []; new PreviewPlaybackBridge(vm, (message) => messages.push(message)).dispatch(action);
    expect(vm.snapshot()).toMatchObject({ playback: { status: "unavailable", pendingActionId: null }, status: "stopped", waiting: null, diagnostic: { code: "HDMV_MEDIA_UNAVAILABLE" } });
    expect(messages[0]).toContain("unavailable");
    expect(vm.trace.some((record) => record.event?.type === "MEDIA_UNAVAILABLE" && record.event.responseTo === action.id)).toBe(true);
    expect(vm.trace.some((record) => record.event?.type === "MEDIA_ENDED")).toBe(false);
  });
  it("unblocks popup requests and explains that external title video cannot be overlaid", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
    vm.handleEvent({ type: "POPUP_MENU", channel: "keyboard" });
    const action = vm.drainActions()[0]!;
    expect(action.type).toBe("MENU_CALL");
    const messages: string[] = [];
    new PreviewPlaybackBridge(vm, (message) => messages.push(message)).dispatch(action);
    expect(messages).toEqual(["Popup composition is unavailable because this package does not have an in-browser title overlay context."]);
    expect(vm.trace.some((record) => record.event?.type === "MEDIA_UNAVAILABLE" && record.event.responseTo === action.id)).toBe(false);
  });
  it("routes an activated movie button to the visible unavailable report", () => {
    const vm = new HdmvVm([{ id: 0, instructions: [] }]);
    const menuScene = scene(); menuScene.pages[0]!.buttons[0]!.commands = [{ bytes: m3Fixtures.linkPlayItem3.bytes }];
    const messages: string[] = [];
    const bridge = new PreviewPlaybackBridge(vm, (message) => messages.push(message));
    const controller = new MenuController(menuScene, vm, { dispatchActions: () => { for (const action of vm.drainActions()) bridge.dispatch(action); } });

    controller.handle("activate");

    expect(messages).toEqual(["Playback unavailable in menu preview (LINK_PLAY_ITEM)."]);
    expect(vm.trace.some((record) => record.event?.type === "MEDIA_ENDED")).toBe(false);
  });
  it("runs the shared M4/M5 menu interaction fixture through either playback bridge", () => {
    const run = (createBridge: (vm: HdmvVm) => PlaybackBridge, scheduler: MenuScheduler = new EventScheduler()) => {
      const vm = new HdmvVm([{ id: 0, instructions: [] }]);
      const menuScene = structuredClone(menuInteractionFixture.scene) as unknown as MenuScene;
      menuScene.pages[0]!.buttons[1]!.bog = 1;
      menuScene.pages[0]!.bogDefaults!.push({ bog: 1, defaultButtonId: 2 });
      const bridge = createBridge(vm);
      const controller = new MenuController(menuScene, vm, { dispatchActions: () => { for (const action of vm.drainActions()) void bridge.dispatch(action); } }, scheduler);
      for (const step of menuInteractionFixture.steps) controller.handle(step.input);
      return { vm, controller };
    };

    const previewMessages: string[] = [];
    const previewRun = run((vm) => new PreviewPlaybackBridge(vm, (message) => previewMessages.push(message)));
    expect(previewRun.controller.selectedButtonId).toBe(menuInteractionFixture.steps[0]!.selectedButtonId);
    expect(previewRun.vm.trace.find((record) => record.action)?.action?.type).toBe(menuInteractionFixture.steps[1]!.actionType);
    expect(previewMessages[0]).toContain("unavailable");

    const mediaActions: PlaybackAction[] = [];
    const m5MediaClock: MenuScheduler = new EventScheduler();
    const mediaRun = run(() => ({
      dispatch: (action) => { mediaActions.push(action); },
      isCurrent: (generation) => generation === 0,
    }), m5MediaClock);
    expect(mediaRun.controller.selectedButtonId).toBe(menuInteractionFixture.steps[0]!.selectedButtonId);
    expect(mediaActions).toMatchObject([{ type: menuInteractionFixture.steps[1]!.actionType, payload: menuInteractionFixture.steps[1]!.actionPayload }]);
    expect(menuInteractionFixture.verification.notVerified).toContain("direct file:// launch");
  });
  it("switches PSR1 to the explicitly indexed local audio variant without moving video time", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]);
    vm.reset(9); vm.registers.systemWrite(1, 1); vm.runTurn(); const action = vm.drainActions()[0]!;
    let videoPaused = false;
    const video = { loop: false, src: "", currentTime: 0, get paused() { return videoPaused; }, play: vi.fn(async () => { videoPaused = false; }), pause: vi.fn(() => { videoPaused = true; }) } as unknown as HTMLVideoElement;
    const audioFake = new FakeAudioElement(); const audio = audioFake as unknown as HTMLAudioElement;
    const reports: string[] = [];
    const changed: string[] = [];
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "assets/media/background.mp4", loop: true, durationSeconds: 109.234 }, audioTracks: [
      { streamNumber: 1, pid: 0x1101, path: "assets/media/audio-1101-jpn.m4a", language: "jpn" },
      { streamNumber: 0, pid: 0x1100, path: "assets/media/audio-1100-eng.m4a", language: "eng" },
    ] }, (message) => reports.push(message), { audioTrackChanged: (track) => changed.push(track.path) });
    await bridge.dispatch(action);
    expect(video.loop).toBe(true); expect(video.src).toBe("assets/media/background.mp4"); expect(audio.src).toBe("assets/media/audio-1100-eng.m4a");
    expect(vm.snapshot().status).toBe("suspended"); expect(vm.snapshot().waiting?.id).toBe(action.id);
    expect(vm.snapshot().playback.status).toBe("playing");
    expect(vm.trace.some((record) => record.event?.type === "MEDIA_STARTED" && record.event.responseTo === action.id && record.diagnostic === undefined)).toBe(true);
    video.currentTime = 42.5;
    video.pause();
    vm.registers.systemWrite(1, 2);
    await bridge.dispatch({ id: "set-stream", generation: action.generation, type: "SET_STREAM", payload: { primaryAudioStream: 2 } });
    expect(audio.src).toBe("assets/media/audio-1101-jpn.m4a"); expect(audio.currentTime).toBe(42.5); expect(video.currentTime).toBe(42.5);
    expect(audio.play).toHaveBeenCalledTimes(1); // Initial start only; the video was paused during the switch.
    expect(audio.paused).toBe(true); expect(vm.registers.read({ kind: "psr", index: 1 })).toBe(2); expect(changed).toEqual(["assets/media/audio-1101-jpn.m4a"]);
    await video.play(); audioFake.paused = false;
    vm.registers.systemWrite(1, 1);
    await bridge.dispatch({ id: "set-stream-eng", generation: action.generation, type: "SET_STREAM", payload: { primaryAudioStream: 1 } });
    expect(audio.src).toBe("assets/media/audio-1100-eng.m4a"); expect(audio.currentTime).toBe(42.5); expect(video.currentTime).toBe(42.5);
    expect(audio.play).toHaveBeenCalledTimes(2); expect(vm.registers.read({ kind: "psr", index: 1 })).toBe(1); expect(changed).toEqual(["assets/media/audio-1101-jpn.m4a", "assets/media/audio-1100-eng.m4a"]);
    vm.handleEvent({ type: "MEDIA_ENDED", generation: action.generation, responseTo: action.id });
    expect(vm.snapshot().status).toBe("idle"); expect(vm.snapshot().waiting).toBeNull(); expect(vm.snapshot().playback.status).toBe("ended");
    expect(reports).toEqual([]);
  });
  it("preserves menu video position across PLAY_STOP and a same-playlist restart", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]);
    const video = { loop: false, src: "", currentTime: 0, paused: true, play: vi.fn(async function(this: { paused: boolean }) { this.paused = false; }), pause: vi.fn(function(this: { paused: boolean }) { this.paused = true; }) } as unknown as HTMLVideoElement;
    const audio = { loop: false, src: "", currentTime: 0, duration: 60, readyState: 1, paused: true, play: vi.fn(async function(this: { paused: boolean }) { this.paused = false; }), pause: vi.fn(function(this: { paused: boolean }) { this.paused = true; }), load: vi.fn() } as unknown as HTMLAudioElement;
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "background.mp4", loop: true, durationSeconds: 60 }, audioTracks: [{ streamNumber: 0, path: "audio.m4a", language: "eng" }] }, () => {});
    expect(await bridge.startMenuBackground()).toBe(true);
    video.currentTime = 27.5;
    await bridge.dispatch({ id: "stop", generation: 1, type: "PLAY_STOP", payload: {} });
    expect(video.paused).toBe(true);
    await bridge.dispatch({ id: "resume", generation: 2, type: "PLAY_PLAYLIST", payload: { playlist: 3 } });
    expect(video.src).toBe("background.mp4");
    expect(video.currentTime).toBe(27.5);
    expect(video.play).toHaveBeenCalledTimes(2);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(video.paused).toBe(false);
  });
  it("restores PSR1 and the previously selected track when the new variant cannot play", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]);
    vm.reset(9); vm.registers.systemWrite(1, 1); vm.runTurn(); const action = vm.drainActions()[0]!;
    const video = { loop: false, src: "", currentTime: 0, paused: false, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const audioFake = new FakeAudioElement(); const audio = audioFake as unknown as HTMLAudioElement;
    const reports: string[] = []; const changed: number[] = [];
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "assets/media/background.mp4", loop: false, durationSeconds: 109.234 }, audioTracks: [
      { streamNumber: 0, pid: 0x1100, path: "assets/media/audio-1100-eng.m4a", language: "eng" },
      { streamNumber: 1, pid: 0x1101, path: "assets/media/audio-1101-jpn.m4a", language: "jpn" },
    ] }, (message) => reports.push(message), { audioTrackChanged: (track) => changed.push(track.streamNumber) });
    await bridge.dispatch(action);
    video.currentTime = 17.25;
    audioFake.play.mockRejectedValueOnce(new Error("Japanese variant play failed"));
    vm.registers.systemWrite(1, 2);
    await bridge.dispatch({ id: "switch-jpn", generation: action.generation, type: "SET_STREAM", payload: { primaryAudioStream: 2 } });

    expect(audio.src).toBe("assets/media/audio-1100-eng.m4a"); expect(audio.currentTime).toBe(17.25);
    expect(vm.registers.read({ kind: "psr", index: 1 })).toBe(1); expect(bridge.selectedPrimaryAudioStream).toBe(1);
    expect(changed).toEqual([]); expect(reports.join(" ")).toContain("Japanese variant play failed");
  });
  it("waits for target metadata and seeked before confirming a playing audio variant", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]);
    vm.reset(9); vm.registers.systemWrite(1, 1); vm.runTurn(); const action = vm.drainActions()[0]!;
    const video = { loop: false, src: "", currentTime: 31.5, paused: false, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const audioFake = new FakeAudioElement(); const audio = audioFake as unknown as HTMLAudioElement;
    const changed: string[] = [];
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "background.mp4", loop: true, durationSeconds: 109.234 }, audioTracks: [
      { streamNumber: 0, pid: 0x1100, path: "audio-eng.m4a", language: "eng" },
      { streamNumber: 1, pid: 0x1101, path: "audio-jpn.m4a", language: "jpn" },
    ] }, () => {}, { audioTrackChanged: (track) => changed.push(track.path) });
    await bridge.dispatch(action);
    audioFake.readyState = 0; audioFake.autoMetadata = false; audioFake.autoSeeked = false;
    vm.registers.systemWrite(1, 2);
    const switching = bridge.dispatch({ id: "switch-jpn", generation: action.generation, type: "SET_STREAM", payload: { primaryAudioStream: 2 } });
    expect(audioFake.listeners.get("loadedmetadata")?.size).toBe(1);
    expect(audioFake.loadReadyStates).toEqual([0]);
    expect(audioFake.readyState).toBe(0); expect(audio.currentTime).toBe(0); expect(changed).toEqual([]);
    audioFake.readyState = 1; audioFake.emit("loadedmetadata");
    await Promise.resolve();
    expect(audio.currentTime).toBe(31.5); expect(changed).toEqual([]);
    audioFake.emit("seeked");
    await switching;
    expect(changed).toEqual(["audio-jpn.m4a"]); expect(vm.registers.read({ kind: "psr", index: 1 })).toBe(2);
  });
  it("rolls back the VM PSR and selected track when the requested stream is not packaged", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]);
    vm.reset(9); vm.registers.systemWrite(1, 1); vm.runTurn(); const action = vm.drainActions()[0]!;
    const video = { loop: false, src: "", currentTime: 0, paused: false, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const audioFake = new FakeAudioElement(); const audio = audioFake as unknown as HTMLAudioElement; const reports: string[] = [];
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "background.mp4", loop: true, durationSeconds: 109.234 }, audioTracks: [
      { streamNumber: 0, pid: 0x1100, path: "audio-1100-eng.m4a", language: "eng" },
    ] }, (message) => reports.push(message));
    await bridge.dispatch(action); vm.registers.systemWrite(1, 2);
    const oldSource = audio.src;
    await bridge.dispatch({ id: "switch-missing", generation: action.generation, type: "SET_STREAM", payload: { primaryAudioStream: 2 } });
    expect(audio.src).toBe(oldSource); expect(vm.registers.read({ kind: "psr", index: 1 })).toBe(1);
    expect(bridge.selectedPrimaryAudioStream).toBe(1); expect(reports.join(" ")).toContain("not included");
  });
  it("keeps two same-language source streams addressable as separate PSR1 variants", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]);
    vm.reset(9); vm.registers.systemWrite(1, 1);
    const video = { loop: false, src: "", currentTime: 8, paused: true, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const audioFake = new FakeAudioElement(); const audio = audioFake as unknown as HTMLAudioElement;
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "background.mp4", loop: true, durationSeconds: 109.234 }, audioTracks: [
      { streamNumber: 0, pid: 0x1100, path: "audio-eng-main.m4a", language: "eng" },
      { streamNumber: 1, pid: 0x1102, path: "audio-eng-commentary.m4a", language: "eng" },
    ] }, () => {});
    await bridge.startMenuBackground(); vm.registers.systemWrite(1, 2);
    await bridge.dispatch({ id: "switch-commentary", generation: 0, type: "SET_STREAM", payload: { primaryAudioStream: 2 } });
    expect(audio.src).toBe("audio-eng-commentary.m4a"); expect(bridge.selectedPrimaryAudioStream).toBe(2);
    expect(audio.currentTime).toBe(8); expect(vm.registers.read({ kind: "psr", index: 1 })).toBe(2);
  });
  it("ignores a late seek completion from a superseded stream-selection generation", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]);
    vm.reset(9); vm.registers.systemWrite(1, 1); vm.runTurn(); const action = vm.drainActions()[0]!;
    const video = { loop: false, src: "", currentTime: 11, paused: false, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const audioFake = new FakeAudioElement(); audioFake.autoSeeked = false; const audio = audioFake as unknown as HTMLAudioElement;
    const changed: string[] = [];
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "background.mp4", loop: true, durationSeconds: 109.234 }, audioTracks: [
      { streamNumber: 0, pid: 0x1100, path: "audio-eng.m4a", language: "eng" },
      { streamNumber: 1, pid: 0x1101, path: "audio-jpn.m4a", language: "jpn" },
      { streamNumber: 2, pid: 0x1102, path: "audio-kor.m4a", language: "kor" },
    ] }, () => {}, { audioTrackChanged: (track) => changed.push(track.path) });
    await bridge.dispatch(action);
    vm.registers.systemWrite(1, 2);
    const stale = bridge.dispatch({ id: "switch-jpn", generation: action.generation, type: "SET_STREAM", payload: { primaryAudioStream: 2 } });
    await Promise.resolve();
    vm.registers.systemWrite(1, 3);
    await bridge.dispatch({ id: "switch-kor", generation: action.generation + 1, type: "SET_STREAM", payload: { primaryAudioStream: 3 } });
    audioFake.emit("seeked");
    await stale;
    expect(audio.src).toBe("audio-kor.m4a"); expect(vm.registers.read({ kind: "psr", index: 1 })).toBe(3);
    expect(bridge.selectedPrimaryAudioStream).toBe(3); expect(changed).toEqual(["audio-kor.m4a"]);
  });
  it("routes both reached real page 3 button 1 branches from JPN back to English through the menu controller", async () => {
    const rawButtonCommands = [
      "5040000100000feb00000000", "5000000100000de500000feb", "5040000100000feb00000001",
      "5040000100000fec00000001", "5000000100000fed00000a29", "5000000100000fee00000a29",
      "5040000100000fef00000001", "5000000900000fef00000a28", "5040000f00000fef00000000",
      "4840020000000fef00000000", "208100000000000c00000000", "208100000000000e00000000",
      "510000018feb8fec00000000", "208100000000000f00000000", "510000018febcfec00000000",
      "5040000100000feb00000001", "5040000100000fec00000002", "5100000380000feb80000fec",
      "000000000000000000000000",
    ];
    const runBranch = async (selectionFlag: number) => {
      const vm = new HdmvVm([{ id: 0, instructions: ["000000000000000000000000"] }]);
      vm.registers.systemWrite(1, 2); vm.registers.write({ kind: "gpr", index: 0x0a28 }, selectionFlag);
      const video = { loop: false, src: "", currentTime: 42.5, paused: false, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
      const audioFake = new FakeAudioElement(); const audio = audioFake as unknown as HTMLAudioElement;
      const tracks = [
        { streamNumber: 1, pid: 0x1101, path: "assets/media/audio-1101-jpn.m4a", language: "jpn" },
        { streamNumber: 0, pid: 0x1100, path: "assets/media/audio-1100-eng.m4a", language: "eng" },
      ];
      const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "assets/media/background.mp4", loop: true, durationSeconds: 109.234 }, audioTracks: tracks }, () => {});
      await bridge.startMenuBackground();
      const menuScene = scene(); menuScene.pages[0]!.id = 3; menuScene.pages[1]!.id = 2; menuScene.pages[0]!.buttons[0]!.commands = rawButtonCommands.map((bytes) => ({ bytes }));
      const dispatches: Promise<void>[] = []; const reached: PlaybackAction[] = [];
      let menu: MenuController;
      menu = new MenuController(menuScene, vm, { dispatchActions: () => {
        for (const action of vm.drainActions()) {
          reached.push(action);
          if (action.type === "SET_BUTTON_PAGE") {
            if (typeof action.payload.packed === "number") menu.applySetButtonPage(action.payload.packed);
          } else dispatches.push(bridge.dispatch(action));
        }
      } });
      menu.handle("activate");
      await Promise.all(dispatches);
      return { vm, audio, reached, pageId: menu.page.id };
    };
    const first = await runBranch(0); const second = await runBranch(1);
    const firstSelection = first.reached.find((action) => action.type === "SET_STREAM")?.payload.primaryAudioStream;
    const secondSelection = second.reached.find((action) => action.type === "SET_STREAM")?.payload.primaryAudioStream;
    expect(firstSelection).toBeTypeOf("number"); expect(secondSelection).toBeTypeOf("number");
    expect([firstSelection, secondSelection]).toEqual([1, 1]);
    expect(first.vm.registers.read({ kind: "psr", index: 1 })).toBe(firstSelection);
    expect(second.vm.registers.read({ kind: "psr", index: 1 })).toBe(secondSelection);
    expect(first.pageId).toBe(2); expect(second.pageId).toBe(2);
    const expectedPath = (stream: number | undefined) => stream === 1 ? "assets/media/audio-1100-eng.m4a" : stream === 2 ? "assets/media/audio-1101-jpn.m4a" : "unmapped";
    expect(first.audio.src).toBe(expectedPath(firstSelection as number));
    expect(second.audio.src).toBe(expectedPath(secondSelection as number));
  });
  it("routes the extracted real page 2 button 1 JPN selection to its explicit STN audio asset", async () => {
    // Extracted from 00005.m2ts, PID 0x1400, scene 00005:5120:0:0:1048560,
    // page id 2, button id 1. The command sequence is 19 records in source order.
    const rawButtonCommands = [
      "5040000100000feb00000000", "5000000100000de500000feb", "5040000100000feb00000002",
      "5040000100000fec00000002", "5000000100000fed00000a29", "5000000100000fee00000a29",
      "5040000100000fef00000001", "5000000900000fef00000a28", "5040000f00000fef00000000",
      "4840020000000fef00000000", "208100000000000c00000000", "208100000000000e00000000",
      "510000018feb8fec00000000", "208100000000000f00000000", "510000018febcfec00000000",
      "5040000100000feb00000001", "5040000100000fec00000003", "5100000380000feb80000fec",
      "000000000000000000000000",
    ];
    const vm = new HdmvVm([{ id: 0, instructions: ["000000000000000000000000"] }]);
    const video = { loop: false, src: "", currentTime: 42.5, paused: false, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const audio = new FakeAudioElement() as unknown as HTMLAudioElement;
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, {
      playlist: 3, background: { path: "assets/media/background.mp4", loop: true, durationSeconds: 109.234 },
      audioTracks: [
        { streamNumber: 0, pid: 0x1100, path: "assets/media/audio-1100-eng.m4a", language: "eng" },
        { streamNumber: 1, pid: 0x1101, path: "assets/media/audio-1101-jpn.m4a", language: "jpn" },
      ],
    }, () => {});
    await bridge.startMenuBackground();
    const menuScene = scene(); menuScene.pages[0]!.id = 2; menuScene.pages[1]!.id = 3; menuScene.pages[0]!.buttons[0]!.commands = rawButtonCommands.map((bytes) => ({ bytes }));
    const dispatches: Promise<void>[] = []; const reached: PlaybackAction[] = [];
    let menu: MenuController;
    menu = new MenuController(menuScene, vm, { dispatchActions: () => {
      for (const action of vm.drainActions()) {
        reached.push(action);
        if (action.type === "SET_BUTTON_PAGE") {
          if (typeof action.payload.packed === "number") menu.applySetButtonPage(action.payload.packed);
        } else dispatches.push(bridge.dispatch(action));
      }
    } });

    menu.handle("activate");
    await Promise.all(dispatches);

    const selectedStream = reached.find((action) => action.type === "SET_STREAM")?.payload.primaryAudioStream;
    expect(rawButtonCommands).toHaveLength(19);
    expect(reached.filter((action) => action.type === "SET_STREAM").map((action) => action.payload.primaryAudioStream)).toEqual([2]);
    expect(vm.registers.read({ kind: "psr", index: 1 })).toBe(2);
    expect(bridge.selectedPrimaryAudioStream).toBe(2);
    expect(selectedStream).toBe(2);
    expect(menu.page.id).toBe(3);
    expect(audio.src).toBe("assets/media/audio-1101-jpn.m4a");
    expect(audio.currentTime).toBe(42.5);
  });
  it("retries only a still-pending playlist after a gesture blocked media start", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]);
    vm.reset(9); vm.runTurn(); const action = vm.drainActions()[0]!;
    const video = { loop: false, src: "", currentTime: 0, paused: true, play: vi.fn().mockRejectedValueOnce(Object.assign(new Error("gesture required"), { name: "NotAllowedError" })).mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const audio = { loop: false, src: "", currentTime: 0, duration: 100, readyState: 1, paused: true, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), load: vi.fn() } as unknown as HTMLAudioElement;
    const reports: string[] = []; let retry: (() => void) | undefined;
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "assets/media/background.mp4", loop: true, durationSeconds: 109.234 }, audioTracks: [
      { streamNumber: 0, path: "assets/media/audio-1100-eng.m4a", language: "eng" },
    ] }, (message) => reports.push(message), { offerRetry: (callback) => { retry = callback; } });

    await bridge.dispatch(action);

    expect(vm.snapshot()).toMatchObject({ status: "suspended", waiting: { id: action.id, generation: action.generation } });
    expect(reports[0]).toMatch(/blocked.*retry/i); expect(retry).toBeTypeOf("function");
    expect(vm.trace.filter((record) => record.action?.id === action.id)).toHaveLength(1);
    retry!(); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(video.play).toHaveBeenCalledTimes(2); expect(vm.snapshot().status).toBe("suspended");
    expect(vm.snapshot().waiting).toMatchObject({ id: action.id });
    expect(vm.trace.filter((record) => record.action?.id === action.id)).toHaveLength(1);
    expect(vm.trace.some((record) => record.event?.type === "MEDIA_ENDED")).toBe(false);
  });
  it("does not retry stale media actions and routes NotSupportedError as a capability error", async () => {
    const makeVmAction = () => {
      const vm = new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]);
      vm.reset(9); vm.runTurn(); return { vm, action: vm.drainActions()[0]! };
    };
    const stale = makeVmAction();
    const staleVideo = { loop: false, src: "", play: vi.fn().mockRejectedValueOnce(Object.assign(new Error("gesture required"), { name: "NotAllowedError" })) } as unknown as HTMLVideoElement;
    const staleAudio = { loop: false, src: "", play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLAudioElement;
    let staleRetry: (() => void) | undefined;
    const staleBridge = new MenuLoopPlaybackBridge(stale.vm, staleVideo, staleAudio, { playlist: 3, background: { path: "background.mp4", loop: true, durationSeconds: 109.234 }, audioTracks: [{ streamNumber: 0, path: "audio.wav", language: "eng" }] }, () => {}, { offerRetry: (callback) => { staleRetry = callback; } });
    await staleBridge.dispatch(stale.action); stale.vm.reset(9); staleRetry!(); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(staleVideo.play).toHaveBeenCalledOnce();

    const unsupported = makeVmAction(); const reports: string[] = []; const retry = vi.fn();
    const unsupportedVideo = { loop: false, src: "", play: vi.fn().mockRejectedValueOnce(Object.assign(new Error("unsupported codec"), { name: "NotSupportedError" })) } as unknown as HTMLVideoElement;
    const unsupportedAudio = { loop: false, src: "", play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLAudioElement;
    const unsupportedBridge = new MenuLoopPlaybackBridge(unsupported.vm, unsupportedVideo, unsupportedAudio, { playlist: 3, background: { path: "background.mp4", loop: true, durationSeconds: 109.234 }, audioTracks: [{ streamNumber: 0, path: "audio.wav", language: "eng" }] }, (message) => reports.push(message), { offerRetry: retry });
    await unsupportedBridge.dispatch(unsupported.action);
    expect(reports[0]).toMatch(/format is not supported/i); expect(retry).not.toHaveBeenCalled();
    expect(unsupported.vm.snapshot()).toMatchObject({ status: "stopped", waiting: null, diagnostic: { code: "HDMV_MEDIA_ERROR" } });
    expect(unsupported.vm.trace.some((record) => record.event?.type === "MEDIA_ENDED")).toBe(false);
  });
  it("unblocks a playlist 3 wait with MEDIA_UNAVAILABLE when the package has no exported media", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: ["228000000000000300000000"] }]);
    vm.reset(9); vm.runTurn(); const action = vm.drainActions()[0]!;
    const video = { loop: false, src: "", play: vi.fn() } as unknown as HTMLVideoElement;
    const audio = { loop: false, src: "", play: vi.fn() } as unknown as HTMLAudioElement;
    const reports: string[] = [];
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "", loop: true, durationSeconds: 109.234 }, audioTracks: [] }, (message) => reports.push(message));
    await bridge.dispatch(action);
    expect(vm.snapshot().playback.status).toBe("unavailable"); expect(vm.snapshot().status).toBe("stopped");
    expect(vm.trace.some((record) => record.event?.type === "MEDIA_UNAVAILABLE" && record.event.responseTo === action.id)).toBe(true);
    expect(video.play).not.toHaveBeenCalled(); expect(audio.play).not.toHaveBeenCalled(); expect(reports[0]).toMatch(/unavailable/i);
  });
  it("starts the local background after a no-action Top Menu MovieObject without changing VM state", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: [m3Fixtures.move5] }]);
    vm.reset(9); expect(vm.runTurn().status).toBe("idle"); expect(vm.drainActions()).toEqual([]);
    const video = { loop: false, src: "", currentTime: 0, paused: false, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const audio = { loop: false, src: "", currentTime: 0, duration: 109.234, readyState: 1, paused: false, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), load: vi.fn() } as unknown as HTMLAudioElement;
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "assets/media/background.mp4", loop: false, durationSeconds: 109.234 }, audioTracks: [
      { streamNumber: 0, path: "assets/media/audio-1100-eng.m4a", language: "eng" },
      { streamNumber: 1, path: "assets/media/audio-1101-jpn.m4a", language: "jpn" },
    ] }, () => {});
    expect(await bridge.startMenuBackground()).toBe(true);
    expect(video.src).toBe("assets/media/background.mp4"); expect(audio.src).toBe("assets/media/audio-1100-eng.m4a");
    expect(video.loop).toBe(false); expect(audio.loop).toBe(false);
    expect(vm.snapshot().status).toBe("idle"); expect(vm.trace.some((record) => record.event?.type === "MEDIA_STARTED")).toBe(false);
  });
  it("returns unavailable for an unmatched VM playlist action instead of mapping it onto the menu loop", async () => {
    const vm = new HdmvVm([{ id: 9, instructions: [m3Fixtures.playPlaylist42] }]);
    vm.reset(9); vm.runTurn(); const action = vm.drainActions()[0]!;
    const video = { loop: false, src: "", play: vi.fn() } as unknown as HTMLVideoElement;
    const audio = { loop: false, src: "", play: vi.fn() } as unknown as HTMLAudioElement;
    const reports: string[] = [];
    const bridge = new MenuLoopPlaybackBridge(vm, video, audio, { playlist: 3, background: { path: "assets/media/background.mp4", loop: true, durationSeconds: 109.234 }, audioTracks: [
      { streamNumber: 0, path: "assets/media/audio-1100-eng.m4a", language: "eng" },
    ] }, (message) => reports.push(message));
    await bridge.dispatch(action);
    expect(vm.snapshot().playback.status).toBe("unavailable"); expect(vm.snapshot().status).toBe("stopped");
    expect(vm.trace.some((record) => record.event?.type === "MEDIA_UNAVAILABLE" && record.event.responseTo === action.id)).toBe(true);
    expect(video.play).not.toHaveBeenCalled(); expect(audio.play).not.toHaveBeenCalled(); expect(reports[0]).toContain("42");
  });
  it("offers a retry gesture only for a current NotAllowedError sound and retries that sound alone", async () => {
    const audio = { play: vi.fn().mockRejectedValueOnce(Object.assign(new Error("gesture required"), { name: "NotAllowedError" })).mockResolvedValue(undefined) };
    const retry = vi.fn(); const reports: string[] = []; let current = true;
    const player = new MenuSoundPlayer({ 4: "assets/audio/sound-4.wav" }, vi.fn(() => audio), { report: (kind, message) => reports.push(`${kind}:${message}`), offerRetry: (callback) => retry.mockImplementation(callback), isCurrent: () => current });
    player.play(4, 7); await Promise.resolve(); await Promise.resolve();
    expect(reports[0]).toMatch(/^blocked:/); expect(retry).toHaveBeenCalledTimes(0);
    retry(); await Promise.resolve(); expect(audio.play).toHaveBeenCalledTimes(2);
    const staleAudio = { play: vi.fn().mockRejectedValueOnce(Object.assign(new Error("gesture required"), { name: "NotAllowedError" })) };
    const stalePlayer = new MenuSoundPlayer({ 4: "sound-4.wav" }, vi.fn(() => staleAudio), { report: () => {}, offerRetry: (callback) => retry.mockImplementation(callback), isCurrent: () => current });
    stalePlayer.play(4, 7); await Promise.resolve(); await Promise.resolve(); current = false; retry(); await Promise.resolve();
    expect(staleAudio.play).toHaveBeenCalledTimes(1);
  });
  it("plays a packaged WAV when the menu controller activates its declared sound", () => {
    const testScene = scene(); testScene.pages[0]!.buttons[0]!.states.selected!.soundId = 4;
    const audio = { play: vi.fn().mockResolvedValue(undefined) }; const createAudio = vi.fn(() => audio);
    let controller: MenuController | null = null;
    const player = new MenuSoundPlayer({ 4: "assets/audio/sound-4.wav" }, createAudio, {
      report: vi.fn(), offerRetry: vi.fn(),
      isCurrent: (_soundId, buttonId) => controller?.button?.id === buttonId && controller.activatedButtonId === buttonId,
    });
    controller = new MenuController(testScene, { handleEvent: vi.fn() }, { playSound: (soundId, buttonId) => player.play(soundId, buttonId) });
    controller.handle("activate");
    expect(createAudio).toHaveBeenCalledWith("assets/audio/sound-4.wav");
    expect(audio.play).toHaveBeenCalledOnce();
  });
  it("reports unsupported and missing audio without offering a retry", async () => {
    const retry = vi.fn(); const reports: string[] = [];
    const player = new MenuSoundPlayer({ 4: "sound-4.wav" }, () => ({ play: () => Promise.reject(Object.assign(new Error("unsupported"), { name: "NotSupportedError" })) }), { report: (kind, message) => reports.push(`${kind}:${message}`), offerRetry: retry, isCurrent: () => true });
    player.play(4, 7); await Promise.resolve(); await Promise.resolve(); player.play(9, 7);
    expect(reports.some((message) => message.startsWith("unsupported:") && /does not support packaged sound/.test(message))).toBe(true);
    expect(reports.some((message) => message.startsWith("asset:"))).toBe(true); expect(retry).not.toHaveBeenCalled();
  });
});
