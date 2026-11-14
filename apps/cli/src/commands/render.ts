import { assetSelection, assetTypeOption, igsElementRecord, pngLevelOption, safeAssetStem } from "../cli/assets.js";
import type { AssetRecord } from "../cli/assets.js";
import { inputPath, optionValue } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { commandProgress, countOf } from "../progress.js";
import { exportBdmvAssets, exportStreamAssets } from "../shared/asset-export.js";
import type { ExportRun } from "../shared/asset-export.js";
import { pgsTrackPngPlan, runDecodeStep, writeDisplaySetPngs } from "../shared/pgs.js";
import type { DecodeTarget } from "../shared/pgs.js";
import { FILE_STEPS } from "../shared/steps.js";
import { classifyStreamInput } from "../shared/stream-input.js";
import { beginOutputTransaction } from "@bdmv2web/bdmv-io";
import { ContractError } from "@bdmv2web/core";
import { parseIgsMnu } from "@bdmv2web/igs";
import { parsePgsSup, pgsDisplaySetEnd90k } from "@bdmv2web/media-export";
import { errorText } from "@bdmv2web/utils";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

/**
 * `render` is the PNG-only half of `export`: it runs the same pipeline (same
 * naming, manifest records, concurrency and progress) with containers turned off,
 * and additionally accepts standalone `.mnu`/`.sup` files.
 */
const RENDER_RUN: ExportRun = { command: "render", containers: false, selectionCode: "CLI_RENDER_SELECTION" };

export async function renderPng(): Promise<void> {
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "render requires --out DIR");
  const positional = inputPath();
  const mnuPath = optionValue("--mnu");
  const supPath = optionValue("--sup");
  const typeOption = optionValue("--type");
  const language = renderLanguage();
  if ((mnuPath !== undefined || supPath !== undefined) && positional !== undefined) fail("CLI_RENDER_SELECTION", "render accepts either a positional input or --mnu/--sup, not both");
  if ((mnuPath !== undefined || supPath !== undefined) && typeOption !== undefined) fail("CLI_RENDER_SELECTION", "--type applies to BDMV and stream input; omit it for --mnu/--sup");
  if ((mnuPath !== undefined || supPath !== undefined) && optionValue("--m2ts") !== undefined) fail("CLI_RENDER_SELECTION", "--m2ts applies to BDMV input");
  const selection = assetSelection();
  const pngLevel = pngLevelOption();
  const sources: Array<{ kind: "mnu" | "sup"; path: string }> = [];
  if (mnuPath !== undefined) sources.push({ kind: "mnu", path: mnuPath });
  if (supPath !== undefined) sources.push({ kind: "sup", path: supPath });
  if (positional !== undefined) {
    const extension = extname(positional).toLocaleLowerCase("en-US");
    if (extension === ".mnu" || extension === ".sup") sources.push({ kind: extension.slice(1) as "mnu" | "sup", path: positional });
    else {
      if (sources.length) fail("CLI_RENDER_SELECTION", "render accepts either a BDMV or stream input or --mnu/--sup, not both");
      if (language !== undefined) fail("CLI_RENDER_SELECTION", "--language applies to SUP input; BDMV and stream tracks carry their declared language");
      // Rendering is this command's whole job, so the shared pipeline always decodes.
      const pngSelection = { ...selection, renderPng: true };
      const type = assetTypeOption();
      const target = await classifyStreamInput(positional);
      if (target.kind === "stream") return exportStreamAssets(target, resolve(out), type, pngSelection, RENDER_RUN);
      return exportBdmvAssets(positional, resolve(out), type, pngSelection, RENDER_RUN);
    }
  }
  if (!sources.length) fail("CLI_MISSING_INPUT", "render requires a BDMV input, a .m2ts/.rsks stream file, a .mnu/.sup positional input, or --mnu/--sup");
  if (language !== undefined && !sources.some((source) => source.kind === "sup")) fail("CLI_RENDER_SELECTION", "--language applies to SUP input");
  if (selection.pid !== undefined && !sources.some((source) => source.kind === "mnu")) fail("CLI_RENDER_SELECTION", "--pid applies to MNU input");
  return renderPngFromFiles(sources, resolve(out), language, selection.pid, pngLevel);
}

export function renderLanguage(): string | undefined {
  const value = optionValue("--language");
  if (value === undefined) return undefined;
  if (!/^[A-Za-z]{3}$/.test(value)) fail("CLI_INVALID_LANGUAGE", "--language must be a three-letter language code");
  return value.toLocaleLowerCase("en-US");
}

/** Standalone `.mnu`/`.sup` inputs, which carry no disc to discover streams from. */
export async function renderPngFromFiles(sources: Array<{ kind: "mnu" | "sup"; path: string }>, out: string, language: string | undefined, pid: number | undefined, pngLevel: number | undefined = undefined): Promise<void> {
  const progress = commandProgress({ command: "render", steps: Object.values(FILE_STEPS), source: sources.map((source) => source.path).join(", "), details: [["output", out]] });
  const transaction = await beginOutputTransaction(resolve(out));
  try {
    progress.start(FILE_STEPS.read);
    const files: AssetRecord[] = [];
    const targets: DecodeTarget[] = [];
    let partial = false;
    for (const source of sources) {
      const input = resolve(source.path);
      const bytes = await readFile(input);
      const stem = safeAssetStem(input);
      if (source.kind === "mnu") {
        let parsed;
        try { parsed = parseIgsMnu(bytes, { clipId: stem, pid: pid ?? 0x120, pngLevel }); }
        catch (error) { throw new ContractError("RENDER_INVALID_MNU", source.path, `MNU could not be parsed: ${errorText(error)}`); }
        if (parsed.status === "failed" || parsed.scenes.length === 0) {
          const detail = parsed.diagnostics.find((item) => item.severity === "error")?.message ?? "no complete display set";
          throw new ContractError("RENDER_INVALID_MNU", source.path, `MNU contains no renderable menu scene: ${detail}`);
        }
        if (parsed.status === "partial") partial = true;
        for (const asset of parsed.assets) {
          const target = resolve(transaction.stagingPath, asset.relativePath);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, asset.pngBytes, { flag: "wx" });
          files.push(igsElementRecord(asset));
        }
        continue;
      }
      let displaySets;
      try { displaySets = parsePgsSup(bytes); }
      catch (error) { throw new ContractError("RENDER_INVALID_SUP", source.path, `SUP could not be parsed: ${errorText(error)}`); }
      if (displaySets.length === 0) throw new ContractError("RENDER_INVALID_SUP", source.path, "SUP contains no complete display set.");
      // A standalone SUP carries no track interval, so the first display set is
      // the origin: exported seconds stay usable even when the file starts at an
      // arbitrary PTS. Display sets are rendered a few at a time, so a
      // feature-length SUP never holds more than a handful of canvases.
      const origin90k = displaySets[0]!.pts90k;
      targets.push({
        displaySets: displaySets.length,
        write: (onProgress) => writeDisplaySetPngs(pgsTrackPngPlan({
          stagingPath: transaction.stagingPath,
          displaySets,
          origin90k,
          end90k: (index) => pgsDisplaySetEnd90k(displaySets, index),
          pathFor: (index) => `assets/subtitles/${stem}-display-${String(index + 1).padStart(5, "0")}.png`,
          ...(language === undefined ? {} : { language }),
          level: pngLevel,
          onProgress,
        })),
      });
    }
    progress.done(FILE_STEPS.read, countOf(files.length, "image", "images"));
    files.push(...await runDecodeStep(progress, FILE_STEPS.decode, targets, "no SUP input"));
    progress.start(FILE_STEPS.commit);
    await writeFile(resolve(transaction.stagingPath, "assets-manifest.json"), `${JSON.stringify({ schemaVersion: "1.0", assets: files }, null, 2)}\n`, { flag: "wx" });
    await transaction.commit();
    progress.done(FILE_STEPS.commit, countOf(files.length, "asset", "assets"));
    const status = partial ? "partial" : "complete";
    progress.finish(status, [["output", resolve(out)], ["assets", countOf(files.length, "asset", "assets")]]);
    process.stdout.write(`${JSON.stringify({ stageStatus: status, output: resolve(out), assetCount: files.length })}\n`);
  } catch (error) { await transaction.abort(); throw error; }
}