import { build } from "esbuild";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
await build({
  entryPoints: [resolve(root, "packages/core/src/browser.ts")],
  outfile: resolve(root, "packages/core/dist/browser.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  metafile: true,
}).then(async (result) => {
  const imports = Object.values(result.metafile.outputs).flatMap((output) => output.imports);
  if (imports.some((item) => item.path.startsWith("node:") || item.path === "fs" || item.path === "path" || item.path === "crypto")) {
    throw new Error("Browser core bundle contains a Node built-in import");
  }
});
