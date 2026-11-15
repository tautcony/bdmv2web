import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/cli/program.js";

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

function operands(args: string[]): string[] {
  return buildCommand().parseOptions(args).operands;
}

describe("build resume option", () => {
  it("takes the reuse directory from --resume-dir", () => {
    expect(parse(["--resume-dir", ".BDMV-menu.staging-4f2a"])).toMatchObject({ resumeDir: ".BDMV-menu.staging-4f2a" });
  });

  it("marks a bare --resume so the output target decides the directory", () => {
    expect(parse(["--resume"])).toMatchObject({ resume: true });
  });

  it("leaves resume unset without the option", () => {
    expect(parse(["--overwrite"]).resume).toBeUndefined();
  });

  it("rejects an empty --resume-dir", () => {
    expect(() => parse(["--resume-dir", ""])).toThrow();
  });

  it("keeps a path after --resume as the positional input", () => {
    expect(operands(["--resume", "/disc/BDMV"])).toEqual(["/disc/BDMV"]);
  });

  it("disables implicit media reuse with --no-reuse", () => {
    expect(parse(["--overwrite", "--no-reuse"])).toMatchObject({ reuse: false });
  });
});
