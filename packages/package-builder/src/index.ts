import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { parseDiscIR, type DiscIR, type PlayerProfile } from "@bdmv2web/core";
import type { VmOptions, VmProgram } from "@bdmv2web/hdmv";
import { LOCAL_PLAYER_BRIDGE, localPlayerLauncher } from "./local-player-bridge.js";
import { exportMenuLoopMedia, type ExternalMediaTargets, type MenuLoopMediaInput, type PgsDisplaySet } from "@bdmv2web/media-export";

export interface PngPayload { id: string; bytes: Uint8Array }
export interface PngBatch { index: number; assets: Array<{ id: string; dataUrl: string; byteLength: number }> }
export interface SoundMetadata { index: number; channelCode: number; sampleRateCode: number; bitsPerSampleCode: number; channels: number | null; sampleRate: number | null; bitsPerSample: number | null; sampleOffset: number; sampleByteLength: number }
export interface SoundPayload { index: number; path: string; byteLength: number; format: "wav-pcm" }
export interface PgsTrackPackageInput { playlistId: string; playlistNumber: number; playItemIndex: number; clipId: string; pid: number; streamNumber: number; language: string; sourceIn90k: string; sourceOut90k: string; source: string; path: string; displaySets: PgsDisplaySet[] }
/** Delivery status as decided by the caller; the package must not invent one. */
export type MenuPackageStatus = "failed" | "partial" | "complete";
export interface MenuPackageDiagnostic { code: string; message: string; severity?: string }
export interface MenuPackageMetadata { schemaVersion: "1.0"; runtimeVersion: string; title: string; mode: "menu-only"; status: MenuPackageStatus; diagnostics: MenuPackageDiagnostic[] }

/** Serialize data for a classic script. Escaping '<' also prevents HTML script termination. */
export function serializeSafeScriptData(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item instanceof Uint8Array ? [...item].map((byte) => byte.toString(16).padStart(2, "0")).join("") : item).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function makePngBatches(assets: PngPayload[], options: { maxAssetBytes?: number; maxBatchBytes?: number; maxTotalBytes?: number } = {}): PngBatch[] {
  const maxAssetBytes = options.maxAssetBytes ?? 1024 * 1024;
  const maxBatchBytes = options.maxBatchBytes ?? 4 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 64 * 1024 * 1024;
  for (const [name, value] of Object.entries({ maxAssetBytes, maxBatchBytes, maxTotalBytes })) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  const batches: PngBatch[] = []; let current: PngBatch = { index: 0, assets: [] }; let batchBytes = 0; let totalBytes = 0;
  for (const asset of assets) {
    const length = asset.bytes.byteLength;
    if (length > maxAssetBytes) throw new RangeError(`PNG asset '${asset.id}' exceeds maxAssetBytes`);
    if (length > maxBatchBytes) throw new RangeError(`PNG asset '${asset.id}' exceeds maxBatchBytes`);
    totalBytes += length; if (totalBytes > maxTotalBytes) throw new RangeError("PNG assets exceed maxTotalBytes");
    if (current.assets.length && batchBytes + length > maxBatchBytes) { batches.push(current); current = { index: batches.length, assets: [] }; batchBytes = 0; }
    current.assets.push({ id: asset.id, dataUrl: `data:image/png;base64,${Buffer.from(asset.bytes).toString("base64")}`, byteLength: length }); batchBytes += length;
  }
  if (current.assets.length) batches.push(current);
  return batches;
}

/** The stage fills the viewport and letterboxes the scene inside itself: the
 * page shows no chrome of its own, and the disc title is only the document title.
 * The inline aspect-ratio is a fallback hint if the full-viewport sizing is disabled. */
export function createMenuIndexHtml(title: string, assetBatchCount = 0, sceneSize?: { width: number; height: number }): string {
  const safeTitle = escapeHtml(title);
  const assets = Array.from({ length: assetBatchCount }, (_, i) => `<script defer src="runtime/assets-data-${String(i).padStart(3, "0")}.js"></script>`).join("");
  const aspectRatio = sceneSize ? ` style="aspect-ratio:${sceneSize.width} / ${sceneSize.height}"` : "";
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${safeTitle}</title><link rel="stylesheet" href="runtime/style.css"><script defer src="runtime/disc-data.js"></script>${assets}<script defer src="runtime/app.bundle.js"></script>`;
  const stage = `<div id="menu-stage"${aspectRatio}><video id="menu-background" aria-hidden="true" playsinline></video><audio id="menu-audio"></audio><canvas id="menu-canvas" aria-label="Blu-ray menu preview"></canvas><canvas id="popup-canvas" aria-label="Blu-ray popup menu" hidden></canvas></div>`;
  return `<!doctype html>\n<html lang="en"><head>${head}</head><body><main>${stage}<button id="start-menu" type="button" hidden>Start menu preview</button><p id="runtime-status" role="status" aria-live="polite" class="is-visible">Loading menu preview…</p><pre id="runtime-diagnostics" hidden></pre></main></body></html>\n`;
}

export function createDataScript(ir: unknown): string {
  return `globalThis.__BDMV_MENU_DATA__=${serializeSafeScriptData(ir)};\n`;
}

export function createAssetBatchScript(batch: PngBatch): string {
  return `globalThis.__BDMV_MENU_ASSETS__=globalThis.__BDMV_MENU_ASSETS__||[];globalThis.__BDMV_MENU_ASSETS__[${batch.index}]=${serializeSafeScriptData(batch.assets)};\n`;
}

export function createCompatibility(metadata: MenuPackageMetadata, externalPlayback = false): Record<string, unknown> {
  return {
    ...metadata,
    profile: "portable",
    coverage: { browser: "Chrome only; direct file:// not yet verified", igs: "unverified" },
    browserEvidence: [],
    externalDependencies: externalPlayback ? ["Node.js local playback bridge", "configured BDMV STREAM files", "system M2TS player"] : [],
    notVerified: ["direct file:// launch", "offline directory relocation", "browser support matrix", "real-disc rendering", "media timeline and seek accuracy"],
  };
}

export interface MenuPackageInput {
  outputDirectory: string;
  title: string;
  ir: DiscIR;
  scene: unknown;
  /** Extracted title popup IGS compositions, retained with their source clip/PID. */
  popupScenes?: unknown[];
  /** Validated SUP display sets extracted from reachable playlist PGS streams. */
  pgsTracks?: PgsTrackPackageInput[];
  pgsLimits?: { maxRuntimeBytes?: number };
  /** Delivery status decided by the caller. Defaults to `partial` for library callers. */
  status?: MenuPackageStatus;
  /** Entry counts recorded for report consumers; they never decide the status. */
  entryCounts?: { declared: number; hdmv: number };
  playerProfile?: PlayerProfile;
  vmPrograms?: VmProgram[];
  vmEntries?: VmOptions["entries"];
  externalTargets?: ExternalMediaTargets;
  bdmvPath?: string;
  vmInitialProgramId?: number;
  vmFirstPlayProgramId?: number;
  inputConfig?: { escapeMapping?: "popup" | "topMenu" | "custom" | "none" };
  graphics: PngPayload[];
  soundEntries?: SoundMetadata[];
  soundBytes?: Uint8Array | null;
  runtimeVersion?: string;
  diagnostics?: MenuPackageMetadata["diagnostics"];
  menuLoopMedia?: MenuLoopMediaInput;
  pngLimits?: { maxAssetBytes?: number; maxBatchBytes?: number; maxTotalBytes?: number };
}

/** Write a self-contained menu-only folder and bundle its browser entry as a classic IIFE. */
export async function buildMenuPackage(input: MenuPackageInput): Promise<void> {
  const ir = parseDiscIR(input.ir);
  const sceneSize = getSceneSize(input.scene);
  const batches = makePngBatches(input.graphics, input.pngLimits);
  const soundResult = convertSounds(input.soundEntries ?? [], input.soundBytes ?? null, input.scene);
  const sounds = soundResult.assets;
  const diagnostics = [...(input.diagnostics ?? []), ...soundResult.diagnostics];
  const serializedPgsTracks = (input.pgsTracks ?? []).map(serializePgsTrack);
  const pgsPayloadBytes = Buffer.byteLength(serializeSafeScriptData(serializedPgsTracks));
  const maxPgsRuntimeBytes = input.pgsLimits?.maxRuntimeBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxPgsRuntimeBytes) || maxPgsRuntimeBytes <= 0) throw new RangeError("maxPgsRuntimeBytes must be a positive safe integer.");
  if (pgsPayloadBytes > maxPgsRuntimeBytes) throw new RangeError(`Serialized PGS payload exceeds maxPgsRuntimeBytes (${pgsPayloadBytes} > ${maxPgsRuntimeBytes} bytes).`);
  const output = resolve(input.outputDirectory); const runtimeDirectory = resolve(output, "runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  const exportedMedia = input.menuLoopMedia ? await exportMenuLoopMedia(input.menuLoopMedia, { outputDirectory: output, preset: "veryfast" }) : undefined;
  const metadata: MenuPackageMetadata = { schemaVersion: "1.0", runtimeVersion: input.runtimeVersion ?? "0.1.0", title: input.title, mode: "menu-only", status: input.status ?? "partial", diagnostics };
  const files: Array<{ path: string; kind: string; required?: boolean }> = [
    { path: "index.html", kind: "html", required: true },
    { path: "runtime/disc-data.js", kind: "runtime", required: true },
    { path: "runtime/style.css", kind: "runtime", required: true },
    { path: "README.md", kind: "readme", required: true },
    { path: "compatibility.json", kind: "compatibility", required: true },
    { path: "runtime/app.bundle.js", kind: "runtime", required: true },
    ...batches.map((batch) => ({ path: `runtime/assets-data-${String(batch.index).padStart(3, "0")}.js`, kind: "runtime", required: true })),
    ...sounds.map((sound) => ({ path: sound.path, kind: "audio", required: true })),
    ...(exportedMedia?.files.map((file) => ({ path: file.path, kind: "media", required: true })) ?? []),
    ...[...new Set((input.pgsTracks ?? []).map((track) => track.path))].map((path) => ({ path, kind: "subtitle", required: true })),
    ...(exportedMedia ? [{ path: "media-plan.json", kind: "media-plan", required: true }] : []),
    ...(input.externalTargets ? [{ path: "bdmv-config.json", kind: "external-config", required: true }, ...["external-targets.json", "local-player-bridge.mjs", "start-menu.sh"].map((path) => ({ path, kind: "runtime", required: true }))] : []),
  ];
  await Promise.all([
    writeFile(resolve(output, "index.html"), createMenuIndexHtml(input.title, batches.length, sceneSize)),
    writeFile(resolve(runtimeDirectory, "disc-data.js"), createDataScript({ ir, title: input.title, scene: input.scene, ...(input.popupScenes?.length ? { popupScenes: input.popupScenes } : {}), ...(serializedPgsTracks.length ? { pgsTracks: serializedPgsTracks } : {}), vmPrograms: input.vmPrograms ?? [], ...(input.playerProfile ? { profile: input.playerProfile } : {}), ...(input.externalTargets ? { externalTargets: input.externalTargets } : {}), ...(input.vmEntries ? { vmEntries: input.vmEntries } : {}), ...(input.vmInitialProgramId !== undefined ? { vmInitialProgramId: input.vmInitialProgramId } : {}), ...(input.vmFirstPlayProgramId !== undefined ? { vmFirstPlayProgramId: input.vmFirstPlayProgramId } : {}), inputConfig: { escapeMapping: input.inputConfig?.escapeMapping ?? "popup" }, sounds: Object.fromEntries(sounds.map(({ index, path }) => [index, path])), ...(exportedMedia ? { media: { playlist: Number(input.menuLoopMedia!.playlistId), background: { path: exportedMedia.background.path, loop: exportedMedia.background.loop }, audioTracks: exportedMedia.audioTracks.map(runtimeAudioTrackMetadata) } } : {}) })),
    writeFile(resolve(runtimeDirectory, "style.css"), MENU_STYLE),
    writeFile(resolve(output, "README.md"), createReadme(input.title, exportedMedia?.background.loop, !!input.externalTargets, metadata.status) + (input.externalTargets ? "\nThe launcher starts a local-only playback bridge. Close its terminal window to stop it. Node.js is required. The menu skips any First Play media while retaining initialization performed before it. The default media player opens the entire M2TS; playlist boundaries and chapter offsets are not enforced.\n" : "")),
    ...(input.externalTargets ? [
      writeFile(resolve(output, "bdmv-config.json"), `${JSON.stringify({ bdmvPath: input.bdmvPath ?? "../BDMV" }, null, 2)}\n`),
      writeFile(resolve(output, "external-targets.json"), `${JSON.stringify(input.externalTargets)}\n`),
      writeFile(resolve(output, "local-player-bridge.mjs"), LOCAL_PLAYER_BRIDGE),
      writeFile(resolve(output, "start-menu.sh"), localPlayerLauncher(process.execPath)),
    ] : []),
    ...batches.map((batch) => writeFile(resolve(runtimeDirectory, `assets-data-${String(batch.index).padStart(3, "0")}.js`), createAssetBatchScript(batch))),
    ...soundResult.files.map(async ({ path, bytes }) => { await mkdir(resolve(output, "assets/audio"), { recursive: true }); await writeFile(resolve(output, path), bytes); }),
    writeFile(resolve(output, "asset-manifest.json"), `${JSON.stringify({ schemaVersion: "1.0", sounds, ...(exportedMedia ? { media: packagedMediaMetadata(exportedMedia) } : {}), pgsTracks: (input.pgsTracks ?? []).map(({ displaySets: _displaySets, ...track }) => ({ ...track, displaySetCount: _displaySets.length })) }, null, 2)}\n`),
  ]);
  if (input.externalTargets) await chmod(resolve(output, "start-menu.sh"), 0o755);
  // Bundling reads runtime-web's TypeScript entry directly; the source-path coupling is scheduled for removal in D7 (batch 2), so `packages/runtime-web/src/` stays in the build scope for now.
  const entry = resolve(import.meta.dirname, "../../runtime-web/src/browser.ts");
  await build({ entryPoints: [entry], outfile: resolve(runtimeDirectory, "app.bundle.js"), bundle: true, platform: "browser", format: "iife", target: "es2020", legalComments: "none", alias: { "@bdmv2web/hdmv": resolve(import.meta.dirname, "../../hdmv/src/index.ts"), "@bdmv2web/media-export/external-targets": resolve(import.meta.dirname, "../../media-export/src/external-targets.ts") } });
  await writeFile(resolve(output, "compatibility.json"), `${JSON.stringify(createCompatibility(metadata, !!input.externalTargets), null, 2)}\n`);
  // M6 reserves compatibility.json and asset-manifest.json as report metadata and rejects them in manifest.files.
  const manifestFiles = await Promise.all(files.filter((file) => file.path !== "compatibility.json" && file.path !== "asset-manifest.json").map(async (file) => {
    const fileInfo = await stat(resolve(output, file.path));
    return { ...file, byteLength: String(fileInfo.size) };
  }));
  manifestFiles.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const menuMediaLimitation = input.externalTargets ? "Feature playback requires start-menu.sh and the local player bridge; PlayItem ranges and chapters are not enforced" : exportedMedia ? exportedMedia.background.loop ? "Menu background is a partial single-clip loop; complete HDMV playlist navigation and PGS are unsupported" : "Menu background holds its final frame after the single PlayItem; declared audio ends with the PlayItem; complete HDMV playlist navigation and PGS are unsupported" : "Menu-only preview; media playback unavailable";
  const pgsManifest = (input.pgsTracks ?? []).map(({ displaySets, ...track }) => ({ ...track, displaySetCount: displaySets.length }));
  const manifest = { schemaVersion: "1.0", mode: "menu-only", status: metadata.status, ...(input.entryCounts ? { declaredEntryCount: input.entryCounts.declared, hdmvEntryCount: input.entryCounts.hdmv } : {}), files: manifestFiles, diagnostics: metadata.diagnostics, ...(input.playerProfile ? { profile: input.playerProfile } : {}), assets: { sounds, ...(exportedMedia ? { media: packagedMediaMetadata(exportedMedia) } : {}), pgsTracks: pgsManifest }, limitations: [menuMediaLimitation, "IGS animation and visual effects are not fully verified", "Direct file:// browser acceptance remains unverified"] };
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Convert only M1-declared 48 kHz, signed 16-bit mono/stereo PCM sample ranges. BCLK words are big-endian. */
export function convertSounds(entries: SoundMetadata[], source: Uint8Array | null, scene: unknown): { assets: SoundPayload[]; diagnostics: MenuPackageDiagnostic[]; files: Array<{ path: string; bytes: Uint8Array }> } {
  const references = getSoundReferences(scene); const declared = new Map(entries.map((entry) => [entry.index, entry]));
  const assets: SoundPayload[] = []; const diagnostics: Array<{ code: string; message: string }> = []; const files: Array<{ path: string; bytes: Uint8Array }> = [];
  const affected = (soundId: number) => references.get(soundId)?.map((ref) => `page ${ref.pageId}, button ${ref.buttonId}`).join("; ") ?? "no menu buttons";
  for (const soundId of new Set(references.keys())) {
    const entry = declared.get(soundId);
    if (!entry) { diagnostics.push({ code: "SOUND_REFERENCE_MISSING", message: `Sound ${soundId} is referenced by ${affected(soundId)} but has no M1 sound entry.` }); continue; }
    if (!source) { diagnostics.push({ code: "SOUND_SOURCE_MISSING", message: `Sound ${soundId} is referenced by ${affected(soundId)} but sound.bdmv bytes are unavailable.` }); continue; }
    if (entry.channels !== 1 && entry.channels !== 2 || entry.sampleRate !== 48000 || entry.bitsPerSample !== 16 || entry.channelCode !== (entry.channels === 1 ? 1 : 3) || entry.sampleRateCode !== 1 || entry.bitsPerSampleCode !== 1) {
      diagnostics.push({ code: "SOUND_FORMAT_UNSUPPORTED", message: `Sound ${soundId} referenced by ${affected(soundId)} has unsupported M1 PCM attributes (channel=${entry.channelCode}, rate=${entry.sampleRateCode}, bits=${entry.bitsPerSampleCode}).` }); continue;
    }
    const { sampleOffset, sampleByteLength } = entry;
    if (!Number.isSafeInteger(sampleOffset) || !Number.isSafeInteger(sampleByteLength) || sampleOffset < 0 || sampleByteLength < 0 || sampleOffset > source.byteLength || sampleByteLength > source.byteLength - sampleOffset || sampleByteLength % (entry.channels * 2) !== 0 || sampleByteLength > 0xffffffff - 36) {
      diagnostics.push({ code: "SOUND_RANGE_INVALID", message: `Sound ${soundId} referenced by ${affected(soundId)} has an invalid or truncated M1 sample range.` }); continue;
    }
    const wav = makePcmWav(source.subarray(sampleOffset, sampleOffset + sampleByteLength), entry.channels);
    const path = `assets/audio/sound-${soundId}.wav`; assets.push({ index: soundId, path, byteLength: wav.byteLength, format: "wav-pcm" }); files.push({ path, bytes: wav });
  }
  return { assets, diagnostics, files };
}

function makePcmWav(samples: Uint8Array, channels: number): Uint8Array {
  const wav = new Uint8Array(44 + samples.byteLength); const view = new DataView(wav.buffer);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) wav[offset + i] = value.charCodeAt(i); };
  write(0, "RIFF"); view.setUint32(4, 36 + samples.byteLength, true); write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, 48000, true); view.setUint32(28, 48000 * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples.byteLength, true);
  for (let i = 0; i < samples.byteLength; i += 2) { wav[44 + i] = samples[i + 1]!; wav[44 + i + 1] = samples[i]!; }
  return wav;
}

function getSoundReferences(scene: unknown): Map<number, Array<{ pageId: number; buttonId: number }>> {
  const result = new Map<number, Array<{ pageId: number; buttonId: number }>>();
  if (typeof scene !== "object" || scene === null || !Array.isArray((scene as { pages?: unknown }).pages)) return result;
  for (const page of (scene as { pages: Array<{ id?: number; buttons?: Array<{ id?: number; states?: Record<string, { soundId?: number }> }> }> }).pages) for (const button of page.buttons ?? []) for (const state of Object.values(button.states ?? {})) {
    const id = state?.soundId; if (!Number.isInteger(id) || id === 0xff || id! < 0) continue;
    const refs = result.get(id!) ?? []; refs.push({ pageId: page.id ?? -1, buttonId: button.id ?? -1 }); result.set(id!, refs);
  }
  return result;
}

function getSceneSize(scene: unknown): { width: number; height: number } {
  if (typeof scene !== "object" || scene === null || !Number.isSafeInteger((scene as { width?: unknown }).width) || !Number.isSafeInteger((scene as { height?: unknown }).height) || (scene as { width: number }).width <= 0 || (scene as { height: number }).height <= 0) throw new TypeError("Menu scene must declare positive integer width and height");
  return { width: (scene as { width: number }).width, height: (scene as { height: number }).height };
}

const MENU_STYLE = `:root{color-scheme:dark;font:16px system-ui,-apple-system,"Segoe UI",sans-serif;background:#000;color:#eee}
html,body{height:100%;margin:0;overflow:hidden;background:#000;overscroll-behavior:none;-webkit-text-size-adjust:100%}
main{position:fixed;inset:0}
#menu-stage{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;overflow:hidden;background:#000;cursor:default;-webkit-user-select:none;user-select:none}
#menu-background,#menu-canvas,#popup-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain}
#menu-background{z-index:0}
#menu-audio{display:none}
#menu-canvas{z-index:1;background:transparent;touch-action:manipulation}
#popup-canvas{z-index:2;background:transparent;touch-action:manipulation}
#popup-canvas[hidden]{display:none}
#runtime-status{position:fixed;top:max(1rem,env(safe-area-inset-top));right:max(1rem,env(safe-area-inset-right));z-index:30;box-sizing:border-box;max-width:min(30rem,calc(100vw - 2rem));margin:0;padding:.55rem .85rem;border-radius:.6rem;background:rgba(18,18,22,.55);color:#f4f4f6;font-size:.85rem;line-height:1.35;text-align:left;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;transform:translateY(-.4rem);transition:opacity .4s ease,transform .4s ease;pointer-events:none}
#runtime-status.is-visible{opacity:1;transform:translateY(0)}
#runtime-status.is-error{background:rgba(96,20,26,.7);color:#ffe2df;border:1px solid rgba(255,140,130,.35)}
#runtime-status.is-persistent{pointer-events:auto;cursor:text;-webkit-user-select:text;user-select:text}
#start-menu{position:fixed;left:50%;bottom:max(2rem,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:30;box-sizing:border-box;padding:.65rem 1.15rem;font:inherit;font-size:.95rem;color:#f4f4f6;background:rgba(18,18,22,.55);border:1px solid rgba(255,255,255,.22);border-radius:.6rem;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);cursor:pointer}
#start-menu:hover{background:rgba(32,32,38,.72)}
#start-menu:focus-visible{outline:2px solid #7cc4ff;outline-offset:2px}
#runtime-diagnostics{position:fixed;left:max(1rem,env(safe-area-inset-left));right:max(1rem,env(safe-area-inset-right));bottom:max(1rem,env(safe-area-inset-bottom));z-index:40;box-sizing:border-box;max-height:40vh;margin:0;padding:.75rem .9rem;border-radius:.6rem;overflow:auto;background:rgba(10,10,12,.75);color:#ffb4a9;font:.8rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
`;
export function createReadme(title: string, backgroundLoops: boolean | undefined, externalPlayback: boolean, status: MenuPackageStatus = "partial"): string {
  const playbackNote = backgroundLoops === true
    ? "The detected menu playlist uses a repeated single-clip background loop with its declared primary audio tracks."
    : backgroundLoops === false
      ? "The detected menu playlist holds the final video frame after its single PlayItem; its declared primary audio tracks end with the PlayItem."
      : "No menu background media was exported.";
  return [
    `# ${title.replace(/[\r\n]/g, " ")}`,
    `This is a menu-only preview. Its delivery status is **${status}**. \`complete\` means no known failure was found, not that every scenario has been verified. ${playbackNote} Browser/file:// verification is not included in this package.`,
    "Run `bdmv2web validate <package-directory> --offline` to generate `compatibility.json`, `dependency-audit.json`, and `reports/release-summary.json` from current package evidence. Missing browser or reference evidence remains unverified.",
    externalPlayback ? "Run start-menu.sh to open the menu and enable external playback. You can edit bdmv-config.json and restart the launcher to change the BDMV path." : "Open index.html in Chrome while offline.",
  ].join("\n\n") + "\n";
}

export function runtimeAudioTrackMetadata(track: { streamNumber?: number; path: string; language: string }): { streamNumber: number; psrStreamNumber: number; path: string; language: string } {
  if (!Number.isSafeInteger(track.streamNumber) || track.streamNumber! < 0) throw new TypeError("Exported audio track requires its zero-based STN streamNumber.");
  return { streamNumber: track.streamNumber!, psrStreamNumber: track.streamNumber! + 1, path: track.path, language: track.language };
}

function serializePgsTrack(track: PgsTrackPackageInput) {
  if (!Number.isSafeInteger(track.pid) || !Number.isSafeInteger(track.streamNumber) || track.streamNumber <= 0 || !Number.isSafeInteger(track.playItemIndex) || track.playItemIndex < 0) throw new TypeError("PGS package track has invalid PID, stream number, or PlayItem index.");
  if (BigInt(track.sourceOut90k) <= BigInt(track.sourceIn90k)) throw new TypeError("PGS package track has an invalid source interval.");
  return {
    playlistId: track.playlistId, playlistNumber: track.playlistNumber, playItemIndex: track.playItemIndex,
    clipId: track.clipId, pid: track.pid, streamNumber: track.streamNumber, language: track.language,
    sourceIn90k: track.sourceIn90k, sourceOut90k: track.sourceOut90k, source: track.source, path: track.path,
    displaySets: track.displaySets.map((set) => ({
      pts90k: set.pts90k, width: set.width, height: set.height, compositionNumber: set.compositionNumber,
      compositionState: set.compositionState, paletteId: set.paletteId,
      palette: [...set.palette].map(([index, rgba]) => [index, [...rgba]]),
      bitmaps: [...set.bitmaps.values()].map((bitmap) => ({ objectId: bitmap.objectId, width: bitmap.width, height: bitmap.height, pixels: bitmap.pixels })),
      placements: set.placements,
    })),
  };
}

export function packagedMediaMetadata(media: Awaited<ReturnType<typeof exportMenuLoopMedia>>): Record<string, unknown> {
  return {
    plan: media.plan,
    background: { path: media.background.path, byteLength: media.background.byteLength, codec: media.background.codec, pid: media.background.pid, width: media.background.width, height: media.background.height, durationSeconds: media.background.durationSeconds, loop: media.background.loop },
    audioTracks: media.audioTracks.map((track) => ({ ...runtimeAudioTrackMetadata(track), byteLength: track.byteLength, codec: track.codec, pid: track.pid, durationSeconds: track.durationSeconds })),
  };
}

function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
