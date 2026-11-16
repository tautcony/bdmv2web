# Workspace scripts

This directory contains repository build, CI, fixture, and reference tooling. The directory names state each script's role; each file name states its subject. The benchmark-specific layout and rules live in [`bench/README.md`](bench/README.md).

## Layout

| Path | Role | Entry points |
| --- | --- | --- |
| `build/` | Workspace artifact builds, CLI bundling, and build-on-demand support. | `core-browser.mjs`, `runtime-browser.mjs`, `bdj-host.mjs`, `cli.mjs`, `ensure-workspace.mjs` |
| `ci/` | Install, generation, build, lint, typecheck, and test stages. | `scripts/ci.sh` composes the stage scripts in this directory. |
| `coverage/` | Workspace coverage report generation. | `report.mjs` |
| `fixtures/` | Generate, extract, export, and package test fixtures. | `generate-synthetic-all-features.mjs`, `extract-m2ts-packets.mjs`, `export-igs-packets.mjs`, `package-hdmv-metadata.mjs`, `package-igs-materials.mjs` |
| `lint/` | Non-ESLint language checks. | `java.mjs` |
| `references/` | Fetch pinned reference sources and generate or compare reference evidence. | `fetch-cache.py`, `generate-libbluray-baselines.py`, `compare-igstools.py`, `summarize-igstools.py`, `libbluray-igs-dump.c` |
| `visualize/` | Developer visualizations of protocol and VM behavior. | `hdmv-vm-flow.mjs` |
| `bench/` | Benchmark cases, runners, commands, and reports. | See [`bench/README.md`](bench/README.md). |

## Entry points

| Command | Entry |
| --- | --- |
| `pnpm build` | Workspace package builds; package manifests call the relevant files in `build/`. |
| `pnpm bundle:cli` | `node scripts/build/cli.mjs` |
| `pnpm lint:java` | `node scripts/lint/java.mjs` |
| `pnpm test:coverage` | `node scripts/coverage/report.mjs` after package reports are written. |
| `pnpm generate:synthetic-all-features` | `node scripts/fixtures/generate-synthetic-all-features.mjs` |
| `bash scripts/ci.sh` | Runs the local gate using `ci/` stage scripts. |

Reference scripts are local evidence tools and are not part of the test or publish runtime. Their input requirements and generated evidence are documented with the relevant [reference materials](../docs/references/README.md).

## Naming and placement

- Put a script in the directory that describes its role; name the file for the subject it handles.
- Do not repeat a directory name in its file name. For example, use `coverage/report.mjs` and `fixtures/export-igs-packets.mjs`.
- Keep command entry points in the root `package.json` or in the package/workflow that owns the command.
- Keep script tests beside the script as `<subject>.test.mjs`; `pnpm bench:test` collects the benchmark tests under `bench/`.
