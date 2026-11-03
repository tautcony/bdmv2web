import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildM1ClipInfoWithIgsCue, buildM1Index, buildM1MovieObject, buildM1PlaylistWithAudioPid } from "@bdmv-web/test-fixtures";
import { encodeTimestampForFixture } from "@bdmv-web/igs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("menu-only convert CLI", () => {
  it("requires a BDMV input", () => {
    const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "convert"]);
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain("CLI_MISSING_INPUT");
    expect(result.stdout.toString()).toBe("");
  });
  it("accepts only the menu-only mode and requires an output directory", () => {
    const unsupported = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "convert", "input", "--mode", "standalone-full", "--format", "json"]);
    expect(unsupported.status).toBe(1); expect(JSON.parse(unsupported.stderr.toString()).code).toBe("CLI_UNSUPPORTED_MODE");
    const missingOutput = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "convert", "input", "--mode", "menu-only", "--format", "json"]);
    expect(missingOutput.status).toBe(1); expect(JSON.parse(missingOutput.stderr.toString()).code).toBe("CLI_MISSING_OUTPUT");
  });
  it("does not create an output when conversion arguments are invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bdmv cli ")); const target = join(dir, "package");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "convert", "input", "--mode", "menu-only", "--out", target]);
      expect(result.status).toBe(1); await expect(access(target)).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("reports a missing inspect input as a usage error", () => {
    const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "inspect", "--format", "json"]);
    expect(result.status).toBe(1); expect(JSON.parse(result.stderr.toString()).code).toBe("CLI_MISSING_INPUT"); expect(result.stdout.toString()).toBe("");
  });
});

describe("M4 menu-only convert output", () => {
  async function makeMenuDisc(parent: string, includeMenuStream = true): Promise<string> {
    const disc = join(parent, "BDMV");
    await mkdir(join(disc, "PLAYLIST"), { recursive: true });
    await mkdir(join(disc, "CLIPINF"), { recursive: true });
    await mkdir(join(disc, "STREAM"), { recursive: true });
    await writeFile(join(disc, "index.bdmv"), buildM1Index({ first: 0, top: 0 }));
    await writeFile(join(disc, "MovieObject.bdmv"), buildM1MovieObject([]));
    await writeFile(join(disc, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAudioPid());
    await writeFile(join(disc, "CLIPINF", "00001.clpi"), buildM1ClipInfoWithIgsCue());
    if (includeMenuStream) await writeFile(join(disc, "STREAM", "00001.m2ts"), buildSyntheticClip());
    return disc;
  }

  it("writes a local offline menu package that stays partial in default and strict modes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert "));
    const disc = await makeMenuDisc(parent);
    const regular = join(parent, "regular output"); const strict = join(parent, "strict output");
    try {
      for (const [output, args, exitCode] of [
        [regular, [], 0],
        [strict, ["--strict"], 2],
      ] as const) {
        const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "convert", disc, "--mode", "menu-only", "--out", output, "--title", "Offline Menu", ...args]);
        expect(result.status).toBe(exitCode);
        expect(JSON.parse(result.stdout.toString())).toMatchObject({ status: "partial", mode: "menu-only", output: await realpath(output) });
        expect(result.stderr.toString()).toBe("");

        const compatibility = JSON.parse(await readFile(join(output, "compatibility.json"), "utf8"));
        const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
        const assetManifest = JSON.parse(await readFile(join(output, "asset-manifest.json"), "utf8"));
        const readme = await readFile(join(output, "README.md"), "utf8");
        const html = await readFile(join(output, "index.html"), "utf8");
        expect(compatibility).toMatchObject({ mode: "menu-only", status: "partial", externalDependencies: [] });
        expect(manifest).toMatchObject({ mode: "menu-only", status: "partial" });
        expect(assetManifest.schemaVersion).toBe("1.0");
        expect(readme).toMatch(/menu-only preview.*always \*\*partial\*\*/s);
        expect(readme).toContain("Open index.html in Chrome while offline.");
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
        expect(packageText).not.toContain("BDMV/STREAM/00001.m2ts");
        expect(packageText).not.toMatch(/https?:\/\//i);
      }
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("writes a failed report and README instead of a runnable package when no menu scene exists", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv menu convert no scene "));
    const disc = await makeMenuDisc(parent, false); const output = join(parent, "failed output");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "convert", disc, "--mode", "menu-only", "--out", output]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({ status: "failed", code: "MENU_SCENE_NOT_FOUND", output: await realpath(output) });
      expect(JSON.parse(await readFile(join(output, "report.json"), "utf8"))).toMatchObject({ status: "failed", code: "MENU_SCENE_NOT_FOUND", mode: "menu-only" });
      const readme = await readFile(join(output, "README.md"), "utf8");
      expect(readme).toContain("Status: **failed**.");
      expect(readme).toContain("no complete IGS menu scene was found");
      await expect(access(join(output, "index.html"))).rejects.toThrow();
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
    try { const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js"), "inspect", root, "--format", "json"]); expect(result.status).toBe(0); expect(result.stderr.toString()).toBe(""); const parsed = JSON.parse(result.stdout.toString()); expect(parsed.analysisStage).toBe("structural"); expect(parsed.supportPrediction.status).toBe("partial"); expect(parsed.declarations.entries).toBe(4); expect(parsed.entries.map((entry: any) => entry.target.objectType)).toEqual(["HDMV", "HDMV", "HDMV", "BDJ"]); expect(parsed.entries[2].target.target).toBe(3); expect(parsed.entries[3].target).toMatchObject({ objectType: "BDJ", target: "00042", accessType: 2 }); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("extracts only structural artifacts through the output transaction and preserves source bytes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv extract ")); const root = await makeDisc(parent); const target = join(parent, "out");
    try { const beforeIndex = await readFile(join(root, "index.bdmv")); const beforeMobj = await readFile(join(root, "MovieObject.bdmv")); const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js"), "extract", root, "--out", target]); expect(result.status).toBe(0); expect(JSON.parse(result.stdout.toString()).status).toBe("partial"); const disc = JSON.parse(await readFile(join(target, "parsed-disc.json"), "utf8")); expect(disc.analysisStage).toBe("structural"); expect(disc).not.toHaveProperty("sourceFingerprint"); const commands = JSON.parse(await readFile(join(target, "raw-commands.json"), "utf8")); expect(commands).toHaveLength(2); expect(commands[0].source).toMatchObject({ path: "BDMV/MovieObject.bdmv", offset: "54" }); const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8")); expect(manifest.status).toBe("partial"); expect(manifest).not.toHaveProperty("sourceFingerprint"); expect(manifest.files[1]).toMatchObject({ path: "raw-commands.json", kind: "raw-command-table" }); expect(manifest.files[1].sha256).toMatch(/^[a-f0-9]{64}$/); expect(await readFile(join(root, "index.bdmv"))).toEqual(beforeIndex); expect(await readFile(join(root, "MovieObject.bdmv"))).toEqual(beforeMobj); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("does not overwrite an existing inspect output target", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv inspect existing ")); const root = await makeDisc(parent); const target = join(parent, "inspection.json"); await writeFile(target, "keep me\n");
    try { const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js"), "inspect", root, "--format", "json", "--out", target]); expect(result.status).toBe(1); expect(await readFile(target, "utf8")).toBe("keep me\n"); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });
});

describe("IGS extract CLI", () => {
  async function makeIgsDisc(parent: string, clip: Uint8Array): Promise<string> {
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
    await writeFile(join(root, "CLIPINF", "00001.clpi"), buildM1ClipInfoWithIgsCue());
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

  it("exports M4-ready scenes, PNGs, mappings, diagnostics and generated-file manifest entries", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv extract igs "));
    const rootPath = await makeIgsDisc(parent, buildSyntheticClip());
    const target = join(parent, "out");
    try {
      const before = await sourceSnapshot(rootPath);
      const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js"), "extract", rootPath, "--out", target]);
      expect(result.status).toBe(0);
      const scenesDoc = JSON.parse(await readFile(join(target, "scenes.json"), "utf8"));
      expect(scenesDoc.scenes).toHaveLength(1);
      expect(scenesDoc.scenes[0]).toMatchObject({ status: "complete", scene: { width: 1, height: 1 } });
      expect(scenesDoc.scenes[0].raw).toMatchObject({ clipId: "00001", pid: 0x120, complete: true, source: { path: "BDMV/STREAM/00001.m2ts", pid: 0x120 } });
      expect(scenesDoc.scenes[0].scene.pages[0].buttons[0].states.normal.assetId).toMatch(/^igs-/);
      expect(scenesDoc.scenes[0].raw.pages[0].buttons[0].commands[0].bytes).toHaveLength(12);
      const mappings = JSON.parse(await readFile(join(target, "source-map.json"), "utf8"));
      expect(mappings.scenes[0].composition.path).toBe("BDMV/STREAM/00001.m2ts");
      expect(mappings.assets[0]).toMatchObject({ objectId: 5, paletteId: 0, source: { path: "BDMV/STREAM/00001.m2ts", byteOffset: expect.any(String) } });
      const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({ status: "partial", igs: { support: { status: "unverified" } } });
      expect(manifest.limitations).toContain("IGS animation and visual effects are not fully verified");
      expect(manifest.files.map((file: any) => file.path)).toEqual(expect.arrayContaining(["scenes.json", "igs-diagnostics.json", "source-map.json", mappings.assets[0].path]));
      for (const file of manifest.files) {
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(file).not.toHaveProperty("sourceFingerprint");
      }
      expect((await readFile(join(target, mappings.assets[0].path))).subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71]));
      await expectSourceSnapshot(rootPath, before);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps an unresolved scene and diagnostic without writing a transparent placeholder", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv extract igs partial "));
    const rootPath = await makeIgsDisc(parent, buildSyntheticClip(true));
    const target = join(parent, "out");
    try {
      const before = await sourceSnapshot(rootPath);
      const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js"), "extract", rootPath, "--out", target]);
      expect(result.status).toBe(0);
      const scenesDoc = JSON.parse(await readFile(join(target, "scenes.json"), "utf8"));
      expect(scenesDoc.scenes).toHaveLength(1);
      expect(scenesDoc.scenes[0].raw).toMatchObject({ complete: false, pages: [{ buttons: [{ visuals: { normal: { startObjectId: 9 } } }] }] });
      expect(scenesDoc.scenes[0].status).toBe("partial");
      const diagnostics = JSON.parse(await readFile(join(target, "igs-diagnostics.json"), "utf8"));
      expect(diagnostics.diagnostics.some((item: any) => item.code === "UNRESOLVED_OBJECT")).toBe(true);
      const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
      expect(manifest.files.some((file: any) => file.path.startsWith("assets/graphics/"))).toBe(false);
      await expect(access(join(target, "assets", "graphics"))).rejects.toThrow();
      await expectSourceSnapshot(rootPath, before);
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
      files.push({ path, kind: path.endsWith(".html") ? "html" : path.endsWith(".js") ? "runtime" : "asset", byteLength: String(bytes.length), sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    files.sort((a, b) => a.path.localeCompare(b.path, "en"));
    const fingerprint = createHash("sha256");
    for (const file of files) fingerprint.update(file.path, "utf8").update("\0").update(file.sha256, "ascii").update("\n");
    await writeFile(join(directory, "manifest.json"), JSON.stringify({ schemaVersion: "1.0", mode: "standalone-full", status: "complete", files, payloadFingerprint: fingerprint.digest("hex") }));
  }

  it("validates a generated package offline without a BDMV or FFmpeg input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bdmv validate 离线 "));
    try {
      await makePackage(directory, { "index.html": "<main>ready</main>" });
      await writeFile(join(directory, "compatibility.json"), JSON.stringify({ profile: "portable", status: "complete", notVerified: ["direct file:// launch"] }));
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--format", "json"]);
      expect(result.status).toBe(0);
      expect(result.stderr.toString()).toBe("");
      const audit = JSON.parse(result.stdout.toString());
      expect(audit.checks.find((check: any) => check.checkId === "PACKAGE_FILE_HASH")?.result).toBe("pass");
      expect(audit.checks.find((check: any) => check.checkId === "PAYLOAD_FINGERPRINT")?.result).toBe("pass");
      expect(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")).status).toBe("complete");
      expect(audit.dependencyAudit).toMatchObject({ schemaVersion: "1.0", status: "pass", payloadFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(audit.dependencyAudit.checks.some((check: any) => check.checkId === "OFFLINE_STATIC_AUDIT" && check.result === "pass")).toBe(true);
      expect(audit.decision).toMatchObject({ status: "partial", strict: false, exitCode: 0 });
      expect(audit.releaseSummary.release.gaps.map((gap: any) => gap.checkId)).toEqual(expect.arrayContaining(["BROWSER_EVIDENCE_REQUIRED", "REFERENCE_EVIDENCE_REQUIRED", "COVERAGE_ENTRIES", "COVERAGE_INSTRUCTIONS", "COVERAGE_MEDIA", "COVERAGE_TESTS"]));
      const report = JSON.parse(await readFile(join(directory, "dependency-audit.json"), "utf8"));
      expect(report).toEqual(audit.dependencyAudit);
      const compatibility = JSON.parse(await readFile(join(directory, "compatibility.json"), "utf8"));
      expect(compatibility).toMatchObject({ status: "partial", mode: "standalone-full", profile: "portable", payloadFingerprint: audit.payloadFingerprint, notVerified: expect.arrayContaining(["direct file:// launch", "BROWSER_EVIDENCE_REQUIRED", "REFERENCE_EVIDENCE_REQUIRED"]) });
      const release = JSON.parse(await readFile(join(directory, "reports", "release-summary.json"), "utf8"));
      expect(release.release).toEqual(audit.releaseSummary.release);
      const second = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--format", "json"]);
      expect(second.status).toBe(0);
      expect(JSON.parse(second.stdout.toString()).checks.some((check: any) => check.checkId === "PACKAGE_UNLISTED_PAYLOAD")).toBe(false);
      expect(JSON.parse(second.stdout.toString()).releaseSummary.release.status).toBe("partial");
      const strict = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--strict", "--format", "json"]);
      expect(strict.status).toBe(2);
      expect(JSON.parse(strict.stdout.toString()).decision).toMatchObject({ status: "partial", strict: true, exitCode: 2 });
      const noStrict = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--no-strict", "--format", "json"]);
      expect(noStrict.status).toBe(0);
      expect(JSON.parse(noStrict.stdout.toString()).decision.status).toBe("partial");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("returns a failing audit for malformed package fingerprints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bdmv validate invalid "));
    try {
      await makePackage(directory, { "index.html": "<main>ready</main>" });
      const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
      manifest.payloadFingerprint = "broken";
      await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "validate", directory, "--offline", "--format", "json"]);
      expect(result.status).toBe(1);
      const audit = JSON.parse(result.stdout.toString());
      expect(audit.checks.some((check: any) => check.checkId === "PAYLOAD_FINGERPRINT_INVALID")).toBe(true);
      expect(audit.decision).toMatchObject({ status: "failed", exitCode: 1 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

function buildSyntheticClip(missingObject = false): Uint8Array {
  const u16 = (value: number) => Uint8Array.of(value >> 8, value & 255);
  const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };
  const segment = (type: number, body: Uint8Array) => concat(Uint8Array.of(type, body.length >> 8, body.length & 255), body);
  const pageId = missingObject ? 9 : 5;
  const command = Uint8Array.from({ length: 12 }, (_, i) => i + 1);
  const button = concat(u16(1), u16(0), Uint8Array.of(0), u16(0), u16(0), u16(0xffff), u16(0xffff), u16(0xffff), u16(0xffff), u16(pageId), u16(pageId), Uint8Array.of(0, 6), u16(pageId), u16(pageId), Uint8Array.of(0, 9), u16(pageId), u16(pageId), u16(1), command);
  const page = concat(Uint8Array.of(1, 0), new Uint8Array(8), Uint8Array.of(0, 0), Uint8Array.of(0, 0), Uint8Array.of(1), u16(1), u16(0xffff), Uint8Array.of(0, 1), u16(1), Uint8Array.of(1), button);
  const composition = concat(Uint8Array.of(0x80, 0, 0, 0, 1), page);
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
