#!/usr/bin/env node
import { createRequire } from "node:module";
import { CommanderError } from "commander";
import { ContractError } from "@bdmv2web/core/contract-error";
import { fail } from "./cli/errors.js";
import { buildProgram, COMMANDER_CODES } from "./cli/program.js";
import { failActiveProgress } from "./progress.js";

/** `package.json` sits beside `src/` and beside the built `dist/index.js`. */
const { version: cliVersion } = createRequire(import.meta.url)("../package.json") as { version: string };

/**
 * Entry point only: Commander parses and dispatches (see `cli/program.ts`),
 * each command lives under `commands/`, and every failure leaves through the
 * single handler at the bottom of this file.
 */
async function main(): Promise<void> {
  const program = buildProgram(cliVersion);
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
  if (!(error instanceof ContractError)) return error instanceof Error ? error.message : String(error);
  return error.message.slice(`${error.code} at ${error.path}: `.length);
}

main().catch((error: unknown) => {
  const code = error instanceof ContractError ? error.code : "E_IO";
  const message = plainMessage(error);
  const record = { code, message, path: error instanceof ContractError ? error.path : null };
  failActiveProgress(code);
  process.stderr.write(wantsJsonErrors() ? `${JSON.stringify(record)}\n` : `${code}: ${message}\n`);
  process.exitCode = 1;
});
