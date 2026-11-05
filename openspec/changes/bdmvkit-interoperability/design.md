# Design

## Context

bdmvkit v0.7.0 source snapshot at commit `57890760c60b3c31dacc9db1112467d4510925aa` generates internally coherent BDMV structures, MPEG-2 transport streams, IGS menus and PGS subtitle streams. Its files are suitable as a producer-side reference for the reader/runtime, while libbluray remains the independent player-side behavior reference. The repository currently has RND decode but no execution, stores no popup composition classification, has PGS SUP parsing primitives without end-to-end media/package integration, and has mark mappings without an authored motion-loop interoperability case.

## Decisions

### Reference cache and generated fixtures

Add bdmvkit as a pinned reference in `docs/references/sources.json` and `cache-manifest.json`. The fetch script checks out the complete repository at its fixed commit under `.reference-cache/repositories/bdmvkit-0.7.0/`. The cache stays gitignored and excluded from release output. A checked-in fixture generator imports only that checkout, creates tiny synthetic source media and graphics, then invokes the authoring APIs to write discs. Commit generated BDMV files directly and test them through the production parser and resource extractors. No commercial disc material is used.

The deterministic fixture uses bdmvkit's normal authoring APIs and remains small, but exercises several interacting paths: shuffled titles, a sequential playlist with a chapter range, direct-title menu navigation, a three-button motion menu, a two-button title popup, multiple audio and subtitle languages, chapter marks, English PGS show/clear sets, French PGS, and a nonzero menu PlayMark. Tests parse generated INDX/MOBJ/MPLS/CLPI/M2TS bytes using production code, assert source navigation and asset declarations, and execute relevant VM/runtime actions. Keep the committed generated BDMV files in Git directly; do not add a generated provenance/checksum sidecar. Generation is an explicit developer command requiring Python 3 and FFmpeg; normal unit tests consume committed fixture files and do not require `.reference-cache` or FFmpeg.

Add `list-assets` and `export-assets` CLI commands. Listing reports IGS image assets and reachable PGS language/stream declarations without invoking FFmpeg. Export writes the selected resource types (`all`, `igs`, `pgs`) into a transactional output directory and records resource type, generated export path, byte length and subtitle language in `assets-manifest.json`. Do not include source provenance. PGS exports are parsed before commit. This is a resource inspection/export surface and does not alter title playback architecture.

### HDMV RND

Extend VM options/reset state with a validated 32-bit seed and private deterministic PRNG state. Match the pinned libbluray LCG (`state = state * 6364136223846793005 + 1` modulo 64 bits; output upper 32 bits modulo N plus one). A zero bound returns one and records a diagnostic, matching libbluray. Include seed and 64-bit state in checkpoints/reset semantics so identical inputs replay identically. Randomness must never call ambient `Math.random()`; this keeps generated shuffle paths testable. The bdmvkit-generated fixture checks range and complete shuffle coverage, and a fixed seed vector checks exact replay values.

### Popup IGS

Parse and retain the popup composition flag from ICS raw bytes as a first-class field through extraction, serialization and package data. Bind each scene to its clip and IG PID. At runtime, POPUP_MENU selects the popup composition for the active clip and layers the same Canvas scene over the active video; it does not create a new media generation or reset the media clock. POPUP_OFF and title replacement remove that layer. If the current source playback path is an external system-player handoff and cannot expose its video frame, mark popup presentation unavailable instead of claiming it was shown; the in-browser linear playback path is the path that can satisfy overlay acceptance.

### PGS extraction, parsing, and package data

For every reachable PGS STN reference, extract the declared PID from its source M2TS as SUP. Reuse one extracted SUP for references to the same clip/PID, while retaining each playlist/PlayItem source interval, language and primary subtitle stream number. Parse segment bounds, palette/object fragments, PCS placements/crops, RLE pixels and END records with the existing allocation limits. Extend sequential 32-bit SUP PTS across wrap. Serialize palette and pixel maps into JSON-safe arrays/hex data; reject aggregate runtime data above 64 MiB. Package manifests record generated file paths and lengths. Keep the parser separate from IGS behavior. Subtitle selection, compositing and playback-time restoration remain deferred to a later change so this work does not alter the current system-player handoff.

### Motion menu loop point

Use the resolved playlist mark and existing 90 kHz `MediaTimelineMap` to determine the clip-relative source time. On `PLAY_PLAYLIST_MARK`, open/seek the packaged menu background asset to that mapped time and only send the successful VM response after media confirms the seek. Preserve pause, loop and action generation behavior. The generated bdmvkit disc must use a nonzero loop point so a test cannot pass by accidentally restarting at zero.

## Risks / Trade-offs

- FFmpeg stream-copy behavior for generated PGS may vary by build; assert the generated subtitle PID survives muxing.
- The HDMV reference implementation documents RND but does not define a protocol seed contract; the seed is a project determinism control, while range semantics are checked against the producer's observable playlist behavior and libbluray playback where available.
- Popup overlays are available only when the packaged browser has a matching menu clip/PID context. Title playback delegated to a system player cannot be overlaid. PGS extraction and parsing do not change this playback boundary.
- Cached bdmvkit code is LGPL-3.0-or-later. Keep it out of the shipped program and retain the license notice for generated fixtures.

## Verification

Unit coverage includes: bdmvkit-generated BDMV structure parsed without diagnostics; known generated MOBJ paths decoded and executed; shuffle reaches every authored item once; popup ICS retains its classification and the runtime overlays/clears it without altering video time; reachable PGS PID extraction, PGS display sets/pixels, source interval mappings, bounded serialization and SHA-256 integrity; motion menu restarts at the nonzero mark source time. Subtitle display in the title video remains out of scope for this change. Run normal package tests and the full build/typecheck after implementation. When libbluray is available, use its playback simulator against the generated disc as a secondary behavior check, not as a substitute for tests of this program.
