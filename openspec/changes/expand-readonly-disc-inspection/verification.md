# Verification

## Commands and results

- `pnpm --filter @bdmv2web/bdmv-parser test` — passed, 81 tests.
- `pnpm --filter @bdmv2web/bdmv-parser typecheck` — passed.
- `pnpm --filter bdmv2web build` — passed.
- `pnpm --filter bdmv2web typecheck` — passed after rebuilding the parser dependency.
- `pnpm --filter bdmv2web test` — passed, 72 tests across 8 files, including the source-linked inspect JSON case.
- `pnpm typecheck` — passed; all 11 workspace projects built and typechecked.
- Relative Markdown link check — passed for all relative links in 63 files under `docs/`.

## Evidence status

- Candidate INDX, MOBJ, MPLS, CLPI, BDJO, and sound versions remain `unverified` in `docs/support/protocol-support.md` and `ParsedDisc.supportPrediction`.
- New field parsers have project-authored parser tests. Independent expected-value records are not registered for BDJO, META/DL, or ExtensionData payload semantics.
- BD-J execution, multi-angle playback, SubPath playback, and media decoding remain unsupported.
