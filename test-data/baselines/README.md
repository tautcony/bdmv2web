# Test baselines

Reference outputs read directly by the test suite. No test needs libbluray or igstools at run time.

| File | Produced by | Read by |
| --- | --- | --- |
| `libbluray-1.5.0-igs-baseline.json` | `scripts/generate-libbluray-baselines.py` against libbluray 1.5.0 revision `d75c88e` (`graphics_processor_decode_ts`) | `packages/igs/tests/integration/libbluray-igs-baseline.test.ts` |
| `libbluray-1.5.0-navigation-baseline.json` | `scripts/generate-libbluray-baselines.py` against libbluray 1.5.0 revision `d75c88e` (`bd_info`, `bd_list_titles -a`, `mobj_dump -d`, `bd_play`) | `apps/cli/tests/integration/libbluray-navigation-baseline.test.ts`, `packages/runtime-web/tests/integration/hdmv-navigation-corpus-dfs.test.ts` |
| `igs-reference-element-summary.json` | `SAPikachu/igstools` @ `34a13315` `picture_to_png` over the checked-in IG packet fixtures, rendered by `scripts/compare-igstools-reference.py` and summarized by `scripts/summarize-igstools-references.py` | `packages/igs/tests/integration/igs-reference-element-summary.test.ts` |

Each file keeps its two outer levels expanded and every deeper value compact, so one `cases` entry occupies exactly one line. `scripts/generate-libbluray-baselines.py` writes that shape; hand edits keep the same shape so a regenerated baseline diffs per case.

The navigation baseline covers the four `disc-data` cases plus `synthetic-all-features`, whose disc root is `test-data/fixtures/synthetic-all-features`. The IGS baseline reads the checked-in IG packet sidecars, the `synthetic-igs-parser` fixture, and the `synthetic-all-features` `00002` sidecar. Clip `00001` stays out: the pinned igstools revision reads effect-object descriptors as window(u16) instead of window(u8) + forced-on(u8), so any nonempty effect sequence raises KeyError, and clip `00001` is the first fixture carrying effects (recorded in docs/references/stages/M2-igs-scenes.md).

Regenerating the libbluray files needs a local libbluray 1.5.0 install and the pinned source under `.reference-cache/repositories/`. Regenerating the igstools summary needs an igstools checkout, the reference PNGs under `.reference-cache/verification/`, and Pillow for `scripts/compare-igstools-reference.py` and `scripts/summarize-igstools-references.py` (a venv under `.reference-cache/venv` works; both scripts run with `PYTHONPATH=.reference-cache/repositories/igstools-2019`).
