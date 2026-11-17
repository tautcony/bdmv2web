import { encodeIndexedPng, encodeRgbaPng, paletteRgbaTable } from "@bdmv2web/igs";
import type { IgsObject, IgsPalette, IgsScene } from "@bdmv2web/igs";
import type { SupDisplaySetSummary } from "./inspect-sup.js";

export interface ImagePreview {
  object: IgsObject;
  palettes: IgsPalette[];
}

export function imagePreview(scene: IgsScene, object: IgsObject): ImagePreview {
  const palettes = [...new Map(scene.palettes.map((palette) => [palette.id, palette])).values()];
  let preferredId: number | undefined;
  for (const page of scene.pages) {
    if (page.buttons.some((button) => Object.values(button.visuals).some((state) => object.id >= state.startObjectId && object.id <= state.endObjectId))) {
      preferredId = page.paletteId;
      break;
    }
    const effect = [...page.effects.enter.effects, ...page.effects.exit.effects].find((item) => item.objects.some((entry) => entry.objectId === object.id));
    if (effect) { preferredId = effect.paletteId; break; }
  }
  const preferred = palettes.findIndex((palette) => palette.id === preferredId);
  if (preferred > 0) palettes.unshift(palettes.splice(preferred, 1)[0]!);
  return { object, palettes };
}

export interface SupImagePreview {
  summary: SupDisplaySetSummary;
  width: number;
  height: number;
  png: Uint8Array;
}

export function supImagePreview(summary: SupDisplaySetSummary): SupImagePreview | undefined {
  if (!summary.visible || summary.boxWidth <= 0 || summary.boxHeight <= 0) return undefined;
  const { boxWidth, boxHeight, boxX, boxY, displaySet } = summary;
  const rgba = new Uint8Array(boxWidth * boxHeight * 4);
  let painted = false;
  for (const placement of displaySet.placements) {
    const bitmap = displaySet.bitmaps.get(placement.objectId);
    if (!bitmap) continue;
    const pixels = bitmap.pixels;
    const { width, height } = bitmap;
    const crop = placement.crop ?? { x: 0, y: 0, width, height };
    for (let sy = 0; sy < crop.height; sy++) {
      for (let sx = 0; sx < crop.width; sx++) {
        const dx = placement.x + sx - boxX;
        const dy = placement.y + sy - boxY;
        const sourceX = crop.x + sx;
        const sourceY = crop.y + sy;
        if (dx < 0 || dy < 0 || dx >= boxWidth || dy >= boxHeight || sourceX >= width || sourceY >= height) continue;
        const sourceOffset = (sourceY * width + sourceX) * 4;
        const targetOffset = (dy * boxWidth + dx) * 4;
        if (pixels[sourceOffset + 3] === 0) continue;
        painted = true;
        if (pixels[sourceOffset + 3] === 255 && rgba[targetOffset + 3] === 0) {
          rgba[targetOffset] = pixels[sourceOffset]!;
          rgba[targetOffset + 1] = pixels[sourceOffset + 1]!;
          rgba[targetOffset + 2] = pixels[sourceOffset + 2]!;
          rgba[targetOffset + 3] = 255;
          continue;
        }
        const sourceAlpha = pixels[sourceOffset + 3]! / 255;
        const targetAlpha = rgba[targetOffset + 3]! / 255;
        const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
        for (let channel = 0; channel < 3; channel++) {
          rgba[targetOffset + channel] = Math.round(
            (pixels[sourceOffset + channel]! * sourceAlpha + rgba[targetOffset + channel]! * targetAlpha * (1 - sourceAlpha)) / outputAlpha
          );
        }
        rgba[targetOffset + 3] = Math.round(outputAlpha * 255);
      }
    }
  }
  if (!painted) return undefined;
  const png = encodeRgbaPng(boxWidth, boxHeight, rgba);
  return { summary, width: boxWidth, height: boxHeight, png };
}

export type ImageProtocol = "kitty" | "iterm2" | "none";

export function imageProtocol(env: NodeJS.ProcessEnv, isTTY: boolean): ImageProtocol {
  if (!isTTY || process.platform === "win32" || env.TMUX || env.STY) return "none";
  const term = (env.TERM ?? "").toLowerCase();
  const program = (env.TERM_PROGRAM ?? "").toLowerCase();
  if (program.includes("iterm")) return "iterm2";
  return env.KITTY_WINDOW_ID || term.includes("kitty") || ["kitty", "ghostty", "wezterm", "warp", "otty"].some((name) => program.includes(name)) ? "kitty" : "none";
}

const apc = (header: string, body = "") => `\x1b_G${header};${body}\x1b\\`;
const IMAGE_ID = 0x42444d56;

export class ImagePreviewOverlay {
  private active: { x: number; y: number; cols: number; rows: number; kind: "igs" | "sup"; key: unknown; secondaryKey?: unknown; width: number; height: number } | undefined;
  private pending: { kind: "igs" | "sup"; key: unknown; secondaryKey?: unknown; width: number; height: number; png?: Uint8Array; x: number; y: number; columns: number; rows: number } | undefined;
  constructor(private readonly output: { write: (value: string) => unknown }, private readonly protocol: ImageProtocol) {}

  show(preview: ImagePreview, palette: IgsPalette, rect: { x: number; y: number; columns: number; rows: number }): void {
    const sameImage = this.active?.kind === "igs" && this.active.key === preview.object && this.active.secondaryKey === palette;
    const png = sameImage && this.protocol === "kitty" ? undefined : encodeIndexedPng(preview.object.width, preview.object.height, preview.object.indices, paletteRgbaTable(palette));
    this.pending = { kind: "igs", key: preview.object, secondaryKey: palette, width: preview.object.width, height: preview.object.height, ...(png ? { png } : {}), ...rect };
  }

  showSup(preview: SupImagePreview, rect: { x: number; y: number; columns: number; rows: number }): void {
    const sameImage = this.active?.kind === "sup" && this.active.key === preview.summary.displaySet && this.active.secondaryKey === preview.summary.startTime90k;
    const png = sameImage && this.protocol === "kitty" ? undefined : preview.png;
    this.pending = { kind: "sup", key: preview.summary.displaySet, secondaryKey: preview.summary.startTime90k, width: preview.width, height: preview.height, ...(png ? { png } : {}), ...rect };
  }

  clear(): void {
    this.pending = undefined;
    if (this.active && this.protocol === "kitty") this.output.write(apc(`a=d,d=I,i=${IMAGE_ID},q=2`));
    if (this.active && this.protocol === "iterm2") {
      let erase = "\x1b7";
      for (let row = 0; row < this.active.rows; row++) erase += `\x1b[${row + this.active.y};${this.active.x}H\x1b[${this.active.cols}X`;
      this.output.write(erase + "\x1b8");
    }
    this.active = undefined;
  }

  flush(): void {
    const image = this.pending;
    if (!image) return;
    this.pending = undefined;
    const maxCols = Math.max(1, image.columns);
    const maxRows = Math.max(1, image.rows);
    const cols = Math.max(1, Math.min(maxCols, Math.floor(maxRows * 2 * image.width / image.height)));
    const rows = Math.max(1, Math.min(maxRows, Math.ceil(cols * image.height / image.width / 2)));
    const sameImage = this.active?.kind === image.kind && this.active.key === image.key && this.active.secondaryKey === image.secondaryKey;
    if (sameImage && this.active?.x === image.x && this.active.y === image.y && this.active.cols === cols && this.active.rows === rows) return;
    if (sameImage && this.protocol === "kitty") {
      this.output.write(apc(`a=d,d=i,i=${IMAGE_ID},p=1,q=2`) + `\x1b7\x1b[${image.y};${image.x}H${apc(`a=p,i=${IMAGE_ID},p=1,c=${cols},r=${rows},C=1,q=2`)}\x1b8`);
      this.active = { x: image.x, y: image.y, cols, rows, kind: image.kind, key: image.key, secondaryKey: image.secondaryKey, width: image.width, height: image.height };
      return;
    }
    this.clear();
    if (!image.png) return;
    const encoded = Buffer.from(image.png).toString("base64");
    if (this.protocol === "iterm2") {
      this.output.write(`\x1b7\x1b[${image.y};${image.x}H\x1b]1337;File=inline=1;width=${cols};height=${rows};preserveAspectRatio=1:${encoded}\x07\x1b8`);
      this.active = { x: image.x, y: image.y, cols, rows, kind: image.kind, key: image.key, secondaryKey: image.secondaryKey, width: image.width, height: image.height };
      return;
    }
    if (this.protocol !== "kitty") return;
    let output = "";
    for (let offset = 0; offset < encoded.length; offset += 4096) {
      const more = offset + 4096 < encoded.length ? 1 : 0;
      output += apc(offset === 0 ? `a=t,f=100,i=${IMAGE_ID},q=2,m=${more}` : `q=2,m=${more}`, encoded.slice(offset, offset + 4096));
    }
    output += `\x1b7\x1b[${image.y};${image.x}H${apc(`a=p,i=${IMAGE_ID},p=1,c=${cols},r=${rows},C=1,q=2`)}\x1b8`;
    this.output.write(output);
    this.active = { x: image.x, y: image.y, cols, rows, kind: image.kind, key: image.key, secondaryKey: image.secondaryKey, width: image.width, height: image.height };
  }
}
