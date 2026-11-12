import { assetSelection, assetTypeOption, igsMnuPath, pngLevelOption, pgsTrackEntrySuffixes, selectedClip, selectedPid, supDisplaySetPath, supTrackPath, uniquePgsReferences } from "../cli/assets.js";
import { inputPath, optionValue, strictDefault } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { firstBlockingCode, stageFailure } from "../cli/stages.js";
import { extractReachablePgsTracks, reachablePgsReferences } from "../shared/pgs.js";
import { assertDisjointRoots, beginOutputTransaction } from "@bdmv2web/bdmv-io";
import { parseBdmvWithInputTable } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes } from "@bdmv2web/igs";
import { pgsDisplaySetEnd90k, renderPgsDisplaySet } from "@bdmv2web/media-export";
import { classifyDiagnostics, decideStageOutcome } from "@bdmv2web/test-runner";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AssetRecord } from "../cli/assets.js";

export async function exportAssets(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "export requires a BDMV input path");
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "export requires --out DIR");
  const type = assetTypeOption();
  const selection = assetSelection();
  const { disc, table } = await parseBdmvWithInputTable(input);
  const facts = classifyDiagnostics(disc.diagnostics);
  if (facts.hasFatal) { stageFailure(firstBlockingCode(facts.blocking), facts.blocking); return; }
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  const igs = await extractIgsScenes(disc, { renderAssets: selection.decodePng && type !== "sup", captureStreams: type !== "sup", pngLevel: pngLevelOption(), table });
  const outcome = decideStageOutcome({ stage: "extract", diagnostics: [...disc.diagnostics, ...igs.diagnostics], strict: strictDefault() });
  if (outcome.status === "failed") { stageFailure(firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics); return; }
  const transaction = await beginOutputTransaction(roots.output);
  try {
    const files: AssetRecord[] = [];
    if (type !== "sup") for (const stream of igs.streams.filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection))) {
      const path = igsMnuPath(stream.clipId, stream.pid);
      const target = resolve(transaction.stagingPath, path);
      await mkdir(dirname(target), { recursive: true });
      if (!stream.bytes) throw new Error(`Raw IGS bytes were not retained for ${stream.clipId} PID ${stream.pid}`);
      await writeFile(target, stream.bytes, { flag: "wx" });
      files.push({ type: "igs", format: "mnu", path, byteLength: stream.byteLength });
    }
    for (const asset of igs.assets.filter((item) => selectedClip(item.source.clipId, selection) && selectedPid(item.source.pid, selection))) {
      const path = asset.relativePath;
      const target = resolve(transaction.stagingPath, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, asset.pngBytes, { flag: "wx" });
      files.push({ type: "igs-png", path, byteLength: asset.pngBytes.byteLength });
    }
    if (type !== "igs") {
      const references = uniquePgsReferences(reachablePgsReferences(disc, igs.scenes)).filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection));
      const trackSuffixes = pgsTrackEntrySuffixes(references);
      const tracks = await extractReachablePgsTracks(disc, igs.scenes, transaction.stagingPath, (_reference, index) => supTrackPath(references[index]!.clipId, references[index]!.pid, index, trackSuffixes[index]), references);
      const uniqueTracks = [...new Map(tracks.map((track) => [track.path, track])).values()];
      for (const track of uniqueTracks) {
        const trackIndex = tracks.indexOf(track);
        const trackSuffix = trackSuffixes[trackIndex] ?? "";
        const trackStat = await lstat(resolve(transaction.stagingPath, track.path));
        files.push({ type: "sup", path: track.path, byteLength: trackStat.size, language: track.language, streamNumber: track.streamNumber, displaySetCount: track.displaySets.length });
        if (selection.decodePng) {
          const trackEnd90k = Number(track.sourceOut90k) - Number(track.sourceIn90k);
          for (const [index, displaySet] of track.displaySets.entries()) {
            const endTime90k = pgsDisplaySetEnd90k(track.displaySets, index, trackEnd90k);
            const rendered = renderPgsDisplaySet(displaySet, index + 1, endTime90k, 0, { level: pngLevelOption() });
            if (!rendered.visible) continue;
            const path = supDisplaySetPath(track.clipId, track.pid, track.language, index, trackSuffix);
            const target = resolve(transaction.stagingPath, path);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, rendered.pngBytes, { flag: "wx" });
            files.push({
              type: "sup-png", path, byteLength: rendered.pngBytes.byteLength, language: track.language, streamNumber: track.streamNumber,
              displaySet: rendered.displaySetNumber, startSeconds: rendered.startSeconds, endSeconds: rendered.endSeconds,
              width: rendered.width, height: rendered.height,
            });
          }
        }
      }
    }
    await writeFile(resolve(transaction.stagingPath, "assets-manifest.json"), `${JSON.stringify({ schemaVersion: "1.0", assets: files }, null, 2)}\n`, { flag: "wx" });
    await transaction.commit();
    process.stdout.write(`${JSON.stringify({ stageStatus: outcome.status, output: roots.output, assetCount: files.length })}\n`);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
}
