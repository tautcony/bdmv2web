import type { MenuLoopMediaInput } from "./media-types.js";

/** Package-relative names for one encoded menu media unit. */
export function menuMediaPaths(input: Pick<MenuLoopMediaInput, "playlistId" | "playItemIndex" | "clipId">): { directory: string; planPath: string } {
  const id = `playlist-${input.playlistId}-pi${String(input.playItemIndex).padStart(2, "0")}-clip-${input.clipId}`.replace(/[^0-9A-Za-z._-]/g, "_");
  return { directory: `assets/media/${id}`, planPath: `media-plans/${id}.json` };
}

/**
 * Compatible media paths: one folder per playlist PlayItem
 * (`playlist-<id>-pi<n>`, no clip in the name), and the Top Menu background at
 * the media root. Reuse checks these after the current names, so a package or
 * unfinished staging directory resumes with its existing encoded media.
 */
export function priorMenuMediaPaths(input: Pick<MenuLoopMediaInput, "playlistId" | "playItemIndex">): Array<{ assetDirectory: string; planPath: string }> {
  const id = `playlist-${input.playlistId}-pi${input.playItemIndex}`.replace(/[^0-9A-Za-z._-]/g, "_");
  return [
    { assetDirectory: `assets/media/${id}`, planPath: `media-plans/${id}.json` },
    { assetDirectory: "assets/media", planPath: "media-plan.json" },
  ];
}
