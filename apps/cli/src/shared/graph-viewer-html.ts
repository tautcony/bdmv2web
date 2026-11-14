import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViewerPayload } from "@bdmv2web/media-export/diagram/viewer-data";

let d3ForceBundle: string | null = null;

/**
 * The d3-force UMD stack, inlined so the viewer stays offline-usable.
 * d3-force's own dist expects sibling d3 packages at runtime, so its
 * self-contained dependencies are inlined ahead of it; each merges into
 * `window.d3`.
 */
const D3_FORCE_PACKAGES = ["d3-dispatch", "d3-quadtree", "d3-timer", "d3-force"] as const;

function d3ForceScript(): string {
  if (d3ForceBundle === null) {
    const require = createRequire(import.meta.url);
    d3ForceBundle = D3_FORCE_PACKAGES.map((name) => {
      const entry = require.resolve(name); // <pkg>/dist/<name>.mjs
      return readFileSync(join(dirname(entry), `${name}.min.js`), "utf8").replace(/<\/script/gi, "<\\/script");
    }).join("\n");
  }
  return d3ForceBundle;
}

/**
 * The viewer sources live as plain text assets next to this module. The
 * relative path is identical in src (tsx) and dist (tsc), and the build copies
 * the directory into dist so the compiled CLI finds them too.
 */
function viewerAsset(name: string): string {
  return readFileSync(fileURLToPath(new URL(`graph-viewer/${name}`, import.meta.url)), "utf8");
}

/**
 * Self-contained interactive navigation-graph viewer. The payload is inlined
 * as a JSON data island, the layout and rendering run on plain DOM APIs (the
 * elastic layout runs on the inlined d3-force), and no external resource is
 * referenced, so the file works from file://.
 */
export function renderGraphViewerHtml(payload: ViewerPayload): string {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  // Functional replacements keep `$` sequences inside the payload, styles,
  // runtime and bundle from being read as replacement patterns.
  return viewerAsset("viewer.html")
    .replace("__STYLES__", () => viewerAsset("viewer.css"))
    .replace("__D3_FORCE__", () => d3ForceScript())
    .replace("__PAYLOAD__", () => json)
    .replace("__RUNTIME__", () => viewerAsset("viewer.js"));
}
