import { flagEnabled, inputPath, optionState, optionValue, strictDefault } from "../cli/context.js";
import { pngLevelOption } from "../cli/assets.js";
import { fail } from "../cli/errors.js";
import { loadLimits, loadPlayerProfile } from "../cli/profile.js";
import { deliveryDiagnostics, firstBlockingCode, stageFailure } from "../cli/stages.js";
import { ProgressReporter } from "../progress.js";
import { buildMediaClosure } from "../shared/media.js";
import { collectBdjApplicationFiles } from "../shared/bdj-files.js";
import { buildBdjHostApiJar } from "../shared/bdj-host.js";
import { normalizeDiscId, readBdmvDiscId } from "../shared/disc-id.js";
import { referencedAssetIds, safeDiagnosticMessage } from "./extract.js";
import { mediaExportProgress } from "./media-progress.js";
import { readJsonObject } from "../cli/output.js";
import { assertDisjointRoots, beginOutputTransaction, locateBdmvRoot, resolveInputFile } from "@bdmv2web/bdmv-io";
import { parseBdmvWithInputTable } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes } from "@bdmv2web/igs";
import { createExternalMediaTargets, type MenuLoopMediaInput } from "@bdmv2web/media-export";
import { buildMenuPackage } from "@bdmv2web/package-builder";
import { adaptIgsScene } from "@bdmv2web/runtime-web";
import { classifyDiagnostics, decideDelivery } from "@bdmv2web/test-runner";
import { bdmvRelativePath } from "@bdmv2web/core/disc-path";
import { errorText } from "@bdmv2web/utils";
import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import type { ProgressMode } from "../progress.js";
import { createVmPrograms, createMenuDiscIR, findTopMenuPlaylist, findMenuScene, isMenuSurfaceScene, menuIgsSceneTargets, menuLoopMediaInput, menuMediaScopedOut, menuMediaScope, menuMediaEncoding, menuPlaylistMarks as collectMenuPlaylistMarks, playlistDurationSeconds, MENU_MEDIA_AUTO_MAX_SECONDS } from "./menu-planning.js";

export {
  createMenuDiscIR, createVmPrograms, findMenuScene, findTopMenuPlaylist,
  menuIgsSceneTargets, menuLoopMediaInput, menuMediaEncoding, menuMediaScope,
  menuMediaScopedOut, menuMediaEntryPoint45k, playlistDurationSeconds, MENU_MEDIA_AUTO_MAX_SECONDS,
} from "./menu-planning.js";
export type { MenuMediaScope, MenuPlaylistTarget } from "./menu-planning.js";

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

export async function resumeMediaDirectory(output: string | undefined, requested: string | true): Promise<string> {
  const directory = requested === true ? (output === undefined ? undefined : await newestStagingDirectory(output)) : resolve(requested);
  if (directory === undefined) fail("CLI_INVALID_RESUME", "--resume found no staging directory for this output target");
  const info = await stat(directory).catch(() => undefined);
  if (info?.isDirectory() !== true) fail("CLI_INVALID_RESUME", `--resume requires an existing directory, got '${directory}'`);
  return directory;
}

async function newestStagingDirectory(output: string): Promise<string | undefined> {
  const target = resolve(output);
  const parent = dirname(target);
  const prefix = `.${basename(target)}.staging-`;
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ path: string; modified: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const path = resolve(parent, entry.name);
    const info = await stat(path).catch(() => undefined);
    if (info !== undefined) candidates.push({ path, modified: info.mtimeMs });
  }
  return candidates.sort((left, right) => right.modified - left.modified)[0]?.path;
}

export async function build(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "build requires a BDMV input path");
  // Argument contract first: every option value is resolved before the input is parsed and
  // before any output transaction exists. A missing value must never be masked by disc
  // diagnostics, and a late failure must never leave a staging directory behind.
  const outOption = optionValue("--out");
  const titleOption = optionValue("--title");
  const overwrite = flagEnabled("--overwrite");
  const discIdOption = optionValue("--disc-id");
  let discIdOverride: string | undefined;
  try { if (discIdOption !== undefined) discIdOverride = normalizeDiscId(discIdOption); }
  catch (error) { fail("CLI_INVALID_DISC_ID", errorText(error)); }
  const limits = await loadLimits(optionValue("--limits"));
  const profile = await loadPlayerProfile(optionValue("--player-profile"));
  // Best effort: the header names the output only for inputs that resolve to a BDMV
  // root; anything else is reported by the first step with the parser's own code.
  const plannedRoot = await locateBdmvRoot(input).catch(() => undefined);
  const plannedOut = outOption !== undefined
    ? await plannedOutputPath(outOption)
    : plannedRoot === undefined ? undefined : await plannedOutputPath(resolve(dirname(plannedRoot), "BDMV-menu"));
  const plannedTitle = titleOption ?? (plannedRoot === undefined ? undefined : basename(dirname(plannedRoot)));
  const resumeOption = optionValue("--resume");
  const resumeWithoutDirectory = optionState("--resume") === true;
  const plannedResume = resumeOption !== undefined
    ? await resumeMediaDirectory(undefined, resumeOption)
    : resumeWithoutDirectory && plannedOut !== undefined ? await resumeMediaDirectory(plannedOut, true) : undefined;
  const mode = progressMode();
  const progress = new ProgressReporter({
    command: "convert",
    steps: Object.values(CONVERT_STEPS),
    source: input,
    details: [
      ...(plannedOut === undefined ? [] : [["output", plannedOut] as const]),
      ...(plannedTitle === undefined ? [] : [["title", plannedTitle] as const]),
      ...(plannedResume === undefined ? [] : [["resume", plannedResume] as const]),
      ["profile", `region ${profile.region} · ${profile.outputProfile}`] as const,
    ],
    ...(mode === undefined ? {} : { mode }),
  });

  progress.start(CONVERT_STEPS.structure);
  const { disc, table } = await parseBdmvWithInputTable(input);
  const bdjFiles = await collectBdjApplicationFiles(disc);
  const hasBdjEntries = disc.entries.some((entry) => entry.target.objectType === "BDJ");
  const initialBdjTarget = disc.entries.find((entry) => entry.kind === "firstPlay" && entry.target.objectType === "BDJ")?.target
    ?? disc.entries.find((entry) => entry.kind === "topMenu" && entry.target.objectType === "BDJ")?.target
    ?? disc.entries.find((entry) => entry.target.objectType === "BDJ")?.target;
  const initialBdjoId = initialBdjTarget?.target == null ? "00000" : String(initialBdjTarget.target).padStart(5, "0");
  const nativeDiscId = hasBdjEntries ? await readBdmvDiscId(disc.root) : undefined;
  if (hasBdjEntries && !discIdOverride && !nativeDiscId) console.warn("BD-J disc ID is unknown; provide the original CERTIFICATE/id.bdmv or --disc-id <32hex>.");
  const bdjLaunch = hasBdjEntries ? {
    discId: discIdOverride ?? nativeDiscId ?? "00000000000000000000000000000000",
    initialBdjoId,
    applications: (disc.bdjos ?? []).flatMap((bdjo) => bdjo.applications.map((application) => ({
      bdjoId: basename(bdjo.path).replace(/\.[^.]+$/, "").padStart(5, "0"),
      controlCode: application.controlCode, binding: application.binding,
      organizationId: application.organizationId, applicationId: application.applicationId,
      initialClass: application.initialClass, basePath: application.basePath,
      classPath: application.classPath, parameters: application.parameters,
    }))),
  } : undefined;
  const bdjAccessiblePlaylists = new Set((disc.bdjos ?? []).flatMap((bdjo) => bdjo.accessiblePlaylists.accessToAll
    ? disc.playlists.map((playlist) => playlist.id)
    : bdjo.accessiblePlaylists.playlistIds.map((id) => id.padStart(5, "0"))));
  const mediaScope = menuMediaScope();
  const bdjMenuMediaAssets: MenuLoopMediaInput[] = [];
  const bdjScopedOutPlaylists: Array<{ id: string; seconds: number }> = [];
  if (hasBdjEntries) for (const playlist of disc.playlists) {
    if (!bdjAccessiblePlaylists.has(playlist.id)) continue;
    if (menuMediaScopedOut(playlist, mediaScope)) {
      if (mediaScope === "auto") bdjScopedOutPlaylists.push({ id: playlist.id, seconds: playlistDurationSeconds(playlist) });
      continue;
    }
    for (const playItem of playlist.playItems) {
      const input = await menuLoopMediaInput(disc, playlist, { playItemIndex: playItem.index, purpose: "bdj-playback" }).catch(() => null);
      if (input) bdjMenuMediaAssets.push(input);
    }
  }
  const fatalDiagnostics = classifyDiagnostics(disc.diagnostics);
  if (fatalDiagnostics.hasFatal) {
    progress.fail(CONVERT_STEPS.structure, firstBlockingCode(fatalDiagnostics.blocking));
    stageFailure(firstBlockingCode(fatalDiagnostics.blocking), fatalDiagnostics.blocking);
    return;
  }
  progress.done(CONVERT_STEPS.structure, `${countOf(disc.entries.length, "entry", "entries")} · ${countOf(disc.playlists.length, "playlist", "playlists")} · ${countOf(disc.clips.length, "clip", "clips")}`);
  const bdjHostApiJar = bdjFiles.files.length ? await buildBdjHostApiJar() : undefined;
  const out = plannedOut ?? resolve(dirname(disc.root), "BDMV-menu");
  const title = plannedTitle ?? basename(dirname(disc.root));
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  const bdmvPath = dirname(roots.input) === dirname(roots.output) ? relative(roots.output, disc.root) : disc.root;
  const bdjSession = (vmPrograms: ReturnType<typeof createVmPrograms>, externalTargets: ReturnType<typeof createExternalMediaTargets>) => ({
    vmPrograms, vmEntries: disc.entries, playerProfile: profile, vmLimits: limits, externalTargets, bdjoDescriptors: disc.bdjos ?? [], bdmvPath,
  });
  const resumeDirectory = plannedResume ?? (resumeWithoutDirectory ? await resumeMediaDirectory(roots.output, true) : undefined);
  const reuseDirectory = resumeDirectory ?? (overwrite ? roots.output : undefined);
  // The header names the target for inputs that follow the documented BDMV layout.
  if (plannedOut === undefined) progress.info("output", roots.output);
  if (plannedTitle === undefined) progress.info("title", title);
  if (plannedResume === undefined && resumeDirectory !== undefined) progress.info("resume", resumeDirectory);

  progress.start(CONVERT_STEPS.scenes);
  const extraction = await extractIgsScenes(disc, { pngLevel: pngLevelOption(), table });
  progress.done(CONVERT_STEPS.scenes, `${countOf(extraction.scenes.length, "scene", "scenes")} · ${countOf(extraction.assets.length, "image", "images")} · ${countOf(extraction.streams.length, "stream", "streams")}`);

  progress.start(CONVERT_STEPS.playlist);
  const menuTarget = findTopMenuPlaylist(disc, profile, limits, extraction.scenes);
  const menuPlaylist = menuTarget?.playlist;
  const menuMedia = mediaScope === "none" ? null : await menuLoopMediaInput(disc, menuPlaylist, { ...(menuTarget ? { playItemIndex: menuTarget.playItem } : {}) });
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
    const firstPlayEntry = disc.entries.find((entry) => entry.kind === "firstPlay");
    const topMenuEntry = disc.entries.find((entry) => entry.kind === "topMenu");
    const initialBdjEntry = firstPlayEntry?.target.objectType === "BDJ" ? firstPlayEntry
      : topMenuEntry?.target.objectType === "BDJ" ? topMenuEntry
        : undefined;
    if (!menuTarget && initialBdjEntry && hasBdjEntries && bdjFiles.files.length) {
      const missingApplication = bdjFiles.diagnostics.find((item) => item.code === "BDJ_APPLICATION_BASE_PATH_INVALID" || item.code === "BDJ_APPLICATION_JAR_MISSING");
      if (missingApplication) { await failMenuConversion(missingApplication.code, missingApplication.message); return; }
      const vmPrograms = createVmPrograms(disc);
      const firstPlayHdmv = firstPlayEntry?.target.objectType === "HDMV" && typeof firstPlayEntry.target.target === "number" ? firstPlayEntry.target.target : undefined;
      const topMenuHdmv = topMenuEntry?.target.objectType === "HDMV" && typeof topMenuEntry.target.target === "number" ? topMenuEntry.target.target : undefined;
      const vmInitialProgramId = firstPlayEntry?.target.objectType === "BDJ" ? undefined : topMenuHdmv ?? firstPlayHdmv;
      const mediaClosure = buildMediaClosure(disc, extraction.scenes);
      const externalTargets = createExternalMediaTargets(disc, mediaClosure);
      const mixedPlaylistSceneResults = disc.playlists.flatMap((playlist) => playlist.playItems.flatMap((playItem) => {
        const result = findMenuScene(disc, playlist, extraction.scenes, playItem.index);
        return result.status === "found" ? [{ playlistId: Number(playlist.id), playItem: playItem.index, scene: result.scene, adapted: adaptIgsScene(result.scene, extraction.assets) }] : [];
      }));
      const mixedMenuSceneResults = mixedPlaylistSceneResults.filter((item) => item.scene.uiModel === 0);
      const mixedMenuScenes = mixedMenuSceneResults.map((item) => ({ playlistId: item.playlistId, playItem: item.playItem, scene: item.adapted.scene }));
      const mixedMenuPlaylistIds = [...new Set(mixedMenuScenes.map((item) => item.playlistId))];
      const mixedMenuPlaylistMarks = collectMenuPlaylistMarks(disc, mixedMenuPlaylistIds);
      const mixedPopupScenes = extraction.scenes.filter((item) => item.uiModel === 1).map((item) => adaptIgsScene(item, extraction.assets).scene);
      const mixedReferencedAssets = referencedAssetIds([...mixedPopupScenes, ...mixedMenuScenes.map((item) => item.scene)]);
      const mixedGraphics = extraction.assets.filter((asset) => mixedReferencedAssets.has(asset.id)).map((asset) => ({ id: asset.id, bytes: asset.pngBytes }));
      const diagnostics: Array<{ code: string; message: string; severity?: string }> = [
        ...disc.diagnostics.filter((item) => item.code !== "BDMV_BDJ_UNSUPPORTED").map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
        ...bdjFiles.diagnostics,
        ...extraction.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
        { code: "BDJ_RUNTIME_EXECUTION_UNVERIFIED", message: "Browser execution, Java API host calls, AWT rendering, and disc playback callbacks have not been verified with this runtime package.", severity: "warning" },
        ...(bdjScopedOutPlaylists.length ? [{
          code: "M5_MENU_MEDIA_SCOPE_SKIPPED",
          message: `Skipped ${countOf(bdjScopedOutPlaylists.length, "playlist", "playlists")} longer than ${MENU_MEDIA_AUTO_MAX_SECONDS} seconds (${bdjScopedOutPlaylists.slice(0, 8).map((item) => `${item.id} · ${Math.round(item.seconds / 60)} min`).join(", ")}${bdjScopedOutPlaylists.length > 8 ? ", …" : ""}). --menu-media auto exports menu-length playlists only; use --menu-media all to export every playlist the BDJO declares.`,
          severity: "info",
        }] : []),
        ...(mediaScope === "none" ? [{ code: "M5_MENU_MEDIA_DISABLED", message: "--menu-media none: no playlist media was exported; BD-J players that request a playlist will report it as unavailable.", severity: "info" }] : []),
      ];
      const decisionFacts = deliveryDiagnostics(diagnostics);
      const decision = decideDelivery({
        checks: [], diagnostics: decisionFacts,
        declaredEntryCount: disc.entries.length,
        hdmvEntryCount: disc.entries.filter((entry) => entry.target.objectType === "HDMV").length,
        hasMissingRequiredAsset: false,
        limitations: ["BD-J menu background and playlist media depend on the browser playback bridge."],
      }, strictDefault());
      const blockingDiagnostics = classifyDiagnostics(decisionFacts).blocking;
      progress.done(CONVERT_STEPS.scene, `BDJO ${String(initialBdjEntry.target.target)} · ${bdjFiles.files.length} application/resource files`);
      const mediaEncoding = menuMediaEncoding();
      const mediaProgress = mediaExportProgress(bdjMenuMediaAssets, (ratio, detail) => progress.progress(ratio, detail));
      const packaged = await buildMenuPackage({
        outputDirectory: transaction.stagingPath, title, ir: createMenuDiscIR(disc, mixedMenuScenes.map((item) => ({ id: item.scene.id ?? `playlist-${item.playlistId}-pi-${item.playItem}`, clipId: item.scene.clipId ?? "" })), false, true), scene: null, graphics: mixedGraphics,
        status: decision.status, entryCounts: { declared: disc.entries.length, hdmv: disc.entries.filter((entry) => entry.target.objectType === "HDMV").length },
        vmPrograms, vmEntries: disc.entries, externalTargets, menuScenes: mixedMenuScenes, menuPlaylistIds: mixedMenuPlaylistIds,
        ...(mixedMenuPlaylistMarks.length ? { menuPlaylistMarks: mixedMenuPlaylistMarks } : {}), popupScenes: mixedPopupScenes,
        bdmvPath,
        ...(vmInitialProgramId === undefined ? {} : { vmInitialProgramId }),
        ...(firstPlayHdmv === undefined ? {} : { vmFirstPlayProgramId: firstPlayHdmv }),
        mediaEncoding: { codec: "h264", ...mediaEncoding },
        soundEntries: disc.sounds, playerProfile: profile, vmLimits: limits,
        ...(bdjMenuMediaAssets.length ? { additionalMenuMedia: bdjMenuMediaAssets } : {}),
        ...(reuseDirectory === undefined ? {} : { reuseMediaFromDirectory: reuseDirectory }),
        bdjFiles: bdjFiles.files, ...(bdjHostApiJar ? { bdjHostApiJar } : {}), ...(bdjLaunch ? { bdjLaunch: { ...bdjLaunch, session: bdjSession(vmPrograms, externalTargets) } } : {}),
        diagnostics: diagnostics.map(({ code, message, severity }) => ({ code, message, ...(severity === undefined ? {} : { severity }) })),
        onMediaProgress: mediaProgress.onMediaProgress,
        onPhase: (phase) => {
          if (phase === "media") { if (bdjMenuMediaAssets.length) progress.start(CONVERT_STEPS.media, countOf(mediaProgress.clips, "clip", "clips")); return; }
          if (phase === "assets") { if (bdjMenuMediaAssets.length) progress.done(CONVERT_STEPS.media, countOf(bdjMenuMediaAssets.length, "BD-J PlayItem", "BD-J PlayItems")); else progress.skip(CONVERT_STEPS.media, mediaScope === "none" ? "menu media disabled" : "no playlist media inside the menu scope"); progress.start(CONVERT_STEPS.package); return; }
          if (phase === "bundle") { progress.note("bundling BD-J and HDMV runtime"); return; }
          if (phase === "manifest") { progress.done(CONVERT_STEPS.package, "manifest written"); progress.start(CONVERT_STEPS.report); }
        },
      });
      for (const { code, message, severity } of packaged.diagnostics) {
        if (severity !== "warning" || decisionFacts.some((fact) => fact.code === code)) continue;
        decisionFacts.push({ severity, code, message: safeDiagnosticMessage(message, roots.input) });
      }
      const report = { schemaVersion: "1.0", status: decision.status, auditScope: "convert", reasons: decision.reasons, notVerified: decision.notVerified, diagnostics: decisionFacts, blockingDiagnostics };
      await writeFile(resolve(transaction.stagingPath, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
      await transaction.commit();
      progress.done(CONVERT_STEPS.report, `status ${decision.status}`);
      const packageText = await packageSummary(roots.output);
      progress.finish(decision.status, [["output", roots.output], ...(packageText === undefined ? [] : [["package", packageText] as const]), ["launch", "bdmv2web serve <package-directory> [--java <executable>] · open the printed loopback URL"], ["report", `report.json · ${countOf(decisionFacts.length, "diagnostic", "diagnostics")}`]]);
      process.stdout.write(`${JSON.stringify({ status: decision.status, output: roots.output, launch: "bdmv2web serve <package-directory> [--java <executable>] · open the printed loopback URL" })}\n`);
      return;
    }
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
    const menuSceneResults = playlistSceneResults.filter((item) => isMenuSurfaceScene(item.scene.uiModel, item.playlistId, menuPlaylistNumber));
    const menuPlaylistIds = [...new Set(menuSceneResults.map((item) => item.playlistId))];
    // PLAY_PLAYLIST_MARK names a play mark; the runtime needs the mark-to-
    // PlayItem mapping to select the packaged scene for the marked PlayItem.
    const menuPlaylistMarks = collectMenuPlaylistMarks(disc, [...new Set([...menuPlaylistIds, Number(menuPlaylist.id)])]);
    const menuScenes = menuSceneResults.map((item) => ({ playlistId: item.playlistId, playItem: item.playItem, scene: item.adapted.scene }));
    const additionalMenuMedia: Array<NonNullable<Awaited<ReturnType<typeof menuLoopMediaInput>>>> = [];
    const popupContentPlaylists: number[] = [];
    const missingPlayItemMedia: number[] = [];
    const primaryPlayItem = menuMedia ? menuTarget?.playItem ?? 0 : null;
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
    const popupAdaptations = extraction.scenes.filter((candidate) => candidate.uiModel === 1).map((candidate) => adaptIgsScene(candidate, extraction.assets));
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
      ...disc.diagnostics.filter((item) => !(hasBdjEntries && item.code === "BDMV_BDJ_UNSUPPORTED")).map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
      ...bdjFiles.diagnostics,
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
    if (!menuMedia && mediaScope !== "none") diagnostics.push({ code: "M5_MENU_LOOP_UNAVAILABLE", message: "The HDMV Top Menu command selected a playlist, but its background timeline could not be represented as one continuous source-clip span or a repeated tail with supported video and primary audio streams.", severity: "warning" });
    if (mediaScope === "none") diagnostics.push({ code: "M5_MENU_MEDIA_DISABLED", message: "--menu-media none: no playlist media was exported; the runtime falls back to the preview bridge and reports PLAY_PLAYLIST as unavailable.", severity: "info" });
    for (const playlistId of popupContentPlaylists) diagnostics.push({ code: "M5_POPUP_CONTENT_MEDIA_EXTERNAL", message: `Playlist ${String(playlistId).padStart(5, "0")} is title playback with a popup IGS composition; its video is handed to the external player and the popup composition is not available there.`, severity: "warning" });
    if (additionalMenuMedia.length) diagnostics.push({ code: "M5_PLAYLIST_MEDIA_EXPORTED", message: `Packaged local media for playlist${additionalMenuMedia.length === 1 ? "" : "s"} ${[...new Set(additionalMenuMedia.map((media) => media.playlistId))].join(", ")}.`, severity: "info" });
    if (vmInitialProgramId === undefined || !vmPrograms.some((program) => program.id === vmInitialProgramId)) diagnostics.push({ code: "M4_MENU_OBJECT_CONTEXT_MISSING", message: "No valid HDMV Top Menu or First Play MovieObject is available for menu button commands.", severity: "warning" });
    let soundBytes: Uint8Array | null = null;
    const soundPath = disc.sounds[0]?.source.path;
    if (soundPath) {
      try {
        const relativeSoundPath = bdmvRelativePath(soundPath);
        soundBytes = new Uint8Array(await readFile(await resolveInputFile(disc.root, relativeSoundPath)));
      } catch (error) {
        diagnostics.push({ code: "SOUND_SOURCE_MISSING", message: safeDiagnosticMessage(errorText(error), roots.input) });
      }
    }
    const ir = createMenuDiscIR(disc, extraction.scenes.map(({ id, clipId }) => ({ id, clipId })), menuMedia !== null, hasBdjEntries);
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
      limitations: menuMedia ? [] : [mediaScope === "none" ? "Menu media export is disabled by --menu-media none." : "Menu loop media is unavailable; the menu background holds its final frame."],
    }, strictDefault());
    const blockingDiagnostics = classifyDiagnostics(decisionFacts).blocking;
    const plannedMedia = [
      menuMedia === null ? null : "background",
      additionalMenuMedia.length ? countOf(additionalMenuMedia.length, "extra playlist", "extra playlists") : null,
    ].filter((item): item is string => item !== null);
    progress.done(CONVERT_STEPS.scene, menuSceneDetail(menuScene, menuMedia));
    const mediaEncoding = menuMediaEncoding();
    const mediaProgress = mediaExportProgress([...(menuMedia === null ? [] : [menuMedia]), ...additionalMenuMedia], (ratio, detail) => progress.progress(ratio, detail));
    const packaged = await buildMenuPackage({
      pngLevel: pngLevelOption(),
      outputDirectory: transaction.stagingPath, title, ir, status: decision.status,
      ...(mediaEncoding ? { mediaEncoding } : {}),
      entryCounts: { declared: disc.entries.length, hdmv: disc.entries.filter((entry) => entry.target.objectType === "HDMV").length },
      scene, popupScenes, menuScenes, menuPlaylistIds, vmPrograms, vmEntries: disc.entries,
      ...(menuPlaylistMarks.length ? { menuPlaylistMarks } : {}),
      ...(menuTarget?.preMenuPlaylistIds?.length ? { preMenuPlaylistIds: menuTarget.preMenuPlaylistIds } : {}),
      externalTargets,
      bdmvPath,
      ...(vmInitialProgramId === undefined ? {} : { vmInitialProgramId }),
      ...(vmFirstPlayProgramId === undefined ? {} : { vmFirstPlayProgramId }),
      graphics, soundEntries: disc.sounds, soundBytes, playerProfile: profile, vmLimits: limits,
      ...(reuseDirectory === undefined ? {} : { reuseMediaFromDirectory: reuseDirectory }),
      ...(menuMedia ? { menuLoopMedia: menuMedia } : {}),
      ...(additionalMenuMedia.length ? { additionalMenuMedia } : {}),
      ...(bdjFiles.files.length ? { bdjFiles: bdjFiles.files } : {}),
      ...(bdjFiles.files.length && bdjLaunch ? { bdjFiles: bdjFiles.files, bdjHostApiJar: bdjHostApiJar!, bdjLaunch: { ...bdjLaunch, session: bdjSession(vmPrograms, externalTargets) } } : {}),
      onMediaProgress: mediaProgress.onMediaProgress,
      onPhase: (phase) => {
        if (phase === "media") {
          if (plannedMedia.length) progress.start(CONVERT_STEPS.media, countOf(mediaProgress.clips, "clip", "clips"));
          return;
        }
        if (phase === "assets") {
          if (plannedMedia.length) progress.done(CONVERT_STEPS.media, plannedMedia.join(" + "));
          else progress.skip(CONVERT_STEPS.media, mediaScope === "none" ? "menu media disabled" : "no menu media");
          progress.start(CONVERT_STEPS.package);
          return;
        }
        if (phase === "bundle") { progress.note("bundling runtime"); return; }
        progress.done(CONVERT_STEPS.package, "manifest written");
        progress.start(CONVERT_STEPS.report);
      },
      diagnostics: diagnostics.map(({ code, message, severity }) => ({ code, message, ...(severity === undefined ? {} : { severity }) })),
    });
    // Append post-export colour warnings to the final report diagnostics.
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
    ...(hasBdjEntries ? [["launch", "bdmv2web serve <package-directory> [--java <executable>] · open the printed loopback URL"] as const] : []),
      ["report", `report.json · ${countOf(decisionFacts.length, "diagnostic", "diagnostics")}`],
    ]);
    process.stdout.write(`${JSON.stringify({ status: decision.status, output: roots.output, ...(hasBdjEntries ? { launch: "bdmv2web serve <package-directory> [--java <executable>] · open the printed loopback URL" } : {}) })}\n`);
    if (decision.exitCode !== 0) process.exitCode = decision.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
}
