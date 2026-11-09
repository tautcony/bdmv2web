# 功能：媒体导出与播放交接

媒体处理分四段：算可达范围（闭包）→ 做计划 → 导出菜单媒体 → 交接正片。前三段在转换期完成，最后一段由浏览器发起、系统播放器执行。

## 1. 可达范围：媒体闭包

`computeMediaClosure(disc, movieGraph, buttonGraphs?)` 输出：

| 字段 | 含义 |
| --- | --- |
| `playlistIds` / `clipIds` / `streamIds` | 从入口出发可达的媒体 |
| `requiredNodeIds` | 必须存在的结构节点 |
| `routes` | 每条到达路径：入口、按钮程序、按并集遍历的边 |
| `unknown` | 动态目标、缺失目标、预算耗尽 |
| `complete` | 无未知项 |

有未知项时放宽到全部已声明播放列表，避免漏导；代价是包变大。`complete: false` 会进入诊断与 `notVerified`，不直接判失败。

## 2. 计划

`createMediaPlan(disc, closure, options)` 产出预转码计划：

- 每个播放列表 → `playItems[]`（时间区间、轨道、策略）与 `subPaths[]`（标 `unsupported`）。
- 策略固定 `per-play-item` / `mp4` / `h264` / `aac`，`transcodingStarted: false`。这里的 `video: "h264"` 只是该计划结构的既有字段；真实编码器由 `exportMenuLoopMedia` 的 `codec` 决定（默认 HEVC）。
- 预算按配置码率估算（默认视频 8 Mb/s、音频 192 kb/s、容器开销 5%），标 `estimateBasis: "configured-target-bitrate-assumption"`。
- 能力报告只检查 M1：无缝分支、多角度、PiP、HDR、强制字幕、TextST 标 `unsupported` 或 `unknown`，`strictUpgradeAllowed: false`。

`createMediaPlan` 当前没有被 `build` 调用；`build` 直接用 `menuLoopMediaInput` 计算单个播放列表的循环区间。

## 3. 菜单循环导出

`exportMenuLoopMedia(input, options)`：

| 阶段 | 行为 | 失败码 |
| --- | --- | --- |
| 大小 | 单个资产估算与实测由 `maxAssetBytes` 限制；整包在开始与结束时统计 | `MEDIA_ASSET_BUDGET_EXCEEDED` |
| 复用 | `overwrite` 且旧计划完全匹配 → 复用 | — |
| 工具 | `ffmpeg -version`、`ffprobe -version`、`ffmpeg -encoders`、`ffmpeg -filters` | `MEDIA_TOOL_UNAVAILABLE` / `MEDIA_ENCODER_UNAVAILABLE` |
| 探测 | `ffprobe` 源时间线、视频/音频 PID、色彩参数 | `MEDIA_VIDEO_PID_UNRESOLVED` / `MEDIA_PID_UNRESOLVED` |
| 编码 | HEVC + AAC（默认），`crf` HEVC 24 / H.264 18，`preset` `veryfast` | `MEDIA_PROCESS_FAILED` / `MEDIA_JOB_TIMEOUT` / `MEDIA_JOB_CANCELLED` |
| 校验 | 产物可被 `ffprobe` 识别，codec 与色彩标记匹配计划 | `MEDIA_OUTPUT_INVALID` |

视频编码只接受 H.264 / HEVC 源；其它编码不猜，直接报错。循环起点由 `resolveMenuLoopStart45k` 从 entry mark 取，缺省为 in 点。

### 编码参数

`build` / `convert` 接受四个菜单媒体参数，写入 `media-plan.json` 的 `encoding`：

| 参数 | 取值 | 默认 |
| --- | --- | --- |
| `--crf <n>` | 0–51 | HEVC 24 / H.264 18 |
| `--preset <name>` | `ultrafast` / `veryfast` / `fast` / `medium` | `veryfast` |
| `--codec <name>` | `h264` / `hevc` | `hevc` |
| `--hdr <mode>` | `tonemap` / `preserve` | `tonemap` |

HEVC 产物带 `-tag:v hvc1`（Safari 只认可该品牌）。四类组合都可执行；`h264` + `preserve` 写入 `MEDIA_HDR_CODEC_UNSUPPORTED` 警告。

### HDR 处理

| 源 | `tonemap` | `preserve` |
| --- | --- | --- |
| HDR10 / HLG | 转 SDR BT.709，8-bit | 保留 BT.2020/PQ，10-bit |
| SDR / 无标记 | 原标记透传，8-bit | 同左 |

`tonemap` 依赖 `zscale`（libzimg）。缺该滤镜时导出继续：按 `preserve` 编码并写入 `MEDIA_HDR_TONEMAP_UNAVAILABLE` 警告与 limitation，`media-plan.json` 的 `color.filterChain` 记为 `hdr-passthrough-fallback`。警告出现在 `manifest.json` 与 `report.json` 的 `diagnostics`（`severity: "warning"`），不改变交付状态。该产物在 SDR 显示器上对比度偏低。

Dolby Vision 只解基础层，`HDR10+` 动态元数据丢弃，均记录为 limitation。色彩标记通过 `-x264-params` / `-x265-params` 的 `colorprim` / `transfer` / `colormatrix` / `range` 写入；ffmpeg 的 `-color_trc` / `-color_primaries` 不写入 libx264 VUI。

产物：

```text
assets/media/background.mp4
assets/media/audio-<pid>-<lang>.m4a
media-plan.json
```

额外菜单播放列表写到 `assets/media/playlist-<id>/` 与 `media-plans/playlist-<id>.json`。

## 4. 线性变体（库能力）

`exportLinearMedia(plan, options)` 把多个 PlayItem 拼成一个 mp4，每个音频语言一个变体：

- 各 PlayItem 的分辨率、宽高比、采样率、声道必须一致 → 否则 `MEDIA_LINEAR_FORMAT_MISMATCH`。
- 某语言音轨不完整 → `MEDIA_AUDIO_VARIANT_INCOMPLETE`，不产出半成品。
- 输出 `linear-media-plan.json` 与资产；`build` 尚未使用这条路径。

`MediaTimelineMap` 管理播放列表时间 ↔ 包内媒体时间：同播放列表区间不得重叠，同一 `mappingId` 不得重复；45k 与 90k 输入都先归一化。`seekTimeline` 用该映射把播放列表时间换成媒体 seek 目标。

## 5. PGS 字幕

- `parsePgsSup` 解析显示集（PCS/WDS/PDS/ODS/END），输出尺寸、调色板、位图、叠加位置。
- `PgsSubtitleTimeline` 按语言选择；PTS 回绕按 epoch 延续。
- `export` 写 `.sup`；`--decode png` 写显示集 PNG，`render` 可独立从 BDMV、`.mnu` 或 `.sup` 生成 PNG；`package-builder` 把显示集序列化进 `disc-data.js` 供浏览器叠加。

当前 `build` 的主流程不自动附带 PGS 轨道；需要字幕时用 `export` 单独导出。

## 6. 正片交接

`createExternalMediaTargets(disc, closure)` 建立播放列表/PlayItem/章节 Mark → 源 M2TS 的映射，写 `external-targets.json`。

浏览器侧 `resolveExternalPlayTarget` 解析 VM 动作：

| 平台 | URL |
| --- | --- |
| macOS | `iina://open?url=<file url>&mpv_start=<seconds>` |
| Windows | `potplayer://<file url>` |
| 其它 | 明确报“External playback is available on macOS and Windows.” |

章节位置缺失时 macOS 不打开（避免复用播放器核心时沿用上一章位置）。`runtime/bdmv-config.js` 决定 BDMV 根路径，支持绝对路径、盘符路径与相对包路径，中文/空格按段编码。

## 7. 能力边界

| 能力 | 状态 |
| --- | --- |
| 菜单背景循环 | 支持（单 clip 循环或单 PlayItem 保持末帧） |
| 菜单背景 HDR | HDR10 / HLG 转 SDR BT.709；缺 tone map 滤镜时保留 HDR 标记并告警 |
| 菜单音轨切换 | 支持主音频 PSR1 对应轨道 |
| 多角度 | 不支持（计划标 `unsupported`） |
| 无缝分支 | 不支持（`MediaCapabilityImpact`） |
| PiP / 次级视频 | 不支持 |
| 正片播放 | 交给系统播放器，不做转码 |
| 字幕 | 可导出 PGS；主流程不自动打包 |

## 排查顺序

1. `ffmpeg`/`ffprobe` 是否在 `PATH`、是否带当前 `--codec` 对应的编码器（`libx265` 或 `libx264`）与 `aac`。
2. HDR 源画面偏灰时看 `media-plan.json` 的 `encoding.video.color.filterChain`：`hdr-passthrough-fallback` 表示当前 ffmpeg 缺 `zscale`（libzimg）。装好滤镜后仍复用旧资产（计划匹配不看滤镜链），需删除输出目录后重建。
3. `list` 能否看到目标 clip 与 PID。
4. `media-plan.json` 的 `playlistId`、`clipId`、`inTime45k`/`outTime45k`、`audioTracks` 是否与预期一致。
5. `--overwrite` 时是否复用了旧媒体（看计划里的编码参数与源区间）。
6. 浏览器侧 `external-targets.json` 的 `streamPath` 是否指向真实存在的 `STREAM/*.m2ts`。
