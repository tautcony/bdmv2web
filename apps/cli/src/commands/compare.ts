import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createReferenceCompareReport, validateCompareInput, type ReferenceCompareReport, type TraceEvent } from "@bdmv2web/test-runner";
import { inputPath, optionValue } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { writeGeneratedReport } from "../cli/output.js";

/** Read a JSON document, reporting the caller's error code instead of a raw exception. */
async function readJson(path: string, code: string, what: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    return fail(code, `${what} ${path} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`, path);
  }
}

function readTrace(value: unknown, code: string, what: string, path: string): TraceEvent[] {
  if (!Array.isArray(value)) fail(code, `${what} ${path} must contain a JSON array of trace events`, path);
  return value as TraceEvent[];
}

/**
 * Compare an actual VM trace with an independent reference trace.
 *
 * Exit codes are fixed by the spec: `pass` 0, divergence or input/execution
 * error 1, and `not-verified` (no reference, or no reference tool version) 2.
 * The reference must be a different file from the actual trace; otherwise the
 * comparison would certify the trace against itself.
 */
export async function compareReference(): Promise<void> {
  const input = inputPath();
  if (!input) fail("CLI_MISSING_INPUT", "compare requires a compare input sequence JSON file");
  const format = optionValue("--format");
  if (format !== undefined && format !== "json") fail("CLI_INVALID_FORMAT", `compare supports only 'json' for --format, got '${format}'`);
  const actualArg = optionValue("--actual");
  if (!actualArg) fail("COMPARE_MISSING_ACTUAL", "compare requires --actual <trace.json>");
  const referenceArg = optionValue("--reference");

  const inputValue = await readJson(resolve(input), "COMPARE_INPUT_INVALID", "compare input");
  if (!validateCompareInput(inputValue)) fail("COMPARE_INPUT_INVALID", `compare input ${input} is not a deterministic input sequence with profile, registers, stable entry, seed and ordered events`, input);

  const actualPath = resolve(actualArg);
  const actualTrace = readTrace(await readJson(actualPath, "COMPARE_ACTUAL_INVALID", "actual trace"), "COMPARE_ACTUAL_INVALID", "actual trace", actualPath);

  let reference: { trace: TraceEvent[]; tool: { name: string; version: string | null; invocation: string | null } } | undefined;
  if (referenceArg !== undefined) {
    const referencePath = resolve(referenceArg);
    const referenceTrace = readTrace(await readJson(referencePath, "COMPARE_REFERENCE_INVALID", "reference trace"), "COMPARE_REFERENCE_INVALID", "reference trace", referencePath);
    const [actualReal, referenceReal] = await Promise.all([realpath(actualPath), realpath(referencePath)]);
    if (actualReal === referenceReal) fail("COMPARE_REFERENCE_NOT_INDEPENDENT", "the reference trace must be a different file from the actual trace", referenceArg);
    reference = {
      trace: referenceTrace,
      tool: {
        name: optionValue("--reference-tool") ?? "unspecified",
        version: optionValue("--reference-version") ?? null,
        invocation: null,
      },
    };
  }

  const report: ReferenceCompareReport = createReferenceCompareReport({
    input: inputValue,
    actualTrace,
    ...(reference === undefined ? {} : { reference }),
  });

  const json = `${JSON.stringify(report, null, 2)}\n`;
  const out = optionValue("--out");
  if (out !== undefined) {
    const target = resolve(out);
    await writeGeneratedReport(dirname(target), basename(target), json);
  }
  process.stdout.write(json);
  process.exitCode = report.result === "pass" ? 0 : report.result === "not-verified" ? 2 : 1;
}
