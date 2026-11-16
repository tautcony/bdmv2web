import { describe, expect, it } from "vitest";
import {
  buildM1ClipInfoProgramAndCpi,
  buildM1ClipInfoWithSequence,
  buildM1Index,
  buildM1MovieObject,
  buildM1PlaylistGolden,
  buildM1PlaylistWithMultiClipSubPlayItem,
  buildM1SoundTwoRanges,
} from "@bdmv2web/test-fixtures";
import { parseClpi, parseIndex, parseMobj, parseMpls, parseSound } from "./parser.js";
import type { FileEntry } from "./source-location.js";

const SEED = 0x5eed_c0de;
const REPLAYS_PER_MUTATION = 8;
const MUTATION_KINDS = ["length", "count", "offset", "truncation", "randomBytes"] as const;
type MutationKind = (typeof MUTATION_KINDS)[number];

interface MutationTarget {
  format: "INDEX" | "MOBJ" | "MPLS" | "CLPI" | "BCLK";
  filename: string;
  makeFixture(): Uint8Array;
  lengthOffset: number;
  countOffset: number;
  countWidth: 1 | 2;
  sectionOffset: number;
  parse(bytes: Uint8Array, file: FileEntry): unknown;
}

const targets: readonly MutationTarget[] = [
  {
    format: "INDEX",
    filename: "index.bdmv",
    makeFixture: () => buildM1Index({ hdmvTitle: 1, bdjTitle: "00042", uhd: { discType: 5, exists4k: true } }),
    lengthOffset: 88,
    countOffset: 116,
    countWidth: 2,
    sectionOffset: 8,
    parse: (bytes, file) => parseIndex(bytes, file, "primary"),
  },
  {
    format: "MOBJ",
    filename: "MovieObject.bdmv",
    makeFixture: () => buildM1MovieObject(),
    lengthOffset: 40,
    countOffset: 48,
    countWidth: 2,
    sectionOffset: 8,
    parse: (bytes, file) => parseMobj(bytes, file, "primary"),
  },
  {
    format: "MPLS",
    filename: "PLAYLIST/00001.mpls",
    makeFixture: () => buildM1PlaylistGolden(),
    lengthOffset: 80,
    countOffset: 86,
    countWidth: 2,
    sectionOffset: 8,
    parse: (bytes, file) => parseMpls(bytes, file, "primary"),
  },
  {
    format: "CLPI",
    filename: "CLIPINF/00001.clpi",
    makeFixture: () => buildM1ClipInfoProgramAndCpi(),
    lengthOffset: 60,
    countOffset: 72,
    countWidth: 1,
    sectionOffset: 12,
    parse: (bytes, file) => parseClpi(bytes, file, "primary"),
  },
  {
    format: "BCLK",
    filename: "AUXDATA/sound.bdmv",
    makeFixture: () => buildM1SoundTwoRanges(),
    lengthOffset: 40,
    countOffset: 45,
    countWidth: 1,
    sectionOffset: 8,
    parse: (bytes, file) => parseSound(bytes, file, bytes.length),
  },
];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function writeU8(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, false);
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, false);
}

function mutate(target: MutationTarget, kind: MutationKind, random: () => number): Uint8Array {
  const bytes = target.makeFixture().slice();
  if (kind === "length") {
    writeU32(bytes, target.lengthOffset, bytes.length + 1 + (random() % 256));
  } else if (kind === "count") {
    const count = 32 + (random() % 224);
    if (target.countWidth === 1) writeU8(bytes, target.countOffset, count);
    else writeU16(bytes, target.countOffset, count);
  } else if (kind === "offset") {
    writeU32(bytes, target.sectionOffset, bytes.length + 1 + (random() % 256));
  } else if (kind === "truncation") {
    return bytes.slice(0, random() % bytes.length);
  } else {
    const pos = 8 + (random() % Math.max(1, bytes.length - 8));
    writeU32(bytes, Math.min(pos, bytes.length - 4), random());
  }
  return bytes;
}

function isParserContractError(error: unknown): boolean {
  return error instanceof Error
    && error.name === "ContractError"
    && "code" in error
    && typeof error.code === "string";
}

function replay(target: MutationTarget, kind: MutationKind, iteration: number, random: () => number): void {
  const bytes = mutate(target, kind, random);
  const file: FileEntry = {
    rel: `BDMV/${target.filename}`,
    abs: `/seeded-mutation/${target.filename}`,
    size: bytes.length,
  };
  try {
    target.parse(bytes, file);
  } catch (error) {
    if (!isParserContractError(error)) {
      throw new Error(`${target.format} ${kind} mutation ${iteration} failed outside parser diagnostics`, { cause: error });
    }
  }
}

describe("seeded structural mutations and prefix truncation sweeps", () => {
  it("replays 200 seeded length, count, offset, truncation and byte mutations across all five binary parsers", () => {
    const random = seededRandom(SEED);
    let replayCount = 0;
    for (const target of targets) {
      for (const kind of MUTATION_KINDS) {
        for (let iteration = 0; iteration < REPLAYS_PER_MUTATION; iteration += 1) {
          replay(target, kind, iteration, random);
          replayCount += 1;
        }
      }
    }
    expect(replayCount).toBe(targets.length * MUTATION_KINDS.length * REPLAYS_PER_MUTATION);
  });

  it("sweeps every byte prefix of INDEX, MOBJ, MPLS, CLPI and sound.bdmv fixtures without unhandled exceptions", () => {
    const sweepCases: Array<{ label: string; filename: string; bytes: Uint8Array; parse(bytes: Uint8Array, file: FileEntry): unknown }> = [
      ...targets.map((target) => ({
        label: target.format,
        filename: target.filename,
        bytes: target.makeFixture(),
        parse: (bytes: Uint8Array, file: FileEntry) => target.parse(bytes, file),
      })),
      {
        label: "MPLS-MultiClipSubPlayItem",
        filename: "PLAYLIST/00002.mpls",
        bytes: buildM1PlaylistWithMultiClipSubPlayItem(),
        parse: (bytes, file) => parseMpls(bytes, file, "primary"),
      },
      {
        label: "CLPI-Sequence",
        filename: "CLIPINF/00002.clpi",
        bytes: buildM1ClipInfoWithSequence(),
        parse: (bytes, file) => parseClpi(bytes, file, "primary"),
      },
    ];

    for (const { label, filename, bytes, parse } of sweepCases) {
      for (let len = 0; len < bytes.length; len += 1) {
        const prefix = bytes.subarray(0, len);
        const file: FileEntry = { rel: `BDMV/${filename}`, abs: `/truncation/${filename}`, size: prefix.length };
        try {
          parse(prefix, file);
        } catch (error) {
          if (!isParserContractError(error)) {
            throw new Error(`${label} prefix length ${len} failed outside parser diagnostics`, { cause: error });
          }
        }
      }
      const half = bytes.subarray(0, Math.floor(bytes.length / 2));
      const halfFile: FileEntry = { rel: `BDMV/${filename}`, abs: `/truncation/${filename}`, size: half.length };
      expect(() => parse(half, halfFile)).toThrowError(/BDMV_|TRUNCATED_INPUT/);
    }
  });

  it("retains the minimal regression input for inline PiP-PG ordering before IG and secondary audio/video reference lists", () => {
    // Regression: when secondaryPresentationGraphics (count index 6) and secondaryAudio (count index 4)
    // coexist in one STN table, PiP-PG sits before IG and secondaryAudio in the binary stream.
    const stnEntries = [
      3, 1, 0x12, 0x00, 5, 0x90, 0x65, 0x6e, 0x67, 0, // PG (0x1200)
      3, 1, 0x12, 0x10, 5, 0x90, 0x66, 0x72, 0x61, 0, // PiP-PG (0x1210, inline before IG/secondaryAudio)
      3, 1, 0x13, 0x00, 5, 0x91, 0x64, 0x65, 0x75, 0, // IG (0x1300)
      3, 1, 0x1a, 0x10, 5, 0xa1, 0x31, 0x65, 0x6e, 0x67, 1, 0, 0, 0, // secondaryAudio (0x1a10) + 1 padded ref
    ];
    const stnLen = 14 + stnEntries.length;
    const itemLen = 34 + 2 + stnLen;
    const listLen = 6 + 2 + itemLen;
    const markPos = 80 + 4 + listLen;
    const out = new Uint8Array(markPos + 6);
    const view = new DataView(out.buffer);
    out.set(new TextEncoder().encode("MPLS0200"), 0);
    view.setUint32(8, 80, false); view.setUint32(12, markPos, false);
    view.setUint32(40, 13, false); out[45] = 1;
    view.setUint32(80, listLen, false); view.setUint16(86, 1, false);
    view.setUint16(90, itemLen, false);
    out.set(new TextEncoder().encode("00001M2TS"), 92);
    view.setUint16(101, 1, false); view.setUint32(104, 0, false); view.setUint32(108, 90_000, false);
    view.setUint16(124, stnLen, false);
    out[130] = 1; out[131] = 1; out[132] = 1; out[134] = 1;
    out.set(stnEntries, 140);
    view.setUint32(markPos, 2, false);

    const file: FileEntry = { rel: "BDMV/PLAYLIST/00001.mpls", abs: "/regression/00001.mpls", size: out.length };
    const parsed = parseMpls(out, file, "primary");
    expect(parsed.value.playItems[0]?.streams).toMatchObject([
      { category: "primaryPresentationGraphics", categoryIndex: 0, pid: 0x1200, language: "eng" },
      { category: "secondaryPresentationGraphics", categoryIndex: 0, pid: 0x1210, language: "fra" },
      { category: "primaryInteractiveGraphics", categoryIndex: 0, pid: 0x1300, language: "deu" },
      { category: "secondaryAudio", categoryIndex: 0, pid: 0x1a10, language: "eng", primaryAudioReferences: [0] },
    ]);
  });
});
