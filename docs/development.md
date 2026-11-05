# Development

## Pinned toolchain

- Node.js: `24.18.0` (`.node-version`; supported engine range is `>=24.18.0 <25`).
- pnpm: `11.25.0` (`packageManager` in the root `package.json`), selected through `corepack pnpm`. A globally installed `pnpm` is not required.
- TypeScript: `5.9.3`.
- Vitest: `4.0.8`.
- esbuild: `0.25.12`.
- JSON Schema to TypeScript: `15.0.4`; Ajv: `8.17.1`.

Install and run the reproducible workspace entry points:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm generate:contracts
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
```

`corepack pnpm typecheck` builds workspace dependency declarations first. The browser core is emitted as an ES2020 IIFE at `packages/core/dist/browser.js`; its build script inspects bundled imports and rejects Node built-ins. `@bdmv2web/core` uses the same schema for JSON validation and generated TypeScript types. Node filesystem operations belong to `@bdmv2web/bdmv-io`.

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

Use `allocateBoundedBytes` or `checkedObjectPixels` before allocating according to these limits. `readFileChunks` enforces `maxReadWindowBytes` on each stream window.

## Parsing tolerance

A field length or value that cannot be confirmed against the reference implementation defaults to a diagnostic, never to "this whole block is unusable". Concretely:

- Only the main INDX section (First Play / Top Menu / titles) is critical. AppInfo and the 3.1 UHD extension are optional: a failed parse yields `null` plus a `warning`, and navigation still parses.
- Declared section lengths are consistency hints. Entry and payload bounds are checked against the file length, matching libbluray's `bits->end`; a mismatch is recorded as `BDMV_DECLARED_LENGTH_MISMATCH`.
- CLPI `sequenceInfo` / TS-type length fields that do not fit the file downgrade to a warning; the ATC/STC counts still bound the read.
- Tolerance is not "no checks": a read that leaves the file still fails with `BDMV_INVALID_COUNT` / `BDMV_INVALID_SECTION`, and a section never continues into its neighbour.

## CLI status

`inspect`, `extract`, `convert`, `validate`, `list-assets`, and `export-assets` are implemented; `compare` is not and still returns `E_NOT_IMPLEMENTED` on stderr with exit code 1.

| Command | Behavior | Exit codes |
| --- | --- | --- |
| `inspect INPUT [--out FILE]` | Writes the parsed disc JSON, plus `stageStatus`. With `--out` the file must not already exist. | stage `complete`/`partial` → 0 (or 2 under `--strict`), stage `failed` → 1 |
| `inspect INPUT --allow-partial` | Same output, but a `failed` stage no longer sets a non-zero exit code; the report keeps `stageStatus: "failed"`. | 0 |
| `extract INPUT --out DIR` | Writes structural artifacts through an output transaction; nothing is committed when a fatal diagnostic is present. | 0 (2 under `--strict` when partial), 1 when failed |
| `list-assets INPUT [--type all\|igs\|pgs]` | Lists IGS PNG assets and reachable PGS stream declarations as JSON; does not invoke FFmpeg or report source provenance. | 0, 1 when failed |
| `export-assets INPUT --out DIR [--type all\|igs\|pgs]` | Exports IGS PNGs and/or reachable PGS SUP files with an `assets-manifest.json` containing resource type, exported path, size and subtitle language. | 0 (2 under `--strict` when partial), 1 when failed |
| `convert INPUT [--out DIR] [--overwrite]` | Produces a `menu-only` package. Existing output is preserved unless `--overwrite` is supplied. On overwrite, encoded menu media is reused only when the prior media plan matches the selected Playlist, Clip, interval, streams, and encoder settings; otherwise it is regenerated. `--mode` accepts only `menu-only`; `standalone-full` is refused with `CLI_UNSUPPORTED_MODE` before any output is created. | delivery `complete`/`partial` → 0 (2 under `--strict` when partial), `failed` → 1 |
| `validate DIR --offline [--format json]` | Re-runs the offline package audit and rewrites `dependency-audit.json`, `compatibility.json`, and `reports/release-summary.json` from one summary. | 0 (2 under `--strict` when partial), 1 when failed |

Stage results and delivery results are separate types: `inspect`/`extract` report `stageStatus` (`complete`/`partial`/`failed`), while only `convert`/`validate` report a delivery `status`. A stage that reached its own goal never claims a complete delivery. Failed stage output uses `stageStatus` too, so one field never carries two meanings.

Delivery status is decided only by failure evidence. `complete` means "no known failure", not "fully verified": a package whose checks were never run, whose coverage is unmeasured, or whose browser evidence is stale is still `complete`, and those items are listed in `notVerified` (and in `gaps`). Only `fail` checks, `fatal` diagnostics, blocking `error` diagnostics, `hasMissingRequiredAsset`, unresolved reachability, and unsupported reachable capabilities can lower the status. `convert` records the same conclusion in `report.json`, `manifest.json`, and `compatibility.json`; `validate` never rewrites `manifest.status` and reports a mismatch as `MANIFEST_STATUS_UNVERIFIED`.

Every on-disk report of one `validate` run comes from the same summary, including `dependency-audit.json`, and `mode` is read from `manifest.mode` → `report.json.mode` → `assumed` with `modeSource` recorded. A package that declares no supported mode reports `PACKAGE_MODE_ASSUMED` instead of silently defaulting to `standalone-full`.

Argument contract: unknown options fail with `CLI_UNKNOWN_OPTION` and extra positional arguments with `CLI_USAGE`; a flag with no value fails with `CLI_MISSING_VALUE`; `validate` rejects `--format` values other than `json` (`CLI_INVALID_FORMAT`) before touching any file. `--player-profile FILE` must be a valid `PlayerProfile` JSON (`CLI_INVALID_PROFILE` otherwise): the three language fields and `country` must be exactly 3 and 2 ASCII letters (PSR rule), case is normalised, and the profile is recorded in the packaged `manifest.json`. `--limits FILE` is not wired yet and fails with `CLI_NOT_IMPLEMENTED` rather than being ignored. `--strict`/`--no-strict` only change whether an acceptable `partial` is rejected; they never change the diagnostic facts.

## Test baseline

Per-package counts, measured 2026-11-05 with Node `24.18.0` / pnpm `11.25.0`:

| Package | Command | Tests |
| --- | --- | ---: |
| `@bdmv2web/core` | `corepack pnpm --filter @bdmv2web/core test` | 14 |
| `@bdmv2web/bdmv-io` | `corepack pnpm --filter @bdmv2web/bdmv-io test` | 7 |
| `@bdmv2web/bdmv-parser` | `corepack pnpm --filter @bdmv2web/bdmv-parser test` | 69 |
| `@bdmv2web/igs` | `corepack pnpm --filter @bdmv2web/igs test` | 54 |
| `@bdmv2web/hdmv` | `corepack pnpm --filter @bdmv2web/hdmv test` | 74 |
| `@bdmv2web/media-export` | `corepack pnpm --filter @bdmv2web/media-export test` | 51 passed + 1 skipped |
| `@bdmv2web/runtime-web` | `corepack pnpm --filter @bdmv2web/runtime-web test` | 93 |
| `@bdmv2web/package-builder` | `corepack pnpm --filter @bdmv2web/package-builder test` | 10 |
| `@bdmv2web/test-fixtures` | `corepack pnpm --filter @bdmv2web/test-fixtures test` | 5 |
| `@bdmv2web/test-runner` | `corepack pnpm --filter @bdmv2web/test-runner test` | 51 |
| `@bdmv2web/cli` | `corepack pnpm --filter @bdmv2web/cli test` | 33 |

Total 461 passed + 1 skipped; `corepack pnpm test:all` equals the sum of these rows. Test scope is fixed by each package's `vitest.config.ts` (`include`), so the aggregate run and the per-package runs collect the same files; compiled `dist/**/*.test.js` are never loaded (they are no longer emitted at all, see below). A package whose configuration matches no test file fails instead of reporting success.

Any change to these counts must update this table in the same change, with the reason recorded.

Differences from the counts quoted in the batch-1 review (core 14, bdmv-io 7, bdmv-parser 47, igs 54, hdmv 74, media-export 51+1, runtime-web 91, package-builder 18, test-fixtures 5, test-runner 41, cli 20):

- `package-builder` 18 → 9: 18 was measured while the package had no `include`, so `src/index.test.ts` (8) + `src/local-player-bridge.test.ts` (1) were counted twice alongside their `dist` copies. 9 is the source-only count.
- `test-runner` 41 → 50: adding `classifyDiagnostics`/`decideStageOutcome` cases and the mode-detail assertions.
- `cli` 20 → 28: adding the stage/argument contract cases, the `--player-profile` case, and the review follow-up (empty inline values, bare `--limits`, profile in runtime data, no staging leak on a missing `--title`).
- `runtime-web` 91 → 92: the packaged profile must reach the runtime VM registers, not only the manifest.
- `package-builder` 9 → 10: the profile must be embedded in `runtime/disc-data.js`.

Round-2 review fixes (2026-11-05) moved four rows:

- `bdmv-parser` 47 → 69: the "optional UHD metadata is fatal" case became three damage branches that must keep the navigation entries, plus new cases for a malformed `AppInfoBDMV`, a declared extension length that under-reports, an out-of-range CLPI TS type length, an ATC sequence length that under-reports, and real-sample 0x24 assertions (P1-P1-1, P1-P2-1, P1-P2-2, P1-INFO-3).
- `test-runner` 50 → 51: `decideDelivery` now separates failure evidence from missing evidence, so the browser-evidence, empty-check and release-summary cases assert `notVerified` on a `complete` verdict instead of a `partial` one (P2-P2-3).
- `runtime-web` 92 → 93: the persistent-toast path and the removed `#disc-title` write-back are asserted separately (P3-P2-1, P3-INFO-1).
- `cli` 28 → 33: misspelled options, extra positionals, four invalid `--player-profile` values, "no report written when validate arguments are invalid", disk-vs-stdout dependency audit, and the assumed-mode fallback (P2-P2-1, P2-P2-2, P2-P2-4, P2-P2-6, P2-P2-7).


## Build gate

`build` compiles with each package's `tsconfig.build.json` (tests excluded), while `typecheck` keeps `tsc -p tsconfig.json --noEmit` over all source including tests. The two can fail independently: a type error inside a `*.test.ts` breaks `typecheck` and leaves `build` green.

The gate is executed by hand through the platform-independent script:

```sh
bash scripts/ci.sh
```

It runs `corepack pnpm install --frozen-lockfile` → `corepack pnpm generate:contracts` → `corepack pnpm -r build` → `corepack pnpm -r typecheck` → `corepack pnpm test:all`, prints each command with its duration, and stops at the first failing step. It does not verify the integrity of the large `test-data/` fixtures.

**Why corepack:** `package.json` pins `packageManager: pnpm@11.25.0`, so `corepack pnpm` always runs that exact version. Corepack ships with Node, which means the gate needs no globally installed `pnpm` — and, more importantly, the nested `pnpm` calls that root scripts such as `build` (`pnpm generate:contracts && pnpm -r build`) make internally resolve through the same shim. The root scripts therefore also spell out `corepack pnpm`, so `corepack pnpm build` works from a clean checkout. A global install is still usable: `PNPM=pnpm bash scripts/ci.sh`.

Measured 2026-11-05 on an idle machine (Node 22.22.2 via corepack, pnpm 11.25.0): install 0s (lockfile already satisfied) → `generate:contracts` 1s → `build` 14s → `typecheck` 19s → `test:all` 117s; total 2m32s, exit 0. `generate:contracts` is idempotent — rerunning it leaves `packages/core/src/disc-ir.generated.ts` byte-identical.

**Load assumption:** `apps/cli`, `media-export`, and `runtime-web` set `testTimeout: 15000` because their cases legitimately take 5–6s when the machine is busy; the vitest default of 5s produced false failures. The navigation corpus cases keep their explicit per-test `120_000` budgets, which take precedence. `hdmv` has no measured slow case and deliberately sets nothing. A red gate is only meaningful when the machine is not oversubscribed — run the gate alone before treating a failure as real.

**CI:** GitHub Actions runs this gate on pushes to `master`, pull requests, and manual dispatch. The workflow uses the repository-pinned Node version and runs `bash scripts/ci.sh`; check the Actions result for the commit under review.

## Repository hygiene

`test-data/` still carries two committed binary fixtures above 1 MiB as legacy from earlier changes:

- `test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/STREAM/00043.m2ts_ig-packets.bin` — 11.0 MB
- `test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/STREAM/00005.m2ts_ig-packets.bin` — 8.5 MB

They are left as-is. New fixtures larger than 1 MiB must be generated by a script from a manifest instead of being committed, the same way `scripts/export-igs-packet-fixtures.mjs` and `scripts/package-hdmv-metadata-fixtures.mjs` reproduce the existing ones.


## Test and fixture entry points

Run `corepack pnpm test` for the shared contracts, cursor, file I/O, path, transaction, CLI and fixture tests. Synthetic fixtures in `@bdmv2web/test-fixtures` are authored for interface checks. They are not BDMV protocol evidence. No commercial disc, licensed Blu-ray standard, or third-party parser output is included.

V1 browser acceptance targets Google Chrome and does not specify an operating system; cross-browser testing is outside the first-version gate. **已完成 Google Chrome `file://` 实测，证据未绑定制品指纹**：结果与 console 记录见[唯一证据位置](references/stages/M6-release-verification.md#v1-chrome-file-evidence)（[browser-matrix.md](browser-matrix.md) 引用同一处）。"未绑定制品指纹"意味着证据不能反证某个具体提交产出的包，而不是说场景没有跑过。
