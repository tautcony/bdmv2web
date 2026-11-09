import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createProgram, exitWithError, parseOptions } from "./cli.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function createPrepareCommand() {
  return createProgram("prepare-igs-fixture", "Write the complete IGS packet stream fixture for one MNU case.")
    .argument("[caseId]", "MNU fixture case ID", "perf.igs.battle-royale.parse");
}

async function main() {
  const command = createPrepareCommand();
  parseOptions(command, process.argv.slice(2));
  const caseId = command.args[0] ?? "perf.igs.battle-royale.parse";
  const manifestPath = resolve(root, "test-data/fixtures/perf/manifest.json");
  const manifestRoot = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const definition = manifest.cases.find((item) => item.caseId === caseId);
  if (!definition || definition.category !== "mnu") throw new Error(`Unknown MNU fixture case ID: ${caseId}`);
  const fixturePath = (path) => resolve(path.startsWith("test-data/fixtures/perf/") ? root : manifestRoot, path);
  const packetsPath = fixturePath(definition.source?.packetPath ?? (definition.input.path.endsWith(".mnu") ? definition.input.path.replace(/\.mnu$/, ".bin") : definition.input.path));
  const mnuPath = fixturePath(definition.source?.mnuPath ?? (definition.input.path.endsWith(".mnu") ? definition.input.path : definition.input.path.replace(/\.bin$/, ".mnu")));
  const clipId = definition.source?.clipId ?? definition.fixture.parameters.clipId;
  const pidValue = definition.source?.pid ?? definition.fixture.parameters.pid;
  const pid = typeof pidValue === "string" ? Number(pidValue) : pidValue;
  const expected = definition.expected?.details ?? definition.expected;
  const [{ extractIgsFromChunks }, { parseIgsMnu }] = await Promise.all([
    import(pathToFileURL(resolve(root, "packages/igs/dist/extract.js")).href),
    import(pathToFileURL(resolve(root, "packages/igs/dist/mnu.js")).href),
  ]);
  const source = new Uint8Array(await readFile(packetsPath));
  async function* chunks() {
    for (let offset = 0; offset < source.length; offset += 256 * 1024) yield source.subarray(offset, Math.min(source.length, offset + 256 * 1024));
  }
  const extracted = await extractIgsFromChunks(clipId, chunks(), [{
    pid,
    source: { path: definition.source?.remotePath ?? definition.source?.extraction ?? definition.input.path, origin: "primary", offset: "0" },
  }], { captureStreams: true, renderAssets: false });
  const stream = extracted.streams.find((item) => item.pid === pid)?.bytes;
  if (!stream) throw new Error(`Filtered IGS packets did not produce an MNU stream for PID ${pid}`);
  const parsed = parseIgsMnu(stream, { clipId, pid, renderAssets: false });
  const actual = {
    scenes: parsed.scenes.length,
    completeScenes: parsed.scenes.filter((scene) => scene.complete).length,
    pages: parsed.scenes.reduce((sum, scene) => sum + scene.pages.length, 0),
    objects: parsed.scenes.reduce((sum, scene) => sum + scene.objects.length, 0),
    palettes: parsed.scenes.reduce((sum, scene) => sum + scene.palettes.length, 0),
    diagnostics: parsed.diagnostics.length,
    mnuBytes: stream.byteLength,
  };
  for (const key of ["scenes", "pages", "objects", "palettes"]) {
    if (expected[key] !== undefined && actual[key] !== expected[key]) throw new Error(`IGS fixture ${key} count ${actual[key]} does not match manifest value ${expected[key]}`);
  }
  if (actual.completeScenes !== actual.scenes || actual.diagnostics !== 0) throw new Error(`IGS fixture is incomplete: ${JSON.stringify(actual)}`);
  await mkdir(dirname(mnuPath), { recursive: true });
  await writeFile(mnuPath, stream, { flag: "w" });
  process.stdout.write(`${JSON.stringify({ status: "complete", packetsPath, packetBytes: source.byteLength, mnuPath, ...actual })}\n`);
}

main().catch((error) => exitWithError(error, 1, { stack: true }));
