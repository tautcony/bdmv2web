import { errorText } from "@bdmv2web/utils";
import { inputPath, optionValue } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { readJsonObject, writeGeneratedReport } from "../cli/output.js";
import { auditOutputPackage, createDependencyAuditReport, createReleaseSummary, summarizeDeliveryCoverage } from "@bdmv2web/test-runner";
import { resolve } from "node:path";
import type { DeliveryDiagnostic } from "@bdmv2web/test-runner";

export async function validate(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "validate requires an output package directory");
  // Argument contract first: a rejected command must not rewrite the package (P2-P2-1).
  const format = optionValue("--format");
  if (format !== undefined && format !== "json") fail("CLI_INVALID_FORMAT", `validate supports only 'json' for --format, got '${format}'`);
  const audit = await auditOutputPackage(resolve(input));
  const writable = !audit.checks.some((check) => check.checkId === "PACKAGE_ROOT_MISSING" || check.checkId === "PACKAGE_ROOT_INVALID");
  const manifest = await readJsonObject(resolve(audit.packageRoot, audit.manifestPath), (message) => {
    // The delivery decision reads manifest status and limitations back from the
    // package. A re-read failure must stay visible, otherwise the status
    // disagreement check below would silently report nothing.
    audit.checks.push({ checkId: "MANIFEST_REREAD_FAILED", result: "not-verified", message: `manifest.json could not be read for the delivery decision: ${message}`, path: audit.manifestPath });
  });
  const reports = await readJsonObject(resolve(audit.packageRoot, "reports.json"));
  const compatibility = typeof reports.compatibility === "object" && reports.compatibility !== null && !Array.isArray(reports.compatibility)
    ? reports.compatibility as Record<string, unknown>
    : undefined;
  const conversion = typeof reports.conversion === "object" && reports.conversion !== null && !Array.isArray(reports.conversion)
    ? reports.conversion as Record<string, unknown>
    : undefined;
  const limitations = Array.isArray(manifest.limitations) ? manifest.limitations.filter((item): item is string => typeof item === "string") : [];
  // A package records the diagnostics that decided its own conversion. Re-reading
  // them keeps convert and validate on the same evidence instead of two verdicts.
  const manifestDiagnostics: DeliveryDiagnostic[] = (Array.isArray(manifest.diagnostics) ? manifest.diagnostics : [])
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => ({
      severity: typeof item.severity === "string" ? item.severity : "warning",
      ...(typeof item.code === "string" ? { code: item.code } : {}),
      ...(typeof item.message === "string" ? { message: item.message } : {}),
    }));
  const declaredEntryCount = Number.isSafeInteger(manifest.declaredEntryCount) && (manifest.declaredEntryCount as number) >= 0 ? manifest.declaredEntryCount as number : undefined;
  const hdmvEntryCount = Number.isSafeInteger(manifest.hdmvEntryCount) && (manifest.hdmvEntryCount as number) >= 0 ? manifest.hdmvEntryCount as number : undefined;
  const coverage = summarizeDeliveryCoverage({
    entries: { reason: "Per-entry coverage evidence is not present in this package." },
    instructions: { reason: "Per-instruction coverage evidence is not present in this package." },
    media: { reason: "Per-media coverage evidence is not present in this package." },
    tests: { reason: "Test-matrix evidence is not present in this package." },
  });
  const releaseSummaryInput = {
    audit,
    dependencyAudit: createDependencyAuditReport(audit),
    coverage,
    referenceEvidence: [],
    decisionFacts: {
      limitations,
      diagnostics: manifestDiagnostics,
      ...(declaredEntryCount === undefined ? {} : { declaredEntryCount }),
      ...(hdmvEntryCount === undefined ? {} : { hdmvEntryCount }),
      hasMissingRequiredAsset: audit.checks.some((check) => check.checkId === "PACKAGE_MISSING_ASSET" || check.checkId === "PACKAGE_REQUIRED_ASSET_MISSING"),
      ...(typeof manifest.hasUnresolvedReachability === "boolean" ? { hasUnresolvedReachability: manifest.hasUnresolvedReachability } : {}),
      ...(typeof manifest.hasUnsupportedReachableCapability === "boolean" ? { hasUnsupportedReachableCapability: manifest.hasUnsupportedReachableCapability } : {}),
    },
  } as const;
  let releaseSummary = createReleaseSummary(releaseSummaryInput);
  // `validate` never rewrites manifest.status: a disagreement is reported as
  // unverified evidence, not repaired behind the caller's back (D-2R).
  const manifestStatus = typeof manifest.status === "string" ? manifest.status : undefined;
  if (manifestStatus !== undefined && manifestStatus !== releaseSummary.release.status) {
    audit.checks.push({ checkId: "MANIFEST_STATUS_UNVERIFIED", result: "not-verified", message: `manifest.json records status '${manifestStatus}' but the current evidence decides '${releaseSummary.release.status}'; the manifest is not rewritten.`, path: "manifest.json" });
    releaseSummary = createReleaseSummary(releaseSummaryInput);
  }
  const currentGaps = releaseSummary.release.gaps.map((gap) => gap.checkId);
  releaseSummary = {
    ...releaseSummary,
    compatibility: {
      ...releaseSummary.compatibility,
      ...(typeof compatibility?.profile === "string" ? { profile: compatibility.profile } : {}),
      externalDependencies: Array.isArray(compatibility?.externalDependencies) ? compatibility.externalDependencies : [],
      notVerified: [...new Set(currentGaps)],
    },
  };
  const compatibilityDetails = { ...releaseSummary.compatibility } as Record<string, unknown>;
  delete compatibilityDetails.schemaVersion;
  const conversionDetails = conversion === undefined ? undefined : {
    ...(typeof conversion.status === "string" ? { status: conversion.status } : {}),
    ...(typeof conversion.code === "string" ? { code: conversion.code } : {}),
    ...(Array.isArray(conversion.reasons) ? { reasons: conversion.reasons } : {}),
  };
  let dependencyAudit = releaseSummary.dependencyAudit;
  if (writable) {
    try {
      // Every on-disk report must come from the same summary, so the dependency
      // audit is written after the summary exists instead of from a pre-summary
      // intermediate value (D-12).
      await writeGeneratedReport(audit.packageRoot, "dependency-audit.json", `${JSON.stringify(releaseSummary.dependencyAudit, null, 2)}\n`);
      await writeGeneratedReport(audit.packageRoot, "reports.json", `${JSON.stringify({
        schemaVersion: "1.0",
        ...(Array.isArray(reports.diagnostics) ? { diagnostics: reports.diagnostics } : {}),
        ...(conversionDetails === undefined ? {} : { conversion: conversionDetails }),
        compatibility: compatibilityDetails,
      }, null, 2)}\n`);
      await writeGeneratedReport(audit.packageRoot, "reports/release-summary.json", `${JSON.stringify(releaseSummary, null, 2)}\n`);
    } catch (error) {
      audit.checks.push({ checkId: "RELEASE_REPORT_WRITE_FAILED", result: "fail", message: errorText(error), path: "reports/release-summary.json" });
      releaseSummary = createReleaseSummary(releaseSummaryInput);
      dependencyAudit = releaseSummary.dependencyAudit;
    }
  }
  const decision = releaseSummary.release;
  if (format === "json") process.stdout.write(`${JSON.stringify({ ...audit, dependencyAudit, ...(manifestStatus === undefined ? {} : { manifestStatus }), decision, releaseSummary })}\n`);
  else {
    const failed = audit.checks.filter((check) => check.result === "fail");
    const unverified = audit.checks.filter((check) => check.result === "not-verified");
    process.stdout.write(`Package audit: ${failed.length ? "failed" : unverified.length ? "not verified" : "passed"}\n`);
    process.stdout.write(`Dependency audit: ${dependencyAudit.status}\n`);
    process.stdout.write(`Delivery decision: ${decision.status}\n`);
    if (manifestStatus !== undefined && manifestStatus !== decision.status) process.stdout.write(`Manifest status: ${manifestStatus} (not rewritten)\n`);
    for (const check of audit.checks) if (check.result !== "pass") process.stdout.write(`${check.result.toUpperCase()} ${check.checkId}${check.path ? ` ${check.path}` : ""}: ${check.message}\n`);
    for (const gap of releaseSummary.release.gaps) process.stdout.write(`GAP ${gap.result} ${gap.checkId}${gap.path ? ` ${gap.path}` : ""}: ${gap.message} Next: ${gap.action}\n`);
    for (const reason of decision.reasons) process.stdout.write(`DECISION ${reason}\n`);
  }
  process.exitCode = decision.exitCode;
}
