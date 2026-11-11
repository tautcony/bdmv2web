import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/cli/program.js";

function parse(args: string[]): Record<string, unknown> {
  const command = buildProgram().commands.find((entry) => entry.name() === "build");
  if (!command) throw new Error("build command is not registered");
  command.exitOverride();
  command.configureOutput({ outputError: () => {} });
  command.parseOptions(args);
  return command.opts();
}

describe("build resume option", () => {
  it("keeps the directory given to --resume", () => {
    expect(parse(["--resume", ".BDMV-menu.staging-4f2a"])).toMatchObject({ resume: ".BDMV-menu.staging-4f2a" });
  });

  it("marks a bare --resume so the output target decides the directory", () => {
    expect(parse(["--resume"])).toMatchObject({ resume: true });
  });

  it("leaves resume unset without the option", () => {
    expect(parse(["--overwrite"]).resume).toBeUndefined();
  });
});
