import { describe, expect, it } from "vitest";
import { primaryAudioStreamNumberForLanguage } from "./linear.js";
import type { PlannedTrack } from "./media-plan.js";

const source = { path: "BDMV/PLAYLIST/00004.mpls", origin: "primary" as const, offset: "0" };
const audio = (pid: number, language: string): PlannedTrack => ({ role: "audio", streamType: 1, codingType: 0x81, pid, subPathId: null, subClipId: null, language, source });

describe("linear audio variant stream mapping", () => {
  it("keeps PSR1 stream numbering in declared STN order even when output variants sort by language", () => {
    const declaredTracks = [audio(0x1100, "eng"), audio(0x1101, "jpn")];
    expect(primaryAudioStreamNumberForLanguage(declaredTracks, "eng")).toBe(1);
    expect(primaryAudioStreamNumberForLanguage(declaredTracks, "jpn")).toBe(2);
  });

  it("resolves a language lane by the declared STN order", () => {
    const declaredTracks = [audio(0x1101, "jpn"), audio(0x1100, "eng")];
    expect(primaryAudioStreamNumberForLanguage(declaredTracks, "jpn")).toBe(1);
    expect(primaryAudioStreamNumberForLanguage(declaredTracks, "eng")).toBe(2);
  });

  it("refuses ambiguous same-language flows", () => {
    const declaredTracks = [audio(0x1100, "eng"), audio(0x1102, "eng")];
    expect(primaryAudioStreamNumberForLanguage(declaredTracks, "eng")).toBeNull();
  });
});
