#!/usr/bin/env node
const command = process.argv[2];
const supported = new Set(["inspect", "extract", "convert", "validate", "compare"]);

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const arg = process.argv.slice(3).find((value) => value === name || value.startsWith(prefix));
  if (arg?.startsWith(prefix)) return arg.slice(prefix.length);
  if (arg === name) return process.argv[process.argv.indexOf(arg) + 1];
  return undefined;
}

function strictDefault(): boolean {
  if (process.argv.includes("--strict")) return true;
  if (process.argv.includes("--no-strict")) return false;
  return command === "convert" && optionValue("--mode") !== "menu-only";
}

if (!command || !supported.has(command)) {
  process.stderr.write("Usage: bdmv-web <inspect|extract|convert|validate|compare> [options]\n");
  process.exitCode = 1;
} else {
  const mode = optionValue("--mode") ?? "standalone-full";
  const strict = strictDefault();
  const format = optionValue("--format");
  const detail = { code: "E_NOT_IMPLEMENTED", command, mode, strict, message: `The '${command}' command is not implemented yet.` };
  process.stderr.write(format === "json" ? `${JSON.stringify(detail)}\n` : `${detail.code}: ${detail.message}\n`);
  process.exitCode = 1;
}
