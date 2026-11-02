#!/usr/bin/env node
import { link, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { assertDisjointRoots, beginOutputTransaction, hashFile } from "@bdmv-web/bdmv-io";
import { ContractError } from "@bdmv-web/core";
import { parseBdmv } from "@bdmv-web/bdmv-parser";

const argv = process.argv.slice(2);
const command = argv[0];
const supported = new Set(["inspect", "extract", "convert", "validate", "compare"]);
function optionValue(name: string): string | undefined {
  const index = argv.findIndex((value) => value === name || value.startsWith(`${name}=`));
  if (index < 0) return undefined;
  const arg = argv[index]!;
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
}
function strictDefault(): boolean {
  if (argv.includes("--strict")) return true;
  if (argv.includes("--no-strict")) return false;
  return command === "convert" && optionValue("--mode") !== "menu-only";
}
function inputPath(): string | undefined {
  const takesValue = new Set(["--format", "--out", "--mode", "--player-profile", "--limits"]);
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) { if (!arg.includes("=") && takesValue.has(arg)) i++; continue; }
    return arg;
  }
  return undefined;
}
function fail(code: string, message: string, path?: string): never {
  throw new ContractError(code, path ?? "/", message);
}

async function inspect(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "inspect requires an input path");
  const disc = await parseBdmv(input);
  const json = `${JSON.stringify(disc, null, 2)}\n`;
  const out = optionValue("--out");
  if (!out) { process.stdout.write(json); return; }
  const target = resolve(out); await assertDisjointRoots(disc.root, target);
  const temp = resolve(dirname(target), `.${basename(target)}.tmp-${process.pid}`);
  try { await writeFile(temp, json, { flag: "wx" }); await link(temp, target); await unlink(temp); }
  catch (error) { await rm(temp, { force: true }); throw error; }
}

async function extract(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "extract requires an input path");
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "extract requires --out DIR");
  const disc = await parseBdmv(input);
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  const transaction = await beginOutputTransaction(roots.output);
  try {
    const commandTable = disc.movieObjects.flatMap((object) => object.instructions.map((instruction, instructionIndex) => ({ movieObjectId: object.id, instructionIndex, words: instruction.words, bytes: instruction.bytes, source: instruction.source })));
    const raw = `${JSON.stringify(commandTable, null, 2)}\n`;
    const rawPath = resolve(transaction.stagingPath, "raw-commands.json");
    await writeFile(rawPath, raw, { flag: "wx" });
    const rawHash = await hashFile(rawPath);
    const manifest = { schemaVersion: "1.0", status: "partial", analysisStage: "structural", files: [{ path: "parsed-disc.json", kind: "parsed-disc" }, { path: "raw-commands.json", kind: "raw-command-table", sha256: rawHash.sha256, byteLength: rawHash.byteLength.toString() }], limitations: ["IG/PNG extraction is not implemented", "dynamic MovieObject command targets are unresolved", "BD-J execution is unsupported"] };
    await writeFile(resolve(transaction.stagingPath, "parsed-disc.json"), `${JSON.stringify(disc, null, 2)}\n`, { flag: "wx" });
    await writeFile(resolve(transaction.stagingPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await transaction.commit();
    process.stdout.write(`${JSON.stringify({ status: "partial", output: roots.output })}\n`);
  } catch (error) { await transaction.abort(); throw error; }
}

async function main(): Promise<void> {
  if (!command || !supported.has(command)) fail("CLI_USAGE", "Usage: bdmv-web <inspect|extract|convert|validate|compare> [INPUT] [options]");
  if (command === "inspect") return inspect();
  if (command === "extract") return extract();
  const mode = optionValue("--mode") ?? "standalone-full"; const strict = strictDefault(); const format = optionValue("--format");
  const detail = { code: "E_NOT_IMPLEMENTED", command, mode, strict, message: `The '${command}' command is not implemented yet.` };
  process.stderr.write(format === "json" ? `${JSON.stringify(detail)}\n` : `${detail.code}: ${detail.message}\n`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const e = error instanceof Error ? error : new Error(String(error));
  const code = error instanceof ContractError ? error.code : "E_IO";
  const record = { code, message: e.message, path: error instanceof ContractError ? error.path : null };
  process.stderr.write(optionValue("--format") === "json" ? `${JSON.stringify(record)}\n` : `${code}: ${e.message}\n`);
  process.exitCode = 1;
});
