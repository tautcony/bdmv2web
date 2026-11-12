# Repository guidance

This file records cross-cutting requirements repeated in Codex conversations for this repository. Feature-specific behavior belongs in the relevant OpenSpec change, specification, or documentation.

## Product and delivery constraints

- Keep the generated menu usable offline from a local package, including `file://` use where supported by the feature. Do not make a local web server or network access a hidden runtime requirement.
- Do not restrict launch behavior to macOS. Use portable launch mechanisms and describe runtime requirements without assuming a particular operating system.
- Keep stages and assets separable. IGS scene and command extraction must be usable without rendering PNGs; asset rendering can be invoked independently. Skipping rendering must not discard scene data needed by later stages.
- Preserve complete checkpoint semantics. A checkpoint must capture and restore the full state required to resume the workflow; do not turn it into a reduced or lossy snapshot for convenience.
- Preserve the menu behavior represented by the disc. Do not add extra translation or language behavior beyond what the menu provides, and do not report a menu transition as a successful audio or video track change without confirming the playback state.
- Keep the implementation and documented tool name consistent with `bdmv2web`.

## Portability, privacy, and input data

- Do not add SHA-256, payload fingerprint, or file-size verification to package validation or release gates. Do not recreate equivalent content-fingerprint checks under another name. Path and file-existence checks may remain where required by the feature.
- Do not constrain reusable loaders or APIs to the names of current sample discs. Keep sample-specific lists in tests that explicitly define test coverage or expected results.
- Keep browser and shared TypeScript packages free of Node-only globals and types unless they need them. Put Node typings and dependencies only in packages that use Node APIs, following the existing pnpm workspace conventions.

## Correctness and verification

- Treat the applicable OpenSpec change as the behavior and acceptance source for staged work. Keep implementation, specs, task checklists, and progress records aligned; distinguish implemented code from behavior verified by evidence.
- For protocol behavior, use the repository's pinned reference materials and mature reference implementations where available. Prefer independent, element-level or pixel-level comparisons for extracted navigation and graphics; do not present self-comparison as independent verification.
- Preserve source traceability and useful failure behavior. A diagnosed unsupported operation must not silently disable unrelated recovery or menu navigation. Log HDMV VM execution in the console when debugging/runtime diagnostics require it, with enough context to understand the execution.
- Report only verification that was actually run. State unverified browser, real-disc, and CI behavior as unverified; keep environment-specific observations as historical evidence, not as universal platform requirements.
- Avoid adding checks that the project explicitly removed, redundant guard layers, or tests whose only purpose is to prove an absence. Add or run verification that is relevant to the change and its stated acceptance criteria.

## Reference cache

`.reference-cache/` is gitignored and populated with the pinned references below. Read them in place. `python3 scripts/fetch-reference-cache.py` refreshes `repositories/` at the revisions in `docs/references/cache-manifest.json`, including submodules; set `https_proxy`, `http_proxy` and `all_proxy` when the network needs a proxy. Each `.reference-cache/<id>` entry points to `repositories/<id>` through a relative symlink on POSIX or a directory junction on Windows, so both path styles resolve to one copy.

| Path | Role |
| --- | --- |
| `.reference-cache/repositories/libbluray-1.5.0/` | Full libbluray 1.5.0 checkout with the `contrib/libudfread` submodule; primary behavior reference for BDMV/HDMV parsing, IGS/PGS decoding and the navigation VM. |
| `.reference-cache/repositories/igstools-2019/` | Full igstools checkout; the independent IGS parser and reference PNG exporter. |
| `.reference-cache/repositories/libhdmv-2026-03/` | Full libhdmv checkout; Alpha cross-reference for parsers and VM, not a behavior golden. |
| `.reference-cache/repositories/bdmvkit-0.7.0/` | Full bdmvkit checkout, including the `bluray_sim` harness that drives libbluray. |
| `.reference-cache/specs/` | Five BDA public white papers with provenance notes; architecture background only. |
| `.reference-cache/verification/` | igstools reference PNGs and extraction output from the IGS fixture runs, used for pixel comparisons. |
| `.reference-cache/venv/` | Python environment with Pillow and pypng for the comparison scripts. |

Keep disc content out of the cache and out of release output.

## Test layout and coverage

- Place a test beside the module it covers as `src/**/*.test.ts` when it exercises one module. Place a test that combines modules, combines packages, or drives the built CLI under `<package>/tests/integration/`; place one that spawns the built executable under `<package>/tests/e2e/`. Put test-only code in `<package>/tests/helpers/` and test data in `<package>/tests/fixtures/`.
- List both `src/**/*.test.ts` and `tests/**/*.test.ts` in the `include` of `vitest.config.ts` for every package that has a `tests/` directory. Keep the existing `testTimeout` and per-test timeout budgets unchanged when files move.
- Keep `tests/**/*.ts` inside the main `tsconfig.json` so `typecheck` covers test sources. Keep `rootDir: "src"` and the `src`-only `include` in `tsconfig.build.json` so `build` emits neither tests nor test helpers.
- Cover `apps/*/tests/**/*.ts` and `packages/*/tests/**/*.ts` in `tsconfig.lint.json` and the `TYPED_FILES` list of `eslint.config.mjs`, so relocated tests stay under type-aware lint rules.
- Move test files with `git mv` and change only import specifiers and repository-root path depth. Test logic, assertions, and timeout budgets stay identical.
- The root scripts run each package's Vitest, so a root-level `tests/` directory is not collected. Add root tests only together with a Vitest projects configuration.

## Docs layout and updates

- Place docs by type. Current-state docs live in `docs/guides/` (development guides), `docs/support/` (capability and support matrices), `docs/references/` (reference index, stage evidence, machine-readable sources), and `docs/llm-wiki/` (LLM knowledge layer). Superseded design proposals go in `docs/archive/design/`. Review and audit records go in `docs/archive/reviews/`, one `review-<date>-<topic>/` directory per review cycle with an `index.md` entry point; single-file reviews keep a `<date>-<topic>.md` name.
- Register every new or moved doc in `docs/README.md` under its category, and every archived doc as a date/scope/status row in `docs/archive/README.md`. `docs/README.md` carries one current-state block and one history block; do not add parallel history sections.
- Update current-state docs in the same change that changes the behavior they describe, and keep their scope labels accurate (for example, `protocol-support.md` states it covers M1 structure parsing only).
- Archived docs are frozen records: keep their first-line positioning statement and their findings; repair only navigation links. When creating, moving, or deleting docs, recompute relative link depths in the same change so every relative markdown link in `docs/` resolves. When a doc is deleted, turn surviving markdown links to it into inline code paths and remove it from "current capability" authority lists.
- Do not move or rename `docs/references/cache-manifest.json` or `docs/references/sources.json` without updating `scripts/fetch-reference-cache.py`, which reads the manifest from those paths.

## Documentation and collaboration

- Write user-facing documentation directly: state supported capabilities and how to use them. Remove rhetorical questions, self-answering sections, and explanations that do not help a user complete a task. Keep necessary limitations beside the affected command or workflow.
- **Mandatory direct-description generation:** While drafting user-facing documentation and progress/final responses, generate only direct descriptions of behavior, commands, results, and requirements. Do not generate reasons, justifications, contrastive framing, or explanatory wrap-up phrases. State limitations as concise facts with their relevant action.
- State current behavior directly in documentation, code, tests, comments, status messages, and prompts. Name supported capabilities, inputs, outputs, and requirements affirmatively. Remove stale behavior descriptions and contrastive explanations that describe current behavior by negating an obsolete or unrequested alternative. When behavior changes, replace old descriptions and assertions with the current contract instead of appending the change reason or a disclaimer about previous behavior. Tests should assert supported output and state directly; retain negative checks when rejection, security, or error handling is itself the contract, and assert its specific observable outcome.
- Keep shared code and build configuration consistent across packages. Follow existing workspace conventions and avoid platform-specific assumptions or unnecessary dependencies.
- Format commit messages as `<type>(<scope>): <imperative summary>` with lowercase type, scope, and summary, following the repository history.
- When reporting progress, keep checklists current and separate completed implementation, verified results, pending work, and blocked work. Do not mark work complete based only on code being present.

## Module organization

- Organize source files around cohesive domain responsibilities. Keep each module's public surface, state ownership, and behavior clear.
- Name files after the responsibility they contain, such as `menu-playback.ts`, and follow the package's existing directory conventions.
- Keep `src/index.ts` as the stable package entry point. Export consumer-facing APIs from it; keep implementation details and package-internal types in their owning modules.
- Split a file when its contents form distinct responsibilities with clear boundaries. Use responsibility and dependency boundaries to guide splits; line count alone does not determine a split.
- Keep tightly coupled state transitions with their owning state. Preserve complete checkpoint capture and restoration when moving checkpoint-related code.
- During structural refactors, preserve public signatures and observable behavior. Move implementation with its focused tests, and keep tests beside a module or in the established integration and end-to-end directories.
- Use domain-specific module names and avoid general-purpose catch-all files such as `helpers.ts`, `misc.ts`, and `common.ts`.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
