import { pgsTrackEntrySuffixes, pidOption, safeAssetStem, selectedPid, supDisplaySetPath, uniquePgsReferences, validateAssetType } from "../cli/assets.js";
import { inputPath, optionValue, strictDefault } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { firstBlockingCode, stageFailure } from "../cli/stages.js";
import { extractReachablePgsTracks, reachablePgsReferences } from "../shared/pgs.js";
import { assertDisjointRoots, beginOutputTransaction } from "@bdmv2web/bdmv-io";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { ContractError } from "@bdmv2web/core";
import { extractIgsScenes, parseIgsMnu } from "@bdmv2web/igs";
import { parsePgsSup, pgsDisplaySetEnd90k, renderPgsDisplaySet } from "@bdmv2web/media-export";
import { classifyDiagnostics, decideStageOutcome } from "@bdmv2web/test-runner";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, resolve } from "node:path";
import type { AssetRecord } from "../cli/assets.js";

export async function renderPng(): Promise<void> {
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "render requires --out DIR");
  const positional = inputPath();
  const mnuPath = optionValue("--mnu");
  const supPath = optionValue("--sup");
  const typeOption = optionValue("--type");
  const language = renderLanguage();
  const pid = pidOption();
  if ((mnuPath !== undefined || supPath !== undefined) && positional !== undefined) fail("CLI_RENDER_SELECTION", "render accepts either a positional input or --mnu/--sup, not both");
  if ((mnuPath !== undefined || supPath !== undefined) && typeOption !== undefined) fail("CLI_RENDER_SELECTION", "--type applies to BDMV input; omit it for --mnu/--sup");
  if ((mnuPath !== undefined || supPath !== undefined) && optionValue("--m2ts") !== undefined) fail("CLI_RENDER_SELECTION", "--m2ts applies to BDMV input");
  const sources: Array<{ kind: "mnu" | "sup"; path: string }> = [];
  if (mnuPath !== undefined) sources.push({ kind: "mnu", path: mnuPath });
  if (supPath !== undefined) sources.push({ kind: "sup", path: supPath });
  if (positional !== undefined) {
    const extension = extname(positional).toLocaleLowerCase("en-US");
    if (extension === ".mnu" || extension === ".sup") sources.push({ kind: extension.slice(1) as "mnu" | "sup", path: positional });
    else {
      if (sources.length) fail("CLI_RENDER_SELECTION", "render accepts either a BDMV input or --mnu/--sup, not both");
      if (language !== undefined) fail("CLI_RENDER_SELECTION", "--language applies to SUP input; BDMV tracks carry their declared language");
      return renderPngFromBdmv(positional, out, typeOption, pid);
    }
  }
  if (!sources.length) fail("CLI_MISSING_INPUT", "render requires a BDMV input, a .mnu/.sup positional input, or --mnu/--sup");
  if (language !== undefined && !sources.some((source) => source.kind === "sup")) fail("CLI_RENDER_SELECTION", "--language applies to SUP input");
  if (pid !== undefined && !sources.some((source) => source.kind === "mnu")) fail("CLI_RENDER_SELECTION", "--pid applies to MNU input");
  return renderPngFromFiles(sources, out, language, pid);
}

export function renderLanguage(): string | undefined {
  const value = optionValue("--language");
  if (value === undefined) return undefined;
  if (!/^[A-Za-z]{3}$/.test(value)) fail("CLI_INVALID_LANGUAGE", "--language must be a three-letter language code");
  return value.toLocaleLowerCase("en-US");
}

export async function renderPngFromFiles(sources: Array<{ kind: "mnu" | "sup"; path: string }>, out: string, language: string | undefined, pid: number | undefined): Promise<void> {
  const files: AssetRecord[] = [];
  const pending: Array<{ path: string; bytes: Uint8Array }> = [];
  let partial = false;
  for (const source of sources) {
    const input = resolve(source.path);
    const bytes = await readFile(input);
    const stem = safeAssetStem(input);
    if (source.kind === "mnu") {
      let parsed;
      try { parsed = parseIgsMnu(bytes, { clipId: stem, pid: pid ?? 0x120 }); }
      catch (error) { throw new ContractError("RENDER_INVALID_MNU", source.path, `MNU could not be parsed: ${error instanceof Error ? error.message : String(error)}`); }
      if (parsed.status === "failed" || parsed.scenes.length === 0) {
        const detail = parsed.diagnostics.find((item) => item.severity === "error")?.message ?? "no complete display set";
        throw new ContractError("RENDER_INVALID_MNU", source.path, `MNU contains no renderable menu scene: ${detail}`);
      }
      if (parsed.status === "partial") partial = true;
      for (const asset of parsed.assets) {
        pending.push({ path: asset.relativePath, bytes: asset.pngBytes });
        files.push({
          type: "igs-png", path: asset.relativePath, byteLength: asset.pngBytes.byteLength,
          width: asset.width, height: asset.height, objectId: asset.objectId, objectVersion: asset.objectVersion,
          paletteId: asset.paletteId, paletteVersion: asset.paletteVersion,
        });
      }
      continue;
    }
    let displaySets;
    try { displaySets = parsePgsSup(bytes); }
    catch (error) { throw new ContractError("RENDER_INVALID_SUP", source.path, `SUP could not be parsed: ${error instanceof Error ? error.message : String(error)}`); }
    if (displaySets.length === 0) throw new ContractError("RENDER_INVALID_SUP", source.path, "SUP contains no complete display set.");
    // A standalone SUP carries no track interval, so the first display set is
    // the origin: exported seconds stay usable even when the file starts at an
    // arbitrary PTS.
    const origin90k = displaySets[0]?.pts90k ?? 0;
    for (const [index, displaySet] of displaySets.entries()) {
      const endTime90k = pgsDisplaySetEnd90k(displaySets, index);
      const rendered = renderPgsDisplaySet(displaySet, index + 1, endTime90k, origin90k);
      if (!rendered.visible) continue;
      const path = `assets/subtitles/${stem}-display-${String(index + 1).padStart(5, "0")}.png`;
      pending.push({ path, bytes: rendered.pngBytes });
      files.push({
        type: "sup-png", path, byteLength: rendered.pngBytes.byteLength,
        ...(language === undefined ? {} : { language }),
        displaySet: rendered.displaySetNumber, startSeconds: rendered.startSeconds, endSeconds: rendered.endSeconds,
        width: rendered.width, height: rendered.height,
      });
    }
  }
  await commitRenderedAssets(out, files, pending, partial, strictDefault());
}

export async function renderPngFromBdmv(input: string, out: string, rawType: string | undefined, pid: number | undefined): Promise<void> {
  const type = rawType === undefined ? "all" : validateAssetType(rawType);
  const selection = { ...(pid === undefined ? {} : { pid }) };
  const disc = await parseBdmv(input);
  const facts = classifyDiagnostics(disc.diagnostics);
  if (facts.hasFatal) { stageFailure(firstBlockingCode(facts.blocking), facts.blocking); return; }
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  const igs = await extractIgsScenes(disc, { renderAssets: type !== "sup", captureStreams: false });
  const outcome = decideStageOutcome({ stage: "extract", diagnostics: [...disc.diagnostics, ...igs.diagnostics], strict: strictDefault() });
  if (outcome.status === "failed") { stageFailure(firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics); return; }
  const files: AssetRecord[] = [];
  const pending: Array<{ path: string; bytes: Uint8Array }> = [];
  if (type !== "sup") for (const asset of igs.assets.filter((item) => selectedPid(item.source.pid, selection))) {
    pending.push({ path: asset.relativePath, bytes: asset.pngBytes });
    files.push({
      type: "igs-png", path: asset.relativePath, byteLength: asset.pngBytes.byteLength,
      width: asset.width, height: asset.height, objectId: asset.objectId, objectVersion: asset.objectVersion,
      paletteId: asset.paletteId, paletteVersion: asset.paletteVersion,
    });
  }
  if (type !== "igs") {
    const references = uniquePgsReferences(reachablePgsReferences(disc, igs.scenes)).filter((item) => selectedPid(item.pid, selection));
    const trackSuffixes = pgsTrackEntrySuffixes(references);
    const temp = await mkdtemp(resolve(tmpdir(), "bdmv-render-png-"));
    try {
      const tracks = await extractReachablePgsTracks(disc, igs.scenes, temp, (_reference, index) => `tracks/${index}.sup`, references);
      const uniqueTracks = [...new Map(tracks.map((track) => [track.path, track])).values()];
      for (const track of uniqueTracks) {
        const trackIndex = tracks.indexOf(track);
        const trackSuffix = trackSuffixes[trackIndex] ?? "";
        const trackEnd90k = Number(track.sourceOut90k) - Number(track.sourceIn90k);
        for (const [index, displaySet] of track.displaySets.entries()) {
          const endTime90k = pgsDisplaySetEnd90k(track.displaySets, index, trackEnd90k);
          const rendered = renderPgsDisplaySet(displaySet, index + 1, endTime90k);
          if (!rendered.visible) continue;
          const path = supDisplaySetPath(track.clipId, track.pid, track.language, index, trackSuffix);
          pending.push({ path, bytes: rendered.pngBytes });
          files.push({
            type: "sup-png", path, byteLength: rendered.pngBytes.byteLength, language: track.language, streamNumber: track.streamNumber,
            displaySet: rendered.displaySetNumber, startSeconds: rendered.startSeconds, endSeconds: rendered.endSeconds,
            width: rendered.width, height: rendered.height,
          });
        }
      }
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  await commitRenderedAssets(roots.output, files, pending, outcome.status === "partial", strictDefault(), outcome.exitCode);
}

export async function commitRenderedAssets(out: string, files: AssetRecord[], pending: Array<{ path: string; bytes: Uint8Array }>, partial: boolean, strict: boolean, exitCode?: number): Promise<void> {
  const transaction = await beginOutputTransaction(resolve(out));
  try {
    for (const file of pending) {
      const target = resolve(transaction.stagingPath, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes, { flag: "wx" });
    }
    await writeFile(resolve(transaction.stagingPath, "assets-manifest.json"), `${JSON.stringify({ schemaVersion: "1.0", assets: files }, null, 2)}\n`, { flag: "wx" });
    await transaction.commit();
    const status = partial ? "partial" : "complete";
    process.stdout.write(`${JSON.stringify({ stageStatus: status, output: resolve(out), assetCount: files.length })}\n`);
    const code = exitCode ?? (partial && strict ? 2 : 0);
    if (code !== 0) process.exitCode = code;
  } catch (error) { await transaction.abort(); throw error; }
}
