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

- Do not commit real disc titles, machine-specific mount paths, local `file://` URLs, or other user-identifying data in fixtures, tests, logs, or Git history. Use synthetic or suitably anonymized examples.
- Do not add SHA-256, payload fingerprint, or file-size verification to package validation or release gates. Do not recreate equivalent content-fingerprint checks under another name. Path and file-existence checks may remain where required by the feature.
- Do not constrain reusable loaders or APIs to the names of current sample discs. Keep sample-specific lists in tests that explicitly define test coverage or expected results.
- Keep browser and shared TypeScript packages free of Node-only globals and types unless they need them. Put Node typings and dependencies only in packages that use Node APIs, following the existing pnpm workspace conventions.

## Correctness and verification

- Treat the applicable OpenSpec change as the behavior and acceptance source for staged work. Keep implementation, specs, task checklists, and progress records aligned; distinguish implemented code from behavior verified by evidence.
- For protocol behavior, use the repository's pinned reference materials and mature reference implementations where available. Prefer independent, element-level or pixel-level comparisons for extracted navigation and graphics; do not present self-comparison as independent verification.
- Preserve source traceability and useful failure behavior. A diagnosed unsupported operation must not silently disable unrelated recovery or menu navigation. Log HDMV VM execution in the console when debugging/runtime diagnostics require it, with enough context to understand the execution.
- Report only verification that was actually run. State unverified browser, real-disc, and CI behavior as unverified; keep environment-specific observations as historical evidence, not as universal platform requirements.
- Avoid adding checks that the project explicitly removed, redundant guard layers, or tests whose only purpose is to prove an absence. Add or run verification that is relevant to the change and its stated acceptance criteria.

## Documentation and collaboration

- Write user-facing documentation directly: state supported capabilities and how to use them. Remove rhetorical questions, self-answering sections, and explanations that do not help a user complete a task. Keep necessary limitations beside the affected command or workflow.
- **Mandatory direct-description generation:** While drafting user-facing documentation and progress/final responses, generate only direct descriptions of behavior, commands, results, and requirements. Do not generate reasons, justifications, contrastive framing, or explanatory wrap-up phrases. State limitations as concise facts with their relevant action.
- State current behavior directly in documentation, code, tests, comments, status messages, and prompts. Name supported capabilities, inputs, outputs, and requirements affirmatively. Remove stale behavior descriptions and contrastive explanations that describe current behavior by negating an obsolete or unrequested alternative. When behavior changes, replace old descriptions and assertions with the current contract instead of appending the change reason or a disclaimer about previous behavior. Tests should assert supported output and state directly; retain negative checks when rejection, security, or error handling is itself the contract, and assert its specific observable outcome.
- Keep shared code and build configuration consistent across packages. Follow existing workspace conventions and avoid platform-specific assumptions or unnecessary dependencies.
- When reporting progress, keep checklists current and separate completed implementation, verified results, pending work, and blocked work. Do not mark work complete based only on code being present.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
