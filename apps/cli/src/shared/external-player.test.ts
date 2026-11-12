import { describe, expect, it } from "vitest";
import type { ExternalPlayItem, ExternalPlayTarget } from "@bdmv2web/media-export/external-targets";
import { buildExternalPlayerLaunch } from "./external-player.js";

const item: ExternalPlayItem = {
  index: 0, stcId: 0, clipId: "00001", streamPath: "STREAM/00001.m2ts", present: true,
  sourceOrigin90k: "900000", sourceIn90k: "990000", sourceOut90k: "1260000", playlistStart90k: "0", playlistEnd90k: "270000",
  source: { path: "PLAYLIST/00001.mpls", origin: "primary", offset: "20" },
};
const target: Extract<ExternalPlayTarget, { status: "available" }> = {
  status: "available", playlistId: "00001", item, clipTime90k: "1035000", seekTime90k: "135000",
  remainingItems: [{ ...item, index: 1, clipId: "00002", streamPath: "STREAM/00002.m2ts", sourceIn90k: "1080000", sourceOut90k: "1440000" }],
};

describe("native player launch", () => {
  it.each([
    ["darwin", "open", ["--", "/disc/STREAM/00001.m2ts"]],
    ["win32", "explorer.exe", ["C:\\disc\\STREAM\\00001.m2ts"]],
    ["linux", "xdg-open", ["/disc/STREAM/00001.m2ts"]],
  ] as const)("constructs the %s whole-file opener", (platform, command, args) => {
    const plan = buildExternalPlayerLaunch({ ...item, status: "whole-file" }, { bdmvRoot: platform === "win32" ? "C:\\disc" : "/disc", platform });
    expect(plan).toMatchObject({ status: "available", command, args });
  });

  it("reports the system opener capability for a bounded playlist", () => {
    expect(buildExternalPlayerLaunch(target, { bdmvRoot: "/disc", adapter: "system" })).toMatchObject({
      status: "unavailable", code: "EXTERNAL_PLAYER_CAPABILITY_UNAVAILABLE", source: item.source,
    });
  });

});
