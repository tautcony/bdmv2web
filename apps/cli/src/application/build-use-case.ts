import type { MediaAssetProgress } from "@bdmv2web/media-export";
import { assembleMenuPackage, type MenuPackageInput, type MenuPackageResult, type MenuPackageStatus } from "@bdmv2web/package-builder";
import type { BuildPlan } from "./build-plan.js";
import { exportMenuMediaForPlan } from "./export-menu-media.js";

export interface BuildUseCaseRequest {
  plan: BuildPlan;
  outputDirectory: string;
  title: string;
  /** Delivery status decided by `decideDelivery()` in the command layer. */
  status: MenuPackageStatus;
  onMediaProgress?: (progress: MediaAssetProgress) => void;
  onPhase?: (phase: "media" | "assets" | "bundle" | "manifest") => void;
}

/**
 * Assemble the packaging input and write the package. Fixed order:
 * plan (by the caller) → exportMenuMedia → assembleMenuPackage → report.
 * The command layer publishes stdout and the exit code.
 */
export async function buildUseCase(request: BuildUseCaseRequest): Promise<MenuPackageResult> {
  request.onPhase?.("media");
  const preparedMedia = await exportMenuMediaForPlan({
    plan: request.plan,
    outputDirectory: request.outputDirectory,
    ...(request.onMediaProgress ? { onMediaProgress: request.onMediaProgress } : {}),
  });
  const input: MenuPackageInput & { preparedMedia: typeof preparedMedia } = {
    ...request.plan.packageInput,
    outputDirectory: request.outputDirectory,
    title: request.title,
    status: request.status,
    ...(request.onPhase ? { onPhase: request.onPhase } : {}),
    preparedMedia,
  };
  return assembleMenuPackage(input);
}
