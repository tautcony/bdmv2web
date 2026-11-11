import { afterEach, describe, expect, it, vi } from "vitest";
import { m3Fixtures } from "@bdmv2web/hdmv";

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
  const audioElements: Array<{ url: string; muted: boolean }> = [];
  const mediaPlayCalls: string[] = [];
  const imageUrls: string[] = [];
  const mediaPlayErrors = [...(options.mediaPlayErrors ?? [])];
  const windowEvents = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const element = (id: string) => {
    const events = new Map<string, Array<(...args: unknown[]) => unknown>>();
    const classes = new Set<string>();
    return {
      textContent: "", role: "", hidden: true, disabled: false, title: "", muted: false,
      attributes: new Map<string, string>(),
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
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const handlers = events.get(type) ?? []; const target = listener as unknown as (...args: unknown[]) => unknown;
        events.set(type, handlers.filter((handler) => handler !== target));
      },
      setAttribute(name: string, value: string) { this.attributes.set(name, value); },
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
  for (const id of ["runtime-status", "runtime-status-copy", "runtime-diagnostics", "start-menu", "audio-mute-toggle", "menu-canvas", "popup-canvas", "menu-background", "menu-audio"]) elements.set(id, element(id));
  const document = { getElementById: (id: string) => elements.get(id) ?? null } as unknown as Document;
  const fakeWindow = {
    devicePixelRatio: 1,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const handlers = windowEvents.get(type) ?? [];
      handlers.push(listener as unknown as (...args: unknown[]) => unknown); windowEvents.set(type, handlers);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const handlers = windowEvents.get(type) ?? []; const target = listener as unknown as (...args: unknown[]) => unknown;
      windowEvents.set(type, handlers.filter((handler) => handler !== target));
    },
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
    muted = false;
    constructor(readonly url: string) { audioUrls.push(url); audioElements.push(this); }
    addEventListener(_type: string, _listener: () => void) {}
    play() { return Promise.resolve(); }
  }
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("__BDMV_MENU_DATA__", options.data);
  vi.stubGlobal("__BDMV_MENU_ASSETS__", options.assetBatches ?? []);
  return { elements, audioUrls, audioElements, imageUrls, mediaPlayCalls, fakeWindow };
}

async function launch(data: Record<string, unknown>, options: { assetBatches?: unknown[][]; imageFailure?: boolean; mediaPlayErrors?: string[] } = {}) {
  vi.resetModules();
  const host = createHost({ data, ...options });
  await import("./browser.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return host;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("runs the initial VM turn and keeps menu input active when the package has no media", async () => {
  const trace = vi.spyOn(console, "info").mockImplementation(() => {});
  const data = packageData({
    vmPrograms: [{ id: 7, instructions: [m3Fixtures.move5.bytes] }],
    scene: { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [
      { id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 2, left: 1, right: 1 }, states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } }, commands: [] },
      { id: 2, bog: 0, enabled: true, neighbors: { up: 1, down: 2, left: 2, right: 2 }, states: { normal: { bounds: { x: 40, y: 10, width: 20, height: 20 }, assetId: "logo" } }, commands: [{ bytes: m3Fixtures.move5.bytes }] },
    ] }] },
  });
  const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });

  await host.elements.get("start-menu")!.fire("click");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(host.elements.get("runtime-status")?.textContent).toContain("Menu preview ready");
  expect(host.fakeWindow.listenerCount("keydown")).toBe(1);
  expect(trace.mock.calls.flat().join(" ")).toContain("7:0 MOVE gpr[0],#5");
  expect(trace.mock.calls.flat().join(" ")).toContain("status=idle");

  await host.fakeWindow.fire("keydown", { code: "ArrowDown", preventDefault() {} });
  await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(trace.mock.calls.flat().join(" ")).toContain("button 2");
});

describe("browser boot", () => {
  it("opens a matching popup IGS overlay on POPUP_MENU and closes it on POPUP_OFF", async () => {
    const mainScene = packageData().scene as Record<string, unknown>;
    const data = packageData({
      scene: { ...mainScene, clipId: "00001", pid: 0x1200 },
      popupScenes: [{
        id: "00001:4608:popup", clipId: "00001", pid: 0x1200, uiModel: 1, streamModel: 0,
        width: 100, height: 60, compositionTimeout90k: null, selectionTimeout90k: null,
        pages: [{ id: 0, uoMask: "0", defaultButtonId: 1, animationFrameRateCode: 0, buttons: [{
          id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
          states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo", startObjectId: 1, endObjectId: 1 } },
          commands: [{ bytes: m3Fixtures.popupOff.bytes }],
        }] }],
      }],
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Escape", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.elements.get("popup-canvas")?.hidden).toBe(false);
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.elements.get("popup-canvas")?.hidden).toBe(true);
  });

  it("shows a visible error for an unsupported schema and a missing initial MovieObject", async () => {
    const unsupported = await launch(packageData({ ir: { ...validIr, schemaVersion: "2.0" } }));
    expect(unsupported.elements.get("runtime-status")?.role).toBe("alert");
    expect(unsupported.elements.get("runtime-diagnostics")?.textContent).toContain("Unsupported DiscIR schema version '2.0'");
    expect(unsupported.elements.get("start-menu")?.hidden).toBe(true);

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
    expect(host.elements.get("runtime-status")?.textContent).toBe("Playback unavailable in menu preview (LINK_PLAY_ITEM).");
  });

  it("copies the status message from the toast copy button", async () => {
    const copied: string[] = [];
    vi.stubGlobal("navigator", { userAgent: "test", clipboard: { writeText: (text: string) => { copied.push(text); return Promise.resolve(); } } });
    const data = packageData({
      scene: { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } },
        commands: [{ bytes: m3Fixtures.linkPlayItem3.bytes }],
      }] }] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    const message = host.elements.get("runtime-status")!.textContent;
    expect(message).toContain("LINK_PLAY_ITEM");
    await host.elements.get("runtime-status-copy")!.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(copied).toEqual([message]);
    expect(host.elements.get("runtime-status-copy")?.attributes.get("data-copied")).toBe("true");
  });

  it("routes a dynamic title to an external playlist and releases the VM wait", async () => {
    const location = { hash: "", href: "file:///menu/index.html" };
    vi.stubGlobal("location", location);
    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    vi.stubGlobal("__BDMV_BDMV_PATH__", "/fake/BDMV");
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const data = packageData({
      vmPrograms: [{ id: 7, instructions: [] }, { id: 8, instructions: ["228000000000002a00000000"] }],
      vmEntries: [{ id: "title:0", kind: "title", target: { objectType: "HDMV", playbackType: 0, target: 8, source }, source }],
      externalTargets: { playlists: [{ id: "00042", items: [{ index: 0, stcId: 0, clipId: "00006", streamPath: "STREAM/00006.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source }], marks: [] }], complete: true, unknown: [] },
      scene: { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } },
        commands: [{ bytes: "218100000000000100000000" }],
      }] }] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(location.href).toBe("iina://open?url=file%3A%2F%2F%2Ffake%2FBDMV%2FSTREAM%2F00006.m2ts&mpv_start=0");
    expect(host.elements.get("runtime-status")?.textContent).toContain("Requested STREAM/00006.m2ts in the external player.");
    expect(host.elements.get("menu-background")?.muted).toBe(true);

    await host.fakeWindow.fire("keyup", { code: "Enter" });
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    expect(location.href).toBe("iina://open?url=file%3A%2F%2F%2Ffake%2FBDMV%2FSTREAM%2F00006.m2ts&mpv_start=0");
    expect(host.elements.get("runtime-status")?.textContent).toContain("Requested STREAM/00006.m2ts in the external player.");
  });

  it("rejects an external stream path that does not match its Clip and reports the source", async () => {
    const location = { hash: "", href: "file:///menu/index.html" };
    vi.stubGlobal("location", location);
    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    vi.stubGlobal("__BDMV_BDMV_PATH__", "/fake/BDMV");
    const source = { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "12" };
    const data = packageData({
      vmPrograms: [{ id: 7, instructions: [] }, { id: 8, instructions: ["228000000000002a00000000"] }],
      vmEntries: [{ id: "title:0", kind: "title", target: { objectType: "HDMV", playbackType: 0, target: 8, source }, source }],
      externalTargets: { playlists: [{ id: "00042", items: [{ index: 0, stcId: 0, clipId: "00006", streamPath: "STREAM/00042.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source }], marks: [] }], complete: true, unknown: [] },
      scene: { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } },
        commands: [{ bytes: "218100000000000100000000" }],
      }] }] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });

    expect(location.href).toBe("file:///menu/index.html");
    expect(host.elements.get("runtime-status")?.textContent).toBe("EXTERNAL_TARGET_UNDECLARED: External target for Clip '00006' must use STREAM/00006.m2ts; received 'STREAM/00042.m2ts'. (BDMV/PLAYLIST/00001.mpls @ 12)");

    await host.fakeWindow.fire("keyup", { code: "Enter" });
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    expect(location.href).toBe("file:///menu/index.html");
    expect(host.elements.get("runtime-status")?.textContent).toBe("EXTERNAL_TARGET_UNDECLARED: External target for Clip '00006' must use STREAM/00006.m2ts; received 'STREAM/00042.m2ts'. (BDMV/PLAYLIST/00001.mpls @ 12)");
  });

  it("replaces startup input listeners without leaking duplicates when the first actions switch scenes", async () => {
    const mainScene = packageData().scene as Record<string, unknown>;
    const data = packageData({
      scene: { ...mainScene, id: "main-scene" },
      vmPrograms: [{ id: 7, instructions: ["228000000000000900000000"] }],
      media: { playlist: 9, background: { path: "assets/media/background.mp4", durationSeconds: 10, loop: true }, audioTracks: [{ streamNumber: 0, psrStreamNumber: 1, path: "assets/media/audio.m4a", durationSeconds: 10 }] },
      menuPlaylistIds: [9],
      menuScenes: [{ playlistId: 9, playItem: 0, scene: { width: 100, height: 60, clipId: "00002", pid: 0x1200, pages: [{ id: 0, defaultButtonId: 1, buttons: [{ id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } }, commands: [] }] }] } }],
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The startup dispatch switched to the playlist-9 scene and installed its
    // input listeners; the final installation must replace, not stack.
    expect(host.fakeWindow.listenerCount("keydown")).toBe(1);
    expect(host.elements.get("menu-canvas")?.listenerCount("pointerdown")).toBe(1);
  });

  it("switches to a packaged sub-menu PlayItem when a button emits LinkPI", async () => {
    const mainScene = packageData().scene as Record<string, unknown>;
    const menuScene = (clipId: string) => ({
      ...mainScene, clipId, pid: 0x1200, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } },
        commands: [{ bytes: m3Fixtures.linkPlayItem3.bytes }],
      }] }],
    });
    const data = packageData({
      scene: menuScene("00012"),
      vmPrograms: [{ id: 7, instructions: ["228000000000000900000000"] }],
      menuPlaylistIds: [9],
      media: { playlist: 9, playItem: 0, background: { path: "assets/media/playlist-00009-pi0/background.mp4", durationSeconds: 10, loop: true }, audioTracks: [] },
      menuScenes: [
        { playlistId: 9, playItem: 0, scene: menuScene("00012") },
        { playlistId: 9, playItem: 3, scene: menuScene("00013") },
      ],
      menuMedia: [{ playlist: 9, playItem: 3, background: { path: "assets/media/playlist-00009-pi3/background.mp4", durationSeconds: 1, loop: true }, audioTracks: [] }],
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    expect(host.elements.get("menu-background")?.src).toBe("assets/media/playlist-00009-pi0/background.mp4");

    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // LinkPI 3 stays inside playlist 9: the sub-menu scene replaces the
    // composition and its own PlayItem background replaces the loop.
    expect(host.elements.get("menu-background")?.src).toBe("assets/media/playlist-00009-pi3/background.mp4");
    expect(host.elements.get("runtime-status")?.textContent).not.toContain("not available");
  });

  it("selects the marked PlayItem scene for a PLAY_PLAYLIST_MARK request", async () => {
    const location = { hash: "", href: "file:///menu/index.html" };
    vi.stubGlobal("location", location);
    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    vi.stubGlobal("__BDMV_BDMV_PATH__", "/fake/BDMV");
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const menuButton = (objectHex: string) => ({ id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } }, commands: [{ bytes: `218200000000000${objectHex}00000000` }] });
    const data = packageData({
      vmPrograms: [{ id: 7, instructions: ["42c200000000000900000001"] }, { id: 8, instructions: ["228000000000002a00000000"] }, { id: 9, instructions: ["228000000000002b00000000"] }], // PLAY_PLAYLIST_MARK playlist 9 mark 1; objects 8/9 request playlists 42/43
      media: { playlist: 9, background: { path: "assets/media/background.mp4", durationSeconds: 10, loop: true }, audioTracks: [{ streamNumber: 0, psrStreamNumber: 1, path: "assets/media/audio.m4a", durationSeconds: 10 }] },
      menuPlaylistIds: [9],
      menuPlaylistMarks: [{ playlistId: 9, marks: [{ index: 0, playItemRef: 0 }, { index: 1, playItemRef: 1 }] }],
      menuScenes: [
        { playlistId: 9, playItem: 0, scene: { width: 100, height: 60, clipId: "00002", pid: 0x1200, pages: [{ id: 0, defaultButtonId: 1, buttons: [menuButton("8")] }] } },
        { playlistId: 9, playItem: 1, scene: { width: 100, height: 60, clipId: "00003", pid: 0x1200, pages: [{ id: 0, defaultButtonId: 1, buttons: [menuButton("9")] }] } },
      ],
      externalTargets: { playlists: [
        { id: "00042", items: [{ index: 0, stcId: 0, clipId: "00006", streamPath: "STREAM/00006.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source }], marks: [] },
        { id: "00043", items: [{ index: 0, stcId: 0, clipId: "00007", streamPath: "STREAM/00007.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source }], marks: [] },
      ], complete: true, unknown: [] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Mark 1 maps to PlayItem 1, whose scene requests playlist 43.
    expect(location.href).toBe("iina://open?url=file%3A%2F%2F%2Ffake%2FBDMV%2FSTREAM%2F00007.m2ts&mpv_start=0");
  });

  it("plays packaged playlist media when the package has no primary menu media", async () => {
    const mainScene = packageData().scene as Record<string, unknown>;
    const data = packageData({
      scene: { ...mainScene, id: "main-scene" },
      vmPrograms: [{ id: 7, instructions: ["228000000000000900000000"] }],
      menuPlaylistIds: [9],
      menuScenes: [{ playlistId: 9, playItem: 0, scene: { width: 100, height: 60, clipId: "00002", pid: 0x1200, pages: [{ id: 0, defaultButtonId: 1, buttons: [{ id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 }, states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } }, commands: [] }] }] } }],
      menuMedia: [{ playlist: 9, background: { path: "assets/media/playlist-9/background.mp4", durationSeconds: 10, loop: true }, audioTracks: [{ streamNumber: 0, psrStreamNumber: 1, path: "assets/media/playlist-9/audio.m4a", durationSeconds: 10 }] }],
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.mediaPlayCalls).toContain("menu-background");
    expect(host.elements.get("runtime-status")?.textContent).not.toContain("unavailable");
  });

  it("completes a packaged pre-menu intro without handing it to the external player", async () => {
    const location = { hash: "", href: "file:///menu/index.html" };
    vi.stubGlobal("location", location);
    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    vi.stubGlobal("__BDMV_BDMV_PATH__", "/fake/BDMV");
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const data = packageData({
      vmPrograms: [{ id: 7, instructions: ["228000000000000d00000000"] }],
      preMenuPlaylistIds: [13],
      externalTargets: { playlists: [{ id: "00013", items: [{ index: 0, stcId: 0, clipId: "00004", streamPath: "STREAM/00004.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source }], marks: [] }], complete: true, unknown: [] },
      media: { playlist: 4, background: { path: "assets/media/background.mp4", durationSeconds: 10, loop: true }, audioTracks: [{ streamNumber: 0, psrStreamNumber: 1, path: "assets/media/audio.m4a", durationSeconds: 10 }] },
    });
    const host = await launch(data);
    await host.elements.get("start-menu")!.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(location.href).toBe("file:///menu/index.html");
    expect(host.elements.get("runtime-status")?.textContent).not.toContain("external player");
  });

  it("restores an automatic external mute on page input but keeps a manual mute", async () => {
    const location = { hash: "", href: "file:///menu/index.html" };
    vi.stubGlobal("location", location);
    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    vi.stubGlobal("__BDMV_BDMV_PATH__", "/fake/BDMV");
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const data = packageData({
      vmPrograms: [{ id: 7, instructions: [] }, { id: 8, instructions: ["228000000000002a00000000"] }],
      vmEntries: [{ id: "title:0", kind: "title", target: { objectType: "HDMV", playbackType: 0, target: 8, source }, source }],
      externalTargets: { playlists: [{ id: "00042", items: [{ index: 0, stcId: 0, clipId: "00006", streamPath: "STREAM/00006.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source }], marks: [] }], complete: true, unknown: [] },
      media: { playlist: 9, background: { path: "assets/media/background.mp4", loop: true }, audioTracks: [{ streamNumber: 0, path: "assets/audio/menu.m4a" }] },
      scene: { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" }, selected: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo", soundId: 4 } },
        commands: [{ bytes: "218100000000000100000000" }],
      }] }] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.elements.get("menu-background")?.muted).toBe(true);
    expect(host.elements.get("menu-audio")?.muted).toBe(true);
    expect(host.audioElements.at(-1)?.muted).toBe(true);

    await host.fakeWindow.fire("keydown", { code: "ArrowRight", preventDefault() {} });
    expect(host.elements.get("menu-background")?.muted).toBe(false);
    expect(host.elements.get("menu-audio")?.muted).toBe(false);
    expect(host.audioElements.every((audio) => !audio.muted)).toBe(true);

    await host.fakeWindow.fire("keyup", { code: "Enter" });
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.elements.get("menu-background")?.muted).toBe(true);
    expect(host.elements.get("menu-audio")?.muted).toBe(true);
    await host.fakeWindow.fire("pointerdown", { target: null });
    expect(host.elements.get("menu-background")?.muted).toBe(false);
    expect(host.elements.get("menu-audio")?.muted).toBe(false);

    await host.elements.get("audio-mute-toggle")!.fire("click");
    expect(host.elements.get("menu-background")?.muted).toBe(true);
    expect(host.elements.get("menu-audio")?.muted).toBe(true);
    await host.fakeWindow.fire("keydown", { code: "ArrowLeft", preventDefault() {} });
    await host.fakeWindow.fire("pointerdown", { target: null });
    expect(host.elements.get("menu-background")?.muted).toBe(true);
    expect(host.elements.get("menu-audio")?.muted).toBe(true);
    expect(host.audioElements.every((audio) => audio.muted)).toBe(true);
  });

  it("keeps a manual mute across an external handoff and later page input", async () => {
    const location = { hash: "", href: "file:///menu/index.html" };
    vi.stubGlobal("location", location);
    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    vi.stubGlobal("__BDMV_BDMV_PATH__", "/fake/BDMV");
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const data = packageData({
      vmPrograms: [{ id: 7, instructions: [] }, { id: 8, instructions: ["228000000000002a00000000"] }],
      vmEntries: [{ id: "title:0", kind: "title", target: { objectType: "HDMV", playbackType: 0, target: 8, source }, source }],
      externalTargets: { playlists: [{ id: "00042", items: [{ index: 0, stcId: 0, clipId: "00006", streamPath: "STREAM/00006.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source }], marks: [] }], complete: true, unknown: [] },
      media: { playlist: 9, background: { path: "assets/media/background.mp4", loop: true }, audioTracks: [{ streamNumber: 0, path: "assets/audio/menu.m4a" }] },
      scene: { width: 100, height: 60, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" }, selected: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo", soundId: 4 } },
        commands: [{ bytes: "218100000000000100000000" }],
      }] }] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.elements.get("audio-mute-toggle")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.elements.get("menu-background")?.muted).toBe(true);
    expect(host.elements.get("menu-audio")?.muted).toBe(true);
    expect(host.audioElements.at(-1)?.muted).toBe(true);
    await host.fakeWindow.fire("keydown", { code: "ArrowRight", preventDefault() {} });
    expect(host.elements.get("menu-background")?.muted).toBe(true);
    expect(host.elements.get("menu-audio")?.muted).toBe(true);
    expect(host.audioElements.every((audio) => audio.muted)).toBe(true);
  });

  it("switches to packaged menu IGS data for a menu playlist", async () => {
    const location = { hash: "", href: "file:///menu/index.html" };
    vi.stubGlobal("location", location);
    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    vi.stubGlobal("__BDMV_BDMV_PATH__", "/fake/BDMV");
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const baseScene = packageData().scene as Record<string, unknown>;
    const page = (baseScene.pages as Array<Record<string, unknown>>)[0]!;
    const targetScene = { ...baseScene, width: 80, height: 40, pages: [{ ...page, id: 2 }] };
    const data = packageData({
      vmPrograms: [{ id: 7, instructions: ["228000000000000400000000"] }, { id: 8, instructions: [m3Fixtures.playPlaylist42] }],
      scene: { ...baseScene, pages: [{ ...page, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 } }, selected: { bounds: { x: 10, y: 10, width: 20, height: 20 } } },
        commands: ["218000000000000800000000"],
      }] }] },
      menuPlaylistIds: [42], menuScenes: [{ playlistId: 42, scene: targetScene }],
      media: { playlist: 4, background: { path: "assets/media/background.mp4", durationSeconds: 10, loop: true }, audioTracks: [{ streamNumber: 0, psrStreamNumber: 1, path: "assets/media/audio.m4a", durationSeconds: 10 }] },
      externalTargets: { playlists: [{ id: "00042", items: [{ index: 0, stcId: 0, clipId: "00006", streamPath: "STREAM/00006.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source }], marks: [] }], complete: true, unknown: [] },
    });
    const host = await launch(data);
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await Promise.resolve();
    expect(location.href).toBe("file:///menu/index.html");
    expect(host.elements.get("runtime-status")?.textContent).not.toContain("external player");
  });

  it("routes PLAY_PLAYLIST_ITEM to its menu scene with video-only background media", async () => {
    const baseScene = packageData().scene as Record<string, unknown>;
    const page = (baseScene.pages as Array<Record<string, unknown>>)[0]!;
    const targetScene = { ...baseScene, width: 80, height: 40, pages: [{ ...page, id: 2 }] };
    const data = packageData({
      vmPrograms: [{ id: 7, instructions: ["428100000000004800000007"] }],
      menuPlaylistIds: [72], menuScenes: [{ playlistId: 72, playItem: 0, scene: targetScene }],
      media: { playlist: 72, background: { path: "assets/media/background.mp4", durationSeconds: 1, loop: true }, audioTracks: [] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.elements.get("menu-background")?.src).toBe("assets/media/background.mp4");
    expect(host.elements.get("menu-audio")?.src).toBe("");
    expect(host.elements.get("runtime-status")?.textContent).not.toContain("no packaged IGS composition");
  });

  it("hands a popup-only content playlist to the external player", async () => {
    const location = { hash: "", href: "file:///menu/index.html" };
    vi.stubGlobal("location", location);
    vi.stubGlobal("navigator", { userAgent: "Macintosh; Intel Mac OS X" });
    vi.stubGlobal("__BDMV_BDMV_PATH__", "/fake/BDMV");
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const baseScene = packageData().scene as Record<string, unknown>;
    const page = (baseScene.pages as Array<Record<string, unknown>>)[0]!;
    const popupScene = { ...baseScene, clipId: "00017", pid: 0x1400, uiModel: 1, width: 80, pages: [{ ...page, id: 2 }] };
    const data = packageData({
      vmPrograms: [{ id: 7, instructions: ["228000000000001200000000"] }],
      popupScenes: [popupScene],
      media: { playlist: 4, background: { path: "assets/media/background.mp4", durationSeconds: 10, loop: true }, audioTracks: [{ streamNumber: 0, psrStreamNumber: 1, path: "assets/media/audio.m4a", durationSeconds: 10 }] },
      externalTargets: { playlists: [{ id: "00018", items: [{ index: 0, stcId: 0, clipId: "00032", streamPath: "STREAM/00032.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source }], marks: [] }], complete: true, unknown: [] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(location.href).toBe("iina://open?url=file%3A%2F%2F%2Ffake%2FBDMV%2FSTREAM%2F00032.m2ts&mpv_start=0");
    expect(host.elements.get("popup-canvas")?.hidden).toBe(true);
  });

  it("returns to the packaged main-menu scene when its active playlist is requested", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const source = { path: "BDMV/index.bdmv", origin: "primary", offset: "0" };
    const baseScene = packageData().scene as Record<string, unknown>;
    const basePage = (baseScene.pages as Array<Record<string, unknown>>)[0]!;
    const mainMenuScene = { ...baseScene, clipId: "menu-main", pid: 0x1200, width: 80, pages: [{ ...basePage, id: 2, autoAction: true, buttons: [{
      id: 1, bog: 0, enabled: true, autoAction: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
      states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 } }, selected: { bounds: { x: 10, y: 10, width: 20, height: 20 } } },
      commands: [{ bytes: "110000070000000000000000" }],
    }] }] };
    const data = packageData({
      scene: { ...baseScene, clipId: "menu-child", pid: 0x1200, pages: [{ ...basePage, buttons: [{
        id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
        states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 } }, selected: { bounds: { x: 10, y: 10, width: 20, height: 20 } } },
        commands: [{ bytes: m3Fixtures.jumpObject1.bytes }],
      }] }] },
      vmPrograms: [{ id: 7, instructions: [] }, { id: 1, instructions: ["228000000000000400000000"] }],
      menuPlaylistIds: [4], menuScenes: [{ playlistId: 4, scene: mainMenuScene }],
      media: { playlist: 4, background: { path: "assets/media/background.mp4", durationSeconds: 10, loop: true }, audioTracks: [{ streamNumber: 0, psrStreamNumber: 1, path: "assets/media/audio.m4a", durationSeconds: 10 }] },
      externalTargets: { playlists: [{ id: "00004", items: [{ index: 0, stcId: 0, clipId: "00006", streamPath: "STREAM/00006.m2ts", present: true, sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000", source }], marks: [] }], complete: true, unknown: [] },
    });
    const host = await launch(data, { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(info.mock.calls.some(([message]) => String(message).includes("POPUP_OFF"))).toBe(true);
    expect(host.elements.get("runtime-status")?.textContent).not.toContain("external player");
    info.mockRestore();
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
    // The line names the scene and the control that ran it, so it can be read
    // without the rest of the session.
    expect(summary).toContain("[VM] clip ? pid ? · button 1 (page 0) | 3 steps |");
    expect(summary).toContain("MOVE");
    expect(summary).toContain("NOP");
    expect(summary).toContain("status=running");
    expect(summary).not.toContain("[object Object]");
  });

  it("reports the packaged scene and background a LinkPI jump reached", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const mainScene = packageData().scene as Record<string, unknown>;
    const menuScene = (clipId: string) => ({ ...mainScene, clipId, pid: 0x1200, pages: [{ id: 0, defaultButtonId: 1, buttons: [{
      id: 1, bog: 0, enabled: true, neighbors: { up: 1, down: 1, left: 1, right: 1 },
      states: { normal: { bounds: { x: 10, y: 10, width: 20, height: 20 }, assetId: "logo" } },
      commands: [{ bytes: m3Fixtures.linkPlayItem3.bytes }],
    }] }] });
    const host = await launch(packageData({
      scene: menuScene("00012"),
      vmPrograms: [{ id: 7, instructions: ["228000000000000900000000"] }],
      menuPlaylistIds: [9],
      media: { playlist: 9, playItem: 0, background: { path: "assets/media/playlist-00009-pi0/background.mp4", durationSeconds: 10, loop: true }, audioTracks: [] },
      menuScenes: [{ playlistId: 9, playItem: 0, scene: menuScene("00012") }, { playlistId: 9, playItem: 3, scene: menuScene("00013") }],
      menuMedia: [{ playlist: 9, playItem: 3, background: { path: "assets/media/playlist-00009-pi3/background.mp4", durationSeconds: 1, loop: true }, audioTracks: [] }],
    }), { assetBatches: [[{ id: "logo", dataUrl: "data:image/png;base64,AA==" }]] });
    await host.elements.get("start-menu")!.fire("click");
    await host.fakeWindow.fire("keydown", { code: "Enter", preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lines = info.mock.calls.map(([message]) => String(message));
    expect(lines).toContain("[menu] button 1 (page 0) LINK_PI 3 → playlist 9 PlayItem 3 → clip 00013 pid 0x1200 · background playlist-00009-pi3");
    info.mockRestore();
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

  it("applies the packaged player profile to the menu VM registers", async () => {
    const { createMenuVm } = await import("./browser.js");
    const decoded = (word: number, width = 3) => Array.from({ length: width }, (_, index) => String.fromCharCode((word >>> (8 * (width - 1 - index))) & 0xff)).join("");
    const registers = (profile?: Record<string, unknown>) => createMenuVm({
      ir: structuredClone(validIr), scene: null, vmPrograms: [{ id: 7, instructions: [] }],
      ...(profile ? { profile } : {}),
    }).snapshot().registers.psr;

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

  it("applies packaged Limits to the menu VM and its trace", async () => {
    const { createMenuVm } = await import("./browser.js");
    const limits = { maxReadWindowBytes: 4096, maxSegmentBytes: 8192, maxReassemblyBytes: 16384, maxObjectPixels: 1024, maxInstructionsPerTurn: 77, maxQueueDepth: 12, maxCallDepth: 0, maxExplorationStates: 100, maxOutputBytes: null };
    const vm = createMenuVm({ ir: structuredClone(validIr), scene: null, limits });
    expect(vm.limits).toEqual(limits);
    expect(vm.trace[0]?.limits).toEqual(limits);
  });

});
