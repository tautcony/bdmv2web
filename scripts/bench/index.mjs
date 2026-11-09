#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const parser = await import(pathToFileURL(join(root, "packages/bdmv-parser/dist/index.js")));
const io = await import(pathToFileURL(join(root, "packages/bdmv-io/dist/index.js")));
const igs = await import(pathToFileURL(join(root, "packages/igs/dist/transport.js")));
const igsExtract = await import(pathToFileURL(join(root, "packages/igs/dist/extract.js")));
const results = [];

function put16(bytes, offset, value) { bytes[offset] = value >>> 8; bytes[offset + 1] = value; }
function put32(bytes, offset, value) { bytes[offset] = value >>> 24; bytes[offset + 1] = value >>> 16; bytes[offset + 2] = value >>> 8; bytes[offset + 3] = value; }
function text(bytes, offset, value) { for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index); }

function indexBytes(size = 118) {
  const bytes = Buffer.alloc(size);
  text(bytes, 0, "INDX"); text(bytes, 4, "0100"); put32(bytes, 8, 88); put32(bytes, 40, 34);
  put32(bytes, 88, 26);
  bytes[92] = 0x40; bytes[96] = 0x40; put16(bytes, 98, 0);
  bytes[104] = 0x40; bytes[108] = 0x40; put16(bytes, 110, 1);
  put16(bytes, 116, 0);
  return bytes;
}

function emptyMovieObject() {
  const bytes = Buffer.alloc(54);
  text(bytes, 0, "MOBJ"); text(bytes, 4, "0100"); put32(bytes, 40, 10); put16(bytes, 48, 0);
  return bytes;
}

function playlistBytes(itemCount) {
  const listLength = 6 + itemCount * 50;
  const markPosition = 84 + listLength;
  const bytes = Buffer.alloc(markPosition + 10);
  text(bytes, 0, "MPLS"); text(bytes, 4, "0200"); put32(bytes, 8, 80); put32(bytes, 12, markPosition);
  put32(bytes, 40, 13); bytes[45] = 1;
  put32(bytes, 80, listLength); put16(bytes, 86, itemCount); put16(bytes, 88, 0);
  let offset = 90;
  for (let index = 0; index < itemCount; index++) {
    put16(bytes, offset, 48); text(bytes, offset + 2, "00001"); text(bytes, offset + 7, "M2TS");
    put16(bytes, offset + 11, 1); put32(bytes, offset + 14, 0); put32(bytes, offset + 18, 90_000);
    put16(bytes, offset + 34, 14);
    offset += 50;
  }
  put32(bytes, markPosition, 6); put16(bytes, markPosition + 6, 0);
  return bytes;
}

async function makeDisc({ itemCount = 0, indexSize = 118, backupIndex = false } = {}) {
  const parent = await mkdtemp(join(tmpdir(), "bdmv-bench-disc-"));
  const bdmv = join(parent, "BDMV");
  await mkdir(join(bdmv, "PLAYLIST"), { recursive: true });
  await mkdir(join(bdmv, "CLIPINF"), { recursive: true });
  await mkdir(join(bdmv, "STREAM"), { recursive: true });
  await writeFile(join(bdmv, "index.bdmv"), indexBytes(indexSize));
  await writeFile(join(bdmv, "MovieObject.bdmv"), emptyMovieObject());
  if (backupIndex) {
    await mkdir(join(bdmv, "BACKUP"), { recursive: true });
    const backup = indexBytes(indexSize); backup[backup.length - 1] = 1;
    await writeFile(join(bdmv, "BACKUP", "index.bdmv"), backup);
  }
  if (itemCount) await writeFile(join(bdmv, "PLAYLIST", "00001.mpls"), playlistBytes(itemCount));
  return { parent, bdmv };
}

async function sample(name, n, operation, repeats = 3) {
  for (let repeat = 0; repeat < repeats; repeat++) {
    const started = performance.now();
    await operation();
    results.push({ case: name, n, ms: Number((performance.now() - started).toFixed(3)), rss: process.memoryUsage().rss });
  }
}

async function directoryBytes(directory, includeFile = () => true) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(path, includeFile);
    else if (entry.isFile() && includeFile(entry.name)) total += (await stat(path)).size;
  }
  return total;
}

async function metadataBytes(directory) {
  return directoryBytes(directory, (name) => /\.(?:bdmv|mpls|clpi)$/i.test(name));
}

async function* readChunks(path) {
  for await (const chunk of createReadStream(path, { highWaterMark: 4093 })) yield new Uint8Array(chunk);
}

const realDiscs = [
  { id: "bang-dream-mygo-vol1", playlists: 4, movieObjects: 4 },
  { id: "battle-royale-uhd", playlists: 22, movieObjects: 24 },
  { id: "kyoani-ova", playlists: 5, movieObjects: 5 },
  { id: "tamako", playlists: 26, movieObjects: 17 },
];
const realDiscRoot = join(root, "test-data/fixtures/hdmv-navigation/disc-data");
for (const fixture of realDiscs) {
  const bdmv = join(realDiscRoot, fixture.id, "BDMV");
  const inputBytes = await metadataBytes(bdmv);
  await sample(`parseBdmv-real/${fixture.id}`, inputBytes, async () => {
    const parsed = await parser.parseBdmv(bdmv);
    if (parsed.playlists.length !== fixture.playlists || parsed.movieObjects.length !== fixture.movieObjects) {
      throw new Error(`Unexpected ${fixture.id} parse result: ${parsed.playlists.length} playlists, ${parsed.movieObjects.length} MovieObjects`);
    }
  });
}

const libblurayCommands = [
  { name: "bd_info", command: "bd_info", args: (discRoot) => [discRoot] },
  { name: "bd_list_titles", command: "bd_list_titles", args: (discRoot) => ["-a", discRoot] },
];
let libblurayCommandsAvailable = true;
try {
  const probeRoot = join(realDiscRoot, realDiscs[0].id);
  for (const reference of libblurayCommands) execFileSync(reference.command, reference.args(probeRoot), { cwd: root, stdio: "ignore" });
} catch (error) {
  if (error?.code === "ENOENT") libblurayCommandsAvailable = false;
  else throw error;
}
if (libblurayCommandsAvailable) {
  for (const fixture of realDiscs) {
    const discRoot = join(realDiscRoot, fixture.id);
    const inputBytes = await metadataBytes(join(discRoot, "BDMV"));
    for (const reference of libblurayCommands) {
      await sample(`libbluray/${reference.name}/${fixture.id}`, inputBytes, () => {
        const output = execFileSync(reference.command, reference.args(discRoot), { cwd: root, encoding: "utf8" });
        if (!output.trim()) throw new Error(`${reference.command} produced no output for ${fixture.id}`);
      });
    }
  }
} else process.stderr.write("Skipping libbluray command timings: bd_info or bd_list_titles is unavailable.\n");

const realIgsFixtures = [
  { disc: "bang-dream-mygo-vol1", clip: "00010", pages: 7, objects: 182, palettes: 6, assets: 0, renderAssets: false },
  { disc: "bang-dream-mygo-vol1", clip: "00011", pages: 2, objects: 51, palettes: 1, assets: 0, renderAssets: false },
  { disc: "battle-royale-uhd", clip: "00002", pages: 21, objects: 215, palettes: 21, assets: 0, renderAssets: false },
  { disc: "battle-royale-uhd", clip: "00005", pages: 4, objects: 55, palettes: 4, assets: 68, renderAssets: true },
  { disc: "battle-royale-uhd", clip: "00005", pages: 4, objects: 55, palettes: 4, assets: 0, renderAssets: false },
  { disc: "kyoani-ova", clip: "00005", pages: 4, objects: 32, palettes: 4, assets: 0, renderAssets: false },
  { disc: "tamako", clip: "00005", pages: 7, objects: 168, palettes: 7, assets: 168, renderAssets: true },
  { disc: "tamako", clip: "00005", pages: 7, objects: 168, palettes: 7, assets: 0, renderAssets: false },
  { disc: "tamako", clip: "00043", pages: 7, objects: 168, palettes: 7, assets: 0, renderAssets: false },
];
for (const fixture of realIgsFixtures) {
  const clipPath = join(realDiscRoot, fixture.disc, "BDMV", "STREAM", `${fixture.clip}.m2ts_ig-packets.bin`);
  const inputBytes = (await stat(clipPath)).size;
  const outputMode = fixture.renderAssets ? "png" : "mnu";
  await sample(`extractIgs-export-real/${fixture.disc}/${fixture.clip}/${outputMode}`, inputBytes, async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv-bench-real-export-"));
    const output = join(parent, "out");
    try {
      await mkdir(output, { recursive: true });
      const result = await igsExtract.extractIgsFromChunks(fixture.clip, readChunks(clipPath), [{
        pid: 0x1400,
        source: { path: `BDMV/CLIPINF/${fixture.clip}.clpi`, origin: "primary", offset: "0" },
      }], { renderAssets: fixture.renderAssets, captureStreams: true });
      const scene = result.scenes[0];
      const stream = result.streams.find((item) => item.pid === 0x1400);
      if (result.status !== "complete" || result.scenes.length !== 1 || !scene?.complete || !stream?.bytes) {
        throw new Error(`Unexpected ${fixture.disc}/${fixture.clip} extraction result: ${result.status}, ${result.scenes.length} scenes`);
      }
      if (scene.pages.length !== fixture.pages || scene.objects.length !== fixture.objects || scene.palettes.length !== fixture.palettes || result.assets.length !== fixture.assets) {
        throw new Error(`Unexpected ${fixture.disc}/${fixture.clip} scene or asset counts`);
      }
      const mnuPath = join(output, `assets/igs/${fixture.clip}-pid-1400.mnu`);
      await mkdir(dirname(mnuPath), { recursive: true });
      await writeFile(mnuPath, stream.bytes);
      for (const asset of result.assets) {
        const target = join(output, asset.relativePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, asset.pngBytes);
      }
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
}

const syntheticBdmv = join(root, "test-data/fixtures/synthetic-all-features/BDMV");
const syntheticInputBytes = await directoryBytes(syntheticBdmv);
await sample("extractIgs-export-synthetic-all-features", syntheticInputBytes, async () => {
  const parent = await mkdtemp(join(tmpdir(), "bdmv-bench-synthetic-export-"));
  const output = join(parent, "out");
  try {
    await mkdir(output, { recursive: true });
    const parsed = await parser.parseBdmv(syntheticBdmv);
    const result = await igsExtract.extractIgsScenes(parsed, { captureStreams: true });
    if (result.status !== "complete" || parsed.playlists.length !== 3 || result.scenes.length !== 2 || result.assets.length !== 3 || result.streams.length !== 2) {
      throw new Error(`Unexpected synthetic-all-features extraction result: ${result.status}, ${result.scenes.length} scenes, ${result.assets.length} assets, ${result.streams.length} streams`);
    }
    for (const stream of result.streams) {
      if (!stream.bytes) throw new Error(`Missing captured MNU bytes for ${stream.clipId} PID ${stream.pid}`);
      const mnuPath = join(output, `assets/igs/${stream.clipId}-pid-${stream.pid.toString(16).padStart(4, "0")}.mnu`);
      await mkdir(dirname(mnuPath), { recursive: true });
      await writeFile(mnuPath, stream.bytes);
    }
    for (const asset of result.assets) {
      const target = join(output, asset.relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, asset.pngBytes);
    }
  } finally { await rm(parent, { recursive: true, force: true }); }
});

for (const count of [200, 1000, 5000]) {
  const disc = await makeDisc({ itemCount: count });
  try {
    await sample("buildGraph", count, async () => {
      const parsed = await parser.parseBdmv(disc.bdmv);
      if (parsed.playlists[0]?.playItems.length !== count) throw new Error(`Expected ${count} PlayItems`);
    });
  } finally { await rm(disc.parent, { recursive: true, force: true }); }
}

for (const packetCount of [1000, 10_000, 50_000]) {
  await sample("PesAssembler.append", packetCount, () => {
    const assembler = new igs.PesAssembler("00001");
    const payload = new Uint8Array(184).fill(0x55);
    payload.set([0, 0, 1, 0xbd, 0, 0, 0x80, 0, 0]);
    for (let index = 0; index < packetCount; index++) {
      assembler.push({ packetOffset: BigInt(index * 192), payloadOffset: 4, pid: 0x101, payloadUnitStart: index === 0, continuityCounter: index & 15, hasPayload: true, discontinuity: false, transportError: false, continuityError: false, payload });
    }
    const completed = assembler.end();
    if (completed.length !== 1 || completed[0]?.payload.length !== packetCount * 184 - 9) throw new Error(`Unexpected PES result for ${packetCount} packets`);
  });
}

const indexSize = 8 * 1024 * 1024;
const duplicateIndexDisc = await makeDisc({ indexSize, backupIndex: true });
try {
  await sample("choose-primary-backup", indexSize, async () => { await parser.parseBdmv(duplicateIndexDisc.bdmv); });
} finally { await rm(duplicateIndexDisc.parent, { recursive: true, force: true }); }

const tableRoot = await mkdtemp(join(tmpdir(), "bdmv-bench-file-table-"));
const paths = Array.from({ length: 1000 }, (_, index) => `file-${index}.bin`);
for (const path of paths) await writeFile(join(tableRoot, path), "x");
try {
  await sample("buildInputFileTable-repeated-root", 1000, async () => {
    await io.canonicalDirectory(tableRoot);
    for (const path of paths) await io.resolveInputFile(tableRoot, path);
  });
  await sample("buildInputFileTable-single-root", 1000, async () => {
    const table = await io.buildInputFileTable(tableRoot, paths);
    if (table.files.size !== 1000) throw new Error(`Expected 1000 paths, received ${table.files.size}`);
  });
} finally { await rm(tableRoot, { recursive: true, force: true }); }

const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const outputDirectory = join(root, "test-data", "bench");
await mkdir(outputDirectory, { recursive: true });
const outputPath = join(outputDirectory, `${revision}.json`);
await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, samples: results.length }, null, 2)}\n`);
