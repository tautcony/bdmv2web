/** Delivery status as decided by the caller; the package must not invent one. */
export type MenuPackageStatus = "failed" | "partial" | "complete";

export interface MenuPackageDiagnostic { code: string; message: string; severity?: string }
export interface MenuPackageMetadata { schemaVersion: "1.0"; runtimeVersion: string; title: string; status: MenuPackageStatus; diagnostics: MenuPackageDiagnostic[] }
