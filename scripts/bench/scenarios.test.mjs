import test from "node:test";
import assert from "node:assert/strict";
import { getCaseDefinitions } from "./cases.mjs";
import { prepareScenarioCase } from "./scenarios.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("scenario registry exposes stable scale, CLI, and browser cases with actual input sizes", async () => {
  const cases = await getCaseDefinitions({ root });
  const ids = new Set(cases.map((item) => item.caseId));
  for (const id of [
    "scale.graph-1x.build", "scale.graph-2x.build", "scale.graph-4x.build",
    "scale.rle-1x.decode", "scale.rle-2x.decode", "scale.rle-4x.decode",
    "scale.png-1x.encode", "scale.png-2x.encode", "scale.png-4x.encode",
    "scale.pes-1x.extract", "scale.pes-2x.extract", "scale.pes-4x.extract",
    "perf.index.small.parse", "perf.igs.battle-royale.parse", "perf.igs.battle-royale.render",
    "perf.pgs.baja.parse", "perf.pgs.baja.compose", "perf.package.igs-assembly",
    "cli.perf.metadata.inspect", "cli.perf.metadata.extract", "cli.perf.igs.render", "cli.synthetic-package.validate",
    "browser.synthetic-menu.file-navigation",
  ]) assert.ok(ids.has(id), `missing ${id}`);
  const casesById = new Map(cases.map((item) => [item.caseId, item]));
  assert.equal(casesById.get("scale.rle-2x.decode").fixture.parameters.pixels, 256 * 128 * 4);
  assert.equal(casesById.get("scale.png-4x.encode").fixture.parameters.pixels, 128 * 72 * 16);
  assert.equal(casesById.get("scale.pes-2x.extract").fixture.parameters.packetSize, 192);
});

test("RLE and PNG scenario cases invoke package APIs and describe real output size", async () => {
  const cases = await getCaseDefinitions({ root });
  for (const caseId of ["scale.rle-1x.decode", "scale.png-1x.encode"]) {
    const definition = cases.find((item) => item.caseId === caseId);
    const prepared = await prepareScenarioCase(definition, root);
    const output = await prepared.run();
    const validation = prepared.validate(output);
    const description = prepared.describe(output);
    assert.ok(description.summary.length > 0);
    assert.ok(Object.values(validation).some((value) => typeof value === "number" && value > 0));
    assert.ok(description.units.value > 0);
    if (caseId.includes("png")) assert.ok(description.details.pngBytes > 0);
  }
});
