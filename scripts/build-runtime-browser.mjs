import { build } from "esbuild";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/** The menu runtime is a browser IIFE that reads its data from globals at run time. */
await build({
  entryPoints: [resolve(root, "packages/runtime-web/src/browser.ts")],
  outfile: resolve(root, "packages/runtime-web/dist/browser.bundle.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  legalComments: "none",
  alias: {
    "@bdmv2web/hdmv": resolve(root, "packages/hdmv/src/index.ts"),
    "@bdmv2web/media-export/external-targets": resolve(root, "packages/media-export/src/external-targets.ts"),
  },
});
