import { parentPort, workerData } from "node:worker_threads";
import { collectInspection } from "./inspect-collection.js";
import type { AssetSelection, AssetType } from "../cli/assets.js";
import { ContractError } from "@bdmv2web/core/contract-error";
import { errorText } from "@bdmv2web/utils";
import { extractIgsScenes } from "@bdmv2web/igs";
import { reachablePgsReferences } from "../shared/pgs.js";
import { selectedClip, selectedPid, uniquePgsReferences } from "../cli/assets.js";
import { collectDeclaredSupForClip, extractSupStreamsFromM2ts, resolveClipM2tsPath } from "./inspect-sup.js";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";

interface WorkerRequest {
  input: string;
  assetSelection: AssetSelection;
  assetType: AssetType;
  progressive?: boolean;
  disc?: ParsedDisc;
  fileSizes?: Record<string, number | null>;
}

const port = parentPort;
if (!port) throw new Error("Inspection collection worker requires a parent port");
const request = workerData as WorkerRequest;
const transfer = new Set<ArrayBuffer>();
const seen = new Set<object>();

function collectTransferables(value: unknown): void {
  if (value instanceof Uint8Array) {
    if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength && value.buffer instanceof ArrayBuffer) transfer.add(value.buffer);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Map) for (const [key, item] of value) { collectTransferables(key); collectTransferables(item); }
  else if (value instanceof Set) for (const item of value) collectTransferables(item);
  else if (Array.isArray(value)) for (const item of value) collectTransferables(item);
  else for (const item of Object.values(value)) collectTransferables(item);
}

try {
  if (request.progressive) {
    const disc = request.disc!;
    const fileSizes = request.fileSizes ?? {};
    const activeControllers = new Map<string, AbortController>();

    port.on("message", (msg: unknown) => {
      void (async () => {
        if (!msg || typeof msg !== "object") return;
        const m = msg as { type?: string; clipId?: string; m2tsPath?: string; requests?: Array<{ pid: number; sourceIn90k: string }> };
        if (m.type === "load-sup" && m.clipId && m.m2tsPath && m.requests) {
          const clipId = m.clipId;
          const controller = new AbortController();
          activeControllers.set(clipId.toUpperCase(), controller);
          try {
            const extracted = await extractSupStreamsFromM2ts(clipId, m.m2tsPath, m.requests, controller.signal);
            if (!controller.signal.aborted) {
              const streamsObj = Object.fromEntries(extracted.streams);
              const payloadBytesObj = Object.fromEntries(extracted.payloadBytes);
              collectTransferables({ streams: extracted.streams, payloadBytes: extracted.payloadBytes });
              port.postMessage({ type: "sup-clip", clipId, streams: streamsObj, payloadBytes: payloadBytesObj }, [...transfer]);
              transfer.clear();
            }
          } catch {
            // ignore load error
          }
          activeControllers.delete(clipId.toUpperCase());
        } else if (m.type === "cancel-sup" && m.clipId) {
          const ctrl = activeControllers.get(m.clipId.toUpperCase());
          if (ctrl) {
            ctrl.abort();
            activeControllers.delete(m.clipId.toUpperCase());
          }
        }
      })();
    });

    // 1. IGS clips progressive worker
    if (request.assetType !== "sup") {
      const igsClips = [...new Set([
        ...disc.playlists.flatMap((pl) => pl.playItems.flatMap((item) => item.streams.filter((s) => s.codingType === 0x91).map(() => item.clipId))),
        ...disc.clips.filter((c) => c.programs.some((p) => p.streams.some((s) => s.codingType === 0x91))).map((c) => c.id),
      ])].sort((a, b) => (fileSizes[a] ?? Number.MAX_SAFE_INTEGER) - (fileSizes[b] ?? Number.MAX_SAFE_INTEGER));

      for (const clipId of igsClips) {
        if (!selectedClip(clipId, request.assetSelection)) continue;
        try {
          const extraction = await extractIgsScenes(disc, {
            renderAssets: false,
            measurePayloadBytes: true,
            clipFilter: (id) => id.toUpperCase() === clipId.toUpperCase(),
          });
          const scenes = extraction.scenes;
          const streams = extraction.streams;
          const diagnostics = extraction.diagnostics;
          const payloadBytes = extraction.payloadBytesByClip?.get(clipId);
          collectTransferables({ scenes, streams, diagnostics, payloadBytes });
          port.postMessage({ type: "igs-clip", clipId, scenes, streams, diagnostics, payloadBytes }, [...transfer]);
          transfer.clear();
        } catch {
          // ignore igs extraction error
        }
      }
    }

    // 2. Small SUP clips progressive worker (<= 64 MiB)
    if (request.assetType !== "igs") {
      const reachable = reachablePgsReferences(disc, []);
      const reachableSup = uniquePgsReferences(reachable).filter((item) => selectedClip(item.clipId, request.assetSelection) && selectedPid(item.pid, request.assetSelection));

      const allClipIds = new Set<string>([
        ...disc.playlists.flatMap((pl) => pl.playItems.map((item) => item.clipId)),
        ...disc.playlists.flatMap((pl) => pl.subPaths.flatMap((sp) => sp.items.map((item) => item.clipId))),
        ...reachableSup.map((item) => item.clipId),
      ]);

      const smallSupClips: string[] = [];
      for (const clipId of allClipIds) {
        if (!selectedClip(clipId, request.assetSelection)) continue;
        const fileBytes = fileSizes[clipId];
        if (fileBytes !== null && fileBytes !== undefined && fileBytes > 0 && fileBytes <= 64 * 1024 * 1024) {
          const decls = collectDeclaredSupForClip(disc, reachableSup, clipId, request.assetSelection, request.assetType);
          if (decls.length > 0) smallSupClips.push(clipId);
        }
      }
      smallSupClips.sort((a, b) => (fileSizes[a] ?? 0) - (fileSizes[b] ?? 0));

      for (const clipId of smallSupClips) {
        const supDecls = collectDeclaredSupForClip(disc, reachableSup, clipId, request.assetSelection, request.assetType);
        if (supDecls.length === 0) continue;
        const m2tsPath = resolveClipM2tsPath(disc, clipId);
        if (!m2tsPath) continue;

        try {
          const controller = new AbortController();
          activeControllers.set(clipId.toUpperCase(), controller);
          const extracted = await extractSupStreamsFromM2ts(clipId, m2tsPath, supDecls, controller.signal);
          activeControllers.delete(clipId.toUpperCase());
          if (!controller.signal.aborted && extracted.streams.size > 0) {
            const streamsObj = Object.fromEntries(extracted.streams);
            const payloadBytesObj = Object.fromEntries(extracted.payloadBytes);
            collectTransferables({ streams: extracted.streams, payloadBytes: extracted.payloadBytes });
            port.postMessage({ type: "sup-clip", clipId, streams: streamsObj, payloadBytes: payloadBytesObj }, [...transfer]);
            transfer.clear();
          }
        } catch {
          // ignore sup extraction error
        }
      }
    }

    port.postMessage({ type: "progressive-done" });
  } else {
    const data = await collectInspection(request.input, request.assetSelection, request.assetType, (phase) => port.postMessage({ type: "phase", phase }));
    collectTransferables(data);
    port.postMessage({ type: "complete", data }, [...transfer]);
  }
} catch (error) {
  if (error instanceof ContractError) {
    const prefix = error.code + " at " + error.path + ": ";
    port.postMessage({ type: "error", code: error.code, path: error.path, message: error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message });
  } else port.postMessage({ type: "error", code: "E_IO", path: null, message: errorText(error) });
}
