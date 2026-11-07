# Development

## Pinned toolchain

- Node.js: `24.18.0` (`.node-version`; supported engine range is `>=24.18.0 <25`).
- pnpm: `11.25.0` (`packageManager` in the root `package.json`), selected through `corepack pnpm`. A globally installed `pnpm` is not required.
- TypeScript: `5.9.3`.
- Vitest: `4.0.8`.
- esbuild: `0.25.12`.
- JSON Schema to TypeScript: `15.0.4`; Ajv: `8.17.1`.
- ESLint: `10.14.0` with `typescript-eslint` `8.72.1`.

Install and run the reproducible workspace entry points:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm generate:contracts
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
```

`corepack pnpm typecheck` builds workspace dependency declarations first. The browser core is emitted as an ES2020 IIFE at `packages/core/dist/browser.js`; its build script inspects bundled imports and rejects Node built-ins. `@bdmv2web/core` uses the same schema for JSON validation and generated TypeScript types. Node filesystem operations belong to `@bdmv2web/bdmv-io`.

## Linting

`corepack pnpm lint` runs ESLint over `apps/*/src`, `packages/*/src`, `packages/*/test`, `vitest.config.ts`, and `scripts/*.mjs`. `corepack pnpm lint:fix` applies the automatic fixes.

Linting is type-aware. `eslint.config.mjs` parses linted TypeScript through `tsconfig.lint.json`, which spans every linted file, and workspace imports resolve through each package's `dist` declarations. Run `corepack pnpm build` before linting; `scripts/ci.sh` runs lint between the build and the typecheck.

`eslint.config.mjs` encodes the style the sources use: double quotes, semicolons, trailing commas, dense single-line declarations, non-null assertions after bounds checks, and terse `condition && call()` / `error ? reject() : resolve()` statements. Formatting rules are absent by design - ESLint 10 no longer ships them and no formatter runs in this workspace.

The configuration reports zero problems on the current sources. Every enabled rule is at `error` severity; the allowances are limited to the constructs the sources rely on:

| Allowance | Scope |
| --- | --- |
| `no-non-null-assertion: off` | Parsers assert non-null after an explicit bounds check. |
| `no-unused-expressions` with `allowShortCircuit` / `allowTernary` | VM, IGS, and runtime sources chain side effects in single statements. |
| `restrict-template-expressions` allows numbers, booleans, nullish, regexps, and `never` | Diagnostic messages interpolate opcodes, PCs, register values, and exhaustive-switch operands. |
| `no-console: off`, `no-this-alias` with `allowedNames: ["active"]` | CLI progress output and the module-level active-reporter registry. |
| `require-await: off` | Renderers and adapters expose sync or fire-and-forget seams. |

`*.test.ts` files turn off `no-explicit-any`, the `no-unsafe-*` family, `unbound-method`, `restrict-template-expressions`, and `no-control-regex`: they assert on JSON parsed from CLI output, pass bound methods to vitest matchers, and match ANSI escapes verbatim.

One inline disable sits in `packages/runtime-web/src/browser.ts`: the Start-menu click listener returns its completion promise because the browser test host awaits fired listeners.

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

`inspect`, `extract`, `build`, `validate`, `list`, `export`, and `render` are implemented; `compare` returns `E_NOT_IMPLEMENTED` on stderr with exit code 1. `convert` remains an alias of `build`. Commands, options, and dispatch are handled by `commander`; run `bdmv2web --help` for the current surface.

| Command | Behavior | Exit codes |
| --- | --- | --- |
| `inspect INPUT [--format table\|json] [--out FILE]` | stdout defaults to a structural summary table; `--format json` prints the complete report. `--out` always writes complete JSON and the file must not already exist. | stage `complete`/`partial` → 0 (or 2 under `--strict`), stage `failed` → 1 |
| `inspect INPUT --allow-partial` | Same output, but a `failed` stage no longer sets a non-zero exit code; the report keeps `stageStatus: "failed"`. | 0 |
| `extract INPUT --out DIR --type hdmv\|igs\|sup` or `--all` | Writes type-specific protocol analysis JSON, source maps and a manifest through an output transaction. It does not write PNG or SUP media files; fatal diagnostics prevent commit. | 0 (2 under `--strict` when partial), 1 when failed |
| `list INPUT [--type all\|igs\|sup] [--m2ts CLIP_ID] [--pid PID] [--decode png] [--format table\|json] [--out FILE]` | stdout defaults to summary and detail tables; `--out` writes the complete JSON report. Reports IGS MNU streams, image object attributes and reachable SUP tracks by M2TS clip/PID. | 0, 1 when failed |
| `export INPUT --out DIR [--type all\|igs\|sup] [--m2ts CLIP_ID] [--pid PID] [--decode png]` | Exports igstools-compatible IGS `.mnu` files and/or reachable SUP tracks. `--decode png` also exports PNG images for IGS elements and SUP display sets. `assets-manifest.json` records type, format, path, size, subtitle metadata, and display-set start/end time. Transparent display sets are omitted. | 0 (2 under `--strict` when partial), 1 when failed |
| `render INPUT --out DIR [--type all\|igs\|sup] [--m2ts CLIP_ID] [--pid PID]` | Renders IGS element and SUP display-set PNGs from a BDMV into `assets-manifest.json` without writing `.mnu`/`.sup`. | 0 (2 under `--strict` when partial), 1 when failed |
| `render (--mnu FILE \| --sup FILE) --out DIR [--pid PID] [--language LANG]` | Renders a standalone MNU or SUP without a BDMV. A positional `.mnu`/`.sup` path is equivalent. `--language` is written only for SUP entries. | 0, 1 when parsing or output fails |
| `build INPUT [--out DIR] [--overwrite]` | Produces the unified offline menu package. Existing output is preserved unless `--overwrite` is supplied. On overwrite, encoded menu media is reused only when the prior media plan matches the selected Playlist, Clip, interval, streams, and encoder settings; otherwise it is regenerated. | delivery `complete`/`partial` → 0 (2 under `--strict` when partial), `failed` → 1 |
| `validate DIR --offline [--format json]` | Re-runs the offline package audit and rewrites `dependency-audit.json`, `compatibility.json`, and `reports/release-summary.json` from one summary. | 0 (2 under `--strict` when partial), 1 when failed |

Stage results and delivery results are separate types: `inspect`/`extract`/`render` report `stageStatus` (`complete`/`partial`/`failed`), while only `build`/`validate` report a delivery `status`. A stage that reached its own goal never claims a complete delivery. Failed stage output uses `stageStatus` too, so one field never carries two meanings.

Delivery status is decided only by failure evidence: `fail` checks, `fatal` diagnostics, blocking `error` diagnostics, `hasMissingRequiredAsset`, unresolved reachability, and unsupported reachable capabilities lower it. Checks that never ran, unmeasured coverage, and stale browser evidence appear in `notVerified` (and in `gaps`) while the status stays `complete`. `build` records the same conclusion in `report.json`, `manifest.json`, and `compatibility.json`; `validate` never rewrites `manifest.status` and reports a mismatch as `MANIFEST_STATUS_UNVERIFIED`.

Every on-disk report of one `validate` run comes from the same summary, including `dependency-audit.json`.

Argument contract: unknown options fail with `CLI_UNKNOWN_OPTION` and extra positional arguments with `CLI_USAGE`; a flag with no value fails with `CLI_MISSING_VALUE`; `validate` rejects `--format` values other than `json` (`CLI_INVALID_FORMAT`) before touching any file. `--player-profile FILE` must be a valid `PlayerProfile` JSON (`CLI_INVALID_PROFILE` otherwise): the three language fields and `country` must be exactly 3 and 2 ASCII letters (PSR rule), case is normalised, and the profile is recorded in the packaged `manifest.json`. `build --limits FILE` reads a JSON `Limits` object before parsing the disc or creating output; malformed JSON returns `INVALID_LIMITS_FILE`, and an invalid limit or unknown key returns `INVALID_LIMIT`. `--strict`/`--no-strict` only change whether an acceptable `partial` is rejected; they never change the diagnostic facts.

## Test suites

`corepack pnpm test` runs every package's suite; `corepack pnpm test:all` adds `--no-bail` so all packages report before the command exits.

| Package | Command |
| --- | --- |
| `@bdmv2web/core` | `corepack pnpm --filter @bdmv2web/core test` |
| `@bdmv2web/bdmv-io` | `corepack pnpm --filter @bdmv2web/bdmv-io test` |
| `@bdmv2web/bdmv-parser` | `corepack pnpm --filter @bdmv2web/bdmv-parser test` |
| `@bdmv2web/igs` | `corepack pnpm --filter @bdmv2web/igs test` |
| `@bdmv2web/hdmv` | `corepack pnpm --filter @bdmv2web/hdmv test` |
| `@bdmv2web/media-export` | `corepack pnpm --filter @bdmv2web/media-export test` |
| `@bdmv2web/runtime-web` | `corepack pnpm --filter @bdmv2web/runtime-web test` |
| `@bdmv2web/package-builder` | `corepack pnpm --filter @bdmv2web/package-builder test` |
| `@bdmv2web/test-fixtures` | `corepack pnpm --filter @bdmv2web/test-fixtures test` |
| `@bdmv2web/test-runner` | `corepack pnpm --filter @bdmv2web/test-runner test` |
| `@bdmv2web/cli` | `corepack pnpm --filter @bdmv2web/cli test` |

Test scope is fixed by each package's `vitest.config.ts` (`include`), so the aggregate run and the per-package runs collect the same files; compiled `dist/**/*.test.js` are never loaded. A package whose configuration matches no test file fails instead of reporting success.

The reference comparisons read committed baselines: `test-data/baselines/libbluray-1.5.0-igs-baseline.json` for IG decoder output, `test-data/baselines/libbluray-1.5.0-navigation-baseline.json` for the index, per-command disassembly, title list, VM events and control-flow graph, and the igstools element-level RGBA dumps. The tests read those files and the checked-in fixtures, so CI needs no local libbluray or igstools.

## Build gate

`build` compiles with each package's `tsconfig.build.json` (tests excluded), while `typecheck` keeps `tsc -p tsconfig.json --noEmit` over all source including tests. The two can fail independently: a type error inside a `*.test.ts` breaks `typecheck` and leaves `build` green.

The gate is executed by hand through the platform-independent script:

```sh
bash scripts/ci.sh
```

It runs `corepack pnpm install --frozen-lockfile` → `corepack pnpm generate:contracts` → `corepack pnpm -r build` → `corepack pnpm -r typecheck` → `corepack pnpm test:all`, prints each command with its duration, and stops at the first failing step. It does not verify the integrity of the large `test-data/` fixtures.

`corepack pnpm` runs the pnpm version pinned by `packageManager` in `package.json`, and it ships with Node, so the gate needs no globally installed `pnpm`. Root scripts spell out `corepack pnpm` so the nested calls they make resolve through the same shim and `corepack pnpm build` works from a clean checkout. A global install remains usable: `PNPM=pnpm bash scripts/ci.sh`.

Measured 2026-11-05 on an idle machine (Node 22.22.2 via corepack, pnpm 11.25.0): install 0s (lockfile already satisfied) → `generate:contracts` 1s → `build` 14s → `typecheck` 19s → `test:all` 117s; total 2m32s, exit 0. `generate:contracts` is idempotent — rerunning it leaves `packages/core/src/disc-ir.generated.ts` byte-identical.

`apps/cli`, `media-export`, and `runtime-web` set `testTimeout: 15000`; their cases take 5–6s on a busy machine, over the vitest default of 5s. The navigation corpus cases keep their explicit per-test `120_000` budgets, which take precedence. `hdmv` sets no timeout because it has no measured slow case.

**CI:** GitHub Actions runs this gate on pushes to `master`, pull requests, and manual dispatch. The workflow uses the repository-pinned Node version and runs `bash scripts/ci.sh`; check the Actions result for the commit under review.

## Repository hygiene

Two committed binary fixtures exceed 1 MiB:

- `test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/STREAM/00043.m2ts_ig-packets.bin` — 11.0 MB
- `test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/STREAM/00005.m2ts_ig-packets.bin` — 8.5 MB

New fixtures larger than 1 MiB are generated by a script from a manifest, as `scripts/export-igs-packet-fixtures.mjs` and `scripts/package-hdmv-metadata-fixtures.mjs` reproduce these two.


## Test and fixture entry points

Synthetic fixtures in `@bdmv2web/test-fixtures` are authored for interface checks. They are not BDMV protocol evidence. No commercial disc, licensed Blu-ray standard, or third-party parser output is included.
