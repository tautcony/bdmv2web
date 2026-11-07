import { optionValue } from "./context.js";
import { ContractError } from "@bdmv2web/core";

export function fail(code: string, message: string, path?: string): never {
  throw new ContractError(code, path ?? "/", message);
}

export function outputFormat(commandName: string, defaultFormat: "table" | "json" = "table"): "table" | "json" {
  const value = optionValue("--format") ?? defaultFormat;
  if (value !== "table" && value !== "json") fail("CLI_INVALID_FORMAT", `${commandName} supports 'table' or 'json' for --format, got '${value}'`);
  return value;
}
