import { build } from "esbuild";
import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cliDist = resolve(root, "apps/cli/dist");

/** Publish layout: one ESM entry plus the menu runtime the entry reads at packaging time. */
await rm(cliDist, { recursive: true, force: true });
await build({
  entryPoints: [resolve(root, "apps/cli/src/index.ts")],
  outfile: resolve(cliDist, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
});
await mkdir(resolve(cliDist, "runtime"), { recursive: true });
await cp(resolve(root, "packages/runtime-web/dist/browser.bundle.js"), resolve(cliDist, "runtime/app.bundle.js"));
await chmod(resolve(cliDist, "index.js"), 0o755);
