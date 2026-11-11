import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressReporter } from "./progress.js";

function ttyStream(): { stream: NodeJS.WriteStream; chunks: string[] } {
  const chunks: string[] = [];
  const stream = {
    isTTY: true,
    columns: 120,
    write(chunk: string): boolean { chunks.push(chunk); return true; },
  } as unknown as NodeJS.WriteStream;
  return { stream, chunks };
}

function markOf(chunks: readonly string[]): string | undefined {
  const line = chunks.at(-1) ?? "";
  return line.match(/[\u2800-\u28ff]/g)?.at(-1);
}

function plainText(chunks: readonly string[]): string {
  return chunks.join("").replace(/\x1b\[[0-9;]*m/g, "");
}

describe("progress reporter", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("advances the step mark while a measured step reports its own ratio", () => {
    vi.useFakeTimers();
    const { stream, chunks } = ttyStream();
    const reporter = new ProgressReporter({ command: "convert", steps: ["Export menu media"], stream, mode: "tty" });
    reporter.start("Export menu media");
    reporter.progress(0.4, "clip 1/2 · 00377 · background 1.0/4.0s");
    const first = markOf(chunks);
    vi.advanceTimersByTime(300);
    expect(markOf(chunks)).not.toBe(first);
    reporter.close();
  });

  it("prints a permanent line per finished step beside the running line", () => {
    const { stream, chunks } = ttyStream();
    const reporter = new ProgressReporter({ command: "convert", steps: ["Parse", "Export"], stream, mode: "tty" });
    reporter.start("Parse");
    reporter.done("Parse", "1 entry");
    reporter.start("Export");
    reporter.progress(0.5, "clip 1/2 · 00377 · background 1.0/4.0s");
    reporter.close();
    const output = plainText(chunks);
    expect(output).toContain("✓ 1/2  Parse");
    expect(output).toContain("50%");
    expect(output).toContain("clip 1/2 · 00377 · background 1.0/4.0s");
  });
});
