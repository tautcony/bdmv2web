import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

test("child observer records GC and memory without touching stdout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bench-child-observer-"));
  try {
    const report = join(directory, "child.json");
    const observer = pathToFileURL(fileURLToPath(new URL("./child-observer.mjs", import.meta.url))).href;
    const script = "const keep = []; for (let index = 0; index < 200000; index++) keep.push({ index });";
    const result = spawnSync(process.execPath, ["--import", observer, "-e", script], {
      encoding: "utf8",
      env: { ...process.env, BDMV2WEB_BENCH_CHILD_REPORT: report },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    const child = JSON.parse(await readFile(report, "utf8"));
    assert.equal(child.gc.available, true);
    assert.ok(Array.isArray(child.gc.events));
    assert.ok(child.memory.heapUsedBytes > 0);
    assert.ok(child.memory.sampleCount >= 2);
    assert.ok(child.durationMs >= 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
