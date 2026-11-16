# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-11-16

### Changed

- Scan each transport stream clip once for IGS extraction, reuse the scan for PGS extraction, and reduce repeated byte copies.
- Cache the PMT decision for each IGS assembler revision.
- Share HDMV call-trail history across checkpoints and reuse trace snapshots when playback state and call stack are unchanged.
- Reduce garbage-collection pressure in HDMV VM execution, media-closure analysis, and IGS processing.
- Reduce repeated media-closure walks and route-deduplication work; reuse encoded menu scenes, media plans, and indexed lookups during packaging.
- Expand performance measurements for real SUP tracks, whole-clip extraction and export, HDMV traces, and menu loops; add trend, hotspot, and distribution views.

### Fixed

- Resolve relative CLI path arguments from the directory where the command was entered.
- Align menu stop, resume, and playback handoff behavior with the corresponding libbluray behavior, and report a missing handoff source.
- Resolve statically provable title jumps when computing the media closure.
- Report only package-audit checks that actually ran and consolidate package reports.
- Preserve the primary playlist identity when assembling packages from prepared media.

## [0.2.0] - 2026-11-15

### Added

- Add the `visualize` command for exploring the HDMV navigation graph.
- Add local Java runtime support for BD-J menus, including on-demand host API JAR builds and packaged, deduplicated menu media.
- Add cross-process benchmark measurement, comparison, coverage reporting, and performance workflow support.
- Add read-only BDMV inspection coverage for additional structures and metadata, with a real Spider-Man disc fixture.

### Changed

- Make CLI build and export options explicit; fold graphics extraction into `export` output types and support graphics export and rendering from a single transport-stream file.
- Keep `list` metadata-only and group asset rows by M2TS file with payload sizes.
- Resolve statically provable title jumps during media-closure planning.
- Reuse menu scene encodings, media plans, and package indexes instead of repeatedly adapting and storing the same data.
- Update Node.js engine support, package entry points, IGS activation, and generated-package playback instructions.
- Improve image decode and encode costs, PNG compression, lazy PGS pixel handling, and repeated disc reads.

### Fixed

- Correct menu playback stop and resume behavior, including `PLAY_STOP` handling and warnings for missing handoff sources.
- Honor declared stream metadata during media conversion and align menu playback and stream-copy behavior with libbluray.
- Fix BD-J playback timing and runtime issues, Windows path handling, UNC path normalization, and reference-cache aliases.
- Report package audit results from the checks that actually ran.

## [0.1.1] - 2026-11-07

### Changed

- Update the published package version to `0.1.1`. This release contains no feature or code changes relative to `0.1.0`.

## [0.1.0] - 2026-11-07

### Added

- Add BDMV structure inspection and parsing for indexes, playlists, clip information, MovieObjects, BD-J objects, and related records, with source locations and diagnostics.
- Add a bounded HDMV navigation VM that executes menu navigation and IGS button commands and records execution traces.
- Extract IGS scenes, buttons, palettes, and object graphics from BDMV streams and MNU containers; render graphics assets as PNG files.
- Build disc-specific menus as offline web packages with navigation, menu media, playback plans, status, and diagnostic reports.
- Export menu video, audio, and subtitle assets and hand title playback off to a system media player.
- Run BD-J menus through a local Java runtime.
- Add the `inspect`, `list`, `export`, `render`, `build`, `validate`, `compare`, `serve`, and `visualize` CLI commands; provide `convert` as an alias for `build`.
- Add resumable asset reuse, media conversion progress, HDR-to-SDR tone mapping through FFmpeg, release audit reports, and npm package publishing workflows.

[Unreleased]: https://github.com/tautcony/bdmv2web/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/tautcony/bdmv2web/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/tautcony/bdmv2web/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/tautcony/bdmv2web/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/tautcony/bdmv2web/releases/tag/v0.1.0
