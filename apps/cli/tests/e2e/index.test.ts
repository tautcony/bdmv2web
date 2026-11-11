import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { dirname, join, resolve } from "node:path";
import { buildM1ClipInfoWithIgsCue, buildM1Index, buildM1MovieObject, buildM1PlaylistWithAudioPid } from "@bdmv2web/test-fixtures";
import { encodeTimestampForFixture } from "@bdmv2web/igs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A failed conversion must expose the same report fields as a successful one, so a
 * consumer reads one schema regardless of how the conversion ended (P2-P2-5).
 */
function expectFailureReportSchema(report: Record<string, unknown>, code: string): void {
  expect(report).toMatchObject({ status: "failed", code, auditScope: "convert" });
  expect((report.reasons as string[]).length).toBeGreaterThan(0);
  expect((report.blockingDiagnostics as Array<{ severity?: string; code?: string }>)[0]).toMatchObject({ severity: "error", code });
  expect((report.diagnostics as Array<{ severity?: string }>).every((item) => typeof item.severity === "string")).toBe(true);
}

describe("M4 build output", () => {
  it("documents and validates the BD-J disc ID override", () => {
    const help = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "serve", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout.toString()).toContain("--disc-id <32hex>");
    const invalid = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "serve", ".", "--disc-id", "abc"]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr.toString()).toContain("CLI_INVALID_DISC_ID");
  });

  async function makeMenuDisc(parent: string, options: { includeMenuStream?: boolean; topMenuObject?: number; menuCueMode?: "mpls" | "clpi-only"; multipleMenuScenes?: boolean; duplicateMenuSceneIds?: boolean; explicitIgPriority?: boolean; repeatedMenuPlayItemWithoutIg?: boolean; menuUiModel?: 0 | 1; logoUiModel?: 0 | 1; preMenuChain?: boolean } = {}): Promise<string> {
    const disc = join(parent, "BDMV");
    await mkdir(join(disc, "PLAYLIST"), { recursive: true });
    await mkdir(join(disc, "CLIPINF"), { recursive: true });
    await mkdir(join(disc, "STREAM"), { recursive: true });
    await writeFile(join(disc, "index.bdmv"), buildM1Index({ first: 0, top: options.topMenuObject ?? 0 }));
    await writeFile(join(disc, "MovieObject.bdmv"), buildM1MovieObject(options.preMenuChain ? [playPlaylistCommand(1), playPlaylistCommand(7)] : [playPlaylistCommand(7)]));
    await writeFile(join(disc, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAudioPid());
    await writeFile(join(disc, "CLIPINF", "00001.clpi"), buildM1ClipInfoWithIgsCue());
    // This unrelated scene is discovered first. The menu IGS declaration below
    // points at clip 00002 in playlist 00007.
    await writeFile(join(disc, "STREAM", "00001.m2ts"), buildSyntheticClip(false, options.logoUiModel ?? 0));
    await writeFile(join(disc, "PLAYLIST", "00007.mpls"), options.repeatedMenuPlayItemWithoutIg ? buildMenuPlaylistWithRepeatedUnannotatedPlayItem() : buildMenuIgsPlaylist(options.menuCueMode !== "clpi-only"));
    await writeFile(join(disc, "CLIPINF", "00002.clpi"), options.explicitIgPriority ? buildM1ClipInfoWithTwoIgsCues() : buildM1ClipInfoWithIgsCue());
    if (options.includeMenuStream !== false) await writeFile(join(disc, "STREAM", "00002.m2ts"), options.explicitIgPriority ? buildSyntheticClipWithTwoIgPids() : options.duplicateMenuSceneIds ? buildSyntheticClipWithDuplicateSceneIds() : options.multipleMenuScenes ? buildSyntheticClipWithTwoCompositions() : buildSyntheticClip(false, options.menuUiModel));
    return disc;
  }

  it("writes a local offline menu package with a complete delivery status in default and strict modes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert "));
    const disc = await makeMenuDisc(parent);
    const regular = join(parent, "regular output"); const strict = join(parent, "strict output");
    try {
      for (const [output, args, exitCode] of [
        [regular, [], 0],
        [strict, ["--strict"], 0],
      ] as const) {
        const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output, "--title", "Offline Menu", ...args]);
        expect(result.status).toBe(exitCode);
        const stdout = JSON.parse(result.stdout.toString());
        expect(stdout).toMatchObject({ status: "complete", output: await realpath(output) });
        expect(stdout).not.toHaveProperty("mode");
        expect(result.stderr.toString()).toBe("");

        const compatibility = JSON.parse(await readFile(join(output, "compatibility.json"), "utf8"));
        const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
        const assetManifest = JSON.parse(await readFile(join(output, "asset-manifest.json"), "utf8"));
        const discData = await readFile(join(output, "runtime", "disc-data.js"), "utf8");
        const readme = await readFile(join(output, "README.md"), "utf8");
        const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
        const html = await readFile(join(output, "index.html"), "utf8");
        expect(compatibility).toMatchObject({ status: "complete", externalDependencies: ["configured BDMV STREAM files", "IINA 1.4.4 or later on macOS or PotPlayer on Windows"] });
        expect(manifest).toMatchObject({ status: "complete", declaredEntryCount: 2, hdmvEntryCount: 2 });
        expect(manifest).not.toHaveProperty("mode");
        expect(compatibility).not.toHaveProperty("mode");
        // The three output sources share the delivery conclusion and report the
        // missing audit evidence explicitly.
        expect(report).toMatchObject({ status: "complete", auditScope: "convert" });
        expect(report).not.toHaveProperty("mode");
        expect(report.notVerified).toEqual(expect.arrayContaining(["NO_AUDIT_CHECKS"]));
        expect(assetManifest.schemaVersion).toBe("1.0");
        expect(readme).toMatch(/Menu preview\. Delivery status: \*\*complete\*\*/);
        expect(readme).toContain("External playback uses IINA 1.4.4 or later on macOS and PotPlayer on Windows.");
        const localReferences = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]!);
        expect(localReferences.length).toBeGreaterThan(0);
        for (const path of localReferences) {
          expect(path).not.toMatch(/^(?:https?:)?\/\//i);
          expect(path).not.toContain("..");
          await access(join(output, path));
        }
        const packageText = (await Promise.all([
          ...manifest.files.map((file: { path: string }) => readFile(join(output, file.path))),
          readFile(join(output, "compatibility.json")), readFile(join(output, "asset-manifest.json")), readFile(join(output, "manifest.json")),
        ])).map((bytes) => bytes.toString("utf8")).join("\n");
        expect(packageText).not.toContain(await realpath(disc));
        expect(await readFile(join(output, "runtime", "bdmv-config.js"), "utf8")).toContain('globalThis.__BDMV_BDMV_PATH__="../BDMV"');
        expect(packageText).toContain("STREAM/00002.m2ts");
        const menuData = JSON.parse(discData.slice(discData.indexOf("=") + 1).replace(/;\s*$/, "")) as { scene: { pages: Array<{ objects: Array<{ assetId: string }> }> }; menuScenes?: Array<{ playlistId: number }> };
        expect(menuData.scene.pages[0]!.objects[0]!.assetId).toContain("igs-00002-");
        expect(menuData.menuScenes?.map((item) => item.playlistId)).toEqual(expect.arrayContaining([7]));
        expect(packageText).toContain("iina://open?url=");
      }
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("reports one progress line per step on stderr while stdout stays a single JSON record", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu progress "));
    const disc = await makeMenuDisc(parent);
    const output = join(parent, "progress output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output, "--progress"]);
      expect(result.status, result.stderr.toString()).toBe(0);
      const stderr = result.stderr.toString();
      // Piped stderr gets plain lines: each finished step names its position in the fixed plan.
      expect(stderr).toContain("bdmv2web convert · 7 steps");
      // Option parsing is not a step: the plan starts at the first piece of disc work.
      expect(stderr).not.toContain("Read options");
      expect(stderr).toContain("profile  region A · portable");
      for (const [position, step] of [[1, "Parse BDMV structure"], [2, "Extract IGS scenes"], [3, "Resolve Top Menu playlist"], [4, "Select menu scene and media"], [6, "Build menu package"], [7, "Write report and commit"]] as const) {
        expect(stderr).toContain(`✓ ${position}/7  ${step}`);
      }
      // A disc without a loop timeline keeps the media step in the plan and reports no menu media.
      expect(stderr).toContain("5/7  Export menu media");
      expect(stderr).toContain("no menu media");
      expect(stderr).toContain("Done in");
      expect(stderr).toMatch(/package\s+\d+ files/);
      expect(stderr).not.toMatch(/[\u001b\r]/);
      const stdout = result.stdout.toString();
      expect(stdout.trimEnd().split("\n")).toHaveLength(1);
      expect(JSON.parse(stdout)).toMatchObject({ status: "complete", output: await realpath(output) });

      const quiet = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", join(parent, "quiet output"), "--no-progress"]);
      expect(quiet.status).toBe(0);
      expect(quiet.stderr.toString()).toBe("");

      const ambiguous = await makeMenuDisc(join(parent, "ambiguous"), { multipleMenuScenes: true });
      const failed = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", ambiguous, "--out", join(parent, "failed output"), "--progress"]);
      expect(failed.status).toBe(1);
      expect(failed.stderr.toString()).toContain("✗ 4/7  Select menu scene and media");
      expect(failed.stderr.toString()).toContain("MENU_SCENE_AMBIGUOUS");
      expect(failed.stderr.toString()).toContain("Failed in");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("applies --limits to conversion-time and packaged menu VMs", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu limits "));
    const disc = await makeMenuDisc(parent);
    const limitsPath = join(parent, "limits.json"); const output = join(parent, "limited output");
    try {
      await writeFile(limitsPath, JSON.stringify({ maxInstructionsPerTurn: 77, maxCallDepth: 0, maxQueueDepth: 12 }));
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--limits", limitsPath, "--out", output]);
      expect(result.status, result.stderr.toString()).toBe(0);
      const embedded: { __BDMV_MENU_DATA__?: { limits?: Record<string, unknown> } } = {};
      runInNewContext(await readFile(join(output, "runtime/disc-data.js"), "utf8"), embedded);
      expect(embedded.__BDMV_MENU_DATA__?.limits).toMatchObject({ maxInstructionsPerTurn: 77, maxCallDepth: 0, maxQueueDepth: 12 });
      expect(embedded.__BDMV_MENU_DATA__?.limits?.maxReadWindowBytes).toBeGreaterThan(0);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("records the requested player profile in the packaged manifest", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu profile ")); const disc = await makeMenuDisc(parent);
    try {
      const english = join(parent, "profile-eng.json");
      const japanese = join(parent, "profile-jpn.json");
      await writeFile(english, JSON.stringify({ menuLanguage: "eng", audioLanguage: "eng", subtitleLanguage: "eng", country: "US", region: "A", outputProfile: "portable" }));
      await writeFile(japanese, JSON.stringify({ menuLanguage: "jpn", audioLanguage: "jpn", subtitleLanguage: "eng", country: "JP", region: "A", outputProfile: "portable" }));
      const outputs = [join(parent, "menu-eng"), join(parent, "menu-jpn")];
      for (const [profile, output] of [[english, outputs[0]!], [japanese, outputs[1]!]] as const) {
        const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--player-profile", profile, "--out", output]);
        expect(result.status).toBe(0);
      }
      const englishProfile = JSON.parse(await readFile(join(outputs[0]!, "manifest.json"), "utf8")).profile;
      const japaneseProfile = JSON.parse(await readFile(join(outputs[1]!, "manifest.json"), "utf8")).profile;
      expect(englishProfile).toMatchObject({ menuLanguage: "eng", country: "US" });
      expect(japaneseProfile).toMatchObject({ menuLanguage: "jpn", country: "JP" });

      const missing = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--player-profile", join(parent, "absent.json"), "--out", join(parent, "menu-missing")]);
      expect(missing.status).toBe(1);
      expect(missing.stderr.toString()).toContain("CLI_INVALID_PROFILE");
      await expect(access(join(parent, "menu-missing"))).rejects.toThrow();
      await writeFile(join(parent, "broken.json"), "not json{");
      const broken = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--player-profile", join(parent, "broken.json"), "--out", join(parent, "menu-broken")]);
      expect(broken.status).toBe(1);
      expect(broken.stderr.toString()).toContain("CLI_INVALID_PROFILE");

      // Profile words follow the PSR rules and are validated before disc access.
      const caseBase = { menuLanguage: "eng", audioLanguage: "eng", subtitleLanguage: "eng", country: "US", region: "A", outputProfile: "portable" };
      for (const [index, profile] of [
        { ...caseBase, country: "USA" },
        { ...caseBase, menuLanguage: "jp" },
        { ...caseBase, subtitleLanguage: "eng " },
        { ...caseBase, audioLanguage: "日本語" },
      ].entries()) {
        const path = join(parent, `invalid-${index}.json`);
        await writeFile(path, JSON.stringify(profile));
        const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--player-profile", path, "--out", join(parent, `menu-invalid-${index}`)]);
        expect(result.status, JSON.stringify(profile)).toBe(1);
        expect(result.stderr.toString()).toContain("CLI_INVALID_PROFILE");
        await expect(access(join(parent, `menu-invalid-${index}`))).rejects.toThrow();
      }

      // Case is normalised: `ENG`/`us` mean `eng`/`US`.
      const mixedCase = join(parent, "profile-mixed.json");
      await writeFile(mixedCase, JSON.stringify({ ...caseBase, menuLanguage: "ENG", country: "us" }));
      const normalised = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--player-profile", mixedCase, "--out", join(parent, "menu-mixed")]);
      expect(normalised.status).toBe(0);
      expect(JSON.parse(await readFile(join(parent, "menu-mixed", "manifest.json"), "utf8")).profile).toMatchObject({ menuLanguage: "eng", country: "US" });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("defaults to a sibling BDMV-menu output with a configurable BDMV path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv default menu ")); const disc = await makeMenuDisc(parent);
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--no-strict"]);
      expect(result.status).toBe(0);
      const output = join(parent, "BDMV-menu");
      expect(JSON.parse(result.stdout.toString()).output).toBe(await realpath(output));
      expect(await readFile(join(output, "runtime", "bdmv-config.js"), "utf8")).toContain('globalThis.__BDMV_BDMV_PATH__="../BDMV"');
      const parentOutput = join(parent, "parent-input-menu");
      const parentResult = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", parent, "--out", parentOutput, "--no-strict"]);
      expect(parentResult.status).toBe(0);
      expect(await readFile(join(parentOutput, "runtime", "bdmv-config.js"), "utf8")).toContain('globalThis.__BDMV_BDMV_PATH__="../BDMV"');
      const verify = () => spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", output, "--offline", "--format", "json"]);
      const initialAudit = verify(); expect(initialAudit.status).toBe(0);
      const checks = JSON.parse(initialAudit.stdout.toString()).checks as Array<{ checkId: string; result: string }>;
      expect(checks.filter((item) => item.result === "fail")).toEqual([]);
      await writeFile(join(output, "runtime", "bdmv-config.js"), 'globalThis.__BDMV_BDMV_PATH__="../moved BDMV";\n');
      const changedAudit = verify(); expect(changedAudit.status).toBe(0);
      expect(JSON.parse(changedAudit.stdout.toString()).checks).toContainEqual(expect.objectContaining({ checkId: "EXTERNAL_CONFIG", result: "not-verified" }));
      const other = join(parent, "other"); await mkdir(other);
      const externalOutput = join(other, "menu");
      const separate = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", externalOutput, "--no-strict"]);
      expect(separate.status).toBe(0);
      expect(await readFile(join(externalOutput, "runtime", "bdmv-config.js"), "utf8")).toContain(`globalThis.__BDMV_BDMV_PATH__=${JSON.stringify(await realpath(disc))}`);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("fails with MENU_SCENE_NOT_FOUND when the Top Menu IGS target is missing", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert no scene "));
    const disc = await makeMenuDisc(parent, { includeMenuStream: false }); const output = join(parent, "failed output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({ status: "failed", code: "MENU_SCENE_NOT_FOUND", output: await realpath(output) });
      expect(JSON.parse(await readFile(join(output, "report.json"), "utf8"))).toMatchObject({ status: "failed", code: "MENU_SCENE_NOT_FOUND" });
      const readme = await readFile(join(output, "README.md"), "utf8");
      expect(readme).toContain("Status: **failed**.");
      expect(readme).toContain("No extracted IGS scene matches the stream and clip declarations in Top Menu playlist 00007");
      await expect(access(join(output, "index.html"))).rejects.toThrow();
      // The failure report keeps the success schema: reasons, blocking diagnostics
      // and per-diagnostic severity must be readable the same way (P2-P2-5).
      const failureReport = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
      expectFailureReportSchema(failureReport, "MENU_SCENE_NOT_FOUND");
      expect(failureReport.reasons).toEqual([expect.stringContaining("No extracted IGS scene matches")]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("fails with MENU_PLAYLIST_NOT_RESOLVED when the Top Menu playlist cannot be resolved", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert unknown playlist "));
    const disc = await makeMenuDisc(parent, { topMenuObject: 1 }); const output = join(parent, "failed output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({ status: "failed", code: "MENU_PLAYLIST_NOT_RESOLVED" });
      expectFailureReportSchema(JSON.parse(await readFile(join(output, "report.json"), "utf8")), "MENU_PLAYLIST_NOT_RESOLVED");
      expect(await readFile(join(output, "README.md"), "utf8")).toContain("no IGS scene was selected");
      await expect(access(join(output, "index.html"))).rejects.toThrow();
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("uses a primary PlayItem CLPI IG cue when its playlist has no explicit MPLS IG declaration", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert clpi cue "));
    const disc = await makeMenuDisc(parent, { menuCueMode: "clpi-only" }); const output = join(parent, "output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output]);
      expect(result.status).toBe(0);
      const discData = await readFile(join(output, "runtime", "disc-data.js"), "utf8");
      const menuData = JSON.parse(discData.slice(discData.indexOf("=") + 1).replace(/;\s*$/, "")) as { scene: { pages: Array<{ objects: Array<{ assetId: string }> }> } };
      expect(menuData.scene.pages[0]!.objects[0]!.assetId).toContain("igs-00002-");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("treats a popup-model Top Menu playlist as the menu surface and keeps it out of preMenuPlaylistIds", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert popup top menu "));
    const disc = await makeMenuDisc(parent, { menuUiModel: 1 });
    const output = join(parent, "output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output, "--title", "Offline Menu"]);
      expect(result.status).toBe(0);
      const discData = await readFile(join(output, "runtime", "disc-data.js"), "utf8");
      const menuData = JSON.parse(discData.slice(discData.indexOf("=") + 1).replace(/;\s*$/, "")) as { menuPlaylistIds?: number[]; preMenuPlaylistIds?: number[] };
      expect(menuData.menuPlaylistIds).toContain(7);
      expect(menuData.preMenuPlaylistIds).toBeUndefined();
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("records playlists completed before the Top Menu surface as preMenuPlaylistIds", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert pre-menu chain "));
    const disc = await makeMenuDisc(parent, { logoUiModel: 1, preMenuChain: true });
    const output = join(parent, "output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output, "--title", "Offline Menu"]);
      expect(result.status).toBe(0);
      const discData = await readFile(join(output, "runtime", "disc-data.js"), "utf8");
      const menuData = JSON.parse(discData.slice(discData.indexOf("=") + 1).replace(/;\s*$/, "")) as { menuPlaylistIds?: number[]; preMenuPlaylistIds?: number[] };
      expect(menuData.preMenuPlaylistIds).toEqual([1]);
      expect(menuData.menuPlaylistIds).toContain(7);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("fails explicitly when one clip and PID cue resolve to multiple IGS compositions", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert ambiguous scene "));
    const disc = await makeMenuDisc(parent, { multipleMenuScenes: true }); const output = join(parent, "failed output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({ status: "failed", code: "MENU_SCENE_AMBIGUOUS" });
      expectFailureReportSchema(JSON.parse(await readFile(join(output, "report.json"), "utf8")), "MENU_SCENE_AMBIGUOUS");
      expect(await readFile(join(output, "README.md"), "utf8")).toContain("maps to multiple extracted IGS scenes");
      await expect(access(join(output, "index.html"))).rejects.toThrow();
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps same-ID scenes from different source offsets as separate ambiguous candidates", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert duplicate scene id "));
    const disc = await makeMenuDisc(parent, { duplicateMenuSceneIds: true }); const output = join(parent, "failed output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({ status: "failed", code: "MENU_SCENE_AMBIGUOUS" });
      const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
      const message = report.diagnostics.find((item: { code: string }) => item.code === "MENU_SCENE_AMBIGUOUS")?.message as string;
      expect(message).toContain("00002:288:7:0:90000");
      expect(message.match(/@ byte /g)).toHaveLength(2);
      await expect(access(join(output, "index.html"))).rejects.toThrow();
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("resolves the selected PlayItem scene when another item has no MPLS IG declaration", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert per-item clpi cue "));
    const disc = await makeMenuDisc(parent, { explicitIgPriority: true, repeatedMenuPlayItemWithoutIg: true }); const output = join(parent, "output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output]);
      expect(result.status).toBe(0);
      const discData = await readFile(join(output, "runtime", "disc-data.js"), "utf8");
      const menuData = JSON.parse(discData.slice(discData.indexOf("=") + 1).replace(/;\s*$/, "")) as { scene: { pages: Array<{ objects: Array<{ assetId: string }> }> } };
      expect(menuData.scene.pages[0]!.objects[0]!.assetId).toContain("igs-00002-");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("prefers an explicit MPLS IG PID over additional CLPI cues for the same primary clip", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert explicit ig priority "));
    const disc = await makeMenuDisc(parent, { explicitIgPriority: true }); const output = join(parent, "output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output]);
      expect(result.status).toBe(0);
      const discData = await readFile(join(output, "runtime", "disc-data.js"), "utf8");
      expect(discData).toContain("igs-00002-288-");
      expect(discData).not.toContain("igs-00002-289-");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("carries --player-profile into the packaged runtime data, not only the manifest", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert profile "));
    const disc = await makeMenuDisc(parent); const output = join(parent, "output"); const profilePath = join(parent, "profile.json");
    await writeFile(profilePath, JSON.stringify({ menuLanguage: "jpn", audioLanguage: "jpn", subtitleLanguage: "eng", country: "JP", region: "A", outputProfile: "portable" }));
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output, "--player-profile", profilePath]);
      expect(result.status).toBe(0);
      const discData = await readFile(join(output, "runtime", "disc-data.js"), "utf8");
      expect(discData).toContain('"profile":{"menuLanguage":"jpn"');
      const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
      expect(manifest.profile).toMatchObject({ menuLanguage: "jpn", country: "JP" });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects a missing --title without leaving a staging directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert title "));
    const disc = await makeMenuDisc(parent); const output = join(parent, "title-missing");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", output, "--title"]);
      expect(result.status).toBe(1);
      expect(result.stderr.toString()).toContain("CLI_MISSING_VALUE");
      expect(result.stdout.toString()).toBe("");
      await expect(access(output)).rejects.toThrow();
      expect((await readdir(parent)).filter((name) => name.includes(".staging-"))).toEqual([]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});

describe("M1 structural CLI", () => {
  async function makeDisc(parent: string, index = buildM1Index()): Promise<string> {
    const root = join(parent, "BDMV"); await mkdir(join(root, "PLAYLIST"), { recursive: true }); await mkdir(join(root, "CLIPINF"), { recursive: true }); await mkdir(join(root, "STREAM"), { recursive: true });
    await writeFile(join(root, "index.bdmv"), index); await writeFile(join(root, "MovieObject.bdmv"), buildM1MovieObject()); return root;
  }
  it("writes independently parseable structural JSON to stdout with no progress text", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv inspect ")); const root = await makeDisc(parent, buildM1Index({ hdmvTitle: 3, bdjTitle: "00042", titleAccess: 2 }));
    try { const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/index.js"), "inspect", root, "--format", "json"]); expect(result.status).toBe(0); expect(result.stderr.toString()).toBe(""); const parsed = JSON.parse(result.stdout.toString()); expect(parsed.analysisStage).toBe("structural"); expect(parsed.supportPrediction.status).toBe("partial"); expect(parsed.declarations.entries).toBe(4); expect(parsed.entries.map((entry: any) => entry.target.objectType)).toEqual(["HDMV", "HDMV", "HDMV", "BDJ"]); expect(parsed.entries[2].target.target).toBe(3); expect(parsed.entries[3].target).toMatchObject({ objectType: "BDJ", target: "00042", accessType: 2 }); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("extracts only structural artifacts through the output transaction and preserves source bytes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv extract ")); const root = await makeDisc(parent); const target = join(parent, "out");
    try { const beforeIndex = await readFile(join(root, "index.bdmv")); const beforeMobj = await readFile(join(root, "MovieObject.bdmv")); const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/index.js"), "extract", root, "--type", "hdmv", "--out", target]); expect(result.status).toBe(0); expect(JSON.parse(result.stdout.toString()).stageStatus).toBe("complete"); const disc = JSON.parse(await readFile(join(target, "hdmv/parsed-disc.json"), "utf8")); expect(disc.analysisStage).toBe("structural"); const commands = JSON.parse(await readFile(join(target, "hdmv/commands.json"), "utf8")); expect(commands).toHaveLength(2); expect(commands[0].source).toMatchObject({ path: "MovieObject.bdmv", offset: "54", instructionIndex: 0 }); const sourceMap = JSON.parse(await readFile(join(target, "hdmv/source-map.json"), "utf8")); expect(sourceMap.instructions[0]).toMatchObject({ instructionIndex: 0, source: { path: "MovieObject.bdmv", byteOffset: "54", instructionIndex: 0 } }); const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8")); expect(manifest.stageStatus).toBe("complete"); expect(manifest.selectedTypes).toEqual(["hdmv"]); expect(manifest.files.find((file: { path: string }) => file.path === "hdmv/commands.json")).toMatchObject({ kind: "hdmv-command-table" }); expect(await readFile(join(root, "index.bdmv"))).toEqual(beforeIndex); expect(await readFile(join(root, "MovieObject.bdmv"))).toEqual(beforeMobj); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("does not overwrite an existing inspect output target", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv inspect existing ")); const root = await makeDisc(parent); const target = join(parent, "inspection.json"); await writeFile(target, "keep me\n");
    try { const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/index.js"), "inspect", root, "--format", "json", "--out", target]); expect(result.status).toBe(1); expect(await readFile(target, "utf8")).toBe("keep me\n"); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });
});

describe("IGS extract CLI", () => {
  async function makeIgsDisc(parent: string, clip: Uint8Array, options: { structuralPid?: number } = {}): Promise<string> {
    const root = await (async () => {
      const path = join(parent, "BDMV");
      await mkdir(join(path, "PLAYLIST"), { recursive: true });
      await mkdir(join(path, "CLIPINF"), { recursive: true });
      await mkdir(join(path, "STREAM"), { recursive: true });
      await writeFile(join(path, "index.bdmv"), buildM1Index());
      await writeFile(join(path, "MovieObject.bdmv"), buildM1MovieObject());
      return path;
    })();
    await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAudioPid());
    const clipInfo = buildM1ClipInfoWithIgsCue();
    if (options.structuralPid !== undefined) { clipInfo[82] = options.structuralPid >>> 8; clipInfo[83] = options.structuralPid & 0xff; }
    await writeFile(join(root, "CLIPINF", "00001.clpi"), clipInfo);
    await writeFile(join(root, "STREAM", "00001.m2ts"), clip);
    return root;
  }
  async function sourceSnapshot(rootPath: string): Promise<Array<[string, Buffer]>> {
    const paths = ["index.bdmv", "MovieObject.bdmv", "PLAYLIST/00001.mpls", "CLIPINF/00001.clpi", "STREAM/00001.m2ts"];
    return Promise.all(paths.map(async (path) => [path, await readFile(join(rootPath, path))] as [string, Buffer]));
  }
  async function expectSourceSnapshot(rootPath: string, before: Array<[string, Buffer]>): Promise<void> {
    for (const [path, bytes] of before) expect(await readFile(join(rootPath, path)), `source bytes changed: ${path}`).toEqual(bytes);
  }

  it("exports IGS scene analysis, mappings, diagnostics and generated-file manifest entries", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv extract igs "));
    const rootPath = await makeIgsDisc(parent, buildSyntheticClip());
    const target = join(parent, "out");
    try {
      const before = await sourceSnapshot(rootPath);
      const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/index.js"), "extract", rootPath, "--type", "igs", "--out", target]);
      expect(result.status).toBe(0);
      const scenesDoc = JSON.parse(await readFile(join(target, "igs/scenes.json"), "utf8"));
      expect(scenesDoc.scenes).toHaveLength(1);
      expect(scenesDoc).toMatchObject({ schemaVersion: "1.1", status: "complete" });
      expect(scenesDoc.scenes[0].raw).toMatchObject({ clipId: "00001", pid: 0x120, complete: true, width: 1, height: 1, source: { path: "STREAM/00001.m2ts", pid: 0x120, origin: "primary" } });
      expect(scenesDoc.scenes[0].raw.pages[0].buttons[0].commands[0].bytes).toHaveLength(12);
      const mappings = JSON.parse(await readFile(join(target, "igs/source-map.json"), "utf8"));
      expect(mappings.scenes[0].composition).toMatchObject({ path: "STREAM/00001.m2ts", origin: "primary", stage: "transport" });
      expect(mappings.scenes[0].objects[0]).toMatchObject({ objectId: 5, source: { path: "STREAM/00001.m2ts", origin: "primary", byteOffset: expect.any(String) } });
      const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({ stageStatus: "complete", igs: { support: { status: "unverified" } } });
      expect(manifest.limitations).toContain("IGS effect sequences are rendered and presented; effect flag semantics are verified for the synthetic fixtures only");
      expect(manifest.files.map((file: any) => file.path)).toEqual(expect.arrayContaining(["igs/scenes.json", "igs/diagnostics.json", "igs/source-map.json"]));
      await expect(access(join(target, "assets/graphics"))).rejects.toThrow();
      await expectSourceSnapshot(rootPath, before);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps an unresolved scene and diagnostic without writing a transparent placeholder", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv extract igs partial "));
    const rootPath = await makeIgsDisc(parent, buildSyntheticClip(true));
    const target = join(parent, "out");
    try {
      const before = await sourceSnapshot(rootPath);
      const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/index.js"), "extract", rootPath, "--type", "igs", "--out", target]);
      expect(result.status).toBe(0);
      const scenesDoc = JSON.parse(await readFile(join(target, "igs/scenes.json"), "utf8"));
      expect(scenesDoc.scenes).toHaveLength(1);
      expect(scenesDoc.scenes[0].raw).toMatchObject({ complete: false, pages: [{ buttons: [{ visuals: { normal: { startObjectId: 9 } } }] }] });
      expect(scenesDoc.status).toBe("partial");
      const diagnostics = JSON.parse(await readFile(join(target, "igs/diagnostics.json"), "utf8"));
      expect(diagnostics.diagnostics.some((item: any) => item.code === "UNRESOLVED_OBJECT")).toBe(true);
      const sourceMap = JSON.parse(await readFile(join(target, "igs/source-map.json"), "utf8"));
      const unresolvedIndex = diagnostics.diagnostics.findIndex((item: any) => item.code === "UNRESOLVED_OBJECT");
      expect(sourceMap.diagnostics[unresolvedIndex]).toMatchObject({
        stage: "render",
        source: { path: "STREAM/00001.m2ts", origin: "primary", clipId: "00001", pid: 0x120 },
      });
      const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
      expect(manifest.files.some((file: any) => file.path.startsWith("assets/graphics/"))).toBe(false);
      await expect(access(join(target, "assets", "graphics"))).rejects.toThrow();
      await expectSourceSnapshot(rootPath, before);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("writes structural and unknown positions with source-map diagnostic stages", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv extract igs source map "));
    const clip = buildSyntheticClip();
    clip[4] = 0; // The packet reader recovers at the next 192-byte M2TS boundary.
    const rootPath = await makeIgsDisc(parent, clip, { structuralPid: 0x121 });
    const target = join(parent, "out");
    try {
      const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/index.js"), "extract", rootPath, "--type", "igs", "--no-strict", "--out", target]);
      expect(result.status).toBe(0);
      const diagnostics = JSON.parse(await readFile(join(target, "igs/diagnostics.json"), "utf8"));
      const sourceMap = JSON.parse(await readFile(join(target, "igs/source-map.json"), "utf8"));
      const conflictIndex = diagnostics.diagnostics.findIndex((item: any) => item.code === "IGS_PID_CONFLICT");
      const syncLossIndex = diagnostics.diagnostics.findIndex((item: any) => item.code === "TS_SYNC_LOST");
      expect(conflictIndex).toBeGreaterThanOrEqual(0);
      expect(sourceMap.diagnostics[conflictIndex]).toMatchObject({
        stage: "structural",
        source: { path: "CLIPINF/00001.clpi", origin: "primary", clipId: "00001", pid: 0x121, byteOffset: expect.any(String), packetOffset: null },
      });
      expect(syncLossIndex).toBeGreaterThanOrEqual(0);
      expect(sourceMap.diagnostics[syncLossIndex]).toMatchObject({ source: null, stage: "transport" });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});

describe("asset PNG rendering", () => {
  it("renders a SUP without a BDMV, skips clear display sets and records start/end times", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv render sup "));
    const input = join(parent, "manual.sup"); const output = join(parent, "out");
    await writeFile(input, buildSyntheticSup());
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "render", "--sup", input, "--out", output]);
      expect(result.status, result.stderr.toString()).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({ stageStatus: "complete", assetCount: 2 });
      const manifest = JSON.parse(await readFile(join(output, "assets-manifest.json"), "utf8"));
      expect(manifest.assets).toHaveLength(2);
      expect(manifest.assets.map((asset: any) => asset.displaySet)).toEqual([1, 3]);
      // Seconds are relative to the first display set, not the raw PTS.
      expect(manifest.assets[0]).toMatchObject({ type: "sup-png", startSeconds: 0, endSeconds: 0.5, width: 4, height: 3 });
      expect(manifest.assets[1]).toMatchObject({ type: "sup-png", startSeconds: 1, endSeconds: null });
      expect(manifest.assets[0].startTime90k).toBeUndefined();
      expect((await readdir(join(output, "assets/subtitles"))).sort()).toEqual(["manual-display-00001.png", "manual-display-00003.png"]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("renders an MNU without a BDMV", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv render mnu "));
    const input = join(parent, "manual.mnu"); const output = join(parent, "out");
    await writeFile(input, buildSyntheticMnu());
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "render", input, "--out", output]);
      expect(result.status, result.stderr.toString()).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({ stageStatus: "complete", assetCount: 1 });
      const manifest = JSON.parse(await readFile(join(output, "assets-manifest.json"), "utf8"));
      expect(manifest.assets[0]).toMatchObject({ type: "igs-png", objectId: 5, width: 1, height: 1 });
      expect((await readdir(join(output, "assets/graphics")))).toHaveLength(1);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("writes palette PNGs by default and rejects a PNG level outside 0-9", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv render png level "));
    const input = join(parent, "manual.mnu"); const output = join(parent, "out");
    await writeFile(input, buildSyntheticMnu());
    try {
      const rejected = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "render", input, "--out", output, "--png-level", "10"]);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr.toString()).toContain("CLI_INVALID_PNG_LEVEL");

      const rendered = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "render", input, "--out", output, "--png-level", "6"]);
      expect(rendered.status, rendered.stderr.toString()).toBe(0);
      const [name] = await readdir(join(output, "assets/graphics"));
      const png = await readFile(join(output, "assets/graphics", name!));
      // IHDR colour type stays palette whatever level the caller asked for.
      expect(png[25]).toBe(3);
      expect(png.subarray(37, 41).toString("ascii")).toBe("PLTE");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("records display-set timing in export-assets and omits transparent PNG records", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv export sup "));
    const fixture = resolve(root, "../../test-data/fixtures/synthetic-all-features/BDMV");
    const output = join(parent, "out");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "export", fixture, "--out", output, "--type", "sup", "--decode", "png"]);
      expect(result.status, result.stderr.toString()).toBe(0);
      const manifest = JSON.parse(await readFile(join(output, "assets-manifest.json"), "utf8"));
      const pngs = manifest.assets.filter((asset: any) => asset.type === "sup-png");
      expect(pngs).toHaveLength(5);
      expect(pngs.every((asset: any) => typeof asset.startSeconds === "number" && asset.startSeconds >= 0)).toBe(true);
      expect(pngs.every((asset: any) => asset.endSeconds === null || (typeof asset.endSeconds === "number" && asset.endSeconds > asset.startSeconds))).toBe(true);
      expect(pngs.every((asset: any) => asset.startTime90k === undefined)).toBe(true);
      expect(pngs.map((asset: any) => asset.displaySet)).toEqual([1, 1, 1, 1, 1]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

});

describe("stage and argument contracts", () => {
  async function emptyDisc(parent: string): Promise<string> {
    const path = join(parent, "BDMV");
    await mkdir(path, { recursive: true });
    return path;
  }

  it("refuses a stage with a fatal diagnostic and writes no output", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv stage fatal "));
    try {
      const disc = await emptyDisc(parent);
      const target = join(parent, "extract-out");
      const extracted = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "extract", disc, "--type", "hdmv", "--out", target]);
      expect(extracted.status).toBe(1);
      expect(JSON.parse(extracted.stdout.toString())).toMatchObject({ stageStatus: "failed", code: "BDMV_REQUIRED_FILE_MISSING" });
      await expect(access(target)).rejects.toThrow();

      const converted = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--out", join(parent, "convert-out")]);
      expect(converted.status).toBe(1);
      expect(JSON.parse(converted.stdout.toString())).toMatchObject({ stageStatus: "failed", code: "BDMV_REQUIRED_FILE_MISSING" });
      await expect(access(join(parent, "convert-out"))).rejects.toThrow();
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("fails inspect by default and keeps the stage fact with --allow-partial", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv stage inspect "));
    try {
      const disc = await emptyDisc(parent);
      const failed = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "inspect", disc, "--format", "json"]);
      expect(failed.status).toBe(1);
      expect(JSON.parse(failed.stdout.toString())).toMatchObject({ stageStatus: "failed", code: "BDMV_REQUIRED_FILE_MISSING" });

      const allowed = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "inspect", disc, "--allow-partial", "--format", "json"]);
      expect(allowed.status).toBe(0);
      expect(JSON.parse(allowed.stdout.toString()).stageStatus).toBe("failed");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("rejects an invalid limit before creating output", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv stage args "));
    try {
      const disc = await emptyDisc(parent);
      const limitsPath = join(parent, "limits.json"); const limitsTarget = join(parent, "limits-reject");
      await writeFile(limitsPath, JSON.stringify({ maxInstructionsPerTurn: 0 }));
      const limits = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "build", disc, "--limits", limitsPath, "--out", limitsTarget]);
      expect(limits.status).toBe(1);
      expect(limits.stderr.toString()).toContain("INVALID_LIMIT");
      await expect(access(limitsTarget)).rejects.toThrow();
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});

describe("offline validate CLI", () => {
  async function makePackage(directory: string, payload: Record<string, string>): Promise<void> {
    const files = [];
    for (const [path, content] of Object.entries(payload)) {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      const bytes = Buffer.from(content);
      await writeFile(target, bytes);
      files.push({ path, kind: path.endsWith(".html") ? "html" : path.endsWith(".js") ? "runtime" : "asset", byteLength: String(bytes.length) });
    }
    files.sort((a, b) => a.path.localeCompare(b.path, "en"));
    await writeFile(join(directory, "manifest.json"), JSON.stringify({ schemaVersion: "1.0", status: "complete", files }));
  }

  it("validates a generated package offline without a BDMV or FFmpeg input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bdmv validate 离线 "));
    try {
      await makePackage(directory, { "index.html": "<main>ready</main>" });
      await writeFile(join(directory, "compatibility.json"), JSON.stringify({ profile: "portable", status: "complete", notVerified: ["media timeline and seek accuracy"] }));
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--format", "json"]);
      expect(result.status).toBe(0);
      expect(result.stderr.toString()).toBe("");
      const audit = JSON.parse(result.stdout.toString());
      expect(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")).status).toBe("complete");
      expect(audit.dependencyAudit).toMatchObject({ schemaVersion: "1.0", status: "pass" });
      expect(audit.dependencyAudit.checks.some((check: any) => check.checkId === "OFFLINE_STATIC_AUDIT" && check.result === "pass")).toBe(true);
      // Only not-verified evidence was missing, so the delivery is complete (D-2R).
      expect(audit.decision).toMatchObject({ status: "complete", strict: false, exitCode: 0 });
      expect(audit.releaseSummary.release.gaps.map((gap: any) => gap.checkId)).toEqual(expect.arrayContaining(["REFERENCE_EVIDENCE_REQUIRED", "COVERAGE_ENTRIES", "COVERAGE_INSTRUCTIONS", "COVERAGE_MEDIA", "COVERAGE_TESTS"]));
      const report = JSON.parse(await readFile(join(directory, "dependency-audit.json"), "utf8"));
      expect(report).toEqual(audit.dependencyAudit);
      const compatibility = JSON.parse(await readFile(join(directory, "compatibility.json"), "utf8"));
      expect(compatibility).toMatchObject({ status: "complete", profile: "portable", notVerified: expect.arrayContaining(["media timeline and seek accuracy", "REFERENCE_EVIDENCE_REQUIRED"]) });
      expect(compatibility).not.toHaveProperty("mode");
      expect(compatibility).not.toHaveProperty("browserEvidence");
      const release = JSON.parse(await readFile(join(directory, "reports", "release-summary.json"), "utf8"));
      expect(release.release).toEqual(audit.releaseSummary.release);
      const second = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--format", "json"]);
      expect(second.status).toBe(0);
      expect(JSON.parse(second.stdout.toString()).checks.some((check: any) => check.checkId === "PACKAGE_UNLISTED_PAYLOAD")).toBe(false);
      expect(JSON.parse(second.stdout.toString()).releaseSummary.release.status).toBe("complete");
      const strict = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--strict", "--format", "json"]);
      expect(strict.status).toBe(0);
      expect(JSON.parse(strict.stdout.toString()).decision).toMatchObject({ status: "complete", strict: true, exitCode: 0 });
      const noStrict = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--no-strict", "--format", "json"]);
      expect(noStrict.status).toBe(0);
      expect(JSON.parse(noStrict.stdout.toString()).decision.status).toBe("complete");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("does not write any report when validate arguments are invalid", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bdmv validate args "));
    try {
      await makePackage(directory, { "index.html": "<main>ready</main>" });
      const before = await readFile(join(directory, "manifest.json"));
      for (const args of [["--format"], ["--format", "xml"], ["--format="]]) {
        const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", ...args]);
        expect(result.status, args.join(" ")).toBe(1);
        expect(result.stdout.toString()).toBe("");
        expect(result.stderr.toString()).toMatch(/CLI_(?:MISSING_VALUE|INVALID_FORMAT|INVALID_ARGUMENT)/);
      }
      expect(await readFile(join(directory, "manifest.json"))).toEqual(before);
      await expect(access(join(directory, "dependency-audit.json"))).rejects.toThrow();
      await expect(access(join(directory, "compatibility.json"))).rejects.toThrow();
      await expect(access(join(directory, "reports"))).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("writes the same dependency audit to disk as to stdout for a package without static payload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bdmv validate no payload "));
    try {
      // A failed conversion package: only README.md and report.json exist.
      await writeFile(join(directory, "README.md"), "# Menu package\n\nStatus: **failed**.\n");
      await writeFile(join(directory, "report.json"), JSON.stringify({ schemaVersion: "1.0", status: "failed", code: "MENU_SCENE_NOT_FOUND", auditScope: "convert", reasons: ["no scene"], notVerified: [], diagnostics: [], blockingDiagnostics: [] }));
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--format", "json"]);
      const audit = JSON.parse(result.stdout.toString());
      const disk = JSON.parse(await readFile(join(directory, "dependency-audit.json"), "utf8"));
      expect(disk).toEqual(audit.dependencyAudit);
      expect(disk.checks.map((check: { checkId: string }) => check.checkId)).toEqual(["DEPENDENCY_AUDIT_REQUIRED"]);
      expect(audit.decision).not.toHaveProperty("mode");
      expect(JSON.parse(await readFile(join(directory, "compatibility.json"), "utf8"))).not.toHaveProperty("mode");
      expect(JSON.parse(await readFile(join(directory, "reports", "release-summary.json"), "utf8")).release).not.toHaveProperty("mode");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("validates packages without a delivery mode field", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bdmv validate package "));
    try {
      await makePackage(directory, { "index.html": "<main>ready</main>" });
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--format", "json"]);
      const audit = JSON.parse(result.stdout.toString());
      expect(audit.decision).not.toHaveProperty("mode");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

function buildSyntheticSup(): Uint8Array {
  const palette = pgsSegment(90_000, 0x14, [0, 0, 1, 235, 128, 128, 255]);
  const object = pgsSegment(90_000, 0x15, [0, 1, 0, 0xc0, 0, 0, 7, 0, 1, 0, 1, 1, 0, 0]);
  return concatBytes(
    palette, object,
    pgsSegment(90_000, 0x16, [0, 4, 0, 3, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]),
    pgsSegment(90_000, 0x80, []),
    pgsSegment(135_000, 0x16, [0, 4, 0, 3, 0, 2, 0, 0, 0, 0, 0]),
    pgsSegment(135_000, 0x80, []),
    palette, object,
    pgsSegment(180_000, 0x16, [0, 4, 0, 3, 0, 3, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]),
    pgsSegment(180_000, 0x80, []),
  );
}

function pgsSegment(pts: number, type: number, payload: number[]): Uint8Array {
  const result = new Uint8Array(13 + payload.length);
  result.set([0x50, 0x47, pts >>> 24, pts >>> 16, pts >>> 8, pts, 0, 0, 0, 0, type, payload.length >>> 8, payload.length], 0);
  result.set(payload, 13);
  return result;
}

function buildSyntheticMnu(): Uint8Array {
  const u16 = (value: number) => Uint8Array.of(value >> 8, value & 255);
  const command = Uint8Array.from({ length: 12 }, (_, index) => index + 1);
  const page = concatBytes(
    Uint8Array.of(1, 0), new Uint8Array(8), Uint8Array.of(0, 0), Uint8Array.of(0, 0), Uint8Array.of(1),
    u16(1), u16(0xffff), Uint8Array.of(0, 1), u16(1), Uint8Array.of(1),
    concatBytes(u16(1), u16(0), Uint8Array.of(0), u16(0), u16(0), u16(0xffff), u16(0xffff), u16(0xffff), u16(0xffff), u16(5), u16(5), Uint8Array.of(0, 6), u16(5), u16(5), Uint8Array.of(0, 9), u16(5), u16(5), u16(1), command),
  );
  const composition = concatBytes(Uint8Array.of(0x80, 0, 0, 0, 1), page);
  const ics = concatBytes(u16(1), u16(1), Uint8Array.of(0), u16(7), Uint8Array.of(0, 0xc0), Uint8Array.of(composition.length >> 16, composition.length >> 8, composition.length), composition);
  const pds = Uint8Array.of(0, 0, 1, 235, 128, 128, 255);
  const ods = concatBytes(u16(5), Uint8Array.of(0, 0xc0, 0, 0, 5, 0, 1, 0, 1, 1));
  return concatBytes(
    mnuSegment(90_000, 0x18, ics),
    mnuSegment(90_000, 0x14, pds),
    mnuSegment(90_000, 0x15, ods),
    mnuSegment(90_000, 0x80, new Uint8Array()),
  );
}

function mnuSegment(pts: number, type: number, payload: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(0x49, 0x47, pts >>> 24, pts >>> 16, pts >>> 8, pts, 0, 0, 0, 0, type, payload.length >>> 8, payload.length & 255), payload);
}

function buildSyntheticClip(missingObject = false, uiModel: 0 | 1 = 0): Uint8Array {
  const u16 = (value: number) => Uint8Array.of(value >> 8, value & 255);
  const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };
  const segment = (type: number, body: Uint8Array) => concat(Uint8Array.of(type, body.length >> 8, body.length & 255), body);
  const pageId = missingObject ? 9 : 5;
  const command = Uint8Array.from({ length: 12 }, (_, i) => i + 1);
  const button = concat(u16(1), u16(0), Uint8Array.of(0), u16(0), u16(0), u16(0xffff), u16(0xffff), u16(0xffff), u16(0xffff), u16(pageId), u16(pageId), Uint8Array.of(0, 6), u16(pageId), u16(pageId), Uint8Array.of(0, 9), u16(pageId), u16(pageId), u16(1), command);
  const page = concat(Uint8Array.of(1, 0), new Uint8Array(8), Uint8Array.of(0, 0), Uint8Array.of(0, 0), Uint8Array.of(1), u16(1), u16(0xffff), Uint8Array.of(0, 1), u16(1), Uint8Array.of(1), button);
  const composition = concat(Uint8Array.of(uiModel === 1 ? 0xc0 : 0x80, 0, 0, 0, 1), page);
  const ics = concat(u16(1), u16(1), Uint8Array.of(0), u16(7), Uint8Array.of(0, 0xc0), Uint8Array.of(composition.length >> 16, composition.length >> 8, composition.length), composition);
  const pds = Uint8Array.of(0, 0, 1, 235, 128, 128, 255);
  const ods = concat(u16(5), Uint8Array.of(0, 0xc0, 0, 0, 5, 0, 1, 0, 1, 1));
  const ig = concat(segment(0x18, ics), segment(0x14, pds), segment(0x15, ods), segment(0x80, new Uint8Array()));
  const pesLength = 8 + ig.length;
  const pes = new Uint8Array(14 + ig.length); pes.set([0, 0, 1, 0xbd, pesLength >> 8, pesLength & 255, 0x80, 0x80, 5], 0); pes.set(encodeTimestampForFixture(90_000n), 9); pes.set(ig, 14);
  const packet = (pid: number, payload: Uint8Array, cc: number, pusi: boolean) => { const out = new Uint8Array(192); out.fill(0xff); const ts = out.subarray(4); ts[0] = 0x47; ts[1] = (pusi ? 0x40 : 0) | (pid >> 8); ts[2] = pid; ts[3] = 0x10 | cc; ts.set(payload, 4); return out; };
  const section = (data: Uint8Array) => { let crc = 0xffffffff; for (const byte of data) { crc ^= byte << 24; for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1; } crc >>>= 0; return concat(data, Uint8Array.of(crc >>> 24, crc >>> 16, crc >>> 8, crc)); };
  const pat = section(Uint8Array.of(0, 0xb0, 0x0d, 0, 1, 0xc1, 0, 0, 0, 1, 0xe1, 0));
  const pmt = section(Uint8Array.of(2, 0xb0, 0x12, 0, 1, 0xc1, 0, 0, 0xe1, 0, 0xf0, 0, 0x91, 0xe1, 0x20, 0xf0, 0));
  return concat(packet(0, concat(Uint8Array.of(0), pat), 0, true), packet(0x100, concat(Uint8Array.of(0), pmt), 0, true), packet(0x120, pes, 0, true));
}

function playPlaylistCommand(playlist: number): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x22800000, false); // PLAY_PL with an immediate playlist number.
  view.setUint32(4, playlist, false);
  return bytes;
}

function buildSyntheticClipWithTwoCompositions(): Uint8Array {
  const first = buildSyntheticClip();
  const second = first.slice(384);
  second[7] = 0x11; // Next continuity counter for the IGS PID.
  new DataView(second.buffer, second.byteOffset, second.byteLength).setUint16(30, 8, false); // Change ICS composition number.
  return concatBytes(first, second);
}

function buildSyntheticClipWithDuplicateSceneIds(): Uint8Array {
  const first = buildSyntheticClip();
  const second = first.slice(384);
  second[7] = 0x11; // Same PTS and ICS composition, with a distinct packet source offset.
  return concatBytes(first, second);
}

function buildSyntheticClipWithTwoIgPids(): Uint8Array {
  const original = buildSyntheticClip();
  const pmtPacket = original.slice(192, 384);
  const sectionStart = 9; // M2TS prefix, TS header, and pointer field.
  const oldSectionLength = ((pmtPacket[sectionStart + 1]! & 0x0f) << 8) | pmtPacket[sectionStart + 2]!;
  const oldSection = pmtPacket.slice(sectionStart, sectionStart + oldSectionLength + 3);
  const body = concatBytes(oldSection.slice(0, -4), Uint8Array.of(0x91, 0xe1, 0x21, 0xf0, 0));
  body[2] = oldSection[2]! + 5;
  const pmtSection = withMpegCrc(body);
  pmtPacket.fill(0xff, sectionStart);
  pmtPacket.set(pmtSection, sectionStart);
  original.set(pmtPacket, 192);
  const secondIgPacket = original.slice(384);
  secondIgPacket[6] = 0x21; // PID 0x121; the original packet remains on PID 0x120.
  secondIgPacket[7] = 0x10;
  return concatBytes(original, secondIgPacket);
}

function withMpegCrc(data: Uint8Array): Uint8Array {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  crc >>>= 0;
  return concatBytes(data, Uint8Array.of(crc >>> 24, crc >>> 16, crc >>> 8, crc));
}

function buildM1ClipInfoWithTwoIgsCues(): Uint8Array {
  const original = buildM1ClipInfoWithIgsCue();
  const out = new Uint8Array(original.length + 8);
  out.set(original.subarray(0, 90));
  out.set([0x01, 0x21, 5, 0x91, 0x65, 0x6e, 0x67, 0], 90);
  out.set(original.subarray(90), 98);
  const view = new DataView(out.buffer);
  view.setUint32(16, 102, false); // CPI section moved by the additional program stream.
  view.setUint32(60, 34, false); // ProgramInfo grew by one eight-byte stream record.
  out[72] = 3; // The program now declares audio and two IGS PIDs.
  return out;
}

function buildMenuIgsPlaylist(declareMplsIg = true): Uint8Array {
  const original = buildM1PlaylistWithAudioPid();
  if (!declareMplsIg) {
    const out = original.slice();
    out.set([0x30, 0x30, 0x30, 0x30, 0x32], 92);
    return out;
  }
  const out = new Uint8Array(original.length + 10);
  out.set(original.subarray(0, 150));
  out.set([3, 1, 0x01, 0x20, 5, 0x91, 0x65, 0x6e, 0x67, 0], 150);
  out.set(original.subarray(150), 160);
  out.set([0x30, 0x30, 0x30, 0x30, 0x32], 92); // PlayItem clip 00002.
  new DataView(out.buffer).setUint32(12, 160, false); // Mark section moved by the added stream record.
  new DataView(out.buffer).setUint32(80, 76, false); // Playlist section grew by ten bytes.
  new DataView(out.buffer).setUint16(90, 68, false); // PlayItem record grew by ten bytes.
  new DataView(out.buffer).setUint16(124, 34, false); // STN section grew by ten bytes.
  out[131] = 1; // One primary IGS stream.
  return out;
}

function buildMenuPlaylistWithRepeatedUnannotatedPlayItem(): Uint8Array {
  const original = buildMenuIgsPlaylist();
  const baseItem = buildM1PlaylistWithAudioPid().slice(90, 150);
  baseItem.set([0x30, 0x30, 0x30, 0x30, 0x32], 2); // Same clip 00002, no MPLS IG entry on this item.
  const out = new Uint8Array(original.length + baseItem.length);
  out.set(original.subarray(0, 160));
  out.set(baseItem, 160);
  out.set(original.subarray(160), 160 + baseItem.length);
  const view = new DataView(out.buffer);
  view.setUint32(12, 220, false); // Mark section moved past the second PlayItem.
  view.setUint32(80, 136, false); // Playlist section grew by sixty bytes.
  view.setUint16(86, 2, false); // Two PlayItems.
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

describe("compare command", () => {
  const cli = resolve(root, "dist/index.js");
  const inputSequence = (fixtureId: string): Record<string, unknown> => ({
    fixtureId,
    sourceLabel: "synthetic fixture",
    playerProfile: { menuLanguage: "eng", audioLanguage: "eng", subtitleLanguage: "eng", country: "US", region: "A", outputProfile: "portable", videoProfiles: ["hd"], audioProfiles: ["stereo"] },
    initialRegisters: { 1: 0 },
    stableEntry: "title-0",
    seed: 7,
    events: [{ at90k: "0", type: "play" }],
  });
  const trace = (opcode: string): Array<Record<string, unknown>> => [{ pc: 0, opcode, registers: { 1: 0 } }];

  async function workspace(): Promise<string> {
    return mkdtemp(join(tmpdir(), "bdmv2web-compare-"));
  }
  async function writeJson(directory: string, name: string, value: unknown): Promise<string> {
    const path = join(directory, name);
    await writeFile(path, JSON.stringify(value));
    return path;
  }
  function runCompare(input: string, args: string[]): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, [cli, "compare", input, ...args], { encoding: "utf8" });
  }

  it("passes with exit 0 when the reference trace matches", async () => {
    const directory = await workspace();
    try {
      const input = await writeJson(directory, "input.json", inputSequence("synthetic-pass"));
      const actual = await writeJson(directory, "actual.json", trace("PLAY_PL"));
      const reference = await writeJson(directory, "reference.json", trace("PLAY_PL"));
      const result = runCompare(input, ["--actual", actual, "--reference", reference, "--reference-tool", "libbluray", "--reference-version", "1.5.0"]);
      expect(result.status).toBe(0);
      expect(JSON.parse(String(result.stdout))).toMatchObject({
        result: "pass",
        fixtureId: "synthetic-pass",
        referenceTool: { name: "libbluray", version: "1.5.0" },
      });
      expect(String(result.stderr)).toBe("");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("reports the first divergence with exit 1", async () => {
    const directory = await workspace();
    try {
      const input = await writeJson(directory, "input.json", inputSequence("synthetic-diff"));
      const actual = await writeJson(directory, "actual.json", trace("PLAY_PL_ITEM"));
      const reference = await writeJson(directory, "reference.json", trace("PLAY_PL"));
      const result = runCompare(input, ["--actual", actual, "--reference", reference, "--reference-tool", "libbluray", "--reference-version", "1.5.0"]);
      expect(result.status).toBe(1);
      const report = JSON.parse(String(result.stdout));
      expect(report.result).toBe("fail");
      expect(report.comparison).toMatchObject({ equal: false, index: 0 });
      expect(report.comparison.differingFields).toContain("/opcode");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("reports not-verified with exit 2 when no reference trace is supplied", async () => {
    const directory = await workspace();
    try {
      const input = await writeJson(directory, "input.json", inputSequence("synthetic-missing"));
      const actual = await writeJson(directory, "actual.json", trace("PLAY_PL"));
      const result = runCompare(input, ["--actual", actual]);
      expect(result.status).toBe(2);
      const report = JSON.parse(String(result.stdout));
      expect(report.result).toBe("not-verified");
      expect(report.referenceTrace).toBeNull();
      expect(report.reason).toMatch(/reference/i);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects a reference that is the actual trace file", async () => {
    const directory = await workspace();
    try {
      const input = await writeJson(directory, "input.json", inputSequence("synthetic-self"));
      const actual = await writeJson(directory, "actual.json", trace("PLAY_PL"));
      const result = runCompare(input, ["--actual", actual, "--reference", actual, "--reference-version", "1.5.0"]);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain("COMPARE_REFERENCE_NOT_INDEPENDENT");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects an invalid input sequence and a missing actual trace", async () => {
    const directory = await workspace();
    try {
      const input = await writeJson(directory, "input.json", { fixtureId: "x", sourceLabel: "y" });
      const actual = await writeJson(directory, "actual.json", trace("PLAY_PL"));
      expect(runCompare(input, ["--actual", actual])).toMatchObject({ status: 1 });
      expect(String(runCompare(input, ["--actual", actual]).stderr)).toContain("COMPARE_INPUT_INVALID");

      const valid = await writeJson(directory, "valid.json", inputSequence("synthetic-invalid"));
      const missing = runCompare(valid, ["--actual", join(directory, "absent.json")]);
      expect(missing.status).toBe(1);
      expect(String(missing.stderr)).toContain("COMPARE_ACTUAL_INVALID");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("writes the same report to --out as to stdout", async () => {
    const directory = await workspace();
    try {
      const input = await writeJson(directory, "input.json", inputSequence("synthetic-out"));
      const actual = await writeJson(directory, "actual.json", trace("PLAY_PL"));
      const reference = await writeJson(directory, "reference.json", trace("PLAY_PL"));
      const out = join(directory, "reports", "compare.json");
      const result = runCompare(input, ["--actual", actual, "--reference", reference, "--reference-tool", "libbluray", "--reference-version", "1.5.0", "--out", out]);
      expect(result.status).toBe(0);
      expect(JSON.parse(await readFile(out, "utf8"))).toEqual(JSON.parse(String(result.stdout)));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("offline validate CLI (M6)", () => {
  const cli = resolve(root, "dist/index.js");

  async function makePackage(directory: string, payload: Record<string, string>): Promise<void> {
    const files = [];
    for (const [path, content] of Object.entries(payload)) {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      const bytes = Buffer.from(content);
      await writeFile(target, bytes);
      files.push({ path, kind: path.endsWith(".html") ? "html" : path.endsWith(".js") ? "runtime" : "asset", byteLength: String(bytes.length) });
    }
    files.sort((a, b) => a.path.localeCompare(b.path, "en"));
    await writeFile(join(directory, "manifest.json"), JSON.stringify({ schemaVersion: "1.0", status: "complete", files }));
  }
  function validate(directory: string, options: { env?: NodeJS.ProcessEnv } = {}) {
    return spawnSync(process.execPath, [cli, "validate", directory, "--offline", "--format", "json"], { encoding: "utf8", ...(options.env ? { env: options.env } : {}) });
  }

  it("fails when the startup file or a required asset is missing", async () => {
    const missingAsset = await mkdtemp(join(tmpdir(), "bdmv validate missing asset "));
    const unlistedStartup = await mkdtemp(join(tmpdir(), "bdmv validate unlisted startup "));
    try {
      await makePackage(missingAsset, { "index.html": "<main>ready</main>", "assets/menu.png": "png" });
      await rm(join(missingAsset, "assets", "menu.png"));
      const missing = validate(missingAsset);
      expect(missing.status).toBe(1);
      const missingChecks = JSON.parse(String(missing.stdout)).checks as Array<{ checkId: string; result: string; path?: string }>;
      expect(missingChecks).toContainEqual(expect.objectContaining({ checkId: "PACKAGE_MISSING_ASSET", result: "fail", path: "assets/menu.png" }));

      await makePackage(unlistedStartup, { "assets/menu.png": "png" });
      await writeFile(join(unlistedStartup, "index.html"), "<main>ready</main>");
      const unlisted = validate(unlistedStartup);
      expect(unlisted.status).toBe(1);
      const unlistedChecks = JSON.parse(String(unlisted.stdout)).checks as Array<{ checkId: string; result: string }>;
      expect(unlistedChecks).toContainEqual(expect.objectContaining({ checkId: "PACKAGE_ENTRY_UNLISTED", result: "fail" }));
    } finally {
      await rm(missingAsset, { recursive: true, force: true });
      await rm(unlistedStartup, { recursive: true, force: true });
    }
  });

  it("accepts declared STREAM targets and rejects undeclared external targets", async () => {
    const declared = await mkdtemp(join(tmpdir(), "bdmv validate external ok "));
    const escaped = await mkdtemp(join(tmpdir(), "bdmv validate external escape "));
    const targets = (streamPath: string) => JSON.stringify({ playlists: [{ id: "00007", items: [{ clipId: "00002", streamPath }] }] });
    try {
      await makePackage(declared, {
        "index.html": "<main>ready</main>",
        "external-targets.json": targets("STREAM/00002.m2ts"),
        "runtime/bdmv-config.js": 'globalThis.__BDMV_BDMV_PATH__="/fake/BDMV";\n',
        "compatibility.json": JSON.stringify({ externalDependencies: ["configured BDMV STREAM files", "IINA 1.4.4 or later on macOS or PotPlayer on Windows"] }),
      });
      const declaredManifestPath = join(declared, "manifest.json");
      const declaredManifest = JSON.parse(await readFile(declaredManifestPath, "utf8"));
      declaredManifest.files = declaredManifest.files.filter((file: { path: string }) => file.path !== "compatibility.json");
      declaredManifest.files.find((file: { path: string }) => file.path === "runtime/bdmv-config.js").kind = "external-config";
      await writeFile(declaredManifestPath, JSON.stringify(declaredManifest));
      const ok = validate(declared);
      expect(ok.status, ok.stdout).toBe(0);
      const audit = JSON.parse(String(ok.stdout));
      expect(audit.checks).toContainEqual(expect.objectContaining({ checkId: "EXTERNAL_TARGETS_DECLARED", result: "pass", path: "external-targets.json" }));
      expect(audit.checks).toContainEqual(expect.objectContaining({ checkId: "EXTERNAL_SOURCE_UNVERIFIED", result: "not-verified", path: "external-targets.json" }));
      expect(audit.checks).toContainEqual(expect.objectContaining({ checkId: "EXTERNAL_PLAYER_PROTOCOL_UNVERIFIED", result: "not-verified", path: "external-targets.json" }));
      expect(audit.checks).toContainEqual(expect.objectContaining({ checkId: "EXTERNAL_CONFIG", result: "not-verified", path: "runtime/bdmv-config.js" }));
      expect(audit.checks.some((check: { checkId: string; path?: string }) => check.checkId === "PACKAGE_MISSING_ASSET" && check.path === "STREAM/00002.m2ts")).toBe(false);
      expect(audit.releaseSummary.release.gaps).toContainEqual(expect.objectContaining({ checkId: "EXTERNAL_SOURCE_UNVERIFIED", result: "not-verified", path: "external-targets.json" }));
      expect(audit.releaseSummary.release.gaps).toContainEqual(expect.objectContaining({ checkId: "EXTERNAL_CONFIG", result: "not-verified", path: "runtime/bdmv-config.js" }));
      expect(audit.releaseSummary.compatibility.externalDependencies).toEqual(["configured BDMV STREAM files", "IINA 1.4.4 or later on macOS or PotPlayer on Windows"]);
      expect(audit.releaseSummary.compatibility.notVerified).toEqual(expect.arrayContaining(["EXTERNAL_SOURCE_UNVERIFIED", "EXTERNAL_CONFIG", "EXTERNAL_PLAYER_PROTOCOL_UNVERIFIED"]));
      const savedSummary = JSON.parse(await readFile(join(declared, "reports", "release-summary.json"), "utf8"));
      expect(savedSummary.release.gaps).toContainEqual(expect.objectContaining({ checkId: "EXTERNAL_PLAYER_PROTOCOL_UNVERIFIED", result: "not-verified", path: "external-targets.json" }));

      await makePackage(escaped, { "index.html": "<main>ready</main>", "external-targets.json": targets("../../etc/passwd") });
      const bad = validate(escaped);
      expect(bad.status).toBe(1);
      const badChecks = JSON.parse(String(bad.stdout)).checks as Array<{ checkId: string; result: string }>;
      expect(badChecks).toContainEqual(expect.objectContaining({ checkId: "EXTERNAL_TARGET_UNDECLARED", result: "fail", path: "external-targets.json/playlists/0/items/0" }));
      expect(JSON.parse(String(bad.stdout)).decision.status).toBe("failed");
    } finally {
      await rm(declared, { recursive: true, force: true });
      await rm(escaped, { recursive: true, force: true });
    }
  });

  it("audits a moved package on a unicode path without ffmpeg on PATH", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv validate moved "));
    try {
      const original = join(parent, "original");
      await mkdir(original);
      await makePackage(original, { "index.html": "<main>ready</main>", "runtime/app.js": "globalThis.__APP__=1;\n" });
      const moved = join(parent, "移动 后 的 包");
      await rename(original, moved);
      const result = validate(moved, { env: { ...process.env, PATH: "/nonexistent" } });
      expect(result.status).toBe(0);
      const audit = JSON.parse(String(result.stdout));
      expect(audit.checks.filter((check: { result: string }) => check.result === "fail")).toEqual([]);
      expect(audit.dependencyAudit.status).toBe("pass");
      expect(audit.decision).toMatchObject({ status: "complete", exitCode: 0 });
      expect(JSON.parse(await readFile(join(moved, "reports", "release-summary.json"), "utf8")).release.status).toBe("complete");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});
