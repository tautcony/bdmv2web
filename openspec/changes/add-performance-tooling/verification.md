# Verification record

## Completed

- `node --expose-gc --test scripts/bench/*.test.mjs` — 42 tests passed, including the call-count calibration and the normalized samples of a sub-microsecond case.
- `node scripts/bench/index.mjs --list` — 39 cases: 12 component, 9 prepared component, 12 scale, 4 CLI, 1 package assembly, 1 browser.
- `node scripts/bench/index.mjs --suite all --forks 1 --warmup-ms 30 --time-ms 150 --min-samples 3` — all 39 selectable cases wrote rows; only sub-millisecond cases batched calls per sample (`bdmv.sound-synthetic.parse` 1041, `perf.index.small.parse` 831, `bdmv.index-uhd.parse` 260, `scale.rle-1x.decode` 64, `scale.png-1x.encode` 11), and every slower case recorded one call per sample.
- `node scripts/bench/index.mjs --suite all --forks 3 --warmup-ms 100 --time-ms 500 --min-samples 10` — all 39 component, prepared, scale, CLI, package, and browser cases recorded three forks each with no failures and no skips; the record holds 17,241 normalized timing samples in 4.2 MB, and batched cases recorded 948–1,368 calls per sample.
- `node scripts/bench/report.mjs test-data/bench/runs --format markdown|html|json` — one run, 39 series, every column populated (medians, p95, p99, ops/s, CV, outliers).
- `node scripts/bench/index.mjs --case bdmv.sound-synthetic.parse --case bdmv.index-uhd.parse --forks 3 --warmup-ms 100 --time-ms 500 --min-samples 10` — 1516 and 274 calls per sample; per-fork CV 6.6–7.6% and 6.7–8.6% where the unbatched run recorded 256% and 107%; medians 0.000673 ms and 0.003830 ms. A repeat run calibrated 1379 and 271 calls per sample, and `bench:compare` reported both rows as `compared` with 1.0% and 0.17% median change, so a differing count keeps fork medians comparable.
- The same command with `--calls-per-sample 100` recorded 100 in `configuration.callsPerSample`, the row, and the fork, with a 0.000632 ms median.
- `node scripts/bench/index.mjs --mode browser --case browser.synthetic-menu.file-navigation` — Chromium 158.0.8127.18 opened the generated `file://` package, completed the start-menu click plus ArrowRight and Enter, and wrote `navigation.cpuprofile` and `navigation.trace.json`.
- Fixture manifest validation — 9 cases, 44 graph file mappings, every input file exists, every `virtualPath` starts with `BDMV/`, every mapping has `sourcePath`, and the JSON holds no `/mnt/user` prefix.
- `node scripts/bench/index.mjs --case <id> --forks 1 --warmup-ms 0 --time-ms 200 --min-samples 3` for `perf.index.small.parse`, `perf.pgs.baja.parse`, `perf.pgs.baja.compose`, `perf.package.igs-assembly`, `cli.perf.metadata.inspect`, `cli.perf.igs.render`, and `cli.synthetic-package.validate` — each run wrote a record with repo-relative input paths, one fork, one CPU-time interval, memory snapshots, and GC events. `perf.package.igs-assembly` reported 1 scene, 21 pages, 215 objects, 215 assets and adaptation status `partial`. `cli.synthetic-package.validate` reported 10 checks and decision `complete`.
- `node scripts/bench/ci.mjs --baseline-root . --candidate-root . --out /tmp/perf-pair --case scale.rle-1x.decode --warmup-ms 0 --time-ms 20 --min-samples 3` — ran baseline/candidate/candidate/baseline, all four harness runs exited 0, the comparison exited 0, and the summary row reported `improvement-warning` at a two-fork confidence level.
- `node scripts/bench/report.mjs /tmp/perf-pair --format markdown|html|json` — 2 merged records; the 4 source runs drop as superseded; the HTML report embeds SVG with no remote reference. A browser capture reported through the same command lists its CPU profile and trace links.
- `node scripts/bench/profile.mjs --mode heap --case scale.rle-1x.decode --duration-ms 80 --out /tmp/perf-heap`, then `node scripts/bench/report.mjs /tmp/perf-heap --format json` — `profileRunCount` 1 with artifact `profiles/scale.rle-1x.decode.heapprofile`.
- `corepack pnpm lint` — passed.
- `openspec validate add-performance-tooling` — valid.
- Relative Markdown link scan across 71 files under `docs/`, `test-data/fixtures/perf/`, and `test-data/bench/` — 586 links, 0 broken.
- `ruby -ryaml` parsed `.github/workflows/performance.yml`.

## Unverified

- Hosted GitHub Actions execution, including the pull-request pair on `ubuntu-latest`.
- Windows and other non-macOS platforms.
