# Development

## Pinned toolchain

- Node.js: `24.18.0` (`.node-version`; supported engine range is `>=24.18.0`).
- pnpm: `11.25.0` (`packageManager` in the root `package.json`), selected through `corepack pnpm`. A globally installed `pnpm` is not required.
- TypeScript: `5.9.3`.
- Vitest: `4.0.8`.
- esbuild: `0.25.12`.
- JSON Schema to TypeScript: `15.0.4`; Ajv: `8.17.1`.
- ESLint: `10.14.0` with `typescript-eslint` `8.72.1`.

Repository scripts are grouped by role under `scripts/`; see the [scripts guide](../../scripts/README.md) for entry points and the folder layout.

Install and run the reproducible workspace entry points:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm generate:contracts
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:coverage
```

`corepack pnpm typecheck` builds workspace dependency declarations first. The browser core is emitted as an ES2020 IIFE at `packages/core/dist/browser.js`; its build script inspects bundled imports and rejects Node built-ins. `packages/runtime-web` emits the menu runtime as an ES2020 IIFE at `packages/runtime-web/dist/browser.bundle.js` through `scripts/build/runtime-browser.mjs`; packaging reads that file. `@bdmv2web/core` uses the same schema for JSON validation and generated TypeScript types. `@bdmv2web/bdmv-io` handles disc input and output transactions. Node filesystem utilities are available from `@bdmv2web/utils/node-fs`.

## Architecture boundaries

Keep the workspace dependency direction one-way: `core`/`utils` → `bdmv-io` → `bdmv-parser` → `hdmv`/`igs` → `media-export` → `package-builder` → `bdmv2web`. `runtime-web` consumes `core`, `bdmv-parser`, `hdmv`, `igs` and `utils`; its `media-export` entry is a devDependency for integration tests.

| Concern | Owner |
| --- | --- |
| Shared contracts: DiscIR, playback targets, runtime data shapes | `packages/core` |
| Menu media encoding, media path naming, reuse | `packages/media-export` (`exportMenuMedia()`, `menu-media-layout.ts`) |
| Static package assembly | `packages/package-builder` (`assembleMenuPackage()`) |
| Build orchestration | `apps/cli/src/application` (`planBuild()`, `buildUseCase()`) |
| Build result publication (stdout JSON and exit code) | `apps/cli/src/commands/build-outcome.ts` (`publishBuildOutcome()`) |
| Delivery status | `packages/test-runner/src/decisions.ts` (`decideDelivery()`) |
| local-jvm HDMV state and actions | `apps/cli/src/commands/serve.ts` (`HdmvSession`) → `hdmv-update` |
| `asset-manifest.json` in local-jvm packages | `runtime-index`: listed in `manifest.files` and JSON-parseable |

A `file://` menu uses `LocalNavigationHost` and a page VM. A `local-jvm` menu uses `RemoteNavigationHost`: the service owns the VM, `hdmv-update` carries the snapshot and actions, the page stores that snapshot, and the service performs all PSR/GPR writes. Package assembly consumes `PreparedMenuMedia` produced by `exportMenuMedia()`, and `assembleMenuPackage()` writes the static package. The detailed current-state design is in `docs/llm-wiki/architecture.md`; the shared contracts are in `docs/llm-wiki/contracts.md`.

## Linting

`corepack pnpm lint` runs ESLint over `apps/*/src`, `packages/*/src`, `apps/*/tests`, `packages/*/tests`, `vitest.config.ts`, and `scripts/**/*.mjs`, then runs `lint:java`, which checks the BD-J host Java sources in `packages/runtime-web/bdj-host/src` with Checkstyle and compiles them to a Java 8 target with `javac --release 8` (JDK 21 or newer required). `corepack pnpm lint:fix` applies the automatic ESLint fixes.

Linting is type-aware. `eslint.config.mjs` parses linted TypeScript through `tsconfig.lint.json`, which spans every linted file, and workspace imports resolve through each package's `dist` declarations. `corepack pnpm lint` and the `test` scripts run `scripts/build/ensure-workspace.mjs`, which builds the workspace once when those artifacts are missing. `scripts/ci.sh` builds first and runs lint as a parallel lane beside the typecheck and the test suites.

`eslint.config.mjs` encodes the style the sources use: double quotes, semicolons, trailing commas, dense single-line declarations, non-null assertions after bounds checks, and terse `condition && call()` / `error ? reject() : resolve()` statements. No formatter runs in this workspace, and ESLint 10 ships no formatting rules.

The configuration reports zero problems on the current sources. Every enabled rule is at `error` severity; the allowances are limited to the constructs the sources rely on:

| Allowance | Scope |
| --- | --- |
| `no-non-null-assertion: off` | Parsers assert non-null after an explicit bounds check. |
| `no-unused-expressions` with `allowShortCircuit` / `allowTernary` | VM, IGS, and runtime sources chain side effects in single statements. |
| `restrict-template-expressions` allows numbers, booleans, nullish, regexps, and `never` | Diagnostic messages interpolate opcodes, PCs, register values, and exhaustive-switch operands. |
| `no-console: off`, `no-this-alias` with `allowedNames: ["active"]` | CLI progress output and the module-level active-reporter registry. |
| `require-await: off` | Renderers and adapters expose sync or fire-and-forget seams. |

`*.test.ts` files turn off `no-explicit-any`, the `no-unsafe-*` family, `unbound-method`, `restrict-template-expressions`, and `no-control-regex`: they assert on JSON parsed from CLI output, pass bound methods to vitest matchers, and match ANSI escapes verbatim.

One inline disable sits in `packages/runtime-web/src/browser.ts`: the Start-menu click listener returns its completion promise, and the browser test host awaits that promise.

## Contracts

`packages/core/schema/disc-ir.schema.json` is the DiscIR source schema. `PlayerProfile` fields are `menuLanguage`, `audioLanguage`, `subtitleLanguage`, `country`, `region`, `outputProfile`, `videoProfiles`, and `audioProfiles`. Defaults are `eng`, `eng`, `eng`, `US`, `A`, and `portable`; output capability lists default to empty. Limits and defaults are in `packages/core/src/index.ts`:

| Limit | Default |
| --- | ---: |
| `maxReadWindowBytes` | 8 MiB |
| `maxSegmentBytes` | 16 MiB |
| `maxReassemblyBytes` | 64 MiB aggregate |
| `maxObjectPixels` | 16,777,216 |
| `maxInstructionsPerTurn` | 10,000 |
| `maxQueueDepth` | 1,024 |
| `maxCallDepth` | 128 |
| `maxExplorationStates` | 100,000 |
| `maxOutputBytes` | `null` |

`@bdmv2web/hdmv` derives its default instruction, queue, and call settings from `DEFAULT_LIMITS`. `maxCallDepth` is currently a CALL enable switch: values below 1 reject `CALL_OBJECT` and `CALL_TITLE`, while positive values do not enforce a nested call-depth limit. `build --limits FILE` validates a JSON `Limits` object and applies it to the conversion-time and packaged HDMV VMs. The VM options are visible on each trace entry. `build` does not yet pass the other fields to BDMV parsing, IGS extraction, or media export.

Use `allocateBoundedBytes` or `checkedObjectPixels` before allocating according to these limits. `readFileChunks` enforces `maxReadWindowBytes` on each stream window.

## Parsing tolerance

A field length or value that cannot be confirmed against the reference implementation defaults to a diagnostic, never to "this whole block is unusable". Concretely:

- Only the main INDX section (First Play / Top Menu / titles) is critical. AppInfo and the 3.1 UHD extension are optional: a failed parse yields `null` plus a `warning`, and navigation still parses.
- Declared section lengths are consistency hints. Entry and payload bounds are checked against the file length, matching libbluray's `bits->end`; a mismatch is recorded as `BDMV_DECLARED_LENGTH_MISMATCH`.
- CLPI `sequenceInfo` / TS-type length fields that do not fit the file downgrade to a warning; the ATC/STC counts still bound the read.
- Tolerance is not "no checks": a read that leaves the file still fails with `BDMV_INVALID_COUNT` / `BDMV_INVALID_SECTION`, and a section never continues into its neighbour.

## CLI status

`inspect`, `export`, `render`, `build`, `validate`, `compare`, `serve`, and `visualize` are implemented; `list` is an alias of `inspect`, and `convert` is an alias of `build`. Commands, options, and dispatch are handled by `commander`; run `bdmv2web --help` for the current surface and `bdmv2web --version` for the package version. Progress output is headed `bdmv2web build`.

| Command | Behavior | Exit codes |
| --- | --- | --- |
| `inspect INPUT [--type all\|igs\|sup] [--m2ts CLIP_ID] [--pid PID] [--format table\|json] [--out FILE]` | A terminal opens the interactive structure and graphics browser after collection. A pipe or `--format table` prints the combined text report. `--format json` prints the combined JSON report; `--out` writes that same JSON while stdout keeps its selected mode. The output file must be new. | structure or graphics `failed` → 1; `complete`/`partial` → 0 |
| `inspect INPUT --allow-partial` | Keeps available data and independent structure/graphics stage states, including a failed structural result. | 0 |
| `list INPUT [OPTIONS]` | Alias of `inspect`, with the same TUI, text, JSON, selection options, and output file. | same as `inspect` |
| `export INPUT --out DIR [--type all\|metadata\|hdmv\|igs\|sup] [--metadata-only] [--m2ts CLIP_ID] [--pid PID] [--render] [--png-level 0-9] [--format table\|json] [--progress\|--no-progress]` | Exports igstools-compatible IGS `.mnu` files and/or reachable SUP tracks. `export`'s `--type` names outputs: `igs`/`sup` write those containers (plus their PNGs with `--render`), `hdmv` writes the command table and source map, `metadata` writes `manifest.json`, `hdmv/*.json`, `igs/*.json` and `sup/tracks.json`, and `all` writes every output. Without `--type` the containers are written. `INPUT` may be a single `.m2ts`/`.rsks` stream file: the declared PMT streams (`0x90` PGS, `0x91` IGS, reserved PIDs ignored) become the export set, assets are named after the file stem, and the SUP keeps the source 90 kHz timeline. Inputs are classified by content first (transport sync bytes, IGS `ICS`/`PDS`/`ODS` tags, PGS `PG` tag) and by extension second, so a renamed stream still reads as a stream. A `.mnu`/`.sup` input has nothing to export and fails with `CLI_EXPORT_SELECTION`, which names `render` instead. `--render` also writes PNG images for IGS elements and SUP display sets; display-set canvases compress on the libuv threadpool. `--metadata-only` writes only structural metadata: alone the whole set, with `--type igs` or `--type sup` that section only, and it conflicts with `--render` (`CLI_EXPORT_SELECTION`). `--type metadata` and `--type hdmv` reject `--render`. Invalid `--type` values are rejected by Commander with `CLI_INVALID_ARGUMENT`. `assets-manifest.json` records type, format, path, size, subtitle metadata, element identity, and display-set start/end time; a metadata-only run writes none. Transparent display sets are omitted. Progress follows `build`: a live step line on a terminal, silence when piped, one line per step plus every 10% with `--progress`. `--m2ts` and an undeclared `--pid` fail with `CLI_EXPORT_SELECTION`; a file without PAT/PMT fails with `EXPORT_INVALID_STREAM`. | 0, 1 when failed |
| `render INPUT --out DIR [--type all\|igs\|sup] [--m2ts CLIP_ID] [--pid PID] [--language LANG] [--png-level 0-9] [--format table\|json] [--progress\|--no-progress]` | Renders IGS element and SUP display-set PNGs from a BDMV disc, a `.m2ts`/`.rsks` stream file, or a standalone `.mnu`/`.sup` file, into `assets-manifest.json`, without writing `.mnu`/`.sup`. The input kind comes from the file itself; `--type` and `--m2ts` apply only to a disc or stream input, `--pid` also sets the IGS scene identity of a standalone MNU, and `--language` applies only to a standalone SUP. Mismatched combinations report `CLI_RENDER_SELECTION`. For BDMV and stream input it runs the same pipeline as `export --render`: identical PNG bytes, paths, manifest records and progress steps; the manifest equals the `igs-png`/`sup-png` subset of the `export --render` manifest for the same input. Stream-input failures stay `EXPORT_INVALID_STREAM`. | 0, 1 when failed |
| `build INPUT [--out DIR] [--title NAME] [--player-profile FILE] [--limits FILE] [--disc-id HEX] [--overwrite] [--no-reuse] [--resume] [--resume-dir <dir>] [--crf N] [--preset NAME] [--codec hevc\|h264] [--hdr tonemap\|preserve] [--video encode\|copy] [--menu-media auto\|all\|none] [--progress\|--no-progress]` | Produces the menu package. BD-J packages contain the host JAR, application JARs, authored resources and service launch data. Start them with `bdmv2web serve`; use Java 21 or a compatible runtime with `java.desktop`. | delivery `complete`/`partial` → 0, `failed` → 1 |
| `serve [DIR] [--port PORT] [--java EXECUTABLE] [--disc-id HEX] [--player system] [--player-executable PATH]` | Serves the package on loopback HTTP, manages the native Java process for BD-J sessions, and launches feature requests through the system player adapter. The executable override receives the media path. | 0 until stopped; 1 when the server cannot start |
| `visualize INPUT [--out DIR] [--programs IDS] [--max-blocks N] [--no-closure] [--overwrite] [--format table\|json]` | Exports the navigation graph as an interactive viewer (`index.html`, `graph.json`), a mermaid overview (`overview.md`), and per-program diagrams under `programs/`. `--no-closure` skips IGS extraction and omits playlist reachability. `--programs` filters the per-program diagrams. | 0, 1 when failed |
| `compare INPUT --actual FILE [--reference FILE] [--reference-tool NAME] [--reference-version VERSION] [--out FILE] [--format json]` | Compares an actual VM trace against an independent reference trace and prints the report JSON; `--out` writes it to a file. `--reference` must be a different file from `--actual`. | `pass` → 0, divergence/input error → 1, `not-verified` → 2 |
| `validate DIR [--format json]` | Re-runs the package audit and rewrites `dependency-audit.json`, `reports.json`, and `reports/release-summary.json` from one summary. | 0, 1 when failed |

`inspect` reports independent `stageStatus.structure` and `stageStatus.graphics` values. `export` and `render` report a single `stageStatus` (`complete`/`partial`/`failed`); `build` and `validate` report a delivery `status`. A structural failure returned before a combined inspection result uses the CLI failure object with `stageStatus: "failed"` and its diagnostic code.

The combined inspector collects structure once and runs the existing graphics extraction once with payload measurement and PNG rendering disabled. It reuses the parser input table. File sizes and reachable SUP references are collected before browsing; every page uses the in-memory result. Interactive collection runs in a worker thread so terminal animation and elapsed time remain responsive. Navigation targets use indexed references, including cycles and conditional branches. In the M2TS section, open a clip and an IGS scene, then press Space on an image element to show or hide its preview beside the list. Up/Down selects another image while the preview stays open; Left/Right selects another scene palette. The preview uses the scene's referenced palette where available. iTerm2 and Kitty graphics compatible terminals (Kitty, Ghostty, WezTerm, Warp, and Otty) display the image; other terminals show its dimensions and palette information. The preview uses terminal capability heuristics and is disabled inside tmux and screen. PNG encoding happens on demand and does not write files.

The Ink/React TUI provides Navigation, MPLS, M2TS, Metadata, and Diagnostics entries, a current-location path, a selection table, and a structured detail pane. The selected object determines the detail sections: navigation targets and references, playlist intervals and marks, decoded commands and outgoing edges, media file state and payload measurements, CLPI stream declarations, or IGS/SUP asset metadata. Source locations appear in a dedicated section. Wide terminals place details beside the table; narrow terminals place them below it. Up/down selects a row, Enter opens its children or referenced target, Escape returns to the previous selection, left/right switches top-level entries, `/` filters the current table, `d` toggles details, Page Up/Page Down scrolls details, `?` shows help, and `q` exits. MPLS uses filename order, PlayItems use declared index order, and navigation shows declared or statically resolved targets with their conditions and unknown states.

The `--format table` report has disc, navigation, playlist directory, playlist detail, mark, CLPI clip mark, graphics asset, and diagnostic sections. The disc name and language come from `META/DL`; UHD and disc application fields come from `index.bdmv`. Navigation entries come from `index.bdmv`, and movie objects come from `MovieObject.bdmv`. Playlist, PlayItem, angle, and stream declarations come from MPLS. CLPI program streams and clip marks are shown separately with their CLPI source. Source paths are relative to the BDMV root, and source offsets are byte offsets rendered as decimal text. MPLS IN/OUT values and marks use 45 kHz ticks; CLPI clip mark PTS values use 90 kHz ticks. Displayed times use `HH:MM:SS.mmm` and truncate to milliseconds. A playlist duration is the sum of its valid PlayItem intervals; it displays `unknown` when an interval is invalid. Missing fields and unavailable chapter times display `unknown`; empty collections display `none`. Stream rows contain declared category, PID, coding type, and language. The report describes parsed structure and timestamps; it contains no measured bitrate or playback result.

Structural section of the text report:

```text
BDMV inspection (structural analysis; stage partial)
Disc: eng: Example Film (META/DL/bdmt_eng.xml @ 0 (primary)) | UHD: yes
Disc source: index.bdmv @ 96 (primary)
Disc application: content exists yes, initial output mode yes, dynamic range type 1, video format code 6, frame-rate code 1 (index.bdmv @ 48 (primary))

Navigation entries:
  firstPlay firstPlay:0 → HDMV 0 (index.bdmv @ 64 (primary))
Movie objects: 0 (1 instructions; MovieObject.bdmv @ 32 (primary))

Playlists (1):
  00001  duration 00:02:00.000  1 PlayItem(s)  source PLAYLIST/00001.mpls @ 80 (primary)

Playlist 00001 details:
  PlayItem 0  clip 00001.M2TS  IN 00:00:00.000  OUT 00:02:00.000  source PLAYLIST/00001.mpls @ 92 (primary)
    Angle: count 1, multi-angle no, seamless no
    Declared angles:
      none
    MPLS stream declarations:
      primaryVideo[0]  PID 0x1011  coding 0x24  language unknown  (PLAYLIST/00001.mpls @ 142 (primary))
    CLPI program stream declarations:
      unknown (CLPI unavailable)
  Playlist marks:
    none

CLPI clip marks:
  none

Diagnostics (1)
  error BDMV_MISSING_STREAM — PlayItem 00001/0 references missing STREAM clip 00001
    source PLAYLIST/00001.mpls @ 92
```

The graphics section identifies source-file bytes separately from scanned transport payload bytes. IGS rows show each stream PID, scene composition, source path, and image element dimensions. SUP rows retain PID, language, stream number, payload bytes, and the Playlist/PlayItem declaration. Empty selections display `none`; unavailable paths or sizes display `unknown`. Parser and IGS extraction diagnostics include severity, code, source path, and available byte or packet offsets. `--type`, `--m2ts`, and `--pid` select graphics assets while structural declarations remain available. In the M2TS browser, `structure-only` means structural declarations are collected and no payload measurement is available for that clip in the existing graphics extraction scope. Details show related IGS clips reached through SubPath references; Enter can follow those references. `SUP refs` counts reachable subtitle declarations.

The combined JSON report contains `schemaVersion`, `disc`, `graphics`, `stageStatus`, `fileSizes`, and `reachableSup`. `disc` contains the parsed structural report and its stage status; `graphics` contains extracted scene metadata, stream records, diagnostics, and payload measurements. `stageStatus.structure` and `stageStatus.graphics` describe their respective stages; graphics is `not-run` when structural failure prevents extraction. Payload Maps are serialized as objects keyed by clip ID and decimal PID, such as `{"00001":{"5120":429}}`, and large binary image data is represented by metadata. `--format json` emits JSON alone, and `--out` writes the same report. JSON consumers read structural fields under `disc`, IGS records under `graphics`, and SUP declarations under `reachableSup`.

Delivery status is decided only by failure evidence: `fail` checks, `fatal` diagnostics, blocking `error` diagnostics, `hasMissingRequiredAsset`, unresolved reachability, and unsupported reachable capabilities lower it. Checks that never ran, unmeasured coverage, and stale browser evidence appear in `notVerified` (and in `gaps`) while the status stays `complete`. `build` records conversion and compatibility details in `reports.json` and package status in `manifest.json`; `validate` never rewrites `manifest.status` and reports a mismatch as `MANIFEST_STATUS_UNVERIFIED`.

Every on-disk report of one `validate` run comes from the same summary, including `dependency-audit.json`.

Argument contract: unknown options fail with `CLI_UNKNOWN_OPTION` and extra positional arguments with `CLI_USAGE`; a flag with no value fails with `CLI_MISSING_VALUE`; an invalid `--type` value is rejected by Commander with `CLI_INVALID_ARGUMENT`; `validate` rejects `--format` values other than `json` (`CLI_INVALID_FORMAT`) before touching any file. `--player-profile FILE` must be a valid `PlayerProfile` JSON (`CLI_INVALID_PROFILE` otherwise): the three language fields and `country` must be exactly 3 and 2 ASCII letters (PSR rule), case is normalised, and the profile is recorded in the packaged `manifest.json`. `build --limits FILE` reads a JSON `Limits` object before parsing the disc or creating output; malformed JSON returns `INVALID_LIMITS_FILE`, and an invalid limit or unknown key returns `INVALID_LIMIT`.

## Test suites

`corepack pnpm test` runs every package's suite; `corepack pnpm test:all` adds `--no-bail` so all packages report before the command exits.

`corepack pnpm test:coverage` runs every package suite with Vitest's V8 coverage provider. Each package reports statement, branch, function, and line coverage for `src/**/*.ts` in the terminal and writes HTML and JSON reports to that package's `coverage/` directory. The command also writes a workspace totals report to `coverage/index.html` and `coverage/coverage-summary.json`. Run one package with `corepack pnpm --filter @bdmv2web/igs test --coverage`.

The GitHub Actions test matrix runs each package with coverage enabled, uploads package reports as `coverage-*` artifacts, and shows overall and per-package totals in the workflow run summary. The `workspace-coverage-report` artifact contains the HTML and JSON reports.

| Package | Command |
| --- | --- |
| `@bdmv2web/core` | `corepack pnpm --filter @bdmv2web/core test` |
| `@bdmv2web/utils` | `corepack pnpm --filter @bdmv2web/utils test` |
| `@bdmv2web/bdmv-io` | `corepack pnpm --filter @bdmv2web/bdmv-io test` |
| `@bdmv2web/bdmv-parser` | `corepack pnpm --filter @bdmv2web/bdmv-parser test` |
| `@bdmv2web/igs` | `corepack pnpm --filter @bdmv2web/igs test` |
| `@bdmv2web/hdmv` | `corepack pnpm --filter @bdmv2web/hdmv test` |
| `@bdmv2web/media-export` | `corepack pnpm --filter @bdmv2web/media-export test` |
| `@bdmv2web/runtime-web` | `corepack pnpm --filter @bdmv2web/runtime-web test` |
| `@bdmv2web/package-builder` | `corepack pnpm --filter @bdmv2web/package-builder test` |
| `@bdmv2web/test-fixtures` | `corepack pnpm --filter @bdmv2web/test-fixtures test` |
| `@bdmv2web/test-runner` | `corepack pnpm --filter @bdmv2web/test-runner test` |
| `bdmv2web` | `corepack pnpm --filter bdmv2web test` |

Test scope is fixed by each package's `vitest.config.ts` (`include`), so the aggregate run and the per-package runs collect the same files; compiled `dist/**/*.test.js` are never loaded. A package whose configuration matches no test file fails.

Tests live in `src/` when they cover one module, and in `tests/integration/` or `tests/e2e/` when they combine modules, packages, or the built CLI. `tests/helpers/` holds test-only fixtures. Shared `test-data/` files are addressed from the repository root.

`@bdmv2web/bdmv-parser` includes a fixed-seed structural mutation replay in `src/parsing/parser-mutations.test.ts`. It uses an in-test xorshift32 generator with seed `0x5eedc0de` and creates 96 bounded inputs: eight mutations for each of length, count, offset and truncation across project-built INDEX 0100, MPLS 0200 and CLPI 0200 fixtures. The inputs come from `buildM1Index()`, `buildM1PlaylistGolden()` and `buildM1ClipInfoProgramAndCpi()` in `packages/test-fixtures/src/bdmv.ts`; no upstream bytes are copied. Lengths and offsets move 1–256 bytes beyond the input, counts exceed the fixture section bounds, and truncation cuts at a seeded byte position from 0 through input length minus one. Parser `ContractError` results are accepted; other exceptions fail the replay. Run it as part of the parser suite with `CI=true corepack pnpm --filter @bdmv2web/bdmv-parser test`. The existing CI parser-package job collects the replay through `src/**/*.test.ts` and runs it with the package suite.

The 2026-11-16 local parser-suite baseline is 86 Vitest tests, including the 96-input mutation replay as one test. Two targeted fixed-seed replays each passed in 3 ms; no unexpected parser exception required a new regression input. The complete parser suite took 465 ms on Node 24.18.0, pnpm 11.25.0, Vitest 4.0.8.

The reference comparisons read committed baselines: `test-data/baselines/libbluray-1.5.0-igs-baseline.json` for IG decoder output, `test-data/baselines/libbluray-1.5.0-navigation-baseline.json` for the index, per-command disassembly, title list, VM events and control-flow graph, and `test-data/baselines/igs-reference-element-summary.json` for the element-level comparison against the igstools reference PNGs. The tests read those files and the checked-in fixtures, so CI needs no local libbluray or igstools.

## Build gate

`build` compiles with each package's `tsconfig.build.json` (tests excluded), while `typecheck` keeps `tsc -p tsconfig.json --noEmit` over all source including tests. The two can fail independently: a type error inside a `*.test.ts` breaks `typecheck` and leaves `build` green. `rootDir: "src"` and the `src`-only `include` belong to `tsconfig.build.json`; the main `tsconfig.json` spans `src/**` and `tests/**`.

Locally the gate runs as one command through the platform-independent script:

```sh
bash scripts/ci.sh
```

The script composes stage modules from `scripts/ci/` in dependency order and prints each command with its duration:

| Stage | Command | Depends on |
| --- | --- | --- |
| `10-install.sh` | `corepack pnpm install --frozen-lockfile` | - |
| `20-generate.sh` | `corepack pnpm generate:contracts` | install |
| `30-build.sh` | `corepack pnpm -r build` (topological, concurrent across independent packages) | generate |
| `40-lint.sh`, `40-typecheck.sh`, `40-test.sh` | `corepack pnpm lint` / `-r typecheck` / `test:all` | build |

Lint resolves workspace imports through `dist`, typecheck resolves them through `dist` declarations, and the test suites import workspace packages through `dist`, so the three `40-*` stages run as parallel lanes after the build. A failing lane does not stop the others: every lane runs to completion and all lane results are reported before the gate exits. A failing sequential stage stops the gate at that stage.

`corepack pnpm` runs the pnpm version pinned by `packageManager` in `package.json`, and it ships with Node, so the gate needs no globally installed `pnpm`. Root scripts spell out `corepack pnpm` so the nested calls they make resolve through the same shim and `corepack pnpm build` works from a clean checkout. A global install remains usable: `PNPM=pnpm bash scripts/ci.sh`.

## Performance benchmarks

Use [the performance benchmark guide](performance.md) to list cases, run Tinybench component and scenario suites, capture CPU/heap/memory/browser records, compare fork medians, and generate reports. `test:all` runs `bench:test` after the package suites. Pull requests run the synthetic baseline/candidate comparison in `.github/workflows/performance.yml`; scheduled and manual runs execute the full available suite.

Measured 2026-11-08 on an idle machine (Node 24.18.0 via corepack, pnpm 11.25.0, Apple Silicon): install 0s (lockfile already satisfied) → `generate:contracts` 1s → `build` 4s → lanes `lint` 5s, `typecheck` 5s, `test:all` 19s in parallel; total 24s, exit 0. `generate:contracts` is idempotent — rerunning it leaves `packages/core/src/disc-ir.generated.ts` byte-identical.

`apps/cli`, `media-export`, and `runtime-web` set `testTimeout: 15000`; their cases take 5–6s on a busy machine, over the vitest default of 5s. Per-test budgets override it: `120_000` for the navigation corpus and Tamako headless cases in `runtime-web`, the two `igs` reference comparisons, and `60_000` for the `cli` libbluray navigation baseline. `hdmv` and `igs` set no global timeout.

**CI:** GitHub Actions (`.github/workflows/ci.yml`) runs the same stage modules as job nodes. The `build` job runs install, generate, and build, then uploads every package's `dist/` as the `workspace-dist` artifact. The `lint`, `typecheck`, and per-package `test` jobs (one job per workspace package, 12 in the matrix) download the artifact, install dependencies, and run their stage; `fail-fast: false` keeps every failing package's node red without stopping the others. The `media-export` test job installs FFmpeg, and its suites invoke a real ffmpeg/ffprobe when a test does not inject a runner; the `hdmv` test job installs JDK 21 for the Java runtime tests. The workflow triggers on pushes to `master`, pull requests, and manual dispatch; check the Actions result for the commit under review.

## Repository hygiene

Eleven committed binary fixtures exceed 1 MiB:

- `test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/STREAM/00043.m2ts_ig-packets.bin` — 11.0 MB
- `test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/STREAM/00005.m2ts_ig-packets.bin` — 8.5 MB
- `test-data/fixtures/perf/sup/Baja.Studio_jpn.sup` — 5.2 MB
- `test-data/fixtures/perf/sup/hyoka_vol1_00005_SumiSora.sup` — 4.0 MB
- `test-data/fixtures/hdmv-navigation/disc-data/spider-man-into-the-spider-verse/BDMV/AUXDATA/05010.otf` — 2.8 MB
- `test-data/fixtures/hdmv-navigation/disc-data/spider-man-into-the-spider-verse/BDMV/JAR/03001/composite1.png` — 2.7 MB
- `test-data/fixtures/perf/ig-packets/Battle.Royale_00002_pid-1400.bin` — 2.4 MB
- `test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/STREAM/00002.m2ts_ig-packets.bin` — 2.4 MB
- `test-data/fixtures/perf/mnu/Battle.Royale_00002_pid-1400.mnu` — 2.3 MB
- `test-data/fixtures/hdmv-navigation/disc-data/spider-man-into-the-spider-verse/BDMV/JAR/03001/composite2.png` — 1.9 MB
- `test-data/fixtures/hdmv-navigation/disc-data/spider-man-into-the-spider-verse/BDMV/JAR/03001/composite3.png` — 1.5 MB

The `*.m2ts_ig-packets.bin` streams are the inputs `scripts/fixtures/export-igs-packets.mjs` reads to derive reference material; `scripts/fixtures/package-hdmv-metadata.mjs` and `scripts/fixtures/package-igs-materials.mjs` package fixture materials from a source root. The Spider-Man OTF and composite PNG files are tracked disc sample content.


## Test and fixture entry points

Synthetic fixtures in `@bdmv2web/test-fixtures` are authored for interface checks. They are not BDMV protocol evidence. No commercial disc, licensed Blu-ray standard, or third-party parser output is included.
