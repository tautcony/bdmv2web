import { describe, expect, it } from "vitest";
import { BinaryCursor, parseDiscIR, type ActionEnvelope } from "@bdmv2web/core";
import { buildCursorSample, damagedDanglingReference, damagedUnknownVersion, loadGolden, menuInteractionFixture, minimalHdmvGolden, mixedBdjGolden, simulatedBridge } from "./index.js";

describe("shared contract fixtures", () => {
  it("loads independently authored minimal and mixed navigation golden JSON", () => {
    expect(loadGolden(minimalHdmvGolden).entries[0]?.navigation.type).toBe("HDMV");
    const mixed = loadGolden(mixedBdjGolden);
    expect(mixed.entries.map((x) => x.navigation.type)).toEqual(["HDMV", "BDJ"]);
    if (mixed.entries[1]?.navigation.type === "BDJ") expect(mixed.entries[1].navigation.bdjoId).toBe("00001");
  });
  it("retains field-level failure locations for corrupt cases", () => {
    expect(() => parseDiscIR(damagedUnknownVersion)).toThrow("/schemaVersion");
    expect(() => parseDiscIR(damagedDanglingReference)).toThrow("/playlists/0/programIds/0");
  });
  it("round-trips a shared action and response envelope through a simulated bridge", () => {
    const action: ActionEnvelope<{ type: string }> = { sessionId: "session-1", generation: 8, actionId: "action-4", action: { type: "PLAY" } };
    const response = simulatedBridge(action, { type: "PLAY_STARTED" });
    expect(JSON.parse(JSON.stringify(response))).toEqual({ sessionId: "session-1", generation: 8, sequence: 1, responseTo: "action-4", event: { type: "PLAY_STARTED" } });
  });
  it("builds a fixed binary fixture with independently specified endian values", () => {
    const bytes = buildCursorSample(); const cursor = new BinaryCursor(bytes, 100);
    expect(cursor.u16be()).toBe(0x0102); expect(cursor.u32be()).toBe(0x03040506);
    const child = cursor.subview(4); expect(child.u32be()).toBe(0x0708090a); expect(child.sourceOffset).toBe(110);
  });
  it("publishes the same synthetic M4/M5 menu interaction with unverified media cases called out", () => {
    expect(menuInteractionFixture.id).toBe("m4-m5-menu-interaction-v1");
    expect(menuInteractionFixture.steps).toEqual([
      { input: "right", selectedButtonId: 2 },
      { input: "activate", actionType: "LINK_PLAY_ITEM", actionPayload: { playItem: 3 } },
    ]);
  });
});
