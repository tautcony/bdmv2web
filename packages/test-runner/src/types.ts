export type CheckResult = "pass" | "fail" | "not-verified";

/**
 * Branded so a stage status can never be passed off as a delivery status, and a
 * delivery status can never be passed off as a stage status. The brand is a
 * compile-time-only phantom property: the runtime value stays the plain string,
 * so JSON output is unaffected.
 */
const DELIVERY_STATUS_BRAND: unique symbol = Symbol("DeliveryStatus");
export type DeliveryStatus = ("failed" | "partial" | "complete") & { readonly [DELIVERY_STATUS_BRAND]: true };

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
}

export interface OfflinePackageAudit {
  schemaVersion: "1.0";
  packageRoot: string;
  manifestPath: string;
  checks: AuditCheck[];
  discoveredPayloadFiles: string[];
}
