import { existsSync, readFileSync } from "node:fs";
import type { PngBatch } from "./asset-batches.js";
import type { MenuPackageStatus } from "./types.js";

const templateDirectory = existsSync(new URL("./templates/index.html", import.meta.url)) ? "./templates/" : "../templates/";
const PACKAGE_TEMPLATES = {
  menuIndex: readFileSync(new URL(`${templateDirectory}index.html`, import.meta.url), "utf8"),
  style: readFileSync(new URL(`${templateDirectory}style.css`, import.meta.url), "utf8"),
  readme: readFileSync(new URL(`${templateDirectory}README.md`, import.meta.url), "utf8"),
};

function renderTemplate(template: string, values: Record<string, string>, sections: Record<string, boolean> = {}): string {
  const withSections = template.replace(/\{\{#([A-Z_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match, name: string, contents: string) => sections[name] ? contents : "");
  return withSections.replace(/\{\{([A-Z_]+)\}\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Template value '${name}' is not defined.`);
    return value;
  });
}

/** Serialize data for a classic script. Escaping '<' also prevents HTML script termination. */
export function serializeSafeScriptData(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item instanceof Uint8Array ? [...item].map((byte) => byte.toString(16).padStart(2, "0")).join("") : item).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** The stage fills the viewport and letterboxes the scene inside itself: the
 * page shows no chrome of its own, and the disc title is only the document title.
 * The inline aspect-ratio is a fallback hint if the full-viewport sizing is disabled. */
export function createMenuIndexHtml(title: string, assetBatchCount = 0, sceneSize?: { width: number; height: number }, externalPlayback = false, bdjRuntime = false): string {
  const safeTitle = escapeHtml(title);
  const assets = Array.from({ length: assetBatchCount }, (_, i) => `<script defer src="runtime/assets-data-${String(i).padStart(3, "0")}.js"></script>`).join("\n  ");
  return renderTemplate(PACKAGE_TEMPLATES.menuIndex, {
    TITLE: safeTitle,
    ASSET_SCRIPTS: assets,
    SCENE_ASPECT_RATIO: sceneSize ? `${sceneSize.width} / ${sceneSize.height}` : "",
  }, {
    EXTERNAL_PLAYBACK: externalPlayback,
    BDJ_RUNTIME: bdjRuntime,
    HAS_ASSET_BATCHES: assetBatchCount > 0,
    HAS_SCENE_SIZE: sceneSize !== undefined,
  }).replace(/\n{3,}/g, "\n\n");
}

export function createDataScript(ir: unknown): string {
  return `globalThis.__BDMV_MENU_DATA__=${serializeSafeScriptData(ir)};\n`;
}

export function createAssetBatchScript(batch: PngBatch): string {
  return `globalThis.__BDMV_MENU_ASSETS__=globalThis.__BDMV_MENU_ASSETS__||[];globalThis.__BDMV_MENU_ASSETS__[${batch.index}]=${serializeSafeScriptData(batch.assets)};\n`;
}

export function createReadme(title: string, backgroundLoops: boolean | undefined, externalPlayback: boolean, status: MenuPackageStatus = "partial", bdjRuntime = false): string {
  const rendered = renderTemplate(PACKAGE_TEMPLATES.readme, {
    TITLE: title.replace(/[\r\n]/g, " "),
    STATUS: status,
  }, {
    BACKGROUND_LOOP: backgroundLoops === true,
    BACKGROUND_SINGLE_PLAY_ITEM: backgroundLoops === false,
    BACKGROUND_UNAVAILABLE: backgroundLoops === undefined,
    BDJ_RUNTIME: bdjRuntime,
    EXTERNAL_PLAYBACK: externalPlayback,
    STATIC_EXTERNAL_PLAYBACK: externalPlayback && !bdjRuntime,
    BDJ_EXTERNAL_PLAYBACK: externalPlayback && bdjRuntime,
  });
  return rendered.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function packagedStyle(): string { return PACKAGE_TEMPLATES.style; }

function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
