# M2 IGS extraction support boundary

This package implements IGS extraction with a workspace-local Tamako real-stream case. Its BT.709 limited-range color conversion and the 168 referenced image elements in this sample have been checked against igstools pixel by pixel. Overall IGS support remains unverified for behaviors outside this comparison, including effects and animation.

M1 graph paths use virtual `BDMV/...` names, while a validated bdmv-io table can key paths relative to the BDMV root (`STREAM/...`) or include the `BDMV/` prefix. Extraction resolves between those names only through paths already present in the validated table.

## Implemented and exercised

- M2TS framing, incremental reads, adaptation fields, per-PID payload continuity, duplicate suppression, PAT/PMT parsing, PES assembly, PTS decoding, 33-bit wrap extension, and explicit time-domain reset.
- IG segment accumulation across PES payloads, complete ICS/PDS/ODS/END scenes, version-keyed palette/object caches, ODS continuation assembly, bounded object dimensions, and bounded indexed-pixel RLE output.
- Raw 12-byte button command retention with absolute source byte offsets, basic page/BOG/button relationships, PNG byte encoding, and stable asset path mapping.
- Sparse PDS palettes: palette indices omitted from the segment render as transparent zero. This follows the pinned libbluray 1.5.0 shared PDS decoder's zero-initialized 256-entry table; BDA normative text is not available here.
- Diagnostics for malformed or incomplete packet/PES/segment/object state, PID disagreement, unsupported effects, and missing scene references.
- A PSI continuity error discards the partial section. IG transport damage discards the active Display Set, residual segment bytes, pending ODS fragments, and cached object/palette definitions for that stream. A scene with damaged data, an unresolved object/palette, or an unfinished object sequence cannot retain `complete: true`.

The synthetic fixture IDs are the Vitest cases in `packages/igs/test/transport.test.ts` and `packages/igs/test/extraction.test.ts`; all expected bytes are authored in `packages/igs/test/fixtures.ts`. They test parser mechanics only.

The repository also includes one externally sourced 6,129-byte ICS body in `test-data/fixtures/igs-parser/ics-menu-disc14.bin`, with its source and MIT notice alongside it. Its test wraps the body in a minimal segment and END marker, then parses a 1920×1080 composition with four pages and raw button commands. This is a real IGS-structure positive case, not an end-to-end disc or rendering validation.

## Host-local real-stream smoke

The workspace-local, user-provided sample has a real positive IGS path: `CLIPINF/00005.clpi` declares PID `0x1400` (`0x91`), and `STREAM/00005.m2ts` is 8,957,952 bytes. Playlist `00003` has 999 main-path PlayItems that repeat Clip `00004` and references Clip `00005` through an IGS SubPath. Its audio declaration order is English PID `0x1100`, then Japanese PID `0x1101`. The optional `packages/igs/test/tamako-real-smoke.test.ts` parses that structure and stream when present; it skips when the user data is absent. The current parser extracts one 1920×1080 composition with seven pages, 168 objects and seven palettes. It emits graphic assets but keeps the scene incomplete and the package partial because pages 2 and 3 declare default button `65534`, whose runtime meaning is not established here. The same playlist also reaches Clip `00043`, whose CLPI declares IGS but whose STREAM file is not in this workspace, so extraction reports the missing source. No source media was modified, copied by the test, or hashed.

Clip `00004` declares PGS (`0x90`) subtitle streams; that is not an IGS cue. The Clip `00054` no-IG case remains a separate real negative smoke. The smoke test covers transport and scene extraction. A separate igstools comparison validates each image element referenced by this sample; it does not validate interaction or language switching.

## Unverified behavior

- IGS field layouts and flags have not been checked against accessible normative BDA text. The pinned `libbluray`, `igstools`, and `libhdmv` files listed in [M2 references](references/stages/M2-igs-scenes.md) are implementation comparisons, not independent oracles. `igstools` documents libav-derived code, so it cannot be counted as an independent confirmation of libbluray behavior.
- Palette Y/Cr/Cb conversion uses limited-range BT.709 with round-to-nearest and retains alpha. All 168 referenced image elements in Tamako Clip `00005` match igstools exactly; see [comparison evidence](references/stages/M2-igs-scenes.md#2026-11-03--tamako-00005-逐元素同类工具对照). Other colorimetry and multi-frame animation inputs are outside this sample.
- ICS parsing covers the tested sequence model only. Incomplete ICS sequences, all button-area semantics, invalid-reference handling, timing, animation, windows, effect clipping, composition lifecycle rules, and exact default/selection behavior remain unverified. Unknown effects are preserved as raw bytes and mark a scene incomplete.
- PNG element pixels match the reference for the tested sample; the comparison does not establish coverage of other inputs or effects.
- Extraction consumes M1's `ParsedDisc` and bdmv-io read APIs and feeds the CLI and M4 integration.

## Task disposition

M2 tasks are checked only where local synthetic tests exercise the stated behavior. Normative syntax registration, broader element coverage, and full scene semantics remain open. Do not describe this output as a verified Blu-ray menu renderer.
