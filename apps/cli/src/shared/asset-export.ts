import {
  igsElementRecord, igsMnuPath, pgsTrackEntrySuffixes, pngLevelOption, selectedClip, selectedPid, supDisplaySetPath, supTrackPath, uniquePgsReferences,
} from "../cli/assets.js";
import type { AssetRecord, AssetSelection, AssetType } from "../cli/assets.js";
import { fail } from "../cli/errors.js";
import { firstBlockingCode, stageFailure } from "../cli/stages.js";
import { commandProgress, countOf } from "../progress.js";
import type { ProgressReporter } from "../progress.js";
import { extractReachablePgsTracks, pgsTrackPngPlan, reachablePgsReferences, trackProgress, writeDisplaySetPngs } from "./pgs.js";
import { BDMV_STEPS, STREAM_STEPS } from "./steps.js";
import { discoverGraphicsStreams } from "./stream-input.js";
import type { StreamTarget } from "./stream-input.js";
import { assertDisjointRoots, beginOutputTransaction, readFileChunks } from "@bdmv2web/bdmv-io";
import { parseBdmvWithInputTable } from "@bdmv2web/bdmv-parser";
import { extractIgsFromChunks, extractIgsScenes } from "@bdmv2web/igs";
import type { IgsDiagnostic } from "@bdmv2web/igs";
import { extractPgsTracks, pgsDisplaySetEnd90k } from "@bdmv2web/media-export";
import { classifyDiagnostics, decideStageOutcome } from "@bdmv2web/test-runner";
import { ContractError, DEFAULT_LIMITS } from "@bdmv2web/core";
import { errorText } from "@bdmv2web/utils";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

/**
 * What one run of the graphics pipeline writes.
 *
 * `export` writes containers (.mnu/.sup) next to the PNGs; `render` is the same
 * pipeline with `containers: false`, so both commands produce byte-identical PNGs
 * and manifest records for the same input instead of drifting apart.
 */
export interface ExportRun {
  /** Command name shown in the progress header. */
  command: string;
  /** Write `.mnu`/`.sup` containers next to the PNGs; `false` renders PNGs only. */
  containers: boolean;
  /** Contract code for input-selection failures on this command. */
  selectionCode: string;
}

/** Export .mnu/.sup from a BDMV disc, rendering PNGs when the selection asks for them. */
export async function exportBdmvAssets(input: string, out: string, type: AssetType, selection: AssetSelection, run: ExportRun): Promise<void> {
  const progress = reporter(run, input, out, type, Object.values(BDMV_STEPS));
  progress.start(BDMV_STEPS.structure);
  const { disc, table } = await parseBdmvWithInputTable(input);
  const facts = classifyDiagnostics(disc.diagnostics);
  if (facts.hasFatal) { failStage(progress, BDMV_STEPS.structure, firstBlockingCode(facts.blocking), facts.blocking, out); return; }
  progress.done(BDMV_STEPS.structure, `${countOf(disc.entries.length, "entry", "entries")} · ${countOf(disc.clips.length, "clip", "clips")}`);
  const roots = await assertDisjointRoots(disc.root, out);
  // IGS extraction always runs: the reachable SUP tracks are discovered through the
  // scenes it returns, even when only SUP output was requested.
  progress.start(BDMV_STEPS.igs);
  const igs = await extractIgsScenes(disc, { renderAssets: selection.renderPng && type !== "sup", captureStreams: run.containers && type !== "sup", pngLevel: pngLevelOption(), table });
  progress.done(BDMV_STEPS.igs, `${countOf(igs.scenes.length, "scene", "scenes")} · ${countOf(igs.streams.length, "stream", "streams")} · ${countOf(igs.assets.length, "image", "images")}`);
  const outcome = decideStageOutcome({ stage: "extract", diagnostics: [...disc.diagnostics, ...igs.diagnostics] });
  if (outcome.status === "failed") { failStage(progress, BDMV_STEPS.igs, firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics, roots.output); return; }
  const transaction = await beginOutputTransaction(roots.output);
  try {
    const files: AssetRecord[] = [];
    if (run.containers && type !== "sup") for (const stream of igs.streams.filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection))) {
      const path = igsMnuPath(stream.clipId, stream.pid);
      const target = resolve(transaction.stagingPath, path);
      await mkdir(dirname(target), { recursive: true });
      if (!stream.bytes) throw new Error(`Raw IGS bytes were not retained for ${stream.clipId} PID ${stream.pid}`);
      await writeFile(target, stream.bytes, { flag: "wx" });
      files.push({ type: "igs", format: "mnu", path, byteLength: stream.byteLength });
    }
    for (const asset of igs.assets.filter((item) => selectedClip(item.source.clipId, selection) && selectedPid(item.source.pid, selection))) {
      const target = resolve(transaction.stagingPath, asset.relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, asset.pngBytes, { flag: "wx" });
      files.push(igsElementRecord(asset));
    }
    if (type !== "igs") {
      progress.start(BDMV_STEPS.sup);
      const references = uniquePgsReferences(reachablePgsReferences(disc, igs.scenes)).filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection));
      const trackSuffixes = pgsTrackEntrySuffixes(references);
      // Containers land in the package; a PNG-only run extracts them into a scratch
      // directory that never reaches the output target.
      const trackDirectory = run.containers ? transaction.stagingPath : await mkdtemp(resolve(tmpdir(), "bdmv-render-png-"));
      try {
        const tracks = await extractReachablePgsTracks(disc, igs.scenes, trackDirectory, (_reference, index) => supTrackPath(references[index]!.clipId, references[index]!.pid, index, trackSuffixes[index]), references);
        const uniqueTracks = [...new Map(tracks.map((track) => [track.path, track])).values()];
        progress.done(BDMV_STEPS.sup, countOf(uniqueTracks.length, "track", "tracks"));
        // Each track's PNGs follow its SUP record, so the manifest keeps grouping by
        // track; the decode step still spans all of them as one monotonic ratio.
        const decodeTotal = uniqueTracks.reduce((count, track) => count + track.displaySets.length, 0);
        const decode = selection.renderPng && decodeTotal > 0;
        if (decode) progress.start(BDMV_STEPS.decode);
        let decodedSets = 0;
        let pngCount = 0;
        for (const track of uniqueTracks) {
          const trackIndex = tracks.indexOf(track);
          const trackSuffix = trackSuffixes[trackIndex] ?? "";
          if (run.containers) {
            const trackStat = await lstat(resolve(transaction.stagingPath, track.path));
            files.push({ type: "sup", path: track.path, byteLength: trackStat.size, language: track.language, streamNumber: track.streamNumber, displaySetCount: track.displaySets.length });
          }
          if (!decode) continue;
          const trackEnd90k = Number(track.sourceOut90k) - Number(track.sourceIn90k);
          const pngs = await writeDisplaySetPngs(pgsTrackPngPlan({
            stagingPath: transaction.stagingPath,
            displaySets: track.displaySets,
            origin90k: 0,
            end90k: (index) => pgsDisplaySetEnd90k(track.displaySets, index, trackEnd90k),
            pathFor: (index) => supDisplaySetPath(track.clipId, track.pid, track.language, index, trackSuffix),
            language: track.language,
            streamNumber: track.streamNumber,
            level: pngLevelOption(),
            onProgress: trackProgress(progress, decodedSets, decodeTotal),
          }));
          files.push(...pngs);
          pngCount += pngs.length;
          decodedSets += track.displaySets.length;
        }
        if (decode) progress.done(BDMV_STEPS.decode, countOf(pngCount, "PNG", "PNGs"));
        else progress.skip(BDMV_STEPS.decode, selection.renderPng ? "no display sets" : "not requested");
      } finally { if (!run.containers) await rm(trackDirectory, { recursive: true, force: true }); }
    } else {
      progress.skip(BDMV_STEPS.sup, "not requested");
      progress.skip(BDMV_STEPS.decode, "not requested");
    }
    await commitAssetManifest(progress, transaction, files, outcome.status === "partial" ? "partial" : "complete", roots.output, BDMV_STEPS.commit);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
}

/** Export .mnu/.sup from one standalone m2ts byte stream (.m2ts or .rsks file). */
export async function exportStreamAssets(target: StreamTarget, out: string, type: AssetType, selection: AssetSelection, run: ExportRun): Promise<void> {
  if (selection.clipId !== undefined) fail(run.selectionCode, "--m2ts applies to BDMV input; a stream file is one clip");
  const progress = reporter(run, target.path, out, type, Object.values(STREAM_STEPS));
  progress.start(STREAM_STEPS.probe);
  const streams = await discoverGraphicsStreams(target.path);
  const pgsPids = streams.pgsPids.filter((pid) => selectedPid(pid, selection));
  const igsPids = streams.igsPids.filter((pid) => selectedPid(pid, selection));
  if (selection.pid !== undefined && pgsPids.length === 0 && igsPids.length === 0) {
    fail(run.selectionCode, `--pid 0x${selection.pid.toString(16).padStart(4, "0")} is not declared as PGS (0x90) or IGS (0x91) in ${target.path}`);
  }
  const declared = describeStreams(pgsPids, igsPids);
  progress.done(STREAM_STEPS.probe, declared);
  const diagnostics: IgsDiagnostic[] = [...streams.diagnostics];
  if (pgsPids.length === 0 && igsPids.length === 0) {
    diagnostics.push({ severity: "warning", code: "EXPORT_NO_GRAPHICS_STREAM", message: `${target.stem} declares no PGS (0x90) or IGS (0x91) stream in its program tables`, source: null, affectedSceneIds: [] });
  }
  progress.start(STREAM_STEPS.extract);
  // IGS scenes and stream bytes are computed before the output transaction opens,
  // so a failed stage keeps the output target untouched. The probe-declared IGS
  // PIDs become the structural cues: extractIgsFromChunks treats cue-less input
  // with discovered streams as a PID conflict, and cue PIDs must cover the PMT.
  const extraction = type !== "sup" && igsPids.length > 0
    ? await extractIgsFromChunks(
        target.stem,
        readFileChunks(target.path, DEFAULT_LIMITS, DEFAULT_LIMITS.maxReadWindowBytes),
        streams.igsPids.map((pid) => ({ pid, source: { path: basename(target.path), origin: "primary" as const, offset: "0" } })),
        { captureStreams: run.containers, renderAssets: selection.renderPng, pngLevel: pngLevelOption() },
      )
    : null;
  if (extraction) diagnostics.push(...extraction.diagnostics);
  const outcome = decideStageOutcome({ stage: "extract", diagnostics });
  if (outcome.status === "failed") { failStage(progress, STREAM_STEPS.extract, firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics, out); return; }
  // A stream file is read-only input, so the output directory carries no
  // overlap hazard the way a disc root does; exporting next to the stream is
  // the normal case. The transaction still refuses an existing target.
  const transaction = await beginOutputTransaction(out);
  try {
    const files: AssetRecord[] = [];
    if (extraction) {
      if (run.containers) for (const stream of extraction.streams.filter((item) => selectedPid(item.pid, selection))) {
        const path = igsMnuPath(target.stem, stream.pid);
        const mnuTarget = resolve(transaction.stagingPath, path);
        await mkdir(dirname(mnuTarget), { recursive: true });
        if (!stream.bytes) throw new Error(`Raw IGS bytes were not retained for ${target.stem} PID ${stream.pid}`);
        await writeFile(mnuTarget, stream.bytes, { flag: "wx" });
        files.push({ type: "igs", format: "mnu", path, byteLength: stream.byteLength });
      }
      for (const asset of extraction.assets.filter((item) => selectedPid(item.source.pid, selection))) {
        const pngTarget = resolve(transaction.stagingPath, asset.relativePath);
        await mkdir(dirname(pngTarget), { recursive: true });
        await writeFile(pngTarget, asset.pngBytes, { flag: "wx" });
        files.push(igsElementRecord(asset));
      }
    }
    if (type !== "igs" && pgsPids.length > 0) {
      const trackDirectory = run.containers ? transaction.stagingPath : await mkdtemp(resolve(tmpdir(), "stream-render-png-"));
      try {
        const requests = pgsPids.map((pid, index) => ({ pid, outputPath: resolve(trackDirectory, supTrackPath(target.stem, pid, index)) }));
        let tracks;
        try { tracks = await extractPgsTracks(target.path, requests); }
        catch (error) { throw new ContractError("EXPORT_INVALID_STREAM", target.path, `A PMT-declared PGS PID could not be extracted as SUP: ${errorText(error)}`); }
        progress.done(STREAM_STEPS.extract, countOf(tracks.length, "SUP track", "SUP tracks"));
        const decodeTotal = tracks.reduce((count, track) => count + track.displaySets.length, 0);
        const decode = selection.renderPng && decodeTotal > 0;
        if (decode) progress.start(STREAM_STEPS.decode);
        let decodedSets = 0;
        let pngCount = 0;
        for (const [index, track] of tracks.entries()) {
          const path = supTrackPath(target.stem, track.pid, index);
          if (run.containers) files.push({ type: "sup", path, byteLength: track.byteLength, language: "und", streamNumber: index + 1, displaySetCount: track.displaySets.length });
          if (!decode) continue;
          const pngs = await writeDisplaySetPngs(pgsTrackPngPlan({
            stagingPath: transaction.stagingPath,
            displaySets: track.displaySets,
            // The SUP keeps its source PTS timeline, so rendered seconds are
            // measured from the first display set, not from zero on the clock.
            origin90k: track.displaySets[0]?.pts90k ?? 0,
            end90k: (displayIndex) => pgsDisplaySetEnd90k(track.displaySets, displayIndex),
            pathFor: (displayIndex) => supDisplaySetPath(target.stem, track.pid, "und", displayIndex),
            language: "und",
            streamNumber: index + 1,
            level: pngLevelOption(),
            onProgress: trackProgress(progress, decodedSets, decodeTotal),
          }));
          files.push(...pngs);
          pngCount += pngs.length;
          decodedSets += track.displaySets.length;
        }
        if (decode) progress.done(STREAM_STEPS.decode, countOf(pngCount, "PNG", "PNGs"));
        else progress.skip(STREAM_STEPS.decode, selection.renderPng ? "no display sets" : "not requested");
      } finally { if (!run.containers) await rm(trackDirectory, { recursive: true, force: true }); }
    } else {
      progress.done(STREAM_STEPS.extract, extraction === null ? declared : countOf(extraction.streams.length, "IGS stream", "IGS streams"));
      progress.skip(STREAM_STEPS.decode, "not requested");
    }
    await commitAssetManifest(progress, transaction, files, outcome.status === "partial" ? "partial" : "complete", out, STREAM_STEPS.commit);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
}

/** Last step of both pipelines: manifest, commit, progress headline, stdout contract. */
async function commitAssetManifest(progress: ProgressReporter, transaction: Awaited<ReturnType<typeof beginOutputTransaction>>, files: AssetRecord[], status: "complete" | "partial", out: string, step: string): Promise<void> {
  progress.start(step);
  await writeFile(resolve(transaction.stagingPath, "assets-manifest.json"), `${JSON.stringify({ schemaVersion: "1.0", assets: files }, null, 2)}\n`, { flag: "wx" });
  await transaction.commit();
  progress.done(step, countOf(files.length, "asset", "assets"));
  progress.finish(status, [["output", out], ["assets", countOf(files.length, "asset", "assets")]]);
  process.stdout.write(`${JSON.stringify({ stageStatus: status, output: out, assetCount: files.length })}\n`);
}

function reporter(run: ExportRun, source: string, out: string, type: AssetType, steps: string[]): ProgressReporter {
  return commandProgress({ command: run.command, steps, source, details: [["output", out], ["type", type]] });
}

/** Close the live line and the step before the shared stage-failure record is printed. */
function failStage(progress: ProgressReporter, step: string, code: string, diagnostics: Parameters<typeof stageFailure>[1], out: string): void {
  progress.fail(step, code);
  progress.finish("failed", [["output", out]], code);
  stageFailure(code, diagnostics);
}

function describeStreams(pgsPids: number[], igsPids: number[]): string {
  const declared = [...pgsPids.map((pid) => `PID 0x${pid.toString(16).padStart(4, "0")} PGS`), ...igsPids.map((pid) => `PID 0x${pid.toString(16).padStart(4, "0")} IGS`)];
  return declared.length === 0 ? "no graphics stream" : declared.join(" · ");
}