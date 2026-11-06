# Tasks

## 1. Pin bdmvkit reference and producer fixtures

- [x] 1.1 Register bdmvkit commit `57890760c60b3c31dacc9db1112467d4510925aa`, LGPL-3.0-or-later, source locations and limitations in reference docs.
- [x] 1.2 Add cached source modules, project metadata and LGPL license texts to cache manifest/fetch script; verify every cached file by byte length and SHA-256.
- [x] 1.3 Add a deterministic fixture generator using only cached bdmvkit authoring APIs; create normal, interacting multi-path title, menu, popup, multi-track PGS subtitle and nonzero motion-loop cases.
- [x] 1.4 Check in the generated fixture files and permit the required media fixture extensions in `.gitignore`.
- [x] 1.5 Add parser integration tests that read generated BDMV files and assert structure, multiple stream declarations, PID/language/source links and extracted IGS/PGS resources.

## 2. Execute HDMV random navigation

- [x] 2.1 Add validated deterministic random seed state to VM reset/checkpoint contracts.
- [x] 2.2 Implement RND range 1..N, GPR update, zero-bound diagnostics and trace deltas.
- [x] 2.3 Validate generated random/shuffle MOBJ paths with fixed-seed replay and full item coverage.

## 3. Preserve and display popup IGS

- [x] 3.1 Parse popup composition flag and preserve it through extracted scenes, runtime IR and package serialization.
- [x] 3.2 Associate popup scenes with source clip/PID and choose the unique matching composition on POPUP_MENU; ambiguous matches are reported.
- [x] 3.3 Overlay popup Canvas without restarting video; close on POPUP_OFF/title/media replacement; diagnose unavailable contexts.
- [x] 3.4 Verify popup extraction, source metadata serialization and unavailable playback response with bdmvkit-generated IGS bytes.

## 4. Complete PGS subtitle playback

- [x] 4.1 Extract each reachable PGS PID from M2TS and retain stream language/source/time mapping.
- [x] 4.2 Package validated PGS display sets with bounded serialization and manifest byte lengths.
- [x] 4.3 Encode PGS display-set compositions as PNG Base64, preserve display/source metadata, and compare baja runtime payload size before/after.
- [x] 4.4 Extract PGS from M2TS with in-repository transport/PES handling; preserve reference SUP PTS/DTS normalization, keep FFmpeg out of PGS production extraction, and document its video-transcoding role.

## 5. Preserve motion menu loop point

- [x] 5.1 Map bdmvkit-generated menu PlayMark to clip and encoded-media time.
- [x] 5.2 Start the exported menu loop segment at the mark; the packaged looping asset restarts at that segment's first frame.
- [x] 5.3 Verify looped playback uses the encoded segment whose first frame is the nonzero PlayMark; bridge tests cover looping, pause and unchanged video time during audio-track changes.

## 6. End-to-end verification

- [x] 6.1 Run focused package tests, complete test suite, build and typecheck.
- [x] 6.2 Confirm parser, IGS, PGS, HDMV, and CLI tests consume and validate the committed generated fixture files directly.
- [x] 6.3 Update HDMV/IGS/media support notes with tested scope and remaining unverified playback limitations.

## 7. List and export source assets from the CLI

- [x] 7.1 Implement `list-assets` with type filtering and basic IGS/PGS resource details, excluding source provenance.
- [x] 7.2 Implement transactional `export-assets` for IGS PNG and validated PGS SUP assets with a manifest excluding source provenance.
- [x] 7.3 Add CLI and generated-disc tests for multi-language PGS listing/export and all/filter behavior; run build, full tests and typecheck.
