import { describe, expect, it } from "vitest";
import type { ExternalPlayTarget } from "@bdmv2web/media-export/external-targets";
import { createExternalPlayerUrl, fileUrlFromBdmvPath, format90kSeconds, requestExternalPlayback } from "./bdmv-url.js";

const streamPath = "STREAM/00002.m2ts";
const source = { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary" as const, offset: "12" };
const target: ExternalPlayTarget = {
  status: "available", playlistId: "00001",
  item: { index: 1, stcId: 2, clipId: "00002", streamPath, present: true, sourceOrigin90k: "45000", sourceIn90k: "225000", sourceOut90k: "450000", playlistStart90k: "0", playlistEnd90k: "225000", source },
  clipTime90k: "270000", seekTime90k: "225000", remainingItems: [],
};

describe("configured BDMV stream URLs", () => {
  it("keeps a sibling BDMV target when the package and disc move together", () => {
    expect(fileUrlFromBdmvPath("../BDMV", streamPath, "file:///disc/BDMV-menu/index.html"))
      .toBe("file:///disc/BDMV/STREAM/00002.m2ts");
    expect(fileUrlFromBdmvPath("../BDMV", streamPath, "file:///archive/Disc%20Name/BDMV-menu/index.html"))
      .toBe("file:///archive/Disc%20Name/BDMV/STREAM/00002.m2ts");
  });

  it("resolves a separately moved package from its current page URL", () => {
    expect(fileUrlFromBdmvPath("../BDMV", streamPath, "file:///portable/menu/index.html"))
      .toBe("file:///portable/BDMV/STREAM/00002.m2ts");
  });

  it("uses edited relative and absolute BDMV paths after the package reloads", () => {
    const reloadedPageUrl = "file:///portable/menu/index.html";
    expect(fileUrlFromBdmvPath("../../source/BDMV", streamPath, reloadedPageUrl))
      .toBe("file:///source/BDMV/STREAM/00002.m2ts");
    expect(fileUrlFromBdmvPath("/Volumes/Disc Name/BDMV", streamPath, reloadedPageUrl))
      .toBe("file:///Volumes/Disc%20Name/BDMV/STREAM/00002.m2ts");
  });

  it("builds exact IINA and PotPlayer protocol targets with encoded paths and STC-relative time", () => {
    const bdmvPath = "/Disc 演示/#50%/BDMV";
    const pageUrl = "file:///menu/index.html";
    const videoUrl = "file:///Disc%20%E6%BC%94%E7%A4%BA/%2350%25/BDMV/STREAM/00002.m2ts";
    expect(format90kSeconds("225000")).toBe("2.5");
    expect(createExternalPlayerUrl({ platform: "Macintosh; Intel Mac OS X", pageUrl, bdmvPath, streamPath, seekTime90k: "225000" }))
      .toBe("iina://open?url=file%3A%2F%2F%2FDisc%2520%25E6%25BC%2594%25E7%25A4%25BA%2F%252350%2525%2FBDMV%2FSTREAM%2F00002.m2ts&mpv_start=2.5");
    expect(createExternalPlayerUrl({ platform: "Windows NT 10.0", pageUrl, bdmvPath, streamPath, seekTime90k: "225000" }))
      .toBe(`potplayer://${videoUrl}`);
  });

  it("classifies simulated browser protocol navigation as requested, unavailable, or unknown", () => {
    const navigations: string[] = [];
    const navigate = (url: string) => { navigations.push(url); };
    const common = { bdmvPath: "/Disc 演示/BDMV", platform: "Windows NT 10.0", pageUrl: "file:///menu/index.html", navigate };
    const requested = requestExternalPlayback({ ...common, target });
    expect(requested).toMatchObject({ status: "requested", url: `potplayer://file:///Disc%20%E6%BC%94%E7%A4%BA/BDMV/${streamPath}` });
    if (requested.status === "requested") expect(navigations).toEqual([requested.url]);

    const missing: ExternalPlayTarget = { status: "unavailable", code: "EXTERNAL_STREAM_MISSING", message: "Source STREAM/00002.m2ts is missing." };
    expect(requestExternalPlayback({ ...common, target: missing })).toMatchObject({ status: "unavailable", code: "EXTERNAL_STREAM_MISSING" });
    const unresolved: ExternalPlayTarget = { status: "unavailable", code: "EXTERNAL_PLAYLIST_UNKNOWN", message: "Playlist 00009 is not mapped." };
    expect(requestExternalPlayback({ ...common, target: unresolved })).toMatchObject({ status: "unknown", code: "EXTERNAL_PLAYLIST_UNKNOWN" });
    expect(navigations).toHaveLength(1);
  });

  it("reports unavailable when the browser cannot construct a supported protocol target", () => {
    expect(requestExternalPlayback({ target, bdmvPath: "/disc/BDMV", platform: "Linux", pageUrl: "file:///menu/index.html", navigate: () => {} }))
      .toMatchObject({ status: "unavailable", code: "EXTERNAL_PROTOCOL_UNAVAILABLE" });
    expect(requestExternalPlayback({ target, bdmvPath: undefined, platform: "Windows", pageUrl: "file:///menu/index.html", navigate: () => {} }))
      .toMatchObject({ status: "unavailable", code: "EXTERNAL_BDMV_CONFIG_MISSING" });
    expect(requestExternalPlayback({ target, bdmvPath: "/disc/BDMV", platform: "Windows", pageUrl: "file:///menu/index.html", navigate: () => { throw new Error("navigation rejected"); } }))
      .toMatchObject({ status: "unavailable", code: "EXTERNAL_PROTOCOL_UNAVAILABLE", message: "navigation rejected" });
  });
});
