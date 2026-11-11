import { expect, it } from "vitest";
import type { ExternalPlayTarget } from "@bdmv2web/media-export/external-targets";
import { launchExternalPlayer } from "../../src/shared/external-player.js";

const target: Extract<ExternalPlayTarget, { status: "available" }> = {
  status: "available", playlistId: "00001", clipTime90k: "0", seekTime90k: "0", remainingItems: [],
  item: {
    index: 0, stcId: 0, clipId: "00001", streamPath: "STREAM/00001.m2ts", present: true,
    sourceOrigin90k: "0", sourceIn90k: "0", sourceOut90k: "90000", playlistStart90k: "0", playlistEnd90k: "90000",
    source: { path: "PLAYLIST/00001.mpls", origin: "primary", offset: "20" },
  },
};

it("records a dispatched process as requested with unobserved playback", async () => {
  const result = await launchExternalPlayer({ status: "available", command: process.execPath, args: ["-e", "process.exit(0)"], adapter: "mpv", target });
  expect(result).toMatchObject({ status: "requested", playbackState: "unobserved", target });
});

it("reports an executable launch failure with the target source", async () => {
  const result = await launchExternalPlayer({ status: "available", command: "/bdmv2web-test/missing-player", args: [], adapter: "mpv", target });
  expect(result).toMatchObject({ status: "error", code: "EXTERNAL_PLAYER_LAUNCH_FAILED", source: target.item.source });
});
