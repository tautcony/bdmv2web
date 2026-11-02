# Protocol support boundary (M1)

核验日期：2026-11-02。此表记录 M1 实现的结构解析范围和证据状态。它不声明 Blu-ray Disc Association (BDA) 格式一致性。M1 尚未取得可直接用于字段核验的受限 BDA 规范书；开源解析器只作为交叉参考。

## Status rules

- `unverified`: implementation and/or synthetic parser fixtures exist, but normative field validation and representative independent media evidence are incomplete.
- `unsupported`: the product intentionally does not implement the named execution or playback behavior.
- `supported`: not assigned in M1. No format or version is currently declared supported.

Fixtures in `packages/test-fixtures` are project-authored binary byte builders and hand-authored expectations. They test parser behavior and boundaries. They do not prove protocol correctness. Do not promote a row to `supported` until a normative source or otherwise approved field basis, exact revision/locations, independent expected values, positive and negative fixtures, and implementation results are recorded.

## M1 structure

| Format / behavior | Implemented structural fields | Status | Local cross-reference and pinned revision | Project fixture / expectation |
| --- | --- | --- | --- | --- |
| INDX candidate versions `0100`, `0200`, `0300` | First Play, Top Menu and Title type, target, playback/access attributes; mixed HDMV/BD-J preserved | unverified | `.reference-cache/libbluray-1.5.0/src/libbluray/bdnav/index_parse.c` (VideoLAN libbluray commit `d75c88e54c893e5cbf4c61d356477655eb435769`); cache hash/bytes: `docs/references/cache-manifest.json` | `m1-index-mixed-entry`; fixture expected target IDs are literal fields in `packages/test-fixtures/src/bdmv.ts` |
| MOBJ candidate versions `0100`, `0200`, `0300` | Object flags, count, three raw 32-bit words per 12-byte command, byte-exact command payload and source offset | unverified | `.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/mobj_parse.c` (same pinned commit) | `m1-mobj-two-raw-instructions`; two literal 12-byte commands and offsets are hand-authored |
| MPLS candidate versions `0100`, `0200`, `0300` | PlayItem clip/time/UO/connection/angle declarations, STN stream declarations, PlayMarks, SubPath and SubPlayItem records | unverified | `.reference-cache/libbluray-1.5.0/src/libbluray/bdnav/mpls_parse.c` (same pinned commit); `.reference-cache/libhdmv-2026-03/crates/bdmv-parse/src/mpls.rs` (liminal-hq/libhdmv commit `ec0e5b27d2852ca6b008719f66aa3324c0b43f28`, Alpha cross-check only) | `m1-empty-mpls`, `m1-mpls-two-items-and-marks`, `m1-mpls-stn-audio-pid`, `m1-mpls-subplayitem`; parser tests check two items/times, angle/SubPath/SubPlayItem retention, enclosing STN/SubPath bounds, valid and out-of-range Mark, and matching/mismatching STN/CLPI PIDs |
| CLPI candidate versions `0100`, `0200`, `0300` | ProgramInfo stream PIDs/coding/language and CPI coarse/fine access points | unverified | `.reference-cache/libbluray-1.5.0/src/libbluray/bdnav/clpi_parse.c` (same pinned commit); `.reference-cache/libhdmv-2026-03/crates/bdmv-parse/src/clpi.rs` (same Alpha cross-check commit) | `m1-empty-clpi`, `m1-clpi-program-cpi`; parser tests check literal ProgramInfo PID/language/coding, CPI PTS/SPN values and a CPI section bound failure |
| sound candidate versions `0100`, `0200`, `0300` | Sound table channel/rate/sample coding and bounded sample byte ranges; no WAV conversion | unverified | `.reference-cache/libbluray-1.5.0/src/libbluray/bdnav/sound_parse.c` (same pinned commit) | `m1-single-sound-range`, `m1-sound-two-ranges`; parser tests check two ranges and an out-of-file range failure; no WAV output is produced |
| Directory discovery and backup selection | Direct root/parent discovery; metadata-only primary/backup choice; STREAM files are registered but not loaded into parser buffers | unverified | Stage policy in `openspec/changes/parse-bdmv-structure/design.md`; reference backup call sites in cached `index_parse.c`, `mobj_parse.c`, `mpls_parse.c`, `clpi_parse.c` | Parser tests cover missing/damaged/unsupported/conflicting index cases and backup-only MPLS/CLPI. Case-variant ambiguity cannot be created on the current case-insensitive filesystem. |
| Dynamic navigation and BD-J | Raw commands retained; command target edges stay unresolved; BD-J declaration retained and marked unsupported | unsupported for execution | Container reference only: cached `mobj_parse.c`; dynamic command interpretation belongs to M3 | `m1-mobj-two-raw-instructions`; no VM/Java execution fixture in M1 |
| Multi-angle/SubPath playback, TS parsing, media decoding | Declarations are retained for downstream analysis only | unsupported for playback in this stage | `openspec/changes/parse-bdmv-structure/design.md`; TS/VM work is owned by downstream changes | MPLS structure fixture checks retention only; no playback claim |

## Normative and fixture gaps

- The applicable BDA BDMV/HDMV specification books are agreement-gated. The public BDA access page and 2017 book chart are not field-level normative sources; details are recorded in `docs/references/sources.json` and `docs/references/README.md`.
- The libbluray 1.5.0 source is an implementation reference under LGPL-2.1, not a conformance oracle. libhdmv is Alpha and is not treated as independent evidence.
- No commercial media is included. Project-authored bytes test known parser branches only and do not establish the correct interpretation of real discs. No independent media-derived expected values are available for any implemented field.
- M1 currently has no field-level BDA normative source. As a result, all candidate version sets and parsed layouts remain `unverified`, even where positive and negative synthetic fixtures pass.
- Case-variant BDMV ambiguity is conditionally tested only when the filesystem allows both names; the current case-insensitive workspace filesystem cannot exercise that branch. The test records this limitation.
- This implementation does not validate full sequence information, all CLPI extension/mark sections, all MPLS advanced playback semantics, MovieObject command targets, BD-J programs, transport streams, or media payload decoding. Those are outside the M1 structural boundary or remain unverified for later stages.
- Unknown versions are rejected and are not hidden by backup fallback. This version gate is a conservative implementation rule, not evidence that the listed candidate versions are normatively complete.
