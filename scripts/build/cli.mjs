import { build } from "esbuild";
import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { writeBuildMode } from "../bench/store/build-mode.mjs";
import { buildBdjHostApi } from "./bdj-host.mjs";

const root = resolve(import.meta.dirname, "../..");
const cliDist = resolve(root, "apps/cli/dist");
const profilingBuild = process.env.BDMV2WEB_PROFILE_BUILD === "1";

/** Publish layout: the CLI entry, inspection worker, and packaged menu runtime assets. */
await rm(cliDist, { recursive: true, force: true });
await build({
  entryPoints: [resolve(root, "apps/cli/src/index.ts")],
  outfile: resolve(cliDist, "index.js"),
  bundle: true,
  // Ink resolves terminal sizing, native layout, and React peers at runtime.
  external: ["ink", "react", "@inkjs/ui"],
  platform: "node",
  format: "esm",
  target: "node22",
  ...(profilingBuild ? { sourcemap: true } : {}),
  legalComments: "none",
});
await build({
  entryPoints: [resolve(root, "apps/cli/src/commands/inspect-collection-worker.ts")],
  outfile: resolve(cliDist, "inspect-collection-worker.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
});
await mkdir(resolve(cliDist, "runtime"), { recursive: true });
await cp(resolve(root, "packages/runtime-web/dist/browser.bundle.js"), resolve(cliDist, "runtime/app.bundle.js"));
await cp(resolve(root, "packages/runtime-web/dist/bdj-client.bundle.js"), resolve(cliDist, "runtime/bdj-client.bundle.js"));
await buildBdjHostApi(resolve(cliDist, "runtime/bdj-host-api.jar"));
await cp(resolve(root, "packages/package-builder/templates"), resolve(cliDist, "templates"), { recursive: true });
await chmod(resolve(cliDist, "index.js"), 0o755);
await writeBuildMode(cliDist, profilingBuild);
