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

The CLI scaffold recognizes `inspect`, `extract`, `convert`, `validate`, and `compare`. Each currently returns `E_NOT_IMPLEMENTED` on stderr and exit code 1 without creating output. `convert` defaults to strict mode except `--mode menu-only`; `--strict` and `--no-strict` override that default.

## Test and fixture entry points

Run `corepack pnpm test` for the shared contracts, cursor, file I/O, path, transaction, fingerprint, CLI and fixture tests. Synthetic fixtures in `@bdmv-web/test-fixtures` are authored for interface checks. They are not BDMV protocol evidence. No commercial disc, licensed Blu-ray standard, or third-party parser output is included.

V1 browser acceptance targets macOS Google Chrome only; cross-system and other-browser testing is outside the first-version gate. The environment is recorded in [browser-matrix.md](browser-matrix.md), but its offline `file://` scenarios remain not verified until the built package is tested and artifact-bound evidence is saved.
