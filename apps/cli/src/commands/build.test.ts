import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { parseDiscIR } from "@bdmv2web/core";
import { HdmvVm } from "@bdmv2web/hdmv";
import { createHdmvSourceMap } from "./extract.js";
import { createMenuDiscIR, createVmPrograms } from "./build.js";

describe("menu DiscIR source references", () => {
  it("preserves the parsed index source in a schema-valid menu IR", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const disc = await parseBdmv(root);
    const ir = createMenuDiscIR(disc, [], false);

    expect(ir.entries[0]?.source).toMatchObject({ path: "index.bdmv", origin: "primary", byteOffset: expect.stringMatching(/^(0|[1-9][0-9]*)$/) });
    expect(parseDiscIR(ir)).toBe(ir);
  });

  it("preserves each parsed instruction source and index in the packaged VM program", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const disc = await parseBdmv(root);
    const instruction = createVmPrograms(disc)[0]?.instructions[0];

    expect(instruction).toMatchObject({ source: { path: "MovieObject.bdmv", origin: "primary", offset: expect.stringMatching(/^(0|[1-9][0-9]*)$/), instructionIndex: 0 } });
  });

  it("keeps the instruction source and index on VM trace entries", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const disc = await parseBdmv(root);
    const vm = new HdmvVm(createVmPrograms(disc), { entries: disc.entries });
    vm.reset(0);
    vm.runTurn();

    expect(vm.trace.find((entry) => entry.source?.instructionIndex === 0)).toMatchObject({ source: { path: "MovieObject.bdmv", offset: expect.stringMatching(/^(0|[1-9][0-9]*)$/), instructionIndex: 0 } });
  });

  it("maps an instruction source to its file byte offset", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV");
    const disc = await parseBdmv(root);

    expect(createHdmvSourceMap(disc).instructions[0]).toMatchObject({ instructionIndex: 0, source: { path: "MovieObject.bdmv", origin: "primary", byteOffset: expect.stringMatching(/^(0|[1-9][0-9]*)$/), instructionIndex: 0 } });
  });
});
