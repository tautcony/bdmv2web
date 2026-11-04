# Development

## Pinned toolchain

- Node.js: `24.18.0` (`.node-version`; supported engine range is `>=24.18.0 <25`).
- pnpm: `11.25.0` (`packageManager` in the root `package.json`).
- TypeScript: `5.9.3`.
- Vitest: `4.0.8`.
- esbuild: `0.25.12`.
- JSON Schema to TypeScript: `15.0.4`; Ajv: `8.17.1`.

Install and run the reproducible workspace entry points:

```sh
pnpm install --frozen-lockfile
pnpm generate:contracts
pnpm build
pnpm typecheck
pnpm test
```

`pnpm typecheck` builds workspace dependency declarations first. The browser core is emitted as an ES2020 IIFE at `packages/core/dist/browser.js`; its build script inspects bundled imports and rejects Node built-ins. `@bdmv-web/core` uses the same schema for JSON validation and generated TypeScript types. Node filesystem operations belong to `@bdmv-web/bdmv-io`.

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

## CLI status

`inspect`, `extract`, `convert`, and `validate` are implemented; `compare` is not and still returns `E_NOT_IMPLEMENTED` on stderr with exit code 1.

| Command | Behavior | Exit codes |
| --- | --- | --- |
| `inspect INPUT [--out FILE]` | Writes the parsed disc JSON, plus `stageStatus`. With `--out` the file must not already exist. | stage `complete`/`partial` → 0 (or 2 under `--strict`), stage `failed` → 1 |
| `inspect INPUT --allow-partial` | Same output, but a `failed` stage no longer sets a non-zero exit code; the report keeps `stageStatus: "failed"`. | 0 |
| `extract INPUT --out DIR` | Writes structural artifacts through an output transaction; nothing is committed when a fatal diagnostic is present. | 0 (2 under `--strict` when partial), 1 when failed |
| `convert INPUT [--out DIR]` | Produces a `menu-only` package. `--mode` accepts only `menu-only`; `standalone-full` is refused with `CLI_UNSUPPORTED_MODE` before any output is created. | delivery `partial` → 0 (2 under `--strict`), `failed` → 1 |

Stage results and delivery results are separate types: `inspect`/`extract` report `stageStatus` (`complete`/`partial`/`failed`), while only `convert`/`validate` report a delivery `status`. A stage that reached its own goal never claims a complete delivery.

Argument contract: a flag with no value fails with `CLI_MISSING_VALUE`; `--player-profile FILE` must be a valid `PlayerProfile` JSON (`CLI_INVALID_PROFILE` otherwise) and is recorded in the packaged `manifest.json`; `--limits FILE` is not wired yet and fails with `CLI_NOT_IMPLEMENTED` rather than being ignored. `--strict`/`--no-strict` only change whether an acceptable `partial` is rejected; they never change the diagnostic facts.

## Test baseline

Per-package counts, measured 2026-11-04 with Node `24.18.0` / pnpm `11.25.0`:

| Package | Command | Tests |
| --- | --- | ---: |
| `@bdmv-web/core` | `corepack pnpm --filter @bdmv-web/core test` | 14 |
| `@bdmv-web/bdmv-io` | `corepack pnpm --filter @bdmv-web/bdmv-io test` | 7 |
| `@bdmv-web/bdmv-parser` | `corepack pnpm --filter @bdmv-web/bdmv-parser test` | 47 |
| `@bdmv-web/igs` | `corepack pnpm --filter @bdmv-web/igs test` | 54 |
| `@bdmv-web/hdmv` | `corepack pnpm --filter @bdmv-web/hdmv test` | 74 |
| `@bdmv-web/media-export` | `corepack pnpm --filter @bdmv-web/media-export test` | 51 passed + 1 skipped |
| `@bdmv-web/runtime-web` | `corepack pnpm --filter @bdmv-web/runtime-web test` | 92 |
| `@bdmv-web/package-builder` | `corepack pnpm --filter @bdmv-web/package-builder test` | 10 |
| `@bdmv-web/test-fixtures` | `corepack pnpm --filter @bdmv-web/test-fixtures test` | 5 |
| `@bdmv-web/test-runner` | `corepack pnpm --filter @bdmv-web/test-runner test` | 50 |
| `@bdmv-web/cli` | `corepack pnpm --filter @bdmv-web/cli test` | 28 |

Total 432 passed + 1 skipped; `corepack pnpm test:all` equals the sum of these rows. Test scope is fixed by each package's `vitest.config.ts` (`include`), so the aggregate run and the per-package runs collect the same files; compiled `dist/**/*.test.js` are never loaded (they are no longer emitted at all, see below). A package whose configuration matches no test file fails instead of reporting success.

Any change to these counts must update this table in the same change, with the reason recorded.

Differences from the counts quoted in the batch-1 review (core 14, bdmv-io 7, bdmv-parser 47, igs 54, hdmv 74, media-export 51+1, runtime-web 91, package-builder 18, test-fixtures 5, test-runner 41, cli 20):

- `package-builder` 18 → 9: 18 was measured while the package had no `include`, so `src/index.test.ts` (8) + `src/local-player-bridge.test.ts` (1) were counted twice alongside their `dist` copies. 9 is the source-only count.
- `test-runner` 41 → 50: adding `classifyDiagnostics`/`decideStageOutcome` cases and the mode-detail assertions.
- `cli` 20 → 28: adding the stage/argument contract cases, the `--player-profile` case, and the review follow-up (empty inline values, bare `--limits`, profile in runtime data, no staging leak on a missing `--title`).
- `runtime-web` 91 → 92: the packaged profile must reach the runtime VM registers, not only the manifest.
- `package-builder` 9 → 10: the profile must be embedded in `runtime/disc-data.js`.


## Build gate

`build` compiles with each package's `tsconfig.build.json` (tests excluded), while `typecheck` keeps `tsc -p tsconfig.json --noEmit` over all source including tests. The two can fail independently: a type error inside a `*.test.ts` breaks `typecheck` and leaves `build` green.

The gate is executed by hand through the platform-independent script:

```sh
bash scripts/ci.sh
```

It runs `pnpm install --frozen-lockfile` → `pnpm generate:contracts` → `pnpm -r build` → `pnpm -r typecheck` → `pnpm test:all`, prints each command with its duration, and stops at the first failing step. It does not verify the integrity of the large `test-data/` fixtures.

**Known risk:** no CI pipeline runs this gate yet. Triggers, caches, and credentials belong to a separate change; this repository deliberately contains no `.github/` or other provider-specific configuration. Until that lands, the gate is only as good as the last manual run.

## Repository hygiene

`test-data/` still carries two committed binary fixtures above 1 MiB as legacy from earlier changes:

- `test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/STREAM/00043.m2ts_ig-packets.bin` — 11.0 MB
- `test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/STREAM/00005.m2ts_ig-packets.bin` — 8.5 MB

They are left as-is. New fixtures larger than 1 MiB must be generated by a script from a manifest instead of being committed, the same way `scripts/export-igs-packet-fixtures.mjs` and `scripts/package-hdmv-metadata-fixtures.mjs` reproduce the existing ones.


## Test and fixture entry points

Run `corepack pnpm test` for the shared contracts, cursor, file I/O, path, transaction, fingerprint, CLI and fixture tests. Synthetic fixtures in `@bdmv-web/test-fixtures` are authored for interface checks. They are not BDMV protocol evidence. No commercial disc, licensed Blu-ray standard, or third-party parser output is included.

V1 browser acceptance targets macOS Google Chrome only; cross-system and other-browser testing is outside the first-version gate. **已完成 macOS Chrome `file://` 实测，证据未绑定制品指纹**：环境、网络条件、页面/媒体结果与 console 记录见[唯一证据位置](references/stages/M6-release-verification.md#v1-chrome-file-evidence)（[browser-matrix.md](browser-matrix.md) 引用同一处）。"未绑定制品指纹"意味着证据不能反证某个具体提交产出的包，而不是说场景没有跑过。
