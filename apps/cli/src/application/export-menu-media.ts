import { exportMenuMedia, type MediaAssetProgress, type PreparedMenuMedia } from "@bdmv2web/media-export";
import type { BuildPlan } from "./build-plan.js";

export interface ExportMenuMediaRequest {
  plan: BuildPlan;
  outputDirectory: string;
  onMediaProgress?: (progress: MediaAssetProgress) => void;
}

/**
 * Application-layer adapter: forward the plan's media units and progress
 * callback to media-export's `exportMenuMedia()`.
 */
export function exportMenuMediaForPlan(request: ExportMenuMediaRequest): Promise<PreparedMenuMedia> {
  const { packageInput } = request.plan;
  return exportMenuMedia(packageInput.menuLoopMedia, packageInput.additionalMenuMedia ?? [], {
    outputDirectory: request.outputDirectory,
    ...(packageInput.mediaEncoding ? { mediaEncoding: packageInput.mediaEncoding } : {}),
    ...(packageInput.reuseMediaFromDirectory ? { reuseFromDirectory: packageInput.reuseMediaFromDirectory } : {}),
    ...(packageInput.mediaProcessRunner ? { runProcess: packageInput.mediaProcessRunner } : {}),
    ...(request.onMediaProgress ? { onProgress: request.onMediaProgress } : {}),
  });
}
