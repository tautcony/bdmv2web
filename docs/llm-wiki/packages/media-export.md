# `@bdmv2web/media-export`

媒体层：从导航图算可达播放列表（闭包），生成可追溯的媒体计划，调用 `ffmpeg`/`ffprobe` 导出菜单背景与音轨，处理 PGS 字幕与外部播放目标。

## 文件

| 文件 | 内容 | 被谁使用 |
| --- | --- | --- |
| `src/closure.ts` | `computeMediaClosure` | CLI `convert`、库调用 |
| `src/media-plan.ts` | `createMediaPlan` | 库/测试（`convert` 未调用） |
| `src/index.ts` | `exportMenuLoopMedia`、`extractPgsTrack`、`pidSpecifier`、`durationSeconds`、`resolveMenuLoopStart45k`、`runMediaProcess` | CLI、`package-builder` |
| `src/linear.ts` | `exportLinearMedia`、`primaryAudioStreamNumberForLanguage` | 库/测试（`convert` 未调用） |
| `src/pgs.ts` | `parsePgsSup`、`PgsSubtitleTimeline` | CLI 资产导出、`runtime-web` 的字幕数据 |
| `src/timeline.ts` | `MediaTimelineMap`、`normalizeSourceTime` | 库/测试 |
| `src/seek.ts` | `seekTimeline`、`MEDIA_HAVE_METADATA`/`MEDIA_HAVE_CURRENT_DATA` | 库/测试 |
| `src/external-targets.ts` | `createExternalMediaTargets`、`resolveExternalPlayTarget` | CLI、`runtime-web` |
| `src/budget.ts` | `estimateMenuLoopBudget`、`assertEstimateWithinLimit`、`assertActualWithinLimit` | `index.ts` |

## 错误类型

`exportMenuLoopMedia` 与 `exportLinearMedia` 抛出两类带 `diagnostic` 字段的错误，调用方据此取码而不是解析 `message`：

| 类 | `diagnostic.code` 取值 |
| --- | --- |
| `MediaToolError` | `MEDIA_TOOL_UNAVAILABLE`、`MEDIA_TOOL_COMMAND_FAILED`、`MEDIA_ENCODER_UNAVAILABLE`，另带 `executable`/`args` |
| `MediaJobError` | `MEDIA_JOB_CANCELLED`、`MEDIA_JOB_TIMEOUT`、`MEDIA_PROCESS_FAILED`、`MEDIA_OUTPUT_INVALID`，另带可选 `executable`/`args` |

预算类失败（`MEDIA_ASSET_BUDGET_EXCEEDED` / `MEDIA_OUTPUT_BUDGET_EXCEEDED`）抛 `MediaBudgetError`，带 `scope`、`phase`、估算与实际字节数。

## 媒体闭包

```ts
computeMediaClosure(disc, movieGraph, buttonGraphs?, { maxStates?: number }): MediaClosure
```

- 输入：M1 结构图 + M3 MovieObject 导航图 + 按钮程序图。
- 合并规则：条件边只要目标已知就按并集遍历；目标未知/寄存器目标/预算耗尽 → 记 `unknown`，并把范围放宽到全部已声明播放列表（保守）。
- 输出：`playlistIds`、`clipIds`、`streamIds`、`requiredNodeIds`、`routes`（每条含 `origin: entry|button-program|conservative-fallback` 与边来源）、`unknown`、`complete`、`explored`。
- 路由去重按 `playlistId + origin + entryId + buttonProgramId + 边签名`。

`complete: false` 不阻止导出，但会进入诊断与 `notVerified`。

## 菜单循环导出（`convert` 实际使用）

```ts
exportMenuLoopMedia(input: MenuLoopMediaInput, options: MenuLoopMediaOptions): Promise<MenuLoopMediaResult>
```

输入要点：`sourcePath`（M2TS）、`playlistId`、`playItemIndex`、`clipId`、`inTime45k`、`loopStart45k?`、`outTime45k`、`videoPid`、`audioTracks[{streamNumber,pid,language}]`、`stillMode`、`repeatCount`、`loopBackground`。

流程：

1. 校验输入与时间区间；`loopStart45k` 缺省时从 `inTime45k` 起。
2. 预算：按配置码率估算视频/音频/包大小；超过 `maxAssetBytes`/`maxOutputBytes` 在编码前失败（`MEDIA_ASSET_BUDGET_EXCEEDED` / `MEDIA_OUTPUT_BUDGET_EXCEEDED`）。
3. `overwrite` 时先尝试复用：只有旧 `media-plan.json` 与本次播放列表、clip、区间、流、编码参数一致才复用，否则重编码。
4. 检查工具：`ffmpeg -version`、`ffprobe -version`，`ffmpeg -encoders` 必须含 `libx264` 与 `aac`（缺 → `MEDIA_ENCODER_UNAVAILABLE`）；工具不存在 → `MEDIA_TOOL_UNAVAILABLE`。
5. `ffprobe` 读取源时间线与流；视频编码只接受 `h264` / `hevc`；按 PID 找视频与音频流。
6. 输出 `assets/media/background.mp4`（H.264）与 `assets/media/audio-<pid>-<lang>.m4a`（AAC），另写 `media-plan.json`。
7. 超时默认 20 分钟；取消/超时 → `MEDIA_JOB_CANCELLED` / `MEDIA_JOB_TIMEOUT`；进程失败 → `MEDIA_PROCESS_FAILED`；输出不可探测 → `MEDIA_OUTPUT_INVALID`。

`resolveMenuLoopStart45k(playItemIndex, inTime45k, outTime45k, marks)`：从 `type` 为 entry mark 的标记里取循环起点；没有则返回 `undefined`（从 in 点开始）。

## 线性导出（库能力，未接入 `convert`）

`exportLinearMedia(mediaPlan, options)` 把一个播放列表的多个 PlayItem 拼成一个 mp4（每个音轨变体一个资产）：

- 要求各 PlayItem 的分辨率、宽高比、音频采样率/声道一致，否则 `MEDIA_LINEAR_FORMAT_MISMATCH`，不产出半成品。
- 缺少某语言音轨 → `MEDIA_AUDIO_VARIANT_INCOMPLETE`。
- 角度/SubPath 等能力未支持：计划里标 `unsupported`，`MediaCapabilityReport` 记录 `inspectedStages: ["M1"]`、`strictUpgradeAllowed: false`。

`MediaTimelineMap` 负责 45k/90k 与包内媒体时间的双向映射；同一播放列表的映射区间不得重叠，`mappingId` 不得重复。`seekTimeline` 把播放列表时间换算成媒体元素的 seek 目标与等待条件。

## PGS 字幕

- `parsePgsSup(data, options)`：解析 SUP 的 PCS/WDS/PDS/ODS/END，得到 `PgsDisplaySet[]`（尺寸、调色板、位图、叠加位置）。CRC/长度异常按诊断返回，不猜。
- `PgsSubtitleTimeline`：按语言注册并选择显示集；跨 33 位 PTS 回绕时延续时间轴。
- CLI `list-assets` / `export-assets` 用 `extractPgsTrack(sourcePath, pid, outputPath, { maxBytes, timestampOffset90k })` 写出 `.sup`；`--decode png` 额外导出显示集 PNG。

## 外部播放目标

```ts
createExternalMediaTargets(disc, closure): ExternalMediaTargets
resolveExternalPlayTarget(targets, request): ExternalPlayTarget
```

- 目标以播放列表/PlayItem/章节 Mark 为单位，携带 `clipId`、`streamPath`、`inTime90k`。
- 解析请求支持播放列表、PlayItem、Mark 三种；未知 ID 或时间早于 STC 起点 → `EXTERNAL_*` 诊断，不返回近似位置。
- 出包时写 `external-targets.json`，浏览器运行时用它构造 `iina://` / `potplayer://` URL。

## 诊断码（常用）

| 码 | 含义 |
| --- | --- |
| `MEDIA_TOOL_UNAVAILABLE` | `ffmpeg`/`ffprobe` 不在 `PATH` |
| `MEDIA_ENCODER_UNAVAILABLE` | 缺 `libx264` 或 `aac` |
| `MEDIA_PROCESS_FAILED` / `MEDIA_JOB_TIMEOUT` / `MEDIA_JOB_CANCELLED` | 进程失败/超时/取消 |
| `MEDIA_OUTPUT_INVALID` | 产物无法被 `ffprobe` 识别 |
| `MEDIA_ASSET_BUDGET_EXCEEDED` / `MEDIA_OUTPUT_BUDGET_EXCEEDED` | 估算超限，编码前终止 |
| `MEDIA_STREAM_FILE_MISSING` / `MEDIA_PLAYLIST_MISSING` / `MEDIA_CLIP_INFO_MISSING` | 源结构缺失 |
| `MEDIA_VIDEO_PID_UNRESOLVED` / `MEDIA_PID_UNRESOLVED` / `MEDIA_AUDIO_STREAM_UNVERIFIED` | PID 无法唯一确定 |
| `MEDIA_SUBPATH_UNSUPPORTED` / `MEDIA_ANGLE_UNSUPPORTED` / `MEDIA_SUBTITLE_UNSUPPORTED` | 可达但未支持的能力 |
| `MEDIA_REACHABILITY_INCOMPLETE` / `MEDIA_CLOSURE_BUDGET` | 闭包不完整或预算耗尽 |
| `MEDIA_LINEAR_FORMAT_MISMATCH` / `MEDIA_AUDIO_VARIANT_INCOMPLETE` | 线性拼接条件不满足 |
| `EXTERNAL_PLAYLIST_UNKNOWN` / `EXTERNAL_PLAYITEM_UNKNOWN` / `EXTERNAL_MARK_UNKNOWN` / `EXTERNAL_TIME_BEFORE_STC` | 外部目标解析失败 |

## 测试

`src/index.test.ts`（工具调用、预算、复用、超时）、`closure.test.ts`（闭包与计划）、`linear*.test.ts`、`pgs.test.ts`、`seek.test.ts`、`timeline.test.ts`、`external-targets.test.ts`。测试通过注入 `runProcess` 伪造 ffmpeg，不要求本机安装。

## 改动入口

| 需求 | 位置 | 注意 |
| --- | --- | --- |
| 改 ffmpeg 参数 | `exportMenuLoopMedia` 的编码段 | 同步 `media-plan.json` 的 `encoder` 字段与复用判定条件 |
| 支持新视频编码 | `exportMenuLoopMedia` 的 codec 检查 + `runtime-web` 的 `<video>` 能力 | 浏览器侧也要能播 |
| 改闭包策略 | `closure.ts` | 影响 `convert` 是否导出额外播放列表 |
| 改 PGS 解析 | `pgs.ts` | 同步 `package-builder` 的 `serializePgsTrack` 与浏览器字幕渲染 |
