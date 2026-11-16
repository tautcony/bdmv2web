# Proposal

## Why

`inspect` and `list` currently perform overlapping reads and expose related navigation, playlist, clip, and graphics data through separate views. A single interactive inspection session can reuse one structural parse and one graphics extraction while keeping deterministic text and machine-readable output available.

## What Changes

- Make `inspect` the unified inspection command and `list` its alias.
- Use an Ink and React TUI on TTY by default; preserve text output for pipes and explicit table output.
- Combine disc, graphics, and stage status data in JSON, preserving existing filters and avoiding PNG rendering.
- Browse existing parsed navigation, MPLS declaration order, PlayItems, M2TS, metadata, diagnostics, IGS scenes, and reachable SUP references with source provenance.

## Capabilities

### New Capabilities
- `interactive-disc-inspection`: Unified TTY and non-interactive inspection behavior using one structural scan and one graphics extraction.

### Modified Capabilities
- `bdmv-disc-inspection`: Extend inspect/list output and interaction contract with combined graphics data and alias behavior.

## Impact

CLI command registration and collection, a new Ink/React TUI, inspection tests, CLI help and development guide, and OpenSpec requirements. Runtime dependency is limited to the CLI package.
