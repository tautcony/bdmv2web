import { assetSelection, assetTypeOption, igsMnuPath, pgsTrackEntrySuffixes, selectedClip, selectedPid, supTrackPath, uniquePgsReferences } from "../cli/assets.js";
import { inputPath, optionValue } from "../cli/context.js";
import { fail, outputFormat } from "../cli/errors.js";
import { printTable, writeJsonFile } from "../cli/output.js";
import { firstBlockingCode, stageFailure } from "../cli/stages.js";
import { reachablePgsReferences } from "../shared/pgs.js";
import { assertDisjointRoots } from "@bdmv2web/bdmv-io";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes } from "@bdmv2web/igs";
import { classifyDiagnostics } from "@bdmv2web/test-runner";
import { resolve } from "node:path";

export async function listAssets(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "list requires a BDMV input path");
  const type = assetTypeOption();
  const selection = assetSelection();
  const format = outputFormat("list-assets");
  const out = optionValue("--out");
  const disc = await parseBdmv(input);
  const fatal = classifyDiagnostics(disc.diagnostics);
  if (fatal.hasFatal) { stageFailure(firstBlockingCode(fatal.blocking), fatal.blocking); return; }
  const extraction = await extractIgsScenes(disc, { renderAssets: false });
  const scenes = extraction.scenes.filter((scene) => selectedClip(scene.clipId, selection) && selectedPid(scene.pid, selection));
  const igsStreams = type === "sup" ? [] : extraction.streams.filter((stream) => selectedClip(stream.clipId, selection) && selectedPid(stream.pid, selection)).map((stream) => ({ type: "igs", format: "mnu", path: igsMnuPath(stream.clipId, stream.pid), clipId: stream.clipId, pid: stream.pid, byteLength: stream.byteLength }));
  const igsElements = type === "sup" ? [] : scenes.flatMap((scene) => scene.objects.map((object) => ({ type: "igs-image-element", clipId: scene.clipId, pid: scene.pid, sceneId: scene.id, compositionNumber: scene.compositionNumber, objectId: object.id, objectVersion: object.version, width: object.width, height: object.height })));
  const references = type === "igs" ? [] : uniquePgsReferences(reachablePgsReferences(disc, extraction.scenes)).filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection));
  const trackSuffixes = pgsTrackEntrySuffixes(references);
  const subtitles = references.map((item, index) => ({ type: "sup", path: supTrackPath(item.clipId, item.pid, index, trackSuffixes[index]), clipId: item.clipId, pid: item.pid, language: item.language, streamNumber: item.streamNumber, playlistId: item.playlistId, playItemIndex: item.playItemIndex }));
  const perM2ts = [...new Set(subtitles.map((asset) => asset.clipId))].map((clipId) => ({ clipId, subtitleTrackCount: subtitles.filter((asset) => asset.clipId === clipId).length }));
  const assets = [...igsStreams, ...subtitles];
  const report = { schemaVersion: "1.0", summary: { igsScenes: type === "sup" ? 0 : scenes.length, igsStreams: igsStreams.length, igsImageElements: igsElements.length, supTracks: subtitles.length, m2tsWithSup: perM2ts.length, perM2ts }, assets, igsImageElements: igsElements };
  if (out) { await assertDisjointRoots(disc.root, resolve(out)); await writeJsonFile(out, `${JSON.stringify(report, null, 2)}\n`); }
  if (format === "json") process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    printTable("Asset summary", ["Type", "Count"], [["IGS streams", report.summary.igsStreams], ["IGS scenes", report.summary.igsScenes], ["IGS image elements", report.summary.igsImageElements], ["SUP tracks", report.summary.supTracks], ["M2TS with SUP", report.summary.m2tsWithSup]]);
    printTable("Assets", ["Type", "Clip", "PID", "Language", "Bytes", "Path"], assets.map((asset) => [asset.type, "clipId" in asset ? asset.clipId : "-", "pid" in asset ? `0x${asset.pid.toString(16)}` : "-", "language" in asset ? asset.language : "-", "byteLength" in asset ? asset.byteLength : "-", "path" in asset ? asset.path : "-"]));
    printTable("IGS image elements", ["Clip", "PID", "Scene", "Composition", "Object", "Version", "Dimensions"], igsElements.map((item) => [item.clipId, `0x${item.pid.toString(16)}`, item.sceneId, item.compositionNumber, item.objectId, item.objectVersion, `${item.width}x${item.height}`]));
    printTable("SUP tracks by M2TS", ["Clip", "SUP tracks"], perM2ts.map((item) => [item.clipId, item.subtitleTrackCount]));
  }
}
