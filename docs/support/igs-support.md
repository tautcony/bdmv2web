# M2 IGS extraction support boundary

This package implements IGS extraction with workspace-local real-stream cases. Its BT.709 limited-range conversion has fixed YCbCrA vector coverage; image elements in nine packet fixtures match igstools when that reference is explicitly configured for BT.709. The packet fixtures do not independently establish the source matrix for each disc. ICS, page, BOG, button, PDS, ODS, and Display Set field mappings are registered against a pinned libbluray revision and exercised with byte samples. Overall IGS support remains unverified for behaviors outside these comparisons, including effects and animation.

M1 graph paths use virtual `BDMV/...` names, while a validated bdmv-io table can key paths relative to the BDMV root (`STREAM/...`) or include the `BDMV/` prefix. Extraction resolves between those names only through paths already present in the validated table.

## Implemented and exercised

- M2TS framing, incremental reads, adaptation fields, per-PID payload continuity, duplicate suppression, PAT/PMT parsing, PES assembly, PTS decoding, 33-bit wrap extension, and explicit time-domain reset.
- IG segment accumulation across PES payloads, complete ICS/PDS/ODS/END scenes, version-keyed palette/object caches, ODS continuation assembly, bounded object dimensions, and bounded indexed-pixel RLE output.
- Raw 12-byte button command retention with absolute source byte offsets, basic page/BOG/button relationships, PNG byte encoding, and stable asset path mapping.
- `uiModel` popup classification, scene ID, source clip/PID, stream model and packet source survive IGS adaptation and menu-package serialization. `POPUP_MENU` selects a unique composition matching the packaged menu clip/PID and overlays a second Canvas without restarting the menu video; `POPUP_OFF` and title/media replacement close it. An ambiguous or missing match returns a correlated `MEDIA_UNAVAILABLE` response. Title video delegated to the system player cannot be overlaid.
- Sparse PDS palettes: palette indices omitted from the segment render as transparent zero. This follows the pinned libbluray 1.5.0 shared PDS decoder's zero-initialized 256-entry table.
- Diagnostics for malformed or incomplete packet/PES/segment/object state, PID disagreement, unresolved effect assets, and missing scene references.
- A PSI continuity error discards the partial section. IG transport damage discards the active Display Set, residual segment bytes, pending ODS fragments, and cached object/palette definitions for that stream. A scene with damaged data, an unresolved object/palette, or an unfinished object sequence cannot retain `complete: true`.

The synthetic fixture IDs are the Vitest cases in `packages/igs/test/transport.test.ts` and `packages/igs/test/extraction.test.ts`; all expected bytes are authored in `packages/igs/test/fixtures.ts`. They test parser mechanics only.

The bdmvkit-generated fixture at `test-data/fixtures/bdmvkit-generated/` adds an authoring-side interoperability case. Its title Clip `00001` contains popup IGS (`uiModel=1`) and its motion menu uses Clip `00004`. Parser, adapter and package serialization tests assert the popup flag and clip/PID provenance. A browser boot test opens and closes a matching overlay while retaining the same video element. Popup rendering over title video is unavailable in the current menu package; title video plays in the external player.

The repository also includes one externally sourced 6,129-byte ICS body in `test-data/fixtures/igs-parser/ics-menu-disc14.bin`, with its source and MIT notice alongside it. Its test wraps the body in a minimal segment and END marker, then parses a 1920×1080 composition with four pages and raw button commands. This is a real IGS-structure positive case, not an end-to-end disc or rendering validation.

## Host-local real-stream smoke

The workspace-local, user-provided sample has a real positive IGS path: `CLIPINF/00005.clpi` declares PID `0x1400` (`0x91`), and `STREAM/00005.m2ts` is 8,957,952 bytes. Playlist `00003` has 999 main-path PlayItems that repeat Clip `00004` and references Clip `00005` through an IGS SubPath. Its audio declaration order is English PID `0x1100`, then Japanese PID `0x1101`. The optional `packages/igs/test/tamako-real-smoke.test.ts` parses that structure and stream when present; it skips when the user data is absent. The current parser extracts one 1920×1080 composition with seven pages, 168 objects and seven palettes. It emits graphic assets and reports the scene as `complete: true`. The package stays partial because the same playlist also reaches Clip `00043`, whose CLPI declares IGS but whose STREAM file is not in this workspace, so extraction reports the missing source. Pages 2 and 3 declare default button `0xffff` with activated button `0xfffe`; those are now established as sentinels ("no selection" / "activate the selected button") rather than unresolved button references, which is why the scene keeps `complete: true` and no `IGS_INVALID_BUTTON_REFERENCE` is raised. The assertions are in `packages/igs/test/tamako-real-smoke.test.ts` (scene completeness, the `0xffff`/`0xfffe` pair, and the Clip `00043` diagnostic). No source media was modified or copied by the test.

Clip `00004` declares PGS (`0x90`) subtitle streams; that is not an IGS cue. The Clip `00054` no-IG case remains a separate real negative smoke. The smoke test covers transport and scene extraction. A separate igstools comparison validates each image element referenced by this sample; it does not validate interaction or language switching.

## Unverified behavior

- IGS fields are mapped to the pinned implementation and documented with byte samples in the [field register](../references/stages/M2-igs-field-register.md). Reserved fields, effect behavior, and any field semantics without a sample assertion remain unverified. `igstools` documents libav-derived code and is used as a rendering comparison, not as independent normative confirmation.
- The current palette renderer uses limited-range BT.709 with round-to-nearest and retains alpha. Six fixed vectors cover neutral levels, color channels, clipping, rounding, and alpha passthrough. All reported image elements in nine packet fixtures match igstools configured for BT.709; see [comparison evidence](../references/stages/M2-igs-scenes.md#2026-11-04--多-fixture-逐元素独立参考对照). The filtered packet fixtures do not establish source colorimetry for every disc; multi-frame animation is also outside these samples.
- MPLS/CLPI can carry color-space and dynamic-range fields for HEVC video stream declarations. The current `ParsedDisc` model skips these fields, and their relationship to IGS palette conversion has not been established; see parse task 2.7.
- ICS parsing covers the tested sequence model only. Incomplete ICS sequences, all button-area semantics, invalid-reference handling, timing, animation, windows, effect clipping, composition lifecycle rules, and exact default/selection behavior remain unverified. Effect-referenced objects and palettes without a renderable definition mark the scene incomplete; effect sequences are decoded structurally with no effect-type rejection.
- PNG element pixels match the reference for the tested sample; the comparison does not establish coverage of other inputs or effects.
- Extraction consumes M1's `ParsedDisc` and bdmv-io read APIs and feeds the CLI and M4 integration.

## Task disposition

M2 tasks are checked only where local tests or specifically identified comparisons exercise the stated behavior. Broader field semantics and full scene behavior remain open.
