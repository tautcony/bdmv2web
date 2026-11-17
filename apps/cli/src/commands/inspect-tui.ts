import React, { useEffect, useMemo, useRef, useState } from "react";
import { Worker } from "node:worker_threads";
import type { InspectionCollection } from "./inspect-collection.js";
import { buildInspectionBrowserModel } from "./inspect-browser-model.js";
import { ImagePreviewOverlay, imageProtocol } from "./inspect-image-preview.js";
import { InspectionBrowserView } from "./inspect-browser-view.js";
import type { IgsScene, IgsExtraction, IgsDiagnostic } from "@bdmv2web/igs";

type IgsStream = IgsExtraction["streams"][number];

function InspectionTuiContainer({ initialData, structureStatus, overlay, graphicsAvailable }: { initialData: InspectionCollection; structureStatus: "complete" | "partial" | "failed"; overlay: ImagePreviewOverlay; graphicsAvailable: boolean }): React.ReactElement {
  const [data, setData] = useState<InspectionCollection>(initialData);
  const workerRef = useRef<Worker | null>(null);
  const pendingSupOpenRef = useRef<string | null>(null);

  useEffect(() => {
    const developmentWorker = import.meta.url.endsWith(".ts");
    const workerUrl = developmentWorker
      ? new URL("./inspect-collection-worker-dev.ts", import.meta.url)
      : new URL("./inspect-collection-worker.js", import.meta.url);
    const worker = new Worker(workerUrl, {
      workerData: {
        input: initialData.disc.root,
        assetSelection: initialData.assetSelection,
        assetType: initialData.assetType,
        progressive: true,
        disc: initialData.disc,
        fileSizes: initialData.fileSizes,
      },
      ...(developmentWorker ? { execArgv: process.execArgv } : {}),
    });
    workerRef.current = worker;

    worker.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const msg = message as Record<string, unknown>;
      const msgType = typeof msg.type === "string" ? msg.type : undefined;
      const msgClipId = typeof msg.clipId === "string" ? msg.clipId : undefined;

      setData((prev) => {
        const nextLoadingClips = new Set(prev.loadingClips);
        if (msgClipId) nextLoadingClips.delete(msgClipId);

        let nextGraphics = prev.graphics;
        if (msgType === "igs-clip" && msgClipId) {
          const incomingScenes: IgsScene[] = [];
          if (Array.isArray(msg.scenes)) {
            for (const item of msg.scenes) {
              if (item && typeof item === "object") incomingScenes.push(item as IgsScene);
            }
          }
          const prevScenes = prev.graphics?.scenes ?? [];
          const scenes = [
            ...prevScenes.filter((s) => s.clipId.toUpperCase() !== msgClipId.toUpperCase()),
            ...incomingScenes,
          ];

          const incomingStreams: IgsStream[] = [];
          if (Array.isArray(msg.streams)) {
            for (const item of msg.streams) {
              if (item && typeof item === "object") incomingStreams.push(item as IgsStream);
            }
          }
          const prevStreams = prev.graphics?.streams ?? [];
          const streams = [
            ...prevStreams.filter((s) => s.clipId.toUpperCase() !== msgClipId.toUpperCase()),
            ...incomingStreams,
          ];

          const incomingDiag: IgsDiagnostic[] = [];
          if (Array.isArray(msg.diagnostics)) {
            for (const item of msg.diagnostics) {
              if (item && typeof item === "object") incomingDiag.push(item as IgsDiagnostic);
            }
          }
          const diagnostics = [...(prev.graphics?.diagnostics ?? []), ...incomingDiag];

          const payloadBytesByClip = new Map<string, ReadonlyMap<number, number>>(prev.graphics?.payloadBytesByClip ?? new Map());
          if (msg.payloadBytes) {
            const pbMap = new Map<number, number>();
            const pbRecord = msg.payloadBytes as Record<string, unknown>;
            if (msg.payloadBytes instanceof Map) {
              for (const [k, v] of msg.payloadBytes) {
                pbMap.set(Number(k), Number(v));
              }
            } else if (pbRecord && typeof pbRecord === "object") {
              for (const [k, v] of Object.entries(pbRecord)) {
                pbMap.set(Number(k), Number(v));
              }
            }
            payloadBytesByClip.set(msgClipId, pbMap);
          }
          nextGraphics = {
            ...(prev.graphics ?? { assets: [], status: "complete", support: { format: "Blu-ray IGS", status: "unverified" } }),
            scenes,
            streams,
            diagnostics,
            payloadBytesByClip,
          };
        }

        const nextSupStreams = new Map<string, Uint8Array>(prev.supStreams ?? new Map());
        if (msgType === "sup-clip" && msgClipId && msg.streams) {
          const rawStreamsObj = msg.streams as Record<string, unknown>;
          const streamEntries = msg.streams instanceof Map ? [...(msg.streams as Map<unknown, unknown>)] : Object.entries(rawStreamsObj);
          for (const [k, v] of streamEntries) {
            nextSupStreams.set(String(k), v as Uint8Array);
          }
          if (msg.payloadBytes && nextGraphics) {
            const pbMap = new Map<number, number>(nextGraphics.payloadBytesByClip?.get(msgClipId));
            const pbRecord = msg.payloadBytes as Record<string, unknown>;
            if (msg.payloadBytes instanceof Map) {
              for (const [k, v] of msg.payloadBytes) {
                if (!pbMap.has(Number(k))) pbMap.set(Number(k), Number(v));
              }
            } else if (pbRecord && typeof pbRecord === "object") {
              for (const [k, v] of Object.entries(pbRecord)) {
                if (!pbMap.has(Number(k))) pbMap.set(Number(k), Number(v));
              }
            }
            const nextPayloadByClip = new Map<string, ReadonlyMap<number, number>>(nextGraphics.payloadBytesByClip ?? new Map());
            nextPayloadByClip.set(msgClipId, pbMap);
            nextGraphics = { ...nextGraphics, payloadBytesByClip: nextPayloadByClip };
          }
        }

        const graphicsStageStatus = msgType === "progressive-done" ? "complete" : prev.graphicsStageStatus;

        return {
          ...prev,
          graphics: nextGraphics,
          graphicsStageStatus,
          supStreams: nextSupStreams,
          loadingClips: nextLoadingClips,
        };
      });
    });

    return () => {
      void worker.terminate();
    };
  }, []);

  const model = useMemo(() => buildInspectionBrowserModel(data), [data]);

  return React.createElement(InspectionBrowserView, {
    data,
    model,
    structureStatus,
    overlay,
    graphicsAvailable,
    onPrioritizeClip: (clipId: string) => {
      pendingSupOpenRef.current = clipId;
      workerRef.current?.postMessage({ type: "prioritize-clip", clipId });
    },
    onLoadSup: (clipId: string, m2tsPath: string, requests: unknown[]) => {
      workerRef.current?.postMessage({ type: "load-sup", clipId, m2tsPath, requests });
    },
    onCancelSup: (clipId: string) => {
      workerRef.current?.postMessage({ type: "cancel-sup", clipId });
    },
    pendingSupOpen: pendingSupOpenRef.current,
  });
}

export async function runInspectionTui(data: InspectionCollection, structureStatus: "complete" | "partial" | "failed"): Promise<void> {
  const ink = await import("ink");
  const protocol = imageProtocol(process.env, Boolean(process.stdout.isTTY));
  const overlay = new ImagePreviewOverlay(process.stdout, protocol);
  const graphicsAvailable = protocol !== "none";
  try {
    await ink.render(React.createElement(InspectionTuiContainer, { initialData: data, structureStatus, overlay, graphicsAvailable }), { alternateScreen: true, onRender: () => overlay.flush() }).waitUntilExit();
  } finally { overlay.clear(); }
}
