import { describe, expect, it } from "vitest";
import { parseProbe, probeArgs } from "./probe.js";

describe("ffprobe", () => {
  it("selects the source probe depth and linear audio fields", () => {
    const menu = probeArgs("menu.m2ts", { deep: true });
    expect(menu).toContain("-probesize");
    expect(menu[menu.indexOf("-show_entries") + 1]).toContain("display_aspect_ratio,duration");
    const linear = probeArgs("feature.m2ts", { audio: true });
    expect(linear[linear.indexOf("-show_entries") + 1]).toContain("sample_rate,channels");
    expect(linear.at(-1)).toBe("feature.m2ts");
  });

  it("reports invalid stream metadata with its caller's diagnostic label", () => {
    expect(() => parseProbe("{}", "input", "invalid ffprobe JSON for")).toThrow("invalid ffprobe JSON for 'input': no streams array");
    expect(parseProbe('{"streams":[]}', "input", "invalid ffprobe JSON for").streams).toEqual([]);
  });
});
