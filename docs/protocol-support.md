# Protocol support boundary (M1)

核验日期：2026-11-02。此表记录 M1 实现的结构解析范围和证据状态。主要行为依据为固定 revision 的开源实现；对适用范围外、版本差异和实现冲突必须单独记录。BDA 历史公开白皮书只作其明确覆盖范围内的格式/架构背景，不是规范正文，也不替代实现证据或测试。

## Evidence tiers

- `implementation-reference`: behavior is traced to a pinned implementation revision, exact file/location, and applicable license. For BDMV/HDMV the primary reference is VideoLAN libbluray 1.5.0, commit `d75c88e54c893e5cbf4c61d356477655eb435769`, LGPL-2.1. It establishes what that implementation does within its tested scope.
- `cross-reference`: another pinned implementation or a public whitepaper is used only where its source and scope are explicit. Whitepaper references include title/version and printed page(s); they provide background, not normative requirements.
- `project-test`: synthetic fixtures and assertions prove the behavior of this code only. Independent golden data records its source, version/case, derivation or comparison method, and limits. Same-lineage forks or ports are not independent by default.
- `unverified`: implementation/tests exist but cross-checks or path coverage are incomplete, or independent expected values are missing. Lack of licensed BDA text alone does not block implementation.
- `unsupported`: the product intentionally does not implement the named execution or playback behavior.

## Status rules

- `unverified`: implementation and/or project tests exist, but stated evidence scope, cross-checks, or independent expected values remain incomplete.
- `unsupported`: the product intentionally does not implement the named execution or playback behavior.
- `supported`: not assigned in M1. No format or version is currently declared supported.

Fixtures in `packages/test-fixtures` are project-authored binary byte builders and hand-authored expectations. They test parser behavior and boundaries, not independent protocol correctness. For each behavior record evidence tier, exact source revision/file/license, applicable whitepaper title/version/page, test/golden provenance, and conflict or unsupported scope. The pinned implementation is the primary behavior reference; project tests and independent goldens record the validation actually completed.

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
| M1→M2/M3 ParsedDisc handoff | Entry→MovieObject, MPLS/CLPI track PID and coding declaration, raw command source, and M2 IGS scene source | unverified | Parser model plus consumer APIs; no protocol claim | `m1-m2-m3-source-handoff` in `packages/igs/test/m1-m2-m3.integration.test.ts`; parser success remains `analysisStage=structural` and `supportPrediction.status=partial` |

The parser's version gate accepts only the candidate tags shown above. Unknown primary versions are rejected before a format is returned; `packages/bdmv-parser/src/parser.test.ts` checks this for MOBJ, MPLS, CLPI and sound, and checks that an older backup does not mask an unknown primary INDX version. This gate is a conservative parser boundary. It does not prove that the candidate versions or field layouts are fully validated.

## Evidence and fixture gaps

- BDA specification books are agreement-gated. Public BDA whitepapers listed in `.reference-cache/specs/SOURCE.md` provide only explicitly scoped background; they do not define field-level BDMV/HDMV behavior.
- The primary implementation reference is libbluray 1.5.0 under LGPL-2.1. libhdmv is Alpha and is not treated as independent evidence; inspect source lineage before treating any cross-check as independent.
- No commercial media is included. Project-authored bytes test known parser branches only and do not establish the correct interpretation of real discs. No independent media-derived expected values are available for any implemented field.
- Candidate versions and parsed layouts remain `unverified` where source/test coverage or independent expected values are incomplete; lack of BDA text alone is not the reason.
- Case-variant BDMV ambiguity is conditionally tested only when the filesystem allows both names; the current case-insensitive workspace filesystem cannot exercise that branch. The test records this limitation.
- This implementation does not validate full sequence information, all CLPI extension/mark sections, all MPLS advanced playback semantics, MovieObject command targets, BD-J programs, transport streams, or media payload decoding. Those are outside the M1 structural boundary or remain unverified for later stages.
- Unknown versions are rejected and are not hidden by backup fallback. This version gate is a conservative implementation rule, not evidence that the listed candidate versions are normatively complete.
