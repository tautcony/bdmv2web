import { parentPort, workerData } from "node:worker_threads";
import { collectInspection } from "./inspect-collection.js";
import type { AssetSelection, AssetType } from "../cli/assets.js";
import { ContractError } from "@bdmv2web/core/contract-error";
import { errorText } from "@bdmv2web/utils";

interface WorkerRequest { input: string; assetSelection: AssetSelection; assetType: AssetType; }
interface WorkerResponse { type: "complete"; data: Awaited<ReturnType<typeof collectInspection>>; }

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
  const data = await collectInspection(request.input, request.assetSelection, request.assetType, (phase) => port.postMessage({ type: "phase", phase }));
  collectTransferables(data);
  const response: WorkerResponse = { type: "complete", data };
  port.postMessage(response, [...transfer]);
} catch (error) {
  if (error instanceof ContractError) {
    const prefix = error.code + " at " + error.path + ": ";
    port.postMessage({ type: "error", code: error.code, path: error.path, message: error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message });
  } else port.postMessage({ type: "error", code: "E_IO", path: null, message: errorText(error) });
}
