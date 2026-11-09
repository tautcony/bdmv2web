import { crc32, deflateSync } from "node:zlib";
import type { IgsAsset, IgsDiagnostic, IgsObject, IgsPalette, IgsScene } from "./types.js";

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
const TYPE_IHDR = Uint8Array.of(73, 72, 68, 82);
const TYPE_IDAT = Uint8Array.of(73, 68, 65, 84);
const TYPE_IEND = Uint8Array.of(73, 69, 78, 68);
const EMPTY = new Uint8Array(0);

/**
 * One palette entry per index, pre-converted to RGBA. A page reuses a palette across
 * hundreds of objects, so converting every pixel through a function that allocates a
 * tuple per pixel dominated the render.
 */
function paletteTable(palette: IgsPalette): { bytes: Uint8Array; words: Uint32Array | null } {
  const bytes = new Uint8Array(256 * 4);
  // Palette definitions may omit indices. The pinned libbluray PDS decoder starts its
  // 256-entry table at zero before applying the sparse entries; in IGS the alpha
  // component is direct, so an omitted entry is transparent.
  for (const [index, entry] of palette.entries) {
    if (index > 255) continue;
    const [r, g, b] = ycbcrLimited709(entry.y, entry.cb, entry.cr);
    const at = index * 4; bytes[at] = r; bytes[at + 1] = g; bytes[at + 2] = b; bytes[at + 3] = entry.alpha;
  }
  return { bytes, words: LITTLE_ENDIAN ? new Uint32Array(bytes.buffer) : null };
}


export function renderSceneAssets(scene: IgsScene): { assets: IgsAsset[]; diagnostics: IgsDiagnostic[] } {
  const assets: IgsAsset[] = []; const diagnostics: IgsDiagnostic[] = [];
  // Later definitions win, matching the previous reverse-then-find lookup without
  // rebuilding a reversed array for every referenced object.
  const palettesById = new Map<number, IgsPalette>(); for (const item of scene.palettes) palettesById.set(item.id, item);
  const objectsById = new Map<number, IgsObject>(); for (const item of scene.objects) objectsById.set(item.id, item);
  const paletteTables = new Map<IgsPalette, { bytes: Uint8Array; words: Uint32Array | null }>();
  for (const page of scene.pages) {
    const objectPalettes = new Map<string, { objectId: number; paletteId: number }>();
    const add = (objectId: number, paletteId: number) => { if (objectId !== 0xffff) objectPalettes.set(`${objectId}:${paletteId}`, { objectId, paletteId }); };
    for (const button of page.buttons) {
      for (const state of [button.visuals.normal, button.visuals.selected, button.visuals.activated]) {
        if (state.startObjectId !== 0xffff && state.endObjectId !== 0xffff && state.endObjectId >= state.startObjectId) {
          for (const object of scene.objects) if (object.id >= state.startObjectId && object.id <= state.endObjectId) add(object.id, page.paletteId);
          add(state.startObjectId, page.paletteId); add(state.endObjectId, page.paletteId);
        } else { add(state.startObjectId, page.paletteId); add(state.endObjectId, page.paletteId); }
      }
    }
    for (const sequence of [page.effects.enter, page.effects.exit]) for (const effect of sequence.effects) for (const item of effect.objects) add(item.objectId, effect.paletteId);
    for (const { objectId, paletteId } of objectPalettes.values()) {
      const palette = palettesById.get(paletteId);
      if (!palette) {
        scene.complete = false;
        diagnostics.push({ severity: "error", code: "UNRESOLVED_PALETTE", message: `Page ${page.id} references palette ${paletteId} with no available definition`, source: scene.source, affectedSceneIds: [scene.id] });
        continue;
      }
      const object = objectsById.get(objectId);
      if (!object) {
        scene.complete = false;
        diagnostics.push({ severity: "error", code: "UNRESOLVED_OBJECT", message: `Page ${page.id} references object ${objectId} with no available definition`, source: scene.source, affectedSceneIds: [scene.id] });
        continue;
      }
      const rgba = new Uint8Array(object.indices.length * 4);
      const table = paletteTables.get(palette) ?? paletteTable(palette);
      paletteTables.set(palette, table);
      const words = LITTLE_ENDIAN ? new Uint32Array(rgba.buffer) : null;
      if (words && table.words) for (let i = 0; i < object.indices.length; i++) words[i] = table.words[object.indices[i]!]!;
      else for (let i = 0; i < object.indices.length; i++) {
        const from = object.indices[i]! * 4, to = i * 4;
        rgba[to] = table.bytes[from]!; rgba[to + 1] = table.bytes[from + 1]!; rgba[to + 2] = table.bytes[from + 2]!; rgba[to + 3] = table.bytes[from + 3]!;
      }
      const pngBytes = encodeRgbaPng(object.width, object.height, rgba);
      const id = `igs-${scene.clipId}-${scene.pid}-${scene.compositionNumber}-p${page.id}-o${object.id}v${object.version}-pal${palette.id}v${palette.version}`;
      assets.push({ id, relativePath: `assets/graphics/${safe(id)}.png`, mimeType: "image/png", width: object.width, height: object.height, pngBytes, objectId: object.id, objectVersion: object.version, paletteId: palette.id, paletteVersion: palette.version, source: object.source, colorConversion: "bt709-limited-round-nearest" });
    }
  }
  return { assets, diagnostics };
}

/** Render package-ready PNG assets for scenes that were extracted without assets. */
export function renderIgsAssets(scenes: readonly IgsScene[]): { assets: IgsAsset[]; diagnostics: IgsDiagnostic[] } {
  const assets: IgsAsset[] = [];
  const diagnostics: IgsDiagnostic[] = [];
  for (const scene of scenes) {
    const rendered = renderSceneAssets(scene);
    assets.push(...rendered.assets);
    diagnostics.push(...rendered.diagnostics);
  }
  return { assets, diagnostics };
}

/** Validate rendered-element references without allocating or encoding PNG images. */
export function validateIgsSceneAssets(scenes: readonly IgsScene[]): IgsDiagnostic[] {
  const diagnostics: IgsDiagnostic[] = [];
  for (const scene of scenes) {
    const paletteIds = new Set<number>(); for (const item of scene.palettes) paletteIds.add(item.id);
    const objectIds = new Set<number>(); for (const item of scene.objects) objectIds.add(item.id);
    for (const page of scene.pages) {
      const objectPalettes = new Map<string, { objectId: number; paletteId: number }>();
      const add = (objectId: number, paletteId: number) => { if (objectId !== 0xffff) objectPalettes.set(`${objectId}:${paletteId}`, { objectId, paletteId }); };
      for (const button of page.buttons) for (const state of [button.visuals.normal, button.visuals.selected, button.visuals.activated]) {
        if (state.startObjectId !== 0xffff && state.endObjectId !== 0xffff && state.endObjectId >= state.startObjectId) {
          for (const object of scene.objects) if (object.id >= state.startObjectId && object.id <= state.endObjectId) add(object.id, page.paletteId);
          add(state.startObjectId, page.paletteId); add(state.endObjectId, page.paletteId);
        } else { add(state.startObjectId, page.paletteId); add(state.endObjectId, page.paletteId); }
      }
      for (const sequence of [page.effects.enter, page.effects.exit]) for (const effect of sequence.effects) for (const item of effect.objects) add(item.objectId, effect.paletteId);
      for (const { objectId, paletteId } of objectPalettes.values()) {
        if (!paletteIds.has(paletteId)) {
          scene.complete = false;
          diagnostics.push({ severity: "error", code: "UNRESOLVED_PALETTE", message: `Page ${page.id} references palette ${paletteId} with no available definition`, source: scene.source, affectedSceneIds: [scene.id] });
          continue;
        }
        if (!objectIds.has(objectId)) {
          scene.complete = false;
          diagnostics.push({ severity: "error", code: "UNRESOLVED_OBJECT", message: `Page ${page.id} references object ${objectId} with no available definition`, source: scene.source, affectedSceneIds: [scene.id] });
        }
      }
    }
  }
  return diagnostics;
}

export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new RangeError("RGBA dimensions do not match pixel data");
  const scanlines = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const compressed = deflateSync(scanlines);
  const ihdr = new Uint8Array(13); putU32(ihdr, 0, width); putU32(ihdr, 4, height); ihdr.set([8, 6, 0, 0, 0], 8);
  // One buffer for the whole file: the IDAT payload used to be copied into a typed
  // array, then into a chunk body, then into the chunk, then into the file.
  const png = new Uint8Array(8 + 12 + 13 + 12 + compressed.length + 12);
  png.set(SIGNATURE, 0);
  let at = 8;
  at = writeChunk(png, at, TYPE_IHDR, ihdr);
  at = writeChunk(png, at, TYPE_IDAT, compressed);
  writeChunk(png, at, TYPE_IEND, EMPTY);
  return png;
}

function ycbcrLimited709(y: number, cb: number, cr: number): [number, number, number] {
  const yy = (y - 16) * (255 / 219); const u = (cb - 128) * (255 / 224); const v = (cr - 128) * (255 / 224);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.floor(n + 0.5)));
  const kr = 0.2126; const kb = 0.0722; const kg = 1 - kr - kb;
  return [clamp(yy + 2 * (1 - kr) * v), clamp(yy - 2 * (1 - kb) * kb / kg * u - 2 * (1 - kr) * kr / kg * v), clamp(yy + 2 * (1 - kb) * u)];
}

function writeChunk(out: Uint8Array, offset: number, type: Uint8Array, data: Uint8Array): number {
  putU32(out, offset, data.length);
  out.set(type, offset + 4);
  out.set(data, offset + 8);
  putU32(out, offset + 8 + data.length, crc32(out.subarray(offset + 4, offset + 8 + data.length)));
  return offset + 12 + data.length;
}
function putU32(out: Uint8Array, offset: number, value: number): void { out[offset] = value >>> 24; out[offset + 1] = value >>> 16; out[offset + 2] = value >>> 8; out[offset + 3] = value; }
function safe(value: string): string { return value.replace(/[^A-Za-z0-9_.-]/g, "_"); }
