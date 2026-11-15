import { describe, expect, it } from "vitest";
import type { SerializedScene } from "@bdmv2web/core/runtime-data";
import { createMenuRouting } from "./action-routing.js";

function scene(id: string): SerializedScene {
  return { id, width: 1920, height: 1080, compositionTimeout90k: null, selectionTimeout90k: null, pages: [] };
}

const routing = createMenuRouting({
  menuScenes: [
    { playlistId: 3, playItem: 0, igStreamNumber: 1, igStreamCount: 2, sceneId: "main" },
    { playlistId: 3, playItem: 0, igStreamNumber: 2, igStreamCount: 2, sceneId: "sub" },
    { playlistId: 3, playItem: 2, sceneId: "third" },
  ],
  scenes: { main: scene("main"), sub: scene("sub"), third: scene("third") },
  menuPlaylistMarks: [{ playlistId: 3, marks: [{ index: 4, playItemRef: 2 }] }],
});

describe("menu action routing", () => {
  it("resolves PlayItem and mark operands to the addressed PlayItem", () => {
    expect(routing.requestedPlayItem(3, { type: "PLAY_PLAYLIST_ITEM", payload: { playlist: 3, playItem: 2 } })).toBe(2);
    expect(routing.requestedPlayItem(3, { type: "PLAY_PLAYLIST", payload: { playlist: 3 } })).toBe(0);
    expect(routing.requestedPlayItem(3, { type: "PLAY_PLAYLIST_MARK", payload: { playlist: 3, playMark: 4 } })).toBe(2);
    expect(routing.requestedPlayItem(3, { type: "PLAY_PLAYLIST_MARK", payload: { playlist: 3, playMark: 99 } })).toBe(0);
  });

  it("selects the packaged composition for a playlist PlayItem and stream", () => {
    expect(routing.sceneTarget(3, 0, 2)).toMatchObject({ scene: { id: "sub" }, playlistId: 3, playItem: 0, igStreamNumber: 2 });
    expect(routing.sceneTarget(3, 0, 9)).toMatchObject({ scene: { id: "main" }, igStreamNumber: 1 });
    expect(routing.sceneTarget(3, 0, 9, false)).toBeUndefined();
    expect(routing.sceneTarget(3, 1, 1)).toBeUndefined();
  });

  it("keeps media localization for PlayItem and mark actions", () => {
    expect(routing.playlistActionTarget({ type: "PLAY_PLAYLIST_ITEM", payload: { playlist: 3, playItem: 2 } }, 1)).toMatchObject({ scene: { id: "third" }, playItem: 2 });
    expect(routing.playlistActionTarget({ type: "PLAY_PLAYLIST_MARK", payload: { playlist: 3, playMark: 4 } }, 1)).toMatchObject({ scene: { id: "third" }, playItem: 2 });
    expect(routing.playlistActionTarget({ type: "PLAY_PLAYLIST", payload: { playlist: 9 } }, 1)).toBeUndefined();
  });
});
