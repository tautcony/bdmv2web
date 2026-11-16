import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import { Worker } from "node:worker_threads";
import { ContractError } from "@bdmv2web/core/contract-error";
import type { InspectionCollection } from "./inspect-collection.js";
import { buildInspectionBrowserModel } from "./inspect-browser-model.js";
import type { AssetSelection, AssetType } from "../cli/assets.js";

export async function runInspectionTui(data: InspectionCollection, structureStatus: "complete" | "partial" | "failed"): Promise<void> {
  const ink = await import("ink");
  const model = buildInspectionBrowserModel(data);
  const { InspectionBrowserView } = await import("./inspect-browser-view.js");
  await ink.render(React.createElement(InspectionBrowserView, { data, model, structureStatus })).waitUntilExit();
}

function ScanProgress({ input, assetSelection, assetType, onComplete }: { input: string; assetSelection: AssetSelection; assetType: AssetType; onComplete: (data?: InspectionCollection, error?: Error) => void }): React.ReactElement {
  const { exit } = useApp();
  const workerRef = useRef<Worker | null>(null);
  const settledRef = useRef(false);
  const [phase, setPhase] = useState<"structure" | "graphics">("structure");
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const developmentWorker = import.meta.url.endsWith(".ts");
    const workerUrl = developmentWorker
      ? new URL("./inspect-collection-worker-dev.ts", import.meta.url)
      : new URL("./inspect-collection-worker.js", import.meta.url);
    const worker = new Worker(workerUrl, { workerData: { input, assetSelection, assetType }, ...(developmentWorker ? { execArgv: process.execArgv } : {}) });
    workerRef.current = worker;
    let settled = false;
    worker.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const result = message as { type?: string; phase?: "structure" | "graphics"; data?: InspectionCollection; code?: string; path?: string | null; message?: string };
      if (result.type === "phase" && result.phase) setPhase(result.phase);
      if (result.type === "complete" && result.data) { settled = true; settledRef.current = true; onComplete(result.data); exit(); }
      if (result.type === "error") {
        settled = true; settledRef.current = true;
        const error = result.code && result.path ? new ContractError(result.code, result.path, result.message ?? "Inspection collection failed") : new Error(result.message ?? "Inspection collection failed");
        onComplete(undefined, error); exit();
      }
    });
    worker.on("error", (error: Error) => { if (!settled) { settled = true; settledRef.current = true; onComplete(undefined, error); exit(); } });
    worker.on("exit", (code) => { if (!settled) { settled = true; settledRef.current = true; onComplete(undefined, new Error("Inspection worker exited with code " + code)); exit(); } });
    return () => { clearInterval(timer); if (!settled) void worker.terminate(); };
  }, []);
  useInput((input, key) => {
    if (key.ctrl && input === "c" && !settledRef.current) {
      settledRef.current = true;
      onComplete(undefined, new Error("Inspection scan cancelled"));
      void workerRef.current?.terminate();
      exit();
    }
  });
  return React.createElement(Box, { flexDirection: "column" }, React.createElement(Text, null, `Inspecting ${input}`), React.createElement(Spinner, { label: `${phase === "structure" ? "Reading structure" : "Extracting graphics"} · ${elapsed}s` }));
}

export async function collectInspectionWithProgress(input: string, assetSelection: AssetSelection, assetType: AssetType): Promise<InspectionCollection> {
  let resolveResult: ((data: InspectionCollection) => void) | undefined;
  let rejectResult: ((error: Error) => void) | undefined;
  const result = new Promise<InspectionCollection>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const ink = await import("ink");
  const instance = ink.render(React.createElement(ScanProgress, { input, assetSelection, assetType, onComplete: (data, error) => error ? rejectResult?.(error) : data ? resolveResult?.(data) : rejectResult?.(new Error("Inspection scan returned no result")) }));
  try { await instance.waitUntilExit(); }
  catch (error) { rejectResult?.(error instanceof Error ? error : new Error(String(error))); }
  return result;
}
