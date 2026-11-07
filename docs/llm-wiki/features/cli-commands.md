# 功能：CLI 命令

七个命令，六个已实现。输入统一为 BDMV 根或包含 `BDMV/` 的父目录。

## 总表

| 命令 | 目的 | 主要产物 | 状态 |
| --- | --- | --- | --- |
| `inspect` | 看结构和诊断 | stdout 表格/JSON；可选 `--out` JSON | 已实现 |
| `extract` | 导出协议分析 JSON | `<out>/hdmv|igs|sup/*` + `manifest.json` | 已实现 |
| `list-assets` | 列 IGS/SUP 资源 | stdout 表/JSON；可选 `--out` | 已实现 |
| `export-assets` | 导出 `.mnu`/`.sup`/PNG | `assets-manifest.json` + 资产 | 已实现 |
| `convert` | 生成离线菜单包 | `BDMV-menu/` 整目录 | 已实现 |
| `validate` | 重算离线包审计 | `compatibility.json`、`dependency-audit.json`、`reports/release-summary.json` | 已实现 |
| `compare` | 参考对照 | — | 未实现，返回 `E_NOT_IMPLEMENTED` |

`--format` 的生效范围：`inspect`、`list-assets` 用它选择 `table|json`；`validate` 只校验取值必须为 `json`；`compare` 用它决定错误输出格式；`extract`、`convert`、`export-assets` 接受该选项但不改变输出。

## `inspect`

| 选项 | 作用 |
| --- | --- |
| `--format table\|json` | stdout 格式，默认 `table` |
| `--out FILE` | 写完整 JSON；目标不能已存在 |
| `--allow-partial` | 即使 `stageStatus: failed` 也退出 0 |
| `--strict` / `--no-strict` | 只影响 partial 的退出码 |

输出字段：`ParsedDisc` 全量 + `stageStatus`。表格只显示计数（analysisStage、delivery、entries、movieObjects、playlists、playItems、clips、streams、sounds、diagnostics、support prediction）。

失败先于写文件：`--out` 的父目录与输入不能重叠（`PATH_OVERLAP`）。

## `extract`

| 选项 | 作用 |
| --- | --- |
| `--out DIR` | 必填 |
| `--type hdmv\|igs\|sup` | 与 `--all` 二选一 |
| `--all` | 三类全导 |
| `--strict` | partial 退出 2 |

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

## `list-assets`

| 选项 | 作用 |
| --- | --- |
| `--type all\|igs\|sup` | 资源类型，默认 `all` |
| `--m2ts CLIP_ID` | 只列指定 clip |
| `--pid PID` | 只列指定 PID（十进制或 `0x` 前缀） |
| `--decode png` | 附带 PNG 解码信息 |
| `--format table\|json`、`--out FILE` | 输出格式与落盘 |

报告包含：M2TS clip 列表、PID 与编码、IGS 图像对象（id/版本/尺寸/调色板）、可达 SUP 轨道（clip/PID/语言/时长）。

## `export-assets`

| 选项 | 作用 |
| --- | --- |
| `--out DIR` | 必填 |
| `--type all\|igs\|sup` | 默认 `all` |
| `--m2ts` / `--pid` | 选择范围 |
| `--decode png` | 额外导出 PNG |

产物：

- `assets/igs/<clipId>-pid-<pid>.mnu`：igstools 兼容 IG 流。
- `assets/subtitles/<clipId>-pid-<pid>.sup`：可达 PGS 轨道。
- `assets/igs/*.png`、`assets/subtitles/*.png`：`--decode png` 时按元素/显示集导出。
- `assets-manifest.json`：`{ type, format?, path, byteLength, language?, streamNumber?, displaySetCount? }`。
- `.sup`/`.mnu` 文件名：多个 PlayItem 入口指向同一流时第二个入口起带 `-entryN` 后缀。

## `convert`

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `--out DIR` | `<BDMV 父目录>/BDMV-menu` | 输出目录，不能与输入重叠 |
| `--title NAME` | `<BDMV 父目录名>` | 文档标题与 README 标题 |
| `--player-profile FILE` | 内置默认 | PSR16–20 语言/国家/地区 |
| `--limits FILE` | `DEFAULT_LIMITS` | VM 指令/队列/调用预算 |
| `--overwrite` | 关 | 允许覆盖已有目录；匹配的旧媒体可复用 |
| `--strict` | 关 | partial 退出 2 |
| `--progress` | 自动 | stderr 非终端时也逐行输出进度 |
| `--no-progress` | 关 | 关闭进度输出 |

进度输出（stderr）：开头是 `input`、`output`、`title`、`profile` 四行，随后是固定 7 步——解析 BDMV 结构、提取 IGS 场景、解析 Top Menu 播放列表、选择菜单场景与媒体、导出菜单媒体、构建菜单包、写入报告并提交。参数解析在打印计划之前完成，不作为步骤。每步占一行 `✓ i/7  标题  耗时  明细`；正在执行的一步在终端上占用一行动态刷新，无媒体可导时该步标记为跳过。媒体编码期间显示 ffmpeg 百分比、文件与已编码时长。收尾输出 `Done in …` / `Failed in … · <code>` 与输出目录、包大小、诊断数。stderr 不是终端时默认静默；`--progress` 强制逐行输出。stdout 只有一行结果 JSON。

产物目录：

```text
index.html
README.md
manifest.json
asset-manifest.json
compatibility.json
external-targets.json          # 有外部播放目标时
media-plan.json                # 有菜单循环媒体时
media-plans/playlist-*.json    # 额外菜单播放列表
runtime/disc-data.js
runtime/assets-data-000.js ...
runtime/app.bundle.js
runtime/style.css
runtime/bdmv-config.js         # 有外部播放时
assets/audio/sound-N.wav
assets/media/background.mp4
assets/media/audio-*.m4a
report.json                    # convert 成功与失败路径都写
reports/                       # validate 之后出现
```

失败路径：无 IGS 场景（`MENU_SCENE_NOT_FOUND`）、Top Menu 播放列表解析失败（`MENU_PLAYLIST_NOT_RESOLVED`）、场景多义（`MENU_SCENE_AMBIGUOUS`）会写 `README.md` + `report.json`（`status: "failed"`）并提交目录，退出 1。

## `validate`

| 选项 | 作用 |
| --- | --- |
| `--offline` | 必填 |
| `--format json` | 只支持 json；其它值在读写前失败 |
| `--strict` | partial 退出 2 |

行为：

- 只读包内文件，重新审计；不读原盘、不改媒体。
- 用包内 `manifest.diagnostics` 与当前审计事实重算状态。
- `manifest.status` 与判定不一致 → 追加 `MANIFEST_STATUS_UNVERIFIED`，不写回 manifest。
- 三份报告来自同一份 summary。

## `compare`

```sh
bdmv2web compare <input> [--format json]
```

未实现：stderr 输出 `{ code: "E_NOT_IMPLEMENTED", command, strict, message }`，退出 1。`test-runner` 里已有 `compareVmTraces` / `compareIgRgbaFrames` / `createReferenceCompareReport`，可直接用于实现该命令。

## 通用退出码

| 结果 | 退出码 |
| --- | --- |
| `complete` | 0 |
| `partial`，非 strict | 0 |
| `partial`，`--strict` | 2 |
| `failed`、参数错误、`fatal` | 1 |

`inspect --allow-partial` 始终 0；`compare` 始终 1。

## 参数错误码

| 码 | 触发 |
| --- | --- |
| `CLI_USAGE` | 无命令、命令名未知、位置参数过多 |
| `CLI_UNKNOWN_OPTION` | 命令不支持的选项 |
| `CLI_MISSING_VALUE` | 带值选项缺值 |
| `CLI_MISSING_INPUT` / `CLI_MISSING_OUTPUT` | 缺输入/`--out` |
| `CLI_INVALID_FORMAT` | `--format` 值不支持 |
| `CLI_INVALID_PROFILE` | profile 字段长度/字符/取值非法 |
| `INVALID_LIMITS_FILE` / `INVALID_LIMIT` | limits JSON 不可读 / 键或值非法 |
| `CLI_EXTRACT_SELECTION` / `CLI_INVALID_EXTRACT_TYPE` | `extract` 类型选择错误 |
| `CLI_INVALID_ASSET_TYPE` / `CLI_INVALID_M2TS` / `CLI_INVALID_PID` / `CLI_INVALID_DECODE` | `list-assets`/`export-assets` 参数非法 |
| `CLI_OFFLINE_REQUIRED` | `validate` 缺 `--offline` |

## 小抄

```sh
corepack pnpm run cli:dev inspect "/path/BDMV" --format json
corepack pnpm run cli:dev extract "/path/BDMV" --out /tmp/analysis --all
corepack pnpm run cli:dev list-assets "/path/BDMV" --type igs
corepack pnpm run cli:dev export-assets "/path/BDMV" --out /tmp/assets --type igs --decode png
corepack pnpm run cli:dev convert "/path/BDMV" --out /tmp/menu --player-profile profile.json
corepack pnpm run cli:dev validate /tmp/menu --offline --strict
```

`--decode` 只接受 `png`；`--m2ts`/`--pid` 取值来自 `list-assets` 的表格或 JSON。
