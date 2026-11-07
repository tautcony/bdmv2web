/**
 * Progress rendering for long-running CLI commands.
 *
 * A command declares its steps up front, then reports step transitions and, for
 * steps that can measure their own work, a 0..1 ratio. An interactive terminal
 * gets one live line for the running step and a permanent line per finished
 * step; piped stderr stays silent unless plain lines were requested.
 */
export type ProgressMode = "tty" | "plain" | "none";

export interface ProgressReporterOptions {
  command: string;
  steps: readonly string[];
  /** The resolved input path, shown once under the command line. */
  source?: string;
  /** Header lines printed with the command line, before the first step. */
  details?: ReadonlyArray<readonly [string, string]>;
  stream?: NodeJS.WriteStream;
  /** Explicit mode; `undefined` follows the stream's TTY state. */
  mode?: ProgressMode;
}

type StepState = "pending" | "running" | "done" | "failed" | "skipped";
type Style = "bold" | "dim" | "red" | "green" | "yellow" | "cyan" | "plain";

const MARKS: Record<Exclude<StepState, "running">, string> = { pending: "·", done: "✓", failed: "✗", skipped: "·" };
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ANSI: Record<Exclude<Style, "plain">, string> = {
  bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const RESET = "\x1b[0m";
const CLEAR_LINE = "\r\x1b[2K";
const BAR_WIDTH = 14;
/** Header labels (`input`, `output`, `title`, `profile`) share one value column. */
const HEADER_LABEL_WIDTH = 7;

interface Segment { text: string; style: Style }

interface StepRecord {
  readonly title: string;
  state: StepState;
  startedAt: number;
  elapsedMs: number;
  detail: string;
  ratio: number | undefined;
  /** Last reported tenth, so plain output prints one line per 10%. */
  bucket: number;
}

/** The reporter currently owning the terminal, so the error path can close it. */
let active: ProgressReporter | undefined;

/** Mark the running step as failed and release the live line before an error is printed. */
export function failActiveProgress(message: string): void {
  active?.failActive(message);
}

export class ProgressReporter {
  private readonly stream: NodeJS.WriteStream;
  private readonly mode: ProgressMode;
  private readonly colorEnabled: boolean;
  private readonly steps: StepRecord[];
  private readonly titleWidth: number;
  private readonly counterWidth: number;
  private readonly startedAt = Date.now();
  private current: number | undefined;
  private liveLine = false;
  private frame = 0;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(options: ProgressReporterOptions) {
    this.stream = options.stream ?? process.stderr;
    this.mode = options.mode ?? (this.stream.isTTY ? "tty" : "none");
    this.colorEnabled = this.mode === "tty" && this.stream.isTTY === true && !process.env["NO_COLOR"];
    this.steps = options.steps.map((title) => ({ title, state: "pending", startedAt: 0, elapsedMs: 0, detail: "", ratio: undefined, bucket: -1 }));
    this.titleWidth = Math.max(12, ...this.steps.map((step) => step.title.length));
    this.counterWidth = `${this.steps.length}`.length * 2 + 1;
    active = this;
    if (this.mode === "none") return;
    this.stream.write(`${this.paintText(`bdmv2web ${options.command}`, "bold")}${this.paintText(` · ${this.steps.length} steps`, "dim")}\n`);
    if (options.source !== undefined) this.stream.write(`  ${this.paintText("input".padEnd(HEADER_LABEL_WIDTH), "dim")}  ${options.source}\n`);
    for (const [label, value] of options.details ?? []) this.stream.write(`  ${this.paintText(label.padEnd(HEADER_LABEL_WIDTH), "dim")}  ${value}\n`);
    this.stream.write("\n");
  }

  /** Begin a step; its live line replaces any running step's line. */
  start(key: string, detail = ""): void {
    const index = this.index(key);
    const step = this.steps[index]!;
    this.current = index;
    step.state = "running";
    step.startedAt = Date.now();
    step.elapsedMs = 0;
    step.detail = detail;
    step.ratio = undefined;
    step.bucket = -1;
    if (this.mode !== "tty") return;
    this.paint();
    this.startTimer();
  }

  /** Replace the running step's trailing detail without changing its ratio. */
  note(detail: string): void {
    if (this.current === undefined) return;
    const step = this.steps[this.current]!;
    if (step.detail === detail) return;
    step.detail = detail;
    if (this.mode === "tty") this.paint();
  }

  /** Report measured progress for the running step. */
  progress(ratio: number, detail?: string): void {
    if (this.current === undefined) return;
    const step = this.steps[this.current]!;
    step.ratio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
    if (detail !== undefined) step.detail = detail;
    if (this.mode === "tty") { this.paint(); return; }
    if (this.mode !== "plain") return;
    const bucket = Math.floor(step.ratio * 10);
    if (bucket <= step.bucket) return;
    step.bucket = bucket;
    this.stream.write(`${this.detailIndent()}${String(Math.round(step.ratio * 100)).padStart(3)}%  ${step.detail}\n`);
  }

  done(key: string, detail?: string): void { this.settle(this.index(key), "done", detail); }
  skip(key: string, detail?: string): void { this.settle(this.index(key), "skipped", detail); }
  /** Fail a named step; the caller still decides the process exit code. */
  fail(key: string, detail?: string): void { this.settle(this.index(key), "failed", detail); }

  /** Fail whichever step is running, close with the failure headline. */
  failActive(detail: string): void {
    if (this.closed) return;
    if (this.current !== undefined) this.settle(this.current, "failed", detail);
    if (this.mode !== "none") this.finish("failed", [], detail);
    this.close();
  }

  /** Print one `label  value` line that belongs to the header block. */
  info(label: string, value: string): void {
    if (this.mode === "none") return;
    this.clearLive();
    this.stream.write(`  ${this.paintText(label.padEnd(6), "dim")}  ${value}\n`);
    if (this.mode === "tty" && this.current !== undefined) this.paint();
  }

  /** Close with a duration headline and an aligned detail block. */
  finish(status: "complete" | "partial" | "failed", details: ReadonlyArray<readonly [string, string]>, note?: string): void {
    if (this.mode === "none") { this.close(); return; }
    this.clearLive();
    const elapsed = formatDuration(Date.now() - this.startedAt);
    const headline = status === "failed" ? `Failed in ${elapsed}` : status === "partial" ? `Done in ${elapsed} · partial` : `Done in ${elapsed}`;
    this.stream.write(`\n${this.paintText(headline, status === "failed" ? "red" : status === "partial" ? "yellow" : "green")}${note === undefined ? "" : this.paintText(` · ${note}`, "dim")}\n`);
    const labelWidth = Math.max(0, ...details.map(([label]) => label.length));
    for (const [label, value] of details) this.stream.write(`  ${this.paintText(label.padEnd(labelWidth), "dim")}  ${value}\n`);
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopTimer();
    this.clearLive();
    if (active === this) active = undefined;
  }

  private settle(index: number, state: Extract<StepState, "done" | "failed" | "skipped">, detail?: string): void {
    const step = this.steps[index]!;
    step.state = state;
    step.elapsedMs = state === "skipped" ? 0 : Date.now() - step.startedAt;
    if (detail !== undefined) step.detail = detail;
    step.ratio = undefined;
    if (this.current === index) this.current = undefined;
    if (this.mode === "none") return;
    this.stopTimer();
    this.clearLive();
    this.stream.write(`${this.join(this.permanentLine(index), this.width())}\n`);
    if (this.mode === "tty" && this.current !== undefined) { this.paint(); this.startTimer(); }
  }

  private index(key: string): number {
    const index = this.steps.findIndex((step) => step.title === key);
    if (index < 0) throw new RangeError(`Unknown progress step '${key}'`);
    return index;
  }

  private permanentLine(index: number): Segment[] {
    const step = this.steps[index]!;
    const segments = this.heading(index);
    if (step.state === "skipped") {
      segments.push({ text: step.detail === "" ? "  skipped" : `  ${step.detail}`, style: "dim" });
      return segments;
    }
    segments.push({ text: `  ${formatDuration(step.elapsedMs).padStart(7)}`, style: "dim" });
    if (step.detail !== "") segments.push({ text: `  ${step.detail}`, style: step.state === "failed" ? "red" : "plain" });
    return segments;
  }

  private runningLine(index: number): Segment[] {
    const step = this.steps[index]!;
    const segments = this.heading(index);
    if (step.ratio !== undefined) {
      segments.push(
        { text: "  ", style: "plain" },
        { text: barText(step.ratio), style: "cyan" },
        { text: ` ${String(Math.round(step.ratio * 100)).padStart(3)}%`, style: "cyan" },
      );
    } else {
      segments.push({ text: `  ${formatDuration(Date.now() - step.startedAt).padStart(7)}`, style: "dim" });
    }
    if (step.detail !== "") segments.push({ text: `  ${step.detail}`, style: "plain" });
    return segments;
  }

  private heading(index: number): Segment[] {
    const step = this.steps[index]!;
    const style: Style = step.state === "failed" ? "red" : step.state === "done" ? "green" : step.state === "running" ? "cyan" : "dim";
    const mark = step.state === "running" ? SPINNER[this.frame % SPINNER.length]! : MARKS[step.state];
    const counter = `${index + 1}/${this.steps.length}`.padStart(this.counterWidth);
    return [
      { text: "  ", style: "plain" },
      { text: mark, style },
      { text: " ", style: "plain" },
      { text: counter, style: "dim" },
      { text: "  ", style: "plain" },
      { text: step.title.padEnd(this.titleWidth), style: step.state === "pending" ? "dim" : "plain" },
    ];
  }

  private paint(): void {
    if (this.mode !== "tty" || this.closed || this.current === undefined) return;
    this.stream.write(`${CLEAR_LINE}${this.join(this.runningLine(this.current), this.width())}`);
    this.liveLine = true;
  }

  private clearLive(): void {
    if (!this.liveLine) return;
    this.stream.write(CLEAR_LINE);
    this.liveLine = false;
  }

  private startTimer(): void {
    if (this.mode !== "tty" || this.timer !== undefined || this.current === undefined) return;
    // Only a step without a measurable ratio needs to animate; a measured step
    // repaints on its own progress reports.
    this.timer = setInterval(() => {
      if (this.current === undefined) return;
      if (this.steps[this.current]!.ratio !== undefined) return;
      this.frame += 1;
      this.paint();
    }, 100);
    this.timer.unref();
  }

  private stopTimer(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private width(): number {
    const columns = this.stream.isTTY ? this.stream.columns : undefined;
    return Math.max(40, (columns ?? 100) - 1);
  }

  private detailIndent(): string { return " ".repeat(this.counterWidth + 6); }

  private join(segments: Segment[], maxWidth: number): string {
    let out = "";
    let visible = 0;
    for (const segment of segments) {
      if (visible >= maxWidth) break;
      let text = segment.text;
      if (visible + text.length > maxWidth) {
        text = `${text.slice(0, Math.max(0, maxWidth - visible - 1))}…`;
      }
      visible += text.length;
      out += this.paintText(text, segment.style);
    }
    return out;
  }

  private paintText(text: string, style: Style): string {
    return style === "plain" || !this.colorEnabled ? text : `${ANSI[style]}${text}${RESET}`;
  }
}

function barText(ratio: number): string {
  const filled = Math.round(ratio * BAR_WIDTH);
  return `[${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}]`;
}

export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds));
  if (total < 1000) return `${total}ms`;
  const seconds = total / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(Math.round(seconds - minutes * 60)).padStart(2, "0")}s`;
}
