# M2 IGS extraction support boundary

This package implements IGS extraction with workspace-local real-stream cases. Its BT.709 limited-range conversion has fixed YCbCrA vector coverage; image elements in nine packet fixtures match igstools when that reference is explicitly configured for BT.709. The packet fixtures do not independently establish the source matrix for each disc. ICS, page, BOG, button, PDS, ODS, and Display Set field mappings are registered against a pinned libbluray revision and exercised with byte samples. Overall IGS support remains unverified for behaviors outside these comparisons, including effects and animation.

M1 graph paths use virtual `BDMV/...` names, while a validated bdmv-io table can key paths relative to the BDMV root (`STREAM/...`) or include the `BDMV/` prefix. Extraction resolves between those names only through paths already present in the validated table.

## Implemented and exercised

- M2TS framing, incremental reads, adaptation fields, per-PID payload continuity, duplicate suppression, PAT/PMT parsing, PES assembly, PTS decoding, 33-bit wrap extension, and explicit time-domain reset.
- IG segment accumulation across PES payloads, complete ICS/PDS/ODS/END scenes, version-keyed palette/object caches, ODS continuation assembly, bounded object dimensions, and bounded indexed-pixel RLE output.
- Raw 12-byte button command retention with absolute source byte offsets, basic page/BOG/button relationships, PNG byte encoding, and stable asset path mapping. Encoded PNG uses deflate level 1 for scene assets and level 6 for full-size canvases; both are exported as `DEFAULT_ASSET_PNG_LEVEL` and `DEFAULT_CANVAS_PNG_LEVEL` from `packages/igs/src/rendering/png.ts`.
- `uiModel` popup classification, scene ID, source clip/PID, stream model and packet source survive IGS adaptation and menu-package serialization. `POPUP_MENU` selects a unique composition matching the packaged menu clip/PID and overlays a second Canvas without restarting the menu video; `POPUP_OFF` and title/media replacement close it. A missing or ambiguous match shows the status message `No unambiguous popup IGS composition matches the active menu clip and PID.` and leaves the menu running. Title video delegated to the system player cannot be overlaid.
- Sparse PDS palettes: palette indices omitted from the segment render as transparent zero. This follows the pinned libbluray 1.5.0 shared PDS decoder's zero-initialized 256-entry table.
- Diagnostics for malformed or incomplete packet/PES/segment/object state, PID disagreement, unresolved effect assets, and missing scene references. When the declared IGS PID disagrees with the PMT, the extraction stops after the PMT table completes and reports `IGS_PID_CONFLICT`.
- A PSI continuity error discards the partial section. IG transport damage discards the active Display Set, residual segment bytes, pending ODS fragments, and cached object/palette definitions for that stream. A scene with damaged data, an unresolved object/palette, or an unfinished object sequence cannot retain `complete: true`.

The synthetic fixture IDs are the Vitest cases in `packages/igs/src/transport/transport.test.ts` and `packages/igs/tests/integration/extraction.test.ts`; all expected bytes are authored in `packages/igs/tests/helpers/fixtures.ts`. They test parser mechanics only.

The all-features synthetic disc at `test-data/fixtures/synthetic-all-features/` supplies a two-page multi-BOG menu and a timed popup composition (`uiModel=1`). `apps/cli/tests/integration/synthetic-all-features.test.ts` asserts the popup model, composition/selection/user timeouts, effect and animation sequences, button sound IDs, button commands and adapter output. A browser boot test opens and closes a matching overlay while retaining the same video element. Popup rendering over title video is unavailable in the current menu package; title video plays in the external player.

The repository also includes one externally sourced 6,129-byte ICS body in `test-data/fixtures/igs-parser/ics-menu-disc14.bin`, with its source and MIT notice alongside it. Its test wraps the body in a minimal segment and END marker, then parses a 1920×1080 composition with four pages and raw button commands. This is a real IGS-structure positive case, not an end-to-end disc or rendering validation.

## Real-disc packet fixtures and navigation

The tracked corpus `test-data/fixtures/hdmv-navigation/disc-data` carries IGS packet streams as `<clip>.m2ts_ig-packets.bin` files with `.offset-runs.json` sidecars that map each fixture packet to its source packet. `packages/igs/tests/integration/hdmv-navigation-packet-fixtures.test.ts` runs seven cases across four discs — tamako clips `00005` and `00043`, kyoani-ova `00005`, battle-royale-uhd `00002` and `00005`, and bang-dream-mygo-vol1 `00010` and `00011`. Each case checks the sidecar run continuity, the 192-byte packet framing with PIDs `0x0000`/`0x0100`/`0x1400`, one 1920×1080 scene with `complete: true` and per-case page/object/palette counts, and rendered asset counts where `renderAssets` is enabled; the `renderAssets: false` cases assert an empty asset list while the scene data stays complete.

`packages/igs/tests/integration/tamako-external-navigation.test.ts` drives the tamako menu-to-feature path on tracked metadata and packet data: First Play starts playlist 57, the Top Menu (title 0) targets playlist 3, and the page-1 film button program issues `TITLE_SEARCH title=1`, which resolves through `selectTitle` to `PLAY_PLAYLIST 42`.

The `0xffff` default-selection and `0xfffe` default-activation sentinels are asserted on the synthetic segment cases in `packages/igs/tests/integration/extraction.test.ts`. No source media was modified or copied by these tests.

A separate igstools comparison validates each image element referenced by the packet fixtures; it does not validate interaction or language switching.

## Unverified behavior

- IGS fields are mapped to the pinned implementation and documented with byte samples in the [field register](../references/stages/M2-igs-field-register.md). Reserved fields, effect behavior, and any field semantics without a sample assertion remain unverified. `igstools` documents libav-derived code and is used as a rendering comparison, not as independent normative confirmation.
- The current palette renderer uses limited-range BT.709 with round-to-nearest and retains alpha. Six fixed vectors cover neutral levels, color channels, clipping, rounding, and alpha passthrough. All reported image elements in nine packet fixtures match igstools configured for BT.709; see [comparison evidence](../references/stages/M2-igs-scenes.md#2026-11-04--多-fixture-逐元素独立参考对照). The filtered packet fixtures do not establish source colorimetry for every disc; multi-frame animation is also outside these samples.
- MPLS/CLPI can carry color-space and dynamic-range fields for HEVC video stream declarations. The current `ParsedDisc` model skips these fields, and their relationship to IGS palette conversion has not been established; see parse task 2.7.
- ICS parsing covers the tested sequence model only. Incomplete ICS sequences, all button-area semantics, invalid-reference handling, timing, animation, windows, effect clipping, composition lifecycle rules, and exact default/selection behavior remain unverified. Effect-referenced objects and palettes without a renderable definition mark the scene incomplete; effect sequences are decoded structurally with no effect-type rejection.
- PNG element pixels match the reference for the tested sample; the comparison does not establish coverage of other inputs or effects.
- Extraction consumes M1's `ParsedDisc` and bdmv-io read APIs and feeds the CLI and M4 integration.

## Task disposition

M2 tasks are checked only where local tests or specifically identified comparisons exercise the stated behavior. Broader field semantics and full scene behavior remain open.
