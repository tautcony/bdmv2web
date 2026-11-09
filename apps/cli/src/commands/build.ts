import { flagEnabled, inputPath, optionNumber, optionState, optionValue, strictDefault } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { loadLimits, loadPlayerProfile } from "../cli/profile.js";
import { deliveryDiagnostics, firstBlockingCode, stageFailure } from "../cli/stages.js";
import { ProgressReporter } from "../progress.js";
import { buildMediaClosure } from "../shared/media.js";
import { referencedAssetIds, safeDiagnosticMessage } from "./extract.js";
import { readJsonObject } from "../cli/output.js";
import { assertDisjointRoots, beginOutputTransaction, locateBdmvRoot, resolveInputFile } from "@bdmv2web/bdmv-io";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { parseDiscIR } from "@bdmv2web/core";
import { HdmvVm } from "@bdmv2web/hdmv";
import { extractIgsScenes } from "@bdmv2web/igs";
import { createExternalMediaTargets, resolveMenuLoopStart45k } from "@bdmv2web/media-export";
import { buildMenuPackage, type MenuMediaEncoding } from "@bdmv2web/package-builder";
import { adaptIgsScene } from "@bdmv2web/runtime-web";
import { classifyDiagnostics, decideDelivery } from "@bdmv2web/test-runner";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import type { ProgressMode } from "../progress.js";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";
import type { DiscIR, Limits, PlayerProfile } from "@bdmv2web/core";

/** Menu media encoder settings from `--crf`, `--preset`, `--codec` and `--hdr`. */
export function menuMediaEncoding(): MenuMediaEncoding | undefined {
  const crf = optionNumber("--crf");
  const preset = optionValue("--preset");
  const codec = optionValue("--codec");
  const hdrMode = optionValue("--hdr");
  const encoding: MenuMediaEncoding = {};
  if (crf !== undefined) encoding.crf = crf;
  if (preset !== undefined) encoding.preset = preset as NonNullable<MenuMediaEncoding["preset"]>;
  if (codec !== undefined) encoding.codec = codec as NonNullable<MenuMediaEncoding["codec"]>;
  if (hdrMode !== undefined) encoding.hdrMode = hdrMode as NonNullable<MenuMediaEncoding["hdrMode"]>;
  return Object.keys(encoding).length ? encoding : undefined;
}

export function menuIgsSceneTargets(disc: ParsedDisc, playlist: ParsedDisc["playlists"][number], playItemIndex?: number): Array<{ clipId: string; pid: number }> {
  const targets: Array<{ clipId: string; pid: number }> = [];
  for (const item of playlist.playItems) {
    if (playItemIndex !== undefined && item.index !== playItemIndex) continue;
    const hasExplicitPrimaryIg = item.streams.some((stream) => stream.codingType === 0x91 && stream.streamType === 1 && stream.pid !== null);
    for (const stream of item.streams) {
      if (stream.codingType !== 0x91 || stream.pid === null) continue;
      if (stream.streamType === 1) {
        targets.push({ clipId: item.clipId, pid: stream.pid });
      } else if (stream.streamType === 2 && stream.subPathId !== null && stream.subClipId !== null) {
        const clip = playlist.subPaths[stream.subPathId]?.items[stream.subClipId];
        if (clip) targets.push({ clipId: clip.clipId, pid: stream.pid });
      }
    }
    // extractIgsScenes also accepts CLPI cues for primary clips when MPLS has no
    // explicit IG stream. Keep that proven playlist-to-clip association here,
    // while letting an explicit MPLS PID take precedence for the same clip.
    if (!hasExplicitPrimaryIg) {
      const clipInfo = disc.clips.find((clip) => clip.id.toLocaleLowerCase("en-US") === item.clipId.toLocaleLowerCase("en-US"));
      for (const stream of clipInfo?.programs.flatMap((program) => program.streams) ?? []) {
        if (stream.codingType === 0x91 && stream.pid !== null) targets.push({ clipId: item.clipId, pid: stream.pid });
      }
    }
  }
  return [...new Map(targets.map((target) => [`${target.clipId.toLocaleLowerCase("en-US")}\0${target.pid}`, target])).values()];
}

export function findMenuScene(disc: ParsedDisc, playlist: ParsedDisc["playlists"][number], scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"], playItemIndex?: number) {
  const targets = menuIgsSceneTargets(disc, playlist, playItemIndex);
  const matches = scenes.filter((scene) => targets.some((target) => target.clipId.toLocaleLowerCase("en-US") === scene.clipId.toLocaleLowerCase("en-US") && target.pid === scene.pid));
  const unique = [...new Map(matches.map((scene) => [`${scene.clipId.toLocaleLowerCase("en-US")}\0${scene.pid}\0${scene.source.segmentFileOffset}`, scene])).values()];
  if (unique.length === 1) return { status: "found" as const, scene: unique[0]! };
  if (unique.length === 0) return { status: "not-found" as const };
  return { status: "ambiguous" as const, scenes: unique };
}

export function createMenuDiscIR(disc: ParsedDisc, sceneRecords: Array<{ id: string; clipId: string }>, exportsMenuMedia: boolean): DiscIR {
  const diagnostics: DiscIR["diagnostics"] = disc.diagnostics.map((item) => ({
    severity: item.severity === "fatal" ? "fatal" : item.severity === "error" ? "error" : item.severity === "warning" ? "warning" : "info",
    code: item.code, message: safeDiagnosticMessage(item.message, disc.root), sourcePath: null, offset: null,
    entityId: null, action: null, recoverable: item.recoverable, stage: "structural", affectedEntryIds: [],
  }));
  const entries: DiscIR["entries"] = [];
  for (const entry of disc.entries) {
    const source = { path: "source/structural", origin: "primary" as const, byteOffset: "0" };
    if (entry.target.objectType === "HDMV" && typeof entry.target.target === "number") entries.push({ id: entry.id, navigation: { type: "HDMV", movieObjectId: entry.target.target }, source });
    else if (entry.target.objectType === "BDJ" && typeof entry.target.target === "string") entries.push({ id: entry.id, navigation: { type: "BDJ", bdjoId: entry.target.target, status: "unsupported" }, source });
    else diagnostics.push({ severity: "warning", code: "M4_ENTRY_NOT_PROJECTED", message: `Entry ${entry.id} has no supported navigation target and was omitted.`, sourcePath: null, offset: null, entityId: null, action: null, recoverable: true, stage: "structural", affectedEntryIds: [] });
  }
  if (!exportsMenuMedia) diagnostics.push({ severity: "warning", code: "M4_MEDIA_METADATA_NOT_PROJECTED", message: "Source video stream and playback metadata are not included in the menu package.", sourcePath: null, offset: null, entityId: null, action: null, recoverable: true, stage: "structural", affectedEntryIds: [] });
  const programs = disc.playlists.map((playlist, index) => ({ id: `program-${index}`, title: `Playlist ${playlist.id}` }));
  const menus = sceneRecords.map((_, index) => ({ id: `menu-${index}` }));
  const playlists: DiscIR["playlists"] = disc.playlists.map((playlist, index) => {
    const clipIds = new Set([
      ...playlist.playItems.map((item) => item.clipId),
      ...playlist.subPaths.flatMap((subPath) => subPath.items.map((item) => item.clipId)),
    ].map((clipId) => clipId.toLocaleLowerCase("en-US")));
    return { id: `playlist-${index}`, programIds: [`program-${index}`], menuIds: sceneRecords.flatMap((scene, sceneIndex) => clipIds.has(scene.clipId.toLocaleLowerCase("en-US")) ? [`menu-${sceneIndex}`] : []) };
  });
  return parseDiscIR({ schemaVersion: "1.0", entries, programs, menus, playlists, mediaAssets: [], diagnostics });
}

export interface MenuPlaylistTarget {
  playlist: ParsedDisc["playlists"][number];
  playItem: number;
  playMark?: number;
  /** Playlists the Top Menu chain completes before the menu surface. */
  preMenuPlaylistIds?: number[];
}

export function findTopMenuPlaylist(disc: ParsedDisc, profile: PlayerProfile, limits: Limits, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]): MenuPlaylistTarget | undefined {
  const firstPlay = disc.entries.find((entry) => entry.kind === "firstPlay" && entry.target.objectType === "HDMV");
  const topMenu = disc.entries.find((entry) => entry.kind === "topMenu" && entry.target.objectType === "HDMV");
  if (typeof firstPlay?.target.target !== "number" || typeof topMenu?.target.target !== "number") return undefined;
  const menuSceneKeys = new Set(scenes.filter((scene) => scene.uiModel === 0).map((scene) => `${scene.clipId.toLocaleLowerCase("en-US")}\0${scene.pid}`));
  const menuTarget = (playlist: ParsedDisc["playlists"][number], playItem: number): MenuPlaylistTarget | undefined => {
    const hasScene = menuIgsSceneTargets(disc, playlist, playItem).some((target) => menuSceneKeys.has(`${target.clipId.toLocaleLowerCase("en-US")}\0${target.pid}`));
    return hasScene ? { playlist, playItem } : undefined;
  };
  const vm = new HdmvVm(disc.movieObjects, { entries: disc.entries, profile, limits });
  // First Play may initialize PSRs/GPRs before it jumps to a feature title.
  // Run that initialization, then enter the explicit index.bdmv Top Menu entry
  // via selectTitle(0). The menu playlist is the first reachable Playlist with a
  // menu IGS scene, not necessarily the first PLAY_PLAYLIST (some discs play a
  // logo or warning first). Media waits are completed to continue that chain.
  vm.reset(firstPlay.target.target);
  const startup = vm.runTurn();
  if (startup.waiting) vm.releaseExternalPlayback(startup.waiting);
  vm.drainActions();
  let navigation = vm.selectTitle(0);
  let fallbackTarget: MenuPlaylistTarget | undefined;
  const preMenuPlaylistIds: number[] = [];
  for (let step = 0; step < 64; step += 1) {
    const waiting = navigation.waiting;
    if (waiting && (waiting.type === "PLAY_PLAYLIST" || waiting.type === "PLAY_PLAYLIST_ITEM" || waiting.type === "PLAY_PLAYLIST_MARK")) {
      const playlistNumber = waiting.payload.playlist;
      const playlist = typeof playlistNumber === "number" ? disc.playlists.find((item) => Number(item.id) === playlistNumber) : undefined;
      if (playlist) {
        const playMark = waiting.type === "PLAY_PLAYLIST_MARK" && typeof waiting.payload.playMark === "number" ? waiting.payload.playMark : undefined;
        const playItem = waiting.type === "PLAY_PLAYLIST_ITEM" && typeof waiting.payload.playItem === "number"
          ? waiting.payload.playItem
          : playMark !== undefined ? playlist.marks.find((mark) => mark.index === playMark)?.playItemRef ?? 0 : 0;
        const target = menuTarget(playlist, playItem);
        if (target) return { ...target, ...(playMark === undefined ? {} : { playMark }), preMenuPlaylistIds: [...preMenuPlaylistIds] };
        // Snapshot the ids completed so far: the fallback playlist follows its own
        // pre-menu chain instead of completing itself silently.
        fallbackTarget ??= { playlist, playItem, ...(playMark === undefined ? {} : { playMark }), preMenuPlaylistIds: [...preMenuPlaylistIds] };
        if (!preMenuPlaylistIds.includes(Number(playlist.id))) preMenuPlaylistIds.push(Number(playlist.id));
        // A logo, warning, or feature played before the menu: complete it and follow
        // the next title/search or playlist transition.
        vm.handleEvent({ type: "MEDIA_ENDED", generation: waiting.generation, responseTo: waiting.id });
        navigation = vm.runTurn();
        continue;
      }
    }
    const titleSearch = vm.drainActions().find((action) => action.type === "TITLE_SEARCH");
    if (!titleSearch || typeof titleSearch.payload.title !== "number") return fallbackTarget;
    navigation = vm.selectTitle(titleSearch.payload.title);
  }
  return fallbackTarget;
}

export async function menuLoopMediaInput(disc: ParsedDisc, playlist: ParsedDisc["playlists"][number] | undefined, options: { playItemIndex?: number } = {}): Promise<{ sourcePath: string; sourceFile: string; playlistId: string; playItemIndex: number; clipId: string; inTime45k: number; loopStart45k?: number; outTime45k: number; stillMode: number; repeatCount: number; loopBackground: boolean; videoPid: number; audioTracks: Array<{ streamNumber: number; pid: number; language: string }> } | null> {
  if (!playlist || playlist.playItems.length === 0) return null;
  const playItems = options.playItemIndex === undefined ? playlist.playItems : playlist.playItems.filter((item) => item.index === options.playItemIndex);
  if (playItems.length === 0) return null;
  const first = playItems[0]!;
  const last = playItems.at(-1)!;
  if (playItems.some((item) => item.multiAngle)) return null;
  let repeatCount = 0;
  for (const item of [...playlist.playItems].reverse()) {
    if (item.clipId !== last.clipId || item.inTime45k !== last.inTime45k || item.outTime45k !== last.outTime45k || item.multiAngle) break;
    repeatCount++;
  }
  const repeatedTail = repeatCount >= 2;
  const tailStart = playItems.length - (repeatedTail ? repeatCount : 1);
  const timelineItems = repeatedTail ? [last] : playItems;
  const loopItem = repeatedTail ? last : first;
  // A Top Menu playlist is identified by the HDMV command chain above. Its
  // background topology is derived from the selected timeline: a complete
  // single item, adjacent intervals in the same source clip, an explicit loop
  // mark, or an identical repeated tail. Playlist repetition is not a menu test.
  const sameSourceContinuous = timelineItems.every((item, index) => item.clipId === first.clipId
    && (index === 0 || timelineItems[index - 1]!.outTime45k === item.inTime45k));
  const oneTimelineSpan = repeatedTail || sameSourceContinuous;
  if (!oneTimelineSpan || (repeatedTail && tailStart > 0)) return null;
  const spanStart = repeatedTail ? last.inTime45k : first.inTime45k;
  const spanEnd = last.outTime45k;
  const loopStart45k = (repeatedTail ? [last] : timelineItems)
    .map((item) => resolveMenuLoopStart45k(item.index, item.inTime45k, item.outTime45k, playlist.marks))
    .filter((time): time is number => time !== undefined)
    .at(-1);
  const streamDeclarationsMatch = playItems.every((item) => item.streams.length === first.streams.length
    && item.streams.every((stream, index) => {
      const initial = first.streams[index]!;
      return stream.pid === initial.pid && stream.codingType === initial.codingType && stream.streamType === initial.streamType && stream.language === initial.language;
    }));
  if (!streamDeclarationsMatch) return null;
  const video = first.streams.find((stream) => stream.pid !== null && (stream.codingType === 0x1b || stream.codingType === 0x24) && stream.streamType === 1);
  const audioCodingTypes = new Set([0x03, 0x04, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0xa1, 0xa2]);
  const audioStreams = first.streams.filter((stream) => stream.pid !== null && stream.streamType === 1 && stream.codingType !== null && audioCodingTypes.has(stream.codingType) && stream.language !== null);
  const stillWithoutAudio = playItems.length === 1 && first.stillMode === 2 && audioStreams.length === 0;
  if (!video?.pid || (!stillWithoutAudio && audioStreams.length === 0) || audioStreams.some((stream) => !/^[A-Za-z]{3}$/.test(stream.language!))) return null;
  const sourceFile = `BDMV/STREAM/${first.clipId}.m2ts`;
  const sourcePath = await resolveInputFile(disc.root, `STREAM/${first.clipId}.m2ts`);
  return {
    sourcePath, sourceFile, playlistId: playlist.id, playItemIndex: repeatedTail ? last.index : first.index, clipId: first.clipId,
    inTime45k: spanStart, ...(loopStart45k !== undefined ? { loopStart45k } : {}), outTime45k: spanEnd, stillMode: loopItem.stillMode, repeatCount: Math.max(1, repeatCount), loopBackground: loopItem.stillMode === 2 || (repeatedTail || loopStart45k !== undefined), videoPid: video.pid,
    audioTracks: audioStreams.map((stream, index) => ({ streamNumber: index, pid: stream.pid!, language: stream.language! })),
  };
}

/** The visible work of a conversion; option parsing happens before the plan is printed. */
const CONVERT_STEPS = {
  structure: "Parse BDMV structure",
  scenes: "Extract IGS scenes",
  playlist: "Resolve Top Menu playlist",
  scene: "Select menu scene and media",
  media: "Export menu media",
  package: "Build menu package",
  report: "Write report and commit",
} as const;

/** `undefined` keeps the default: a live line on a terminal, silence when piped. */
export function progressMode(): ProgressMode | undefined {
  const progress = optionState("--progress");
  if (progress === false) return "none";
  if (progress === true) return process.stderr.isTTY ? "tty" : "plain";
  return undefined;
}

export function countOf(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit]}`;
}

/** Committed package size from `manifest.json`; a missing manifest produces no summary line. */
export async function packageSummary(packageRoot: string): Promise<string | undefined> {
  const manifest = await readJsonObject(resolve(packageRoot, "manifest.json"));
  if (!Array.isArray(manifest.files)) return undefined;
  let files = 0;
  let bytes = 0;
  for (const file of manifest.files) {
    if (typeof file !== "object" || file === null) continue;
    const record = file as Record<string, unknown>;
    files += 1;
    bytes += typeof record.byteLength === "string" ? Number(record.byteLength) || 0 : 0;
  }
  return `${countOf(files, "file", "files")} · ${formatBytes(bytes)}`;
}

/** Selected scene plus one loop length for the resolved menu media. */
export function menuSceneDetail(scene: { clipId: string; pid: number }, media: Awaited<ReturnType<typeof menuLoopMediaInput>>): string {
  const label = `clip ${scene.clipId} · PID 0x${scene.pid.toString(16)}`;
  if (media === null) return `${label} · no loop media`;
  return `${label} · loop ${((media.outTime45k - media.inTime45k) / 45000).toFixed(1)}s`;
}

/** Canonical path for an output target whose parent exists, matching the committed output path. */
export async function plannedOutputPath(path: string): Promise<string> {
  const target = resolve(path);
  try { return resolve(await realpath(dirname(target)), basename(target)); } catch { return target; }
}

export async function build(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "build requires a BDMV input path");
  // Argument contract first: every option value is resolved before the input is parsed and
  // before any output transaction exists. A missing value must never be masked by disc
  // diagnostics, and a late failure must never leave a staging directory behind.
  const outOption = optionValue("--out");
  const titleOption = optionValue("--title");
  const overwrite = flagEnabled("--overwrite");
  const limits = await loadLimits(optionValue("--limits"));
  const profile = await loadPlayerProfile(optionValue("--player-profile"));
  // Best effort: the header names the output only for inputs that resolve to a BDMV
  // root; anything else is reported by the first step with the parser's own code.
  const plannedRoot = await locateBdmvRoot(input).catch(() => undefined);
  const plannedOut = outOption !== undefined
    ? await plannedOutputPath(outOption)
    : plannedRoot === undefined ? undefined : await plannedOutputPath(resolve(dirname(plannedRoot), "BDMV-menu"));
  const plannedTitle = titleOption ?? (plannedRoot === undefined ? undefined : basename(dirname(plannedRoot)));
  const mode = progressMode();
  const progress = new ProgressReporter({
    command: "convert",
    steps: Object.values(CONVERT_STEPS),
    source: input,
    details: [
      ...(plannedOut === undefined ? [] : [["output", plannedOut] as const]),
      ...(plannedTitle === undefined ? [] : [["title", plannedTitle] as const]),
      ["profile", `region ${profile.region} · ${profile.outputProfile}`] as const,
    ],
    ...(mode === undefined ? {} : { mode }),
  });

  progress.start(CONVERT_STEPS.structure);
  const disc = await parseBdmv(input);
  const fatalDiagnostics = classifyDiagnostics(disc.diagnostics);
  if (fatalDiagnostics.hasFatal) {
    progress.fail(CONVERT_STEPS.structure, firstBlockingCode(fatalDiagnostics.blocking));
    stageFailure(firstBlockingCode(fatalDiagnostics.blocking), fatalDiagnostics.blocking);
    return;
  }
  progress.done(CONVERT_STEPS.structure, `${countOf(disc.entries.length, "entry", "entries")} · ${countOf(disc.playlists.length, "playlist", "playlists")} · ${countOf(disc.clips.length, "clip", "clips")}`);
  const out = plannedOut ?? resolve(dirname(disc.root), "BDMV-menu");
  const title = plannedTitle ?? basename(dirname(disc.root));
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  // The header names the target for inputs that follow the documented BDMV layout.
  if (plannedOut === undefined) progress.info("output", roots.output);
  if (plannedTitle === undefined) progress.info("title", title);

  progress.start(CONVERT_STEPS.scenes);
  const extraction = await extractIgsScenes(disc);
  progress.done(CONVERT_STEPS.scenes, `${countOf(extraction.scenes.length, "scene", "scenes")} · ${countOf(extraction.assets.length, "image", "images")} · ${countOf(extraction.streams.length, "stream", "streams")}`);

  progress.start(CONVERT_STEPS.playlist);
  const menuTarget = findTopMenuPlaylist(disc, profile, limits, extraction.scenes);
  const menuPlaylist = menuTarget?.playlist;
  const menuMedia = await menuLoopMediaInput(disc, menuPlaylist, { ...(menuTarget ? { playItemIndex: menuTarget.playItem } : {}) });
  progress.done(CONVERT_STEPS.playlist, menuTarget === undefined
    ? "no HDMV Top Menu entry"
    : `playlist ${menuTarget.playlist.id} · PlayItem ${menuTarget.playItem}`);

  progress.start(CONVERT_STEPS.scene);
  const transaction = await beginOutputTransaction(roots.output, { overwrite });
  try {
    const failMenuConversion = async (code: string, message: string): Promise<void> => {
      progress.fail(CONVERT_STEPS.scene, code);
      await writeFile(resolve(transaction.stagingPath, "README.md"), `# Menu package\n\n${message}\n\nStatus: **failed**.\n`);
      // The failure report keeps the same shape as the success report so a consumer
      // can read one schema regardless of how the conversion ended (P2-P2-5).
      const diagnostics = deliveryDiagnostics([
        { code, message, severity: "error" },
        ...disc.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
        ...extraction.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
      ]);
      const report = { schemaVersion: "1.0", status: "failed", code, auditScope: "convert", reasons: [message], notVerified: [], diagnostics, blockingDiagnostics: classifyDiagnostics(diagnostics).blocking };
      await writeFile(resolve(transaction.stagingPath, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await transaction.commit();
      progress.finish("failed", [["output", roots.output], ["report", "report.json · status failed"]], code);
      process.stdout.write(`${JSON.stringify({ status: "failed", code, output: roots.output })}\n`);
      process.exitCode = 1;
    };
    if (!extraction.scenes.length) {
      await failMenuConversion("MENU_SCENE_NOT_FOUND", "Conversion did not produce a runnable package because no IGS scene was found in the BDMV input.");
      return;
    }
    if (!menuPlaylist) {
      await failMenuConversion("MENU_PLAYLIST_NOT_RESOLVED", "The HDMV Top Menu playlist could not be resolved from the disc navigation entries; no IGS scene was selected.");
      return;
    }
    const menuSceneResult = findMenuScene(disc, menuPlaylist, extraction.scenes, menuTarget?.playItem);
    if (menuSceneResult.status === "not-found") {
      await failMenuConversion("MENU_SCENE_NOT_FOUND", `No extracted IGS scene matches the stream and clip declarations in Top Menu playlist ${menuPlaylist.id}; no other scene was selected.`);
      return;
    }
    if (menuSceneResult.status === "ambiguous") {
      const sources = menuSceneResult.scenes.map((scene) => `${scene.id} (clip ${scene.clipId}, PID ${scene.pid} @ byte ${scene.source.segmentFileOffset})`);
      await failMenuConversion("MENU_SCENE_AMBIGUOUS", `Top Menu playlist ${menuPlaylist.id} maps to multiple extracted IGS scenes: ${sources.join(", ")}; no scene was selected.`);
      return;
    }
    const menuScene = menuSceneResult.scene;
    const adapted = adaptIgsScene(menuScene, extraction.assets);
    const scene = adapted.scene;
    const mediaClosure = buildMediaClosure(disc, extraction.scenes);
    const externalTargets = createExternalMediaTargets(disc, mediaClosure);
    const reachablePlaylistIds = new Set(mediaClosure.playlistIds.map((id) => Number(id.slice("playlist:".length))));
    // An IGS composition identifies the playlist that owns it, not the role it
    // plays. Always-on compositions (uiModel 0) are menu surfaces. Popup
    // compositions (uiModel 1) belong to title playback and must not replace the
    // Top Menu background with an overlay-only scene. The resolved Top Menu
    // playlist is the exception: its selected composition is the packaged menu
    // surface even when the disc models its menu as a popup composition.
    // A menu playlist is not limited to the PlayItem the Top Menu command enters:
    // LinkPI switches between sub-menus inside the same playlist, so every
    // PlayItem that owns an IGS composition is packaged under its own
    // (playlist, PlayItem) key.
    const menuPlaylistNumber = Number(menuPlaylist.id);
    const playlistSceneResults = disc.playlists.flatMap((playlist) => {
      const isMenuPlaylist = Number(playlist.id) === menuPlaylistNumber;
      const playItemIndexes = isMenuPlaylist ? playlist.playItems.map((item) => item.index) : [undefined];
      return playItemIndexes.flatMap((playItem) => {
        const result = findMenuScene(disc, playlist, extraction.scenes, playItem);
        return result.status === "found"
          ? [{ playlistId: Number(playlist.id), playItem: playItem ?? 0, scene: result.scene, adapted: adaptIgsScene(result.scene, extraction.assets) }]
          : [];
      });
    });
    const menuSceneResults = playlistSceneResults.filter((item) => item.scene.uiModel === 0 || item.playlistId === menuPlaylistNumber);
    const menuPlaylistIds = [...new Set(menuSceneResults.map((item) => item.playlistId))];
    // PLAY_PLAYLIST_MARK names a play mark; the runtime needs the mark-to-
    // PlayItem mapping to select the packaged scene for the marked PlayItem.
    const menuPlaylistMarks = [...new Set([...menuPlaylistIds, Number(menuPlaylist.id)])].flatMap((id) => {
      const playlist = disc.playlists.find((item) => Number(item.id) === id);
      return playlist && playlist.marks.length ? [{ playlistId: id, marks: playlist.marks.map((mark) => ({ index: mark.index, playItemRef: mark.playItemRef })) }] : [];
    });
    const menuScenes = menuSceneResults.map((item) => ({ playlistId: item.playlistId, playItem: item.playItem, scene: item.adapted.scene }));
    const additionalMenuMedia: Array<NonNullable<Awaited<ReturnType<typeof menuLoopMediaInput>>>> = [];
    const popupContentPlaylists: number[] = [];
    const missingPlayItemMedia: number[] = [];
    // The Top Menu PlayItem is the primary menu loop; the others are the
    // sub-menus a LinkPI jump reaches, and each needs its own background.
    const primaryPlayItem = menuMedia ? menuTarget?.playItem ?? 0 : -1;
    for (const item of playlistSceneResults) {
      const isMenuPlaylist = item.playlistId === menuPlaylistNumber;
      if (isMenuPlaylist && item.playItem === primaryPlayItem) continue;
      if (!isMenuPlaylist && !reachablePlaylistIds.has(item.playlistId)) continue;
      if (!isMenuPlaylist && item.scene.uiModel === 1) {
        popupContentPlaylists.push(item.playlistId);
        continue;
      }
      const playlist = disc.playlists.find((candidate) => Number(candidate.id) === item.playlistId);
      const media = await menuLoopMediaInput(disc, playlist, { playItemIndex: item.playItem });
      if (media) additionalMenuMedia.push(media);
      else if (isMenuPlaylist) missingPlayItemMedia.push(item.playItem);
    }
    const popupAdaptations = extraction.scenes.filter((candidate) => candidate.uiModel === 1).map((candidate) => adaptIgsScene(candidate, extraction.assets));
    const popupScenes = popupAdaptations.map((result) => result.scene);
    const vmPrograms = disc.movieObjects.map(({ id, instructions, resumeIntention, menuCallMask, titleSearchMask }) => ({
      id,
      instructions: instructions.map(({ words, bytes, source }) => ({ words, bytes, source: { path: "<MovieObject>", origin: source.origin, offset: source.offset } })),
      resumeIntention, menuCallMask, titleSearchMask,
    }));
    const menuEntry = disc.entries.find((entry) => entry.kind === "topMenu" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number")
      ?? disc.entries.find((entry) => entry.kind === "firstPlay" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number");
    const vmInitialProgramId = typeof menuEntry?.target.target === "number" ? menuEntry.target.target : undefined;
    const firstPlay = disc.entries.find((entry) => entry.kind === "firstPlay" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number");
    const vmFirstPlayProgramId = typeof firstPlay?.target.target === "number" ? firstPlay.target.target : undefined;
    const referenced = referencedAssetIds([scene, ...popupScenes, ...menuScenes.map((item) => item.scene)]);
    const graphics = extraction.assets.filter((asset) => referenced.has(asset.id)).map((asset) => ({ id: asset.id, bytes: asset.pngBytes }));
    const diagnostics: Array<{ code: string; message: string; severity?: string }> = [
      ...disc.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
      ...extraction.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
      ...adapted.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
      ...popupAdaptations.flatMap((result) => result.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity }))),
    ];
    const packagedMenuPlayItems = new Set(menuSceneResults.filter((item) => item.playlistId === menuPlaylistNumber).map((item) => item.playItem));
    for (const playItem of menuPlaylist.playItems) {
      if (packagedMenuPlayItems.has(playItem.index) || !menuIgsSceneTargets(disc, menuPlaylist, playItem.index).length) continue;
      diagnostics.push({ code: "M4_MENU_PLAY_ITEM_NOT_PACKAGED", message: `Top Menu playlist ${menuPlaylist.id} PlayItem ${playItem.index} declares an IGS stream but no extracted composition matched it; a LinkPI jump to that PlayItem keeps the current menu page.`, severity: "warning" });
    }
    if (missingPlayItemMedia.length) diagnostics.push({ code: "M5_MENU_PLAY_ITEM_MEDIA_UNAVAILABLE", message: `Menu playlist ${menuPlaylist.id} PlayItem${missingPlayItemMedia.length === 1 ? "" : "s"} ${missingPlayItemMedia.join(", ")} could not be exported as background media; the previous menu background keeps playing on those pages.`, severity: "warning" });
    if (popupScenes.length) diagnostics.push({ code: "M4_POPUP_RENDER_PARTIAL", message: "Popup IGS compositions are overlaid when POPUP_MENU has an unambiguous match for the active packaged menu clip/PID. Title playback delegated to the external player cannot be overlaid.", severity: "warning" });
    if (!menuMedia) diagnostics.push({ code: "M5_MENU_LOOP_UNAVAILABLE", message: "The HDMV Top Menu command selected a playlist, but its background timeline could not be represented as one continuous source-clip span or a repeated tail with supported video and primary audio streams.", severity: "warning" });
    for (const playlistId of popupContentPlaylists) diagnostics.push({ code: "M5_POPUP_CONTENT_MEDIA_EXTERNAL", message: `Playlist ${String(playlistId).padStart(5, "0")} is title playback with a popup IGS composition; its video is handed to the external player and the popup composition is not available there.`, severity: "warning" });
    if (additionalMenuMedia.length) diagnostics.push({ code: "M5_PLAYLIST_MEDIA_EXPORTED", message: `Packaged local media for playlist${additionalMenuMedia.length === 1 ? "" : "s"} ${[...new Set(additionalMenuMedia.map((media) => media.playlistId))].join(", ")}.`, severity: "info" });
    if (vmInitialProgramId === undefined || !vmPrograms.some((program) => program.id === vmInitialProgramId)) diagnostics.push({ code: "M4_MENU_OBJECT_CONTEXT_MISSING", message: "No valid HDMV Top Menu or First Play MovieObject is available for menu button commands.", severity: "warning" });
    let soundBytes: Uint8Array | null = null;
    const soundPath = disc.sounds[0]?.source.path;
    if (soundPath) {
      try {
        const relativeSoundPath = soundPath.replace(/^BDMV\//i, "");
        soundBytes = new Uint8Array(await readFile(await resolveInputFile(disc.root, relativeSoundPath)));
      } catch (error) {
        diagnostics.push({ code: "SOUND_SOURCE_MISSING", message: safeDiagnosticMessage(error instanceof Error ? error.message : String(error), roots.input) });
      }
    }
    const ir = createMenuDiscIR(disc, extraction.scenes.map(({ id, clipId }) => ({ id, clipId })), menuMedia !== null);
    // Delivery status is decided from facts that are all known before packaging.
    // The package records the same conclusion (D-2R).
    const decisionFacts = deliveryDiagnostics(diagnostics);
    const decision = decideDelivery({
      checks: [],
      diagnostics: decisionFacts,
      declaredEntryCount: disc.entries.length,
      hdmvEntryCount: disc.entries.filter((entry) => entry.target.objectType === "HDMV").length,
      // `buildMenuPackage` reached this point, so no required asset can be missing.
      hasMissingRequiredAsset: false,
      limitations: menuMedia ? [] : ["Menu loop media is unavailable; the menu background holds its final frame."],
    }, strictDefault());
    const blockingDiagnostics = classifyDiagnostics(decisionFacts).blocking;
    const plannedMedia = [
      menuMedia === null ? null : "background",
      additionalMenuMedia.length ? countOf(additionalMenuMedia.length, "extra playlist", "extra playlists") : null,
    ].filter((item): item is string => item !== null);
    progress.done(CONVERT_STEPS.scene, menuSceneDetail(menuScene, menuMedia));
    const mediaEncoding = menuMediaEncoding();
    const packaged = await buildMenuPackage({
      outputDirectory: transaction.stagingPath, title, ir, status: decision.status,
      ...(mediaEncoding ? { mediaEncoding } : {}),
      entryCounts: { declared: disc.entries.length, hdmv: disc.entries.filter((entry) => entry.target.objectType === "HDMV").length },
      scene, popupScenes, menuScenes, menuPlaylistIds, vmPrograms, vmEntries: disc.entries,
      ...(menuPlaylistMarks.length ? { menuPlaylistMarks } : {}),
      ...(menuTarget?.preMenuPlaylistIds?.length ? { preMenuPlaylistIds: menuTarget.preMenuPlaylistIds } : {}),
      externalTargets,
      bdmvPath: dirname(roots.input) === dirname(roots.output) ? relative(roots.output, disc.root) : disc.root,
      ...(vmInitialProgramId === undefined ? {} : { vmInitialProgramId }),
      ...(vmFirstPlayProgramId === undefined ? {} : { vmFirstPlayProgramId }),
      graphics, soundEntries: disc.sounds, soundBytes, playerProfile: profile, vmLimits: limits,
      ...(overwrite ? { reuseMediaFromDirectory: roots.output } : {}),
      ...(menuMedia ? { menuLoopMedia: menuMedia } : {}),
      ...(additionalMenuMedia.length ? { additionalMenuMedia } : {}),
      onMediaProgress: ({ outTimeSeconds, durationSeconds, state, source }) => {
        const ratio = state === "end" ? 1 : durationSeconds > 0 ? Math.min(0.99, outTimeSeconds / durationSeconds) : 0;
        const seconds = `${Math.min(outTimeSeconds, durationSeconds).toFixed(1)}/${durationSeconds.toFixed(1)}s`;
        const language = source.language !== undefined && source.language !== "" && source.language !== "und" ? source.language : `0x${source.pid.toString(16)}`;
        const stream = source.kind === "background" ? "background" : `audio ${language}`;
        progress.progress(ratio, `clip ${source.clipId} · ${stream} ${seconds}`);
      },
      onPhase: (phase) => {
        if (phase === "media") {
          if (plannedMedia.length) progress.start(CONVERT_STEPS.media);
          return;
        }
        if (phase === "assets") {
          if (plannedMedia.length) progress.done(CONVERT_STEPS.media, plannedMedia.join(" + "));
          else progress.skip(CONVERT_STEPS.media, "no menu media");
          progress.start(CONVERT_STEPS.package);
          return;
        }
        if (phase === "bundle") { progress.note("bundling runtime"); return; }
        progress.done(CONVERT_STEPS.package, "manifest written");
        progress.start(CONVERT_STEPS.report);
      },
      diagnostics: diagnostics.map(({ code, message, severity }) => ({ code, message, ...(severity === undefined ? {} : { severity }) })),
    });
    // Media colour-pipeline warnings are known only after encoding. They never
    // change the delivery status, so they join the report without re-deciding it.
    for (const { code, message, severity } of packaged.diagnostics) {
      if (severity !== "warning" || decisionFacts.some((fact) => fact.code === code)) continue;
      decisionFacts.push({ severity, code, message: safeDiagnosticMessage(message, roots.input) });
    }
    const report = { schemaVersion: "1.0", status: decision.status, auditScope: "convert", reasons: decision.reasons, notVerified: decision.notVerified, diagnostics: decisionFacts, blockingDiagnostics };
    await writeFile(resolve(transaction.stagingPath, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    await transaction.commit();
    progress.done(CONVERT_STEPS.report, `status ${decision.status}`);
    const packageText = await packageSummary(roots.output);
    progress.finish(decision.status, [
      ["output", roots.output],
      ...(packageText === undefined ? [] : [["package", packageText] as const]),
      ["report", `report.json · ${countOf(decisionFacts.length, "diagnostic", "diagnostics")}`],
    ]);
    process.stdout.write(`${JSON.stringify({ status: decision.status, output: roots.output })}\n`);
    if (decision.exitCode !== 0) process.exitCode = decision.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
}
