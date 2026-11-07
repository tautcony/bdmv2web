import { Command, InvalidArgumentError } from "commander";
import { build } from "../commands/build.js";
import { compareReference } from "../commands/compare.js";
import { exportAssets } from "../commands/export.js";
import { extract } from "../commands/extract.js";
import { inspect } from "../commands/inspect.js";
import { listAssets } from "../commands/list.js";
import { renderPng } from "../commands/render.js";
import { validate } from "../commands/validate.js";
import { setActiveCommand, type ParsedOptions } from "./context.js";

export type CommandName = "inspect" | "extract" | "build" | "validate" | "compare" | "list" | "export" | "render";

/** Commander parses and dispatches; each command body reads the snapshot this leaves behind. */
export function dispatch(name: CommandName, input: string | undefined, options: ParsedOptions): Promise<void> {
  setActiveCommand(input, options);
  const handlers: Record<CommandName, () => Promise<void>> = {
    inspect, extract, build, validate, compare: compareReference, list: listAssets, export: exportAssets, render: renderPng,
  };
  return handlers[name]();
}

/** Reject `--out=` instead of turning an empty string into a path. */
function nonEmpty(value: string): string {
  if (value === "") throw new InvalidArgumentError("value must not be empty");
  return value;
}

function withStrict(command: Command): Command {
  return command
    .option("--strict", "treat error diagnostics as a stage failure")
    .option("--no-strict", "accept error diagnostics (default)");
}

export function buildProgram(): Command {
  const program = new Command("bdmv2web")
    .description("Inspect a Blu-ray BDMV disc and build an offline web menu package.")
    .exitOverride()
    .configureOutput({ outputError: () => {} });

  const inspectCommand = program.command("inspect")
    .description("Inspect the disc structure and report a stage status")
    .argument("[input]", "BDMV root or its parent directory")
    .option("--out <file>", "write the JSON report to a file", nonEmpty)
    .option("--format <format>", "table or json", nonEmpty)
    .option("--allow-partial", "exit 0 even when the stage failed");
  withStrict(inspectCommand).action((input: string | undefined, options: ParsedOptions) => dispatch("inspect", input, options));

  const extractCommand = program.command("extract")
    .description("Write structural analysis artifacts (hdmv, igs, sup)")
    .argument("[input]", "BDMV root or its parent directory")
    .option("--out <dir>", "output directory", nonEmpty)
    .option("--type <type>", "hdmv, igs, or sup", nonEmpty)
    .option("--all", "extract every artifact type")
    .option("--format <format>", "table or json", nonEmpty);
  withStrict(extractCommand).action((input: string | undefined, options: ParsedOptions) => dispatch("extract", input, options));

  const buildCommand = program.command("build")
    .alias("convert")
    .description("Build a self-contained offline menu package")
    .argument("[input]", "BDMV root or its parent directory")
    .option("--out <dir>", "output package directory", nonEmpty)
    .option("--title <title>", "package title", nonEmpty)
    .option("--player-profile <file>", "player profile JSON", nonEmpty)
    .option("--limits <file>", "VM limits JSON", nonEmpty)
    .option("--overwrite", "replace an existing output directory")
    .option("--progress", "print step progress on stderr")
    .option("--no-progress", "keep stderr silent");
  withStrict(buildCommand).action((input: string | undefined, options: ParsedOptions) => dispatch("build", input, options));

  const validateCommand = program.command("validate")
    .description("Audit a generated package offline")
    .argument("[input]", "package directory")
    .option("--offline", "audit without a disc or FFmpeg (required)")
    .option("--format <format>", "json", nonEmpty);
  withStrict(validateCommand).action((input: string | undefined, options: ParsedOptions) => dispatch("validate", input, options));

  const compareCommand = program.command("compare")
    .description("Compare generated output against reference evidence (not implemented)")
    .argument("[input]", "package directory")
    .option("--format <format>", "json", nonEmpty);
  withStrict(compareCommand).action((input: string | undefined, options: ParsedOptions) => dispatch("compare", input, options));

  const listCommand = program.command("list")
    .description("List IGS and SUP assets of a disc")
    .argument("[input]", "BDMV root or its parent directory")
    .option("--type <type>", "all, igs, or sup", nonEmpty)
    .option("--m2ts <clip>", "restrict to one clip, for example 00001", nonEmpty)
    .option("--pid <pid>", "restrict to one PID, for example 0x1200", nonEmpty)
    .option("--decode <format>", "png decodes assets while listing", nonEmpty)
    .option("--out <file>", "write the JSON report to a file", nonEmpty)
    .option("--format <format>", "table or json", nonEmpty);
  listCommand.action((input: string | undefined, options: ParsedOptions) => dispatch("list", input, options));

  const exportCommand = program.command("export")
    .description("Export IGS .mnu files, SUP tracks and PNG frames")
    .argument("[input]", "BDMV root or its parent directory")
    .option("--out <dir>", "output directory", nonEmpty)
    .option("--type <type>", "all, igs, or sup", nonEmpty)
    .option("--m2ts <clip>", "restrict to one clip, for example 00001", nonEmpty)
    .option("--pid <pid>", "restrict to one PID, for example 0x1200", nonEmpty)
    .option("--decode <format>", "png also writes decoded PNGs", nonEmpty)
    .option("--format <format>", "table or json", nonEmpty);
  exportCommand.action((input: string | undefined, options: ParsedOptions) => dispatch("export", input, options));

  const renderCommand = program.command("render")
    .description("Render PNG frames from a BDMV disc, a .mnu file, or a .sup file")
    .argument("[input]", "BDMV directory, or a .mnu/.sup file")
    .option("--out <dir>", "output directory", nonEmpty)
    .option("--mnu <file>", "render a standalone IGS .mnu file", nonEmpty)
    .option("--sup <file>", "render a standalone PGS .sup file", nonEmpty)
    .option("--language <lang>", "three-letter language code recorded in the manifest", nonEmpty)
    .option("--type <type>", "all, igs, or sup for BDMV input", nonEmpty)
    .option("--m2ts <clip>", "restrict to one clip for BDMV input", nonEmpty)
    .option("--pid <pid>", "restrict to one PID", nonEmpty)
    .option("--format <format>", "table or json", nonEmpty);
  renderCommand.action((input: string | undefined, options: ParsedOptions) => dispatch("render", input, options));

  return program;
}

/** Commander failure codes keep their contract spelling. */
export const COMMANDER_CODES: Record<string, string> = {
  "commander.unknownOption": "CLI_UNKNOWN_OPTION",
  "commander.optionMissingArgument": "CLI_MISSING_VALUE",
  "commander.missingMandatoryOptionValue": "CLI_MISSING_VALUE",
  "commander.missingArgument": "CLI_MISSING_INPUT",
  "commander.excessArguments": "CLI_USAGE",
  "commander.unknownCommand": "CLI_USAGE",
  "commander.invalidArgument": "CLI_INVALID_ARGUMENT",
};
