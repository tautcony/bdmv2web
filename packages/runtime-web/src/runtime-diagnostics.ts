import type { TraceEntry } from "@bdmv2web/hdmv";
import type { SerializedScene } from "./igs-adapter.js";

/** Console trace for the HDMV VM: one line per decoded batch. `context` returns
 * the menu scene and the button that triggered the batch, so a line reads on its
 * own without the session that produced it. */
export function vmConsoleLogger(context?: () => string | null): (entry: TraceEntry) => void {
  let pending: TraceEntry[] = [];
  let scheduled = false;
  return (entry) => {
    if (entry.decoded?.startsWith("RESET ")) return;
    pending.push(entry);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const batch = pending;
      pending = [];
      const commands = batch.filter((item) => item.decoded && !item.decoded.startsWith("MENU_CONTEXT")).map((item) => `${item.programId}:${item.pc} ${item.decoded}`);
      const actions = summarizeLabels(batch.flatMap((item) => item.action ? [item.action.type] : []));
      const events = summarizeLabels(batch.flatMap((item) => {
        const type = item.event?.type ?? item.input?.type;
        return type ? [type] : [];
      }));
      const diagnostics = summarizeLabels(batch.flatMap((item) => item.diagnostic ? [item.diagnostic.code] : []));
      const faulted = batch.some((item) => item.status === "faulted");
      // TIME_UPDATED arrives continuously for the whole menu loop and changes
      // nothing; printing those batches buries the batches a click produces.
      const heartbeatOnly = !actions && !diagnostics && !faulted && !!events && events.split(",").every((label) => label.startsWith("TIME_UPDATED"));
      if (heartbeatOnly) return;
      if (!commands.length && !actions && !events && !diagnostics) return;
      const shownCommands = commands.length <= 6
        ? commands.join(" → ")
        : `${commands.slice(0, 2).join(" → ")} → … ${commands.length - 4} more → ${commands.slice(-2).join(" → ")}`;
      const where = context?.();
      const fields = where ? [where] : [];
      fields.push(`${commands.length} step${commands.length === 1 ? "" : "s"}`);
      if (shownCommands) fields.push(shownCommands);
      if (actions) fields.push(`actions=${actions}`);
      if (events) fields.push(`events=${events}`);
      if (diagnostics) fields.push(`diag=${diagnostics}`);
      const status = batch.at(-1)?.status;
      if (status) fields.push(`status=${status}`);
      console.info(`[VM] ${fields.join(" | ")}`);
    });
  };
}

/** Console trace for what the runtime did with a VM action: which packaged scene
 * and background a jump reached, or why it did not move. */
export function menuLog(message: string): void {
  console.info(`[menu] ${message}`);
}

/** Scene identity as it appears in the manifest, e.g. `clip 00014 pid 0x1400`. */
export function sceneLabel(scene: SerializedScene): string {
  const clip = scene.clipId ?? scene.id ?? "?";
  const pid = typeof scene.pid === "number" ? `0x${scene.pid.toString(16)}` : "?";
  return `clip ${clip} pid ${pid}`;
}

/** Asset directory of a packaged background, e.g. `playlist-00016-pi2`. */
export function backgroundLabel(path: string | undefined): string {
  if (!path) return "none";
  const parts = path.split("/");
  return parts.length >= 2 ? parts[parts.length - 2]! : path;
}

function summarizeLabels(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => count === 1 ? value : `${value} x${count}`).join(",");
}
