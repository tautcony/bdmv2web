import type { PlayerProfile, Limits } from "@bdmv2web/core";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";
import type { IgsExtraction } from "@bdmv2web/igs";
import type { MenuLoopMediaInput } from "@bdmv2web/media-export";
import type { MenuPackageInput } from "@bdmv2web/package-builder";
import { adaptIgsScene } from "@bdmv2web/runtime-web";
import { createExternalMediaTargets } from "@bdmv2web/media-export";
import { readFile } from "node:fs/promises";
import { resolveInputFile } from "@bdmv2web/bdmv-io";
import { bdmvRelativePath } from "@bdmv2web/core/disc-path";
import { errorText } from "@bdmv2web/utils";
import { referencedAssetIds, safeDiagnosticMessage } from "../shared/metadata.js";
import { buildMediaClosure } from "../shared/media.js";
import type { BdjFileCollection } from "../shared/bdj-files.js";
import { countOf } from "../progress.js";
import {
  createMenuDiscIR,
  createVmPrograms,
  findMenuScene,
  isMenuSurfaceScene,
  menuIgsSceneStreamCount,
  menuIgsSceneTargets,
  menuLoopMediaInput,
  menuMediaEncoding,
  menuSceneDetail,
  menuPlaylistMarks as collectMenuPlaylistMarks,
  MENU_MEDIA_AUTO_MAX_SECONDS,
  type MenuMediaScope,
  type MenuPlaylistTarget,
} from "../commands/menu-planning.js";

/** Package fields decided by planning; build.ts adds output path, title, status and progress. */
export type PlannedPackageInput = Omit<MenuPackageInput, "outputDirectory" | "title" | "status" | "onMediaProgress" | "onPhase">;

export interface BuildPlan {
  /** Final `MenuPackageInput` domain fields. */
  packageInput: PlannedPackageInput;
  /** Media units the package will encode, in export order. */
  mediaInputs: MenuLoopMediaInput[];
  /** Detail line for the "Select menu scene and media" step. */
  sceneDetail: string;
  /** Detail line after media export. */
  mediaDetail: string;
  /** Note shown while the runtime bundle is written. */
  bundleNote: string;
  /** Explanatory limitations passed to `decideDelivery()`; the failure facts decide the status. */
  limitations: string[];
}

export type BuildPlanResult =
  | { status: "planned"; plan: BuildPlan }
  | { status: "failed"; code: string; message: string };

export interface BuildPlanningInput {
  disc: ParsedDisc;
  extraction: IgsExtraction;
  profile: PlayerProfile;
  limits: Limits;
  bdmvPath: string;
  /** Input root used to redact absolute paths from diagnostics. */
  inputRoot: string;
  mediaScope: MenuMediaScope;
  hasBdjEntries: boolean;
  bdjFiles: BdjFileCollection;
  bdjLaunch?: MenuPackageInput["bdjLaunch"];
  bdjHostApiJar?: Uint8Array;
  bdjMenuMediaAssets: MenuLoopMediaInput[];
  bdjScopedOutPlaylists: Array<{ id: string; seconds: number }>;
  menuTarget: MenuPlaylistTarget | undefined;
  menuMedia: MenuLoopMediaInput | null;
  reuseDirectory?: string;
}

const failure = (code: string, message: string): BuildPlanResult => ({ status: "failed", code, message });

/**
 * The one domain orchestration from ParsedDisc + IGS extraction to packaging
 * input. Both the BD-J/mixed and HDMV menus end here; the caller keeps
 * arguments, progress, the output transaction, reports and the exit code.
 */
export async function planBuild(input: BuildPlanningInput): Promise<BuildPlanResult> {
  const { disc, extraction, profile, limits, mediaScope } = input;
  const adaptedCompositions = new Map<Parameters<typeof adaptIgsScene>[0], ReturnType<typeof adaptIgsScene>>();
  const adaptComposition = (composition: Parameters<typeof adaptIgsScene>[0]): ReturnType<typeof adaptIgsScene> => {
    const cached = adaptedCompositions.get(composition);
    if (cached !== undefined) return cached;
    const adapted = adaptIgsScene(composition, extraction.assets);
    adaptedCompositions.set(composition, adapted);
    return adapted;
  };
  const firstPlayEntry = disc.entries.find((entry) => entry.kind === "firstPlay");
  const topMenuEntry = disc.entries.find((entry) => entry.kind === "topMenu");
  const initialBdjEntry = firstPlayEntry?.target.objectType === "BDJ" ? firstPlayEntry
    : topMenuEntry?.target.objectType === "BDJ" ? topMenuEntry
      : undefined;
  const hdmvEntryCount = disc.entries.filter((entry) => entry.target.objectType === "HDMV").length;
  const entryCounts = { declared: disc.entries.length, hdmv: hdmvEntryCount };

  if (!input.menuTarget && initialBdjEntry && input.hasBdjEntries && input.bdjFiles.files.length) {
    const missingApplication = input.bdjFiles.diagnostics.find((item) => item.code === "BDJ_APPLICATION_BASE_PATH_INVALID" || item.code === "BDJ_APPLICATION_JAR_MISSING");
    if (missingApplication) return failure(missingApplication.code, missingApplication.message);
    const vmPrograms = createVmPrograms(disc);
    const firstPlayHdmv = firstPlayEntry?.target.objectType === "HDMV" && typeof firstPlayEntry.target.target === "number" ? firstPlayEntry.target.target : undefined;
    const topMenuHdmv = topMenuEntry?.target.objectType === "HDMV" && typeof topMenuEntry.target.target === "number" ? topMenuEntry.target.target : undefined;
    const vmInitialProgramId = firstPlayEntry?.target.objectType === "BDJ" ? undefined : topMenuHdmv ?? firstPlayHdmv;
    const mediaClosure = buildMediaClosure(disc, extraction.scenes);
    const externalTargets = createExternalMediaTargets(disc, mediaClosure);
    const mixedPlaylistSceneResults = disc.playlists.flatMap((playlist) => playlist.playItems.flatMap((playItem) => {
      const result = findMenuScene(disc, playlist, extraction.scenes, playItem.index);
      return result.status === "found" ? [{ playlistId: Number(playlist.id), playItem: playItem.index, scene: result.scene, adapted: adaptComposition(result.scene) }] : [];
    }));
    const mixedMenuSceneResults = mixedPlaylistSceneResults.filter((item) => item.scene.uiModel === 0);
    const mixedMenuScenes = mixedMenuSceneResults.map((item) => ({ playlistId: item.playlistId, playItem: item.playItem, scene: item.adapted.scene }));
    const mixedMenuPlaylistIds = [...new Set(mixedMenuScenes.map((item) => item.playlistId))];
    const mixedMenuPlaylistMarks = collectMenuPlaylistMarks(disc, mixedMenuPlaylistIds);
    const mixedPopupScenes = extraction.scenes.filter((item) => item.uiModel === 1).map((item) => adaptComposition(item).scene);
    const mixedReferencedAssets = referencedAssetIds([...mixedPopupScenes, ...mixedMenuScenes.map((item) => item.scene)]);
    const mixedGraphics = extraction.assets.filter((asset) => mixedReferencedAssets.has(asset.id)).map((asset) => ({ id: asset.id, bytes: asset.pngBytes }));
    const diagnostics: Array<{ code: string; message: string; severity?: string }> = [
      ...disc.diagnostics.filter((item) => item.code !== "BDMV_BDJ_UNSUPPORTED").map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, input.inputRoot), severity: item.severity })),
      ...input.bdjFiles.diagnostics,
      ...extraction.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, input.inputRoot), severity: item.severity })),
      { code: "BDJ_RUNTIME_EXECUTION_UNVERIFIED", message: "Browser execution, Java API host calls, AWT rendering, and disc playback callbacks have not been verified with this runtime package.", severity: "warning" },
      ...(input.bdjScopedOutPlaylists.length ? [{
        code: "M5_MENU_MEDIA_SCOPE_SKIPPED",
        message: `Skipped ${countOf(input.bdjScopedOutPlaylists.length, "playlist", "playlists")} longer than ${MENU_MEDIA_AUTO_MAX_SECONDS} seconds (${input.bdjScopedOutPlaylists.slice(0, 8).map((item) => `${item.id} · ${Math.round(item.seconds / 60)} min`).join(", ")}${input.bdjScopedOutPlaylists.length > 8 ? ", …" : ""}). --menu-media auto exports menu-length playlists only; use --menu-media all to export every playlist the BDJO declares.`,
        severity: "info",
      }] : []),
      ...(mediaScope === "none" ? [{ code: "M5_MENU_MEDIA_DISABLED", message: "--menu-media none: no playlist media was exported; BD-J players that request a playlist will report it as unavailable.", severity: "info" }] : []),
    ];
    const mediaEncoding = menuMediaEncoding();
    const additional = input.bdjMenuMediaAssets;
    const bdjSession = {
      vmPrograms, vmEntries: disc.entries, playerProfile: profile, vmLimits: limits, externalTargets, bdjoDescriptors: disc.bdjos ?? [], bdmvPath: input.bdmvPath,
    };
    return {
      status: "planned",
      plan: {
        packageInput: {
          ir: createMenuDiscIR(disc, mixedMenuScenes.map((item) => ({ id: item.scene.id ?? `playlist-${item.playlistId}-pi-${item.playItem}`, clipId: item.scene.clipId ?? "" })), false, true),
          scene: null,
          graphics: mixedGraphics,
          entryCounts,
          vmPrograms, vmEntries: disc.entries, externalTargets, menuScenes: mixedMenuScenes, menuPlaylistIds: mixedMenuPlaylistIds,
          ...(mixedMenuPlaylistMarks.length ? { menuPlaylistMarks: mixedMenuPlaylistMarks } : {}),
          popupScenes: mixedPopupScenes,
          bdmvPath: input.bdmvPath,
          ...(vmInitialProgramId === undefined ? {} : { vmInitialProgramId }),
          ...(firstPlayHdmv === undefined ? {} : { vmFirstPlayProgramId: firstPlayHdmv }),
          ...(mediaEncoding ? { mediaEncoding } : {}),
          soundEntries: disc.sounds, playerProfile: profile, vmLimits: limits,
          ...(additional.length ? { additionalMenuMedia: additional } : {}),
          ...(input.reuseDirectory === undefined ? {} : { reuseMediaFromDirectory: input.reuseDirectory }),
          bdjFiles: input.bdjFiles.files,
          ...(input.bdjHostApiJar ? { bdjHostApiJar: input.bdjHostApiJar } : {}),
          ...(input.bdjLaunch ? { bdjLaunch: { ...input.bdjLaunch, session: { ...bdjSession } } } : {}),
          diagnostics: diagnostics.map(({ code, message, severity }) => ({ code, message, ...(severity === undefined ? {} : { severity }) })),
        },
        mediaInputs: additional,
        sceneDetail: `BDJO ${String(initialBdjEntry.target.target)} · ${input.bdjFiles.files.length} application/resource files`,
        mediaDetail: additional.length ? countOf(additional.length, "BD-J PlayItem", "BD-J PlayItems") : mediaScope === "none" ? "menu media disabled" : "no playlist media inside the menu scope",
        bundleNote: "bundling BD-J and HDMV runtime",
        limitations: ["BD-J menu background and playlist media depend on the browser playback bridge."],
      },
    };
  }

  if (!extraction.scenes.length) {
    const hasDeclaredIg = disc.playlists.some((playlist) => menuIgsSceneTargets(disc, playlist).length > 0);
    return failure("MENU_SCENE_NOT_FOUND", hasDeclaredIg
      ? "The BDMV declares IGS streams, but no complete IGS scene was extracted from their referenced clips."
      : "No IG stream is declared by any MPLS PlayItem or referenced CLPI program; the HDMV menu has no IGS scene to render.");
  }
  const menuPlaylist = input.menuTarget?.playlist;
  if (!menuPlaylist) return failure("MENU_PLAYLIST_NOT_RESOLVED", "The HDMV Top Menu playlist could not be resolved from the disc navigation entries; no IGS scene was selected.");
  const menuSceneResult = findMenuScene(disc, menuPlaylist, extraction.scenes, input.menuTarget?.playItem, input.menuTarget?.igStreamNumber);
  if (menuSceneResult.status === "not-found") {
    return failure("MENU_SCENE_NOT_FOUND", `No extracted IGS scene matches the stream and clip declarations in Top Menu playlist ${menuPlaylist.id}; no other scene was selected.`);
  }
  if (menuSceneResult.status === "ambiguous") {
    const sources = menuSceneResult.scenes.map((scene) => `${scene.id} (clip ${scene.clipId}, PID ${scene.pid} @ byte ${scene.source.segmentFileOffset})`);
    return failure("MENU_SCENE_AMBIGUOUS", `Top Menu playlist ${menuPlaylist.id} maps to multiple extracted IGS scenes: ${sources.join(", ")}; no scene was selected.`);
  }
  const menuScene = menuSceneResult.scene;
  const adapted = adaptComposition(menuScene);
  const scene = adapted.scene;
  const mediaClosure = buildMediaClosure(disc, extraction.scenes);
  const externalTargets = createExternalMediaTargets(disc, mediaClosure);
  const reachablePlaylistIds = new Set(mediaClosure.playlistIds.map((id) => Number(id.slice("playlist:".length))));
  const menuPlaylistNumber = Number(menuPlaylist.id);
  const playlistSceneResults = disc.playlists.flatMap((playlist) => {
    const isMenuPlaylist = Number(playlist.id) === menuPlaylistNumber;
    const playItemIndexes = isMenuPlaylist ? playlist.playItems.map((item) => item.index) : [undefined];
    return playItemIndexes.flatMap((playItem) => {
      const targets = menuIgsSceneTargets(disc, playlist, playItem);
      const streamCount = menuIgsSceneStreamCount(disc, playlist, playItem);
      const streamNumbers = [...new Set(targets.map((target) => target.igStreamNumber))];
      return streamNumbers.flatMap((igStreamNumber) => {
        const result = findMenuScene(disc, playlist, extraction.scenes, playItem, igStreamNumber);
        return result.status === "found"
          ? [{ playlistId: Number(playlist.id), playItem: playItem ?? 0, igStreamNumber, igStreamCount: streamCount, scene: result.scene, adapted: adaptComposition(result.scene) }]
          : [];
      });
    });
  });
  const menuSceneResults = playlistSceneResults.filter((item) => isMenuSurfaceScene(item.scene.uiModel, item.playlistId, menuPlaylistNumber));
  const menuPlaylistIds = [...new Set(menuSceneResults.map((item) => item.playlistId))];
  const menuPlaylistMarks = collectMenuPlaylistMarks(disc, [...new Set([...menuPlaylistIds, Number(menuPlaylist.id)])]);
  const menuScenes = menuSceneResults.map((item) => ({ playlistId: item.playlistId, playItem: item.playItem, igStreamNumber: item.igStreamNumber, igStreamCount: item.igStreamCount, scene: item.adapted.scene }));
  const additionalMenuMedia: MenuLoopMediaInput[] = [];
  const popupContentPlaylists: number[] = [];
  const missingPlayItemMedia: number[] = [];
  const primaryPlayItem = input.menuMedia ? input.menuTarget?.playItem ?? 0 : null;
  const queuedPlayItems = new Set<string>();
  for (const item of playlistSceneResults) {
    const isMenuPlaylist = item.playlistId === menuPlaylistNumber;
    queuedPlayItems.add(`${item.playlistId}\0${item.playItem}`);
    if (isMenuPlaylist && item.playItem === primaryPlayItem) continue;
    if (!isMenuPlaylist && !reachablePlaylistIds.has(item.playlistId)) continue;
    if (!isMenuPlaylist && item.scene.uiModel === 1) {
      popupContentPlaylists.push(item.playlistId);
      continue;
    }
    if (mediaScope === "none") continue;
    const playlist = disc.playlists.find((candidate) => Number(candidate.id) === item.playlistId);
    const media = await menuLoopMediaInput(disc, playlist, { playItemIndex: item.playItem });
    if (media) additionalMenuMedia.push(media);
    else if (isMenuPlaylist) missingPlayItemMedia.push(item.playItem);
  }
  if (mediaScope === "all") for (const playlist of disc.playlists) {
    const id = Number(playlist.id);
    if (!reachablePlaylistIds.has(id) || popupContentPlaylists.includes(id)) continue;
    for (const playItem of playlist.playItems) {
      const key = `${id}\0${playItem.index}`;
      if (queuedPlayItems.has(key)) continue;
      queuedPlayItems.add(key);
      const media = await menuLoopMediaInput(disc, playlist, { playItemIndex: playItem.index, purpose: "bdj-playback" }).catch(() => null);
      if (media) additionalMenuMedia.push(media);
    }
  }
  const popupAdaptations = extraction.scenes.filter((candidate) => candidate.uiModel === 1).map((candidate) => adaptComposition(candidate));
  const popupScenes = popupAdaptations.map((result) => result.scene);
  const vmPrograms = createVmPrograms(disc);
  const menuEntry = disc.entries.find((entry) => entry.kind === "topMenu" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number")
    ?? disc.entries.find((entry) => entry.kind === "firstPlay" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number");
  const vmInitialProgramId = typeof menuEntry?.target.target === "number" ? menuEntry.target.target : undefined;
  const firstPlay = disc.entries.find((entry) => entry.kind === "firstPlay" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number");
  const vmFirstPlayProgramId = typeof firstPlay?.target.target === "number" ? firstPlay.target.target : undefined;
  const referenced = referencedAssetIds([scene, ...popupScenes, ...menuScenes.map((item) => item.scene)]);
  const graphics = extraction.assets.filter((asset) => referenced.has(asset.id)).map((asset) => ({ id: asset.id, bytes: asset.pngBytes }));
  const diagnostics: Array<{ code: string; message: string; severity?: string }> = [
    ...disc.diagnostics.filter((item) => !(input.hasBdjEntries && item.code === "BDMV_BDJ_UNSUPPORTED")).map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, input.inputRoot), severity: item.severity })),
    ...input.bdjFiles.diagnostics,
    ...extraction.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, input.inputRoot), severity: item.severity })),
    ...adapted.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, input.inputRoot), severity: item.severity })),
    ...popupAdaptations.flatMap((result) => result.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, input.inputRoot), severity: item.severity }))),
  ];
  const packagedMenuPlayItems = new Set(menuSceneResults.filter((item) => item.playlistId === menuPlaylistNumber).map((item) => item.playItem));
  for (const playItem of menuPlaylist.playItems) {
    if (packagedMenuPlayItems.has(playItem.index) || !menuIgsSceneTargets(disc, menuPlaylist, playItem.index).length) continue;
    diagnostics.push({ code: "M4_MENU_PLAY_ITEM_NOT_PACKAGED", message: `Top Menu playlist ${menuPlaylist.id} PlayItem ${playItem.index} declares an IGS stream but no extracted composition matched it; a LinkPI jump to that PlayItem keeps the current menu page.`, severity: "warning" });
  }
  if (missingPlayItemMedia.length) diagnostics.push({ code: "M5_MENU_PLAY_ITEM_MEDIA_UNAVAILABLE", message: `Menu playlist ${menuPlaylist.id} PlayItem${missingPlayItemMedia.length === 1 ? "" : "s"} ${missingPlayItemMedia.join(", ")} could not be exported as background media; the previous menu background keeps playing on those pages.`, severity: "warning" });
  if (popupScenes.length) diagnostics.push({ code: "M4_POPUP_RENDER_PARTIAL", message: "Popup IGS compositions are overlaid when POPUP_MENU has an unambiguous match for the active packaged menu clip/PID. Title playback delegated to the external player cannot be overlaid.", severity: "warning" });
  const menuScenePlayItems = menuPlaylist.playItems.filter((playItem) => menuIgsSceneTargets(disc, menuPlaylist, playItem.index).length > 0);
  const individuallyPackagedMenuPlayItems = new Set(additionalMenuMedia.filter((media) => Number(media.playlistId) === menuPlaylistNumber).map((media) => media.playItemIndex));
  const menuBackgroundsCoverScenes = menuScenePlayItems.length > 0 && menuScenePlayItems.every((playItem) => playItem.index === primaryPlayItem ? !!input.menuMedia : individuallyPackagedMenuPlayItems.has(playItem.index));
  if (!input.menuMedia && !menuBackgroundsCoverScenes && mediaScope !== "none") diagnostics.push({ code: "M5_MENU_LOOP_UNAVAILABLE", message: "The HDMV Top Menu background timeline cannot be exported as one continuous source-clip span; packaged PlayItem backgrounds switch when menu navigation selects their PlayItem.", severity: "warning" });
  if (mediaScope === "none") diagnostics.push({ code: "M5_MENU_MEDIA_DISABLED", message: "--menu-media none: no playlist media was exported; the runtime falls back to the preview bridge and reports PLAY_PLAYLIST as unavailable.", severity: "info" });
  for (const playlistId of popupContentPlaylists) diagnostics.push({ code: "M5_POPUP_CONTENT_MEDIA_EXTERNAL", message: `Playlist ${String(playlistId).padStart(5, "0")} is title playback with a popup IGS composition; its video is handed to the external player and the popup composition is not available there.`, severity: "warning" });
  if (additionalMenuMedia.length) diagnostics.push({ code: "M5_PLAYLIST_MEDIA_EXPORTED", message: `Packaged local media for playlist${additionalMenuMedia.length === 1 ? "" : "s"} ${[...new Set(additionalMenuMedia.map((media) => media.playlistId))].join(", ")}.`, severity: "info" });
  if (vmInitialProgramId === undefined || !vmPrograms.some((program) => program.id === vmInitialProgramId)) diagnostics.push({ code: "M4_MENU_OBJECT_CONTEXT_MISSING", message: "No valid HDMV Top Menu or First Play MovieObject is available for menu button commands.", severity: "warning" });
  let soundBytes: Uint8Array | null = null;
  const soundPath = disc.sounds[0]?.source.path;
  if (soundPath) {
    try {
      const relativeSoundPath = bdmvRelativePath(soundPath);
      soundBytes = await readFile(await resolveInputFile(disc.root, relativeSoundPath));
    } catch (error) {
      diagnostics.push({ code: "SOUND_SOURCE_MISSING", message: safeDiagnosticMessage(errorText(error), input.inputRoot) });
    }
  }
  const ir = createMenuDiscIR(disc, extraction.scenes.map(({ id, clipId }) => ({ id, clipId })), input.menuMedia !== null, input.hasBdjEntries);
  const mediaEncoding = menuMediaEncoding();
  const plannedMedia = [
    input.menuMedia === null ? null : "background",
    additionalMenuMedia.length ? countOf(additionalMenuMedia.length, "extra playlist", "extra playlists") : null,
  ].filter((item): item is string => item !== null);
  return {
    status: "planned",
    plan: {
      packageInput: {
        ir, scene, popupScenes, menuScenes, menuPlaylistIds, vmPrograms, vmEntries: disc.entries,
        ...(menuPlaylistMarks.length ? { menuPlaylistMarks } : {}),
        ...(input.menuTarget?.preMenuPlaylistIds?.length ? { preMenuPlaylistIds: input.menuTarget.preMenuPlaylistIds } : {}),
        externalTargets,
        bdmvPath: input.bdmvPath,
        ...(vmInitialProgramId === undefined ? {} : { vmInitialProgramId }),
        ...(vmFirstPlayProgramId === undefined ? {} : { vmFirstPlayProgramId }),
        graphics, soundEntries: disc.sounds, soundBytes, playerProfile: profile, vmLimits: limits,
        ...(input.reuseDirectory === undefined ? {} : { reuseMediaFromDirectory: input.reuseDirectory }),
        ...(input.menuMedia ? { menuLoopMedia: input.menuMedia } : {}),
        ...(additionalMenuMedia.length ? { additionalMenuMedia } : {}),
        ...(input.bdjFiles.files.length ? { bdjFiles: input.bdjFiles.files } : {}),
        ...(input.bdjFiles.files.length && input.bdjLaunch ? { bdjLaunch: { ...input.bdjLaunch, session: { vmPrograms, vmEntries: disc.entries, playerProfile: profile, vmLimits: limits, externalTargets, bdmvPath: input.bdmvPath } } } : {}),
        ...(input.bdjHostApiJar ? { bdjHostApiJar: input.bdjHostApiJar } : {}),
        ...(mediaEncoding ? { mediaEncoding } : {}),
        entryCounts,
        diagnostics: diagnostics.map(({ code, message, severity }) => ({ code, message, ...(severity === undefined ? {} : { severity }) })),
      },
      mediaInputs: [...(input.menuMedia === null ? [] : [input.menuMedia]), ...additionalMenuMedia],
      sceneDetail: menuSceneDetail(menuScene, input.menuMedia),
      mediaDetail: plannedMedia.length ? plannedMedia.join(" + ") : mediaScope === "none" ? "menu media disabled" : "no menu media",
      bundleNote: "bundling runtime",
      limitations: input.menuMedia ? [] : [mediaScope === "none" ? "Menu media export is disabled by --menu-media none." : "Menu loop media is unavailable; the menu background holds its final frame."],
    },
  };
}
