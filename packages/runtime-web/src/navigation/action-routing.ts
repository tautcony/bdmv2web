import type { NavigationAction } from "@bdmv2web/hdmv";
import type { RuntimeMenuPlaylistMark, RuntimeMenuSceneEntry, SerializedScene } from "@bdmv2web/core/runtime-data";

/** Packaged routing data needed to resolve a playlist/PlayItem/mark action. */
export interface MenuRoutingData {
  menuScenes?: RuntimeMenuSceneEntry[];
  scenes?: Record<string, SerializedScene>;
  menuPlaylistMarks?: RuntimeMenuPlaylistMark[];
}

export interface RoutedMenuScene {
  scene: SerializedScene;
  playlistId: number;
  playItem: number;
  igStreamNumber?: number;
  igStreamCount?: number;
}

export interface MenuRouting {
  /** PlayItem a `PLAY_*`/`LINK_*` action addresses inside the named playlist. */
  requestedPlayItem(playlist: number, action: Pick<NavigationAction, "type" | "payload">): number;
  /** IG stream selected by PSR0, falling back to the first declared stream. */
  effectiveIgStreamNumber(playlist: number, playItem: number, requestedStream: number, fallbackToFirst?: boolean): number | undefined;
  /** Packaged composition for one playlist PlayItem. */
  sceneTarget(playlist: number, playItem: number, requestedStream: number, fallbackToFirst?: boolean): RoutedMenuScene | undefined;
  /** Packaged composition addressed by a `PLAY_PLAYLIST*` action. */
  playlistActionTarget(action: Pick<NavigationAction, "type" | "payload">, requestedStream: number): RoutedMenuScene | undefined;
}

export const MENU_PLAYLIST_ACTIONS = ["PLAY_PLAYLIST", "PLAY_PLAYLIST_ITEM", "PLAY_PLAYLIST_MARK"] as const;
export const MENU_LINK_ACTIONS = ["LINK_PLAY_ITEM", "LINK_PLAY_MARK"] as const;

export function isMenuPlaylistAction(action: Pick<NavigationAction, "type">): boolean {
  return (MENU_PLAYLIST_ACTIONS as readonly string[]).includes(action.type);
}

export function isMenuLinkAction(action: Pick<NavigationAction, "type">): boolean {
  return (MENU_LINK_ACTIONS as readonly string[]).includes(action.type);
}

/**
 * Resolve packaged scenes from menu metadata shared by the local VM and the
 * server-owned VM. DOM, VM and playback side effects stay in `browser.ts`.
 */
export function createMenuRouting(data: MenuRoutingData): MenuRouting {
  const requestedPlayItem = (playlist: number, action: Pick<NavigationAction, "type" | "payload">): number => {
    if ((action.type === "PLAY_PLAYLIST_ITEM" || action.type === "LINK_PLAY_ITEM") && typeof action.payload.playItem === "number") return action.payload.playItem;
    if ((action.type === "PLAY_PLAYLIST_MARK" || action.type === "LINK_PLAY_MARK") && typeof action.payload.playMark === "number") {
      return data.menuPlaylistMarks?.find((item) => item.playlistId === playlist)?.marks.find((mark) => mark.index === action.payload.playMark)?.playItemRef ?? 0;
    }
    return 0;
  };

  const effectiveIgStreamNumber = (playlist: number, playItem: number, requestedStream: number, fallbackToFirst = true): number | undefined => {
    const candidates = (data.menuScenes ?? []).filter((item) => item.playlistId === playlist && (item.playItem ?? 0) === playItem);
    if (!candidates.length) return undefined;
    const streamCount = Math.max(0, ...candidates.map((item) => item.igStreamCount ?? item.igStreamNumber ?? 0));
    if (!streamCount) return undefined;
    if (requestedStream > 0 && requestedStream <= streamCount) return requestedStream;
    return fallbackToFirst ? 1 : undefined;
  };

  const sceneTarget = (playlist: number, playItem: number, requestedStream: number, fallbackToFirst = true): RoutedMenuScene | undefined => {
    const candidates = (data.menuScenes ?? []).flatMap((item) => {
      if (item.playlistId !== playlist || (item.playItem ?? 0) !== playItem) return [];
      const scene = data.scenes?.[item.sceneId];
      return scene ? [{ ...item, scene }] : [];
    });
    if (!candidates.length) return undefined;
    const hasStreamMetadata = candidates.some((item) => item.igStreamCount !== undefined || item.igStreamNumber !== undefined);
    const selectedStream = effectiveIgStreamNumber(playlist, playItem, requestedStream, fallbackToFirst);
    if (!hasStreamMetadata) return { ...candidates[0]!, playItem: candidates[0]!.playItem ?? 0 };
    if (selectedStream === undefined) return undefined;
    const selected = candidates.find((item) => item.igStreamNumber === selectedStream);
    return selected ? { ...selected, playItem: selected.playItem ?? 0 } : undefined;
  };

  const playlistActionTarget = (action: Pick<NavigationAction, "type" | "payload">, requestedStream: number): RoutedMenuScene | undefined => {
    if (typeof action.payload.playlist !== "number") return undefined;
    const playlist = action.payload.playlist;
    return sceneTarget(playlist, requestedPlayItem(playlist, action), requestedStream);
  };

  return { requestedPlayItem, effectiveIgStreamNumber, sceneTarget, playlistActionTarget };
}
