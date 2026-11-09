import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { toPortablePath } from "./fixture-input.mjs";

const moduleAt = (root, path) => import(pathToFileURL(resolve(root, path)).href);

async function* chunks(file, chunkBytes = 256 * 1024) {
  for await (const bytes of createReadStream(file, { highWaterMark: chunkBytes })) yield new Uint8Array(bytes);
}

export async function prepareIgsInput(root, options) {
  const { extractIgsFromChunks } = await moduleAt(root, "packages/igs/dist/index.js");
  const file = resolve(root, options.file);
  let extraction;
  const sourceType = typeof options.source === "string" ? options.source : options.source?.type;
  if (sourceType === "ig-packets") {
    extraction = await extractIgsFromChunks(options.clipId, chunks(file, options.chunkBytes ?? 256 * 1024), [{
      pid: options.pid,
      source: { path: options.source?.remotePath ?? options.file, origin: "primary", offset: "0" },
    }], { captureStreams: true });
  } else {
    const { parseIgsMnu } = await moduleAt(root, "packages/igs/dist/mnu.js");
    extraction = parseIgsMnu(new Uint8Array(await readFile(file)), { clipId: options.clipId, pid: options.pid });
  }
  if (extraction.scenes.length !== 1) throw new Error(`IGS fixture ${options.fixtureId ?? options.clipId} produced ${extraction.scenes.length} scenes`);
  const scene = extraction.scenes[0];
  if (!scene.complete) throw new Error(`IGS fixture ${options.fixtureId ?? options.clipId} is incomplete`);
  const { adaptIgsScene } = await moduleAt(root, "packages/runtime-web/dist/index.js");
  const adapted = adaptIgsScene(scene, extraction.assets);
  if (adapted.status !== "complete" && adapted.status !== "partial") throw new Error(`IGS fixture ${options.fixtureId ?? options.clipId} adaptation is ${adapted.status}`);
  const graphics = extraction.assets.map((asset) => ({ id: asset.id, bytes: asset.pngBytes }));
  const expected = {
    scenes: extraction.scenes.length,
    width: scene.width,
    height: scene.height,
    pages: scene.pages.length,
    objects: scene.objects.length,
    palettes: scene.palettes.length,
    assets: extraction.assets.length,
    pixels: extraction.assets.reduce((sum, asset) => sum + asset.width * asset.height, 0),
    pngBytes: extraction.assets.reduce((sum, asset) => sum + asset.pngBytes.byteLength, 0),
    diagnostics: extraction.diagnostics.length,
    adaptationStatus: adapted.status,
    adaptationDiagnostics: adapted.diagnostics.length,
  };
  return { scene: adapted.scene, graphics, expected, input: { file: toPortablePath(root, file), clipId: options.clipId, pid: options.pid, bytes: (await stat(file)).size, chunkBytes: options.chunkBytes }, extraction };
}

export async function assembleIgsMenuPackage(root, outputDirectory, prepared, packageOptions = {}) {
  const { buildMenuPackage } = await moduleAt(root, "packages/package-builder/dist/index.js");
  const result = await buildMenuPackage({
    outputDirectory, title: "Prepared IGS performance menu",
    ir: { schemaVersion: "1.0", entries: [], programs: [], menus: [], playlists: [], mediaAssets: [], diagnostics: [] },
    scene: prepared.scene, graphics: prepared.graphics,
    status: "partial", runtimeVersion: "0.1.0",
    diagnostics: [{ code: "BENCH_PREPARED_IGS", message: "Package assembled from a complete filtered IGS fixture." }],
    ...packageOptions,
  });
  return result;
}
