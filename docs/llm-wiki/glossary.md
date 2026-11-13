# 术语表

仓库内命名与 Blu-ray 概念的对应。实现细节见各包文档。

## 光盘结构

| 术语 | 含义 | 仓库内位置 |
| --- | --- | --- |
| BDMV | Blu-ray 的导航与媒体目录 | 输入根 |
| `index.bdmv` | 入口表：First Play、Top Menu、Title | `parseIndex` |
| `MovieObject.bdmv` | 电影对象表，每条指令 12 字节 | `parseMobj`、`movieObjects` |
| MOBJ | MovieObject 的简称 | 诊断与文档 |
| MPLS | 播放列表，含 PlayItem、Mark、STN、SubPath | `playlists` |
| PlayItem | 播放列表中的一段 clip 时间区间 | `PlayItem` |
| Mark | 章节/跳转标记，`playItemRef` + `time45k` | `PlayMark` |
| STN | 流声明表（视频/音频/字幕/IG） | `StreamDeclaration` |
| SubPath | 辅助路径（如 IG 弹出菜单、字幕） | `SubPath`、`SubPlayItem` |
| CLPI | Clip 信息：流、序列、CPI | `ClipInfo` |
| CPI | 粗/细粒度随机访问点 | `CpiEntry` |
| ATC / STC | 到达时间时钟 / 系统时间时钟序列 | `AtcSequence`、`StcSequence` |
| M2TS | 192 字节源包封装的传输流 | `STREAM/*.m2ts` |
| TS / PSI / PAT / PMT | 188 字节传输流与节目表 | `PsiAssembler` |
| PES / PTS | 打包基本流与显示时间戳 | `PesAssembler`、`decodeTimestamp` |
| 45k / 90k | 45 kHz / 90 kHz 时间基；90k = 45k × 2 | `Time90k`、`from45k` |

## 交互图形

| 术语 | 含义 |
| --- | --- |
| IGS | 交互图形流（菜单） |
| ICS | 交互组合段：页、BOG、按钮、效果 |
| PDS | 调色板段 |
| ODS | 图像对象段（RLE 压缩） |
| END | 显示集结束段 |
| Display Set | 一次完整提交的组合（ICS + 对象 + 调色板 + END） |
| BOG | 按钮组，决定同时可选的按钮集合 |
| `uiModel` | 0 常显菜单；1 弹出菜单 |
| UO mask | 用户操作掩码，按页限制允许的输入 |
| 三态 | normal / selected / activated |
| 效果（effect） | 进入/退出动画帧序列，`duration90k` |
| 按钮命令 | 按钮被激活时执行的一段 12 字节命令 |

## 导航执行

| 术语 | 含义 |
| --- | --- |
| HDMV | 基于指令的导航（区别于 BD-J） |
| BD-J | BDJO 选择 Java Xlet；浏览器通过独立于 HDMV VM 的 BD-J runtime 执行 |
| GPR | 4096 个通用寄存器，程序可读写 |
| PSR | 128 个播放器状态寄存器，程序只读；系统可写子集 |
| MovieObject 上下文 | `runTurn` 执行对象指令的上下文 |
| IG 按钮上下文 | `executeButtonProgram` 执行按钮命令的上下文 |
| 动作（Action） | VM 发给宿主的请求：播放、停止、切流、标题搜索等 |
| 事件（Event） | 宿主回给 VM 的事实：媒体开始/结束/seek 完成、菜单输入 |
| `generation` | 动作代次；回信必须匹配，防止旧回执恢复新等待 |
| `responseTo` | 回信对应的 `actionId` |
| trace | 每条指令的执行记录：PC、raw、decoded、寄存器增量、动作、状态 |
| checkpoint | VM/控制器的完整可恢复状态 |

## 产物与判定

| 术语 | 含义 |
| --- | --- |
| `ParsedDisc` | 解析器的结构输出，`analysisStage: "structural"` |
| `DiscIR` | 交付契约，JSON Schema 校验 |
| `IgsScene` | 提取的菜单场景（含页/按钮/对象/调色板/来源） |
| `SerializedScene` | 序列化进 `disc-data.js` 的场景（资产已解析为 ID） |
| 媒体闭包（closure） | 从入口可达的播放列表/clip/stream 集合 |
| 媒体计划（media plan） | 预转码的轨道、区间、预算估算 |
| 菜单包 | `index.html` + `runtime/` + `assets/` + 清单 |
| `stageStatus` | 命令阶段是否达成（`inspect`/`extract`） |
| `status` | 交付是否完整（`build`/`validate`） |
| `notVerified` | 未收集/未验证的证据；不降低状态 |
| `gaps` | 发布汇总里 `fail` 与 `not-verified` 的条目 |

## 常见缩写

| 缩写 | 全称 |
| --- | --- |
| STN | Stream Table（流声明） |
| SUPP | 无（仓库未使用） |
| PGS | Presentation Graphics Stream（字幕图形） |
| SUP | PGS 的导出文件扩展名 |
| MNU | igstools 兼容的 IG 流导出格式 |
| CRF | Constant Rate Factor（H.264 质量参数） |
| DPR | devicePixelRatio（画布缩放） |
| UO | User Operation |
