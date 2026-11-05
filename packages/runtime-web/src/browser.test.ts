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
  const imageUrls: string[] = [];
  const mediaPlayErrors = [...(options.mediaPlayErrors ?? [])];
  const windowEvents = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const element = (id: string) => {
    const events = new Map<string, Array<(...args: unknown[]) => unknown>>();
    const classes = new Set<string>();
    return {
      textContent: "", role: "", hidden: true, disabled: false,
      classes,
      classList: {
        add: (name: string) => { classes.add(name); },
        remove: (name: string) => { classes.delete(name); },
        toggle: (name: string, force?: boolean) => { const next = force ?? !classes.has(name); if (next) classes.add(name); else classes.delete(name); return next; },
        contains: (name: string) => classes.has(name),
      },
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
  for (const id of ["runtime-status", "runtime-diagnostics", "start-menu", "menu-canvas", "menu-background", "menu-audio"]) elements.set(id, element(id));
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
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    private url = "";
    set src(value: string) { this.url = value; imageUrls.push(value); if (value.startsWith("http://127.0.0.1:")) queueMicrotask(() => this.onload?.()); }
    get src() { return this.url; }
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
  return { elements, audioUrls, imageUrls, mediaPlayCalls, fakeWindow };
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
      expect(host.elements.get("runtime-status")?.textContent).toContain("Images decoded");
      expect(host.elements.get("runtime-status")?.classes.has("is-visible")).toBe(true);
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

  it("routes a dynamic title to an external playlist and releases the VM wait", async () => {
    vi.stubGlobal("location", { hash: `#bridgePort=12345&bridgeToken=${"a".repeat(48)}` });
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const data = packageData({
      vmPrograms: [{ id: 7, instructions: [] }, { id: 8, instructions: ["228000000000002a00000000"] }],
      vmEntries: [{ id: "title:0", kind: "title", target: { objectType: "HDMV", playbackType: 0, target: 8, source }, source }],
      externalTargets: { playlists: [{ id: "00042", items: [{ index: 0, clipId: "00006", streamPath: "STREAM/00006.m2ts", present: true, sourceIn90k: "0", sourceOut90k: "90000" }], marks: [] }], complete: true, unknown: [] },
      scene: { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } },
        commands: [{ bytes: "218100000000000100000000" }],
      }] }] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await Promise.resolve();
    expect(host.imageUrls).toContain(`http://127.0.0.1:12345/open?token=${"a".repeat(48)}&clip=00006`);
    expect(host.elements.get("runtime-status")?.textContent).toContain("Default media player requested for STREAM/00006.m2ts");
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
      media: { playlist: 3, background: { path: "assets/media/background.mp4", loop: true }, audioTracks: [{ streamNumber: 0, path: "assets/media/audio-1100-eng.m4a", language: "eng" }] },
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
      media: { playlist: 3, background: { path: "assets/media/background.mp4", loop: true }, audioTracks: [{ streamNumber: 0, path: "assets/media/audio-1100-eng.m4a", language: "eng" }] },
    }), { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]], mediaPlayErrors: ["NotSupportedError"] });
    const start = host.elements.get("start-menu")!;

    await start.fire("click");

    expect(host.elements.get("runtime-status")?.textContent).toMatch(/format is not supported/i);
    expect(start.hidden).toBe(true);
    expect(host.mediaPlayCalls).toEqual(["menu-background", "menu-audio"]);
  });

  it("fades ordinary status toasts out but keeps a persistent one visible until the next update", async () => {
    vi.resetModules();
    const { createStatusToast } = await import("./browser.js");
    vi.useFakeTimers();
    try {
      const classes = new Set<string>();
      const host = {
        textContent: "",
        classList: {
          add: (name: string) => void classes.add(name),
          remove: (name: string) => void classes.delete(name),
          toggle: (name: string, force?: boolean) => { const next = force ?? !classes.has(name); if (next) classes.add(name); else classes.delete(name); return next; },
        },
      };
      const toast = createStatusToast(host, 1000);

      toast("Images decoded.");
      expect(host.textContent).toBe("Images decoded.");
      expect(classes.has("is-visible")).toBe(true);
      vi.advanceTimersByTime(999);
      expect(classes.has("is-visible")).toBe(true);
      vi.advanceTimersByTime(1);
      expect(classes.has("is-visible")).toBe(false);

      toast("Menu preview could not start.", { persist: true, error: true });
      expect(classes.has("is-visible")).toBe(true);
      expect(classes.has("is-error")).toBe(true);
      expect(classes.has("is-persistent")).toBe(true);
      vi.advanceTimersByTime(60_000);
      expect(classes.has("is-visible")).toBe(true);

      // A user-facing instruction stays on screen and accepts selection, but is not an error.
      toast("Open STREAM/00006.m2ts manually, or launch start-menu.sh.", { persist: true });
      expect(classes.has("is-error")).toBe(false);
      expect(classes.has("is-persistent")).toBe(true);
      vi.advanceTimersByTime(60_000);
      expect(classes.has("is-visible")).toBe(true);

      toast("Menu preview ready.");
      expect(classes.has("is-error")).toBe(false);
      expect(classes.has("is-persistent")).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(classes.has("is-visible")).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("applies the packaged player profile to the menu VM registers instead of falling back to defaults", async () => {
    const { createMenuVm } = await import("./browser.js");
    const decoded = (word: number, width = 3) => Array.from({ length: width }, (_, index) => String.fromCharCode((word >>> (8 * (width - 1 - index))) & 0xff)).join("");
    const registers = (profile?: Record<string, unknown>) => createMenuVm({
      ir: structuredClone(validIr), scene: null, vmPrograms: [{ id: 7, instructions: [] }],
      ...(profile ? { profile } : {}),
    } as Parameters<typeof createMenuVm>[0]).snapshot().registers.psr;

    const packaged = registers({ menuLanguage: "jpn", audioLanguage: "fre", subtitleLanguage: "ger", country: "JP", region: "A", outputProfile: "portable", videoProfiles: [], audioProfiles: [] });
    // PSR16 audio language, PSR17 subtitle, PSR18 menu language, PSR19 country, PSR20 region.
    expect([decoded(packaged[16]!), decoded(packaged[17]!), decoded(packaged[18]!), decoded(packaged[19]!, 2), packaged[20]]).toEqual(["fre", "ger", "jpn", "JP", 1]);

    // Without an embedded profile the VM falls back to its own product default (eng/US/A),
    // which is exactly the divergence from the conversion-time VM this test guards.
    const unpackaged = registers();
    expect([decoded(unpackaged[16]!), decoded(unpackaged[18]!), decoded(unpackaged[19]!, 2), unpackaged[20]]).toEqual(["eng", "eng", "US", 1]);
    expect(packaged[18]).not.toBe(unpackaged[18]);

    expect(() => createMenuVm({ ir: structuredClone(validIr), scene: null, profile: "jpn" } as unknown as Parameters<typeof createMenuVm>[0])).toThrow("Embedded player profile must be a JSON object.");
  });

});
