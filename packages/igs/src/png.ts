import { deflateSync } from "node:zlib";
import type { IgsAsset, IgsDiagnostic, IgsScene } from "./types.js";

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

export function renderSceneAssets(scene: IgsScene): { assets: IgsAsset[]; diagnostics: IgsDiagnostic[] } {
  const assets: IgsAsset[] = []; const diagnostics: IgsDiagnostic[] = [];
  for (const page of scene.pages) {
    if (page.rawEffects.enterEffectCount || page.rawEffects.exitEffectCount) {
      scene.complete = false;
      diagnostics.push({ severity: "warning", code: "IGS_UNSUPPORTED_EFFECT", message: `Page ${page.id} declares ${page.rawEffects.enterEffectCount} enter and ${page.rawEffects.exitEffectCount} exit effect(s); raw bytes are retained, visual timing is not interpreted`, source: scene.source, affectedSceneIds: [scene.id], details: { pageId: page.id, enterCount: page.rawEffects.enterEffectCount, exitCount: page.rawEffects.exitEffectCount } });
    }
    const palette = [...scene.palettes].reverse().find((p) => p.id === page.paletteId);
    if (!palette) {
      scene.complete = false;
      diagnostics.push({ severity: "error", code: "UNRESOLVED_PALETTE", message: `Page ${page.id} references palette ${page.paletteId} with no available definition`, source: scene.source, affectedSceneIds: [scene.id] });
      continue;
    }
    const objectIds = new Set<number>();
    for (const button of page.buttons) {
      for (const state of [button.visuals.normal, button.visuals.selected, button.visuals.activated]) {
        if (state.startObjectId !== 0xffff) objectIds.add(state.startObjectId);
        if (state.endObjectId !== 0xffff) objectIds.add(state.endObjectId);
      }
    }
    for (const objectId of objectIds) {
      const object = [...scene.objects].reverse().find((item) => item.id === objectId);
      if (!object) {
        scene.complete = false;
        diagnostics.push({ severity: "error", code: "UNRESOLVED_OBJECT", message: `Page ${page.id} references object ${objectId} with no available definition`, source: scene.source, affectedSceneIds: [scene.id] });
        continue;
      }
      const rgba = new Uint8Array(object.indices.length * 4);
      for (let i = 0; i < object.indices.length; i++) {
        const index = object.indices[i]!; const entry = palette.entries.get(index);
        // Palette definitions may omit indices. The pinned libbluray PDS decoder
        // starts its 256-entry table at zero before applying the sparse entries;
        // in IGS the alpha component is direct, so an omitted entry is transparent.
        if (!entry) continue;
        const [r, g, b] = ycbcrLimited709(entry.y, entry.cb, entry.cr);
        const offset = i * 4; rgba[offset] = r; rgba[offset + 1] = g; rgba[offset + 2] = b; rgba[offset + 3] = entry.alpha;
      }
      const pngBytes = encodeRgbaPng(object.width, object.height, rgba);
      const id = `igs-${scene.clipId}-${scene.pid}-${scene.compositionNumber}-p${page.id}-o${object.id}v${object.version}-pal${palette.id}v${palette.version}`;
      assets.push({ id, relativePath: `assets/graphics/${safe(id)}.png`, mimeType: "image/png", width: object.width, height: object.height, pngBytes, objectId: object.id, objectVersion: object.version, paletteId: palette.id, paletteVersion: palette.version, source: object.source, colorConversion: "bt709-limited-round-nearest" });
    }
  }
  return { assets, diagnostics };
}

export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new RangeError("RGBA dimensions do not match pixel data");
  const scanlines = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) scanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const ihdr = new Uint8Array(13); putU32(ihdr, 0, width); putU32(ihdr, 4, height); ihdr.set([8, 6, 0, 0, 0], 8);
  return concat(SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(scanlines))), chunk("IEND", new Uint8Array()));
}

function ycbcrLimited709(y: number, cb: number, cr: number): [number, number, number] {
  const yy = (y - 16) * (255 / 219); const u = (cb - 128) * (255 / 224); const v = (cr - 128) * (255 / 224);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.floor(n + 0.5)));
  const kr = 0.2126; const kb = 0.0722; const kg = 1 - kr - kb;
  return [clamp(yy + 2 * (1 - kr) * v), clamp(yy - 2 * (1 - kb) * kb / kg * u - 2 * (1 - kr) * kr / kg * v), clamp(yy + 2 * (1 - kb) * u)];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type); const body = concat(typeBytes, data); const out = new Uint8Array(12 + data.length);
  putU32(out, 0, data.length); out.set(body, 4); putU32(out, 8 + data.length, crc32(body)); return out;
}
function crc32(data: Uint8Array): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function putU32(out: Uint8Array, offset: number, value: number): void { out[offset] = value >>> 24; out[offset + 1] = value >>> 16; out[offset + 2] = value >>> 8; out[offset + 3] = value; }
function concat(...parts: Uint8Array[]): Uint8Array { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; }
function safe(value: string): string { return value.replace(/[^A-Za-z0-9_.-]/g, "_"); }
