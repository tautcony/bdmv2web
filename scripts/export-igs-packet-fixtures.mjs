#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractIgsFromChunks } from "../packages/igs/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(process.argv[2] ?? join(repositoryRoot, "test-data/fixtures/hdmv-navigation/disc-data"));
const outputRoot = resolve(process.argv[3] ?? "");
if (process.argv.length !== 4) {
  console.error("Usage: node scripts/export-igs-packet-fixtures.mjs FIXTURE_ROOT OUTPUT_ROOT");
  process.exit(2);
}

async function* chunks(path) {
  for await (const chunk of createReadStream(path, { highWaterMark: 4093 })) yield new Uint8Array(chunk);
}

async function* packetFixtureFiles(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* packetFixtureFiles(path);
    else if (entry.isFile() && /^\d{5}\.m2ts_ig-packets\.bin$/.test(entry.name)) yield path;
  }
}

const inputs = [];
for await (const path of packetFixtureFiles(fixtureRoot)) {
  const relativePath = relative(fixtureRoot, path).split("\\").join("/");
  const [caseId, , , filename] = relativePath.split("/");
  inputs.push({ caseId, clipId: filename.slice(0, 5), pid: 0x1400, path, displayPath: relative(repositoryRoot, path).split("\\").join("/") });
}
const syntheticPath = join(repositoryRoot, "test-data/fixtures/igs-parser/synthetic-single-object.m2ts");
inputs.push({ caseId: "synthetic-igs-parser", clipId: "00001", pid: 0x120, path: syntheticPath, displayPath: relative(repositoryRoot, syntheticPath).split("\\").join("/") });
inputs.sort((left, right) => left.caseId.localeCompare(right.caseId) || left.clipId.localeCompare(right.clipId));
if (inputs.length === 0) throw new Error(`No IGS packet fixtures under ${fixtureRoot}`);

for (const input of inputs) {
  const { caseId, clipId, pid, path: inputPath, displayPath } = input;
  const outputDir = join(outputRoot, caseId, clipId);
  const result = await extractIgsFromChunks(clipId, chunks(inputPath), [{
    pid,
    source: { path: `BDMV/CLIPINF/${clipId}.clpi`, origin: "primary", offset: "0" },
  }]);
  if (result.scenes.length !== 1) throw new Error(`${caseId}/${clipId}: expected one scene, got ${result.scenes.length}`);
  const scene = result.scenes[0];
  const assets = [];
  for (const asset of result.assets) {
    await mkdir(dirname(join(outputDir, asset.relativePath)), { recursive: true });
    await writeFile(join(outputDir, asset.relativePath), asset.pngBytes);
    const pageMatch = /-p(\d+)-o/.exec(asset.id);
    if (!pageMatch) throw new Error(`Cannot read page id from asset ${asset.id}`);
    assets.push({
      assetId: asset.id,
      pageId: Number(pageMatch[1]),
      path: asset.relativePath,
      objectId: asset.objectId,
      objectVersion: asset.objectVersion,
      paletteId: asset.paletteId,
      paletteVersion: asset.paletteVersion,
      width: asset.width,
      height: asset.height,
      colorConversion: asset.colorConversion,
    });
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "source-map.json"), `${JSON.stringify({ assets }, null, 2)}\n`);
  await writeFile(join(outputDir, "project-extraction.json"), `${JSON.stringify({
    input: displayPath,
    status: result.status,
    support: result.support.status,
    scene: {
      id: scene.id,
      complete: scene.complete,
      width: scene.width,
      height: scene.height,
      pages: scene.pages.length,
      objects: scene.objects.length,
      palettes: scene.palettes.length,
    },
    diagnostics: result.diagnostics,
  }, null, 2)}\n`);
  console.log(`${caseId}/${clipId}: ${assets.length} project assets`);
}
