import { flagEnabled, inputPath, optionState, optionValue } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { loadLimits, loadPlayerProfile } from "../cli/profile.js";
import { deliveryDiagnostics, firstBlockingCode, stageFailure } from "../cli/stages.js";
import { commandProgress, countOf } from "../progress.js";
import { publishBuildOutcome } from "./build-outcome.js";
import { collectBdjApplicationFiles } from "../shared/bdj-files.js";
import { buildBdjHostApiJar } from "../shared/bdj-host.js";
import { normalizeDiscId, readBdmvDiscId } from "../shared/disc-id.js";
import { safeDiagnosticMessage } from "../shared/metadata.js";
import { mediaExportProgress } from "./media-progress.js";
import { readJsonObject } from "../cli/output.js";
import { assertDisjointRoots, beginOutputTransaction, locateBdmvRoot } from "@bdmv2web/bdmv-io";
import { parseBdmvWithInputTable } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes } from "@bdmv2web/igs";
import type { MenuLoopMediaInput } from "@bdmv2web/media-export";
import { classifyDiagnostics, decideDelivery } from "@bdmv2web/test-runner";
import { errorText } from "@bdmv2web/utils";
import { readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { findTopMenuPlaylist, menuLoopMediaInput, menuMediaScopedOut, menuMediaScope, playlistDurationSeconds } from "./menu-planning.js";
import { planBuild } from "../application/build-plan.js";
import { buildUseCase } from "../application/build-use-case.js";

export {
  createMenuDiscIR, createVmPrograms, findMenuScene, findTopMenuPlaylist,
  menuIgsSceneTargets, menuLoopMediaInput, menuMediaEncoding, menuMediaScope,
  menuMediaScopedOut, menuMediaEntryPoint45k, menuSceneDetail, playlistDurationSeconds, MENU_MEDIA_AUTO_MAX_SECONDS,
} from "./menu-planning.js";
export type { MenuMediaScope, MenuPlaylistTarget } from "./menu-planning.js";

const BUILD_STEPS = {
  structure: "Parse BDMV structure",
  scenes: "Extract IGS scenes",
  playlist: "Resolve Top Menu playlist",
  scene: "Select menu scene and media",
  media: "Export menu media",
  package: "Build menu package",
  report: "Write report and commit",
} as const;

async function writeConversionReport(outputDirectory: string, report: Record<string, unknown>): Promise<void> {
  const existing = await readJsonObject(resolve(outputDirectory, "reports.json"));
  const { schemaVersion, diagnostics, ...conversion } = report;
  const reports = {
    schemaVersion: typeof schemaVersion === "string" ? schemaVersion : "1.0",
    ...(diagnostics === undefined ? {} : { diagnostics }),
    ...(existing.compatibility === undefined ? {} : { compatibility: existing.compatibility }),
    conversion,
  };
  await writeFile(resolve(outputDirectory, "reports.json"), `${JSON.stringify(reports, null, 2)}\n`);
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
  const resumeDir = optionValue("--resume-dir");
  const resumeWithoutDirectory = flagEnabled("--resume");
  const plannedResume = resumeDir !== undefined
    ? await resumeMediaDirectory(undefined, resumeDir)
    : resumeWithoutDirectory && plannedOut !== undefined ? await resumeMediaDirectory(plannedOut, true) : undefined;
  const progress = commandProgress({
    command: "build",
    steps: Object.values(BUILD_STEPS),
    source: input,
    details: [
      ...(plannedOut === undefined ? [] : [["output", plannedOut] as const]),
      ...(plannedTitle === undefined ? [] : [["title", plannedTitle] as const]),
      ...(plannedResume === undefined ? [] : [["resume", plannedResume] as const]),
      ["profile", `region ${profile.region} · ${profile.outputProfile}`] as const,
    ],
  });

  progress.start(BUILD_STEPS.structure);
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
    progress.fail(BUILD_STEPS.structure, firstBlockingCode(fatalDiagnostics.blocking));
    stageFailure(firstBlockingCode(fatalDiagnostics.blocking), fatalDiagnostics.blocking);
    return;
  }
  progress.done(BUILD_STEPS.structure, `${countOf(disc.entries.length, "entry", "entries")} · ${countOf(disc.playlists.length, "playlist", "playlists")} · ${countOf(disc.clips.length, "clip", "clips")}`);
  const bdjHostApiJar = bdjFiles.files.length ? await buildBdjHostApiJar() : undefined;
  const out = plannedOut ?? resolve(dirname(disc.root), "BDMV-menu");
  const title = plannedTitle ?? basename(dirname(disc.root));
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  const bdmvPath = dirname(roots.input) === dirname(roots.output) ? relative(roots.output, disc.root).replace(/\\/g, "/") : disc.root;
  const resumeDirectory = plannedResume ?? (resumeWithoutDirectory ? await resumeMediaDirectory(roots.output, true) : undefined);
  const reuseDirectory = optionState("--reuse") === false ? resumeDirectory : (resumeDirectory ?? (overwrite ? roots.output : undefined));
  // The header names the target for inputs that follow the documented BDMV layout.
  if (plannedOut === undefined) progress.info("output", roots.output);
  if (plannedTitle === undefined) progress.info("title", title);
  if (plannedResume === undefined && resumeDirectory !== undefined) progress.info("resume", resumeDirectory);

  progress.start(BUILD_STEPS.scenes);
  const extraction = await extractIgsScenes(disc, { table });
  progress.done(BUILD_STEPS.scenes, `${countOf(extraction.scenes.length, "scene", "scenes")} · ${countOf(extraction.assets.length, "image", "images")} · ${countOf(extraction.streams.length, "stream", "streams")}`);

  progress.start(BUILD_STEPS.playlist);
  const menuTarget = findTopMenuPlaylist(disc, profile, limits, extraction.scenes);
  const menuPlaylist = menuTarget?.playlist;
  const menuMedia = mediaScope === "none" ? null : await menuLoopMediaInput(disc, menuPlaylist, { ...(menuTarget ? { playItemIndex: menuTarget.playItem } : {}) });
  progress.done(BUILD_STEPS.playlist, menuTarget === undefined
    ? "no HDMV Top Menu entry"
    : `playlist ${menuTarget.playlist.id} · PlayItem ${menuTarget.playItem}`);

  progress.start(BUILD_STEPS.scene);
  const transaction = await beginOutputTransaction(roots.output, { overwrite });
  try {
    const failMenuConversion = async (code: string, message: string): Promise<void> => {
      progress.fail(BUILD_STEPS.scene, code);
      await writeFile(resolve(transaction.stagingPath, "README.md"), `# Menu package\n\n${message}\n\nStatus: **failed**.\n`);
      const diagnostics = deliveryDiagnostics([
        { code, message, severity: "error" },
        ...disc.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
        ...extraction.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
      ]);
      const report = { schemaVersion: "1.0", status: "failed", code, reasons: [message], diagnostics };
      await writeConversionReport(transaction.stagingPath, report);
      await transaction.commit();
      publishBuildOutcome({ status: "failed", exitCode: 1, code, output: roots.output }, progress, [["output", roots.output], ["report", "reports.json · status failed"]]);
    };
    const planned = await planBuild({
      disc, extraction, profile, limits, bdmvPath, inputRoot: roots.input, mediaScope,
      hasBdjEntries, bdjFiles,
      ...(bdjLaunch === undefined ? {} : { bdjLaunch }),
      ...(bdjHostApiJar === undefined ? {} : { bdjHostApiJar }),
      bdjMenuMediaAssets, bdjScopedOutPlaylists, menuTarget, menuMedia,
      ...(reuseDirectory === undefined ? {} : { reuseDirectory }),
    });
    if (planned.status === "failed") { await failMenuConversion(planned.code, planned.message); return; }
    const plan = planned.plan;
    // Delivery status is decided from facts that are all known before packaging.
    // The package records the same conclusion (D-2R).
    const decisionFacts = deliveryDiagnostics(plan.packageInput.diagnostics ?? []);
    const decision = decideDelivery({
      checks: [],
      diagnostics: decisionFacts,
      declaredEntryCount: disc.entries.length,
      hdmvEntryCount: disc.entries.filter((entry) => entry.target.objectType === "HDMV").length,
      // Planning reached the package step, so no required asset can be missing.
      hasMissingRequiredAsset: false,
      limitations: plan.limitations,
    });
    progress.done(BUILD_STEPS.scene, plan.sceneDetail);
    const mediaProgress = mediaExportProgress(plan.mediaInputs, (ratio, detail) => progress.progress(ratio, detail));
    const packaged = await buildUseCase({
      plan, outputDirectory: transaction.stagingPath, title, status: decision.status,
      onMediaProgress: mediaProgress.onMediaProgress,
      onPhase: (phase) => {
        if (phase === "media") { if (plan.mediaInputs.length) progress.start(BUILD_STEPS.media, countOf(mediaProgress.clips, "clip", "clips")); return; }
        if (phase === "assets") { if (plan.mediaInputs.length) progress.done(BUILD_STEPS.media, plan.mediaDetail); else progress.skip(BUILD_STEPS.media, plan.mediaDetail); progress.start(BUILD_STEPS.package); return; }
        if (phase === "bundle") { progress.note(plan.bundleNote); return; }
        progress.done(BUILD_STEPS.package, "manifest written");
        progress.start(BUILD_STEPS.report);
      },
    });
    // Append post-export colour warnings to the final report diagnostics.
    for (const { code, message, severity } of packaged.diagnostics) {
      if (severity !== "warning" || decisionFacts.some((fact) => fact.code === code)) continue;
      decisionFacts.push({ severity, code, message: safeDiagnosticMessage(message, roots.input) });
    }
    const report = { schemaVersion: "1.0", status: decision.status, reasons: decision.reasons, diagnostics: decisionFacts };
    await writeConversionReport(transaction.stagingPath, report);
    await transaction.commit();
    progress.done(BUILD_STEPS.report, `status ${decision.status}`);
    const packageText = await packageSummary(roots.output);
    const launch = "bdmv2web serve <package-directory> [--java <executable>] · open the printed loopback URL";
    publishBuildOutcome({ status: decision.status, exitCode: decision.exitCode, output: roots.output, ...(hasBdjEntries ? { launch } : {}) }, progress, [
      ["output", roots.output],
      ...(packageText === undefined ? [] : [["package", packageText] as const]),
      ...(hasBdjEntries ? [["launch", launch] as const] : []),
      ["report", `reports.json · ${countOf(decisionFacts.length, "diagnostic", "diagnostics")}`],
    ]);
  } catch (error) { await transaction.abort(); throw error; }
}
