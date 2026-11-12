import { errorText } from "@bdmv2web/utils";
import { CommanderError } from "commander";
import { ContractError } from "@bdmv2web/core/contract-error";
import { fail } from "./errors.js";
import { buildProgram, COMMANDER_CODES } from "./program.js";
import { failActiveProgress } from "../progress.js";

/**
 * Entry point only: Commander parses and dispatches (see `cli/program.ts`),
 * each command lives under `commands/`, and every failure leaves through the
 * single handler at the bottom of this file.
 */
async function main(version?: string): Promise<void> {
  const program = buildProgram(version);
  if (process.argv.length <= 2) {
    program.outputHelp();
    process.exitCode = 1;
    return;
  }
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.help" || error.code === "commander.version") {
        process.exitCode = 0;
        return;
      }
      fail(COMMANDER_CODES[error.code] ?? "CLI_USAGE", error.message.replace(/^error:\s*/, ""));
    }
    throw error;
  }
}

/** `--format json` moves failures onto the same channel as successful reports. */
function wantsJsonErrors(): boolean {
  const index = process.argv.indexOf("--format");
  if (index >= 0) return process.argv[index + 1] === "json";
  return process.argv.includes("--format=json");
}

function plainMessage(error: unknown): string {
  if (!(error instanceof ContractError)) return errorText(error);
  return error.message.slice(`${error.code} at ${error.path}: `.length);
}

export async function runCli(version?: string): Promise<void> {
  await main(version).catch((error: unknown) => {
    const code = error instanceof ContractError ? error.code : "E_IO";
    const message = plainMessage(error);
    const record = { code, message, path: error instanceof ContractError ? error.path : null };
    failActiveProgress(code);
    process.stderr.write(wantsJsonErrors() ? `${JSON.stringify(record)}\n` : `${code}: ${message}\n`);
    process.exitCode = 1;
  });
}
