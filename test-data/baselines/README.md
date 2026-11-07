# Test baselines

Reference outputs read directly by the test suite. No test needs libbluray or igstools at run time.

| File | Produced by | Read by |
| --- | --- | --- |
| `libbluray-1.5.0-igs-baseline.json` | `scripts/generate-libbluray-baselines.py` against libbluray 1.5.0 revision `d75c88e` (`graphics_processor_decode_ts`) | `packages/igs/test/libbluray-igs-baseline.test.ts` |
| `libbluray-1.5.0-navigation-baseline.json` | `scripts/generate-libbluray-baselines.py` against libbluray 1.5.0 revision `d75c88e` (`bd_info`, `bd_list_titles -a`, `mobj_dump -d`, `bd_play`) | `apps/cli/src/libbluray-navigation-baseline.test.ts`, `packages/runtime-web/src/hdmv-navigation-corpus-dfs.test.ts` |
| `igs-reference-element-summary.json` | `SAPikachu/igstools` @ `34a13315` `picture_to_png` over the checked-in IG packet fixtures | `packages/igs/test/igs-reference-element-summary.test.ts` |

Each file keeps its two outer levels expanded and every deeper value compact, so one `cases` entry occupies exactly one line. `scripts/generate-libbluray-baselines.py` writes that shape; hand edits keep the same shape so a regenerated baseline diffs per case.

Regenerating the libbluray files needs a local libbluray 1.5.0 install and the pinned source under `.reference-cache/repositories/`. Regenerating the igstools summary needs an igstools checkout and the reference PNGs under `.reference-cache/verification/`.
