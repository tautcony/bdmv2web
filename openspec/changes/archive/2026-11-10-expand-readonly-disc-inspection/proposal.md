# Proposal

## Why

`inspect` retains entry references to BDJO files, but does not parse their contents. META/DL files and MPLS/CLPI ExtensionData are outside the current structural report, and several angle, stream, clip-mark, and UHD fields are skipped. The read-only inspection output needs those declarations and their file locations for complete disc analysis.

## What Changes

- Parse BDJO application, cache, accessible-playlist, terminal, key-interest, and file-access records while keeping BD-J execution unsupported.
- Read META/DL manifest files and report localized disc/title names and thumbnail declarations with source paths.
- Parse the shared ExtensionData table for MPLS and CLPI. Decode the supported PIP, extension SubPath, static HDR, extent-start-point, ProgramInfo SS, and CPI SS payloads; retain bounded metadata for unknown entries.
- Preserve MPLS multi-angle clip records and STN stream-category membership, and expose remaining stream attributes used by the pinned parser reference.
- Parse CLPI ClipMark records and expose ClipInfo, ProgramInfo, SequenceInfo, and CPI fields currently skipped by the parser.
- Keep source locations, diagnostics, read limits, and `unverified` status for protocol behavior without independent expected data.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bdmv-disc-inspection`: expose read-only BDJO, META/DL, ExtensionData, and additional MPLS/CLPI structure with source locations and bounded failure behavior.

## Impact

Updates `@bdmv2web/bdmv-parser` data models and parsing, `inspect` JSON/table reporting, structural support documentation, and the existing disc-inspection specification. No runtime playback behavior, BD-J execution, or disc-file writing changes.
