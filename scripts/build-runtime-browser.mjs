import { build } from "esbuild";
import { resolve } from "node:path";
import { writeBuildMode } from "./bench/build-mode.mjs";

const root = resolve(import.meta.dirname, "..");
const profilingBuild = process.env.BDMV2WEB_PROFILE_BUILD === "1";

/** The menu runtime is a browser IIFE that reads its data from globals at run time. */
await build({
  entryPoints: [resolve(root, "packages/runtime-web/src/browser.ts")],
  outfile: resolve(root, "packages/runtime-web/dist/browser.bundle.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  ...(profilingBuild ? { sourcemap: "inline" } : {}),
  legalComments: "none",
  alias: {
    "@bdmv2web/hdmv": resolve(root, "packages/hdmv/src/index.ts"),
    "@bdmv2web/media-export/external-targets": resolve(root, "packages/media-export/src/external-targets.ts"),
  },
});
await writeBuildMode(resolve(root, "packages/runtime-web/dist"), profilingBuild);
