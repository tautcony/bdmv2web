import type { DeliveryDiagnostic } from "@bdmv2web/test-runner";

export function deliveryDiagnostics(diagnostics: ReadonlyArray<{ code: string; message: string; severity?: string }>): DeliveryDiagnostic[] {
  return diagnostics.map((item) => ({
    severity: item.severity ?? "warning",
    code: item.code,
    message: item.message,
  }));
}

export function firstBlockingCode(diagnostics: DeliveryDiagnostic[]): string {
  return diagnostics.find((item) => item.severity.toLowerCase() === "fatal")?.code ?? diagnostics[0]?.code ?? "STAGE_FAILED";
}

export function stageFailure(code: string, diagnostics: DeliveryDiagnostic[]): void {
  // `status` is reserved for delivery conclusions (convert/validate); a stage only
  // reports whether its own goal was reached (D-5).
  process.stdout.write(`${JSON.stringify({ stageStatus: "failed", code, diagnostics })}\n`);
  process.exitCode = 1;
}
