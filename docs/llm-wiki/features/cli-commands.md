# 功能：CLI 命令

九个命令中八个已实现，`compare` 未实现。BDMV 命令的输入为 BDMV 根或包含 `BDMV/` 的父目录；`render` 也接受独立的 `.mnu`/`.sup` 文件。

## 总表

| 命令 | 目的 | 主要产物 | 状态 |
| --- | --- | --- | --- |
| `inspect` | 看结构和诊断 | stdout 表格/JSON；可选 `--out` JSON | 已实现 |
| `extract` | 导出协议分析 JSON | `<out>/hdmv|igs|sup/*` + `manifest.json` | 已实现 |
| `list` | 列 IGS/SUP 资源 | stdout 表/JSON；可选 `--out` | 已实现 |
| `export` | 导出 `.mnu`/`.sup` 原始资源 | `assets-manifest.json` + 资产 | 已实现 |
| `render` | 从 BDMV、`.mnu` 或 `.sup` 生成 PNG | PNG + `assets-manifest.json` | 已实现 |
| `build` | 生成菜单包；BD-J 包内含 Java host、应用文件和 session 数据 | `BDMV-menu/` 整目录 | 已实现 |
| `serve` | 提供回环 HTTP 页面和会话 API，管理本地 Java 进程；支持 `--java <executable>` | 本地 URL | 已实现 |
| `validate` | 重算菜单包审计 | `reports.json`、`dependency-audit.json`、`reports/release-summary.json` | 已实现 |
| `compare` | 参考对照 | — | 未实现，返回 `E_NOT_IMPLEMENTED` |

命令与选项由 `commander` 解析：`bdmv2web --help` 列出全部命令，`bdmv2web <command> --help` 列出该命令的选项与说明。`convert` 是 `build` 的历史别名。

`--format` 的生效范围：`inspect`、`list` 用它选择 `table|json`；`validate` 只校验取值必须为 `json`；`compare` 用它决定错误输出格式；`extract`、`build`、`export`、`render` 接受该选项但不改变输出。

## `inspect`

| 选项 | 作用 |
| --- | --- |
| `--format table\|json` | stdout 格式，默认 `table` |
| `--out FILE` | 写完整 JSON；目标不能已存在 |
| `--allow-partial` | 即使 `stageStatus: failed` 也退出 0 |

输出字段：`ParsedDisc` 全量 + `stageStatus`。表格只显示计数（analysisStage、delivery、entries、movieObjects、playlists、playItems、clips、streams、sounds、diagnostics、support prediction）。

失败先于写文件：`--out` 的父目录与输入不能重叠（`PATH_OVERLAP`）。

## `extract`

| 选项 | 作用 |
| --- | --- |
| `--out DIR` | 必填 |
| `--type hdmv\|igs\|sup` | 与 `--all` 二选一 |
| `--all` | 三类全导 |

产物：

```text
<out>/
  manifest.json                 # stageStatus, selectedTypes, files[], limitations
  hdmv/parsed-disc.json         # ParsedDisc 全量
  hdmv/commands.json            # movieObjectId, instructionIndex, words, bytes, source
  hdmv/external-media-targets.json   # 仅 --all
  igs/scenes.json               # 场景（含页/BOG/按钮/命令/来源）
  igs/diagnostics.json
  igs/source-map.json           # 场景/页/按钮/对象/调色板/资产 → 文件偏移
  sup/tracks.json               # 轨道索引与显示集数量
```

不写 PNG 与 `.sup` 文件。`--type sup` 只写索引。

## `list`

| 选项 | 作用 |
| --- | --- |
| `--type all\|igs\|sup` | 资源类型，默认 `all` |
| `--m2ts CLIP_ID` | 只列指定 clip |
| `--pid PID` | 只列指定 PID（十进制或 `0x` 前缀） |
| `--format table\|json`、`--out FILE` | 输出格式与落盘 |

报告包含 IGS 流的路径、clip/PID/字节数，IGS 图像对象的 ID/版本/尺寸，以及可达 SUP 轨道的路径、clip/PID/语言/流序号和每个 clip 的轨道数。

## `export`

| 选项 | 作用 |
| --- | --- |
| `--out DIR` | 必填 |
| `--type all\|igs\|sup` | 默认 `all` |
| `--m2ts` / `--pid` | 选择范围 |
| `--decode png` | 额外导出 PNG |
| `--png-level 0-9` | 同上；只影响 `--decode png` 写出的文件 |

产物：

- `assets/igs/<clipId>-pid-<pid>.mnu`：igstools 兼容 IG 流。
- `assets/subtitles/<clipId>-pid-<pid>.sup`：可达 PGS 轨道。
- `assets/igs/*.png`、`assets/subtitles/*.png`：`--decode png` 时按元素/显示集导出。
- `assets-manifest.json`：`{ type, format?, path, byteLength, language?, streamNumber?, displaySetCount? }`。
- `sup-png` 条目另含 `displaySet`、`startSeconds`、`endSeconds`、`width`、`height`。`startSeconds` 是该显示集的起点、`endSeconds` 是下一条的起点，单位秒（3 位小数）。最后一个显示集用轨道结束时间；时间以轨道起点为 0（独立 `.sup` 以首个显示集为 0）。无法确定时写 `null`。
- 全透明显示集不写 PNG，也不写 `sup-png` 条目。
- `.sup`/`.mnu` 文件名：多个 PlayItem 入口指向同一流时从第二个入口起带 `-entryN` 后缀。

## `render`

| 选项 | 作用 |
| --- | --- |
| `--out DIR` | 必填 |
| `--mnu FILE` / `--sup FILE` | 直接渲染独立资源；也可用位置参数传入 `.mnu`/`.sup` |
| `--type all\|igs\|sup` | 仅 BDMV 输入；选择 PNG 来源 |
| `--m2ts` / `--pid` | 仅 BDMV 输入；`--pid` 也用于独立 MNU 的场景标识 |
| `--language LANG` | 仅独立 SUP；写入清单的三字母语言 |
| `--png-level 0-9` | 写 PNG 时的 deflate 档位，见下 |

产物：

```text
<out>/
  assets-manifest.json
  assets/graphics/*.png              # IGS 元素
  assets/subtitles/*.png             # PGS 显示集
```

`render` 不写 `.mnu`/`.sup`。独立 SUP 的文件名为 `<源文件名>-display-<00001>.png`；独立 MNU 使用 IGS 元素命名。清单条目与 `export --decode png` 相同。

IGS 元素写出的是调色板索引 PNG（color type 3 + `tRNS`），像素与调色板展开后的 RGBA 完全一致。PGS 显示集仍是 RGBA，画布降到 3 会让单帧体积增大约 70%。`--png-level` 覆盖默认档位：索引图默认 1，画布默认 6；索引图从 1 升到 3 只省约 3% 体积，画布在 3 与 6 之间差一倍以上。

## `build`

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `--out DIR` | `<BDMV 父目录>/BDMV-menu` | 输出目录，不能与输入重叠 |
| `--title NAME` | `<BDMV 父目录名>` | 文档标题与 README 标题 |
| `--player-profile FILE` | 内置默认 | PSR16–20 语言/国家/地区 |
| `--limits FILE` | `DEFAULT_LIMITS` | VM 指令/队列/调用预算 |
| `--disc-id HEX` | `CERTIFICATE/id.bdmv` | 32 位十六进制碟片 ID；只写入 BD-J 包的 `bdjLaunch.discId`，HDMV 包不使用 |
| `--overwrite` | 关 | 允许覆盖已有目录；匹配的旧媒体可复用 |
| `--resume [dir]` | 关 | 从上次运行留下的目录复用已完成的媒体；省略 `dir` 时取输出目录旁最新的 `.<输出名>.staging-*` |
| `--codec hevc\|h264` | `hevc`（`copy` 时 `h264`） | 菜单背景视频编码格式；HDMV 与 BD-J 包共用同一默认 |
| `--crf N` | 24（hevc）/ 18（h264） | 编码质量 0–51 |
| `--preset NAME` | `veryfast` | `ultrafast` / `veryfast` / `fast` / `medium` |
| `--hdr tonemap\|preserve` | `tonemap` | HDR 处理方式 |
| `--video encode\|copy` | `encode` | `copy` 把源 H.264 视频流复制进 MP4 不重编码；复制起点是播放器解码的入口点（EP map 中 `in` 点之前最近的关键帧），`in` 点须落在该入口点 256 tick（5.689 ms）的量化栅格内，其余自动退回编码并给 `MEDIA_REMUX_UNAVAILABLE` 警告。`copy` 时 `--codec` 缺省 `h264` |
| `--menu-media auto\|all\|none` | `auto` | 导出哪些播放列表的媒体，HDMV 与 BD-J 共用同一个取值。`auto` 只导菜单级媒体；`all` 导出导航可达的全部 PlayItem；`none` 不导媒体 |
| `--progress` | 自动 | stderr 非终端时也逐行输出进度 |
| `--no-progress` | 关 | 关闭进度输出 |

编码参数的生效范围：`--codec`/`--crf`/`--preset`/`--hdr` 只在重编码背景视频时起作用。`--video copy` 成功时背景流按比特复制，这四个值只写入 media plan 参与复用匹配；`--menu-media none` 或盘上无可导媒体时不发生编码，它们仍记录进 `mediaEncoding` 但不参与导出。

`--menu-media` 的三种取值在两种导航模式下含义相同，判定证据不同：HDMV 由 IGS 场景确定哪些 PlayItem 属于菜单，`auto` 即「场景匹配到的菜单媒体」；BD-J 没有场景证据，BDJO 又常以 `accessToAll` 授权整碟，`auto` 改以播放列表总时长不超过 900 秒作为菜单级判据，超出的写 `M5_MENU_MEDIA_SCOPE_SKIPPED`（列出编号与分钟数，提示可用 `--menu-media all`）。`all` 在两种模式下都导出全部可达 PlayItem（HDMV 取 VM 可达集合，BD-J 取 BDJO 授权集合），会包含正片，开销接近整碟。`none` 只打包结构与场景，运行时把 `PLAY_PLAYLIST` 报为不可用，并写 `M5_MENU_MEDIA_DISABLED`。

进度输出（stderr）：开头是 `input`、`output`、`title`、`profile` 四行，`--resume` 时另加 `resume` 行给出复用来源，随后是固定 7 步——解析 BDMV 结构、提取 IGS 场景、解析 Top Menu 播放列表、选择菜单场景与媒体、导出菜单媒体、构建菜单包、写入报告并提交。参数解析在打印计划之前完成，不作为步骤。每步占一行 `✓ i/7  标题  耗时  明细`；正在执行的一步在终端上占用一行动态刷新，行首标记随计时器持续动画，无媒体可导时该步标记为跳过。媒体导出期间该步按 **clip** 聚合：一个 clip 的背景与它的全部音轨算一个单位，音轨再多也只推进一次，百分比与 `clip i/N` 同步，复用的 clip 也计入已完成（它主动上报一个已完成事件，所以 `--resume` 续跑同样能走到 100%）。明细为 `clip i/N · Clip · 流 · 已编码/总时长`，其中 `i/N` 是计划内的 clip 位置，背景流那一项写作 `background copy` 或 `background encode`，直接给出该 clip 实际走的是复制还是重编码（请求了 `--video copy` 但被拒绝时这里显示 `encode`，不再静默回退），复用时另带 `· reused`。收尾输出 `Done in …` / `Failed in … · <code>` 与输出目录、包大小、诊断数。stderr 不是终端时默认静默；`--progress` 强制逐行输出。stdout 只有一行结果 JSON。

产物目录：

```text
index.html
README.md
manifest.json
asset-manifest.json
reports.json
external-targets.json          # 有外部播放目标时
media-plans/playlist-*-pi*-clip-*.json   # 每个导出单元一份计划
runtime/disc-data.js
runtime/assets-data-000.js ...
runtime/app.bundle.js
runtime/style.css
runtime/bdmv-config.js         # 有外部播放时
assets/audio/sound-N.wav
assets/media/playlist-<id>-pi<n>-clip-<clipId>/background.mp4
assets/media/playlist-<id>-pi<n>-clip-<clipId>/audio-*.m4a
reports/                       # validate 之后出现
```

失败路径：无 IGS 场景（`MENU_SCENE_NOT_FOUND`）、Top Menu 播放列表解析失败（`MENU_PLAYLIST_NOT_RESOLVED`）、场景多义（`MENU_SCENE_AMBIGUOUS`）会写 `README.md` + `reports.json`（`status: "failed"`）并提交目录，退出 1。

## `validate`

| 选项 | 作用 |
| --- | --- |
| `--format json` | 只支持 json；其它值在读写前失败 |

行为：

- 只读包内文件，重新审计；不读原盘、不改媒体。
- 用包内 `manifest.diagnostics` 与当前审计事实重算状态。
- `manifest.status` 与判定不一致 → 追加 `MANIFEST_STATUS_UNVERIFIED`，不写回 manifest。
- 三份报告来自同一份 summary。

## `compare`

```sh
bdmv2web compare <input> [--format json]
```

未实现：stderr 输出 `{ code: "E_NOT_IMPLEMENTED", command, message }`，退出 1。`test-runner` 里已有 `compareVmTraces` / `compareIgRgbaFrames` / `createReferenceCompareReport`，可直接用于实现该命令。

## 通用退出码

| 结果 | 退出码 |
| --- | --- |
| `complete`、`partial` | 0 |
| `failed`、参数错误、`fatal` | 1 |

`inspect --allow-partial` 始终 0；`compare` 始终 1。

## 参数错误码

| 码 | 触发 |
| --- | --- |
| `CLI_USAGE` | 无命令、命令名未知、位置参数过多 |
| `CLI_UNKNOWN_OPTION` | 命令不支持的选项，`commander` 会给出最接近的拼写建议 |
| `CLI_MISSING_VALUE` | 带值选项缺值 |
| `CLI_INVALID_ARGUMENT` | 带值选项给了空值，例如 `--out=` |
| `CLI_MISSING_INPUT` / `CLI_MISSING_OUTPUT` | 缺输入/`--out` |
| `CLI_INVALID_FORMAT` | `--format` 值不支持 |
| `CLI_INVALID_PROFILE` | profile 字段长度/字符/取值非法 |
| `INVALID_LIMITS_FILE` / `INVALID_LIMIT` | limits JSON 不可读 / 键或值非法 |
| `CLI_EXTRACT_SELECTION` / `CLI_INVALID_EXTRACT_TYPE` | `extract` 类型选择错误 |
| `CLI_INVALID_ASSET_TYPE` / `CLI_INVALID_M2TS` / `CLI_INVALID_PID` | 资源类型、Clip 或 PID 参数非法 |
| `CLI_INVALID_DECODE` | `export --decode` 值非法 |
| `CLI_INVALID_LANGUAGE` | `render --language` 不是三字母语言码 |
| `CLI_RENDER_SELECTION` | `render` 混用 BDMV 与 `.mnu`/`.sup`，或选项不适用于输入类型 |
| `RENDER_INVALID_MNU` / `RENDER_INVALID_SUP` | 独立资源无法解析或没有可渲染内容 |

## 小抄

```sh
corepack pnpm run cli:dev inspect "/path/BDMV" --format json
corepack pnpm run cli:dev extract "/path/BDMV" --out /tmp/analysis --all
corepack pnpm run cli:dev list "/path/BDMV" --type igs
corepack pnpm run cli:dev export "/path/BDMV" --out /tmp/assets --type igs
corepack pnpm run cli:dev render "/path/BDMV" --out /tmp/png --type sup
corepack pnpm run cli:dev render --sup /tmp/subtitle.sup --out /tmp/png
corepack pnpm run cli:dev build "/path/BDMV" --out /tmp/menu --player-profile profile.json
corepack pnpm run cli:dev validate /tmp/menu
```

`export --decode` 只接受 `png`；`--m2ts`/`--pid` 取值来自 `list` 的表格或 JSON。
