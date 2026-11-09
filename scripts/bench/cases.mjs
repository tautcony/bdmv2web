import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getScenarioDefinitions } from "./scenarios.mjs";

const legacy = [
  ["bdmv.index-uhd.parse", "real", "bdmv", "BDMV index parse", "index-uhd", { kind: "index", file: "test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/index.bdmv" }],
  ["bdmv.movieobject-tamako.parse", "real", "bdmv", "BDMV movieObject parse", "movieObject-tamako", { kind: "movieObject", file: "test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/MovieObject.bdmv" }],
  ["bdmv.playlist-tamako.parse", "real", "bdmv", "BDMV playlist parse", "playlist-tamako", { kind: "playlist", file: "test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/PLAYLIST/00003.mpls" }],
  ["bdmv.clipinfo-uhd.parse", "real", "bdmv", "BDMV clipInfo parse", "clipInfo-uhd", { kind: "clipInfo", file: "test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/CLIPINF/00004.clpi" }],
  ["bdmv.sound-synthetic.parse", "synthetic", "bdmv", "BDMV sound parse", "sound-synthetic", { kind: "sound", file: "test-data/fixtures/synthetic-all-features/BDMV/AUXDATA/sound.bdmv", maxReadBytes: 8 * 1024 * 1024 }],
  ["graph.tamako.build", "real", "graph", "BDMV graph build", "tamako-graph", { bdmvDir: "test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV" }],
  ["mnu.battle-royale-00002.parse", "real", "mnu", "MNU parse", "battle-royale-00002", { source: "ig-packets", file: "test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/STREAM/00002.m2ts_ig-packets.bin", clipId: "00002", pid: 0x1400, chunkBytes: 4093, operation: "parse" }],
  ["mnu.battle-royale-00002.render", "real", "mnu", "MNU render assets", "battle-royale-00002", { source: "ig-packets", file: "test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/STREAM/00002.m2ts_ig-packets.bin", clipId: "00002", pid: 0x1400, chunkBytes: 4093, operation: "render" }],
  ["pgs.real-subtitle.parse", "real", "pgs", "PGS parse and bitmap decode", "real-subtitle", { source: "file", file: "test-data/output/baja-studio-pgs/assets/subtitles/subtitle-00001-jpn.sup", displaySet: "largest", optional: true, operation: "parse" }],
  ["pgs.real-subtitle.compose", "real", "pgs", "PGS compose and PNG encode", "real-subtitle", { source: "file", file: "test-data/output/baja-studio-pgs/assets/subtitles/subtitle-00001-jpn.sup", displaySet: "largest", optional: true, operation: "compose" }],
  ["pgs.synthetic-32-128x72.parse", "synthetic", "pgs", "PGS parse and bitmap decode", "synthetic-32-128x72", { source: "synthetic", displaySetCount: 32, width: 128, height: 72, canvasWidth: 1920, canvasHeight: 1080, displaySet: "largest", operation: "parse" }],
  ["pgs.synthetic-32-128x72.compose", "synthetic", "pgs", "PGS compose and PNG encode", "synthetic-32-128x72", { source: "synthetic", displaySetCount: 32, width: 128, height: 72, canvasWidth: 1920, canvasHeight: 1080, displaySet: "largest", operation: "compose" }],
].map(([caseId, suite, category, name, sample, options]) => ({
  caseId, suite, category, name, sample,
  fixture: { id: sample, version: "1", parameters: Object.fromEntries(Object.entries(options).filter(([key]) => !["file", "bdmvDir"].includes(key))) },
  options,
  scope: options.operation ?? (category === "graph" ? "graph-build" : `${options.kind ?? category}-parse`),
}));

async function loadManifestCases(fixtureRoot) {
  const manifestDirectory = join(fixtureRoot, "test-data/fixtures/perf");
  const manifestPath = join(manifestDirectory, "manifest.json");
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return []; throw new Error(`Cannot read performance fixture manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.cases)) throw new Error(`Unsupported performance fixture manifest: ${manifestPath}`);
  return manifest.cases.map((definition) => {
    if (typeof definition.caseId !== "string" || typeof definition.category !== "string" || !definition.fixture?.id || !definition.fixture?.version) throw new Error(`Invalid performance case definition in ${manifestPath}`);
    const fixturePath = (value) => {
      if (value == null) return null;
      const normalized = value.replace(/^test-data\/fixtures\/perf\//, "");
      return resolve(manifestDirectory, normalized);
    };
    const inputPath = fixturePath(definition.input?.path);
    const bdmvRelativePath = definition.input?.virtualPath;
    const inputFiles = (definition.input?.files ?? []).map((file) => ({
      path: fixturePath(file.path),
      sourcePath: file.sourcePath,
      virtualPath: file.virtualPath,
    }));
    const parameters = definition.fixture.parameters ?? {};
    const operation = definition.operation ?? parameters.operation;
    const sourceType = definition.source?.type ?? "file";
    const effectiveSource = definition.category === "mnu" && sourceType === "file" ? "mnu" : sourceType;
    const expectedDetails = definition.expected?.details;
    let options;
    if (definition.category === "bdmv") options = { kind: definition.parseKind ?? parameters.kind, file: inputPath, bdmvRelativePath, expected: expectedDetails };
    else if (definition.category === "graph") options = inputFiles.length ? { files: inputFiles, expected: expectedDetails } : { bdmvDir: inputPath, expected: expectedDetails };
    else if (definition.category === "mnu") {
      const rawPid = definition.source?.pid ?? parameters.pid;
      const pid = typeof rawPid === "string" && /^0x[\da-f]+$/i.test(rawPid) ? Number.parseInt(rawPid.slice(2), 16) : rawPid;
      options = { ...parameters, source: effectiveSource, file: inputPath, clipId: definition.source?.clipId ?? parameters.clipId, pid, operation, expected: operation === "render" ? undefined : expectedDetails, expectedRender: operation === "render" ? expectedDetails : undefined };
    } else if (definition.category === "pgs") options = { ...parameters, source: sourceType, file: inputPath, operation, displaySet: parameters.displaySet ?? "largest", optional: definition.optional === true, expected: operation === "compose" ? undefined : expectedDetails, expectedCompose: operation === "compose" ? expectedDetails : undefined };
    else options = { ...parameters, file: inputPath, operation, source: effectiveSource, expected: expectedDetails };
    return { ...definition, options, fixtureRoot: resolve(fixtureRoot), ...(inputPath === null ? {} : { resolvedInputPath: inputPath }) };
  });
}

export async function getCaseDefinitions({ root, fixtureRoot = root, config } = {}) {
  const manifestCases = await loadManifestCases(resolve(fixtureRoot));
  const scenarios = await getScenarioDefinitions({ root, fixtureRoot, config, manifestCases });
  const cases = [...legacy, ...manifestCases, ...scenarios];
  const ids = new Set();
  for (const item of cases) {
    if (!item.caseId || ids.has(item.caseId)) throw new Error(`Duplicate or empty benchmark caseId: ${item.caseId}`);
    ids.add(item.caseId);
  }
  return cases;
}

export function resolveInput(root, input) {
  return input && (input.startsWith("/") || /^[A-Za-z]:[\\/]/.test(input)) ? input : join(root, input);
}
