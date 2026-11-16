import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { collectInspection } from "../../src/commands/inspect-collection.js";
import { buildInspectionBrowserModel } from "../../src/commands/inspect-browser-model.js";
import type { BrowserRow } from "../../src/commands/inspect-browser-model.js";

const fixture = resolve(import.meta.dirname, "../../../../test-data/fixtures/synthetic-all-features/BDMV");
const selection = { renderPng: false };

function findRow(rows: BrowserRow[], predicate: (row: BrowserRow) => boolean): BrowserRow | undefined {
  for (const row of rows) {
    if (predicate(row)) return row;
    const child = row.children && findRow(row.children, predicate);
    if (child) return child;
  }
  return undefined;
}

describe("inspection browser model", () => {
  it("keeps file ordering, declared PlayItem order, clip targets, source locations, and static MPLS navigation", async () => {
    const data = await collectInspection(fixture, selection, "all");
    const model = buildInspectionBrowserModel(data);
    const playlistIds = model.MPLS.map((row) => (row.value as { id: string }).id);
    expect(playlistIds).toEqual([...playlistIds].sort());

    const playlist = model.MPLS.find((row) => row.children?.length);
    expect(playlist).toBeDefined();
    const items = playlist!.children!;
    expect(items.map((row) => Number((row.value as { index: number }).index))).toEqual(
      [...items].map((row) => Number((row.value as { index: number }).index)).sort((a, b) => a - b),
    );
    const item = items[1] ?? items[0]!;
    const expectedClip = (item.value as { clipId: string }).clipId;
    expect(item.navigateTo).toBe("clip:" + expectedClip);
    const m2ts = model.targets.get(item.navigateTo!);
    expect((m2ts?.value as { fileNode?: { id: string } }).fileNode?.id).toBe("clip:" + expectedClip);
    expect(m2ts?.children?.some((row) => row.label.startsWith("IGS scene "))).toBe(true);
    expect(m2ts?.children?.some((row) => row.label.startsWith("Reachable SUP"))).toBe(true);

    const image = findRow(model.M2TS, (row) => row.label.startsWith("IGS scene "));
    if (image) expect(image.source).toContain("@");
    const entry = model.Navigation.find((row) => row.cells[0] === "firstPlay" || row.cells[0] === "topMenu" || row.cells[0] === "title");
    expect(entry?.navigateTo).toMatch(/^object:\d+$/);
    expect(entry?.children).toBeUndefined();
    const playCommand = findRow(model.Navigation, (row) => row.navigateTo?.startsWith("playlist:") === true);
    expect(playCommand).toBeDefined();
    expect(playCommand?.cells[1]).toContain("PLAY_PL");
    expect(playCommand?.cells[2]).toContain("play → MPLS");
    expect(model.Navigation.some((row) => row.label.startsWith("MovieObject "))).toBe(true);
  });

  it("applies graphics filters to the browser view while keeping structural PlayItems available", async () => {
    const data = await collectInspection(fixture, { renderPng: false, clipId: "00001" }, "sup");
    const model = buildInspectionBrowserModel(data);
    expect(model.M2TS.every((row) => row.label.includes("00001"))).toBe(true);
    expect(model.MPLS.length).toBeGreaterThan(0);
    expect(findRow(model.M2TS, (row) => row.label.startsWith("IGS scene "))).toBeUndefined();
  });

  it("shows structural coverage and links an IGS SubPath to its separately scanned clip", async () => {
    const data = await collectInspection(fixture, selection, "all");
    const playlist = data.disc.playlists[0]!;
    const item = playlist.playItems[0]!;
    const targetClip = data.graphics!.streams.find((stream) => stream.clipId !== item.clipId)!.clipId;
    const cue = data.disc.playlists.flatMap((entry) => entry.playItems.flatMap((playItem) => playItem.streams)).find((stream) => stream.codingType === 0x91)!;
    item.streams = [{ ...cue, streamType: 2, subPathId: 0, subClipId: 0 }];
    playlist.subPaths = [{ type: 3, repeat: false, source: item.source, items: [{ clipId: targetClip, codecId: "M2TS", stcId: 0, connectionCondition: 1, multiClip: false, clips: [], inTime45k: 0, outTime45k: 45_000, syncPlayItemId: 0, syncPts45k: 0, source: item.source }] }];
    data.graphics!.payloadBytesByClip = new Map([...data.graphics!.payloadBytesByClip!].filter(([clipId]) => clipId !== item.clipId));
    data.graphics!.scenes = data.graphics!.scenes.filter((scene) => scene.clipId !== item.clipId);
    data.graphics!.streams = data.graphics!.streams.filter((stream) => stream.clipId !== item.clipId);
    const model = buildInspectionBrowserModel(data);
    const clip = model.targets.get("clip:" + item.clipId)!;
    expect(clip.value).toMatchObject({ scanStatus: "structure-only", relatedIgsClips: [targetClip] });
    expect(clip.children).toContainEqual(expect.objectContaining({ label: "IGS SubPath → M2TS " + targetClip, navigateTo: "clip:" + targetClip }));
    expect(model.targets.get("clip:" + targetClip)?.value).toMatchObject({ scanStatus: "scanned" });
  });

  it("indexes a large conditional navigation graph with one target row per command", async () => {
    const data = await collectInspection(fixture, selection, "all");
    const object = data.disc.movieObjects[0]!;
    const condition = { words: [0x48c00200, 1, 1] as [number, number, number], bytes: "48c002000000000100000001", source: object.source };
    const stop = { words: [0x00020000, 0, 0] as [number, number, number], bytes: "000200000000000000000000", source: object.source };
    object.instructions = [...Array.from({ length: 1000 }, () => condition), stop];
    const model = buildInspectionBrowserModel(data);
    const objectRow = model.targets.get("object:" + object.id);
    expect(objectRow?.children).toHaveLength(1001);
    expect(model.targets.size).toBeLessThan(3000);
    expect(findRow(objectRow?.children ?? [], (row) => row.navigateTo?.startsWith("command:") === true)).toBeDefined();
  });
});
