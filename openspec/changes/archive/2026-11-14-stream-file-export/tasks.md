# Tasks

## 1. Transport probe

- [x] 1.1 Add `probeTransportStreams` in `packages/igs/src/transport/probe.ts` scanning the whole input for the first PMT section's declarations and passing through all transport diagnostics; export it from the package barrel and verify the igs package suite passes.
- [x] 1.2 Add probe unit tests covering PMT discovery for 0x90/0x91, reserved-PID declarations, PMT CRC rejection with the declaration snapshot retained, and PSI/transport diagnostics propagation.

## 2. CLI stream input

- [x] 2.1 Add `apps/cli/src/shared/stream-input.ts` with input classification (`.m2ts`/`.rsks` file → stream mode) and graphics stream discovery with reserved-PID filtering and `EXPORT_INVALID_STREAM` on incomplete PSI; add unit tests beside the module.
- [x] 2.2 Split `export.ts` into a dispatch entry plus `exportAssetsFromBdmv` and add the stream-mode branch (mnu via `extractIgsFromChunks`, sup via `extractPgsTracks`, preserved timestamps, `und` language records); update the `export` argument description in `program.ts` and verify existing BDMV export integration tests pass unchanged.

## 3. Integration coverage

- [x] 3.1 Add a synthetic m2ts builder in `apps/cli/tests/helpers/` (PAT/PMT/PES framing plus minimal PGS display-set segments).
- [x] 3.2 Add `tests/integration/export-stream.test.ts`: sup extraction from a `.rsks`-suffixed synthetic stream with source timestamps, trailing-junk tolerance with `partial` status, zero-asset warning path, `CLI_EXPORT_SELECTION` rejections, and `EXPORT_INVALID_STREAM` failure.

## 4. Docs and evidence

- [x] 4.1 Update `docs/llm-wiki/features/cli-commands.md`, `docs/llm-wiki/packages/cli.md`, and `docs/guides/development.md` for stream-file input, naming, timestamp rules, and the new failure codes; verify documented flags match `program.ts`.
- [x] 4.2 Run workspace suites (vitest, typecheck, lint) and the real `.rsks` manual verification; record commands and results in the change verification record as environment-specific evidence.

## Completed evidence notes

Implementation notes that differ from the first design draft:

- The probe scans the whole input instead of stopping after the first complete PAT/PMT set. Trailing `partial` evidence (the rsks private trailer) only exists at EOF, and the first PMT section's declarations are snapshotted into a `Map` before later PSI damage can clear the live assembler state, so the scan is still cheap per byte and loses nothing.
- The CLI passes the probe-declared IGS PIDs to `extractIgsFromChunks` as structural cues. Cue-less input plus discovered streams is read as an `IGS_PID_CONFLICT`, so the probe result replaces the MPLS/CLPI cue that a BDMV disc would supply.
- Stream mode opens the output transaction on the resolved `--out` without `assertDisjointRoots`: a single stream file is read-only input with no disc root to protect, and exporting to a directory next to the stream is the normal case (the same pattern `render` uses for standalone SUP output). `TARGET_EXISTS` still blocks an existing target.

Verification run on 2026-11-14 (macOS, Node 24.18.0):

- 1.1/1.2 — `packages/igs`: `npx vitest run` → 11 files, 90 tests passed. `probe.test.ts` covers the 0x90/0x91 declaration set, the reserved-PID entry kept in the probe but dropped by discovery, a CRC-invalid PMT that still yields declarations plus `PSI_CRC_INVALID`, trailing garbage producing `TS_SYNC_LOST`, and a later-damage case where the first snapshot survives.
- 2.1/2.2 — `apps/cli`: `npx vitest run` → 21 files, 145 tests passed, including the unchanged BDMV export cases in `cli-commands.test.ts` and the four `stream-input.test.ts` cases.
- 3.1/3.2 — `export-stream.test.ts` → 9 tests passed: SUP from a `.rsks`-named synthetic stream with `pts90k` `[1000000, 1090000]` preserved, trailing junk with `stageStatus: "partial"` and exit 0, `.mnu` + PNG from the IGS fixture, display-set PNG seconds relative to the first set, `--type igs` writing no SUP when the stream declares both graphics types, zero-asset warning path, both `CLI_EXPORT_SELECTION` rejections, and two `EXPORT_INVALID_STREAM` cases that leave no output directory. The `--type igs` case fails against an ungated PGS write, so it pins the selection contract rather than restating the happy path.
- 2.2 BDMV regression — `export test-data/fixtures/synthetic-all-features/BDMV --out /tmp/bdmv-new --type all --render` on this branch and the same command with `export.ts` reverted to `HEAD` both reported `{"stageStatus":"complete","assetCount":15}`, and `diff -r /tmp/bdmv-old /tmp/bdmv-new` was empty (16 files).
- 4.2 typecheck — `corepack pnpm -r typecheck`: every package passes except `@bdmv2web/hdmv`, which fails on `HEAD` with `src/virtual-machine/vm.ts(991,450): error TS2339: Property 'registers' does not exist ...`. That file is untouched by this change.
- 4.2 lint — `npx eslint` over the ten touched or added files: clean.

Environment-specific evidence (real disc data, not committed; `test-data/fixtures/sup/` is gitignored because the samples are 6–55 MiB disc content):

- `export test-data/fixtures/sup/Hyouka_01/00005.SumiSora.sc.rsks --out /tmp/sup-out --type sup` → `{"stageStatus":"partial","assetCount":1}`, manifest `assets/subtitles/00005.SumiSora.sc-pid-1200.sup`, `language: "und"`, `streamNumber: 1`, `displaySetCount: 216`. `partial` comes from the private trailer (`TS_SYNC_LOST`, `TS_TRUNCATED_PACKET`) plus the sample's `PSI_CRC_INVALID` warning; the PMT still yields `0x1200:0x90` (its fake `0x0:0x81` entry is filtered as a reserved PID).
- Timeline fidelity — the exported SUP's first PTS is `683730000` (7597.000 s) and its last is 7782.060 s. `ffprobe -select_streams s -show_entries packet=pts_time` on the source and on the SUP produce the same 215 distinct timestamps (`diff` empty), so the 90 kHz timeline is preserved with no rebasing. The design draft's "first PTS ≈ 1631.6 s" guess does not match this file; ffprobe agrees with the extractor, not the draft.
- `--render` on the same stream → 181 `sup-png` entries for 216 display sets (35 clear sets stay unwritten, as documented), all 1920×1080, first entry `startSeconds: 0`. `assets/subtitles/00005.SumiSora.sc-pid-1200-und-display-00020.png` shows the bottom-centred 「宣传影像」 caption, matching the sample analysis this change started from.
- `export test-data/fixtures/sup/Hyouka_01/00012.m2ts --out /tmp/m2ts-out --type all` (a real BD clip whose PMT declares only `0x1011:0x1b` video) → `{"stageStatus":"complete","assetCount":0}`, exit 0, empty manifest: the zero-asset warning path.
