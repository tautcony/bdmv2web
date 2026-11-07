# Browser verification

V1 browser acceptance targets Google Chrome and does not specify an operating system. Record the complete Chrome version, then test direct `file://` access with the network disabled. HTTP development-server results do not substitute. A cross-browser matrix is outside the V1 release gate.

**Result: 已完成 Google Chrome `file://` 实测。** The single source of that evidence is [M6-release-verification.md#v1-chrome-file-evidence](../references/stages/M6-release-verification.md#v1-chrome-file-evidence); this file only indexes it. This record documents one run and does not limit the supported platform.

| Browser/full version | Scenario | Result | Date | Operator |
| --- | --- | --- | --- | --- |
| Google Chrome 156.0.8078.76 | direct `file://`, offline assets, moved directory, menu/media policy | 实测通过 | 2026-11-03 | 见 [M6 证据](../references/stages/M6-release-verification.md#v1-chrome-file-evidence) |

## Coverage

The recorded run covers direct `file://` launch, offline resource loading, directory relocation, menu navigation, and the media policy for that generated package. Cross-browser support and real-disc coverage are recorded only where the [M6 evidence](../references/stages/M6-release-verification.md) states them.

- `compatibility.json` describes evidence per generated package. A package without supplied browser or media evidence records those checks as `not-verified`; the Chrome run above is not attributed to other packages.
- Acceptance evidence binds the profile, generated media paths, test matrix, and browser environment.
- Both committed samples use a 16:9 menu material and a 16:9 IGS scene. `#menu-background` and `#menu-canvas` each use `object-fit: contain`, so a package whose two ratios differ letterboxes them differently and a click can miss the visually matching button. Such a package needs one shared letterbox rect set on both elements from JS.
- Real-disc rendering and media timeline/seek accuracy are covered only by the scenarios listed in the [M6 evidence record](../references/stages/M6-release-verification.md).
