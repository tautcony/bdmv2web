import {
  igsElementRecord, igsMnuPath, pgsTrackEntrySuffixes, pngLevelOption, selectedClip, selectedPid, supDisplaySetPath, supTrackPath, uniquePgsReferences,
} from "../cli/assets.js";
import type { AssetRecord, AssetSelection, OutputSelection, OutputType } from "../cli/assets.js";
import { fail } from "../cli/errors.js";
import { firstBlockingCode, stageFailure } from "../cli/stages.js";
import { writeMetadataArtifacts } from "./metadata.js";
import type { SupTrackRecord } from "./metadata.js";
import { commandProgress, countOf } from "../progress.js";
import type { ProgressReporter } from "../progress.js";
import { extractReachablePgsTracks, pgsTrackPngPlan, reachablePgsReferences, trackProgress, writeDisplaySetPngs } from "./pgs.js";
import { BDMV_STEPS, STREAM_STEPS } from "./steps.js";
import { fanOutPackets } from "./packet-fanout.js";
import { classifyInput, discoverGraphicsStreamsFromPrefix, streamProbeDiagnostics } from "./stream-input.js";
import type { StreamTarget } from "./stream-input.js";
import { assertDisjointRoots, beginOutputTransaction, readFileChunks } from "@bdmv2web/bdmv-io";
import { parseBdmvWithInputTable } from "@bdmv2web/bdmv-parser";
import { extractIgsFromPacketBatches, extractIgsScenes, uniqueDiagnostics } from "@bdmv2web/igs";
import type { IgsDiagnostic } from "@bdmv2web/igs";
import { extractPgsTracks, extractPgsTracksFromPacketBatches, pgsDisplaySetEnd90k } from "@bdmv2web/media-export";
import { classifyDiagnostics, decideStageOutcome } from "@bdmv2web/test-runner";
import { ContractError, DEFAULT_LIMITS } from "@bdmv2web/core";
import { errorText } from "@bdmv2web/utils";
import { copyFile, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

/**
 * What one run of the graphics pipeline writes.
 *
 * `export` and `render` share this pipeline and differ only in `outputs`, so both
 * produce byte-identical PNGs and manifest records for the same input.
 * `--metadata-only` is the metadata-only shape of the same run.
 */
export interface GraphicsRun {
  /** Command name shown in the progress header. */
  command: string;
  /** Contract code for input-selection failures on this command. */
  selectionCode: string;
  /** Which containers/PNGs and which structural artifacts this run writes. */
  outputs: OutputSelection;
}


/**
 * Resolve what the positional input is, then run the matching pipeline.
 *
 * Every input reaches the same selection checks, so `export`, `export --metadata-only`
 * and `render` accept the same inputs and reject the same combinations. A
 * `.mnu`/`.sup` file has no disc or stream to export; decoding it is `render`'s job.
 */
export async function runGraphicsInput(run: GraphicsRun, input: string, out: string, type: OutputType | undefined, selection: AssetSelection): Promise<void> {
  const target = await classifyInput(input);
  if (target.kind === "mnu" || target.kind === "sup") {
    fail(run.selectionCode, `${input} is a standalone .${target.kind}; ${run.command} needs a BDMV disc or a .m2ts/.rsks stream file. Use render to decode it to PNG`);
  }
  if (type === "hdmv" && target.kind === "stream") fail(run.selectionCode, "--type hdmv needs a BDMV disc; a stream file carries no HDMV command table");
  // `metadata` and `hdmv` describe the input; there is nothing in them to decode.
  if ((type === "metadata" || type === "hdmv") && selection.renderPng) fail(run.selectionCode, `--type ${type} writes metadata only; drop --render or select igs/sup`);
  return target.kind === "stream" ? exportStreamAssets(target, out, type, selection, run) : exportBdmvAssets(input, out, type, selection, run);
}

/** Export .mnu/.sup from a BDMV disc, rendering PNGs when the selection asks for them. */
export async function exportBdmvAssets(input: string, out: string, type: OutputType | undefined, selection: AssetSelection, run: GraphicsRun): Promise<void> {
  const { outputs } = run;
  const writesMnu = outputs.containers.igs;
  const writesSup = outputs.containers.sup;
  const wantsSupPng = selection.renderPng && outputs.png.sup;
  const writesMetadata = outputs.metadata.hdmv || outputs.metadata.igs || outputs.metadata.sup;
  // A SUP index needs the tracks, and PNG frames need them even when no container
  // is written; the metadata index needs the scenes IGS extraction returns.
  const needsSupTracks = writesSup || wantsSupPng || outputs.metadata.sup;
  const needsIgs = writesMnu || (selection.renderPng && outputs.png.igs) || needsSupTracks || outputs.metadata.igs;
  const progress = reporter(run, input, out, type, Object.values(BDMV_STEPS));
  progress.start(BDMV_STEPS.structure);
  const { disc, table } = await parseBdmvWithInputTable(input);
  const facts = classifyDiagnostics(disc.diagnostics);
  if (facts.hasFatal) { failStage(progress, BDMV_STEPS.structure, firstBlockingCode(facts.blocking), facts.blocking, out); return; }
  progress.done(BDMV_STEPS.structure, `${countOf(disc.entries.length, "entry", "entries")} · ${countOf(disc.clips.length, "clip", "clips")}`);
  const roots = await assertDisjointRoots(disc.root, out);
  // SUP tracks are discovered through the IGS scenes, so `--type hdmv` is the one
  // selection that skips IGS extraction entirely.
  progress.start(BDMV_STEPS.igs);
  const igs = needsIgs
    ? await extractIgsScenes(disc, {
      renderAssets: selection.renderPng && outputs.png.igs, captureStreams: writesMnu, pngLevel: pngLevelOption(), table,
      ...(selection.clipId === undefined ? {} : { clipFilter: (clipId: string) => selectedClip(clipId, selection) }),
    })
    : { scenes: [], assets: [], streams: [], diagnostics: [], status: "complete" as const, support: { format: "Blu-ray IGS" as const, status: "unverified" as const } };
  progress.done(BDMV_STEPS.igs, `${countOf(igs.scenes.length, "scene", "scenes")} · ${countOf(igs.streams.length, "stream", "streams")} · ${countOf(igs.assets.length, "image", "images")}`);
  const outcome = decideStageOutcome({ stage: "extract", diagnostics: [...disc.diagnostics, ...igs.diagnostics] });
  if (outcome.status === "failed") { failStage(progress, BDMV_STEPS.igs, firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics, roots.output); return; }
  const transaction = await beginOutputTransaction(roots.output);
  try {
    const files: AssetRecord[] = [];
    const supTracks: SupTrackRecord[] = [];
    if (writesMnu) for (const stream of igs.streams.filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection))) {
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
    if (needsSupTracks) {
      progress.start(BDMV_STEPS.sup);
      const references = uniquePgsReferences(reachablePgsReferences(disc, igs.scenes)).filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection));
      const trackSuffixes = pgsTrackEntrySuffixes(references);
      // Containers land in the package; a PNG-only run extracts them into a scratch
      // directory that never reaches the output target.
      const trackDirectory = writesSup ? transaction.stagingPath : await mkdtemp(resolve(tmpdir(), "bdmv-render-png-"));
      try {
        const tracks = await extractReachablePgsTracks(disc, igs.scenes, trackDirectory, (_reference, index) => supTrackPath(references[index]!.clipId, references[index]!.pid, index, trackSuffixes[index]), references);
        const uniqueTracks = [...new Map(tracks.map((track) => [track.path, track])).values()];
        progress.done(BDMV_STEPS.sup, countOf(uniqueTracks.length, "track", "tracks"));
        // Each track's PNGs follow its SUP record, so the manifest keeps grouping by
        // track; the decode step still spans all of them as one monotonic ratio.
        const decodeTotal = uniqueTracks.reduce((count, track) => count + track.displaySets.length, 0);
        const decode = wantsSupPng && decodeTotal > 0;
        if (decode) progress.start(BDMV_STEPS.decode);
        let decodedSets = 0;
        let pngCount = 0;
        for (const track of uniqueTracks) {
          const trackIndex = tracks.indexOf(track);
          const trackSuffix = trackSuffixes[trackIndex] ?? "";
          if (writesSup || outputs.metadata.sup) {
            const trackStat = await lstat(resolve(trackDirectory, track.path));
            if (writesSup) files.push({ type: "sup", path: track.path, byteLength: trackStat.size, language: track.language, streamNumber: track.streamNumber, displaySetCount: track.displaySets.length });
            if (outputs.metadata.sup) supTracks.push({ clipId: track.clipId, pid: track.pid, language: track.language, streamNumber: track.streamNumber, displaySetCount: track.displaySets.length, byteLength: trackStat.size });
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
      } finally { if (!writesSup) await rm(trackDirectory, { recursive: true, force: true }); }
    } else {
      progress.skip(BDMV_STEPS.sup, "not requested");
      progress.skip(BDMV_STEPS.decode, "not requested");
    }
    if (writesMetadata) {
      await writeMetadataArtifacts({
        stagingPath: transaction.stagingPath,
        status: outcome.status === "partial" ? "partial" : "complete",
        sections: outputs.metadata,
        disc,
        igs,
        supTracks,
        externalTargets: outputs.metadata.hdmv && outputs.metadata.igs,
        sourceRoot: roots.input,
      });
    }
    await commitAssetManifest(progress, transaction, writesMnu || writesSup || files.length > 0, writesMetadata, files, outcome.status === "partial" ? "partial" : "complete", roots.output, BDMV_STEPS.commit);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
}

/** Export .mnu/.sup from one standalone m2ts byte stream (.m2ts or .rsks file). */
export async function exportStreamAssets(target: StreamTarget, out: string, type: OutputType | undefined, selection: AssetSelection, run: GraphicsRun): Promise<void> {
  const { outputs } = run;
  const writesMnu = outputs.containers.igs;
  const writesSup = outputs.containers.sup;
  const wantsSupPng = selection.renderPng && outputs.png.sup;
  const writesMetadata = outputs.metadata.igs || outputs.metadata.sup;
  if (selection.clipId !== undefined) fail(run.selectionCode, "--m2ts applies to BDMV input; a stream file is one clip");
  const progress = reporter(run, target.path, out, type, Object.values(STREAM_STEPS));
  progress.start(STREAM_STEPS.probe);
  const streams = await discoverGraphicsStreamsFromPrefix(target.path);
  const pgsPids = streams.pgsPids.filter((pid) => selectedPid(pid, selection));
  const igsPids = streams.igsPids.filter((pid) => selectedPid(pid, selection));
  if (selection.pid !== undefined && pgsPids.length === 0 && igsPids.length === 0) {
    fail(run.selectionCode, `--pid 0x${selection.pid.toString(16).padStart(4, "0")} is not declared as PGS (0x90) or IGS (0x91) in ${target.path}`);
  }
  const declared = describeStreams(pgsPids, igsPids);
  progress.done(STREAM_STEPS.probe, declared);
  const diagnostics: IgsDiagnostic[] = [];
  for (const diagnostic of streams.diagnostics) diagnostics.push(diagnostic);
  if (pgsPids.length === 0 && igsPids.length === 0) {
    diagnostics.push({ severity: "warning", code: "EXPORT_NO_GRAPHICS_STREAM", message: `${target.stem} declares no PGS (0x90) or IGS (0x91) stream in its program tables`, source: null, affectedSceneIds: [] });
  }
  progress.start(STREAM_STEPS.extract);
  // IGS scenes and stream bytes are computed before the output transaction opens,
  // so a failed stage keeps the output target untouched. The PMT-declared IGS
  // PIDs are the structural cues: cue PIDs must cover the PMT, and a cue-less
  // scan with discovered streams is a PID conflict. Scenes feed the `.mnu`
  // container, element PNGs and the metadata scene list.
  const needsIgs = (writesMnu || (selection.renderPng && outputs.png.igs) || outputs.metadata.igs) && igsPids.length > 0;
  const needsSup = (writesSup || wantsSupPng || outputs.metadata.sup) && pgsPids.length > 0;
  const needsScan = needsIgs || needsSup;
  // SUP is written outside the output target until the stage verdict, so a
  // failed extraction leaves an existing target untouched.
  const supStagingDirectory = needsSup ? await mkdtemp(resolve(tmpdir(), "stream-sup-")) : null;
  let preparedSup: Awaited<ReturnType<typeof extractPgsTracks>> | null = null;
  let preparedSupError: unknown = null;
  let preparedSupFailed = false;
  let extraction: Awaited<ReturnType<typeof extractIgsFromPacketBatches>> | null = null;
  if (needsScan) {
    // One reader parses the clip once. IGS and PGS keep their own PES and
    // display-set state, and the scan keeps reading to EOF when one consumer
    // stops on a PID conflict, so the tail still produces diagnostics.
    const scan = fanOutPackets(readFileChunks(target.path, DEFAULT_LIMITS, DEFAULT_LIMITS.maxReadWindowBytes), target.stem, (needsIgs ? 1 : 0) + (needsSup ? 1 : 0), DEFAULT_LIMITS);
    const igsBatches = needsIgs ? scan.batches[0] : null;
    const supBatches = needsSup ? scan.batches[needsIgs ? 1 : 0] : null;
    const supRequests = needsSup && supStagingDirectory
      ? pgsPids.map((pid, index) => ({ pid, outputPath: resolve(supStagingDirectory, supTrackPath(target.stem, pid, index)) }))
      : [];
    const cues = streams.igsPids.map((pid) => ({ pid, source: { path: basename(target.path), origin: "primary" as const, offset: "0" } }));
    const igsOptions = { captureStreams: writesMnu, renderAssets: selection.renderPng && outputs.png.igs, pngLevel: pngLevelOption() };
    const [igsResult, supResult] = await Promise.allSettled([
      needsIgs ? extractIgsFromPacketBatches(target.stem, igsBatches!, cues, igsOptions) : Promise.resolve(null),
      needsSup ? extractPgsTracksFromPacketBatches(target.path, supBatches!, supRequests, {}, scan.transportDiagnostics) : Promise.resolve(null),
    ]);
    // The producer owns the transport diagnostics. Both consumers can finish
    // before it reaches EOF, so wait for the scan before reading its reports.
    await scan.done;
    // A PGS failure is raised after the transaction opens, so an existing
    // output target still fails first.
    if (supResult.status === "rejected") { preparedSupFailed = true; preparedSupError = supResult.reason; }
    else preparedSup = supResult.value;
    if (igsResult.status === "rejected") {
      if (supStagingDirectory) await rm(supStagingDirectory, { recursive: true, force: true });
      throw igsResult.reason;
    }
    extraction = igsResult.value;
    for (const diagnostic of scan.psiDiagnostics) diagnostics.push(diagnostic);
    for (const diagnostic of scan.transportDiagnostics) diagnostics.push(diagnostic);
  } else if (streams.prefixOnly) {
    // With no graphics stream there is no scan to report transport damage, so
    // the whole-file probe covers the trailing bytes in this one case.
    for (const diagnostic of await streamProbeDiagnostics(target.path)) diagnostics.push(diagnostic);
  }
  // A damaged clip reports tens of thousands of events; a loop keeps the merge
  // independent of the argument-count ceiling of a spread call.
  if (extraction) for (const diagnostic of extraction.diagnostics) diagnostics.push(diagnostic);
  // The scan's PSI assembler and the IGS assembler can both attribute one
  // damaged section to a PID. One sighting per event, in first-reported order:
  // the verdict reads severities, and `blockingDiagnostics` feeds a failure
  // record where every packet appears once.
  const outcome = decideStageOutcome({ stage: "extract", diagnostics: uniqueDiagnostics(diagnostics) });
  if (outcome.status === "failed") {
    if (supStagingDirectory) await rm(supStagingDirectory, { recursive: true, force: true });
    failStage(progress, STREAM_STEPS.extract, firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics, out);
    return;
  }
  // A stream file is read-only input, so the output directory carries no
  // overlap hazard the way a disc root does; exporting next to the stream is
  // the normal case. The transaction still refuses an existing target.
  let transaction: Awaited<ReturnType<typeof beginOutputTransaction>>;
  try { transaction = await beginOutputTransaction(out); }
  catch (error) {
    if (supStagingDirectory) await rm(supStagingDirectory, { recursive: true, force: true });
    throw error;
  }
  try {
    const files: AssetRecord[] = [];
    const supTracks: SupTrackRecord[] = [];
    if (extraction) {
      if (writesMnu) for (const stream of extraction.streams.filter((item) => selectedPid(item.pid, selection))) {
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
    if (needsSup) {
      const trackDirectory = writesSup ? transaction.stagingPath : supStagingDirectory ?? await mkdtemp(resolve(tmpdir(), "stream-render-png-"));
      try {
        let tracks;
        if (preparedSup) {
          tracks = preparedSup;
          // The shared pass had to write outside the output target so a failed
          // stage left it untouched; move those SUP files into the staging tree.
          if (writesSup) for (const [index, track] of tracks.entries()) {
            const staged = resolve(transaction.stagingPath, supTrackPath(target.stem, track.pid, index));
            await mkdir(dirname(staged), { recursive: true });
            await copyFile(track.path, staged);
          }
        } else if (preparedSupFailed) {
          throw new ContractError("EXPORT_INVALID_STREAM", target.path, `A PMT-declared PGS PID could not be extracted as SUP: ${errorText(preparedSupError)}`);
        } else {
          const requests = pgsPids.map((pid, index) => ({ pid, outputPath: resolve(trackDirectory, supTrackPath(target.stem, pid, index)) }));
          try { tracks = await extractPgsTracks(target.path, requests); }
          catch (error) { throw new ContractError("EXPORT_INVALID_STREAM", target.path, `A PMT-declared PGS PID could not be extracted as SUP: ${errorText(error)}`); }
        }
        progress.done(STREAM_STEPS.extract, countOf(tracks.length, "SUP track", "SUP tracks"));
        const decodeTotal = tracks.reduce((count, track) => count + track.displaySets.length, 0);
        const decode = wantsSupPng && decodeTotal > 0;
        if (decode) progress.start(STREAM_STEPS.decode);
        let decodedSets = 0;
        let pngCount = 0;
        for (const [index, track] of tracks.entries()) {
          const path = supTrackPath(target.stem, track.pid, index);
          if (writesSup) files.push({ type: "sup", path, byteLength: track.byteLength, language: "und", streamNumber: index + 1, displaySetCount: track.displaySets.length });
          if (outputs.metadata.sup) supTracks.push({ clipId: target.stem, pid: track.pid, language: "und", streamNumber: index + 1, displaySetCount: track.displaySets.length, byteLength: track.byteLength });
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
      } finally { if (!writesSup) await rm(trackDirectory, { recursive: true, force: true }); }
    } else {
      progress.done(STREAM_STEPS.extract, extraction === null ? declared : countOf(extraction.streams.length, "IGS stream", "IGS streams"));
      progress.skip(STREAM_STEPS.decode, "not requested");
    }
    if (writesMetadata) {
      await writeMetadataArtifacts({
        stagingPath: transaction.stagingPath,
        status: outcome.status === "partial" ? "partial" : "complete",
        sections: outputs.metadata,
        disc: null,
        igs: extraction ?? { scenes: [], assets: [], diagnostics: [], status: "complete" as const, support: { format: "Blu-ray IGS" as const, status: "unverified" as const } },
        supTracks,
        externalTargets: false,
        sourceRoot: null,
      });
    }
    await commitAssetManifest(progress, transaction, writesMnu || writesSup || files.length > 0, writesMetadata, files, outcome.status === "partial" ? "partial" : "complete", out, STREAM_STEPS.commit);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
  finally { if (supStagingDirectory) await rm(supStagingDirectory, { recursive: true, force: true }); }
}

/**
 * Last step of both pipelines: manifests for whichever sides ran, commit, progress
 * headline, stdout contract. `assets-manifest.json` records decoded assets;
 * `manifest.json` describes the analysis artifacts. A run that writes neither
 * (analysis-only with `--type hdmv`, for example) still commits its files.
 */
async function commitAssetManifest(progress: ProgressReporter, transaction: Awaited<ReturnType<typeof beginOutputTransaction>>, hasAssets: boolean, metadata: boolean, files: AssetRecord[], status: "complete" | "partial", out: string, step: string): Promise<void> {
  progress.start(step);
  // An asset-side run records assets even when it produced none; a metadata-only
  // run leaves the asset manifest out entirely.
  const writesAssetsManifest = hasAssets || files.length > 0;
  if (writesAssetsManifest) await writeFile(resolve(transaction.stagingPath, "assets-manifest.json"), `${JSON.stringify({ schemaVersion: "1.0", assets: files }, null, 2)}\n`, { flag: "wx" });
  await transaction.commit();
  progress.done(step, metadata && !writesAssetsManifest ? "metadata artifacts" : countOf(files.length, "asset", "assets"));
  progress.finish(status, [["output", out], ["assets", countOf(files.length, "asset", "assets")]]);
  const result = writesAssetsManifest ? { stageStatus: status, output: out, assetCount: files.length } : { stageStatus: status, output: out };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function reporter(run: GraphicsRun, source: string, out: string, type: OutputType | undefined, steps: string[]): ProgressReporter {
  return commandProgress({ command: run.command, steps, source, details: [["output", out], ["type", type ?? "assets"]] });
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