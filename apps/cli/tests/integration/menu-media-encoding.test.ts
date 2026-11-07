import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/cli/program.js";
import { menuMediaEncoding } from "../../src/commands/build.js";
import { setActiveCommand } from "../../src/cli/context.js";

/** The `build` subcommand, configured like the real one (no process exit on bad input). */
function buildCommand() {
  const command = buildProgram().commands.find((entry) => entry.name() === "build");
  if (!command) throw new Error("build command is not registered");
  command.exitOverride();
  command.configureOutput({ outputError: () => {} });
  return command;
}

function parse(args: string[]): Record<string, unknown> {
  const command = buildCommand();
  command.parseOptions(args);
  return command.opts();
}

describe("menu media encoding options", () => {
  it("parses --crf, --preset, --codec and --hdr into the encoder settings", () => {
    const options = parse(["--crf", "23", "--preset", "fast", "--codec", "h264", "--hdr", "tonemap"]);
    expect(options).toMatchObject({ crf: 23, preset: "fast", codec: "h264", hdr: "tonemap" });
    setActiveCommand("disc", options);
    // `--hdr` is the CLI spelling; the package contract calls the field hdrMode.
    expect(menuMediaEncoding()).toEqual({ crf: 23, preset: "fast", codec: "h264", hdrMode: "tonemap" });
  });

  it("leaves the encoder settings empty so the media layer applies its own defaults", () => {
    const options = parse([]);
    setActiveCommand("disc", options);
    expect(menuMediaEncoding()).toBeUndefined();
  });

  it("passes a single option through without inventing the others", () => {
    setActiveCommand("disc", parse(["--crf", "0"]));
    expect(menuMediaEncoding()).toEqual({ crf: 0 });
    setActiveCommand("disc", parse(["--hdr", "preserve"]));
    expect(menuMediaEncoding()).toEqual({ hdrMode: "preserve" });
  });

  it("rejects encoder settings outside their documented ranges", () => {
    expect(() => parse(["--crf", "52"])).toThrow(/crf must be an integer from 0 through 51/);
    expect(() => parse(["--crf", "-1"])).toThrow(/crf must be an integer from 0 through 51/);
    expect(() => parse(["--crf", "high"])).toThrow(/crf must be an integer from 0 through 51/);
    expect(() => parse(["--preset", "placebo"])).toThrow(/preset must be one of: ultrafast, veryfast, fast, medium/);
    expect(() => parse(["--codec", "vp9"])).toThrow(/codec must be one of: h264, hevc/);
    expect(() => parse(["--hdr", "dynamic"])).toThrow(/hdr must be one of: tonemap, preserve/);
  });

  it("keeps the media options on the convert alias as well", () => {
    const program = buildProgram();
    const convert = program.commands.find((entry) => entry.aliases().includes("convert"));
    expect(convert?.name()).toBe("build");
    expect(convert?.options.map((option) => option.long)).toEqual(expect.arrayContaining(["--crf", "--preset", "--codec", "--hdr"]));
  });
});
