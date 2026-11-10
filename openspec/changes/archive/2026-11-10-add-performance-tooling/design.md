# Design

## Context

`scripts/bench/` holds twelve warm-cache component cases, synthetic scale cases, prepared-component cases, CLI and package scenarios, and a browser scenario. `pnpm bench` is the entry point, schema version 1 run records are the archive format, and reports read those records. CI runners expose variable hardware, so every record carries its observed environment identity.

## Goals / Non-Goals

**Goals:**
- Cover the twelve component operations plus scale, prepared-component, CLI, package, and browser scenarios under stable case IDs.
- Use Tinybench within explicit per-case time budgets, with each fork measured by its own Node child process.
- Save complete per-fork measurements and provenance under unique run directories.
- Compare fork medians only when fixture and runtime configuration are compatible.
- Deliver deterministic comparison output, environment-separated trends, profile links, CI artifacts, and user documentation.

**Non-Goals:**
- Set a universal hardware baseline or promise stable timings across machines.
- Gate release or package validity on payload hashes, fingerprints, or input sizes.
- Upload benchmark results to an external service or publish releases automatically.
- Require Hyperfine, 0x, Bencher, or another external service.

## Decisions

- Keep the twelve cases as stable definitions in a shared case registry. `pnpm bench` keeps `--only`, `--case`, `--root`, `--suite`, `--no-json`, and `--list`; results are written as schema version 1 run directories.
- Split case definitions, worker, orchestration, statistics, compatibility, comparison, and reporting across `scripts/bench/`. A parent orchestrator launches one worker process per fork and collects structured worker results. Tinybench controls timing within each worker's warmup duration, measurement duration, and minimum sample count; a call in progress completes after the measurement duration boundary.
- Time one sample as one call, or as several calls divided by their count when a call completes faster than the one-millisecond sample target. The worker warms the operation, measures it once, times the estimated call count, and fixes that count for the case; the count is identical across forks and recorded per row and fork. Normalized samples stay milliseconds per call, so comparison and reporting need no batch awareness.
- Use schema version 1 with root fields `schemaVersion`, `mode`, `runId`, `createdAt`, `environment`, `configuration`, `rows`, `skipped`, and `failures`. Each row stores `caseId`, `callsPerSample`, `fixture:{id,version,parameters}`, `category`, `name`, `sample`, `scope`, `forks`, and aggregate `stats`. Each fork stores `index`, `callsPerSample`, `iterations`, `rawMsPerCall`, `stats`, one CPU-time interval in microseconds, memory snapshots, and GC events. CPU and heap profiling run in dedicated capture modes.
- Fixture `parameters` describe inputs: kind, clip, PID, display-set selection, and scale factors. Expected output counts live in `expected.details`.
- Write each run to a new run-ID directory and reject collisions. The record is the source for compare and report commands. Preserve actual environment values for Node, V8, platform, OS release, architecture, CPU model and count, `execArgv`, `NODE_OPTIONS`, declared/observed build mode, and benchmark configuration.
- Compare one median per independent child process. Use deterministic bootstrap resampling over fork medians and report the seed, interval, and fork count. Keep relative and absolute thresholds configurable; default comparison emits warnings, and a CLI flag selects a nonzero regression exit status. Label weak evidence when fork count or interval width prevents a clear conclusion.
- Restrict comparison compatibility to case ID, fixture ID/version/parameters, timing scope, Node and V8 versions, OS/platform, CPU identity and count, `execArgv`, `NODE_OPTIONS`, profile build mode, and measurement configuration. `scripts/bench/compatibility.mjs` holds one field list for comparison and trends. Unknown and mixed build modes form identities separate from normal and profile builds. Print missing, skipped, failed, and incompatible states as explicit rows.
- Build trend series from compatible identities and keep profile paths relative to their run directory. Emit JSON and Markdown directly; render standalone HTML with embedded SVG data and no remote assets.
- Run designated synthetic representatives on pull requests. Scheduled and manually dispatched workflow runs expose the full available suite. Base and candidate comparisons run the same runner sequentially in alternating order and report the observed runner details.
- Keep browser `file://` execution in the performance capture work with portable browser installation instructions. Keep source maps enabled for profiling builds and link captured `.cpuprofile` files from reports.

## Risks / Trade-offs

- Process startup increases total wall time → Use a quick synthetic suite for routine CI and configurable fork counts for full runs.
- CPU contention and variable hosted runners widen intervals → Record observed hardware, keep hardware-specific trends separate, and label insufficient confidence.
- Browser automation varies across browser versions → Record the browser version and treat browser measurements as environment-specific.
- Bootstrap intervals are weak with few independent forks → State the fork count and confidence status in comparison output.
- Sub-microsecond operations are dominated by timer quantization → Batch calls into one sample and record the count, so tail percentiles describe per-call cost instead of clock granularity.

## Migration Plan

1. Add the shared case registry, the runner, and the statistics and compatibility modules.
2. Add comparison, reporting, tests, the CI workflow, the fixture registry, and documentation.
3. Run the synthetic comparison pair and the selected component cases; record unverified coverage in the change verification record.
4. Remove the legacy fixed JSON output path; run records and run directories are the archive format.

## Open Questions

None.
