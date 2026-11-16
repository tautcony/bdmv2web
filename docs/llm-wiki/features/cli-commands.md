# 功能：CLI 命令

九个命令全部实现，`convert` 是 `build` 的别名：`inspect`、`list`、`export`、`render`、`build`、`validate`、`compare`、`serve`、`visualize`。BDMV 命令的输入为 BDMV 根或包含 `BDMV/` 的父目录；`export` 与 `render` 也接受独立的 `.m2ts`/`.rsks` 流文件，`render` 还接受独立的 `.mnu`/`.sup` 文件。

## 总表

| 命令 | 目的 | 主要产物 | 状态 |
| --- | --- | --- | --- |
| `inspect` | 看结构和诊断 | stdout 表格/JSON；可选 `--out` JSON | 已实现 |
| `list` | 列 IGS/SUP 资源 | stdout 表/JSON；可选 `--out` | 已实现 |
| `export` | 导出 `.mnu`/`.sup` 原始资源；`--metadata-only` 只出元数据 | `assets-manifest.json` + 资产；元数据时 `manifest.json` | 已实现 |
| `render` | 从 BDMV、流文件、`.mnu` 或 `.sup` 生成 PNG | PNG + `assets-manifest.json` | 已实现 |
| `build` | 生成菜单包；BD-J 包内含 Java host、应用文件和 session 数据 | `BDMV-menu/` 整目录 | 已实现 |
| `serve` | 提供回环 HTTP 页面和会话 API，管理本地 Java 进程；选项 `--port`、`--java`、`--disc-id`、`--player system`、`--player-executable` | 本地 URL | 已实现 |
| `visualize` | 导出导航图交互查看器与 mermaid 总览/分程序流程图 | `BDMV-graph/`（`index.html`、`graph.json`、`overview.md`、`programs/`） | 已实现 |
| `validate` | 重算菜单包审计 | `reports.json`、`dependency-audit.json`、`reports/release-summary.json` | 已实现 |
| `compare` | 对照 VM trace 与独立参考 trace | stdout 比对报告 JSON；可选 `--out` | 已实现 |

命令与选项由 `commander` 解析：`bdmv2web --help` 列出全部命令，`bdmv2web <command> --help` 列出该命令的选项与说明。

参数里的相对路径按执行命令时所在的目录解析。`corepack pnpm run cli:dev` 会把脚本切到仓库根运行，CLI 启动时改用包管理器导出的 `INIT_CWD`，所以 `export Hyouka_01/clip.rsks --out 00005` 的输入和输出都落在这个目录；`INIT_CWD` 缺失、为同一目录或已不存在时保留进程继承的工作目录。

`--format` 的生效范围：`inspect`、`list`、`visualize` 用它选择 `table|json`；`validate`、`compare` 只校验取值必须为 `json`；`export`、`render` 接受该选项但不改变输出。

## `inspect`

| 选项 | 作用 |
| --- | --- |
| `--format table\|json` | stdout 格式，默认 `table` |
| `--out FILE` | 写完整 JSON；目标不能已存在 |
| `--allow-partial` | 即使 `stageStatus: failed` 也退出 0 |

输出字段：`ParsedDisc` 全量 + `stageStatus`。表格只显示计数（analysisStage、delivery、entries、movieObjects、playlists、playItems、clips、streams、sounds、diagnostics、support prediction）。

失败先于写文件：`--out` 的父目录与输入不能重叠（`PATH_OVERLAP`）。

## `list`

| 选项 | 作用 |
| --- | --- |
| `--type all\|igs\|sup` | 筛选清单条目，不写文件，默认 `all` |
| `--m2ts CLIP_ID` | 只列指定 clip |
| `--pid PID` | 只列指定 PID（十进制或 `0x` 前缀） |
| `--format table\|json`、`--out FILE` | 输出格式与落盘 |

报告包含 IGS 流的路径、clip/PID/字节数，IGS 图像对象的 ID/版本/尺寸，以及可达 SUP 轨道的路径、clip/PID/语言/流序号和每个 clip 的轨道数。

## `export`

| 选项 | 作用 |
| --- | --- |
| `--out DIR` | 必填 |
| `--type all\|metadata\|hdmv\|igs\|sup` | 输出选择，默认写 `igs`+`sup` 容器 |
| `--m2ts` / `--pid` | 选择范围 |
| `--metadata-only` | 只写结构元数据；单独使用时写整套，配合 `--type igs`/`sup` 只写该段元数据 |
| `--render` | 额外渲染 PNG（IGS 元素与 PGS 显示集） |
| `--png-level 0-9` | 同上；只影响 `--render` 写出的文件 |
| `--progress` | stderr 非终端时也逐行输出进度（默认自动） |
| `--no-progress` | 关闭进度输出 |

`export` 的 `--type` 选择写出内容：`igs`/`sup` 写对应容器（配合 `--render` 还写其 PNG），`hdmv` 写命令表与来源映射，`metadata` 写整套元数据（`manifest.json`、`hdmv/*.json`、`igs/*.json`、`sup/tracks.json`），`all` 写全部。省略 `--type` 时只写容器。`--type metadata` 与 `--type hdmv` 拒绝 `--render`（没有可解码的帧）；对流文件用 `--type hdmv` 报 `CLI_EXPORT_SELECTION`（流内没有 HDMV 命令表）；非法取值由 Commander 校验，报 `CLI_INVALID_ARGUMENT`。

`--metadata-only` 只写元数据侧：不带 `--type` 时写整套元数据，`--type igs` 或 `--type sup` 时只写那一段。`--metadata-only` 与 `--render` 冲突，报 `CLI_EXPORT_SELECTION`。元数据产物落在同一个输出事务里：

```text
<out>/
  manifest.json                      # stageStatus, selectedTypes, files[], limitations
  hdmv/parsed-disc.json              # ParsedDisc 全量
  hdmv/commands.json                 # movieObjectId, instructionIndex, words, bytes, source
  hdmv/external-media-targets.json   # 仅 --type all / metadata
  igs/scenes.json                    # 场景（含页/BOG/按钮/命令/来源）
  igs/diagnostics.json
  igs/source-map.json                # 场景/页/按钮/对象/调色板/资产 → 文件偏移
  sup/tracks.json                    # 轨道索引与显示集数量
```

元数据运行不写 `assets-manifest.json`，stdout 也只有 `{ stageStatus, output }`。

进度输出（stderr）与 `build` 同一套渲染。BDMV 输入五步：解析 BDMV 结构、提取 IGS 场景、提取 SUP 轨道、解码显示集、写清单并提交；独立流输入四步：探测流表、提取图形流、解码显示集、写清单并提交。`--type` 筛选未覆盖的步骤标为跳过。只有「解码显示集」能测比例：以全部轨道的显示集总数为分母，跨轨道单调递增，明细为 `<已完成>/<总数> display sets`；其余步骤显示耗时。`--render` 未启用时该步跳过。结尾为 `Done in …` / `Done in … · partial` / `Failed in … · <code>` 与输出目录、资产数。stderr 为文件或管道时默认静默，`--progress` 强制逐行输出（每步一行 + 每 10% 一行）。stdout 仍只有一行 JSON。`render` 使用同一套步骤名与同一行格式，两个命令的进度逐行对应。

显示集 PNG 的 deflate 在线程池上并发执行（4 路，等于 libuv 默认线程池大小），合成仍在主线程；`assets-manifest.json` 的记录顺序保持「每条 SUP 记录后紧跟其显示集 PNG」。

产物：

- `assets/igs/<clipId>-pid-<pid>.mnu`：igstools 兼容 IG 流。
- `assets/subtitles/<clipId>-pid-<pid>.sup`：可达 PGS 轨道。
- `assets/igs/*.png`、`assets/subtitles/*.png`：`--render` 时按元素/显示集导出。
- `assets-manifest.json`：`{ type, format?, path, byteLength, language?, streamNumber?, displaySetCount? }`。
- `igs-png` 条目另含 `width`、`height`、`objectId`、`objectVersion`、`paletteId`、`paletteVersion`。
- `sup-png` 条目另含 `displaySet`、`startSeconds`、`endSeconds`、`width`、`height`。`startSeconds` 是该显示集的起点、`endSeconds` 是下一条的起点，单位秒（3 位小数）。最后一个显示集用轨道结束时间；时间以轨道起点为 0（独立 `.sup` 以首个显示集为 0）。无法确定时写 `null`。
- 全透明显示集不写 PNG，也不写 `sup-png` 条目。
- `.sup`/`.mnu` 文件名：多个 PlayItem 入口指向同一流时从第二个入口起带 `-entryN` 后缀。

独立流文件输入（单个 `.m2ts`/`.rsks` 常规文件）：

- 图形流由文件自身的 PAT/PMT 发现：`stream_type` `0x90` 为 PGS、`0x91` 为 IGS；保留 PID（`< 0x20`）上的声明忽略，社区封装里的假条目不进入导出集。
- 流模式的 `--m2ts` 以 `CLI_EXPORT_SELECTION` 拒绝；`--pid` 必须是 PMT 已声明的图形 PID，否则同样以 `CLI_EXPORT_SELECTION` 失败。
- 产物以文件 stem 代替 `clipId`：`assets/igs/<stem>-pid-<pid>.mnu`、`assets/subtitles/<stem>-pid-<pid>.sup`。清单 `sup` 记录 `language: "und"`（流内没有语言声明），`streamNumber` 为 PMT 中的发现序号。
- `.sup` 保留源 90kHz 时间轴；`sup-png` 的秒数以轨道首个显示集为 0，与 `render` 的独立 SUP 语义一致。
- 没有图形流声明时记 warning `EXPORT_NO_GRAPHICS_STREAM`，写出空清单并以 0 退出；文件不含 PAT/PMT，或声明的 PGS PID 没有完整显示集时以 `EXPORT_INVALID_STREAM` 在写产物前失败。
- 传输/PSI 诊断与 BDMV 模式同一判定：尾部杂讯等 error 级诊断降级为 `partial`（exit 0），不影响已发现的流。
- 输出目录可以与流文件同处一级：流文件是只读输入，不存在 BDMV 根那样的覆盖风险。
- 同一个流文件交给 `render` 时复用这条发现路径与同一套解码管线：PNG 字节、路径与清单条目逐字节相同，只是不写 `.mnu`/`.sup`；选择错误报 `CLI_RENDER_SELECTION`，无效流仍是 `EXPORT_INVALID_STREAM`。

## `render`

| 选项 | 作用 |
| --- | --- |
| `--out DIR` | 必填 |
| `[input]` | 位置参数；按文件内容判定为 BDMV、流文件或 `.mnu`/`.sup`，无需声明类型 |
| `--type all\|igs\|sup` | 仅 BDMV 与流文件输入；筛选解码的 PNG 家族，默认 `all` |
| `--m2ts` / `--pid` | 仅 BDMV 输入；`--pid` 也用于独立 MNU 的场景标识 |
| `--language LANG` | 仅独立 SUP；写入清单的三字母语言 |
| `--png-level 0-9` | 写 PNG 时的 deflate 档位，见下 |
| `--progress` / `--no-progress` | 与 `export`、`build` 相同的进度开关与渲染格式 |

输入可以是 BDMV 目录、`.m2ts`/`.rsks` 流文件或 `.mnu`/`.sup` 文件，类型由文件本身判定（传输流同步字节、IGS `ICS`/`PDS`/`ODS` 段标签、PGS `PG` 段标签，扩展名仅作兜底）。前两类走 `export --render` 的同一条管线（步骤名、并发解码、PNG 名称与清单记录都相同），后两类是 `render` 独有的入口。`--type`、`--m2ts` 只适用于盘与流输入，`--pid` 也可给独立 MNU 指定场景标识，`--language` 只适用于独立 SUP；错配报 `CLI_RENDER_SELECTION`。

产物：

```text
<out>/
  assets-manifest.json
  assets/graphics/*.png              # IGS 元素
  assets/subtitles/*.png             # PGS 显示集
```

`render` 不写 `.mnu`/`.sup`。BDMV 与流文件的 PNG 命名、清单条目与 `export --render` 完全相同（同一输入下，`render` 的清单等于 `export --render` 清单中 `igs-png`/`sup-png` 条目的顺序子集）；独立 SUP 没有 PID 可寻，文件名固定为 `<源文件名>-display-<00001>.png`，独立 MNU 使用 IGS 元素命名。

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
| `--no-reuse` | 关 | 每次构建重新生成菜单媒体，用于干净重建；`--resume` / `--resume-dir` 按指定目录复用媒体 |
| `--resume` | 关 | 裸开关；从输出目录旁最新的 `.<输出名>.staging-*` 复用已完成的媒体 |
| `--resume-dir <dir>` | 关 | 指定复用目录 |
| `--codec hevc\|h264` | `hevc` | 菜单背景视频编码格式；`--video copy` 回退编码的 clip 默认 `h264` |
| `--crf N` | 24（hevc）/ 18（h264） | 编码质量 0–51 |
| `--preset NAME` | `veryfast` | `ultrafast` / `veryfast` / `fast` / `medium` |
| `--hdr tonemap\|preserve` | `tonemap` | HDR 处理方式 |
| `--video encode\|copy` | `encode` | `copy` 把源 H.264 视频流复制进 MP4 不重编码；复制起点是播放器解码的入口点（EP map 中 `in` 点之前最近的关键帧），`in` 点须落在该入口点 256 tick（5.689 ms）的量化栅格内，其余自动退回编码并给 `MEDIA_REMUX_UNAVAILABLE` 警告。`copy` 回退编码的 clip 默认 `h264` / `crf` 18 |
| `--menu-media auto\|all\|none` | `auto` | 导出哪些播放列表的媒体，HDMV 与 BD-J 共用同一个取值。`auto` 只导菜单级媒体；`all` 导出导航可达的全部 PlayItem；`none` 不导媒体 |
| `--progress` | 自动 | stderr 非终端时也逐行输出进度 |
| `--no-progress` | 关 | 关闭进度输出 |

编码参数的生效范围：`--codec`/`--crf`/`--preset`/`--hdr` 只在重编码背景视频时起作用。`--video copy` 成功时背景流按比特复制，这四个值只写入 media plan 参与复用匹配；`--menu-media none` 或盘上无可导媒体时不发生编码，它们仍记录进 `mediaEncoding` 但不参与导出。

`--menu-media` 的三种取值在两种导航模式下含义相同，判定证据不同：HDMV 由 IGS 场景确定哪些 PlayItem 属于菜单，`auto` 即「场景匹配到的菜单媒体」；BD-J 没有场景证据，`auto` 以播放列表总时长不超过 900 秒作为菜单级判据，超出的写 `M5_MENU_MEDIA_SCOPE_SKIPPED`（列出编号与分钟数，提示可用 `--menu-media all`）。`all` 在两种模式下都导出全部可达 PlayItem（HDMV 取 VM 可达集合，BD-J 取 BDJO 授权集合），会包含正片，开销接近整碟。`none` 只打包结构与场景，运行时把 `PLAY_PLAYLIST` 报为不可用，并写 `M5_MENU_MEDIA_DISABLED`。

进度输出（stderr）：首行是 `bdmv2web build · 7 steps`，随后是 `input`、`output`、`title`、`profile` 四行，`--resume` 时另加 `resume` 行给出复用来源，再是固定 7 步——解析 BDMV 结构、提取 IGS 场景、解析 Top Menu 播放列表、选择菜单场景与媒体、导出菜单媒体、构建菜单包、写入报告并提交。参数解析在打印计划之前完成，不作为步骤。每步占一行 `✓ i/7  标题  耗时  明细`；正在执行的一步在终端上占用一行动态刷新，行首标记随计时器持续动画，无媒体可导时该步标记为跳过。媒体导出期间该步按 **clip** 聚合：一个 clip 的背景与它的全部音轨算一个单位，音轨再多也只推进一次，百分比与 `clip i/N` 同步，复用的 clip 也计入已完成（它主动上报一个已完成事件，所以 `--resume` 续跑同样能走到 100%）。明细为 `clip i/N · Clip · 流 · 已编码/总时长`，其中 `i/N` 是计划内的 clip 位置，背景流那一项写作 `background copy` 或 `background encode`，直接给出该 clip 实际走的是复制还是重编码（请求了 `--video copy` 但被拒绝时这里显示 `encode`），复用时另带 `· reused`。收尾输出 `Done in …` / `Failed in … · <code>` 与输出目录、包大小、诊断数。stderr 为文件或管道时默认静默；`--progress` 强制逐行输出。stdout 只有一行结果 JSON。

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
bdmv2web compare <input> --actual <trace.json> [--reference <trace.json>] [--reference-tool NAME] [--reference-version VERSION] [--out FILE] [--format json]
```

| 选项 | 作用 |
| --- | --- |
| `--actual FILE` | 必填；实际运行产生的 VM trace 事件数组 JSON |
| `--reference FILE` | 可选；独立参考 trace，必须与 `--actual` 是不同文件 |
| `--reference-tool NAME` | 参考工具名，缺省 `unspecified` |
| `--reference-version VERSION` | 参考工具版本 |
| `--out FILE` | 额外把报告写入该文件 |
| `--format json` | 只接受 `json` |

`<input>` 是确定性输入序列 JSON（profile、寄存器、稳定入口、seed 与有序事件），报告由 `@bdmv2web/test-runner` 的 `createReferenceCompareReport` 生成并打印到 stdout。缺参考或缺参考工具版本时 `result: not-verified`。

## `visualize`

```sh
bdmv2web visualize <input> [--out DIR] [--programs IDS] [--max-blocks N] [--no-closure] [--overwrite] [--format json]
```

| 选项 | 作用 |
| --- | --- |
| `--out DIR` | 输出目录，缺省为盘旁的 `BDMV-graph/` |
| `--programs IDS` | 逗号分隔的程序 id；只影响分程序流程图的写出，查看器始终包含全部程序 |
| `--max-blocks N` | 单个程序流程图绘制的块数上限（缺省 400），超出的块折叠为一个提示节点 |
| `--no-closure` | 跳过媒体闭包（不做 IGS 提取），输出不含 playlist 可达性与 route 来源 |
| `--overwrite` | 替换已存在的输出目录，否则报 `TARGET_EXISTS` |
| `--format json` | stdout 输出摘要 JSON；缺省打印汇总表 |

产物：

```text
<out>/
  index.html              # 自包含交互查看器：数据内嵌、无外部资源，file:// 直接打开；
                          # 侧栏按程序/playlist/unknown 过滤（unknown 汇总为单一入口，点开为
                          # 全量表格），主画布分层布局支持拖拽缩放，
                          # 点击块看逐条反汇编；Overview 以程序粒度聚合展示全局导航拓扑；
                          # 程序视图里点击外部对象节点跳入目标 MO，MO 视图顶部显示跳入它的
                          # 按钮入口（点击进入按钮流程图），↩ Back 沿跳转路径返回；
                          # 布局可在 Layered（分层）与 Force（力导向模拟）间切换，Force 下节点可拖拽、
                          # 松开固定在落点，拖拽与切换实时重排
  graph.json              # 与查看器相同的载荷：分程序基本块、块级边、playlist 边界与 route 来源
  overview.md             # mermaid 总览：entry → MovieObject → playlist，按钮程序按来源流聚合
  programs/mobj-<id>.md   # 单程序基本块流程图；按钮程序为 button-<id>.md（1000000 起的图内编号）
```

媒体闭包的完成状态与 unknown 明细在 `graph.json` 的 `mediaClosure` 中；分程序图里绿色 playlist 节点是媒体落点，橙色虚线边为静态不可确定的目标，红色边为静态回边（潜在循环，非运行时证据）。

## 通用退出码

| 结果 | 退出码 |
| --- | --- |
| `complete`、`partial` | 0 |
| `failed`、参数错误、`fatal` | 1 |

`inspect --allow-partial` 始终 0；`compare` 按结果退出：`pass` 0、分歧或输入错误 1、`not-verified` 2。

## 参数错误码

| 码 | 触发 |
| --- | --- |
| `CLI_USAGE` | 无命令、命令名未知、位置参数过多 |
| `CLI_UNKNOWN_OPTION` | 命令不支持的选项，`commander` 会给出最接近的拼写建议 |
| `CLI_MISSING_VALUE` | 带值选项缺值 |
| `CLI_INVALID_ARGUMENT` | 带值选项给了空值（例如 `--out=`），或 `--type` 取值不在该命令允许的集合中 |
| `CLI_MISSING_INPUT` / `CLI_MISSING_OUTPUT` | 缺输入/`--out` |
| `CLI_INVALID_FORMAT` | `--format` 值不支持 |
| `CLI_INVALID_PROFILE` | profile 字段长度/字符/取值非法 |
| `INVALID_LIMITS_FILE` / `INVALID_LIMIT` | limits JSON 不可读 / 键或值非法 |
| `CLI_INVALID_M2TS` / `CLI_INVALID_PID` | Clip 或 PID 参数非法 |
| `CLI_EXPORT_SELECTION` | 流文件输入配合 `--m2ts`，`--pid` 不在 PMT 声明的图形 PID 中，`.mnu`/`.sup` 输入（应改用 `render`），`--type metadata`/`hdmv` 或 `--metadata-only` 配合 `--render`，对流文件用 `--type hdmv` |
| `EXPORT_INVALID_STREAM` | 流文件无法作为 m2ts 解析（无 PAT/PMT），或声明的 PGS PID 无完整显示集；`render` 的流输入沿用该码 |
| `CLI_INVALID_LANGUAGE` | `render --language` 不是三字母语言码 |
| `CLI_RENDER_SELECTION` | `render` 的选项不适用于该输入（流文件配合 `--m2ts`、`.mnu`/`.sup` 配合 `--type`、`--pid`/`--language` 给错输入） |
| `RENDER_INVALID_MNU` / `RENDER_INVALID_SUP` | 独立资源无法解析或没有可渲染内容 |
| `CLI_INVALID_PNG_LEVEL` | `--png-level` 不是 0–9 |
| `CLI_INVALID_RESUME` | 裸用 `build --resume` 时找不到输出目录旁最新的 staging 目录，或 `--resume-dir` 指定的目录不可用 |
| `CLI_INVALID_DISC_ID` / `CLI_INVALID_PORT` | `--disc-id` 不是 32 位十六进制 / `--port` 不是 1–65535 整数 |
| `CLI_SERVE_ROOT_MISSING` / `CLI_SERVE_ROOT_INVALID` / `CLI_SERVE_FAILED` | serve 的包目录缺失 / 非法 / 服务运行失败 |
| `COMPARE_MISSING_ACTUAL` / `COMPARE_INPUT_INVALID` / `COMPARE_ACTUAL_INVALID` / `COMPARE_REFERENCE_INVALID` / `COMPARE_REFERENCE_NOT_INDEPENDENT` | `compare` 的输入序列、trace 或参考文件校验失败；参考与实际同文件时报 `COMPARE_REFERENCE_NOT_INDEPENDENT` |

## 小抄

```sh
corepack pnpm run cli:dev inspect "/path/BDMV" --format json
corepack pnpm run cli:dev export "/path/BDMV" --out /tmp/analysis --metadata-only
corepack pnpm run cli:dev list "/path/BDMV" --type igs
corepack pnpm run cli:dev export "/path/BDMV" --out /tmp/assets --type igs
corepack pnpm run cli:dev export "/path/00005.SumiSora.sc.rsks" --out /tmp/assets --type sup
corepack pnpm run cli:dev export "/path/00005.SumiSora.sc.rsks" --out /tmp/assets --render --progress
corepack pnpm run cli:dev render "/path/BDMV" --out /tmp/png --type sup
corepack pnpm run cli:dev render "/path/00005.SumiSora.sc.rsks" --out /tmp/png --progress
corepack pnpm run cli:dev render /tmp/subtitle.sup --out /tmp/png
corepack pnpm run cli:dev build "/path/BDMV" --out /tmp/menu --player-profile profile.json
corepack pnpm run cli:dev serve /tmp/menu
corepack pnpm run cli:dev visualize "/path/BDMV" --out /tmp/graph
corepack pnpm run cli:dev compare input.json --actual actual.json --reference reference.json
corepack pnpm run cli:dev validate /tmp/menu
```

`export --render` 是开关，没有取值；`--m2ts`/`--pid` 取值来自 `list` 的表格或 JSON。同一条流文件用 `export --render` 与 `render` 得到的 PNG 完全相同，前者额外写 `.mnu`/`.sup`。
