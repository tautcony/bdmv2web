# 功能：HDMV 导航

从 12 字节命令到可交互菜单，中间有四个环节：解码 → 执行 → 导航图 → 媒体闭包。四个环节对同一份数据给出不同粒度的结论，排查时先确认卡在哪一环。

## 1. 解码

`decodeInstruction` 只做字段拆解，不执行。产出 `opcode`、`operands`、`issues`、`status`。

- `status: "invalid"`：编码不自洽（操作数个数、保留位组合、非法寄存器编码）。执行会 fault，静态图把边标 `unresolved`。
- `issues`：可容忍的问题（保留位非零、操作数被忽略），执行继续并写诊断。
- 来源：`source.path` / `offset` 保留到 MOBJ 记录或按钮命令数组的原始偏移。

## 2. 执行（VM）

`HdmvVm` 是单线程状态机，外部通过事件驱动：

```text
reset(programId) ──▶ runTurn() ──▶ 快照（idle/suspended/stopped/faulted）
                        │
                        ├─ 发动作（NavigationAction，带 generation）
                        └─ 等回信（VmEvent，带 generation + responseTo）
```

### 动作与等待

| 动作 | 谁消费 | 等待 |
| --- | --- | --- |
| `PLAY_PLAYLIST` / `PLAY_PLAYLIST_ITEM` / `PLAY_PLAYLIST_MARK` | 播放桥 | `ended` |
| `PLAY_STOP` / `MENU_CALL` / `POPUP_OFF` / `ENABLE_BUTTON` / `DISABLE_BUTTON` / `SET_BUTTON_PAGE` / `STILL_ON` / `STILL_OFF` | 运行时 | 无 |
| `TITLE_SEARCH` | 宿主调用 `selectTitle()` | 无媒体等待 |
| `SET_STREAM` / `SET_SECONDARY_STREAM` | 播放桥 | 无 |

`generation` 在动作发布前递增；回信必须同时匹配 `generation` 与 `responseTo`。旧代次、重复回信、非当前等待的事件都记 trace 并忽略。

### 上下文

| 上下文 | 触发 | 差异 |
| --- | --- | --- |
| MovieObject | `runTurn` | `PLAY_PL*` 挂起；`LINK_PI/MK`、按钮启停被忽略（`HDMV_OPCODE_CONTEXT_SKIPPED`） |
| IG 按钮 | `executeButtonProgram` | `PLAY_PL*` 被忽略；`LINK_PI/MK`、按钮启停、`TERMINATE_PL` 生效 |

按钮程序有独立的局部 PC；`GOTO` 与条件跳转作用于该数组，寄存器、预算、trace、动作与 VM 共享。程序结束时如果 VM 停在播放等待上，恢复该挂起状态。

### 播放状态回写

| 事件 | 更新 |
| --- | --- |
| `PLAYITEM_CHANGED` | PSR7 |
| `TIME_UPDATED` / `MEDIA_SEEKED` | PSR8（45 kHz） |
| 播放列表变更 | PSR6；PSR5 置 `0xffff` |
| `MEDIA_ERROR` / `MEDIA_UNAVAILABLE` | 结束等待，`stopped` + 诊断 |

### 用户操作

`MENU_INPUT` 的键盘与指针走同一判定：运行时 `MenuController` 先按页面 UO mask 过滤，VM 再应用一次 `uoAllowed`。被禁操作报 `HDMV_UO_BLOCKED`，键盘与指针结果一致。`MEDIA_*` 与 still 完成事件不受 UO 过滤。

## 3. 转换期导航（`build` 如何找到菜单）

`findTopMenuPlaylist` 在转换期跑一次 VM，用于从 First Play 走到 Top Menu：

1. `vm.reset(firstPlayObject)`，`runTurn()`；若有媒体等待，`releaseExternalPlayback` 视为完成。
2. `selectTitle(0)` 进入 `index.bdmv` 声明的 Top Menu。
3. 循环最多 64 步：
   - 遇到 `PLAY_PLAYLIST*` 等待 → 找该播放列表的 PlayItem，检查它是否引用 `uiModel === 0` 的 IGS 场景（按 clip + PID 匹配）。
   - 命中 → 返回该播放列表与 PlayItem，并把之前走过的播放列表记为 `preMenuPlaylistIds`。
   - 未命中 → 记为 `fallbackTarget`，用 `MEDIA_ENDED` 完成当前播放，继续。
   - 遇到 `TITLE_SEARCH` → `selectTitle(目标)` 继续。
4. 64 步耗尽 → 返回 `fallbackTarget`（可能为空）。

这条链解释了为什么有些碟片的菜单不是“第一个 `PLAY_PLAYLIST`”：前面可能有 logo、警告或正片片段。

## 4. 导航图与媒体闭包

| 层 | 函数 | 粒度 | 未解析时的处理 |
| --- | --- | --- | --- |
| 结构图 | `bdmv-parser` `buildGraph` | 文件引用（entry→object→playlist→clip→stream） | 边标 `missing`/`unresolved` |
| 指令图 | `hdmv` `buildNavigationGraph` | 对象与命令 | 动态目标保留 `unresolved`，不判不可达 |
| 媒体闭包 | `media-export` `computeMediaClosure` | 可达播放列表/clip/stream | 有未知项时放宽到全部播放列表，`complete: false` |

`computeMediaClosure` 的输入是结构图 + MovieObject 图 + 按钮程序图。条件边按并集遍历；`routes` 记录每条到达路径的来源，便于回答“这个播放列表为什么被导出”。

`findStaticNavigationLoops` 只做静态回边检测，用来发现潜在死循环和高频路径；它不执行 VM，也不判断可达性。

## 常见偏差

| 现象 | 可能原因 | 检查点 |
| --- | --- | --- |
| 菜单闪退/黑屏 | `vmInitialProgramId` 无效或 Top Menu Object 缺失 | 包内 `disc-data.js` 的 `vmInitialProgramId`；`M4_MENU_OBJECT_CONTEXT_MISSING` |
| 按钮点击无反应 | 按钮命令未执行、UO 被禁、页面无有效 BOG | `runtime-diagnostics`、`HDMV_UO_BLOCKED`、`IGS_BUTTON_WITHOUT_BOG` |
| 进入菜单后停在播放 | `PLAY_PLAYLIST` 等待未被回信 | 播放桥是否发出 `MEDIA_ENDED`/`MEDIA_UNAVAILABLE` |
| 点“播放影片”无反应 | 外部播放目标缺失或被平台拒绝 | `external-targets.json`、`EXTERNAL_*`、浏览器控制台 |
| VM 报 `HDMV_UNKNOWN_OPCODE` | 编码不在这套实现的支持表内 | `docs/support/hdmv-support.md` 的 opcode 表；raw 与来源 |
| VM 报 `VM_EXECUTION_LIMIT` | 同步循环或预算过小 | `--limits` 的 `maxInstructionsPerTurn`；trace 末尾 PC |

## 证据与边界

- opcode 语义以固定 revision 的 libbluray 1.5.0 为基准；多数行标 `reference-only / unverified`，表示缺独立 golden，不是未实现。
- `maxCallDepth` 当前是 CALL 开关，不是嵌套深度限制。
- `docs/review-2026-11-06-hdmv-vm-conformance/index.md` 记录逐指令核对、运行模型差异与修复顺序。
