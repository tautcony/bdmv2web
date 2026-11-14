import { describe, expect, it } from "vitest";
import { buildNavigationGraph } from "@bdmv2web/hdmv";
import { m3Fixtures } from "@bdmv2web/test-fixtures";
import { createViewerPayload, type ViewerPayload, type ViewerProgramSource } from "@bdmv2web/media-export/diagram/viewer-data";
import { renderGraphViewerHtml } from "./graph-viewer-html.js";

const source = m3Fixtures.break.source;

function payloadFixture(overrides?: { label?: string }): ViewerPayload {
  const sources: ViewerProgramSource[] = [
    { program: { id: 0, instructions: [m3Fixtures.move5, m3Fixtures.playPlaylist1, { ...m3Fixtures.jumpTitle1, source }] } as never, kind: "movie-object", label: overrides?.label ?? "MOBJ 0" },
    { program: { id: 1000001, instructions: [m3Fixtures.move1, { ...m3Fixtures.callTitleGpr0, source }] } as never, kind: "button-program", label: "Button 1000001", streamClipId: "00025" },
  ];
  const graph = buildNavigationGraph(
    [sources[0]!.program as never, sources[1]!.program as never],
    [],
    { entries: [{ id: "title:1", kind: "title", source, target: { objectType: "HDMV", playbackType: 0, target: 0, source } }] },
  );
  return createViewerPayload({
    disc: {
      root: "/disc",
      entries: [{ id: "first", kind: "firstPlay", target: { objectType: "HDMV", playbackType: 1, target: 0, source } }],
      movieObjects: sources[0]!.program,
      playlists: [{ id: "00001", playItems: [{ index: 0, clipId: "00001", inTime45k: 0, outTime45k: 45_000, stcId: 0, source }], source }],
    } as never,
    graph, sources, generatedFrom: "/disc",
  });
}

function dataIsland(html: string): string {
  const start = html.indexOf('id="payload">') + 'id="payload">'.length;
  const end = html.indexOf("</script>", start);
  return html.slice(start, end);
}

describe("renderGraphViewerHtml", () => {
  const html = renderGraphViewerHtml(payloadFixture());

  it("embeds the payload and wires the viewer shell", () => {
    expect(html).toContain('<script type="application/json" id="payload">');
    expect(html).toContain("MOBJ 0");
    expect(html).toContain("Button 1000001");
    expect(html).toContain('id="viewport"');
    expect(html).toContain('id="list-buttons"');
    expect(html).toContain('id="btn-back"');
    expect(html).toContain("showUnknownTable");
    expect(html).toContain("unknown-table");
    expect(html).toContain("startForceSimulation");
    expect(html).toContain('id="btn-layout-force"');
    expect(html).toContain("dragNodeState");
    expect(html).not.toContain("globalModel");
    expect(JSON.parse(dataIsland(html))).toMatchObject({ schemaVersion: "1.0", counts: { commands: 5 } });
  });

  it("escapes markup inside the payload so it cannot close the data island", () => {
    const hostile = payloadFixture({ label: "MOBJ </script><script>alert(1)</script>" });
    const rendered = renderGraphViewerHtml(hostile);
    const island = dataIsland(rendered);
    expect(island).not.toContain("</script>");
    expect(island).toContain("\\u003c/script>");
    const parsed = JSON.parse(island) as { programs: Array<{ label: string }> };
    expect(parsed.programs[0]!.label).toBe("MOBJ </script><script>alert(1)</script>");
  });

  it("references no external resources so it works from file://", () => {
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    // The SVG namespace identifier and the d3 copyright banners are the only
    // URL-shaped strings; neither is fetched.
    expect(html
      .replaceAll("http://www.w3.org/2000/svg", "")
      .replace(/https:\/\/d3js\.org\/[^"']*/g, ""))
      .not.toMatch(/https?:\/\//);
  });
});
