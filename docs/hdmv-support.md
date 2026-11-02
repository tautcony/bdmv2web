# HDMV navigation support matrix

This matrix records what the current implementation decodes and what it executes. `reference-only / unverified` means the encoding or behavior is observed in pinned open source code but has no verified BDA clause or independent golden in this repository. It is not a Blu-ray conformance claim. `unverified / faults` means the decoder recognizes the field combination but the VM stops with a diagnostic instead of guessing.

## Evidence and encoding

The parser-facing input is M1 `MovieInstruction`: three big endian uint32 `words`, 24 hex characters in `bytes`, and `SourceLocation { path, origin, offset }`. The decoder validates that the words reproduce the raw bytes. Button command streams use the same `RawCommand` interface and decoder.

The field layout below is the layout implemented by the pinned `libbluray` MOBJ reader. It is implementation evidence only:

| Word 0 bits | Field | Notes |
| --- | --- | --- |
| 31–29 | operand count | libbluray reads 3 bits |
| 28–27 | group | 0 branch, 1 compare, 2 set; 3 unknown |
| 26–24 | subgroup | branch: GOTO/JUMP/PLAY; set: SET/SETSYSTEM |
| 23, 22 | immediate operand 1, 2 | Reserved or ignored when an operand is not present |
| 21–20 | reserved | Nonzero is rejected |
| 19–16 | branch option | Branch subgroup option |
| 15–12 | reserved | Nonzero is rejected |
| 11–8 | compare option | Compare operation |
| 7–5 | reserved | Nonzero is rejected |
| 4–0 | set option | Arithmetic or SETSYSTEM operation |
| Word 1, Word 2 | operands | Raw uint32 values; register references are checked before access |

Evidence references:

- `LIBBLURAY-1.5.0`, commit `d75c88e54c893e5cbf4c61d356477655eb435769`: `src/libbluray/hdmv/mobj_parse.c` parses the 12-byte fields; `hdmv_insn.h` enumerates options; `hdmv_vm.c` dispatches and performs a subset of semantics; `register.h` and `register.c` define implementation register counts, PSR names, and defaults. Local cache: `.reference-cache/libbluray-1.5.0/`.
- `LIBHDMV-2026-03`, commit `ec0e5b27d2852ca6b008719f66aa3324c0b43f28`, is Alpha and is **not used as a golden**: its decoder field layout and PSR index names conflict with libbluray. Local cache: `.reference-cache/libhdmv-2026-03/`.
- BDA specification text is agreement-gated and is not cached. See `docs/references/sources.json` and `docs/references/cache-manifest.json`.
- M3 test-only synthetic vectors are in `packages/hdmv/src/fixtures.ts`. They test this implementation’s parser/executor contracts; they are not independent protocol goldens or media-derived evidence.

## Opcode inventory

`PC` means current instruction index. Unless stated otherwise, an ordinary command advances to the next command. Operand counts and field names below describe the libbluray parser/dispatch at the pinned revision. Every operation remains `unverified` against BDA normative text; M3 fixtures are synthetic unit vectors rather than independent protocol goldens. The VM executes the rows marked “executes” and faults the rows marked “faults.”

| Fields | Opcode | Operands | PC / call state | Action / wait | State / fixture |
| --- | --- | ---: | --- | --- | --- |
| g0/s0/branch0 | NOP | 0 | next | none | executes; `m3-raw-command-decoder` |
| g0/s0/branch1 | GOTO | 1 | direct local PC; range checked | none | executes; `m3-loop-budget` |
| g0/s0/branch2 | BREAK | 0 | stop | none | executes |
| g0/s1/branch0 | JUMP_OBJECT | 1 | target object PC 0; range checked | none | executes; `m3-object-call-resume` |
| g0/s1/branch1 | JUMP_TITLE | 1 | async continuation | `TITLE_SEARCH`, waits `started` | executes as reference-only action |
| g0/s1/branch2 | CALL_OBJECT | 1 | saves current object/next PC, enters object; bounded stack | none | executes; `m3-object-call-resume` |
| g0/s1/branch3 | CALL_TITLE | 1 | title call/resume context not implemented | none | faults `HDMV_UNVERIFIED_OPCODE` |
| g0/s1/branch4 | RESUME | 0 | restores saved object/PC; empty stack faults | none | executes; `m3-object-call-resume` |
| g0/s2/branch0 | PLAY_PL | 1 | async continuation | `PLAY_PLAYLIST`, waits `started` | executes; `m3-async-playlist-resume` |
| g0/s2/branch1 | PLAY_PL_PI | 2 | async continuation | `PLAY_PLAYLIST_ITEM`, waits `started` | executes; no independent golden |
| g0/s2/branch2 | PLAY_PL_PM | 2 | async continuation | `PLAY_PLAYLIST_MARK`, waits `started` | executes; no independent golden |
| g0/s2/branch3 | TERMINATE_PL | 0 | async continuation | `PLAY_STOP`, waits `ended` | executes; no independent golden |
| g0/s2/branch4 | LINK_PI | 1 | async continuation | `LINK_PLAY_ITEM`, waits `seeked` | executes; no independent golden |
| g0/s2/branch5 | LINK_MK | 1 | async continuation | `LINK_PLAY_MARK`, waits `seeked` | executes; no independent golden |
| g1/cmp1 | BC | 2 | skips next command when libbluray bit predicate is true | none | executes; no independent golden |
| g1/cmp2 | EQ | 2 | skips next command when unequal | none | executes; `m3-compare-next-command` |
| g1/cmp3 | NE | 2 | skips next command when equal | none | executes; no independent golden |
| g1/cmp4 | GE | 2 | skips next command when less | none | executes; no independent golden |
| g1/cmp5 | GT | 2 | skips next command when less/equal | none | executes; no independent golden |
| g1/cmp6 | LE | 2 | skips next command when greater | none | executes; no independent golden |
| g1/cmp7 | LT | 2 | skips next command when greater/equal | none | executes; no independent golden |
| g2/s0/set1 | MOVE | 2 | next; immediate destination faults | none | executes; `m3-register-arithmetic` |
| g2/s0/set2 | SWAP | 2 | next; both destinations must be GPR | none | executes; no independent golden |
| g2/s0/set3 | ADD | 2 | next; libbluray saturates at uint32 max | none | executes; `m3-register-arithmetic` |
| g2/s0/set4 | SUB | 2 | next; libbluray saturates below zero to zero | none | executes; no independent golden |
| g2/s0/set5 | MUL | 2 | next; libbluray saturates at uint32 max | none | executes; no independent golden |
| g2/s0/set6 | DIV | 2 | next; zero divisor yields uint32 max in libbluray | none | executes; no independent golden |
| g2/s0/set7 | MOD | 2 | next; zero divisor yields uint32 max in libbluray | none | executes; no independent golden |
| g2/s0/set8 | RND | 2 | random state/seed contract absent | none | faults `HDMV_UNVERIFIED_OPCODE` |
| g2/s0/set9 | AND | 2 | next | none | executes; no independent golden |
| g2/s0/set10 | OR | 2 | next | none | executes; no independent golden |
| g2/s0/set11 | XOR | 2 | next | none | executes; no independent golden |
| g2/s0/set12 | BITSET | 2 | next; bit index must be 0–31 | none | executes; no independent golden |
| g2/s0/set13 | BITCLR | 2 | next; bit index must be 0–31 | none | executes; no independent golden |
| g2/s0/set14 | SHL | 2 | next; shift must be 0–31 | none | executes; no independent golden |
| g2/s0/set15 | SHR | 2 | next; logical shift, amount 0–31 | none | executes; no independent golden |
| g2/s1/set1 | SET_STREAM | 2 | next | emits raw operand words in `SET_STREAM`; no inferred stream mapping | executes as raw action; unverified |
| g2/s1/set2 | SET_NV_TIMER | 2 | next | emits timer request; no timer service | executes as action; unverified |
| g2/s1/set3 | SET_BUTTON_PAGE | 2 | next | emits raw operand words; no inferred page mapping | executes as raw action; unverified |
| g2/s1/set4 | ENABLE_BUTTON | 1 | next | emits button action | executes as action; unverified |
| g2/s1/set5 | DISABLE_BUTTON | 1 | next | emits button action | executes as action; unverified |
| g2/s1/set6 | SET_SEC_STREAM | 2 | next | emits raw operand words in `SET_SECONDARY_STREAM` | executes as raw action; unverified |
| g2/s1/set7 | POPUP_OFF | 0 | next | emits `POPUP_OFF` | executes as action; unverified |
| g2/s1/set8 | STILL_ON | 0 | async continuation | emits `STILL_ON`, waits `still-completed` | executes as action; unverified |
| g2/s1/set9 | STILL_OFF | 0 | next | emits `STILL_OFF` | executes as action; unverified |
| g2/s1/set10 | SET_OUTPUT_MODE | 1 | not implemented | none | faults `HDMV_UNVERIFIED_OPCODE` |
| g2/s1/set11 | SET_STREAM_SS | 2 | not implemented | none | faults `HDMV_UNVERIFIED_OPCODE` |
| g2/s1/set16 | libbluray `SETSYSTEM_0x10` | 2 | private/unknown semantics | none | faults `HDMV_UNVERIFIED_OPCODE` |
| other | Unknown opcode/group/subgroup or illegal combination | raw preserved | fault; no silent no-op | none | faults with source/raw diagnostic |

The implementation does not claim normative support for any opcode. Several implemented operations use a single reference implementation and lack independent expected-state fixtures; the action payloads for stream and button-page commands deliberately preserve raw words instead of guessing their bit semantics.

## Register matrix

| Register family | Count | Access and initialization | Evidence status |
| --- | ---: | --- | --- |
| GPR | 4096 | uint32; program reads/writes; initialized to zero | count and access pattern from libbluray `register.h` / `hdmv_vm.c`; normative behavior unverified |
| PSR | 128 | uint32; program reads; program writes rejected; host/system updates use a separate method | count, PSR indices and program-write rejection observed in libbluray; normative behavior unverified |
| PSR 0–14, 16–22, 30, 36–44, 48–61 | subset named/initialized by reference | libbluray scalar defaults copied where explicit; language/country/region/output profile can be overridden | implementation defaults only; no BDA clause verified |
| PSR capability fields 15, 23–29, 31 | player/profile dependent | caller supplies raw values via `PlayerProfile.capabilityValues`; unspecified values use the simulation default | unverified; profile bit layout and standard defaults are not asserted |
| Reserved/other PSR | remaining | zero in this VM profile | not declared standard default; unverified |

`PlayerProfile` maps audio, subtitle, menu language, country, region, output preference and caller-provided capability words into PSRs. Every reset emits a deterministic profile record into trace. The current defaults are an implementation profile, not a standards-complete player profile.

## VM, bridge, trace, and analysis boundary

The VM has `idle`, `running`, `suspended`, `stopped`, and `faulted` states. Actions allocate a generation before publication. A continuation accepts only a matching `generation` and `responseTo`; unrelated, stale, and duplicate events are traced and ignored. Navigation input is rejected with a trace diagnostic while a media continuation is suspended, so it cannot overwrite the saved resume point. Media errors and unavailable events end the matching wait as `stopped` with a diagnostic. Pending action queue size, call depth, and instructions per turn have separate bounds.

Wait conditions (`started`, `seeked`, `ended`, `still-completed`) are explicit application policy and need later bridge validation. A seek wait consumes the domain event `MEDIA_SEEKED`; ordinary `TIME_UPDATED` events do not resume it. `MENU_INPUT` from keyboard or pointer shares a normalized `uoAllowed` gate; mapping disc-specific UO mask bits into that gate is not implemented here. Static graph analysis retains dynamic targets, unresolved resume/play edges, unknown commands, and budget exhaustion as unresolved rather than unreachable.

No DOM, media element, renderer, decoder, BD-J execution, or disk access is part of this package. The independent-golden acceptance requirement remains open: the current repository has no normative HDMV text or independent Compare/Call/Resume/media-resume expected-state vectors.
