export type CheckResult = "pass" | "fail" | "not-verified";
export type DeliveryStatus = "failed" | "partial" | "complete";

export interface AuditCheck {
  checkId: string;
  result: CheckResult;
  message: string;
  path?: string;
  entityId?: string;
  evidence?: Record<string, unknown>;
}

export interface ManifestFile {
  path: string;
  kind: string;
  required?: boolean;
}

export interface DeliveryManifest {
  schemaVersion: "1.0";
  mode: "menu-only" | "standalone-full";
  files: ManifestFile[];
  diagnostics?: Array<{ severity: string; code?: string; acknowledged?: boolean; blocksComplete?: boolean }>;
  limitations?: string[];
  status?: string;
  payloadFingerprint?: string;
}

export interface OfflinePackageAudit {
  schemaVersion: "1.0";
  packageRoot: string;
  manifestPath: string;
  checks: AuditCheck[];
  payloadFingerprint: string | null;
  discoveredPayloadFiles: string[];
}
