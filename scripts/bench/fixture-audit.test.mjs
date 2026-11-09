import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCaseDefinitions } from "./cases.mjs";
import { auditFixtures, fixturePathsOf } from "./fixture-audit.mjs";

test("fixture paths skip virtual disc paths and keep repo-relative ones", () => {
  const root = "/work/repo";
  const paths = fixturePathsOf({
    caseId: "x",
    options: {
      file: "/work/repo/test-data/fixtures/perf/index/a.bdmv",
      bdmvRelativePath: "BDMV/index.bdmv",
      operation: "parse",
      files: [{ path: "/work/repo/test-data/fixtures/perf/playlist/a.mpls", virtualPath: "BDMV/PLAYLIST/a.mpls" }],
      dir: "test-data/fixtures/perf/",
    },
  }, root);
  assert.deepEqual(paths, ["test-data/fixtures/perf", "test-data/fixtures/perf/index/a.bdmv", "test-data/fixtures/perf/playlist/a.mpls"]);
});

test("every benchmark case reads only versioned fixtures", async () => {
  const root = process.cwd();
  const definitions = await getCaseDefinitions({ root });
  assert.ok(definitions.length > 0);
  const audit = auditFixtures({ root, definitions });
  assert.equal(audit.checked, true, "git is required to audit fixture provenance");
  assert.deepEqual(audit.missing, [], "cases reference fixtures that are not on disk");
  assert.deepEqual(audit.untracked, [], "cases reference fixtures that are not in git; add the fixture or drop the case");
});

test("a case that reads a missing file is reported, not skipped", async () => {
  const root = await mkdtemp(join(tmpdir(), "bdmv2web-audit-"));
  try {
    await mkdir(join(root, "test-data", "fixtures"), { recursive: true });
    await writeFile(join(root, "test-data", "fixtures", "present.bin"), "x");
    const audit = auditFixtures({
      root,
      definitions: [
        { caseId: "has-input", options: { file: join(root, "test-data/fixtures/present.bin") } },
        { caseId: "no-input", options: { file: join(root, "test-data/fixtures/absent.bin") } },
      ],
    });
    assert.deepEqual(audit.missing, [{ caseId: "no-input", path: "test-data/fixtures/absent.bin" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
