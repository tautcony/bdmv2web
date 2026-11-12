import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { consumeSegment, createIgsState } from "../../src/scene/igs.js";
import { syntheticReferenceClip } from "../helpers/fixtures.js";

describe("real IGS composition sample", () => {
  it("keeps the synthetic pixel-reference stream fixture aligned with its builder", async () => {
    const bytes = new Uint8Array(await readFile(new URL("../../../../test-data/fixtures/igs-parser/synthetic-single-object.m2ts", import.meta.url)));
    expect(bytes).toEqual(syntheticReferenceClip());
  });

  it("parses the externally sourced four-page ICS and its button commands", async () => {
    const bytes = new Uint8Array(await readFile(new URL("../../../../test-data/fixtures/igs-parser/ics-menu-disc14.bin", import.meta.url)));
    const state = createIgsState();

    consumeSegment(state, { type: 0x18, data: bytes, offset: 0n }, "real-sample", 0x1400, null, 0n, 0n, 0n);
    consumeSegment(state, { type: 0x80, data: new Uint8Array(), offset: BigInt(bytes.byteLength + 3) }, "real-sample", 0x1400, null, 0n, 0n, BigInt(bytes.byteLength + 3));

    expect(state.diagnostics).toEqual([]);
    expect(state.scenes).toHaveLength(1);
    const scene = state.scenes[0]!;
    expect(scene).toMatchObject({ width: 1920, height: 1080, frameRateCode: 1 });
    expect(scene.pages).toHaveLength(4);
    expect(scene.pages.every((page) => page.buttons.length > 0)).toBe(true);
    const buttons = scene.pages.flatMap((page) => page.buttons);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons[0]?.numericSelectValue).toBe(0xffff);
    const commands = buttons.flatMap((button) => button.commands);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((command) => command.bytes.byteLength === 12)).toBe(true);
  });
});
