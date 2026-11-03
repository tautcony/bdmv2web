import { afterEach, describe, expect, it, vi } from "vitest";
import { m3Fixtures } from "@bdmv-web/hdmv";

const validIr = {
  schemaVersion: "1.0", entries: [], programs: [], menus: [], playlists: [], mediaAssets: [], diagnostics: [],
};

function packageData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ir: structuredClone(validIr), title: "Boot test", vmPrograms: [{ id: 7, instructions: [] }], vmInitialProgramId: 7, sounds: { 4: "assets/audio/sound-4.wav" },
    scene: { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
      id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
      states: {
        normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" },
        selected: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo", soundId: 4 },
      }, commands: [],
    }] }] },
    ...overrides,
  };
}

function createHost(options: { data: Record<string, unknown>; assetBatches?: unknown[][]; imageFailure?: boolean; mediaPlayErrors?: string[] }) {
  const elements = new Map<string, ReturnType<typeof element>>();
  const audioUrls: string[] = [];
  const mediaPlayCalls: string[] = [];
  const mediaPlayErrors = [...(options.mediaPlayErrors ?? [])];
  const windowEvents = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const element = (id: string) => {
    const events = new Map<string, Array<(...args: unknown[]) => unknown>>();
    return {
      textContent: "", role: "", hidden: true, disabled: false,
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const handlers = events.get(type) ?? [];
        handlers.push(listener as unknown as (...args: unknown[]) => unknown); events.set(type, handlers);
      },
      async fire(type: string, ...args: unknown[]) {
        for (const listener of events.get(type) ?? []) await listener(...args);
      },
      listenerCount(type: string) { return events.get(type)?.length ?? 0; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 60 } as DOMRect),
      getContext: () => null,
      loop: false, src: "", paused: true, currentTime: 0, duration: 100, readyState: 1,
      play() {
        mediaPlayCalls.push(id);
        const name = mediaPlayErrors.shift();
        return name ? Promise.reject(Object.assign(new Error("fixture playback failure"), { name })) : Promise.resolve();
      },
      pause() {}, load() {},
    };
  };
  for (const id of ["runtime-status", "runtime-diagnostics", "disc-title", "start-menu", "menu-canvas", "menu-background", "menu-audio"]) elements.set(id, element(id));
  const document = { getElementById: (id: string) => elements.get(id) ?? null } as unknown as Document;
  const fakeWindow = {
    devicePixelRatio: 1,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const handlers = windowEvents.get(type) ?? [];
      handlers.push(listener as unknown as (...args: unknown[]) => unknown); windowEvents.set(type, handlers);
    },
    removeEventListener() {},
    async fire(type: string, ...args: unknown[]) { for (const listener of windowEvents.get(type) ?? []) await listener(...args); },
    listenerCount(type: string) { return windowEvents.get(type)?.length ?? 0; },
  };
  class FakeImage {
    src = "";
    decode() { return options.imageFailure ? Promise.reject(new Error("fixture decode failure")) : Promise.resolve(); }
  }
  class FakeAudio {
    constructor(url: string) { audioUrls.push(url); }
    play() { return Promise.resolve(); }
  }
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("__BDMV_MENU_DATA__", options.data);
  vi.stubGlobal("__BDMV_MENU_ASSETS__", options.assetBatches ?? []);
  return { elements, audioUrls, mediaPlayCalls, fakeWindow };
}

async function launch(data: Record<string, unknown>, options: { assetBatches?: unknown[][]; imageFailure?: boolean; mediaPlayErrors?: string[] } = {}) {
  vi.resetModules();
  const host = createHost({ data, ...options });
  await import("./browser.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return host;
}

afterEach(() => vi.unstubAllGlobals());

describe("offline browser boot", () => {
  it("shows a visible error for an unsupported schema and dangling DiscIR references", async () => {
    const unsupported = await launch(packageData({ ir: { ...validIr, schemaVersion: "2.0" } }));
    expect(unsupported.elements.get("runtime-status")?.role).toBe("alert");
    expect(unsupported.elements.get("runtime-diagnostics")?.textContent).toContain("Unsupported DiscIR schema version '2.0'");
    expect(unsupported.elements.get("start-menu")?.hidden).toBe(true);

    const danglingIr = structuredClone(validIr) as Record<string, unknown>;
    danglingIr.playlists = [{ id: "playlist-1", programIds: ["missing-program"], menuIds: [] }];
    const dangling = await launch(packageData({ ir: danglingIr }));
    expect(dangling.elements.get("runtime-status")?.role).toBe("alert");
    expect(dangling.elements.get("runtime-diagnostics")?.textContent).toContain("unresolved program reference");
    expect(dangling.elements.get("start-menu")?.hidden).toBe(true);

    const invalidEntry = await launch(packageData({ vmPrograms: [], vmInitialProgramId: 9 }), { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    expect(invalidEntry.elements.get("runtime-status")?.role).toBe("alert");
    expect(invalidEntry.elements.get("runtime-diagnostics")?.textContent).toContain("Invalid initial MovieObject 9");
    expect(invalidEntry.elements.get("start-menu")?.hidden).toBe(true);
  });

  it("reports PNG decode and scene asset-reference failures before enabling input", async () => {
    const batches = [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]];
    const decodeFailure = await launch(packageData(), { assetBatches: batches, imageFailure: true });
    expect(decodeFailure.elements.get("runtime-status")?.role).toBe("alert");
    expect(decodeFailure.elements.get("runtime-diagnostics")?.textContent).toContain("Could not decode embedded PNG 'logo'");
    expect(decodeFailure.elements.get("start-menu")?.hidden).toBe(true);

    const missingReference = await launch(packageData(), { assetBatches: [[{ id: "other", dataUrl: "data:image/png;base64,AA==" }]] });
    expect(missingReference.elements.get("runtime-status")?.role).toBe("alert");
    expect(missingReference.elements.get("runtime-diagnostics")?.textContent).toContain("references missing image 'logo'");
    expect(missingReference.elements.get("start-menu")?.hidden).toBe(true);
  });

  it("waits for the start gesture and restores the same initial menu state after reload without storage", async () => {
    const getItem = vi.fn(() => { throw new Error("persistent state must not be read"); });
    vi.stubGlobal("localStorage", { getItem });
    for (let reload = 0; reload < 2; reload++) {
      const host = await launch(packageData(), { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
      const start = host.elements.get("start-menu")!;
      expect(host.elements.get("disc-title")?.textContent).toBe("Boot test");
      expect(host.elements.get("runtime-status")?.textContent).toContain("Images decoded");
      expect(start.hidden).toBe(false);
      expect(host.fakeWindow.listenerCount("keydown")).toBe(0);

      await start.fire("click");
      expect(start.hidden).toBe(true);
      expect(host.fakeWindow.listenerCount("keydown")).toBe(1);
      await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
      await Promise.resolve();
      expect(host.audioUrls).toEqual(["assets/audio/sound-4.wav"]);
    }
    expect(getItem).not.toHaveBeenCalled();
  });

  it("routes a keyboard button activation through MenuController to the VM bridge and packaged sound", async () => {
    const data = packageData({
      scene: { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: {
          normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" },
          selected: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo", soundId: 4 },
        }, commands: [{ bytes: m3Fixtures.linkPlayItem3.bytes }],
      }] }] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");

    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });

    expect(host.audioUrls).toEqual(["assets/audio/sound-4.wav"]);
    expect(host.elements.get("runtime-status")?.textContent).toBe("Playback unavailable in menu-only preview (LINK_PLAY_ITEM).");
  });

  it("writes one concise summary for a complete VM command sequence", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const data = packageData({
      vmPrograms: [{ id: 0, instructions: [] }], vmInitialProgramId: undefined,
      scene: { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } },
        commands: [{ bytes: m3Fixtures.move5.bytes }, { bytes: "000000000000000000000000" }, { bytes: "000000000000000000000000" }],
      }] }] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(info).toHaveBeenCalledOnce();
    const summary = String(info.mock.calls[0]?.[0]);
    expect(summary).toContain("[VM] 3 steps");
    expect(summary).toContain("MOVE");
    expect(summary).toContain("NOP");
    expect(summary).toContain("status=running");
    expect(summary).not.toContain("[object Object]");
  });

  it("retries blocked menu media from the gesture without rerunning the initial VM action", async () => {
    const host = await launch(packageData({
      vmPrograms: [{ id: 7, instructions: ["228000000000000300000000"] }],
      media: { background: { path: "assets/media/background.mp4", loop: true }, audioTracks: [{ streamNumber: 0, path: "assets/media/audio-1100-eng.m4a", language: "eng" }] },
    }), { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]], mediaPlayErrors: ["NotAllowedError"] });
    const start = host.elements.get("start-menu")!;

    await start.fire("click");
    expect(host.elements.get("runtime-status")?.textContent).toMatch(/blocked.*retry/i);
    expect(start.hidden).toBe(false); expect(start.textContent).toBe("Retry menu media");
    expect(host.mediaPlayCalls).toEqual(["menu-background", "menu-audio"]);

    await start.fire("click");
    await start.fire("click");
    expect(host.mediaPlayCalls).toEqual(["menu-background", "menu-audio", "menu-background", "menu-audio"]);
    expect(start.hidden).toBe(true);
  });

  it("shows an unsupported media diagnostic without offering an autoplay retry", async () => {
    const host = await launch(packageData({
      vmPrograms: [{ id: 7, instructions: ["228000000000000300000000"] }],
      media: { background: { path: "assets/media/background.mp4", loop: true }, audioTracks: [{ streamNumber: 0, path: "assets/media/audio-1100-eng.m4a", language: "eng" }] },
    }), { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]], mediaPlayErrors: ["NotSupportedError"] });
    const start = host.elements.get("start-menu")!;

    await start.fire("click");

    expect(host.elements.get("runtime-status")?.textContent).toMatch(/format is not supported/i);
    expect(start.hidden).toBe(true);
    expect(host.mediaPlayCalls).toEqual(["menu-background", "menu-audio"]);
  });

});
