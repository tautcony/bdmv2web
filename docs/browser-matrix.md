# V1 browser evidence

V1 targets macOS Google Chrome only. Record the actual OS build and complete Chrome version, then test direct `file://` access with the network disabled. HTTP development-server results do not substitute. Other operating systems and browsers are outside the V1 release gate.

**Result: 已完成 macOS Chrome `file://` 实测，证据未绑定制品指纹。** The single source of that evidence is [M6-release-verification.md#v1-chrome-file-evidence](references/stages/M6-release-verification.md#v1-chrome-file-evidence); this file only indexes it. "未绑定制品指纹" means the run is not tied to the payload hash of one specific commit's package, not that the scenarios were skipped.

| OS/build | Browser/full version | Scenario | Artifact/payload hash | Result | Date | Operator |
| --- | --- | --- | --- | --- | --- | --- |
| macOS 27.2 (26B123) | Google Chrome 156.0.8078.76 | direct `file://`, offline assets, moved directory, menu/media policy | 未记录（见链接证据） | 实测通过（证据未绑定制品指纹） | 2026-11-03 | 见 [M6 证据](references/stages/M6-release-verification.md#v1-chrome-file-evidence) |

## Known limitations

- **Menu material aspect ratio ≠ IGS scene aspect ratio is unverified.** `#menu-background` and `#menu-canvas` each use `object-fit: contain`, so the video letterboxes by its own intrinsic ratio while the canvas letterboxes by the scene ratio. When the two ratios differ, the background and the buttons can drift apart and a click can miss the visually matching button. Both committed sample discs are 16:9, so no case reproduces this yet. If such a case appears, set one shared letterbox rect on both elements from JS instead of relying on CSS per-element containment.
- `file://` acceptance evidence is not bound to the payload fingerprint of a specific commit (see the table above).
- Direct `file://` launch, offline directory relocation, browser support matrix, real-disc rendering, and media timeline/seek accuracy remain unverified per package; they are listed in each package's `compatibility.json` and counted as `not-verified`, which does not lower the delivery status.
