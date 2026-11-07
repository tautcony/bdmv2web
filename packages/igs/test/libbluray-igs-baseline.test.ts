/**
 * Element-level comparison against VideoLAN libbluray 1.5.0's own IG decoder.
 *
 * test-data/baselines/libbluray-1.5.0-igs-baseline.json was produced by feeding the
 * checked-in IG packet fixtures to libbluray's graphics_processor_decode_ts
 * (see scripts/generate-libbluray-baselines.py). Every page, BOG, button,
 * palette entry and object above comes from that run. The tests read only the
 * golden and the fixtures; libbluray is not needed at test time.
 *
 * RGBA pixel fidelity stays covered by igs-reference-element-summary.test.ts,
 * which uses the independent igstools renderer registered in docs/references.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractIgsFromChunks, type IgsObject, type IgsPage, type IgsPalette, type IgsScene } from "../src/index.js";
import { chunks } from "./fixtures.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const goldenPath = resolve(repositoryRoot, "test-data/baselines/libbluray-1.5.0-igs-baseline.json");
const fixtureRoot = resolve(repositoryRoot, "test-data/fixtures/hdmv-navigation/disc-data");

type EffectRow = [number, number, number, Array<[number, number, number, number, number, number, number, number, number, number]>];
type EffectSequenceRow = [number, number, EffectRow[]];
type ButtonRow = number[];
type BogRow = [number, number, ButtonRow[]];
type PageRow = [number, number, number, number, number, number, EffectSequenceRow, EffectSequenceRow, number, BogRow[]];
type IcsRow = {
  width: number; height: number; frameRate: number; number: number; state: number;
  streamModel: number; uiModel: number; timeouts: [number, number, number]; pages: PageRow[];
};
type PaletteRow = [number, number, string];
type ObjectRow = [number, number, number, number, number, number, number, number, string, number[]];
type Golden = {
  reference: { tool: string; version: string; revision: string; decoder: string };
  cases: Array<{
    case: string; clip: string; pid: number;
    displaySet: { complete: number; epochStart: number; validPts: string; numPalette: number; numObject: number; numWindow: number };
    ics: IcsRow; palettes: PaletteRow[]; objects: ObjectRow[];
  }>;
};

const hex2 = (value: number): string => value.toString(16).padStart(2, "0");
const SAMPLE_COUNT = 48;

function summarizeObject(object: IgsObject): [number, number, number, number, number, number, string, number[]] {
  const total = object.width * object.height;
  const indices = object.indices;
  const bins = Array<number>(16).fill(0);
  let firstNonZero = -1, lastNonZero = -1;
  for (let i = 0; i < total; i++) {
    const value = indices[i]!;
    bins[value >> 4]!++;
    if (value) {
      if (firstNonZero < 0) firstNonZero = i;
      lastNonZero = i;
    }
  }
  let samples = "";
  for (let k = 0; k < SAMPLE_COUNT; k++) samples += hex2(indices[Math.floor(k * (total - 1) / (SAMPLE_COUNT - 1))]!);
  return [object.id, object.version, object.width, object.height, firstNonZero, lastNonZero, samples, bins];
}

function summarizePalette(palette: IgsPalette): PaletteRow {
  let hex = "";
  for (let index = 0; index < 256; index++) {
    const entry = palette.entries.get(index);
    hex += hex2(entry?.y ?? 0) + hex2(entry?.cr ?? 0) + hex2(entry?.cb ?? 0) + hex2(entry?.alpha ?? 0);
  }
  return [palette.id, palette.version, hex];
}

function summarizeButton(button: IgsPage["buttons"][number]): ButtonRow {
  return [
    button.id, button.numericSelectValue, button.autoAction ? 1 : 0, button.x, button.y,
    button.neighbors.up, button.neighbors.down, button.neighbors.left, button.neighbors.right,
    button.visuals.normal.startObjectId, button.visuals.normal.endObjectId, button.visuals.normal.repeat ? 1 : 0,
    button.visuals.selected.startObjectId, button.visuals.selected.endObjectId,
    button.visuals.selected.repeat ? 1 : 0, button.visuals.selected.soundId,
    button.visuals.activated.startObjectId, button.visuals.activated.endObjectId,
    button.visuals.activated.soundId, button.commands.length,
  ];
}

function summarizeEffects(sequence: IgsPage["effects"]["enter"]): EffectSequenceRow {
  return [sequence.windows.length, sequence.effects.length, sequence.effects.map((effect) => [
    effect.duration90k, effect.paletteId, effect.objects.length,
    effect.objects.map((object) => [
      object.objectId, object.windowId, object.forcedOn ? 1 : 0, object.x, object.y,
      object.crop ? 1 : 0, object.crop?.x ?? 0, object.crop?.y ?? 0,
      object.crop?.width ?? 0, object.crop?.height ?? 0,
    ]),
  ] as EffectRow)];
}

function summarizePage(page: IgsPage): PageRow {
  const bogs: BogRow[] = [];
  let cursor = 0;
  for (const bog of page.bogs) {
    bogs.push([bog.defaultButtonId, bog.buttonIds.length,
      page.buttons.slice(cursor, cursor + bog.buttonIds.length).map(summarizeButton)]);
    cursor += bog.buttonIds.length;
  }
  return [
    page.id, page.version, page.paletteId, page.defaultSelectedButtonId,
    page.defaultActivatedButtonId, page.animationFrameRateCode,
    summarizeEffects(page.effects.enter), summarizeEffects(page.effects.exit),
    page.bogs.length, bogs,
  ];
}

function summarizeScene(scene: IgsScene): Pick<IcsRow, "width" | "height" | "frameRate" | "number" | "state" | "streamModel" | "uiModel" | "timeouts" | "pages"> {
  return {
    width: scene.width, height: scene.height, frameRate: scene.frameRateCode,
    number: scene.compositionNumber, state: scene.compositionState,
    streamModel: scene.streamModel, uiModel: scene.uiModel,
    timeouts: [
      Number(scene.compositionTimeout90k ?? 0), Number(scene.selectionTimeout90k ?? 0), scene.userTimeoutDuration,
    ],
    pages: scene.pages.map(summarizePage),
  };
}

describe("libbluray 1.5.0 IG decoder baseline", () => {
  it("keeps the complete eight-clip decoder baseline in the repository", async () => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as Golden;
    expect(golden.reference).toMatchObject({
      tool: "VideoLAN libbluray", version: "1.5.0",
      revision: "d75c88e54c893e5cbf4c61d356477655eb435769",
    });
    expect(golden.cases).toHaveLength(8);
    expect(golden.cases.reduce((total, entry) => total + entry.objects.length, 0)).toBe(872);
    expect(golden.cases.every((entry) => entry.displaySet.complete === 1)).toBe(true);
    expect(golden.cases.filter((entry) => entry.displaySet.epochStart === 1)).toHaveLength(7);
  });

  it("covers exactly the same object ids as the independent igstools RGBA reference", async () => {
    const libbluray = JSON.parse(await readFile(goldenPath, "utf8")) as Golden;
    const igstools = JSON.parse(await readFile(
      resolve(repositoryRoot, "test-data/baselines/igs-reference-element-summary.json"), "utf8")) as {
      cases: Array<{ case: string; clip: string; assets: Array<[string]> }>;
    };
    const pixelAssets = new Map(igstools.cases.map((entry) => [`${entry.case}/${entry.clip}`, entry.assets]));
    for (const entry of libbluray.cases) {
      const assets = pixelAssets.get(`${entry.case}/${entry.clip}`);
      expect(assets, `${entry.case}/${entry.clip} igstools reference`).toBeDefined();
      const decoded = entry.objects.map((row) => `o${row[0]}v${row[1]}`).sort();
      const rendered = [...new Set(assets!.map((row) => {
        const match = /-o(\d+)v(\d+)-/.exec(row[0]);
        expect(match, `${entry.case}/${entry.clip} asset id ${row[0]}`).not.toBeNull();
        return `o${match![1]}v${match![2]}`;
      }))].sort();
      expect(rendered, `${entry.case}/${entry.clip} libbluray and igstools element sets`).toEqual(decoded);
    }
  });

  it.each([
    ["bang-dream-mygo-vol1", "00010", 0x1400],
    ["bang-dream-mygo-vol1", "00011", 0x1400], ["battle-royale-uhd", "00002", 0x1400],
    ["battle-royale-uhd", "00005", 0x1400], ["kyoani-ova", "00005", 0x1400],
    ["synthetic-igs-parser", "00001", 0x120], ["tamako", "00005", 0x1400],
    ["tamako", "00043", 0x1400],
  ] as const)("matches libbluray's decoded display set for %s/%s", async (caseId, clipId, pid) => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as Golden;
    const expected = golden.cases.find((entry) => entry.case === caseId && entry.clip === clipId);
    expect(expected, `missing libbluray decoder baseline for ${caseId}/${clipId}`).toBeDefined();
    const source = caseId === "synthetic-igs-parser"
      ? resolve(repositoryRoot, "test-data/fixtures/igs-parser/synthetic-single-object.m2ts")
      : resolve(fixtureRoot, caseId, "BDMV", "STREAM", `${clipId}.m2ts_ig-packets.bin`);
    const bytes = await readFile(source);
    const result = await extractIgsFromChunks(clipId, chunks(bytes, 4093), [{
      pid, source: { path: `BDMV/CLIPINF/${clipId}.clpi`, origin: "primary", offset: "0" },
    }]);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.scenes).toHaveLength(1);
    const scene = result.scenes[0]!;

    expect({ complete: scene.complete, epochStart: scene.compositionState === 2 ? 1 : 0,
      numPalette: scene.palettes.length, numObject: scene.objects.length },
    `${caseId}/${clipId} display set`).toEqual({
      complete: true, epochStart: expected!.displaySet.epochStart,
      numPalette: expected!.displaySet.numPalette, numObject: expected!.displaySet.numObject,
    });
    expect(expected!.displaySet.complete, `${caseId}/${clipId} complete display set`).toBe(1);
    expect(expected!.displaySet.numWindow, `${caseId}/${clipId} window segments`).toBe(0);
    expect(summarizeScene(scene), `${caseId}/${clipId} interactive composition`).toEqual(expected!.ics);

    const palettesById = new Map(scene.palettes.map((palette) => [`${palette.id}/${palette.version}`, summarizePalette(palette)]));
    expect(scene.palettes.map((palette) => `${palette.id}/${palette.version}`).sort(), `${caseId}/${clipId} palette ids`)
      .toEqual(expected!.palettes.map((row) => `${row[0]}/${row[1]}`).sort());
    for (const row of expected!.palettes) {
      expect(palettesById.get(`${row[0]}/${row[1]}`), `${caseId}/${clipId} palette ${row[0]}/${row[1]}`).toEqual(row);
    }

    const objectsById = new Map(scene.objects.map((object) => [`${object.id}/${object.version}`, summarizeObject(object)]));
    expect(objectsById.size, `${caseId}/${clipId} object ids`).toBe(expected!.objects.length);
    for (const row of expected!.objects) {
      const actual = objectsById.get(`${row[0]}/${row[1]}`);
      expect(actual, `${caseId}/${clipId} object ${row[0]}/${row[1]} RLE pixels`).toEqual([
        row[0], row[1], row[2], row[3], row[6], row[7], row[8], row[9],
      ]);
    }
  }, 120_000);
});
