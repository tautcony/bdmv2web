import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBdmvWithInputTable } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes } from "@bdmv2web/igs";
import { collectDeclaredSupForClip, extractSupStreamsFromM2ts, extractSupStreamsFromPackets, resolveClipM2tsPath } from "../../src/commands/inspect-sup.js";
import { DiscPgsPacketCache } from "../../src/shared/disc-pgs-packets.js";

const fixture = resolve(import.meta.dirname, "../../../../test-data/fixtures/synthetic-all-features/BDMV");

describe("inspection SUP replay", () => {
  it("replays PGS packets from the IGS scan with the same SUP bytes and payload counts", async () => {
    const { disc, table } = await parseBdmvWithInputTable(fixture);
    const clipId = "00002";
    const requests = collectDeclaredSupForClip(disc, [], clipId, { renderPng: false }, "all");
    const packets = new DiscPgsPacketCache(() => new Set(requests.map(({ pid }) => pid)));
    const source = resolveClipM2tsPath(disc, clipId)!;
    await extractIgsScenes(disc, { table, renderAssets: false, clipFilter: (id) => id === clipId, scanClipPackets: packets.scan });
    const batches = packets.take(source, requests)!;
    const expected = await extractSupStreamsFromM2ts(clipId, source, requests);
    expect(expected.streams.size).toBeGreaterThan(1);
    expect(await extractSupStreamsFromPackets(clipId, batches, requests)).toEqual(expected);
  });
});
