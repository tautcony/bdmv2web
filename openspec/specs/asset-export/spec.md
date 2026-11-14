# asset-export Specification

## Purpose

Defines what `bdmv2web export` and `bdmv2web render` write. Both commands accept a BDMV disc, a standalone `.m2ts`/`.rsks` transport stream, or (for `render`) a standalone `.mnu`/`.sup` container, and decide the input kind from the input itself rather than from a user-declared type. `--type` selects outputs only: `.mnu`/`.sup` containers, PNG frames, the structural metadata set, or a combination. `export` and `render` run one pipeline, so the same input yields the same PNG bytes and the same manifest records.

## Requirements

### Requirement: 输出选择

`export` SHALL 用 `--type all|metadata|hdmv|igs|sup` 选择输出，`--type` SHALL NOT 表示输入类型。`igs`/`sup` SHALL 写对应 `.mnu`/`.sup` 容器（配合 `--render` 还写其 PNG），`hdmv` SHALL 写命令表与来源映射，`metadata` SHALL 写整套结构元数据（`manifest.json`、`hdmv/*.json`、`igs/*.json`、`sup/tracks.json`），`all` SHALL 写该命令能写出的全部产物。省略 `--type` 时 `export` SHALL 只写容器。非法值 SHALL 以 `CLI_INVALID_ASSET_TYPE` 失败。

`--no-assets` SHALL 关闭资产侧（不写容器、不写 PNG），保留元数据侧：与省略 `--type` 或 `--type all` 连用时 SHALL 写整套元数据，与 `--type igs|sup` 连用时 SHALL 只写该段元数据，与 `--type hdmv` 连用时行为不变。`--no-assets` 与 `--render` 连用 SHALL 以 `CLI_EXPORT_SELECTION` 失败。

#### Scenario: 导出元数据而不写资产
- **WHEN** `export <BDMV> --out DIR --type metadata`
- **THEN** 输出目录含 `manifest.json`、`hdmv/`、`igs/`、`sup/tracks.json`，不含 `assets/` 与 `assets-manifest.json`，stdout 无 `assetCount`

#### Scenario: --no-assets 写出整套元数据
- **WHEN** `export <BDMV> --out DIR --no-assets`
- **THEN** 输出目录含 `manifest.json`、`hdmv/*.json`、`igs/*.json`、`sup/tracks.json`，不含 `assets-manifest.json`

#### Scenario: --no-assets 收窄元数据段
- **WHEN** `export <BDMV> --out DIR --type igs --no-assets`
- **THEN** 输出目录只含 `igs/*.json` 与 `manifest.json`，不含 `hdmv/`、`sup/`、`assets/`

#### Scenario: all 同时写容器与元数据
- **WHEN** `export <BDMV> --out DIR --type all`
- **THEN** 输出目录同时含 `.mnu`/`.sup` 容器、`assets-manifest.json` 与元数据产物

#### Scenario: 默认值保持不变
- **WHEN** `export <BDMV> --out DIR`（不给 `--type`）
- **THEN** 只写 `.mnu`/`.sup` 容器与 `assets-manifest.json`，不写元数据

#### Scenario: 元数据形态不接受解码
- **WHEN** `export <BDMV> --out DIR --type metadata --render`，或 `export <BDMV> --out DIR --no-assets --render`
- **THEN** 以 `CLI_EXPORT_SELECTION` 失败，不写任何产物

### Requirement: 输入类型判定

`export` 与 `render` SHALL 按输入自身判定类型，SHALL NOT 要求用户声明输入类型。判定 SHALL 先看内容（IGS `ICS`/`PDS`/`ODS` 段标签、PGS `PG` 段标签、偏移 0 或 4 处的传输流同步字节且下一个包边界再次命中），无法判定时退回扩展名（`.m2ts`/`.rsks`、`.mnu`、`.sup`），仍无法判定时 SHALL 保持 BDMV 输入路径与既有错误。

#### Scenario: 改名流文件仍按流处理
- **WHEN** 内容是 m2ts 流的文件以 `.bin` 结尾
- **THEN** 按流文件导出，不进入 BDMV 解析路径

#### Scenario: 内容优先于扩展名
- **WHEN** 内容是 PGS 流的文件以 `.mnu` 结尾
- **THEN** 按 SUP 输入处理

#### Scenario: 独立容器输入被 export 拒绝
- **WHEN** `export <file>.sup --out DIR`
- **THEN** 以 `CLI_EXPORT_SELECTION` 失败，错误信息指向 `render`，且不创建输出目录

#### Scenario: 独立容器输入被 render 接受
- **WHEN** `render <file>.sup --out DIR`
- **THEN** 解码该 SUP 的显示集并写出 PNG 与 `assets-manifest.json`，无需 `--sup`

#### Scenario: 流文件没有 HDMV 命令表
- **WHEN** `export <stream>.rsks --out DIR --type hdmv`
- **THEN** 以 `CLI_EXPORT_SELECTION` 失败，说明流内没有 HDMV 命令表

### Requirement: BDMV 资产导出
`export` SHALL 接受 BDMV 根目录或其父目录，导出可达 IGS 流为 `.mnu`、可达 PGS 轨道为 `.sup`，并在 `--render` 时解码 PNG；产物 SHALL 写入 `assets/igs/` 与 `assets/subtitles/` 并落盘 `assets-manifest.json`，stdout SHALL 输出单一 JSON 摘要。

#### Scenario: BDMV 输入导出
- **WHEN** export 以 BDMV 目录运行且 `--render --type all`
- **THEN** 输出包含可达 IGS 流的 `.mnu`、可达 PGS 轨道的 `.sup`、显示集 PNG、`assets-manifest.json` 与结构元数据，产物路径与既有命名一致

### Requirement: 独立流文件输入
`export` SHALL 接受单个 `.m2ts` 或 `.rsks` 常规文件作为输入，从文件自身的 PAT/PMT 发现图形流；流模式下 `--m2ts` SHALL 以 `CLI_EXPORT_SELECTION` 拒绝。BDMV 输入的识别与错误路径 SHALL 保持不变。

#### Scenario: .rsks 输入导出 SUP
- **WHEN** export 以内容为 m2ts 流的 `.rsks` 文件运行且 `--type sup`
- **THEN** 按 PMT 声明的 PGS PID 导出 `.sup`，产物与清单落入输出目录，stdout 报告 `stageStatus` 与资产数

#### Scenario: 流模式拒绝 clip 选择
- **WHEN** export 以流文件运行且传入 `--m2ts`
- **THEN** 以 `CLI_EXPORT_SELECTION` 失败，不写任何产物

#### Scenario: 非 BDMV 目录保持既有路径
- **WHEN** export 以不含 BDMV 结构的目录或非流扩展名文件运行
- **THEN** 走既有 BDMV 输入错误路径，不进入流模式

#### Scenario: 流模式遵守 --type
- **WHEN** 流文件同时声明 PGS 与 IGS，export 以 `--type igs` 运行
- **THEN** 只写 `.mnu` 与 IGS 元素 PNG，不写 `.sup`（`--type sup` 反之）

### Requirement: PMT 图形流发现
流模式 SHALL 依据 PMT stream_type 发现 PGS（0x90）与 IGS（0x91）PID，SHALL 忽略保留 PID（< 0x20）上的声明。PMT 段未通过 CRC 校验时，发现 SHALL 继续按段内声明读取，并 SHALL 保留 `PSI_CRC_INVALID` 诊断；诊断进入 stage 判定（warning 不阻塞）。未声明图形流的文件 SHALL 以零资产完成输出并记录 warning 诊断；`--pid` 指定未声明的 PID 时 SHALL 以 `CLI_EXPORT_SELECTION` 失败。

#### Scenario: PMT 声明 PGS
- **WHEN** 流文件 PMT 声明 stream_type 0x90 的 PID 且该 PID 含完整显示集
- **THEN** 导出该 PID 的 `.sup` 并在清单记录 `language: "und"` 与发现序号 `streamNumber`

#### Scenario: PMT CRC 无效仍可发现
- **WHEN** 流文件的 PMT 段 CRC 校验失败但段内声明完整
- **THEN** 仍按声明发现图形 PID 并导出资产，诊断中保留 `PSI_CRC_INVALID`，stdout `stageStatus` 为 `partial`

#### Scenario: 无图形流
- **WHEN** 流文件 PMT 未声明 0x90/0x91 PID
- **THEN** 记录 warning 诊断并完成输出，`assets-manifest.json` 无 sup/mnu 资产，stdout `stageStatus` 非 failed

#### Scenario: 未声明的 --pid
- **WHEN** `--pid` 指定的 PID 不在 PMT 0x90/0x91 声明中
- **THEN** 以 `CLI_EXPORT_SELECTION` 失败，不写任何产物

### Requirement: SUP 时间轴保真
独立流导出的 `.sup` SHALL 保留源流 90kHz 时间戳；`sup-png` 记录的 `startSeconds`/`endSeconds` SHALL 以轨道首个显示集为 0。

#### Scenario: 时间戳保留
- **WHEN** 源流首个 PGS 显示集 PTS 大于 2 秒
- **THEN** 导出的 `.sup` 记录与源流相同的 90kHz PTS 值

#### Scenario: PNG 时间相对化
- **WHEN** `--render` 渲染独立流的显示集
- **THEN** `startSeconds` 以首个显示集为 0 递增

### Requirement: 无效流失败报告
流文件未收到完整 PAT 或任何 PMT 段（无法作为 m2ts 解析），或声明的 PGS PID 无完整显示集时，export SHALL 在提交任何产物前以 `EXPORT_INVALID_STREAM` 失败；`render` 的流输入 SHALL 使用同一错误码。

#### Scenario: 非流文件
- **WHEN** 输入文件不含 PAT 或未送达任何 PMT 段
- **THEN** 以 `EXPORT_INVALID_STREAM` 失败且输出目录不产生事务产物

#### Scenario: 声明 PID 无数据
- **WHEN** PMT 声明 0x90 PID 但该 PID 无完整显示集
- **THEN** 以 `EXPORT_INVALID_STREAM` 失败并给出定位到源文件的错误信息

### Requirement: 产物与清单形态
流模式产物命名 SHALL 以输入文件 stem 代替 clipId，`assets-manifest.json` schema SHALL 与 BDMV 模式一致；传输/PSI 诊断 SHALL 进入同一 stage 判定，error 级诊断 SHALL 降级为 `partial` 而不阻塞产物提交。

#### Scenario: 命名与清单
- **WHEN** 流文件 stem 为 `00005.SumiSora.sc` 且 PMT 声明 PID 0x1200
- **THEN** 产物为 `assets/subtitles/00005.SumiSora.sc-pid-1200.sup` 并出现在 `assets-manifest.json`

#### Scenario: 尾部杂讯降级
- **WHEN** 流文件在最后一个完整包之后附带非 m2ts 字节
- **THEN** 提取继续完成，传输诊断保留，stdout `stageStatus` 为 `partial` 且 exit code 为 0

### Requirement: PNG 输出开关

`export` SHALL 用布尔选项 `--render` 表示「同时写出 PNG」，SHALL NOT 再接受 `--decode`；传入 `--decode` 时的行为 SHALL 与其它未知选项一致（`CLI_UNKNOWN_OPTION`），且不存在因取值非法而产生的失败码。

#### Scenario: `--render` 写出 PNG
- **WHEN** `export` 以 `--render` 运行
- **THEN** 除 `.mnu`/`.sup` 外还写出 IGS 元素与 PGS 显示集 PNG，并在清单记录它们；`--png-level` 只影响这些文件

#### Scenario: 旧写法被拒绝
- **WHEN** 任意命令传入 `--decode png`
- **THEN** 以 `CLI_UNKNOWN_OPTION` 失败，不写任何产物

#### Scenario: 未启用时不写 PNG
- **WHEN** `export` 未传 `--render`
- **THEN** 不写 PNG，清单无 `igs-png`/`sup-png` 记录，「解码显示集」步骤标为跳过

### Requirement: render 与 export 的 PNG 产物一致

对同一输入，`render` SHALL 复用 `export --render` 的管线（同一 PMT/BDMV 发现、同一并发解码、同一命名、同一清单记录构造），仅 SHALL 省略 `.mnu`/`.sup` 容器。`render` 的 `assets-manifest.json` SHALL 等于 `export --render` 清单中 `igs-png`/`sup-png` 记录的顺序子集，且每条记录的 PNG 字节 SHALL 相同。

#### Scenario: 同一流文件
- **WHEN** 同一条 `.rsks`/`.m2ts` 文件分别用 `export --render` 与 `render` 导出到两个目录
- **THEN** 两者的 PNG 清单记录逐字段相等，PNG 逐字节相同，`render` 目录不含 `.sup`

#### Scenario: 同一 BDMV 盘
- **WHEN** 同一个 BDMV 分别用 `export --render --type all` 与 `render --type all` 导出
- **THEN** `render` 的清单等于 `export` 清单的 PNG 子集，`render` 目录不含 `.mnu` 容器

#### Scenario: 选择范围一致
- **WHEN** `render` 以 BDMV 输入并传 `--m2ts`/`--pid`
- **THEN** 只输出所选 clip/PID 的 PNG，与 `export` 同名选项的选择结果一致

### Requirement: render 的流文件输入

`render` SHALL 接受单个 `.m2ts`/`.rsks` 常规文件，与 `export` 共用输入分类与 PMT 图形流发现。流输入下的失败语义 SHALL 为：无法作为 m2ts 解析或声明 PID 无完整显示集 → `EXPORT_INVALID_STREAM`；`--m2ts` 或未声明的 `--pid` → `CLI_RENDER_SELECTION`。

#### Scenario: 流文件渲染
- **WHEN** `render` 以 `.rsks` 文件运行
- **THEN** 按 PMT 声明的 PGS PID 渲染显示集 PNG，命名以文件 stem 代替 clipId

#### Scenario: 无效流不写产物
- **WHEN** `render` 的流输入不含 PAT/PMT
- **THEN** 以 `EXPORT_INVALID_STREAM` 失败，输出目录不产生事务产物

#### Scenario: 流文件拒绝 clip 选择
- **WHEN** `render` 的流输入配合 `--m2ts`
- **THEN** 以 `CLI_RENDER_SELECTION` 失败

### Requirement: 导出进度报告

`export` SHALL 支持 `--progress` 与 `--no-progress`，并 SHALL 使用与 `build` 相同的步骤渲染（`x/N` 计数、运行中标记、`[███░░░]` 进度条、每步耗时、结尾 `Done in`）。stdout 的 `{stageStatus, output, assetCount}` JSON 契约 SHALL 保持不变，进度 SHALL 只写 stderr。默认行为 SHALL 与 `build` 一致：交互式终端一条实时行，管道静默。

#### Scenario: 终端默认实时进度
- **WHEN** `export --render` 在 stderr 为 TTY 时运行
- **THEN** stderr 显示命令头（命令名、步骤数、`input`/`output`/`type`）、当前步骤的实时行（含比例步骤的进度条），以及每个已完成步骤的一行永久记录

#### Scenario: 管道默认静默
- **WHEN** `export` 的 stderr 不是 TTY 且未指定 `--progress`
- **THEN** stderr 不输出任何内容，stdout 仍为单行 JSON 摘要

#### Scenario: 管道下的明文进度
- **WHEN** stderr 不是 TTY 且指定 `--progress`
- **THEN** 每个步骤开始输出一行，比例步骤按 10% 增量输出 `NN%  <detail>` 行，不打 ANSI 控制序列

#### Scenario: `--no-progress` 静默
- **WHEN** `export --no-progress` 运行
- **THEN** stderr 不输出进度内容，即使 stderr 是 TTY

#### Scenario: 失败时先收尾再报错
- **WHEN** 某一步以 `stageStatus: "failed"` 结束
- **THEN** 进度实时行被关闭、该步记为失败并打印 `Failed in` 汇总，随后才输出既有的失败记录

### Requirement: render 进度报告

`render` SHALL 支持 `--progress` 与 `--no-progress`，SHALL 与 `export`、`build` 使用同一套步骤渲染与词表。BDMV 与流输入 SHALL 使用与 `export` 相同的步骤名与顺序；独立 `.mnu`/`.sup` 输入 SHALL 使用「读取图形资源 / 解码显示集 / 写清单并提交」三步。比例 SHALL 只在「解码显示集」上出现，分母为全部源的显示集总数。stdout SHALL 仍为单行 `{ stageStatus, output, assetCount }`。

#### Scenario: 管道下默认静默
- **WHEN** `render` 的 stderr 不是 TTY 且未指定 `--progress`
- **THEN** stderr 无输出，stdout 仍为单行 JSON

#### Scenario: 步骤与 export 同构
- **WHEN** `render` 以流文件运行并指定 `--progress`
- **THEN** 输出 `bdmv2web render` 头、四步（探测流表、提取图形流、解码显示集、写清单并提交）、比例行与 `Done in …` 汇总，格式与 `export` 相同

### Requirement: 解码吞吐与产物一致性

显示集 PNG 的解压 SHALL 在 libuv 线程池上并行进行，并发度 SHALL 不小于 1 且不改变产物。解码 SHALL NOT 改变 PNG 字节、`assets-manifest.json` 的内容或记录顺序（每条 SUP 记录后紧跟其显示集 PNG 记录）。

#### Scenario: 与同步编码字节一致
- **WHEN** 同一显示集分别用同步与线程池编码路径渲染
- **THEN** 两次 `pngBytes` 完全相同，`startSeconds`/`endSeconds`/`visible` 也相同

#### Scenario: 多轨道共用一条进度
- **WHEN** 一次导出含多条 SUP 轨道且 `--render`
- **THEN** `Decode display sets` 的比例按全部轨道的显示集总数单调递增，结束时输出 PNG 总数

### Requirement: 清单记录形状统一

`igs-png` 记录 SHALL 由同一构造函数生成，SHALL 包含 `width`、`height`、`objectId`、`objectVersion`、`paletteId`、`paletteVersion`；`sup-png` 记录 SHALL 由同一构造函数生成，SHALL 包含 `displaySet`、`startSeconds`、`endSeconds`、`width`、`height`（`language`/`streamNumber` 在来源声明时出现）。

#### Scenario: 同一盘的清单形状一致
- **WHEN** 同一个 BDMV 分别用 `export --render` 与 `render` 导出
- **THEN** 两边同名 `igs-png` 记录的字段集合与取值相同（记录整体逐字段相等）

### Requirement: extract 命令移除

`bdmv2web` SHALL NOT 注册 `extract` 命令。它作为 `export` 元数据形态的两种用法 SHALL 由 `export --no-assets`（整套元数据）与 `export --type igs|sup --no-assets`（单段元数据）承担。`CLI_EXTRACT_SELECTION` 与 `CLI_INVALID_EXTRACT_TYPE` SHALL 不再出现；`extract` 作为未知命令 SHALL 以 `CLI_USAGE` 失败。

#### Scenario: extract 不再是命令
- **WHEN** `bdmv2web extract <BDMV> --out DIR`
- **THEN** 以 `CLI_USAGE` 失败，提示未知命令，不写任何产物

#### Scenario: 产物等价
- **WHEN** 同一 BDMV 分别运行旧 `extract --all` 与 `export --no-assets`
- **THEN** 两个输出目录内容相同（`limitations` 文案随命令名调整）

### Requirement: render 按输入校验选项

`render` SHALL 删除 `--mnu`/`--sup`，只接受位置参数。`.mnu`/`.sup` 输入 SHALL 拒绝 `--type` 与 `--m2ts`，`.sup` SHALL 拒绝 `--pid`，`.mnu` SHALL 拒绝 `--language`；盘与流输入 SHALL 拒绝 `--language`。以上错配 SHALL 报 `CLI_RENDER_SELECTION`。`render` SHALL NOT 写 `.mnu`/`.sup` 容器，也 SHALL NOT 写元数据产物。

#### Scenario: 独立 MNU 不再需要开关
- **WHEN** `render <file>.mnu --out DIR`
- **THEN** 写出 IGS 元素 PNG 与 `assets-manifest.json`，不写 `.mnu` 容器

#### Scenario: 错配选项被拒绝
- **WHEN** `render <file>.sup --out DIR --type sup`
- **THEN** 以 `CLI_RENDER_SELECTION` 失败，不写任何产物
