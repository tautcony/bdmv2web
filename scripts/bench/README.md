# Benchmark tooling

Layout, entry points, and the naming rules for anything added here. Behaviour is
documented in [`docs/guides/performance.md`](../../docs/guides/performance.md); the
records themselves live in [`test-data/bench/`](../../test-data/bench/README.md).

## Rules for new files

1. **Directory is the role, file name is the subject.** `store/samples.mjs`, not
   `sample-store.mjs` at the root. Pick the directory first; the name follows.
2. **Do not repeat the directory in the file name.** `render/charts.mjs`, never
   `render/render-charts.mjs`. Same for suffixes that restate the folder
   (`store/environment.mjs`, not `environment-record.mjs`).
3. **Tests live next to their subject** as `<subject>.test.mjs`. `pnpm bench:test`
   globs `scripts/bench/**/*.test.mjs`, so no registration step is needed.
4. **A new benchmark case is an edit, not a file.** Add it to `cases/registry.mjs`
   (single-file inputs) or `cases/scenarios.mjs` (prepared inputs). Only a new way of
   *assembling an input* earns a file under `cases/`.
5. **A new measurement mode is two lines.** Add `runner/<mode>.mjs` and register the
   name in `MODES` and in the mode-to-file map in `index.mjs`; that map is the only
   place that knows which runner a mode spawns.
6. **A new command gets its own script.** `commands/<name>.mjs` plus a `package.json`
   script; CI calls the full path. Commands may export functions for their tests.
7. **Nested files compute the repository root as `../../..`**; `index.mjs` uses
   `../..`. Moving a file between the root and a subdirectory means fixing that
   constant, and `index.mjs` resolves every runner through `runnerDir`.

## Layout

| Path | Role | Files |
| --- | --- | --- |
| `index.mjs` | The one default entry: parses options, selects cases, orchestrates forks, writes the run record. `pnpm bench`, and what `ci.mjs` and CI invoke. | `index.mjs` |
| `commands/` | Independent executables, each wired to a `package.json` script or a workflow step. | `build.mjs`, `ci.mjs`, `compare.mjs`, `report.mjs`, `prepare-fixture.mjs` |
| `runner/` | Measurement processes. Every file here also runs standalone; `index.mjs` spawns them by name. | `worker.mjs` (one case per fork), `child.mjs`, `child-observer.mjs`, `browser.mjs`, `memory.mjs`, `profile.mjs`, `batch.mjs` |
| `cases/` | What gets measured and how its input is assembled. | `registry.mjs` (case list, `resolveInput`), `scenarios.mjs` (prepared scenarios), `graphics.mjs`, `fixture-input.mjs`, `padded-clips.mjs`, `fixture-audit.mjs` |
| `render/` | Records to human-readable output; no measurement, no I/O beyond reading. | `html.mjs`, `charts.mjs` |
| `store/` | Record format and identity: the on-disk encoding and the fields that decide whether two records may be compared. | `samples.mjs`, `environment.mjs`, `build-mode.mjs`, `compatibility.mjs` |
| `lib/` | Shared helpers with no benchmark knowledge of their own. | `cli.mjs` (commander helpers), `stats.mjs` (distribution helpers) |

## Entry points

| Command | Entry |
| --- | --- |
| `pnpm bench` | `node scripts/bench/index.mjs` |
| `pnpm bench:test` | `node --test "scripts/bench/**/*.test.mjs"` |
| `pnpm bench:build` | `node scripts/bench/commands/build.mjs` |
| `pnpm bench:compare` | `node scripts/bench/commands/compare.mjs` |
| `pnpm bench:prepare` | `node scripts/bench/commands/prepare-fixture.mjs` |
| `pnpm bench:report` | `node scripts/bench/commands/report.mjs` |
| CI pair run | `node scripts/bench/commands/ci.mjs` (`.github/workflows/performance.yml`) |

## Measurement modes

`index.mjs --mode <mode>` spawns exactly one file, all in `runner/`:

| Mode | Runner | What it captures |
| --- | --- | --- |
| `benchmark` | `worker.mjs` | Timing, memory snapshots, GC events for one case |
| `cpu`, `heap` | `profile.mjs` | V8 CPU profile or heap profile artifacts |
| `memory` | `memory.mjs` | Memory snapshots over a duration |
| `child` | `child.mjs` | GC and memory of the spawned CLI child, via `child-observer.mjs` |
| `browser` | `browser.mjs` | Page navigation, CPU profile, and trace |

## Naming a new file

```
<directory>/<subject>.mjs            store/samples.mjs
<directory>/<subject>.test.mjs       store/samples.test.mjs
```

Subject is a plural noun for a module that owns a collection (`samples`,
`charts`), a singular noun for one concept (`environment`, `compatibility`,
`batch`), and an imperative verb only for a command that does one thing
(`prepare-fixture`). No `misc`, `util`, `helpers`, `common`, or numbered suffixes.
