# Verification record

## Completed

- `node --expose-gc --test scripts/bench/*.test.mjs` — 43 tests passed, including the call-count calibration, the normalized samples of a sub-microsecond case, and the window-drift calculation.
- `node scripts/bench/index.mjs --list` — 40 cases: 12 component, 9 prepared component, 12 scale, 5 CLI, 1 package assembly, 1 browser.
- `node scripts/bench/index.mjs --suite all --forks 1 --warmup-ms 30 --time-ms 150 --min-samples 3` — all 40 selectable cases wrote rows; only sub-millisecond cases batched calls per sample (`bdmv.sound-synthetic.parse` 1041, `perf.index.small.parse` 831, `bdmv.index-uhd.parse` 260, `scale.rle-1x.decode` 64, `scale.png-1x.encode` 11), and every slower case recorded one call per sample.
- `node scripts/bench/index.mjs --suite all --forks 3 --warmup-ms 100 --time-ms 500 --min-samples 10` — all 40 component, prepared, scale, CLI, package, and browser cases recorded three forks each with no failures and no skips; the record holds 19,664 normalized timing samples in 2.1 MB, and batched cases recorded 271–1,181 calls per sample. Thirteen rows reported window drift of 25% or more and are marked `!` in the report.
- `node scripts/bench/report.mjs test-data/bench/runs --format markdown|html|json` — one run, 40 series, every column populated (medians, p95, p99, ops/s, CV, outliers, drift).
- `node scripts/bench/index.mjs --case bdmv.sound-synthetic.parse --case bdmv.index-uhd.parse --forks 3 --warmup-ms 100 --time-ms 500 --min-samples 10` — 1516 and 274 calls per sample; per-fork CV 6.6–7.6% and 6.7–8.6% where the unbatched run recorded 256% and 107%; medians 0.000673 ms and 0.003830 ms. A repeat run calibrated 1379 and 271 calls per sample, and `bench:compare` reported both rows as `compared` with 1.0% and 0.17% median change, so a differing count keeps fork medians comparable.
- The same command with `--calls-per-sample 100` recorded 100 in `configuration.callsPerSample`, the row, and the fork, with a 0.000632 ms median.
- `node scripts/bench/index.mjs --mode browser --case browser.synthetic-menu.file-navigation` — Chromium 158.0.8127.18 opened the generated `file://` package, completed the start-menu click plus ArrowRight and Enter, and wrote `navigation.cpuprofile` and `navigation.trace.json`.
- Fixture manifest validation — 9 cases, 44 graph file mappings, every input file exists, every `virtualPath` starts with `BDMV/`, every mapping has `sourcePath`, and the JSON holds no `/mnt/user` prefix.
- `node scripts/bench/index.mjs --case <id> --forks 1 --warmup-ms 0 --time-ms 200 --min-samples 3` for `perf.index.small.parse`, `perf.pgs.baja.parse`, `perf.pgs.baja.compose`, `perf.package.igs-assembly`, `cli.perf.metadata.inspect`, `cli.perf.igs.render`, and `cli.synthetic-package.validate` — each run wrote a record with repo-relative input paths, one fork, one CPU-time interval, memory snapshots, and GC events. `perf.package.igs-assembly` reported 1 scene, 21 pages, 215 objects, 215 assets and adaptation status `partial`. `cli.synthetic-package.validate` reported 10 checks and decision `complete`.
- `node scripts/bench/ci.mjs --baseline-root . --candidate-root . --out /tmp/perf-pair --case scale.rle-1x.decode --warmup-ms 0 --time-ms 20 --min-samples 3` — ran baseline/candidate/candidate/baseline, all four harness runs exited 0, the comparison exited 0, and the summary row reported `improvement-warning` at a two-fork confidence level.
- `node scripts/bench/report.mjs /tmp/perf-pair --format markdown|html|json` — 2 merged records; the 4 source runs drop as superseded; the HTML report embeds SVG with no remote reference. A browser capture reported through the same command lists its CPU profile and trace links.
- `node scripts/bench/profile.mjs --mode heap --case scale.rle-1x.decode --duration-ms 80 --out /tmp/perf-heap`, then `node scripts/bench/report.mjs /tmp/perf-heap --format json` — `profileRunCount` 1 with artifact `profiles/scale.rle-1x.decode.heapprofile`.
- Hot-spot pass on the 2026-11-09 profile: `parseClpi` now walks the coarse CPI entries with a cursor instead of rescanning them for every fine entry, and `buildGraph` resolves objects, clips, and files through maps instead of linear searches. Both keep byte-identical output (15,322 CPI entries hash to `b91a45e0`; 493 nodes and 881 edges hash to `a2c74a56`). On the same fixtures, `perf.clipinfo.cpi-heavy.parse` went 180.4 → 1.94 ms and `perf.graph.tamako.build` 18.9 → 2.05 ms at three forks.
- `scale.pes-{1,2,4}x.extract` now times transport scanning and scene extraction without asset rendering: 36.1, 73.1, and 145.4 ms, doubling with the transport size. Rendering keeps its own case, `perf.igs.battle-royale.render` at 277.6 ms.
- CLI command modules load on first use, and the entry point imports `ContractError` from `@bdmv2web/core/contract-error`, so `--version` no longer loads every command: 895 → 123 ms median over five child processes. `cli.startup.version` records that 123 ms as its own case, and `cli.perf.igs.render` measures 2305 ms end to end, so a command's own cost is the difference between the two.
- `corepack pnpm lint` — passed.
- `openspec validate add-performance-tooling` — valid.
- Relative Markdown link scan across 71 files under `docs/`, `test-data/fixtures/perf/`, and `test-data/bench/` — 586 links, 0 broken.
- `ruby -ryaml` parsed `.github/workflows/performance.yml`.

## Unverified

- Hosted GitHub Actions execution, including the pull-request pair on `ubuntu-latest`.
- Windows and other non-macOS platforms.
