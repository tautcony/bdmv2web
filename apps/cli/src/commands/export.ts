import { assetSelection, assetTypeOption } from "../cli/assets.js";
import { inputPath, optionValue } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { exportBdmvAssets, exportStreamAssets } from "../shared/asset-export.js";
import type { ExportRun } from "../shared/asset-export.js";
import { classifyStreamInput } from "../shared/stream-input.js";
import { resolve } from "node:path";

/** `export` is the command that writes the `.mnu`/`.sup` containers next to the PNGs. */
const EXPORT_RUN: ExportRun = { command: "export", containers: true, selectionCode: "CLI_EXPORT_SELECTION" };

export async function exportAssets(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "export requires a BDMV input path or a .m2ts/.rsks stream file");
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "export requires --out DIR");
  const type = assetTypeOption();
  const selection = assetSelection();
  const target = await classifyStreamInput(input);
  if (target.kind === "stream") return exportStreamAssets(target, resolve(out), type, selection, EXPORT_RUN);
  return exportBdmvAssets(input, resolve(out), type, selection, EXPORT_RUN);
}