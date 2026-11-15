import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { auditOutputPackage } from "./package-audit.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("keeps the static HDMV bundle free of local-session transport", async () => {
  const root = await packageRoot("hdmv", { "runtime/app.bundle.js": `fetch("/api/bdj/start");` });
  const audit = await auditOutputPackage(root);
  expect(audit.checks).toContainEqual(expect.objectContaining({ checkId: "BUNDLE_NETWORK_API", result: "fail", path: "runtime/app.bundle.js" }));
});

it("allows literal same-origin transport in the local-jvm client bundle", async () => {
  const root = await packageRoot("local-jvm", {
    "runtime/app.bundle.js": "globalThis.staticMenu = true;",
    "runtime/bdj-client.js": `fetch("/api/bdj/start", { method: "POST" }); new EventSource("/api/bdj/events");`,
    "asset-manifest.json": JSON.stringify({ schemaVersion: "1.0", bdjFiles: [], pgsTracks: [] }),
  });
  const audit = await auditOutputPackage(root);
  expect(audit.checks).not.toContainEqual(expect.objectContaining({ checkId: "BUNDLE_NETWORK_API", result: "fail" }));
  // A package the audit can fully read reports only passing checks: no
  // placeholder "not verified" entry stands in for evidence it never collects.
  expect(audit.checks.filter((check) => check.result !== "pass")).toEqual([]);
});

it("requires a listed, parsable asset-manifest.json for a local-jvm package", async () => {
  const valid = await packageRoot("local-jvm", { "asset-manifest.json": JSON.stringify({ schemaVersion: "1.0", bdjFiles: [] }) });
  expect((await auditOutputPackage(valid)).checks.filter((check) => check.checkId.startsWith("PACKAGE_RUNTIME_INDEX"))).toEqual([]);

  const missing = await packageRoot("local-jvm", {});
  expect((await auditOutputPackage(missing)).checks).toContainEqual(expect.objectContaining({ checkId: "PACKAGE_RUNTIME_INDEX_MISSING", result: "fail" }));

  const invalid = await packageRoot("local-jvm", { "asset-manifest.json": "not json" });
  expect((await auditOutputPackage(invalid)).checks).toContainEqual(expect.objectContaining({ checkId: "PACKAGE_RUNTIME_INDEX_INVALID", result: "fail", path: "asset-manifest.json" }));

  const unlisted = await packageRoot("local-jvm", { "asset-manifest.json": JSON.stringify({ schemaVersion: "1.0" }) }, ["index.html"]);
  expect((await auditOutputPackage(unlisted)).checks).toContainEqual(expect.objectContaining({ checkId: "PACKAGE_RUNTIME_INDEX_UNLISTED", result: "fail" }));
});

it("keeps an HDMV package valid with the legacy unlisted asset manifest", async () => {
  const root = await packageRoot("hdmv", { "asset-manifest.json": JSON.stringify({ schemaVersion: "1.0", bdjFiles: [] }) }, ["index.html"]);
  const audit = await auditOutputPackage(root);
  expect(audit.checks.filter((check) => check.checkId.startsWith("PACKAGE_RUNTIME_INDEX"))).toEqual([]);
  expect(audit.checks.filter((check) => check.checkId === "MANIFEST_PATH_RESERVED")).toEqual([]);
});

it("reports only setAttribute calls whose attribute can carry a URL", async () => {
  const root = await packageRoot("hdmv", {
    "runtime/app.bundle.js": `el.setAttribute("aria-label", label); el.setAttribute("readonly", ""); el.setAttribute("src", nextUrl);`,
  });
  const sinks = (await auditOutputPackage(root)).checks.filter((check) => check.checkId === "BUNDLE_DYNAMIC_URL_SINK");
  expect(sinks).toHaveLength(1);
  expect(sinks[0]).toMatchObject({ result: "not-verified", evidence: { expression: expect.stringContaining('"src"') } });
});

async function packageRoot(launchMode: string, runtimeFiles: Record<string, string>, listedFiles?: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bdmv-package-audit-"));
  temporaryRoots.push(root);
  await writeFile(join(root, "index.html"), "<!doctype html><html><body></body></html>");
  for (const [path, contents] of Object.entries(runtimeFiles)) {
    const target = join(root, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  const listed = listedFiles ?? ["index.html", ...Object.keys(runtimeFiles)];
  await writeFile(join(root, "manifest.json"), JSON.stringify({
    schemaVersion: "1.0", status: "partial", launchMode,
    files: listed.map((path) => ({ path, kind: path.endsWith(".html") ? "html" : path === "asset-manifest.json" ? "runtime-index" : "runtime", required: true })),
  }));
  return root;
}
