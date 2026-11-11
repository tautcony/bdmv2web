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
| 大小 | 单个资产估算与实测由 `maxAssetBytes` 限制（一段 clip 的每个输出逐个检查）；整包在开始与结束时统计 | `MEDIA_ASSET_BUDGET_EXCEEDED` |
| 复用 | `overwrite` 或 `--resume` 且旧计划完全匹配 → 复用；无 `asset-manifest.json` 时用 `ffprobe` 读回 codec 与时长 | — |
| 工具 | `ffmpeg -version`、`ffprobe -version`、`ffmpeg -encoders`、`ffmpeg -filters`，每个包探测一次（按 runner 缓存） | `MEDIA_TOOL_UNAVAILABLE` / `MEDIA_ENCODER_UNAVAILABLE` |
| 探测 | `ffprobe` 源时间线、视频/音频 PID、色彩参数 | `MEDIA_VIDEO_PID_UNRESOLVED` / `MEDIA_PID_UNRESOLVED` |
| 编码 | HEVC + AAC（默认），`crf` HEVC 24 / H.264 18，`preset` `veryfast` | `MEDIA_PROCESS_FAILED` / `MEDIA_JOB_TIMEOUT` / `MEDIA_JOB_CANCELLED` |
| 校验 | 产物可被 `ffprobe` 识别，codec 与色彩标记匹配计划 | `MEDIA_OUTPUT_INVALID` |

视频编码只接受 H.264 / HEVC 源；其它编码不猜，直接报错。循环起点由 `resolveMenuLoopStart45k` 从 entry mark 取，缺省为 in 点。

### 导出范围（`--menu-media`）

`build` 只为「菜单会用到的播放列表」导出媒体，范围由 `--menu-media` 决定，HDMV 与 BD-J 取值相同：

| 取值 | HDMV | BD-J |
| --- | --- | --- |
| `auto`（默认） | IGS 场景匹配到的菜单 PlayItem | 播放列表总时长 ≤ 900 秒的 PlayItem |
| `all` | VM 可达播放列表的全部 PlayItem | BDJO 授权播放列表的全部 PlayItem |
| `none` | 不导出 | 不导出 |

BD-J 的 BDJO 常以 `accessToAll` 授权整碟，仅凭授权会把正片与花絮一并导出（两小时正片加花絮可达几十 GB），因此 `auto` 用时长上限区分菜单级内容，被跳过的播放列表写 `M5_MENU_MEDIA_SCOPE_SKIPPED` 并列出编号与分钟数。`all` 是显式的整碟选择；`none` 只打包结构与场景，写 `M5_MENU_MEDIA_DISABLED`。

### 编码参数

`build` / `convert` 接受四个菜单媒体参数，写入各 `media-plans/*.json` 的 `encoding`：

| 参数 | 取值 | 默认 |
| --- | --- | --- |
| `--crf <n>` | 0–51 | HEVC 24 / H.264 18 |
| `--preset <name>` | `ultrafast` / `veryfast` / `fast` / `medium` | `veryfast` |
| `--codec <name>` | `h264` / `hevc` | `hevc` |
| `--hdr <mode>` | `tonemap` / `preserve` | `tonemap` |
| `--video <mode>` | `encode` / `copy` | `encode`（`copy` 时 `--codec` 缺省 `h264`） |

HEVC 产物带 `-tag:v hvc1`（Safari 只认可该品牌）。四类组合都可执行；`h264` + `preserve` 写入 `MEDIA_HDR_CODEC_UNSUPPORTED` 警告。

### 视频流复制（`--video copy`）

蓝光菜单 clip 基本都是 H.264，浏览器可直接解码，所以复制比重新编码省时间：`ffmpeg -c:v copy` 把源视频流装进 MP4，码率与原盘一致（通常高于 `crf` 重编码，包会变大）。音频仍走 AAC，因为浏览器在 MP4 里不解码 AC-3 / DTS / LPCM。

复制的硬性条件是「与播放器从同一帧起播」。BD 播放器不是从 `inTime45k` 精确切帧的：libbluray 用 `clpi_lookup_spn(in_time, before = 1)`（`bdnav/navigation.c`）取该时间点**之前最近的入口点**定位 SPN，再用 `m2ts_filter`（`decoders/m2ts_filter.c`）把 `pts < in_time` 的 PES 全部抹掉，所以播放器实际从「覆盖 in 点的那个关键帧」开始解码、并丢弃它之前的内容。因此复制起点取 `menuMediaEntryPoint45k()` 算出的入口点，与该行为一致。

入口点时间在 EP map 里的存储格式是 `coarse << 18 | fine << 8`，即帧时间被**向下取整到 256 tick（45 kHz 下 5.689 ms）的栅格**，所以记录的 PTS 最多比真实帧时间早 255 tick。判定条件因此是 `0 ≤ inTime45k - 入口点 ≤ 256`：在这个窗口内，in 点就是该入口点那一帧；超出则说明 in 点落在 GOP 中间，复制会带上播放器根本不会显示的片头帧，退回编码。其余拒绝条件：源不是 H.264、请求的 `--codec hevc`、源为 HDR（需要 tonemap）、非 8-bit 4:2:0、奇数分辨率、EP map 里没有可用入口点。

复制时长取 `(out_time - in_time) + (in_time - 入口点)`，保证 `pts == out_time` 的那一帧（libbluray 会包含它）仍在片尾；误差上限即入口点量化误差，远小于一帧。

复制后仍做校验：codec 必须仍为 H.264，分辨率与显示宽高比不变，色彩标记与源一致（复制是逐位保留，`mp4` 只承载源里的标记），时长与计划相差不超过 0.25s。校验失败会删掉复制结果并改走编码，并在 `warnings` 里给 `MEDIA_REMUX_UNAVAILABLE`；计划 `encoding.video.mode` 如实记 `copy` 或 `encode`，拒绝原因写进 `limitations`。该警告同样出现在 `manifest.json` 与 `report.json` 的 `diagnostics`（`severity: "warning"`），不改变交付状态。

### 一次解复用，多个输出

一个 clip 只起一个 `ffmpeg` 进程：`-i` 解复用一次，同一个命令里先写 `background.mp4`，再按 `audioTracks` 逐个 `-map <audio pid> ... -f ipod audio-<pid>-<lang>.m4a`。复制与编码两条路径都这样拼参数，音频参数（`audioArgs`）直接接在视频输出之后。

此前是「视频一次 + 每条音轨各一次」，每次都要把整段 clip 重新读一遍。6 音轨的 2.2 GB 菜单 clip 因此读 7 遍，走 SMB 时同一段字节要付 7 次代价：实测每遍音轨约 110 s，单进程后整段 658 s 的菜单 15 s 写完（565% CPU）。音频也不再串行排在视频后面——进程的存活时间由最慢的输出决定，而不是由输出个数决定。

两个细节：复制路径已经在输入侧 `-ss` 到声明起点，音频输出不再单独 `-ss`，否则会双重偏移；复制产物校验失败重编码时，音频已经在同一进程里写好了，重编码只重做视频（`audioWritten`）。`-ss` 的落点按「该时刻所在或之前的关键帧」计算，所以复制与音频起点都取声明起点而不是 EP 入口点，否则会退到上一关键帧（实测 6 音轨时长少 11.6 s、首帧与源 in 点不符）。

### 进度与计数

`onProgress` 的每个事件带 `source`：`playlistId`、`playItemIndex`、`clipId`、`kind`（`background`/`audio`）、`pid`、`videoMode`（该 clip 实际走的是 `copy` 还是 `encode`），复用命中时另有 `reused: true`。CLI 按「clip」而不是「资产」聚合：一个 clip 的背景与其全部音轨算一个单位，音轨再多也只推进一次，`clip i/N` 与百分比同步。复用与内容去重不会产生编码进度，所以它们主动上报一个已完成事件（`state: "end"`，`outTimeSeconds == durationSeconds`），续跑因此仍能走到 100%。

### HDR 处理

| 源 | `tonemap` | `preserve` |
| --- | --- | --- |
| HDR10 / HLG | 转 SDR BT.709，8-bit | 保留 BT.2020/PQ，10-bit |
| SDR / 无标记 | 原标记透传，8-bit | 同左 |

`tonemap` 依赖 `zscale`（libzimg）。缺该滤镜时导出继续：按 `preserve` 编码并写入 `MEDIA_HDR_TONEMAP_UNAVAILABLE` 警告与 limitation，该素材计划（`media-plans/*.json`）的 `color.filterChain` 记为 `hdr-passthrough-fallback`。警告出现在 `manifest.json` 与 `report.json` 的 `diagnostics`（`severity: "warning"`），不改变交付状态。该产物在 SDR 显示器上对比度偏低。

Dolby Vision 只解基础层，`HDR10+` 动态元数据丢弃，均记录为 limitation。色彩标记通过 `-x264-params` / `-x265-params` 的 `colorprim` / `transfer` / `colormatrix` / `range` 写入；ffmpeg 的 `-color_trc` / `-color_primaries` 不写入 libx264 VUI。

产物：

```text
assets/media/playlist-<id>-pi<n>-clip-<clipId>/background.mp4
assets/media/playlist-<id>-pi<n>-clip-<clipId>/audio-<pid>-<lang>.m4a
media-plans/playlist-<id>-pi<n>-clip-<clipId>.json
```

一个导出单元（一个播放列表的某个 PlayItem，读自一个 STREAM clip）一个目录。目录名带三处源信息：Playlist 编号（对应 `<id>.mpls`）、PlayItem 序号（补零两位）、clip 编号（对应 `BDMV/STREAM/<clipId>.m2ts`），不必打开计划就知道素材来自哪个文件。Top Menu 背景与额外菜单播放列表使用同一模板，BD-J 与 HDMV 输出因此同名同构。`exportMenuLoopMedia` 自身的默认值仍是 `assets/media/` + `media-plan.json`，目录由 `package-builder` 传入。

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

`bdmv2web serve <package-directory> --player system` requests the operating system's default player for a whole-file target. `--player mpv --player-executable <path>` requests mpv with every playlist item, source-time bound and initial seek position. Unsupported targets include the source playlist or PlayItem. Process launch does not confirm external playback.

`runtime/bdmv-config.js` sets the source BDMV path for browser playback. The configured path can be absolute or relative to the package.

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
2. HDR 源画面偏灰时看该素材 `media-plans/*.json` 的 `encoding.video.color.filterChain`：`hdr-passthrough-fallback` 表示当前 ffmpeg 缺 `zscale`（libzimg）。装好滤镜后仍复用旧资产（计划匹配不看滤镜链），需删除输出目录后重建。
3. `list` 能否看到目标 clip 与 PID。
4. `media-plans/playlist-<id>-pi<n>-clip-<clipId>.json` 的 `playlistId`、`clipId`、`inTime45k`/`outTime45k`、`audioTracks` 是否与预期一致。
5. `--overwrite` 时是否复用了旧媒体（看计划里的编码参数与源区间）。
6. 浏览器侧 `external-targets.json` 的 `streamPath` 是否指向真实存在的 `STREAM/*.m2ts`。
