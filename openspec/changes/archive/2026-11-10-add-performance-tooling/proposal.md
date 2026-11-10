# Proposal

## Why

Performance work needs measurements that keep sample identity, runtime environment, and uncertainty across independent processes, plus archived records that later runs can compare. The component benchmark times cases inside one process and writes one fixed JSON file.

## What Changes

- Give the twelve benchmark cases stable case IDs, fixture identity, and a shared case registry behind the `pnpm bench` entry point.
- Add a Tinybench runner with bounded timing, batched samples for sub-millisecond operations, independent child-process forks, CPU-time and memory sampling, GC observations, and immutable schema version 1 run records.
- Add comparison and trend reports that match compatible samples and environments, compare fork medians, report effect size and a deterministic process-level bootstrap interval, and mark missing, skipped, failed, and incompatible cases as separate states.
- Add synthetic scale cases, prepared real-component cases, prepared-data CLI inspect/extract/render scenarios, package assembly from prepared scene and PNG inputs, and a generated-package `file://` browser scenario.
- Add a synthetic pull-request CI run plus scheduled and manual full runs with artifacts and job summaries.
- Add setup, command, report-interpretation, environment-limit, and source-map documentation.

## Capabilities

### New Capabilities
- `performance-tooling`: Reproducible benchmark runs, immutable result records, compatible fork-level comparison, trend reports, and CI delivery.

### Modified Capabilities
- None.

## Impact

The change affects `scripts/bench/`, the root package scripts and lockfile, `.github/workflows/`, performance guidance under `docs/guides/`, the fixture registry under `test-data/fixtures/perf/`, and the documentation index. It runs Node child processes and project-built CLI and browser artifacts. CI reports the hardware of the runner that produced a record.
