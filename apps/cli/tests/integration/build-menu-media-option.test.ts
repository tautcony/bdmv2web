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

describe("build menu media option", () => {
  it("accepts each scope", () => {
    expect(parse(["--menu-media", "auto"])).toMatchObject({ menuMedia: "auto" });
    expect(parse(["--menu-media", "all"])).toMatchObject({ menuMedia: "all" });
    expect(parse(["--menu-media", "none"])).toMatchObject({ menuMedia: "none" });
  });

  it("leaves the scope unset without the option so the command applies auto", () => {
    expect(parse(["--overwrite"]).menuMedia).toBeUndefined();
  });

  it("rejects a scope outside the documented set", () => {
    expect(() => parse(["--menu-media", "everything"])).toThrow(/menu-media must be one of/);
  });

  it("has no BD-J-only spelling", () => {
    expect(parse(["--bdj-media", "all"]).bdjMedia).toBeUndefined();
  });
});
