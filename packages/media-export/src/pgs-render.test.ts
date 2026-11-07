import { describe, expect, it } from "vitest";
import type { PgsDisplaySet } from "./pgs.js";
import { pgsDisplaySetEnd90k, pgsSeconds90k, renderPgsDisplaySet } from "./pgs-render.js";

describe("PGS display-set rendering", () => {
  it("uses the next display-set PTS as the end time and falls back to the track end", () => {
    const sets = [display(90_000), display(180_000)];
    expect(pgsDisplaySetEnd90k(sets, 0)).toBe(180_000);
    expect(pgsDisplaySetEnd90k(sets, 1)).toBeNull();
    expect(pgsDisplaySetEnd90k(sets, 1, 300_000)).toBe(300_000);
    expect(pgsDisplaySetEnd90k(sets, 1, 180_000)).toBeNull();
  });

  it("converts 90 kHz timestamps into seconds measured from the origin", () => {
    // Blu-ray streams do not start at PTS 0: 3 600 s in, the first subtitle
    // must still be reported as 2.5 s from the track start.
    const origin = 3_600 * 90_000;
    expect(pgsSeconds90k(origin + 225_000, origin)).toBe(2.5);
    expect(pgsSeconds90k(origin, origin)).toBe(0);
    // A timestamp before the origin, or an unsigned wrap, has no usable value.
    expect(pgsSeconds90k(origin - 90_000, origin)).toBeNull();
    expect(pgsSeconds90k(0xffff_fff0, 0)).toBeNull();
  });

  it("reports seconds relative to the origin alongside the raw timestamps", () => {
    const rendered = renderPgsDisplaySet(display(3_600 * 90_000 + 90_000), 1, 3_600 * 90_000 + 225_000, 3_600 * 90_000);
    expect(rendered).toMatchObject({ startTime90k: 3_600 * 90_000 + 90_000, startSeconds: 1, endSeconds: 2.5 });
  });

  it("marks a clear composition as invisible and a painted composition as visible", () => {
    const clear = renderPgsDisplaySet(display(90_000), 1, 180_000);
    expect(clear).toMatchObject({ displaySetNumber: 1, startTime90k: 90_000, startSeconds: 1, endTime90k: 180_000, endSeconds: 2, visible: false });
    expect(clear.pngBytes).toHaveLength(0);

    const painted = renderPgsDisplaySet(display(90_000, { x: 1, y: 1, alpha: 255 }), 2, 180_000);
    expect(painted.visible).toBe(true);
    expect(painted).toMatchObject({ displaySetNumber: 2, width: 3, height: 2 });
  });
});

function display(pts90k: number, pixel?: { x: number; y: number; alpha: number }): PgsDisplaySet {
  const bitmap = { objectId: 7, width: 1, height: 1, pixels: Uint8Array.of(255, 255, 255, pixel?.alpha ?? 0) };
  return {
    pts90k, width: 3, height: 2, compositionNumber: 1, compositionState: 0x80, paletteId: 0,
    palette: new Map(), bitmaps: pixel ? new Map([[7, bitmap]]) : new Map(),
    placements: pixel ? [{ objectId: 7, windowId: 0, x: pixel.x, y: pixel.y }] : [],
  };
}
