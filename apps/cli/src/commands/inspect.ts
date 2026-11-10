import { flagEnabled, inputPath, optionValue, strictDefault } from "../cli/context.js";
import { fail, outputFormat } from "../cli/errors.js";
import { printTable, writeJsonFile } from "../cli/output.js";
import { firstBlockingCode, stageFailure } from "../cli/stages.js";
import { assertDisjointRoots } from "@bdmv2web/bdmv-io";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { decideStageOutcome } from "@bdmv2web/test-runner";
import { resolve } from "node:path";

export async function inspect(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "inspect requires an input path");
  // Argument contract first: a missing flag value must not be masked by stage output.
  const out = optionValue("--out");
  const format = outputFormat("inspect");
  const strict = strictDefault();
  const allowPartial = flagEnabled("--allow-partial");
  const disc = await parseBdmv(input);
  const outcome = decideStageOutcome({ stage: "inspect", diagnostics: disc.diagnostics, strict });
  if (outcome.status === "failed" && !allowPartial) {
    stageFailure(firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics);
    return;
  }
  const json = `${JSON.stringify({ ...disc, stageStatus: outcome.status }, null, 2)}\n`;
  if (out) { const target = resolve(out); await assertDisjointRoots(disc.root, target); await writeJsonFile(target, json); }
  if (format === "json") process.stdout.write(json);
  else printTable("BDMV inspection", ["Section", "Count / Status"], [
    ["Analysis", disc.analysisStage], ["Delivery", outcome.status], ["Entries", disc.declarations.entries],
    ["MovieObjects", disc.declarations.movieObjects], ["Playlists", disc.declarations.playlists],
    ["PlayItems", disc.declarations.playItems], ["Clips", disc.declarations.clips],
    ["Streams", disc.declarations.streams], ["Sounds", disc.declarations.sounds],
    ["BDJO", disc.declarations.bdjos ?? 0], ["META/DL", disc.declarations.metadata ?? 0],
    ["ExtensionData entries", disc.declarations.extensionData ?? 0], ["CLPI ClipMarks", disc.declarations.clipMarks ?? 0],
    ["Diagnostics", disc.diagnostics.length], ["Support prediction", disc.supportPrediction.status],
  ]);
  process.exitCode = allowPartial ? 0 : outcome.exitCode;
}
