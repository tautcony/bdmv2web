import { encodeRgbaPng } from "@bdmv2web/igs";
import type { PngEncodeOptions } from "@bdmv2web/igs";
import type { PgsDisplaySet } from "./pgs.js";

// Re-exported so a caller that already depends on media-export (the package builder)
// can apply the same tuned level without taking a dependency on the IGS package.
export { assertPngLevel, DEFAULT_ASSET_PNG_LEVEL, DEFAULT_CANVAS_PNG_LEVEL } from "@bdmv2web/igs";

export interface RenderedPgsDisplaySet {
  /** 1-based position in the SUP stream. */
  displaySetNumber: number;
  /** Raw presentation timestamp in 90 kHz units, kept for diagnostics. */
  startTime90k: number;
  /** Next display-set PTS, or the caller-supplied track end for the final set. */
  endTime90k: number | null;
  /**
   * Seconds from the caller-supplied origin (track start for an extracted
   * track, first display set for a standalone SUP). A player-ready float, not
   * an absolute PTS: Blu-ray streams may start anywhere on the 90 kHz clock.
   * `null` when the value cannot be anchored.
   */
  startSeconds: number | null;
  endSeconds: number | null;
  width: number;
  height: number;
  /** False when every output pixel has zero alpha. */
  visible: boolean;
  pngBytes: Uint8Array;
}

/**
 * A PTS above this threshold is the unsigned wrap of a negative delta
 * (`pts < origin`), not a real timestamp hours into the stream.
 */
const PTS_WRAP_THRESHOLD = 0x8000_0000;

/** End of one display set is the next set's PTS, falling back to the track end. */
export function pgsDisplaySetEnd90k(displaySets: readonly PgsDisplaySet[], index: number, trackEnd90k?: number): number | null {
  const display = displaySets[index];
  if (!display) return null;
  const next = displaySets[index + 1]?.pts90k;
  if (next !== undefined) return next > display.pts90k ? next : null;
  return trackEnd90k !== undefined && trackEnd90k > display.pts90k ? trackEnd90k : null;
}

/** Convert a 90 kHz timestamp into seconds measured from `origin90k`. */
export function pgsSeconds90k(time90k: number, origin90k = 0): number | null {
  const delta = time90k - origin90k;
  if (!Number.isFinite(delta) || delta < 0 || delta >= PTS_WRAP_THRESHOLD) return null;
  return Math.round((delta / 90000) * 1000) / 1000;
}

/** Render a complete PCS canvas and report whether it contains any visible pixel. */
export function renderPgsDisplaySet(display: PgsDisplaySet, displaySetNumber: number, endTime90k: number | null, origin90k = 0, options: PngEncodeOptions = {}): RenderedPgsDisplaySet {
  const rgba = new Uint8Array(display.width * display.height * 4);
  // Only sourceAlpha > 0 writes, and such a write always leaves a non-zero output
  // alpha, so the painted flag replaces a full-canvas visibility scan.
  let painted = false;
  for (const placement of display.placements) {
    const bitmap = display.bitmaps.get(placement.objectId);
    if (!bitmap) continue;
    const pixels = bitmap.pixels;
    const { width, height } = bitmap;
    const crop = placement.crop ?? { x: 0, y: 0, width, height };
    for (let sy = 0; sy < crop.height; sy++) for (let sx = 0; sx < crop.width; sx++) {
      const dx = placement.x + sx; const dy = placement.y + sy;
      const sourceX = crop.x + sx; const sourceY = crop.y + sy;
      if (dx < 0 || dy < 0 || dx >= display.width || dy >= display.height || sourceX >= width || sourceY >= height) continue;
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const targetOffset = (dy * display.width + dx) * 4;
      if (pixels[sourceOffset + 3] === 0) continue;
      painted = true;
      // Opaque sprites are the common case: copy instead of running the blend.
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
        rgba[targetOffset + channel] = Math.round((pixels[sourceOffset + channel]! * sourceAlpha + rgba[targetOffset + channel]! * targetAlpha * (1 - sourceAlpha)) / outputAlpha);
      }
      rgba[targetOffset + 3] = Math.round(outputAlpha * 255);
    }
  }
  const visible = painted;
  const startSeconds = pgsSeconds90k(display.pts90k, origin90k);
  const rawEndSeconds = endTime90k === null ? null : pgsSeconds90k(endTime90k, origin90k);
  return {
    displaySetNumber,
    startTime90k: display.pts90k,
    endTime90k,
    startSeconds,
    endSeconds: rawEndSeconds !== null && startSeconds !== null && rawEndSeconds > startSeconds ? rawEndSeconds : null,
    width: display.width,
    height: display.height,
    visible,
    pngBytes: visible ? encodeRgbaPng(display.width, display.height, rgba, options) : new Uint8Array(),
  };
}
