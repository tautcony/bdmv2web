# Tasks

## 1. Shared models and ExtensionData

- [x] 1.1 Add source-aware models for extension entries and the new optional structural records; verify parser package typecheck and existing consumers compile.
- [x] 1.2 Implement one bounded MPLS/CLPI ExtensionData table reader and known-payload dispatch; add parser tests for known, unknown, malformed, and boundary-crossing entries and verify the parser package suite passes.

## 2. BDJO and META/DL inspection

- [x] 2.1 Parse referenced BDJO records and retain source locations; add byte-built positive/truncated cases and verify the parser package suite passes.
- [x] 2.2 Parse bounded META/DL manifests and title/thumbnail declarations; add localized, escaped-text, invalid-XML, and limit cases and verify the parser package suite passes.
- [x] 2.3 Update the structural support matrix with BDJO/META/DL coverage and the BD-J execution boundary; verify all relative documentation links resolve.

## 3. MPLS and CLPI field coverage

- [x] 3.1 Retain alternative angle records, STN categories, and stream attributes; add parser cases for multi-angle and classified streams and verify the parser package suite passes.
- [x] 3.2 Parse CLPI ClipMark, ProgramInfo groups, CPI coarse/fine maps, and supported ExtensionData payloads; add byte-built field/bounds cases and verify the parser package suite passes.
- [x] 3.3 Update MPLS/CLPI field coverage and evidence status in support documentation; verify documented field names match the parsed JSON shape.

## 4. Inspect integration and evidence reporting

- [x] 4.1 Include BDJO and META/DL declarations in `ParsedDisc`, graph/report output, and declaration counts; add CLI integration coverage and verify the inspect JSON contains source-linked records.
- [x] 4.2 Keep protocol status `unverified` where independent expected values are absent, and list remaining field-level gaps; verify status output does not claim complete format support.
- [x] 4.3 Run parser, CLI, and workspace typecheck suites; record exact commands and results in the change verification record.
