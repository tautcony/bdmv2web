import { assetSelection, exportOutputs, outputTypeOption } from "../cli/assets.js";
import { flagEnabled, inputPath, optionState, optionValue } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { runGraphicsInput } from "../shared/asset-export.js";
import type { GraphicsRun } from "../shared/asset-export.js";
import { resolve } from "node:path";

const EXPORT_COMMAND = { command: "export", selectionCode: "CLI_EXPORT_SELECTION" } as const;

export async function exportAssets(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "export requires a BDMV input path or a .m2ts/.rsks stream file");
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "export requires --out DIR");
  const type = outputTypeOption();
  const noAssets = optionState("--assets") === false;
  if (noAssets && flagEnabled("--render")) fail("CLI_EXPORT_SELECTION", "--no-assets writes no containers or PNGs; drop --render");
  // Without `--type` an export writes the containers it always wrote. `--no-assets`
  // is the metadata-only shape that the retired `extract` command used to be.
  const run: GraphicsRun = { ...EXPORT_COMMAND, outputs: exportOutputs(type, !noAssets) };
  return runGraphicsInput(run, input, resolve(out), type, assetSelection());
}
