import { assetSelection, exportOutputs, outputTypeOption } from "../cli/assets.js";
import { flagEnabled, inputPath, optionValue } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { runGraphicsInput } from "../shared/asset-export.js";
import type { GraphicsRun } from "../shared/asset-export.js";
import { resolve } from "node:path";

const EXPORT_COMMAND = { command: "export", selectionCode: "CLI_EXPORT_SELECTION" } as const;

export async function exportAssets(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "export requires a BDMV input path or a .m2ts/.rsks stream file");
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "export requires --out DIR");
  const type = outputTypeOption();
  const metadataOnly = flagEnabled("--metadata-only");
  if (metadataOnly && flagEnabled("--render")) fail("CLI_EXPORT_SELECTION", "--metadata-only writes structural metadata; drop --render");
  // Without `--type` an export writes the containers. `--metadata-only` selects
  // the metadata-only shape of the same run.
  const run: GraphicsRun = { ...EXPORT_COMMAND, outputs: exportOutputs(type, !metadataOnly) };
  return runGraphicsInput(run, input, resolve(out), type, assetSelection());
}
