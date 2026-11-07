# Proposal

## Why

UHD 菜单背景素材为 HDR10（BT.2020 + PQ，10-bit）。当前导出命令把 10-bit 像素直接截断成 `yuv420p`，不做 BT.2020→BT.709 矩阵转换，也不写色彩标记，输出的视频被浏览器按 BT.709 解释，画面呈现为整体抬升的低对比灰片。

同时 `crf` 与 `preset` 只存在于 `media-export` 的函数选项里：`package-builder` 把 `preset` 固定为 `veryfast`，CLI 没有对应参数。用户无法调整压缩强度与编码组合。

## What Changes

- 转码前探测源的色彩参数（primaries / transfer / matrix / range / 位深），识别 HDR10、HLG、Dolby Vision 基础层与 SDR。
- 新增 HDR 处理策略 `hdrMode`：`tonemap`（默认，PQ/HLG → SDR BT.709）与 `preserve`（保留 HDR，写 BT.2020/PQ 标记）。
- 默认编码器改为 HEVC（`libx265`，`-tag:v hvc1`），`--codec h264` 可切回。`crf` 默认按编码器区分：HEVC 24、H.264 18。
- `tonemap` 依赖 `zscale`（libzimg）或 `libplacebo`；两者都不可用时降级为 HDR 直通编码，写 warning 级诊断 `MEDIA_HDR_TONEMAP_UNAVAILABLE` 与 limitation，构建继续执行。
- 所有输出写入显式 VUI 色彩标记（`-x264-params` / `-x265-params` 的 `colorprim` / `transfer` / `colormatrix` / `range`）。
- 编码后校验输出标记与生效策略一致，不一致按 `MEDIA_OUTPUT_INVALID` 失败。
- `crf`、`preset`、`codec`、`hdrMode` 经 `package-builder` 与 CLI 暴露：`convert --crf`、`--preset`、`--codec`、`--hdr`。
- `media-plan.json` 记录源色彩、策略、滤镜链与输出标记，并参与媒体复用判定，策略或参数变更后不复用旧资产。
- `exportLinearMedia` 使用同一套滤镜链与标记逻辑。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `offline-media-playback`：菜单背景媒体的色彩处理、编码器选择与编码参数成为明确契约。

## Impact

`packages/media-export`（探测、滤镜链、参数、计划字段、复用判定）、`packages/package-builder`（编码参数透传）、`apps/cli`（`convert` 参数与校验）、`docs/llm-wiki`、README。

默认编码器变为 HEVC，包内菜单媒体在缺少硬件解码或 HEVC Video Extensions 的 Windows 浏览器上无法播放，文档说明症状与 `--codec h264` 回退。

## Acceptance Boundary

HDR10 源在 `tonemap` 下输出 BT.709 标记的 SDR 视频，画面对比度与色相与参考 tone mapping 一致；`preserve` 下输出 10-bit 并标记为 BT.2020/PQ。缺少 tone mapping 能力的 ffmpeg 走直通降级并给出 warning，不阻断构建。CLI 传入的 `--crf` / `--preset` / `--codec` / `--hdr` 出现在 `media-plan.json` 与实际 ffmpeg 调用中，任意组合都可执行。

浏览器 HDR 输出能力、Dolby Vision 动态元数据、HDR10+ 动态元数据不在承诺范围内。
