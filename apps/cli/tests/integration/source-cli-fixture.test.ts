import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli/program.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const fixture = resolve(repositoryRoot, "test-data/fixtures/synthetic-all-features/BDMV");

describe("source CLI commands on the existing synthetic BDMV fixture", () => {
  let outputRoot: string;

  beforeAll(async () => { outputRoot = await mkdtemp(join(tmpdir(), "bdmv2web-source-cli-")); });
  afterAll(async () => { await rm(outputRoot, { recursive: true, force: true }); });

  it("runs inspect in-process and writes its structural report", async () => {
    const reportPath = join(outputRoot, "inspect.json");
    await runCommand("inspect", fixture, "--format", "json", "--out", reportPath);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.declarations).toMatchObject({ entries: 4, movieObjects: 4, playlists: 3 });
    expect(report.stageStatus).toBe("complete");
  });

  it("runs list in-process and writes the fixture asset inventory", async () => {
    const reportPath = join(outputRoot, "list.json");
    await runCommand("list", fixture, "--format", "json", "--out", reportPath);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.summary).toMatchObject({ igsScenes: 2, igsStreams: 2, igsImageElements: 2, supTracks: 5 });
  });

  it("runs structural extraction in-process and writes HDMV artifacts", async () => {
    const output = join(outputRoot, "extract-hdmv");
    await runCommand("extract", fixture, "--type", "hdmv", "--out", output);
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    const commands = JSON.parse(await readFile(join(output, "hdmv/commands.json"), "utf8"));
    expect(manifest.selectedTypes).toEqual(["hdmv"]);
    expect(commands).toHaveLength(16);
  });

  it("reports the unresolved Top Menu playlist from the existing fixture", async () => {
    const output = join(outputRoot, "build-unresolved-menu");
    await runCommand("build", fixture, "--out", output, "--menu-media", "none", "--no-progress");
    const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
    expect(report).toMatchObject({ status: "failed", code: "MENU_PLAYLIST_NOT_RESOLVED" });
  });
});

async function runCommand(...args: string[]): Promise<void> {
  const previousExitCode = process.exitCode;
  const writeStdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.exitCode = 0;
  try {
    await buildProgram().parseAsync([process.execPath, "bdmv2web", ...args]);
  } finally {
    writeStdout.mockRestore();
    process.exitCode = previousExitCode;
  }
}
