# Verification

## Commands and results

- `pnpm --filter @bdmv2web/bdmv-parser test` — passed, 83 tests.
- `pnpm --filter @bdmv2web/bdmv-parser typecheck` — passed.
- `pnpm --filter bdmv2web test` — passed, 72 tests across 8 files.
- `pnpm --filter bdmv2web exec vitest run tests/integration/libbluray-navigation-baseline.test.ts` — passed, 5 tests.
- `pnpm typecheck` — passed; all 11 workspace projects built and typechecked.
- `openspec validate expand-readonly-disc-inspection --type change --json` — passed, 1 change validated with no issues.
- `pnpm --filter bdmv2web exec node dist/index.js inspect '<BDMV root>' --format json --allow-partial` — passed for the local Spider-Man sample; output retained two BDJO records and one META/DL manifest.
- `bd_info '<disc root>'` — libbluray 1.5.0 reported the Spider-Man title and metadata fields recorded below.
- `bd_list_titles '<disc root>'` — 228 rows compared against parser playlists; 0 field mismatches.
- Local C probes calling libbluray 1.5.0 `mpls_parse`, `clpi_parse`, and `bdjo_parse` — selected real-file records compared field by field as listed below.

## Independent sample comparisons

Reference implementation: VideoLAN libbluray 1.5.0, pinned source revision `d75c88e54c893e5cbf4c61d356477655eb435769`, local static library and matching source headers under `.reference-cache/repositories/libbluray-1.5.0`. `bd_info` and `bd_list_titles` reported libbluray 1.5.0. Private-parser values came from local C probes linked to the same library and calling the pinned parser functions. Project values came from `bdmv2web inspect` JSON.

| Sample and source | Independent expected values | `bdmv2web` output | Result |
| --- | --- | --- | --- |
| `test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/index.bdmv` (INDX `0300`) and `MovieObject.bdmv` (MOBJ `0300`) | Checked-in libbluray baseline: 22 HDMV titles; First Play target object 0; Top Menu target object 1; title object refs `[3,5,2,4,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]`. MOBJ object 22 has four commands; command 1 bytes are `228000000000001300000000`. | Same title refs and object/command values; First Play and Top Menu sources at index offsets 82 and 94; title 0 at 108; object 22 starts at 1450 and command 1 at 1466. | Match. |
| User-provided local sample `test-data/fixtures/hdmv-navigation/disc-data/spider-man-into-the-spider-verse/BDMV/PLAYLIST/00401.mpls`, MPLS `0200` | `mpls_parse`: PlayItem at offset 70 references clip `00394`, angle count 1, STN V/A/PG/IG = 1/6/15/0; one mark at file offset 476. `bd_list_titles`: playlist 00401 has 1 clip, 1 chapter, 1 angle and V/A/PG/IG/SV/SA/DV = 1/6/15/0/0/0/0. | Same clip, angle and category counts; PlayItem source offset 70; stream sources 118–454; one mark source offset 476. Across the 228 libbluray title rows, clip count, chapter count, angle count and all seven reported stream-category counts match. | Match; 0 mismatches. |
| `test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/PLAYLIST/00000.mpls`, MPLS `0300` | `mpls_parse`: one PlayItem for clip `00004`; STN V/A/PG/IG/DV = 1/2/3/1/1 with category-local indexes matching array order. V[0] PID 4113, coding `0x24`, format/rate/range/color 8/1/1/2; DV[0] PID 4117, format/rate/range/color 6/1/2/2. There are 13 marks. SubPath 0 is type 10, repeat false, clip `00004`, in/out 27000000/356459119, sync item/PTS 0/27000000. SubPath 1 is type 3, repeat false, clip `00005`, in/out 27000000/27000000, sync item/PTS 0/0. Static metadata has range 1, primaries `(8500,39850)`, `(6550,2300)`, `(35400,14600)`, white point `(15635,16450)`, mastering luminance 1000/1, MaxCLL/MaxFALL 0/0. | Same STN categories, indexes, attributes, marks and SubPath fields. SubPath sources are 250/258 and 290/298. ExtensionData entry ID 3.5 is at offset 538, length 36, kind `staticMetadata`, with identical values. | Match. |
| `test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/CLIPINF/00060.clpi`, CLPI `0200` | `clpi_parse`: ProgramInfo has 5 streams and group count 0. PID 4113 CPI has 88 coarse and 360 fine records; coarse first `(ref=0,pts=1,spn=4)`, last `(358,57,4896449)`; fine first `(angle=false,end=3,pts=2047,spnOffset=4)`, last `(false,3,1266,50042)`. | Same header, sequence, 5 stream records and group count. CPI counts/endpoints match at offsets 404, 1100, 1108 and 2544. | Match. |
| User-provided local sample `test-data/fixtures/hdmv-navigation/disc-data/spider-man-into-the-spider-verse/BDMV/CLIPINF/00394.clpi`, CLPI `0200` | `clpi_parse`: rate 6,000,000, 4,662,784 source packets, 2 ATC deltas, 22 streams, one CPI map for PID 4113 with 76 coarse and 341 fine records; endpoints `(0,1,5)`, `(340,44,4649004)`, `(false,3,2047,5)`, `(false,4,6,61484)`. | Same header, deltas, stream count and CPI values at offsets 842, 1442, 1450 and 2810. | Match. |
| `test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/CLIPINF/00004.clpi`, CLPI `0300` | `clpi_parse`: rate 13,625,000, 445,310,592 source packets, 7 streams, group count 0. PID 4113 CPI: 4078 coarse/7661 fine; coarse first `(0,102,4)`, last `(7657,1359,445294566)`; fine first `(false,1,1020,4)`, last `(false,1,1657,57091)`. PID 4117 CPI: 4092/7661; coarse first `(0,102,21)`, last `(7657,1359,445295292)`; fine first `(false,1,1020,21)`, last `(false,1,1657,57120)`. The table at offset 127124 has zero length. | Header, streams, both CPI map counts and all endpoints match at offsets 468, 33084, 33092, 63732, 63740, 96468, 96476 and 127116. Empty ExtensionData returns `[]` with no `BDMV_INVALID_SECTION` diagnostic. | Match. |
| User-provided local sample `test-data/fixtures/hdmv-navigation/disc-data/spider-man-into-the-spider-verse/BDMV/BDJO/00000.bdjo` and `00001.bdjo`, BDJO `0200` | `bdjo_parse`: both files have font `*****`, HAVi 1, title search enabled, one cache entry `(1,00000,*.*)`, access-to-all enabled, autostart false and no listed playlists. Application 0 is `(org=2147448425, app=16464, control=2, type=1, priority=1, binding=1, visibility=1)` named `eng:StandardMenuXlet`; application 1 is `(2147448425,16384,1,1,1,3,1)` named `eng:TitleBoundXlet`. Both have profiles 1.1.0/1.1.1/2.1.0, empty icon/classpath/parameters and base `00000`; initial classes are `com.spe.radius.StandardMenuXlet` and `com.spe.radius.TitleBoundXlet`. All key-interest bits are false; file-access path is `.`. `menuCallMask` is false for 00000 and true for 00001. | Every listed value matches. Sources identify terminal info at offset 52, cache 68, playlists 84, applications 94 and 202, key interests 306, and file-access path 310. | Match for both records. |
| User-provided local sample `test-data/fixtures/hdmv-navigation/disc-data/spider-man-into-the-spider-verse/BDMV/META/DL/bdmt_eng.xml`, language `eng` | XML and libbluray `bd_info`: name `Spider-Man: Into the Spider-Verse – Blu-ray™`, alternative absent, set 1/1, title 1 `Menus BDJO`, thumbnails `jacket_416.jpg` and `jacket_640.jpg`. | Same fields. Title source offset 368; thumbnails 460 and 506. | Match. |

Two sample-specific parser corrections are covered by the comparisons and parser tests:

- META/DL element matching uses XML local names, so namespace-prefixed `di:` fields are returned.
- An ExtensionData table with declared length zero returns an empty entry list. The Battle Royale CLPI record at offset 127124 produces no invalid-section diagnostic.

## Evidence status

- Real sample fields checked against libbluray cover INDX/MOBJ baselines and selected MPLS/CLPI `0200`/`0300` records. The local Spider-Man sample adds MPLS `0200`, CLPI `0200`, BDJO `0200`, and META/DL `eng` comparisons.
- The Spider-Man sample contains 242 MPLS files; libbluray lists 228 title rows. Every listed row matches on clip count, chapter count, angles, and V/A/PG/IG/SV/SA/DV counts.
- INDX AppInfoBDMV and UHD fields, MPLS alternate-angle and secondary-stream variants, CLPI ClipMark/nonzero group/nonempty typed ExtensionData records, other BDJO versions, other META/DL languages, and sound fields remain `unverified`.
- Candidate versions `0100` and `0240` have no real sample in the current fixture corpus. Project-authored fixtures include `0100` INDX, MOBJ, and sound records.
- Unknown ExtensionData payload semantics remain `unverified`. BD-J execution, multi-angle playback, SubPath playback, and media decoding remain `unsupported`.
