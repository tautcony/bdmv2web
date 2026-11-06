# V1 browser evidence

V1 browser acceptance targets Google Chrome and does not specify an operating system. Record the complete Chrome version, then test direct `file://` access with the network disabled. HTTP development-server results do not substitute. A cross-browser matrix is outside the V1 release gate.

**Result: 已完成 Google Chrome `file://` 实测。** The single source of that evidence is [M6-release-verification.md#v1-chrome-file-evidence](references/stages/M6-release-verification.md#v1-chrome-file-evidence); this file only indexes it. This record documents one run and does not limit the supported platform.

| Browser/full version | Scenario | Result | Date | Operator |
| --- | --- | --- | --- | --- |
| Google Chrome 156.0.8078.76 | direct `file://`, offline assets, moved directory, menu/media policy | 实测通过 | 2026-11-03 | 见 [M6 证据](references/stages/M6-release-verification.md#v1-chrome-file-evidence) |

## Known limitations

- **Menu material aspect ratio ≠ IGS scene aspect ratio is unverified.** `#menu-background` and `#menu-canvas` each use `object-fit: contain`, so the video letterboxes by its own intrinsic ratio while the canvas letterboxes by the scene ratio. When the two ratios differ, the background and the buttons can drift apart and a click can miss the visually matching button. Both committed sample discs are 16:9, so no case reproduces this yet. If such a case appears, set one shared letterbox rect on both elements from JS instead of relying on CSS per-element containment.
- Acceptance evidence records the profile, generated media paths and lengths, test matrix, and browser environment. It does not validate package bytes against a checksum.
- Direct `file://` launch, offline directory relocation, browser support matrix, real-disc rendering, and media timeline/seek accuracy remain unverified per package; they are listed in each package's `compatibility.json` and counted as `not-verified`, which does not lower the delivery status.
