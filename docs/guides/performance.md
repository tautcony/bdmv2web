# Performance benchmarks

The benchmark suite covers eight BDMV, MNU, and PGS component cases, synthetic scale cases, CLI process start, prepared-data CLI inspect/extract/render scenarios, package assembly from prepared scene and PNG inputs, and the generated menu opened in a browser through `file://`. Each case has a stable ID, a fixture ID and version, fixture parameters, and a timing scope. Every input a case reads is committed to the repository: the runner refuses to start when one is missing, and records any input that git ignores, because a record built from a local-only file cannot be reproduced.

## Run component and scenario benchmarks

Build the workspace packages before running parser, renderer, CLI, and package cases.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm bench --list
corepack pnpm bench --mode benchmark --build-mode normal --suite all --forks 3 --warmup-ms 100 --time-ms 500 --min-samples 10 --out test-data/bench/runs
```

Start the run with `NODE_OPTIONS` unset, for example `env -u NODE_OPTIONS corepack pnpm bench …` in a POSIX shell. A preloaded module is charged to every case and every fork; the runner prints a warning on stderr and records the value in `environment.nodeOptions`, and `bench:compare` reports it as a compatibility mismatch against a run started without it.

`--suite synthetic`, `--suite real`, and `--suite scenario` select fixture groups. `--case CASE_ID` selects exact cases and repeats. `--root DIR` runs the current harness against built artifacts and source data under another checkout.

```sh
corepack pnpm bench --case perf.igs.battle-royale.parse --case perf.igs.battle-royale.render --forks 3 --out test-data/bench/runs
corepack pnpm bench --case scale.graph-1x.build --case scale.graph-2x.build --case scale.graph-4x.build --forks 3 --out test-data/bench/runs
```

The runner writes one schema version 1 record to a new run directory and prints its path. A record holds the environment, the configuration, measured rows, skipped cases, and failures; an existing record is never overwritten. Each row carries its fixture identity and scope, one entry per child-process fork, and aggregate fork statistics. Each fork holds its full millisecond samples normalized per call, `callsPerSample`, one CPU-time interval in microseconds, block references for its memory snapshots and GC observations, and an optional profile path.

Per-call samples are stored in `samples.f64` next to `run.json` as little-endian float64; each fork points at its block with `{ encoding, file, offset, count }`, and the record's `samples` field names the file, encoding, byte size, and sample count. Every timing sample is retained; a batched sample covers `callsPerSample` calls.

Per-fork memory snapshots and GC events use the same block references: `memory.f64` stores four interleaved channels per snapshot (`rss`, `heapUsed`, `external`, `arrayBuffers`) and `gc.f64` stores four columns per event (`kind`, `flags`, `durationMs`, `startTimeMs`). A fork's `memory.series` and `gc.series` name the block and its channels; the memory peaks and sample count stay on the record, and `gc.eventCount` carries the number of events. Reports read those summaries without opening the binary stores.

Per-fork statistics cover min, mean, median, p90, p95, p99, max, standard deviation, coefficient of variation, median absolute deviation, interquartile range, outlier count and share, call throughput, window drift, and sample count. Rows declare `unit: "ms/call"`.

Timing follows the configured warmup duration, measurement duration, and minimum sample count. An operation already in progress completes after the measurement duration. Component input loading and fixture preparation run outside the timed operation.

Window drift compares the median of the first fifth of a fork's samples with the last fifth, relative to the whole median. Operations that allocate grow the heap as the window runs, so late samples run slower than early ones and the median depends on where it landed. Reports mark a row `!` when any fork drifts by 25 percent or more; such a row is not a stable comparison point until the window is shortened or the per-sample allocation drops.

Operations faster than the 1 ms sample target are timed in batches: the worker warms the operation for the configured warmup duration, measures one call, times the estimated call count, and divides every sample by that count. Each recorded value stays milliseconds per call, and each measured interval is long enough for the timer to resolve. Rows record `callsPerSample`, one case uses the same count in every fork, and `--calls-per-sample N` fixes the count instead of calibrating. Batching changes sample resolution only; medians, percentiles, and throughputs remain per call.

CLI cases run the built `apps/cli/dist/index.js` as a child process, so each sample covers process start, argument parsing, and the modules the selected command loads. `cli.startup.version` times only process start and argument parsing; a command case minus that baseline is the command's own cost. Command modules load on first use, so `--version` and `--help` do not load the commands they never run. `scale.pes-*x.extract` times transport scanning and IGS scene extraction; asset rendering is a separate case (`perf.igs.battle-royale.render`). Packaging is split the same way: `perf.package.igs-serialize` times the batching and script serialization that every machine performs, and `perf.package.igs-assembly` additionally writes the package tree to a temporary directory, so the difference between the two rows is filesystem work rather than code.

## Capture profiles and memory

CPU, heap, memory, and browser captures are separate modes. Each mode writes a schema version 1 record plus its artifacts under the output directory.

```sh
corepack pnpm bench --mode cpu --case perf.igs.battle-royale.render --duration-ms 5000 --out test-data/bench/profiles
corepack pnpm bench --mode heap --case perf.pgs.baja.compose --duration-ms 5000 --out test-data/bench/profiles
corepack pnpm bench --mode memory --case cli.perf.metadata.inspect --duration-ms 5000 --out test-data/bench/profiles
corepack pnpm bench --mode browser --case browser.synthetic-menu.file-navigation --out test-data/bench/profiles
```

CPU captures use Node source maps. Memory records hold heap, external memory, observed RSS, process-lifetime maximum RSS, GC events, and their observation scope. The browser mode records one navigation per run: elapsed time, the interaction sequence, canvas size, page and console errors, browser version, and the CDP CPU profile and trace. Timing budgets and fork counts apply to benchmark mode.

Every record holds the Node version, V8 version, platform, OS release, architecture, CPU model and count, runtime flags, source revision, and working-tree state.

## Compare runs

`bench:compare` reads two run records or two run directories with the same fixture and environment.

```sh
corepack pnpm bench:compare test-data/bench/runs/baseline test-data/bench/runs/candidate --out test-data/bench/reports/comparison.json
corepack pnpm bench:compare baseline-run candidate-run --relative-threshold 10 --absolute-threshold-ms 0.05
corepack pnpm bench:compare baseline-run candidate-run --fail-on-regression
```

Compatibility covers case ID, fixture ID/version/parameters, scope, Node and V8 versions, OS release, CPU model and count, `execArgv`, `NODE_OPTIONS`, build mode, engine, and warmup/measurement/sample configuration. A mismatch, a missing row, a skip, and a failure each print as their own state. Unknown and mixed build modes form identities separate from normal and profile builds. The calls-per-sample count is recorded per row and does not affect compatibility, because every sample is stored per call.

Each observation is one median from one independent child process. The default thresholds require both a relative change above 10 percent and an absolute change above 0.05 ms. The process-level bootstrap interval uses a deterministic seed and reports the seed and resample count. Three forks per side and an interval excluding zero support a confirmed verdict; fewer forks or an interval spanning zero produce a warning. `--fail-on-regression` returns a failing exit status for confirmed regressions.

## Report trends

`bench:report` reads every run record under the given paths and emits JSON, Markdown, or a standalone HTML/SVG report.

```sh
corepack pnpm bench:report test-data/bench/runs --format json --out test-data/bench/reports/trend.json
corepack pnpm bench:report test-data/bench/runs --format markdown --out test-data/bench/reports/trend.md
corepack pnpm bench:report test-data/bench/runs --format html --out test-data/bench/reports/trend.html
```

Trend series separate by case, fixture parameters, scope, runtime environment, and benchmark configuration. Each HTML plot shows milliseconds, revision labels, and the minimum and maximum fork medians. Tables list run IDs, environment details, output statuses, per-fork medians, calls per sample, p95 and p99, calls per second, coefficient of variation, outlier share, window drift, and relative links to CPU profiles, heap profiles, memory records, and browser artifacts. Percentiles interpolate linearly over the sample; outliers are samples outside the 1.5 IQR fence; calls per second derive from the median fork median. Run directories and report directories stay together for downloadable artifacts.

## CI runs

`.github/workflows/performance.yml` runs three synthetic cases on pull requests in baseline/candidate/candidate/baseline order on one runner, and merges the fork sets of each pair. Scheduled and manually dispatched runs execute the full available suite, then write Markdown and HTML trend reports. Both paths upload run records and reports and append the Markdown summary to the job summary.

Hosted runner hardware varies; CI output describes the runner that produced it.

Prepared fixture inputs and source paths are listed in [the fixture manifest](../../test-data/fixtures/perf/manifest.json) and [the fixture guide](../../test-data/fixtures/perf/README.md). The fixture set holds primary metadata, a complete filtered IGS packet stream, a prepared MNU payload, and a complete local PGS SUP.

Run records, profile captures, pair output, and rendered reports stay under `test-data/bench/`; [the benchmark data README](../../test-data/bench/README.md) states the directory layout, what makes a record keepable, and how to add runs and reports.
