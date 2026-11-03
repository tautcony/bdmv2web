export interface MenuLoopBudgetEstimate {
  duration90k: string;
  videoBytes: string;
  audioBytes: string[];
  totalMediaBytes: string;
  estimateBasis: "configured-target-bitrate-assumption";
}

export interface MenuLoopBudgetRates {
  estimatedVideoBitsPerSecond: number;
  estimatedAudioBitsPerSecond: number;
  containerOverheadPercent: number;
}

export interface MediaBudgetDiagnostic {
  severity: "error";
  code: string;
  message: string;
  scope: "asset" | "package";
  phase: "preflight-estimate" | "write-monitor" | "finalize";
  estimatedBytes?: string;
  actualBytes?: string;
  limitBytes: string;
}

export class MediaBudgetError extends Error {
  constructor(readonly diagnostic: MediaBudgetDiagnostic) {
    super(diagnostic.message);
    this.name = "MediaBudgetError";
  }
}

export function validateOptionalByteLimit(name: string, value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer or null`);
}

export function validateBudgetRates(rates: MenuLoopBudgetRates): void {
  if (!Number.isSafeInteger(rates.estimatedVideoBitsPerSecond) || rates.estimatedVideoBitsPerSecond <= 0) throw new RangeError("estimatedVideoBitsPerSecond must be a positive safe integer");
  if (!Number.isSafeInteger(rates.estimatedAudioBitsPerSecond) || rates.estimatedAudioBitsPerSecond <= 0) throw new RangeError("estimatedAudioBitsPerSecond must be a positive safe integer");
  if (!Number.isSafeInteger(rates.containerOverheadPercent) || rates.containerOverheadPercent < 0 || rates.containerOverheadPercent > 100) throw new RangeError("containerOverheadPercent must be an integer from 0 through 100");
}

export function estimateMenuLoopBudget(duration45k: number, audioTrackCount: number, rates: MenuLoopBudgetRates): MenuLoopBudgetEstimate {
  if (!Number.isSafeInteger(duration45k) || duration45k <= 0) throw new RangeError("duration45k must be a positive safe integer");
  if (!Number.isSafeInteger(audioTrackCount) || audioTrackCount < 0) throw new RangeError("audioTrackCount must be a non-negative safe integer");
  validateBudgetRates(rates);
  const duration90k = BigInt(duration45k) * 2n;
  const videoBytes = estimateBytes(duration90k, rates.estimatedVideoBitsPerSecond, rates.containerOverheadPercent);
  const audioBytes = Array.from({ length: audioTrackCount }, () => estimateBytes(duration90k, rates.estimatedAudioBitsPerSecond, rates.containerOverheadPercent));
  const totalMediaBytes = [videoBytes, ...audioBytes].reduce((sum, item) => sum + BigInt(item), 0n).toString();
  return { duration90k: duration90k.toString(), videoBytes, audioBytes, totalMediaBytes, estimateBasis: "configured-target-bitrate-assumption" };
}

export function assertEstimateWithinLimit(args: { scope: "asset" | "package"; estimateBytes: bigint; limitBytes: number | null | undefined; phase?: "preflight-estimate" | "finalize"; message: string }): void {
  if (args.limitBytes === undefined || args.limitBytes === null || args.estimateBytes <= BigInt(args.limitBytes)) return;
  const scopeName = args.scope === "asset" ? "MEDIA_ASSET_BUDGET_EXCEEDED" : "MEDIA_OUTPUT_BUDGET_EXCEEDED";
  throw new MediaBudgetError({ severity: "error", code: scopeName, message: args.message, scope: args.scope, phase: args.phase ?? "preflight-estimate", estimatedBytes: args.estimateBytes.toString(), limitBytes: String(args.limitBytes) });
}

export function assertActualWithinLimit(args: { scope: "asset" | "package"; actualBytes: number | bigint; limitBytes: number | null | undefined; message: string }): void {
  if (args.limitBytes === undefined || args.limitBytes === null || BigInt(args.actualBytes) <= BigInt(args.limitBytes)) return;
  const scopeName = args.scope === "asset" ? "MEDIA_ASSET_BUDGET_EXCEEDED" : "MEDIA_OUTPUT_BUDGET_EXCEEDED";
  throw new MediaBudgetError({ severity: "error", code: scopeName, message: args.message, scope: args.scope, phase: "write-monitor", actualBytes: String(args.actualBytes), limitBytes: String(args.limitBytes) });
}

function estimateBytes(duration90k: bigint, rateBitsPerSecond: number, overheadPercent: number): string {
  const numerator = duration90k * BigInt(rateBitsPerSecond) * BigInt(100 + overheadPercent);
  const denominator = 90_000n * 8n * 100n;
  return ((numerator + denominator - 1n) / denominator).toString();
}
