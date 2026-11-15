import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../helpers/run-cli.js";
import { writeBdjDisc } from "../helpers/synthetic-bdj.js";

type PublishedStatus = "complete" | "partial" | "failed";

/** The one status must reach stdout, the manifest, the conversion report and the exit code. */
async function expectPublishedStatus(result: { status: number; stdout: string }, output: string, expected: PublishedStatus): Promise<void> {
  const stdout = JSON.parse(result.stdout) as { status: PublishedStatus };
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as { status: PublishedStatus };
  const report = JSON.parse(await readFile(join(output, "reports.json"), "utf8")) as { conversion: { status: PublishedStatus } };
  expect(stdout.status).toBe(expected);
  expect(manifest.status).toBe(expected);
  expect(report.conversion.status).toBe(expected);
  expect(result.status).toBe(expected === "failed" ? 1 : 0);
}

describe("build result publication", () => {
  it("publishes one complete status for a pure BD-J package", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv build bdj "));
    try {
      const disc = await writeBdjDisc(parent);
      const output = join(parent, "bdj output");
      const result = await runCommand(["build", disc, "--out", output, "--menu-media", "none"]);
      await expectPublishedStatus(result, output, "complete");
      const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as { launchMode: string; hdmvEntryCount: number; files: Array<{ path: string; kind: string }> };
      expect(manifest.launchMode).toBe("local-jvm");
      expect(manifest.hdmvEntryCount).toBe(0);
      expect(manifest.files).toContainEqual(expect.objectContaining({ path: "asset-manifest.json", kind: "runtime-index" }));

      const audit = await runCommand(["validate", output, "--format", "json"]);
      expect(audit.status, audit.stderr).toBe(0);
      const checks = (JSON.parse(audit.stdout) as { checks: Array<{ checkId: string; result: string }> }).checks;
      expect(checks.filter((check) => check.checkId.startsWith("PACKAGE_RUNTIME_INDEX"))).toEqual([]);
      expect(checks.filter((check) => check.result === "fail")).toEqual([]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("publishes one complete status for a mixed package", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv build mixed "));
    try {
      const disc = await writeBdjDisc(parent, { mixed: true });
      const output = join(parent, "mixed output");
      const result = await runCommand(["build", disc, "--out", output, "--menu-media", "none"]);
      await expectPublishedStatus(result, output, "complete");
      const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as { launchMode: string; hdmvEntryCount: number };
      expect(manifest.launchMode).toBe("local-jvm");
      expect(manifest.hdmvEntryCount).toBe(1);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});
