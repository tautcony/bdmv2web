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

type StageFailureRecord = { stageStatus: "failed"; code: string; diagnostics: DeliveryDiagnostic[] };

export function stageFailure(code: string, diagnostics: DeliveryDiagnostic[]): void {
  const record: StageFailureRecord = { stageStatus: "failed", code, diagnostics };
  process.stdout.write(`${JSON.stringify(record)}\n`);
  process.exitCode = 1;
}
