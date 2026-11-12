import { optionNumber, optionValue } from "../cli/context.js";
import { resolveInputFile } from "@bdmv2web/bdmv-io";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";
import { parseDiscIR, type DiscIR, type Limits, type PlayerProfile } from "@bdmv2web/core";
import { HdmvVm, type VmProgram } from "@bdmv2web/hdmv";
import { extractIgsScenes } from "@bdmv2web/igs";
import { resolveMenuLoopStart45k } from "@bdmv2web/media-export";
import type { MenuMediaEncoding } from "@bdmv2web/package-builder";
import { safeDiagnosticMessage } from "./extract.js";

export function menuMediaEncoding(): MenuMediaEncoding | undefined {
  const crf = optionNumber("--crf");
  const preset = optionValue("--preset");
  const codec = optionValue("--codec");
  const hdrMode = optionValue("--hdr");
  const videoMode = optionValue("--video");
  const encoding: MenuMediaEncoding = {};
  if (crf !== undefined) encoding.crf = crf;
  if (preset !== undefined) encoding.preset = preset as NonNullable<MenuMediaEncoding["preset"]>;
  if (codec !== undefined) encoding.codec = codec as NonNullable<MenuMediaEncoding["codec"]>;
  if (hdrMode !== undefined) encoding.hdrMode = hdrMode as NonNullable<MenuMediaEncoding["hdrMode"]>;
  if (videoMode !== undefined) encoding.videoMode = videoMode as NonNullable<MenuMediaEncoding["videoMode"]>;
  return Object.keys(encoding).length ? encoding : undefined;
}

export type MenuMediaScope = "auto" | "all" | "none";

export const MENU_MEDIA_AUTO_MAX_SECONDS = 900;

export function menuMediaScope(): MenuMediaScope {
  const value = optionValue("--menu-media");
  return value === "all" || value === "none" ? value : "auto";
}

export function playlistDurationSeconds(playlist: ParsedDisc["playlists"][number]): number {
  return playlist.playItems.reduce((total, item) => total + Math.max(0, item.outTime45k - item.inTime45k), 0) / 45_000;
}

export function menuPlaylistMarks(disc: ParsedDisc, playlistIds: readonly number[]): Array<{ playlistId: number; marks: Array<{ index: number; playItemRef: number }> }> {
  return playlistIds.flatMap((playlistId) => {
    const playlist = disc.playlists.find((item) => Number(item.id) === playlistId);
    return playlist?.marks.length ? [{ playlistId, marks: playlist.marks.map((mark) => ({ index: mark.index, playItemRef: mark.playItemRef })) }] : [];
  });
}

export function menuMediaScopedOut(playlist: ParsedDisc["playlists"][number], scope: MenuMediaScope, maxSeconds = MENU_MEDIA_AUTO_MAX_SECONDS): boolean {
  if (scope === "none") return true;
  return scope === "auto" && playlistDurationSeconds(playlist) > maxSeconds;
}

export function menuIgsSceneTargets(disc: ParsedDisc, playlist: ParsedDisc["playlists"][number], playItemIndex?: number): Array<{ clipId: string; pid: number }> {
  const targets: Array<{ clipId: string; pid: number }> = [];
  for (const item of playlist.playItems) {
    if (playItemIndex !== undefined && item.index !== playItemIndex) continue;
    const mplsDeclaresPrimaryIg = item.streams.some((stream) => stream.codingType === 0x91 && stream.streamType === 1 && stream.pid !== null);
    for (const stream of item.streams) {
      if (stream.codingType !== 0x91 || stream.pid === null) continue;
      if (stream.streamType === 1) {
        targets.push({ clipId: item.clipId, pid: stream.pid });
      } else if (stream.streamType === 2 && stream.subPathId !== null && stream.subClipId !== null) {
        const clip = playlist.subPaths[stream.subPathId]?.items[stream.subClipId];
        if (clip) targets.push({ clipId: clip.clipId, pid: stream.pid });
      }
    }
    if (!mplsDeclaresPrimaryIg) targets.push(...clpiPrimaryIgsTargets(disc, item.clipId));
  }
  return [...new Map(targets.map((target) => [`${target.clipId.toLocaleLowerCase("en-US")}\0${target.pid}`, target])).values()];
}

function clpiPrimaryIgsTargets(disc: ParsedDisc, clipId: string): Array<{ clipId: string; pid: number }> {
  const clipInfo = disc.clips.find((clip) => clip.id.toLocaleLowerCase("en-US") === clipId.toLocaleLowerCase("en-US"));
  return (clipInfo?.programs.flatMap((program) => program.streams) ?? [])
    .filter((stream) => stream.codingType === 0x91 && stream.pid !== null)
    .map((stream) => ({ clipId, pid: stream.pid }));
}

export function findMenuScene(disc: ParsedDisc, playlist: ParsedDisc["playlists"][number], scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"], playItemIndex?: number) {
  const targets = menuIgsSceneTargets(disc, playlist, playItemIndex);
  const matches = scenes.filter((scene) => targets.some((target) => target.clipId.toLocaleLowerCase("en-US") === scene.clipId.toLocaleLowerCase("en-US") && target.pid === scene.pid));
  const unique = [...new Map(matches.map((scene) => [`${scene.clipId.toLocaleLowerCase("en-US")}\0${scene.pid}\0${scene.source.segmentFileOffset}`, scene])).values()];
  if (unique.length === 1) return { status: "found" as const, scene: unique[0]! };
  if (unique.length === 0) return { status: "not-found" as const };
  return { status: "ambiguous" as const, scenes: unique };
}

export function isMenuSurfaceScene(uiModel: number, playlistId: number, topMenuPlaylistId: number): boolean {
  return uiModel === 0 || playlistId === topMenuPlaylistId;
}

export function createVmPrograms(disc: ParsedDisc): VmProgram[] {
  return disc.movieObjects.map(({ id, instructions, resumeIntention, menuCallMask, titleSearchMask }) => ({ id, instructions, resumeIntention, menuCallMask, titleSearchMask }));
}

export function createMenuDiscIR(disc: ParsedDisc, sceneRecords: Array<{ id: string; clipId: string }>, exportsMenuMedia: boolean, bdjRuntimeAvailable = false): DiscIR {
  const sourceRef = (source: { path: string; origin: "primary" | "backup"; offset: string }) => ({ path: source.path, origin: source.origin, byteOffset: source.offset });
  const diagnostics: DiscIR["diagnostics"] = disc.diagnostics.filter((item) => !(bdjRuntimeAvailable && item.code === "BDMV_BDJ_UNSUPPORTED")).map((item) => ({
    severity: item.severity === "fatal" ? "fatal" : item.severity === "error" ? "error" : item.severity === "warning" ? "warning" : "info",
    code: item.code, message: safeDiagnosticMessage(item.message, disc.root), sourcePath: item.sourcePath, offset: item.offset,
    entityId: null, action: null, recoverable: item.recoverable, stage: "structural", affectedEntryIds: [],
  }));
  const entries: DiscIR["entries"] = [];
  for (const entry of disc.entries) {
    const source = { path: entry.source.path, origin: entry.source.origin, byteOffset: entry.source.offset };
    if (entry.target.objectType === "HDMV" && typeof entry.target.target === "number") entries.push({ id: entry.id, navigation: { type: "HDMV", movieObjectId: entry.target.target }, source });
    else if (entry.target.objectType === "BDJ" && typeof entry.target.target === "string") entries.push({ id: entry.id, navigation: { type: "BDJ", bdjoId: entry.target.target, status: bdjRuntimeAvailable ? "local-jvm" : "unsupported" }, source });
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
  const bdjos = disc.bdjos?.map((bdjo) => ({
    path: bdjo.path,
    version: bdjo.version,
    terminalInfo: { ...bdjo.terminalInfo, source: sourceRef(bdjo.terminalInfo.source) },
    appCache: bdjo.appCache.map((item) => ({ ...item, source: sourceRef(item.source) })),
    accessiblePlaylists: { ...bdjo.accessiblePlaylists, source: sourceRef(bdjo.accessiblePlaylists.source) },
    applications: bdjo.applications.map((application) => ({ ...application, source: sourceRef(application.source) })),
    keyInterest: { ...bdjo.keyInterest, source: sourceRef(bdjo.keyInterest.source) },
    fileAccessPaths: bdjo.fileAccessPaths.map((item) => ({ ...item, source: sourceRef(item.source) })),
    source: sourceRef(bdjo.source),
  }));
  return parseDiscIR({ schemaVersion: "1.0", entries, programs, menus, playlists, mediaAssets: [], diagnostics, ...(bdjos?.length ? { bdjos } : {}) });
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

/**
 * The clip entry point a player decodes from for `time45k`: the latest video
 * entry point at or before it. This mirrors libbluray, which seeks with
 * `clpi_lookup_spn(in_time, before = 1)` (`bdnav/navigation.c`) and then wipes
 * packets until the first PES with `pts >= in_time` (`decoders/m2ts_filter.c`),
 * so the first frame a player presents is the one holding the start.
 */
export function menuMediaEntryPoint45k(disc: ParsedDisc, clipId: string, time45k: number, videoPid?: number): number | undefined {
  let entry: number | undefined;
  for (const point of disc.clips.find((clip) => clip.id === clipId)?.cpi ?? []) {
    if (point.epStreamType !== 1 || point.pts45k > time45k) continue;
    if (videoPid !== undefined && point.pid !== videoPid) continue;
    if (entry === undefined || point.pts45k > entry) entry = point.pts45k;
  }
  return entry;
}

export async function menuLoopMediaInput(disc: ParsedDisc, playlist: ParsedDisc["playlists"][number] | undefined, options: { playItemIndex?: number; purpose?: "static-background" | "bdj-playback" } = {}): Promise<{ sourcePath: string; sourceFile: string; playlistId: string; playItemIndex: number; clipId: string; inTime45k: number; loopStart45k?: number; copyStart45k?: number; outTime45k: number; stillMode: number; repeatCount: number; loopBackground: boolean; videoPid: number; audioTracks: Array<{ streamNumber: number; pid: number; language: string }> } | null> {
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
  const repeatedTail = options.purpose !== "bdj-playback" && repeatCount >= 2;
  const tailStart = playItems.length - (repeatedTail ? repeatCount : 1);
  const timelineItems = repeatedTail ? [last] : playItems;
  const loopItem = repeatedTail ? last : first;
  const sameSourceContinuous = timelineItems.every((item, index) => item.clipId === first.clipId
    && (index === 0 || timelineItems[index - 1]!.outTime45k === item.inTime45k));
  const oneTimelineSpan = repeatedTail || sameSourceContinuous;
  if (!oneTimelineSpan || (repeatedTail && tailStart > 0)) return null;
  const spanStart = repeatedTail ? last.inTime45k : first.inTime45k;
  const spanEnd = last.outTime45k;
  const loopStart45k = options.purpose === "bdj-playback" ? undefined : (repeatedTail ? [last] : timelineItems)
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
  const copyStart45k = menuMediaEntryPoint45k(disc, first.clipId, loopStart45k ?? spanStart, video.pid);
  return {
    sourcePath, sourceFile, playlistId: playlist.id, playItemIndex: repeatedTail ? last.index : first.index, clipId: first.clipId,
    inTime45k: spanStart, ...(loopStart45k !== undefined ? { loopStart45k } : {}), ...(copyStart45k !== undefined ? { copyStart45k } : {}), outTime45k: spanEnd, stillMode: loopItem.stillMode, repeatCount: options.purpose === "bdj-playback" ? 1 : Math.max(1, repeatCount), loopBackground: options.purpose === "bdj-playback" ? false : loopItem.stillMode === 2 || (repeatedTail || loopStart45k !== undefined), videoPid: video.pid,
    audioTracks: audioStreams.map((stream, index) => ({ streamNumber: index, pid: stream.pid!, language: stream.language! })),
  };
}
