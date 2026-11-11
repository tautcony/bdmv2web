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
  });
  const audit = await auditOutputPackage(root);
  expect(audit.checks).not.toContainEqual(expect.objectContaining({ checkId: "BUNDLE_NETWORK_API", result: "fail" }));
  expect(audit.checks).toContainEqual(expect.objectContaining({ checkId: "OFFLINE_STATIC_AUDIT", result: "pass" }));
});

async function packageRoot(launchMode: string, runtimeFiles: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bdmv-package-audit-"));
  temporaryRoots.push(root);
  await writeFile(join(root, "index.html"), "<!doctype html><html><body></body></html>");
  for (const [path, contents] of Object.entries(runtimeFiles)) {
    const target = join(root, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  await writeFile(join(root, "manifest.json"), JSON.stringify({
    schemaVersion: "1.0", status: "partial", launchMode,
    files: ["index.html", ...Object.keys(runtimeFiles)].map((path) => ({ path, kind: path.endsWith(".html") ? "html" : "runtime", required: true })),
  }));
  return root;
}
