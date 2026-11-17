import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectInspection, collectStructuralInspection } from "../../src/commands/inspect-collection.js";
import { buildInspectionBrowserModel } from "../../src/commands/inspect-browser-model.js";
import { imagePreview, supImagePreview, ImagePreviewOverlay, imageProtocol } from "../../src/commands/inspect-image-preview.js";
import { collectDeclaredSupForClip, extractSupStreamsFromM2ts, resolveClipM2tsPath } from "../../src/commands/inspect-sup.js";

const fixture = resolve(import.meta.dirname, "../../../../test-data/fixtures/synthetic-all-features/BDMV");

describe("inspection image preview", () => {
  it("renders an extracted element with its palette and clears the terminal image", async () => {
    const data = await collectInspection(fixture, { renderPng: false }, "all");
    const model = buildInspectionBrowserModel(data);
    const sceneRow = model.M2TS.flatMap((row) => row.children ?? []).find((row) => row.children?.some((child) => child.imagePreview && child.imagePreview.kind !== "sup"));
    const image = sceneRow?.children?.find((row) => row.imagePreview && row.imagePreview.kind !== "sup")?.imagePreview;
    expect(image).toBeDefined();
    if (image && image.kind !== "sup") {
      const igsImage = image as { scene: import("@bdmv2web/igs").IgsScene; object: import("@bdmv2web/igs").IgsObject };
      const preview = imagePreview(igsImage.scene, igsImage.object);
      expect(preview.palettes.length).toBeGreaterThan(0);
      const output: string[] = [];
      const overlay = new ImagePreviewOverlay({ write: (value) => output.push(value) }, "kitty");
      overlay.show(preview, preview.palettes[0]!, { x: 3, y: 4, columns: 76, rows: 18 });
      overlay.flush();
      const sequence = output.join("");
      const payload = [...sequence.matchAll(/\x1b_G([^;]*);([^\x1b]*)\x1b\\/g)].filter((match) => match[1]!.includes("m=")).map((match) => match[2]).join("");
      const png = Buffer.from(payload, "base64");
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16)).toBe(igsImage.object.width);
      expect(png.readUInt32BE(20)).toBe(igsImage.object.height);
      expect(sequence).toContain("a=p,i=");
      overlay.show(preview, preview.palettes[0]!, { x: 3, y: 4, columns: 76, rows: 18 });
      overlay.flush();
      expect(output).toHaveLength(1);
      overlay.show(preview, preview.palettes[0]!, { x: 5, y: 6, columns: 76, rows: 18 });
      overlay.flush();
      expect(output[1]).toContain("a=p,i=");
      expect(output[1]).not.toContain("a=t,");
      overlay.clear();
      expect(output[2]).toContain("a=d,d=I");

      const itermOutput: string[] = [];
      const iterm = new ImagePreviewOverlay({ write: (value) => itermOutput.push(value) }, "iterm2");
      iterm.show(preview, preview.palettes[0]!, { x: 3, y: 4, columns: 76, rows: 18 });
      iterm.flush();
      const itermPayload = itermOutput[0]!.match(/\x1b\]1337;File=inline=1;width=\d+;height=\d+;preserveAspectRatio=1:([^\x07]+)\x07/);
      expect(itermPayload).not.toBeNull();
      expect(Buffer.from(itermPayload![1]!, "base64")).toEqual(png);
      iterm.clear();
      expect(itermOutput[1]).toMatch(/\x1b\[4;3H\x1b\[\d+X/);
    }
  });

  it("exposes SUP display sets under M2TS and renders a valid PNG preview via supImagePreview and ImagePreviewOverlay.showSup", async () => {
    const data = await collectInspection(fixture, { renderPng: false }, "all");
    const model = buildInspectionBrowserModel(data);
    const m2tsRow = model.M2TS.find((row) => row.label.includes("00001"));
    expect(m2tsRow).toBeDefined();
    const supRow = m2tsRow?.children?.find((row) => row.label.includes("SUP PID") || row.label.includes("Reachable SUP"));
    expect(supRow).toBeDefined();
    expect(supRow?.children?.length).toBeGreaterThan(0);
    const displaySetRow = supRow?.children?.[0];
    expect(displaySetRow?.imagePreview?.kind).toBe("sup");
    if (displaySetRow?.imagePreview?.kind === "sup") {
      const supImage = supImagePreview(displaySetRow.imagePreview.summary);
      expect(supImage).toBeDefined();
      const output: string[] = [];
      const overlay = new ImagePreviewOverlay({ write: (value) => output.push(value) }, "kitty");
      overlay.showSup(supImage!, { x: 3, y: 4, columns: 76, rows: 18 });
      overlay.flush();
      const sequence = output.join("");
      expect(sequence).toContain("a=p,i=");
    }
  });

  it("stops extractSupStreamsFromM2ts immediately when AbortSignal is aborted", async () => {
    const data = await collectInspection(fixture, { renderPng: false }, "all");
    const clipId = "00001";
    const m2tsPath = resolveClipM2tsPath(data.disc, clipId);
    if (m2tsPath) {
      const supDecls = collectDeclaredSupForClip(data.disc, data.reachableSup, clipId, data.assetSelection, data.assetType);
      if (supDecls.length > 0) {
        const controller = new AbortController();
        controller.abort();
        const result = await extractSupStreamsFromM2ts(clipId, m2tsPath, supDecls, controller.signal);
        expect(result).toBeDefined();
        expect(result.streams).toBeInstanceOf(Map);
      }
    }
  });

  it("supports progressive structural inspection and background updates", async () => {
    const structural = await collectStructuralInspection(fixture, { renderPng: false }, "all");
    expect(structural.graphicsStageStatus).toBe("loading");
    expect(structural.loadingClips?.size).toBeGreaterThan(0);
  });

  it("selects compatible terminals and avoids multiplexers", () => {
    expect(imageProtocol({ TERM_PROGRAM: "iTerm.app" }, true)).toBe(process.platform !== "win32" ? "iterm2" : "none");
    for (const program of ["kitty", "ghostty", "WezTerm", "WarpTerminal", "otty"]) {
      expect(imageProtocol({ TERM_PROGRAM: program }, true)).toBe(process.platform !== "win32" ? "kitty" : "none");
    }
    expect(imageProtocol({ KITTY_WINDOW_ID: "1" }, true)).toBe(process.platform !== "win32" ? "kitty" : "none");
    expect(imageProtocol({ TERM: "xterm-kitty", TMUX: "yes" }, true)).toBe("none");
    expect(imageProtocol({ TERM: "xterm-256color" }, true)).toBe("none");
    expect(imageProtocol({ TERM: "xterm-kitty" }, false)).toBe("none");
  });
});
