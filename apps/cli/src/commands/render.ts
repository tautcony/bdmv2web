import { assetSelection, assetTypeOption, igsElementRecord, pngLevelOption, pngOutputs } from "../cli/assets.js";
import type { AssetRecord } from "../cli/assets.js";
import { inputPath, optionValue } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { commandProgress, countOf } from "../progress.js";
import { exportBdmvAssets, exportStreamAssets } from "../shared/asset-export.js";
import type { GraphicsRun } from "../shared/asset-export.js";
import { pgsTrackPngPlan, runDecodeStep, writeDisplaySetPngs } from "../shared/pgs.js";
import type { DecodeTarget } from "../shared/pgs.js";
import { FILE_STEPS } from "../shared/steps.js";
import { classifyInput } from "../shared/stream-input.js";
import type { StreamTarget } from "../shared/stream-input.js";
import { beginOutputTransaction } from "@bdmv2web/bdmv-io";
import { ContractError } from "@bdmv2web/core";
import { parseIgsMnu } from "@bdmv2web/igs";
import { parsePgsSup, pgsDisplaySetEnd90k } from "@bdmv2web/media-export";
import { errorText } from "@bdmv2web/utils";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * `render` is the PNG-only half of `export`: it runs the same pipeline (same
 * naming, manifest records, concurrency and progress) with containers turned off,
 * and it is the only command that decodes a standalone `.mnu`/`.sup` file.
 */
const RENDER_COMMAND = { command: "render", selectionCode: "CLI_RENDER_SELECTION" } as const;

export async function renderPng(): Promise<void> {
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "render requires --out DIR");
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "render requires a BDMV directory, a .m2ts/.rsks stream file, or a .mnu/.sup file");
  const language = renderLanguage();
  const selection = assetSelection();
  // The input decides what can be rendered: a `.mnu`/`.sup` file carries its own
  // graphics, a disc or stream declares them. Only the mismatched combinations
  // need an error.
  const target = await classifyInput(input);
  if (target.kind === "mnu" || target.kind === "sup") {
    if (optionValue("--type") !== undefined) fail("CLI_RENDER_SELECTION", "--type applies to a BDMV disc or a stream file; a .mnu/.sup input already selects its own graphics");
    if (selection.clipId !== undefined) fail("CLI_RENDER_SELECTION", "--m2ts applies to a BDMV disc");
    if (target.kind === "sup" && selection.pid !== undefined) fail("CLI_RENDER_SELECTION", "--pid applies to an IGS (.mnu) input");
    if (target.kind === "mnu" && language !== undefined) fail("CLI_RENDER_SELECTION", "--language applies to a PGS (.sup) input");
    return renderPngFromFile(target, resolve(out), language, selection.pid, pngLevelOption());
  }
  if (language !== undefined) fail("CLI_RENDER_SELECTION", "--language applies to a standalone SUP; a disc or stream track carries its declared language");
  // Rendering is this command's whole job, so the shared pipeline always decodes.
  const type = assetTypeOption();
  const run: GraphicsRun = { ...RENDER_COMMAND, outputs: pngOutputs(type) };
  const pngSelection = { ...selection, renderPng: true };
  return target.kind === "stream"
    ? exportStreamAssets(target, resolve(out), type, pngSelection, run)
    : exportBdmvAssets(input, resolve(out), type, pngSelection, run);
}

export function renderLanguage(): string | undefined {
  const value = optionValue("--language");
  if (value === undefined) return undefined;
  if (!/^[A-Za-z]{3}$/.test(value)) fail("CLI_INVALID_LANGUAGE", "--language must be a three-letter language code");
  return value.toLocaleLowerCase("en-US");
}

/** A standalone `.mnu`/`.sup` file, which carries no disc to discover streams from. */
export async function renderPngFromFile(source: ({ kind: "mnu" } | { kind: "sup" }) & StreamTarget, out: string, language: string | undefined, pid: number | undefined, pngLevel: number | undefined = undefined): Promise<void> {
  const progress = commandProgress({ command: "render", steps: Object.values(FILE_STEPS), source: source.path, details: [["output", out]] });
  const transaction = await beginOutputTransaction(resolve(out));
  try {
    progress.start(FILE_STEPS.read);
    const files: AssetRecord[] = [];
    const targets: DecodeTarget[] = [];
    let partial = false;
    const input = resolve(source.path);
    const bytes = await readFile(input);
    const stem = source.stem;
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
    } else {
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
