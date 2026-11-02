# Real IGS composition sample

`ics-menu-disc14.bin` is the 6,129-byte ICS fixture at [`yxbh/bdpl/tests/fixtures/disc14/ics_menu.bin`](https://github.com/yxbh/bdpl/blob/main/tests/fixtures/disc14/ics_menu.bin). The upstream project tests it as an Interactive Composition Segment and expects a 1920×1080 composition with four pages that contain buttons. See its [fixture test](https://github.com/yxbh/bdpl/blob/main/tests/test_ig_stream.py) and included upstream MIT license.

This file contains only the ICS body. It does not contain an M2TS, PES packet, PDS palette, ODS bitmap, audio, or video. The local positive test wraps the body in an ICS segment and a minimal END segment, then checks the parsed page and button structure. It does not validate transport extraction, pixel decoding, or menu appearance.

No source-file hash is stored.
