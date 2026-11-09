import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfileRunDirectory, writeProfileRun } from "./profile-record.mjs";

test("profile run record stores environment and relative artifact paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "bdmv2web-profile-record-"));
  try {
    const { runId, runDir } = await createProfileRunDirectory(root, "runs");
    const definition = { caseId: "example.cpu", fixture: { id: "fixture", version: "1", parameters: {} }, category: "example", name: "example", sample: "fixture" };
    const row = { caseId: definition.caseId, fixture: definition.fixture, category: definition.category, name: definition.name, sample: definition.sample, scope: "test", artifacts: ["profile.cpuprofile"], forks: [] };
    const result = await writeProfileRun({ root, outputRoot: "runs", mode: "cpu", definition, configuration: { durationMs: 10 }, row, runDir, runId });
    const record = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.mode, "cpu");
    assert.equal(record.runId, runId);
    assert.equal(record.environment.repositoryRoot, root);
    assert.equal(record.rows[0].artifacts[0], "profile.cpuprofile");
    assert.equal(result.run.runId, runId);
  } finally { await rm(root, { recursive: true, force: true }); }
});
