import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";
import { buildInputFileTable } from "@bdmv-web/bdmv-io";
import { DEFAULT_LIMITS } from "@bdmv-web/core";
import type { ParsedDisc } from "@bdmv-web/bdmv-parser";
import { extractIgsFromChunks, extractIgsScenes } from "../src/extract.js";
import { consumeSegment, createIgsState, parseSegments } from "../src/igs.js";
import { renderSceneAssets } from "../src/png.js";
import type { IgsSegment } from "../src/igs.js";
import { chunks, IG_PID, m2tsPacket, patPacket, PMT_PID, pmtPacket, pesPacket, syntheticClip, syntheticMenuSegments } from "./fixtures.js";

describe("synthetic IGS extraction", () => {
  it("reassembles a complete menu scene with page, BOG, button, object, palette and PNG source mapping", async () => {
    const bytes = syntheticClip();
    const result = await extractIgsFromChunks("00001", chunks(bytes, 13), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "100" } }]);
    expect(result.scenes).toHaveLength(1);
    const scene = result.scenes[0]!;
    expect(scene).toMatchObject({ clipId: "00001", pid: IG_PID, compositionNumber: 7, complete: true, pts90k: "90000" });
    expect(scene.pages[0]).toMatchObject({ id: 1, defaultSelectedButtonId: 1, paletteId: 0, bogs: [{ defaultButtonId: 1, buttonIds: [1] }] });
    expect(scene.pages[0]?.buttons[0]?.visuals.normal.startObjectId).toBe(5);
    expect([...scene.pages[0]!.buttons[0]!.commands[0]!.bytes]).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(scene.pages[0]!.buttons[0]!.commands[0]!.sourceOffset).toBe(String(406 + findBytes(syntheticMenuSegments(), Uint8Array.from({ length: 12 }, (_, i) => i + 1))));
    expect(scene.objects[0]).toMatchObject({ id: 5, version: 0, width: 1, height: 1 });
    expect([...scene.objects[0]!.indices]).toEqual([1]);
    expect(result.assets).toHaveLength(1);
    expect([...result.assets[0]!.pngBytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(result.assets[0]).toMatchObject({ objectId: 5, paletteId: 0, colorConversion: "bt709-limited-round-nearest", relativePath: expect.stringMatching(/^assets\/graphics\//) });
    expect(scene.source).toMatchObject({ clipId: "00001", pid: IG_PID, packetOffset: "384", pts90k: "90000" });
    expect(result.support.status).toBe("unverified");
  });

  it("is invariant to read block boundaries across packet, PES and segment bytes", async () => {
    const bytes = syntheticClip(); const summaries = [];
    for (const size of [1, 191, 192, 193, 4096]) {
      const result = await extractIgsFromChunks("00001", chunks(bytes, size), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
      summaries.push({ scenes: result.scenes.length, objects: result.scenes[0]?.objects.length, assets: result.assets.length, errors: result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code) });
    }
    expect(summaries.every((summary) => JSON.stringify(summary) === JSON.stringify(summaries[0]))).toBe(true);
    expect(summaries[0]).toEqual({ scenes: 1, objects: 1, assets: 1, errors: [] });
  });

  it("reassembles an IG segment whose header and body cross a PES boundary", async () => {
    const segments = syntheticMenuSegments();
    const splitAt = 17;
    const bytes = concat(
      patPacket(), pmtPacket(),
      m2tsPacket(IG_PID, pesPacket(segments.slice(0, splitAt), 90_000n), { cc: 0, pusi: true }),
      m2tsPacket(IG_PID, pesPacket(segments.slice(splitAt), 91_000n), { cc: 1, pusi: true }),
    );
    const result = await extractIgsFromChunks("00001", chunks(bytes, 192), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]?.complete).toBe(true);
    expect(result.scenes[0]?.objects.map((object) => object.id)).toEqual([5]);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("renders a sparse palette's omitted index as transparent zero", async () => {
    const result = await extractIgsFromChunks("00001", chunks(syntheticClip({ missingPaletteEntry: true }), 192), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]?.complete).toBe(true);
    expect(result.assets).toHaveLength(1);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const png = result.assets[0]!.pngBytes;
    const idatLength = (png[33]! << 24) | (png[34]! << 16) | (png[35]! << 8) | png[36]!;
    expect([...inflateSync(png.slice(41, 41 + idatLength))]).toEqual([0, 0, 0, 0, 0]);
  });

  it("maps one ODS through two palettes and preserves palette alpha in provisional PNG pixels", async () => {
    const result = await extractIgsFromChunks("00001", chunks(syntheticClip(), 192), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
    const scene = result.scenes[0]!;
    scene.pages.push({ ...scene.pages[0]!, id: 2, paletteId: 1 });
    scene.palettes.push({
      ...scene.palettes[0]!, id: 1,
      entries: new Map([[1, { y: 76, cr: 255, cb: 85, alpha: 173 }]]),
    });

    const rendered = renderSceneAssets(scene);
    expect(rendered.assets).toHaveLength(2);
    expect(rendered.assets.map((asset) => [asset.objectId, asset.objectVersion, asset.paletteId, asset.paletteVersion])).toEqual([[5, 0, 0, 0], [5, 0, 1, 0]]);
    expect(rendered.assets.map((asset) => asset.colorConversion)).toEqual([
      "bt709-limited-round-nearest",
      "bt709-limited-round-nearest",
    ]);
    expect(rendered.assets.map(decodePngRgbaPixel)).toEqual([[255, 255, 255, 255], [255, 11, 0, 173]]);
  });

  it("preserves page-scoped button IDs and defaults, and diagnoses invalid explicit references", async () => {
    const segments = syntheticMenuSegments({ twoPages: true, invalidReferences: true });
    const splitAt = 160;
    const bytes = concat(patPacket(), pmtPacket(),
      m2tsPacket(IG_PID, pesPacket(segments.slice(0, splitAt), 90_000n), { cc: 0, pusi: true }),
      m2tsPacket(IG_PID, pesPacket(segments.slice(splitAt), 91_000n), { cc: 1, pusi: true }));
    const result = await extractIgsFromChunks("00001", chunks(bytes, 192), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
    const scene = result.scenes[0]!;
    expect(scene.pages.map((page) => ({
      id: page.id,
      defaultSelectedButtonId: page.defaultSelectedButtonId,
      bogDefault: page.bogs[0]?.defaultButtonId,
      buttonIds: page.buttons.map((button) => button.id),
    }))).toEqual([
      { id: 1, defaultSelectedButtonId: 2, bogDefault: 2, buttonIds: [1] },
      { id: 2, defaultSelectedButtonId: 1, bogDefault: 1, buttonIds: [1] },
    ]);
    expect(scene.pages[0]?.scopeId).toBe(`${scene.id}:page:1`);
    expect(scene.pages[1]?.scopeId).toBe(`${scene.id}:page:2`);
    expect(scene.pages[0]?.buttons[0]?.scopeId).toBe(`${scene.id}:page:1:button:1`);
    expect(scene.pages[1]?.buttons[0]?.scopeId).toBe(`${scene.id}:page:2:button:1`);
    expect(scene.pages.map((page) => ({
      autoAction: page.buttons[0]?.autoAction,
      position: [page.buttons[0]?.x, page.buttons[0]?.y],
      neighbors: page.buttons[0]?.neighbors,
      visuals: [page.buttons[0]?.visuals.normal.startObjectId, page.buttons[0]?.visuals.selected.startObjectId, page.buttons[0]?.visuals.activated.startObjectId],
    }))).toEqual([
      { autoAction: true, position: [0, 0], neighbors: { up: 2, down: 0xffff, left: 0xffff, right: 0xffff }, visuals: [5, 5, 5] },
      { autoAction: false, position: [0, 0], neighbors: { up: 0xffff, down: 0xffff, left: 0xffff, right: 0xffff }, visuals: [5, 5, 5] },
    ]);
    const invalidReferences = result.diagnostics.filter((item) => item.code === "IGS_INVALID_BUTTON_REFERENCE");
    expect(invalidReferences.map((item) => item.details?.referenceKind)).toEqual(["page-default-selected", "bog-0-default", "neighbor-up"]);
    expect(invalidReferences.every((item) => item.affectedSceneIds.includes(scene.id))).toBe(true);
    expect(scene.complete).toBe(false);
  });

  it("validates page selection and activation sentinels in their distinct scopes", async () => {
    const extract = async (defaultSelectedButtonId: number, defaultActivatedButtonId: number) => {
      const result = await extractIgsFromChunks("00001", chunks(syntheticClip({ defaultSelectedButtonId, defaultActivatedButtonId }), 192), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
      return result.diagnostics.filter((item) => item.code === "IGS_INVALID_BUTTON_REFERENCE").map((item) => item.details);
    };

    // FFFE only has special meaning for default activation: use the current focus.
    expect(await extract(1, 0xfffe)).toEqual([]);
    // FFFF means dynamic selection / no activation, while selected FFFE is not a sentinel.
    expect(await extract(0xffff, 0xffff)).toEqual([]);
    expect(await extract(0xfffe, 0xfffe)).toEqual([expect.objectContaining({ referencedButtonId: 0xfffe, referenceKind: "page-default-selected" })]);
    // An explicit activation reference still has to name a button on the page.
    expect(await extract(1, 2)).toEqual([expect.objectContaining({ referencedButtonId: 2, referenceKind: "page-default-activated" })]);
  });

  it("keeps unknown effect semantics unverified and marks the page incomplete", async () => {
    const bytes = syntheticClip({ effects: true, richEffects: true, uiModelWithTimeouts: true, animated: true });
    const result = await extractIgsFromChunks("00001", chunks(bytes, 64), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
    expect(result.scenes).toHaveLength(1);
    const scene = result.scenes[0]!;
    expect(scene).toMatchObject({ streamModel: 0, uiModel: 1, compositionTimeout90k: "90000", selectionTimeout90k: "45000", userTimeoutDuration: 123, complete: false });
    expect(scene.pages[0]?.animationFrameRateCode).toBe(1);
    expect(scene.pages[0]?.buttons[0]?.visuals.normal).toMatchObject({ startObjectId: 5, endObjectId: 5, repeat: true });
    expect(scene.pages[0]?.buttons[0]?.visuals.selected).toMatchObject({ startObjectId: 5, endObjectId: 5, repeat: true });
    expect([...scene.pages[0]!.rawEffects.enter]).toEqual([1, 3, 0, 10, 0, 20, 0, 30, 0, 40, 1, 0, 0, 1, 1, 1, 0, 5, 3, 128, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6]);
    expect([...scene.pages[0]!.rawEffects.exit]).toEqual([0, 1, 0, 0, 2, 2, 0]);
    expect(scene.pages[0]?.rawEffects).toMatchObject({ enterEffectCount: 1, exitEffectCount: 1 });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "IGS_UNSUPPORTED_EFFECT", severity: "warning", affectedSceneIds: [scene.id], details: { pageId: 1, enterCount: 1, exitCount: 1 } }));
    expect(result.status).toBe("partial");
  });

  it("does not submit a Display Set when the END marker is missing", async () => {
    const bytes = syntheticClip({ includeEnd: false });
    const result = await extractIgsFromChunks("00001", chunks(bytes, 192), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
    expect(result.scenes).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain("IGS_UNCOMPLETED_DISPLAY_SET");
  });

  it("does not commit an EOF Display Set with an unfinished ODS fragment", async () => {
    const result = await extractIgsFromChunks("00001", chunks(syntheticClip({ includeEnd: false, incompleteObject: true }), 192), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
    expect(result.scenes).toHaveLength(0);
    expect(result.diagnostics.map((item) => item.code)).toContain("IGS_UNCOMPLETED_DISPLAY_SET");
    expect(result.diagnostics.map((item) => item.code)).toContain("IGS_INVALID_SEGMENT");
  });

  it("keeps complete object versions attached to the Display Set and epoch that received them", () => {
    const parsed = parseSegments(syntheticMenuSegments());
    const ics = parsed.segments.find((segment) => segment.type === 0x18)!;
    const palette = parsed.segments.find((segment) => segment.type === 0x14)!;
    const originalObject = parsed.segments.find((segment) => segment.type === 0x15)!;
    const state = createIgsState();
    const feed = (segment: IgsSegment, timeDomain: number) => consumeSegment(state, segment, "00001", IG_PID, { raw: 0n, epoch: 0n, normalized: 0n, timeDomain }, 0n, 0n, segment.offset, DEFAULT_LIMITS);

    feed(ics, 0); feed(palette, 0); feed(originalObject, 0); feed({ type: 0x80, data: new Uint8Array(), offset: 900n }, 0);
    const newerIcs = { ...ics, offset: 1000n };
    const newerPaletteData = palette.data.slice(); newerPaletteData[1] = 1;
    const newerPalette = { ...palette, data: newerPaletteData, offset: 1100n };
    const newerObjectData = originalObject.data.slice(); newerObjectData[2] = 1;
    feed(newerIcs, 1); feed(newerPalette, 1); feed({ ...originalObject, data: newerObjectData, offset: 1200n }, 1); feed({ type: 0x80, data: new Uint8Array(), offset: 1300n }, 1);

    expect(state.scenes.map((scene) => scene.objects.map((object) => object.version))).toEqual([[0], [1]]);
    expect(state.scenes.map((scene) => scene.palettes.map((item) => item.version))).toEqual([[0], [1]]);
    expect(state.objects.size).toBe(2);
  });

  it("discards an in-progress composition at an explicit time-domain boundary", () => {
    const ics = parseSegments(syntheticMenuSegments()).segments.find((segment) => segment.type === 0x18)!;
    const state = createIgsState();
    const feed = (segment: IgsSegment, timeDomain: number) => consumeSegment(state, segment, "00001", IG_PID, { raw: 0n, epoch: 0n, normalized: 0n, timeDomain }, 0n, 0n, segment.offset);
    feed(ics, 0);
    feed({ type: 0x80, data: new Uint8Array(), offset: 900n }, 1);
    expect(state.scenes).toHaveLength(0);
    expect(state.current.size).toBe(0);
    expect(state.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["IGS_TIME_DOMAIN_RESET", "IGS_ORPHAN_END"]));
  });

  it("reports a continuation without a first fragment and rejects aggregate active ODS bytes over budget", () => {
    const state = createIgsState();
    const src = { clipId: "00001", pid: IG_PID, packetOffset: 0n, pesOffset: 0n, segmentOffset: 0n, segmentFileOffset: 0n, pts90k: null, timeDomain: 0 };
    const continuation: IgsSegment = { type: 0x15, offset: 0n, data: Uint8Array.of(0, 5, 0, 0x40, 1) };
    consumeSegment(state, continuation, "00001", IG_PID, null, 0n, 0n, 0n);
    expect(state.diagnostics.map((item) => item.code)).toContain("UNRESOLVED_OBJECT");
    expect(state.pendingObjects.size).toBe(0);

    const smallBudget = { ...DEFAULT_LIMITS, maxReassemblyBytes: 1 };
    const firstFragment = (id: number): IgsSegment => ({ type: 0x15, offset: 0n, data: Uint8Array.of(0, id, 0, 0x80, 0, 0, 5, 0, 1, 0, 1, 1) });
    consumeSegment(state, firstFragment(5), "00001", IG_PID, null, 0n, 0n, 0n, smallBudget);
    consumeSegment(state, firstFragment(6), "00001", IG_PID, null, 0n, 0n, 0n, smallBudget);
    expect(state.diagnostics.map((item) => item.code)).toContain("LIMIT_EXCEEDED");
    expect(state.pendingObjects.size).toBe(1);
  });

  it("reassembles an ODS object split over consecutive segment deliveries", () => {
    const state = createIgsState();
    const sourcePts = { raw: 100n, epoch: 0n, normalized: 100n, timeDomain: 0 };
    const original = parseSegments(syntheticMenuSegments()).segments.find((segment) => segment.type === 0x15)!;
    const first = original.data.slice(0, 11); first[3] = 0x80;
    const continuation = Uint8Array.of(original.data[0]!, original.data[1]!, original.data[2]!, 0x40, ...original.data.slice(11));
    consumeSegment(state, { ...original, data: first }, "00001", IG_PID, sourcePts, 0n, 0n, 0n);
    expect(state.pendingObjects.size).toBe(1);
    consumeSegment(state, { ...original, data: continuation, offset: 20n }, "00001", IG_PID, sourcePts, 192n, 192n, 192n);
    expect(state.pendingObjects.size).toBe(0);
    expect([...state.objects.values()][0]).toMatchObject({ id: 5, version: 0, width: 1, height: 1, indices: Uint8Array.of(1) });
  });

  it.each([
    ["missing object", { missingObject: true }, "UNRESOLVED_OBJECT"],
    ["missing palette", { missingPalette: true }, "UNRESOLVED_PALETTE"],
    ["damaged object data", { malformedObject: true }, "IGS_INVALID_RLE"],
    ["unfinished object sequence", { incompleteObject: true }, "IGS_INCOMPLETE_OBJECT"],
  ] as const)("does not retain complete=true for %s", async (_name, fixtureOptions, diagnosticCode) => {
    const result = await extractIgsFromChunks("00001", chunks(syntheticClip(fixtureOptions), 192), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]?.complete).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain(diagnosticCode);
  });

  it.each([["object", 1, "UNRESOLVED_OBJECT"], ["palette", 2, "UNRESOLVED_PALETTE"]] as const)("clears incomplete scene and %s cache after transport damage", async (_name, resourceSegment, expectedDiagnostic) => {
    const parts = splitSegments(syntheticMenuSegments());
    const setup = concat(parts[0]!, parts[1]!, parts[2]!);
    const restarted = concat(parts[0]!, parts[resourceSegment]!, Uint8Array.of(0x80, 0, 0));
    const bytes = concat(
      patPacket(), pmtPacket(),
      m2tsPacket(IG_PID, pesPacket(setup, 90_000n), { cc: 0, pusi: true }),
      m2tsPacket(IG_PID, pesPacket(Uint8Array.of(0x80, 0, 0), 91_000n), { cc: 2, pusi: true }),
      m2tsPacket(IG_PID, pesPacket(restarted, 92_000n), { cc: 3, pusi: true }),
    );
    const result = await extractIgsFromChunks("00001", chunks(bytes, 192), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "0" } }]);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]?.complete).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("IGS_STREAM_INVALIDATED");
    expect(result.diagnostics.map((d) => d.code)).toContain(expectedDiagnostic);
  });

  it("rejects a PMT PID mismatch against the M1 MPLS/CLPI cue", async () => {
    const bytes = syntheticClip({ streamPid: IG_PID + 1 });
    const result = await extractIgsFromChunks("00001", chunks(bytes, 192), [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "99" } }]);
    const conflict = result.diagnostics.find((d) => d.code === "IGS_PID_CONFLICT");
    expect(conflict).toBeDefined();
    expect(conflict?.message).toContain(`${IG_PID} from BDMV/PLAYLIST/00001.mpls (primary) @ 99`);
    expect(conflict?.message).toContain(`${IG_PID + 1} from clip 00001 PMT PID ${PMT_PID} packet offset 192`);
    expect(JSON.parse(conflict?.details?.mplsClpiSources as string)).toEqual([{ pid: IG_PID, path: "BDMV/PLAYLIST/00001.mpls", origin: "primary", offset: "99" }]);
    expect(JSON.parse(conflict?.details?.pmtSources as string)).toEqual([{ streamPid: IG_PID + 1, clipId: "00001", pmtPid: PMT_PID, packetOffset: "192" }]);
    expect(result.scenes).toHaveLength(0);
  });

  it("does not discover a PG PMT stream as IGS when no structural cue exists", async () => {
    const result = await extractIgsFromChunks("00001", chunks(syntheticClip({ streamType: 0x90 }), 192));
    expect(result.scenes).toHaveLength(0);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("IGS_PID_CONFLICT");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "IGS_PID_UNRESOLVED", severity: "warning" }));
  });

  it.each(["STREAM/00001.m2ts", "BDMV/STREAM/00001.m2ts", "stream/00001.m2ts"])("maps virtual BDMV clip paths through a validated table keyed by %s", async (tablePath) => {
    const root = await mkdtemp(join(tmpdir(), "igs-path-map-"));
    try {
      const filePath = join(root, tablePath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, syntheticClip());
      const table = await buildInputFileTable(root, [tablePath]);
      const source = { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary" as const, offset: "0" };
      const disc = {
        schemaVersion: "1.0", analysisStage: "structural", root, entries: [], movieObjects: [], sounds: [],
        playlists: [{ id: "00001", version: "0200", playItems: [{ index: 0, clipId: "00001", codecId: "M2TS", stcId: 0, inTime45k: 0, outTime45k: 45_000, connectionCondition: 0, multiAngle: false, angleCount: 1, differentAudio: false, seamlessAngle: false, uoMask: "0", stillMode: 0, stillTime: 0, streams: [{ streamType: 1, pid: IG_PID, subPathId: null, subClipId: null, codingType: 0x91, language: null, source }], source }], marks: [], subPaths: [], source }],
        clips: [], graph: { nodes: [{ id: "clip:00001", type: "clip", state: "present", source: { path: "BDMV/STREAM/00001.m2ts", origin: "primary", offset: "0" } }], edges: [] },
        declarations: { entries: 0, movieObjects: 0, playlists: 1, playItems: 1, clips: 0, streams: 1, sounds: 0, unknown: 0 }, diagnostics: [], supportPrediction: { status: "partial", supported: [], unsupported: [], unverified: [] },
      } as unknown as ParsedDisc;
      const result = await extractIgsScenes(disc, { table, chunkSize: 192 });
      expect(result.scenes).toHaveLength(1);
      expect(result.diagnostics.map((item) => item.code)).not.toContain("BDMV_MISSING_STREAM");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("follows a streamType=2 IGS cue from primary clip 00004 to subpath clip 00005", async () => {
    const root = await mkdtemp(join(tmpdir(), "igs-subpath-map-"));
    try {
      await mkdir(join(root, "STREAM"), { recursive: true });
      await writeFile(join(root, "STREAM", "00005.m2ts"), syntheticClip());
      const table = await buildInputFileTable(root, ["STREAM/00005.m2ts"]);
      const playlistSource = { path: "BDMV/PLAYLIST/00003.mpls", origin: "primary" as const, offset: "112" };
      const subclipSource = { path: "BDMV/CLIPINF/00005.clpi", origin: "primary" as const, offset: "27" };
      const disc = {
        schemaVersion: "1.0", analysisStage: "structural", root, entries: [], movieObjects: [], sounds: [],
        playlists: [{
          id: "00003", version: "0200",
          playItems: [{ index: 0, clipId: "00004", codecId: "M2TS", stcId: 0, inTime45k: 0, outTime45k: 45_000, connectionCondition: 0, multiAngle: false, angleCount: 1, differentAudio: false, seamlessAngle: false, uoMask: "0", stillMode: 0, stillTime: 0,
            streams: [{ streamType: 2, pid: IG_PID, subPathId: 0, subClipId: 0, codingType: 0x91, language: null, source: playlistSource }], source: playlistSource }],
          marks: [], subPaths: [{ type: 0, repeat: false, items: [{ clipId: "00005", codecId: "M2TS", stcId: 0, inTime45k: 0, outTime45k: 45_000, syncPlayItemId: 0, syncPts45k: 0, source: playlistSource }], source: playlistSource }], source: playlistSource,
        }],
        clips: [{ id: "00005", version: "0200", programs: [{ sequenceStartSpn: 0, programMapPid: 100, streams: [{ pid: IG_PID, codingType: 0x91, language: null, source: subclipSource }], source: subclipSource }], cpi: [], source: subclipSource }],
        graph: { nodes: [
          { id: "clip:00004", type: "clip", state: "present", source: { path: "BDMV/STREAM/00004.m2ts", origin: "primary", offset: "0" } },
          { id: "clip:00005", type: "clip", state: "present", source: { path: "BDMV/STREAM/00005.m2ts", origin: "primary", offset: "0" } },
        ], edges: [] },
        declarations: { entries: 0, movieObjects: 0, playlists: 1, playItems: 1, clips: 1, streams: 1, sounds: 0, unknown: 0 }, diagnostics: [], supportPrediction: { status: "partial", supported: [], unsupported: [], unverified: [] },
      } as unknown as ParsedDisc;

      const result = await extractIgsScenes(disc, { table, chunkSize: 192 });
      expect(result.scenes).toHaveLength(1);
      expect(result.scenes[0]?.clipId).toBe("00005");
      expect(result.diagnostics.map((item) => item.code)).not.toContain("BDMV_MISSING_STREAM");
      expect(result.diagnostics.map((item) => item.code)).not.toContain("IGS_PID_CONFLICT");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("does not open an MPLS source path for a missing subpath clip", async () => {
    const root = await mkdtemp(join(tmpdir(), "igs-missing-subpath-"));
    try {
      await mkdir(join(root, "PLAYLIST"), { recursive: true });
      // If the missing clip node's MPLS source is mistaken for a STREAM path,
      // this file contains a valid synthetic scene and would be extracted.
      await writeFile(join(root, "PLAYLIST", "00003.mpls"), syntheticClip());
      const table = await buildInputFileTable(root, ["PLAYLIST/00003.mpls"]);
      const playlistSource = { path: "BDMV/PLAYLIST/00003.mpls", origin: "primary" as const, offset: "112" };
      const disc = {
        schemaVersion: "1.0", analysisStage: "structural", root, entries: [], movieObjects: [], sounds: [],
        playlists: [{
          id: "00003", version: "0200",
          playItems: [{ index: 0, clipId: "00004", codecId: "M2TS", stcId: 0, inTime45k: 0, outTime45k: 45_000, connectionCondition: 0, multiAngle: false, angleCount: 1, differentAudio: false, seamlessAngle: false, uoMask: "0", stillMode: 0, stillTime: 0,
            streams: [{ streamType: 2, pid: IG_PID, subPathId: 0, subClipId: 0, codingType: 0x91, language: null, source: playlistSource }], source: playlistSource }],
          marks: [], subPaths: [{ type: 0, repeat: false, items: [{ clipId: "00005", codecId: "M2TS", stcId: 0, inTime45k: 0, outTime45k: 45_000, syncPlayItemId: 0, syncPts45k: 0, source: playlistSource }], source: playlistSource }], source: playlistSource,
        }],
        clips: [],
        graph: { nodes: [{ id: "clip:00005", type: "clip", state: "missing", source: playlistSource }], edges: [] },
        declarations: { entries: 0, movieObjects: 0, playlists: 1, playItems: 1, clips: 0, streams: 1, sounds: 0, unknown: 0 }, diagnostics: [], supportPrediction: { status: "partial", supported: [], unsupported: [], unverified: [] },
      } as unknown as ParsedDisc;

      const result = await extractIgsScenes(disc, { table, chunkSize: 192 });
      expect(result.scenes).toHaveLength(0);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "BDMV_MISSING_STREAM", severity: "error" }));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("keeps render assets and diagnostics from a clip result without rendering it twice", async () => {
    const root = await mkdtemp(join(tmpdir(), "igs-single-render-"));
    try {
      await mkdir(join(root, "STREAM"), { recursive: true });
      await writeFile(join(root, "STREAM", "00001.m2ts"), syntheticClip({ effects: true }));
      const table = await buildInputFileTable(root, ["STREAM/00001.m2ts"]);
      const source = { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary" as const, offset: "0" };
      const disc = {
        schemaVersion: "1.0", analysisStage: "structural", root, entries: [], movieObjects: [], sounds: [],
        playlists: [{ id: "00001", version: "0200", playItems: [{ index: 0, clipId: "00001", codecId: "M2TS", stcId: 0, inTime45k: 0, outTime45k: 45_000, connectionCondition: 0, multiAngle: false, angleCount: 1, differentAudio: false, seamlessAngle: false, uoMask: "0", stillMode: 0, stillTime: 0, streams: [{ streamType: 1, pid: IG_PID, subPathId: null, subClipId: null, codingType: 0x91, language: null, source }], source }], marks: [], subPaths: [], source }],
        clips: [], graph: { nodes: [{ id: "clip:00001", type: "clip", state: "present", source: { path: "BDMV/STREAM/00001.m2ts", origin: "primary", offset: "0" } }], edges: [] },
        declarations: { entries: 0, movieObjects: 0, playlists: 1, playItems: 1, clips: 0, streams: 1, sounds: 0, unknown: 0 }, diagnostics: [], supportPrediction: { status: "partial", supported: [], unsupported: [], unverified: [] },
      } as unknown as ParsedDisc;

      const result = await extractIgsScenes(disc, { table, chunkSize: 192 });
      expect(result.scenes).toHaveLength(1);
      expect(result.assets).toHaveLength(1);
      expect(result.diagnostics.filter((item) => item.code === "IGS_UNSUPPORTED_EFFECT")).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function splitSegments(bytes: Uint8Array): Uint8Array[] {
  const segments: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length;) {
    const length = (bytes[offset + 1]! << 8) | bytes[offset + 2]!;
    segments.push(bytes.slice(offset, offset + length + 3)); offset += length + 3;
  }
  return segments;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function decodePngRgbaPixel(asset: { pngBytes: Uint8Array }): number[] {
  const png = asset.pngBytes;
  const idatLength = (png[33]! * 0x1000000) + (png[34]! << 16) + (png[35]! << 8) + png[36]!;
  const scanline = inflateSync(png.slice(41, 41 + idatLength));
  if (scanline[0] !== 0) throw new Error(`Unsupported PNG filter ${scanline[0]}`);
  return [...scanline.slice(1, 5)];
}
