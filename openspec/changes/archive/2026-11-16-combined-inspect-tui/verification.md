# Verification — 2026-11-16

## Implemented behavior

- `inspect` and its `list` alias use one structural parse and one existing-scope graphics extraction per invocation. The parser input table is reused; extraction measures payload bytes with PNG rendering disabled.
- Interactive collection runs in a worker. Development source workers use the TSX ESM API with the CLI development tsconfig; emitted and bundled commands use the JavaScript worker shipped in `dist`.
- Navigation objects, commands, playlists and clips are indexed by ID. Edges refer to targets; conditional paths and loops share records.
- Ink renders layered tables and domain detail sections. The detail projection exposes navigation targets, decoded commands and outgoing references, playlist duration/marks, PlayItem declarations, M2TS availability and scan state, payload measurements, CLPI streams, and graphics metadata.
- Text/JSON outputs and explicit output files share the combined data. JSON generation is limited to JSON stdout or explicit `--out`. Payload measurements use objects keyed by clip ID and decimal PID.

## Automated verification

- `corepack pnpm --filter bdmv2web test`: **34 files, 213 tests passed**.
- `corepack pnpm --filter bdmv2web typecheck`: passed.
- Type-aware ESLint on changed CLI implementation and integration tests: passed.
- `corepack pnpm --filter bdmv2web build`: passed.
- `corepack pnpm bundle:cli`: passed, including the separate collection worker.
- Collection regression checks one parse, one extraction, reuse of the same input table, and repeated browser indexing from the collected result.
- Browser model regression includes 1,000 conditional commands and asserts bounded target count. A separate manual 10,000-condition probe completed under a 256 MiB V8 heap limit.
- Structured detail tests cover entry target/provenance, playlist timeline, decoded command/outgoing references, missing media with available declarations, and structural coverage with an IGS SubPath target.

## Terminal verification

Observed locally on macOS with Node 24.18.0 and Node 22.23.5. These observations are environment-specific evidence.

- Re-ran the user's exact command: `corepack pnpm cli:dev inspect test-data/bdmv/tamako-love-story-bd`.
- The command completed collection and entered the browser. The indexed model opened MovieObject 0 with 2,162 commands, without the reported 4 GiB heap failure.
- In a 160-column terminal, selected `title:0` and observed labeled navigation fields: MovieObject 8, 228 commands, direct static MPLS target 00042, and index source provenance.
- Followed `title:0 → MovieObject 8 → Command 218 → play → MPLS 00042 → PlayItem 0 → M2TS 00006`. Playlist, interval, command, file-state, CLPI and reference details rendered as labeled sections. Missing media was reported separately from declarations and unavailable measurements.
- Returned to Command 218 and confirmed its filter and selected row were restored. `q` exited cleanly.
- The same input also entered the bundled browser. An earlier same-input session measured peak RSS of 313,704,448 bytes in the bundled command and 414,023,680 bytes in `cli:dev`; these are observed RSS values, not V8 heap measurements or universal budgets.
- Node 22.23.5 loaded the final bundled TUI at 80 columns. A temporary synthetic transport input with controlled read delay exercised collection for multiple seconds: the spinner changed and elapsed time advanced through 0s, 1s and 2s before entering the structured browser. The run used a 256 MiB V8 heap limit. Temporary test hooks and generated transport data were outside the repository and release output.

## Final UI scope clarification

- Metadata displays parsed disc application, UHD and META records.
- A present M2TS without a payload measurement is labeled `structure-only`. Its detail pane explains coverage and shows related IGS SubPath clips.
- For the supplied input, `00004` declares video/audio/PGS and refers to IGS PID 0x1400 through SubPath 0 / SubClip 0 to `00005`. The collected payload map contains `00005`; the two `00004` SUP references are declarations.

## Limits of evidence

The supplied input retains its existing partial structural/graphics diagnostics and missing-source states. The navigation checks cover declared/static paths; dynamic playback was not executed. CI and other operating systems were not run in this session.
