import { flagEnabled, inputPath, optionValue } from "../cli/context.js";
import { fail, outputFormat } from "../cli/errors.js";
import { writeJsonFile } from "../cli/output.js";
import { firstBlockingCode, stageFailure } from "../cli/stages.js";
import { assertDisjointRoots } from "@bdmv2web/bdmv-io";
import { decideStageOutcome } from "@bdmv2web/test-runner";
import { resolve } from "node:path";
import { collectInspection, collectStructuralInspection } from "./inspect-collection.js";
import { assetSelection, assetTypeOption } from "../cli/assets.js";
import { renderCombinedInspection, serializeCombinedInspection } from "./inspect-output.js";

export async function inspect(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "inspect requires an input path");
  // Argument contract first: a missing flag value must not be masked by stage output.
  const out = optionValue("--out");
  const format = outputFormat("inspect");
  const allowPartial = flagEnabled("--allow-partial");
  const selection = assetSelection();
  const type = assetTypeOption();
  const interactive = optionValue("--format") === undefined && process.stdout.isTTY;
  const tui = interactive ? await import("./inspect-tui.js") : undefined;
  const collected = tui && !out
    ? await collectStructuralInspection(input, selection, type)
    : await collectInspection(input, selection, type);
  const { disc } = collected;
  const outcome = decideStageOutcome({ stage: "inspect", diagnostics: disc.diagnostics });
  if (outcome.status === "failed" && !allowPartial) {
    stageFailure(firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics);
    return;
  }
  const json = out || format === "json" ? serializeCombinedInspection(collected, outcome.status) : undefined;
  if (out) { const target = resolve(out); await assertDisjointRoots(disc.root, target); await writeJsonFile(target, json!); }
  if (format === "json") process.stdout.write(json!);
  else if (tui) await tui.runInspectionTui(collected, outcome.status);
  else process.stdout.write(renderCombinedInspection(collected, outcome.status));
  process.exitCode = allowPartial ? 0 : collected.graphicsStageStatus === "failed" ? 1 : outcome.exitCode;
}
