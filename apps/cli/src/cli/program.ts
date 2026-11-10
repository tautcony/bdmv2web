import { Command, InvalidArgumentError } from "commander";
import { setActiveCommand, type ParsedOptions } from "./context.js";

export type CommandName = "inspect" | "extract" | "build" | "validate" | "compare" | "list" | "export" | "render";

/**
 * One command module per name, imported on first use. Loading every command up
 * front costs ~870 ms before a single argument is read, which `--version` and
 * `--help` never need.
 */
const loaders: Record<CommandName, () => Promise<() => Promise<void>>> = {
  inspect: async () => (await import("../commands/inspect.js")).inspect,
  extract: async () => (await import("../commands/extract.js")).extract,
  build: async () => (await import("../commands/build.js")).build,
  validate: async () => (await import("../commands/validate.js")).validate,
  compare: async () => (await import("../commands/compare.js")).compareReference,
  list: async () => (await import("../commands/list.js")).listAssets,
  export: async () => (await import("../commands/export.js")).exportAssets,
  render: async () => (await import("../commands/render.js")).renderPng,
};

/** Commander parses and dispatches; each command body reads the snapshot this leaves behind. */
export async function dispatch(name: CommandName, input: string | undefined, options: ParsedOptions): Promise<void> {
  setActiveCommand(input, options);
  return (await loaders[name]())();
}

/** Reject `--out=` instead of turning an empty string into a path. */
function nonEmpty(value: string): string {
  if (value === "") throw new InvalidArgumentError("value must not be empty");
  return value;
}

/** Restrict an option to a documented set of values. */
function oneOf(name: string, allowed: readonly string[]): (value: string) => string {
  return (value: string) => {
    if (!allowed.includes(value)) throw new InvalidArgumentError(`${name} must be one of: ${allowed.join(", ")}`);
    return value;
  };
}

/** Parse a CRF value in the encoder's 0–51 range. */
function crfValue(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError("crf must be an integer from 0 through 51");
  const parsed = Number(value);
  if (parsed > 51) throw new InvalidArgumentError("crf must be an integer from 0 through 51");
  return parsed;
}

function withStrict(command: Command): Command {
  return command
    .option("--strict", "treat error diagnostics as a stage failure")
    .option("--no-strict", "accept error diagnostics (default)");
}

/** `version` is optional so tests can build the command tree without package metadata. */
export function buildProgram(version?: string): Command {
  const program = new Command("bdmv2web")
    .description("Inspect a Blu-ray BDMV disc and build an offline web menu package.")
    .exitOverride()
    .configureOutput({ outputError: () => {} });
  if (version !== undefined) program.version(version);

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
    .option("--crf <value>", "encoder quality 0-51 (HEVC default 24, H.264 default 18)", crfValue)
    .option("--preset <preset>", "encoder preset: ultrafast, veryfast, fast, medium", oneOf("preset", ["ultrafast", "veryfast", "fast", "medium"]))
    .option("--codec <codec>", "menu video codec: hevc (default) or h264", oneOf("codec", ["h264", "hevc"]))
    .option("--hdr <mode>", "HDR handling: tonemap (default) or preserve", oneOf("hdr", ["tonemap", "preserve"]))
    .option("--progress", "print step progress on stderr")
    .option("--no-progress", "keep stderr silent")
    .option("--png-level <level>", "deflate level 0-9 for written PNGs (default: tuned per encoder)", nonEmpty);
  withStrict(buildCommand).action((input: string | undefined, options: ParsedOptions) => dispatch("build", input, options));

  const validateCommand = program.command("validate")
    .description("Audit a generated package offline")
    .argument("[input]", "package directory")
    .option("--offline", "audit without a disc or FFmpeg (required)")
    .option("--format <format>", "json", nonEmpty);
  withStrict(validateCommand).action((input: string | undefined, options: ParsedOptions) => dispatch("validate", input, options));

  const compareCommand = program.command("compare")
    .description("Compare an actual VM trace against an independent reference trace")
    .argument("[input]", "compare input sequence JSON file")
    .requiredOption("--actual <file>", "actual VM trace JSON", nonEmpty)
    .option("--reference <file>", "independent reference trace JSON", nonEmpty)
    .option("--reference-tool <name>", "reference tool name", nonEmpty)
    .option("--reference-version <version>", "reference tool version", nonEmpty)
    .option("--out <file>", "write the comparison report to this path", nonEmpty)
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
    .option("--format <format>", "table or json", nonEmpty)
    .option("--png-level <level>", "deflate level 0-9 for written PNGs (default: tuned per encoder)", nonEmpty)
  listCommand.action((input: string | undefined, options: ParsedOptions) => dispatch("list", input, options));

  const exportCommand = program.command("export")
    .description("Export IGS .mnu files, SUP tracks and PNG frames")
    .argument("[input]", "BDMV root or its parent directory")
    .option("--out <dir>", "output directory", nonEmpty)
    .option("--type <type>", "all, igs, or sup", nonEmpty)
    .option("--m2ts <clip>", "restrict to one clip, for example 00001", nonEmpty)
    .option("--pid <pid>", "restrict to one PID, for example 0x1200", nonEmpty)
    .option("--decode <format>", "png also writes decoded PNGs", nonEmpty)
    .option("--format <format>", "table or json", nonEmpty)
    .option("--png-level <level>", "deflate level 0-9 for written PNGs (default: tuned per encoder)", nonEmpty)
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
    .option("--format <format>", "table or json", nonEmpty)
    .option("--png-level <level>", "deflate level 0-9 for written PNGs (default: tuned per encoder)", nonEmpty)
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
