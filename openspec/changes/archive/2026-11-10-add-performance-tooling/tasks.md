# Tasks

## 1. Benchmark definitions and execution

- [x] 1.1 Define all twelve stable case IDs and keep `--suite`, `--only`, `--case`, and `--list` as the selection interface; verify the listing test matches the expected case mapping.
- [x] 1.2 Implement Tinybench workers, time budgets, independent process forks, CPU-time intervals, memory and GC observations, source-map profile capture, and immutable schema-versioned run directories; verify worker and run-record tests cover measurements, errors, skips, and collision handling.
- [x] 1.3 Add synthetic scale, prepared-component, prepared-data CLI inspect/extract/render, package assembly, and browser `file://` cases; verify prepared input coverage and record unverified browser coverage in the verification record.
- [x] 1.4 Batch calls into one timing sample for operations below the one-millisecond target and keep samples per call; verify the call-count calibration and the normalized samples of a sub-microsecond case.

## 2. Comparison and reporting

- [x] 2.1 Implement compatibility matching and fork-level comparison with deterministic process-level bootstrap intervals, effect size, relative and absolute thresholds, warning default, and optional failing exit status; verify compatible, missing, skipped, failed, incompatible, noisy, threshold-crossing, and low-confidence improvement fixtures.
- [x] 2.2 Implement JSON, Markdown, and static HTML/SVG trends grouped by case and environment with profile links; verify report fixtures keep incompatible environments in separate series and drop superseded source runs.

## 3. CI and documentation

- [x] 3.1 Add the package scripts, the benchmark dependencies, and the `bench:test` entry in the test lane.
- [x] 3.2 Add pull-request synthetic CI plus scheduled/manual full workflow, artifact upload, and job summary; verify workflow YAML structure and the local synthetic pair.
- [x] 3.3 Add `docs/guides/performance.md`, register it in `docs/README.md`, and update the development guide entry point; verify documented commands and all relative documentation links resolve.

## 4. Integration verification

- [x] 4.1 Run benchmark tests, OpenSpec validation, lint, and the documentation link check; record exact commands and outcomes in the change verification record.
- [x] 4.2 Run the synthetic pair, the trend report, and a heap capture; record the browser, real-disc, hosted-CI, and platform runs that remain unverified.
