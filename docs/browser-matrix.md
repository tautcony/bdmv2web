# V1 browser evidence

V1 targets macOS Google Chrome only. Record the actual OS build and complete Chrome version, then test direct `file://` access with the network disabled. HTTP development-server results do not substitute. Other operating systems and browsers are outside the V1 release gate.

**Result: 已完成 macOS Chrome `file://` 实测，证据未绑定制品指纹。** The single source of that evidence is [M6-release-verification.md#v1-chrome-file-evidence](references/stages/M6-release-verification.md#v1-chrome-file-evidence); this file only indexes it. "未绑定制品指纹" means the run is not tied to the payload hash of one specific commit's package, not that the scenarios were skipped.

| OS/build | Browser/full version | Scenario | Artifact/payload hash | Result | Date | Operator |
| --- | --- | --- | --- | --- | --- | --- |
| macOS 27.2 (26B123) | Google Chrome 156.0.8078.76 | direct `file://`, offline assets, moved directory, menu/media policy | 未记录（见链接证据） | 实测通过（证据未绑定制品指纹） | 2026-11-03 | 见 [M6 证据](references/stages/M6-release-verification.md#v1-chrome-file-evidence) |
