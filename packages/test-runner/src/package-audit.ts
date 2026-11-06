import { type Dirent } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AuditCheck, DeliveryManifest, ManifestFile, OfflinePackageAudit } from "./types.js";

const PAYLOAD_EXTENSIONS = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".png", ".wav", ".mp4", ".webm", ".vtt"]);
const REPORT_FILES = new Set(["compatibility.json", "dependency-audit.json", "asset-manifest.json", "report.json"]);
const NON_RUNTIME_KINDS = new Set(["parsed-disc", "raw-command-table", "readme", "report", "evidence", "compatibility", "dependency-audit", "asset-manifest"]);
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const comparePath = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function add(checks: AuditCheck[], checkId: string, result: AuditCheck["result"], message: string, path?: string, evidence?: Record<string, unknown>): void {
  checks.push({ checkId, result, message, ...(path === undefined ? {} : { path }), ...(evidence === undefined ? {} : { evidence }) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlayerProfile(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && ["menuLanguage", "audioLanguage", "subtitleLanguage"].every((key) => typeof value[key] === "string" && /^[A-Za-z]{3}$/.test(value[key] as string))
    && typeof value.country === "string" && /^[A-Za-z]{2}$/.test(value.country)
    && ["A", "B", "C"].includes(String(value.region))
    && value.outputProfile === "portable"
    && Array.isArray(value.videoProfiles) && value.videoProfiles.every((item) => typeof item === "string")
    && Array.isArray(value.audioProfiles) && value.audioProfiles.every((item) => typeof item === "string");
}

function samePlayerProfile(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = ["menuLanguage", "audioLanguage", "subtitleLanguage", "country", "region", "outputProfile", "videoProfiles", "audioProfiles"];
  return keys.every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

function parseManifest(value: unknown, checks: AuditCheck[]): DeliveryManifest | null {
  if (!isRecord(value)) { add(checks, "MANIFEST_SCHEMA", "fail", "manifest.json must contain a JSON object", "manifest.json"); return null; }
  if (value.schemaVersion !== "1.0") { add(checks, "MANIFEST_SCHEMA", "fail", "Unsupported or missing package schemaVersion", "manifest.json", { schemaVersion: value.schemaVersion ?? null }); return null; }
  if (!Array.isArray(value.files)) { add(checks, "MANIFEST_SCHEMA", "fail", "files must be an array", "manifest.json/files"); return null; }
  const files: ManifestFile[] = [];
  value.files.forEach((item, index) => {
    if (!isRecord(item) || typeof item.path !== "string" || typeof item.kind !== "string") {
      add(checks, "MANIFEST_SCHEMA", "fail", "Each file needs path and kind strings", `manifest.json/files/${index}`);
      return;
    }
    files.push({ path: item.path, kind: item.kind, ...(typeof item.required === "boolean" ? { required: item.required } : {}) });
  });
  add(checks, "MANIFEST_SCHEMA", checks.some((x) => x.checkId === "MANIFEST_SCHEMA" && x.result === "fail") ? "fail" : "pass", "Validated package manifest shape", "manifest.json");
  return {
    schemaVersion: "1.0",
    files,
    ...(Array.isArray(value.diagnostics) ? { diagnostics: value.diagnostics.filter(isRecord).map((d) => ({ severity: String(d.severity ?? "unknown"), ...(typeof d.code === "string" ? { code: d.code } : {}), ...(typeof d.acknowledged === "boolean" ? { acknowledged: d.acknowledged } : {}), ...(typeof d.blocksComplete === "boolean" ? { blocksComplete: d.blocksComplete } : {}) })) } : {}),
    ...(Array.isArray(value.limitations) ? { limitations: value.limitations.filter((v): v is string => typeof v === "string") } : {}),
    ...(typeof value.status === "string" ? { status: value.status } : {}),
  };
}

function safeManifestPath(path: string): string | null {
  if (path.length === 0 || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\0")) return null;
  const segments = path.split("/");
  if (segments.some((part) => part === "" || part === "." || part === "..")) return null;
  return segments.join("/");
}

function isReportPath(path: string): boolean { return REPORT_FILES.has(path) || path.startsWith("reports/"); }
function isPayloadEntry(path: string, kind?: string): boolean {
  return !(path === "runtime/bdmv-config.js" && kind === "external-config") && !isReportPath(path) && !NON_RUNTIME_KINDS.has(kind?.toLowerCase() ?? "") && PAYLOAD_EXTENSIONS.has(extname(path).toLowerCase());
}

async function listFiles(root: string, checks: AuditCheck[]): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { add(checks, "PACKAGE_DIRECTORY_UNREADABLE", "fail", error instanceof Error ? error.message : String(error), relative(root, dir).split(sep).join("/") || "."); return; }
    for (const entry of entries) {
      const absolute = resolve(dir, entry.name);
      const rel = relative(root, absolute).split(sep).join("/");
      if (rel === "reports" || rel.startsWith("reports/")) continue;
      if (entry.isSymbolicLink()) { add(checks, "PACKAGE_SYMLINK", "fail", "Symlinks are not permitted in the output package", rel); continue; }
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(rel);
      else add(checks, "PACKAGE_FILE_TYPE", "fail", "Unsupported filesystem entry in output package", rel);
    }
  };
  await walk(root);
  return files.sort(comparePath);
}

function decodeLayers(path: string): string[] {
  const layers = [path];
  let current = path;
  for (let i = 0; i < 3; i += 1) {
    try { const next = decodeURIComponent(current); if (next === current) break; layers.push(next); current = next; }
    catch { break; }
  }
  return layers;
}

function traversalLike(path: string): boolean {
  return path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").some((s) => s === ".." || s === ".");
}

export interface UrlAuditResult { ok: boolean; kind: "local" | "data" | "external" | "invalid"; path?: string; reason?: string; mime?: string; dataBytes?: number }

export function inspectRuntimeUrl(raw: string): UrlAuditResult {
  const value = raw.trim();
  if (value === "" || value.startsWith("#")) return { ok: true, kind: "local", path: value };
  if (value.startsWith("//")) return { ok: false, kind: "external", reason: "Protocol-relative URL is outside the offline package" };
  if (/^data:/i.test(value)) return inspectDataUrl(value);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return { ok: false, kind: "external", reason: "Only package-relative and allowlisted data URLs are permitted" };
  const pathPart = value.split(/[?#]/, 1)[0] ?? "";
  if (decodeLayers(pathPart).some(traversalLike)) return { ok: false, kind: "invalid", reason: "URL path contains an encoded or literal path escape" };
  let decoded: string;
  try { decoded = decodeURIComponent(pathPart); }
  catch { return { ok: false, kind: "invalid", reason: "URL path has malformed percent encoding" }; }
  if (traversalLike(decoded)) return { ok: false, kind: "invalid", reason: "URL path escapes the package root" };
  return { ok: true, kind: "local", path: decoded };
}

function inspectDataUrl(value: string): UrlAuditResult {
  const comma = value.indexOf(",");
  if (comma < 5) return { ok: false, kind: "invalid", reason: "Malformed data URL" };
  const header = value.slice(5, comma).toLowerCase();
  const mime = header.split(";")[0] || "text/plain";
  const base64 = /;base64(?:;|$)/i.test(header);
  if (mime !== "image/png" && mime !== "audio/wav" && mime !== "audio/x-wav") return { ok: false, kind: "invalid", mime, reason: "Data URL MIME is not allowlisted" };
  const body = value.slice(comma + 1);
  let bytes: Buffer;
  try {
    if (base64) {
      if (!/^[a-z0-9+/]*={0,2}$/i.test(body) || body.length % 4 !== 0) return { ok: false, kind: "invalid", mime, reason: "Malformed base64 data URL" };
      bytes = Buffer.from(body, "base64");
      if (bytes.toString("base64") !== body) return { ok: false, kind: "invalid", mime, reason: "Non-canonical base64 data URL" };
    } else {
      bytes = Buffer.from(decodeURIComponent(body), "utf8");
    }
  } catch { return { ok: false, kind: "invalid", mime, reason: "Invalid data URL encoding" }; }
  const validPng = mime === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const validWav = mime !== "image/png" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  if (!validPng && !validWav) return { ok: false, kind: "invalid", mime, reason: "Data URL payload does not match its declared MIME" };
  return { ok: true, kind: "data", mime, dataBytes: bytes.length };
}

interface RuntimeUrlRef { source: string; raw: string; decodedPath: string }

function addUrlCheck(checks: AuditCheck[], refs: RuntimeUrlRef[], source: string, raw: string): void {
  const result = inspectRuntimeUrl(raw);
  if (!result.ok) add(checks, result.kind === "external" ? "OFFLINE_EXTERNAL_URL" : "OFFLINE_UNSAFE_URL", "fail", result.reason ?? "Unsafe URL", source, { value: raw, normalizedPath: result.path ?? null, mime: result.mime ?? null });
  else if (result.kind === "local" && result.path) refs.push({ source, raw, decodedPath: result.path });
}

function parseAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const body = tag.replace(/^<\/?[a-z0-9:-]+/i, "").replace(/\/?\s*>$/, "");
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of body.matchAll(re)) attrs.set((match[1] ?? "").toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  return attrs;
}

function auditHtml(text: string, source: string, checks: AuditCheck[], refs: RuntimeUrlRef[]): void {
  for (const match of text.matchAll(/<[a-z][^>]*>/gi)) {
    const tag = match[0];
    const name = /^<([a-z0-9:-]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const attrs = parseAttributes(tag);
    for (const key of ["src", "href", "poster", "data", "action", "formaction"]) if (attrs.has(key)) addUrlCheck(checks, refs, source, attrs.get(key)!);
    for (const key of attrs.keys()) if (/^on[a-z]+$/i.test(key)) add(checks, "INLINE_EVENT_HANDLER", "fail", "Inline HTML event handlers are not permitted in the portable runtime", source, { attribute: key });
    if (attrs.has("srcset")) {
      const srcset = attrs.get("srcset")!;
      const candidates = srcset.match(/data:[^\s]+|[^\s,]+/gi) ?? [];
      candidates.forEach((item) => {
        const token = item.replace(/,+$/, "");
        if (token && !/^(?:\d+(?:\.\d+)?x|\d+w)$/i.test(token)) addUrlCheck(checks, refs, source, token);
      });
    }
    if (attrs.has("style")) auditCss(attrs.get("style")!, source, checks, refs);
    if (["iframe", "object", "embed"].includes(name)) add(checks, "ACTIVE_EMBED", "fail", `Active embedded content <${name}> is not permitted`, source);
    if (name === "base") add(checks, "BASE_URL_UNSUPPORTED", "fail", "A base element changes package URL resolution and is not permitted", source);
    if (name === "meta" && attrs.get("http-equiv")?.toLowerCase() === "refresh") {
      const destination = /(?:^|;)\s*url\s*=\s*["']?([^;"']+)/i.exec(attrs.get("content") ?? "")?.[1]?.trim();
      if (destination) addUrlCheck(checks, refs, source, destination);
    }
  }
  if (/<\s*script\b[^>]*\btype\s*=\s*['"]module['"]/i.test(text)) add(checks, "BUNDLE_MODULE_SCRIPT", "fail", "Module scripts are not permitted in portable output", source);
  for (const script of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = parseAttributes(`<script ${script[1] ?? ""}>`);
    const content = script[2] ?? "";
    if (attrs.has("src") || content.trim() === "") continue;
    if ((attrs.get("type") ?? "").toLowerCase() === "application/json") auditJsonUrls(content, `${source}#inline-json`, checks, refs);
    else auditScript(content, source, checks, refs);
  }
  for (const style of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) auditCss(style[1] ?? "", source, checks, refs);
}

function auditCss(text: string, source: string, checks: AuditCheck[], refs: RuntimeUrlRef[]): void {
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi)) addUrlCheck(checks, refs, source, m[1] ?? m[2] ?? m[3] ?? "");
  for (const m of text.matchAll(/@import\s+(?:url\()?\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s;]+))/gi)) addUrlCheck(checks, refs, source, m[1] ?? m[2] ?? m[3] ?? "");
}

function auditScript(text: string, source: string, checks: AuditCheck[], refs: RuntimeUrlRef[]): void {
  const codeOnly = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|(['"`])(?:\\.|(?!\1)[^\\])*?\1/g, " ");
  const forbidden: Array<[RegExp, string, string]> = [
    [/\bimport\b/, "BUNDLE_IMPORT", "Module imports are not permitted"],
    [/\bimportScripts\s*\(/, "BUNDLE_IMPORT", "Worker imports are not permitted"],
    [/\b(?:eval|Function)\s*\(/, "BUNDLE_EVAL", "Dynamic code evaluation is not permitted"],
    [/\bfetch\s*\(|\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\s*\(|\bXMLHttpRequest\b|\b(?:window|globalThis|self)\s*\.\s*(?:fetch|WebSocket|EventSource)\b/, "BUNDLE_NETWORK_API", "Network-capable API reference found in runtime script"],
  ];
  for (const [pattern, code, message] of forbidden) if (pattern.test(codeOnly)) add(checks, code, "fail", message, source);
  const dynamicNetworkAccess = /\b(?:window|globalThis|self)\s*\[\s*(?:[^\]]+)\s*\]/g;
  for (const match of text.matchAll(dynamicNetworkAccess)) {
    const access = match[0];
    const key = /\[\s*(['"])(.*?)\1\s*\]$/.exec(access)?.[2];
    if (key === undefined || ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"].includes(key)) {
      add(checks, "BUNDLE_DYNAMIC_ACCESS", "not-verified", "Computed access to a global may reference a network-capable API", source, { expression: access });
    }
  }
  for (const match of text.matchAll(/\[[^\]]+\]\s*\(\s*(['"])(?:src|href|poster)\1\s*,/g)) {
    add(checks, "BUNDLE_DYNAMIC_URL_SINK", "not-verified", "Computed method access may write a runtime URL", source, { expression: match[0] });
  }
  for (const m of text.matchAll(/\bnew\s+URL\(\s*["']([^"']+)["']/g)) addUrlCheck(checks, refs, source, m[1]!);
  for (const m of text.matchAll(/(?:\.|\b)(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) addUrlCheck(checks, refs, source, m[1]!);
  for (const match of text.matchAll(/(?:\.setAttribute|\[\s*(['"])setAttribute\1\s*\])\s*\(([^)]*)\)/gi)) {
    const args = (match[2] ?? "").split(",");
    const attribute = args[0]?.trim() ?? "";
    const value = args[1]?.trim() ?? "";
    const attributeLiteral = /^(['"])(src|href|poster)\1$/i.exec(attribute);
    const valueLiteral = /^(['"])(.*?)\1$/.exec(value);
    if (attributeLiteral && valueLiteral) addUrlCheck(checks, refs, source, valueLiteral[2]!);
    else if (attributeLiteral || attribute !== "") add(checks, "BUNDLE_DYNAMIC_URL_SINK", "not-verified", "setAttribute may write a runtime URL that cannot be resolved statically", source, { expression: match[0] });
  }
  for (const m of text.matchAll(/["'](?:url|src|href|relativePath)["']\s*:\s*["']([^"']+)["']/gi)) addUrlCheck(checks, refs, source, m[1]!);
  for (const m of text.matchAll(/["'](data:(?:image|audio)\/[^"']+)["']/gi)) addUrlCheck(checks, refs, source, m[1]!);
}

function auditJsonUrls(text: string, source: string, checks: AuditCheck[], refs: RuntimeUrlRef[]): void {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return; }
  const walk = (item: unknown, path: string): void => {
    if (Array.isArray(item)) { item.forEach((child, i) => walk(child, `${path}/${i}`)); return; }
    if (!isRecord(item)) return;
    for (const [key, child] of Object.entries(item)) {
      const next = `${path}/${key}`;
      if (typeof child === "string" && /^(?:url|src|href|relativePath)$/i.test(key)) addUrlCheck(checks, refs, `${source}${next}`, child);
      else walk(child, next);
    }
  };
  walk(value, "");
}

async function auditRuntimeFiles(root: string, files: string[], checks: AuditCheck[]): Promise<void> {
  const refs: RuntimeUrlRef[] = [];
  for (const path of files) {
    const ext = extname(path).toLowerCase();
    if (![".html", ".htm", ".css", ".js", ".mjs", ".json"].includes(ext) || isReportPath(path)) continue;
    let text: string;
    try {
      if ((await stat(resolve(root, path))).size > MAX_TEXT_BYTES) { add(checks, "RUNTIME_FILE_TOO_LARGE", "not-verified", "Static resource audit skipped because the file exceeds the bounded scan size", path); continue; }
      text = await readFile(resolve(root, path), "utf8");
    } catch (error) { add(checks, "RUNTIME_FILE_UNREADABLE", "fail", error instanceof Error ? error.message : String(error), path); continue; }
    if (ext === ".html" || ext === ".htm") auditHtml(text, path, checks, refs);
    if (ext === ".css") auditCss(text, path, checks, refs);
    if (ext === ".js" || ext === ".mjs") auditScript(text, path, checks, refs);
    if (ext === ".json" && !["manifest.json", "compatibility.json", "dependency-audit.json"].includes(path)) auditJsonUrls(text, path, checks, refs);
  }
  for (const ref of refs) {
    if (ref.decodedPath.startsWith("#")) continue;
    const diskPath = ref.decodedPath;
    if (!diskPath) continue;
    const sourceFile = /^(.*?\.json)(?:\/|$)/i.exec(ref.source)?.[1] ?? ref.source;
    const base = dirname(resolve(root, sourceFile));
    const absolute = resolve(base, diskPath);
    if (!within(root, absolute)) { add(checks, "OFFLINE_URL_ESCAPE", "fail", "Normalized runtime URL resolves outside the package", ref.source, { value: ref.raw, target: absolute }); continue; }
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) { add(checks, "OFFLINE_URL_SYMLINK", "fail", "Runtime URL resolves through a symlink", ref.source, { value: ref.raw, target: relative(root, absolute).split(sep).join("/") }); continue; }
      if (!info.isFile()) { add(checks, "OFFLINE_URL_NOT_FILE", "fail", "Runtime URL does not resolve to a regular file", ref.source, { value: ref.raw, target: relative(root, absolute).split(sep).join("/") }); continue; }
      const canonical = await realpath(absolute);
      if (!within(root, canonical)) add(checks, "OFFLINE_URL_ESCAPE", "fail", "Runtime URL resolves outside the package after symlink resolution", ref.source, { value: ref.raw, target: canonical });
      else add(checks, "OFFLINE_URL_LOCAL", "pass", "Runtime URL resolves to a file inside the package", ref.source, { value: ref.raw, target: relative(root, canonical).split(sep).join("/") });
    } catch {
      add(checks, "OFFLINE_URL_MISSING", "fail", "Runtime URL target is missing from the output package", ref.source, { value: ref.raw, target: relative(root, absolute).split(sep).join("/") });
    }
  }
}

export async function auditOutputPackage(inputRoot: string): Promise<OfflinePackageAudit> {
  const checks: AuditCheck[] = [];
  let root: string;
  try {
    if ((await lstat(inputRoot)).isSymbolicLink()) throw new Error("Output package root symlink is not allowed");
    root = await realpath(inputRoot);
  }
  catch { add(checks, "PACKAGE_ROOT_MISSING", "fail", "Output package directory does not exist", inputRoot); return { schemaVersion: "1.0", packageRoot: resolve(inputRoot), manifestPath: "manifest.json", checks, discoveredPayloadFiles: [] }; }
  if (!(await stat(root)).isDirectory()) { add(checks, "PACKAGE_ROOT_INVALID", "fail", "Output package root is not a directory", inputRoot); return { schemaVersion: "1.0", packageRoot: root, manifestPath: "manifest.json", checks, discoveredPayloadFiles: [] }; }
  const files = await listFiles(root, checks);
  const manifestRel = "manifest.json";
  if (!files.includes("index.html")) add(checks, "PACKAGE_ENTRY_MISSING", "fail", "Required portable startup file index.html is missing", "index.html");
  if (!files.includes(manifestRel)) { add(checks, "MANIFEST_MISSING", "fail", "Required manifest.json is missing", manifestRel); return { schemaVersion: "1.0", packageRoot: root, manifestPath: manifestRel, checks, discoveredPayloadFiles: files.filter((p) => isPayloadEntry(p)) }; }
  const manifestAbsolute = resolve(root, manifestRel);
  try {
    if ((await lstat(manifestAbsolute)).isSymbolicLink()) throw new Error("manifest symlink is not allowed");
    if ((await stat(manifestAbsolute)).size > MAX_MANIFEST_BYTES) throw new Error("manifest exceeds bounded size");
  } catch (error) { add(checks, "MANIFEST_UNREADABLE", "fail", error instanceof Error ? error.message : String(error), manifestRel); return { schemaVersion: "1.0", packageRoot: root, manifestPath: manifestRel, checks, discoveredPayloadFiles: files }; }
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(manifestAbsolute, "utf8")); }
  catch (error) { add(checks, "MANIFEST_INVALID_JSON", "fail", error instanceof Error ? error.message : String(error), manifestRel); return { schemaVersion: "1.0", packageRoot: root, manifestPath: manifestRel, checks, discoveredPayloadFiles: files }; }
  const manifest = parseManifest(parsed, checks);
  if (!manifest) return { schemaVersion: "1.0", packageRoot: root, manifestPath: manifestRel, checks, discoveredPayloadFiles: files };

  // Older packages may not record a player profile. When the manifest does,
  // require it to match the exact profile embedded for the runtime VM.
  if (isRecord(parsed) && Object.hasOwn(parsed, "profile")) {
    const manifestProfile = parsed.profile;
    if (!isPlayerProfile(manifestProfile)) {
      add(checks, "PLAYER_PROFILE_INVALID", "fail", "manifest.json profile does not match the PlayerProfile contract", "manifest.json/profile");
    } else {
      try {
        const compatibility: unknown = JSON.parse(await readFile(resolve(root, "compatibility.json"), "utf8"));
        if (!isRecord(compatibility) || compatibility.profile !== manifestProfile.outputProfile) {
          add(checks, "PLAYER_PROFILE_MISMATCH", "fail", "compatibility.json profile label does not match manifest.json outputProfile", "compatibility.json/profile");
        }
      } catch {
        add(checks, "PLAYER_PROFILE_MISMATCH", "fail", "Could not read compatibility.json profile label", "compatibility.json/profile");
      }
      try {
        const runtimeScript = await readFile(resolve(root, "runtime/disc-data.js"), "utf8");
        const assignment = /^globalThis\.__BDMV_MENU_DATA__=(.*);\s*$/s.exec(runtimeScript);
        const runtimeData: unknown = assignment ? JSON.parse(assignment[1]!) : null;
        const runtimeProfile = isRecord(runtimeData) ? runtimeData.profile : undefined;
        if (!isPlayerProfile(runtimeProfile) || !samePlayerProfile(manifestProfile, runtimeProfile)) {
          add(checks, "PLAYER_PROFILE_MISMATCH", "fail", "manifest.json profile does not match runtime/disc-data.js profile", "runtime/disc-data.js/profile");
        } else add(checks, "PLAYER_PROFILE_SYNC", "pass", "Manifest and runtime player profiles match", "manifest.json/profile");
      } catch {
        add(checks, "PLAYER_PROFILE_MISMATCH", "fail", "Could not read the runtime player profile recorded by manifest.json", "runtime/disc-data.js/profile");
      }
    }
  }

  const seen = new Set<string>();
  for (const [index, entry] of manifest.files.entries()) {
    const path = safeManifestPath(entry.path);
    if (!path) { add(checks, "PACKAGE_PATH_INVALID", "fail", "Manifest file path must be a relative POSIX path without dot segments", `manifest.json/files/${index}`, { value: entry.path }); continue; }
    if (seen.has(path)) { add(checks, "MANIFEST_DUPLICATE_PATH", "fail", "Manifest contains a duplicate path", path); continue; }
    seen.add(path);
    if (path === manifestRel || isReportPath(path)) { add(checks, "MANIFEST_PATH_RESERVED", "fail", "Manifest file path overlaps a report or manifest file", path); continue; }
    if (path === "index.html" && entry.required === false) add(checks, "PACKAGE_ENTRY_OPTIONAL", "fail", "The startup file must be a required manifest entry", path);
    const absolute = resolve(root, path);
    if (!within(root, absolute)) { add(checks, "PACKAGE_PATH_ESCAPE", "fail", "Manifest path resolves outside package", path); continue; }
    try {
      const fileStat = await lstat(absolute);
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) { add(checks, "PACKAGE_FILE_INVALID", "fail", "Expected a regular package file (symlinks are not accepted)", path); continue; }
      const canonical = await realpath(absolute);
      if (!within(root, canonical)) { add(checks, "PACKAGE_PATH_ESCAPE", "fail", "Resolved file escapes package root", path); continue; }
      if (path === "runtime/bdmv-config.js" && entry.kind === "external-config") {
        let bdmvPath: unknown;
        try {
          const source = await readFile(canonical, "utf8");
          const match = source.match(/^globalThis\.__BDMV_BDMV_PATH__=(.+);\s*$/);
          const encodedPath = match?.[1];
          if (encodedPath !== undefined) bdmvPath = JSON.parse(encodedPath);
        } catch { bdmvPath = undefined; }
        if (typeof bdmvPath !== "string" || !bdmvPath || bdmvPath.includes("\0")) add(checks, "EXTERNAL_CONFIG_INVALID", "fail", "BDMV path configuration is invalid", path);
        else add(checks, "EXTERNAL_CONFIG", "not-verified", "Configured BDMV path and URL Protocol playback must be verified in the current environment", path);
        continue;
      }
    } catch { add(checks, entry.required === false ? "PACKAGE_OPTIONAL_ASSET_MISSING" : "PACKAGE_MISSING_ASSET", entry.required === false ? "not-verified" : "fail", "Manifest asset is missing or unreadable", path); }
  }
  if (files.includes("index.html") && !seen.has("index.html")) add(checks, "PACKAGE_ENTRY_UNLISTED", "fail", "Required startup file index.html is absent from manifest files", "index.html");
  const unlisted = files.filter((path) => path !== manifestRel && !isReportPath(path) && !seen.has(path));
  const unlistedRuntime = unlisted.filter((path) => isPayloadEntry(path));
  for (const path of unlistedRuntime) add(checks, "PACKAGE_UNLISTED_PAYLOAD", "fail", "Runtime payload file is absent from manifest files", path);
  await auditRuntimeFiles(root, files, checks);
  const staticChecks = checks.filter((check) => check.checkId.startsWith("OFFLINE_") || check.checkId.startsWith("BUNDLE_") || check.checkId === "ACTIVE_EMBED");
  if (staticChecks.some((check) => check.result === "fail")) add(checks, "OFFLINE_STATIC_AUDIT", "fail", "One or more disallowed static URL, data payload, or bundle entrypoints were found");
  else if (staticChecks.some((check) => check.result === "not-verified")) add(checks, "OFFLINE_STATIC_AUDIT", "not-verified", "One or more static runtime files could not be fully audited");
  else add(checks, "OFFLINE_STATIC_AUDIT", "pass", "No disallowed static URL, data payload, or bundle entrypoint was found");
  return { schemaVersion: "1.0", packageRoot: root, manifestPath: manifestRel, checks, discoveredPayloadFiles: files.filter((p) => isPayloadEntry(p)) };
}
