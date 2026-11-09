import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBuildMode, writeBuildMode } from "./build-mode.mjs";

test("build mode comes from generated build records or an explicit declaration", async () => {
  const root = await mkdtemp(join(tmpdir(), "bdmv2web-build-mode-"));
  try {
    assert.deepEqual(await readBuildMode(root), { profileBuildMode: null, buildMode: "unknown", buildModeSource: "unrecorded-build" });
    await writeBuildMode(join(root, "packages/runtime-web/dist"), true);
    assert.equal((await readBuildMode(root)).buildMode, "profile");
    await writeBuildMode(join(root, "apps/cli/dist"), false);
    assert.equal((await readBuildMode(root)).buildMode, "mixed");
    assert.deepEqual(await readBuildMode(root, "normal"), { profileBuildMode: false, buildMode: "normal", buildModeSource: "cli-declaration" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
