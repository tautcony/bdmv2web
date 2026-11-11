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

  it("passes the initial position and every bounded PlayItem to mpv", () => {
    const plan = buildExternalPlayerLaunch(target, { bdmvRoot: "/disc", platform: "linux", adapter: "mpv", executable: "/bin/custom mpv" });
    expect(plan).toMatchObject({ status: "available", command: "/bin/custom mpv", target });
    if (plan.status !== "available") throw new Error(plan.message);
    expect(plan.args).toEqual(["--no-terminal", "--", "edl://%23%/disc/STREAM/00001.m2ts,1.5,2.5;%23%/disc/STREAM/00002.m2ts,2,4"]);
  });

  it("uses UTF-8 byte lengths for EDL filenames and native Windows paths", () => {
    const plan = buildExternalPlayerLaunch({ ...target, remainingItems: [] }, { bdmvRoot: "C:\\碟片;菜单", platform: "win32", adapter: "mpv" });
    expect(plan.status).toBe("available");
    if (plan.status !== "available") throw new Error(plan.message);
    const filename = "C:/碟片;菜单/STREAM/00001.m2ts";
    expect(plan.args[2]).toBe(`edl://%${Buffer.byteLength(filename)}%${filename},1.5,2.5`);
  });

  it("reports the system opener capability for a bounded playlist", () => {
    expect(buildExternalPlayerLaunch(target, { bdmvRoot: "/disc", adapter: "system" })).toMatchObject({
      status: "unavailable", code: "EXTERNAL_PLAYER_CAPABILITY_UNAVAILABLE", source: item.source,
    });
  });

  it("reports a missing later clip with its source", () => {
    const later = { ...target.remainingItems[0]!, present: false, source: { ...item.source, offset: "72" } };
    expect(buildExternalPlayerLaunch({ ...target, remainingItems: [later] }, { bdmvRoot: "/disc", adapter: "mpv" }))
      .toMatchObject({ status: "unavailable", code: "EXTERNAL_STREAM_MISSING", source: later.source });
  });

});
