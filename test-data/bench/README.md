# Benchmark data

Local output of the performance tooling in [`scripts/bench/`](../../scripts/bench/). The directory is listed in `.gitignore`: records stay on the machine that produced them, and CI uploads its own artifacts.

## Layout

| Path | Content | Produced by |
| --- | --- | --- |
| `runs/<runId>/` | One benchmark run: `run.json` plus `samples.f64` | `pnpm bench` |
| `profiles/<runId>/` | CPU, heap, memory, and browser captures with their artifacts | `pnpm bench --mode cpu\|heap\|memory\|browser` |
| `pairs/<label>/` | Baseline and candidate records, `comparison.json`, `summary.md` | `node scripts/bench/ci.mjs` |
| `reports/<date>/` | `trend.md`, `trend.html`, `trend.json` rendered from `runs/` | `node scripts/bench/report.mjs` |

Only `runs/`, `profiles/`, `pairs/`, and `reports/` are regenerable from commands.

## One run directory

A run directory is written once under a new `runId`; the runner refuses to overwrite one. It holds:

- `run.json` — `schemaVersion` 1 record with `environment`, `configuration`, `rows`, `skipped`, `failures`, an `untrackedFixtures` list when a case read a file that git ignores, and a `samples` pointer.
- `samples.f64` — one value per timing sample, normalized to milliseconds per call, written as little-endian float64; each fork references its block as `{ encoding, file, offset, count }`. A sample covers `callsPerSample` calls when the case is faster than the one-millisecond target.

A full suite run with three forks is about 4 MB, mostly `run.json`; a one-fork run records about a third of that. Editing a record by hand breaks the offsets in `samples.f64`; delete the directory and rerun instead.

## Fixtures ship with the code

A case measures a fixture that ships with the repository. `scripts/bench/fixture-audit.mjs` resolves every input path a case declares, and a run stops before the first fork when one is missing; a path that exists but is ignored by git is reported on stderr and recorded as `untrackedFixtures` in the run, because nobody else can reproduce that record. `scripts/bench/fixture-audit.test.mjs` asserts that the whole case list reads only committed files, so a case that would need a local-only input has to be dropped rather than skipped.

## Record a run

Build the workspace first, then choose the budget.

```sh
corepack pnpm build

# Full baseline: every case, three forks, 500 ms per fork.
corepack pnpm bench --mode benchmark --suite all --forks 3 --warmup-ms 100 --time-ms 500 --min-samples 10 --out test-data/bench/runs

# Baseline/candidate pair on one runner, merged per side.
node scripts/bench/ci.mjs --baseline-root . --candidate-root . --out test-data/bench/pairs/2026-11-10 --case perf.igs.battle-royale.parse

# Profiling and memory captures.
corepack pnpm bench --mode cpu --case perf.igs.battle-royale.render --duration-ms 5000 --out test-data/bench/profiles
```

`bench` prints its run directory. A case shorter than the one-millisecond sample target records several calls per timing sample; `callsPerSample` in the record and in the report states the count, and every sample is divided by it, so values stay milliseconds per call.

A case that spawns the CLI measures one child process per call, so its recorded `cpuUsage` covers only the bench parent and is marked `coversSpawnedProcess: false`; read the wall time for those rows. The same applies to `--mode cpu` and `--mode heap`: the profile covers the parent, so profile `apps/cli/dist/index.js` directly when you need attribution inside the CLI.

## Check a record before keeping it

```sh
node -e '
const r = require("./test-data/bench/runs/<runId>/run.json");
const forks = r.rows.flatMap((row) => row.forks);
console.log(r.rows.length, r.skipped.length, r.failures.length, r.samples.count,
  forks.reduce((sum, fork) => sum + fork.stats.sampleCount, 0));
'
```

A keepable record has `schemaVersion` 1, no failures, no `untrackedFixtures`, a reason for every skip, and a `samples.count` that matches the sum of fork `stats.sampleCount`. A record whose run was interrupted before `run.json` appeared, or whose case list is a scratch subset, is not a baseline. A row that drifted by 25% or more between the first and last fifth of its window (marked `!` in reports) is not a stable comparison point; shorten the window or explain the drift before using it as a baseline. A `! gc` mark means the fork recorded garbage collection events inside that window, which is the usual cause of a slow tail.

## Keep what you will compare

- Keep at most two full-suite records per configuration (same Node, build mode, flags, and budgets) to see run-to-run spread; delete older ones.
- Keep scratch runs from `--case` experiments only until the question they answer is settled.
- Keep a record when it is the baseline of an open comparison; delete the pair directory once the comparison is recorded in a review.
- Reports are derived. Rerun `bench:report` rather than editing a rendered file; the command rewrites the target path.

## Render trends

```sh
node scripts/bench/report.mjs test-data/bench/runs --format markdown --out test-data/bench/reports/2026-11-10/trend.md
node scripts/bench/report.mjs test-data/bench/runs --format html --out test-data/bench/reports/2026-11-10/trend.html
```

The trend reads every `run.json` under the given directory, drops the source runs of merged pairs, and groups compatible environments into separate series.

## Related

- [Performance guide](../../docs/guides/performance.md)
- [Performance fixture inputs](../fixtures/perf/README.md)
