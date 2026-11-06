# `@bdmv2web/hdmv`

HDMV 导航层：把 12 字节命令解码成操作码，维护 GPR/PSR，执行控制流与异步播放动作，产出可复现 trace 和导航图。

行为基准是固定 revision 的 libbluray 1.5.0（`docs/support/hdmv-support.md` 记录逐指令状态）。`docs/review-2026-11-06-hdmv-vm-conformance/` 保存了与参照实现的差异清单与修复记录。

## 文件

| 文件 | 内容 |
| --- | --- |
| `src/decode.ts` | `decodeInstruction`、`disassemble`、`Operand`、`OpcodeName` |
| `src/registers.ts` | `RegisterFile`、`PSR` 索引常量、`profileWord`、`RegisterFault` |
| `src/vm.ts` | `HdmvVm`：状态机、事件、动作、等待、trace、检查点 |
| `src/graph.ts` | `buildNavigationGraph`：对象/命令节点与边 |
| `src/loops.ts` | `findStaticNavigationLoops`：DFS 回边找静态循环 |
| `src/fixtures.ts` | M3 合成指令向量（测试用，不是协议 golden） |

## 解码

输入统一为 12 字节：`MovieInstruction`、`RawCommand`、`Uint8Array`、24 位 hex 字符串。`bytesFrom` 会校验 `words` 与 `bytes` 一致，不一致直接抛错（不做静默修正）。

Word 0 字段（与 libbluray 的 MOBJ 读取一致）：

| 位 | 字段 |
| --- | --- |
| 31–29 | 操作数个数 |
| 28–27 | group：0 分支 / 1 比较 / 2 设置 |
| 26–24 | subgroup |
| 23, 22 | 操作数 1/2 是否为立即数 |
| 21–20, 15–12, 7–5 | 保留位；非零 → `HDMV_RESERVED_BITS_NONZERO`，继续执行 |
| 19–16 | branch option |
| 11–8 | compare option |
| 4–0 | set option |

`operand()`：非立即数时最高位为 1 表示 PSR（值取低 7 位），否则 GPR（低 12 位）；超出有效掩码的位标 `invalid`。

`DecodedInstruction.status`：`reference-only` | `unverified` | `invalid`。`invalid` 表示编码无法执行，VM 会 fault，不转成 no-op。

## 寄存器

| 项 | 值 |
| --- | --- |
| GPR | 4096 × uint32，初始 0 |
| PSR | 128 × uint32 |
| 程序写入 PSR | 拒绝 → `INVALID_REGISTER_ACCESS` |
| `systemWrite` 只读集 | PSR13、15–21、23–31、48–61 |
| 语言/国家 | 3/2 个字符按大端打包（`eng` → `0x656e67`，`US` → `0x5553`） |
| region | A/B/C → 1/2/4 |
| 能力覆盖 | `PlayerProfile.capabilityValues`，仅允许 PSR15、23–31、48–61 |

`RegisterFile.reset(profile)` 写入固定默认值（PSR15=`0xaaaa`、PSR29=`0x03`、PSR31=`0x00030200`、PSR48–61=`0xffffffff` 等），再覆盖 profile 字段。相同 profile 重置两次得到相同寄存器与 trace。

## VM

```ts
new HdmvVm(programs: Array<VmProgram | MovieObject>, options?: VmOptions)
```

`VmOptions`：`limits`、`maxInstructionsPerTurn`、`maxCallDepth`、`maxQueueDepth`、`profile`、`entries`、`onTrace`、`randomSeed`。

### 状态与方法

| 成员 | 作用 |
| --- | --- |
| 状态 | `idle` / `running` / `suspended` / `stopped` / `faulted` |
| `reset(programId?, profile?, randomSeed?)` | 重置寄存器、调用栈、播放上下文；`generation` 保留 |
| `runTurn()` | 执行指令直到等待、终止或预算耗尽；返回快照 |
| `handleEvent(event)` | 系统事件入口（媒体完成、菜单输入、返回等） |
| `selectTitle(title)` | 响应 `TITLE_SEARCH` 后的标题选择 |
| `executeButtonCommand(cmd, source?, context?)` | 单条按钮命令；`context` 为 `object` 或 `ig_object` |
| `executeButtonProgram(commands, context?)` | 整段按钮命令；返回动作、终止标记、fault |
| `applyMenuContext(pageId, selectedButtonId)` | 同步 PSR10/11 |
| `beginMenuAction()` / `recoverMenuAction(action?)` | 按钮命令期间的菜单上下文保护/恢复 |
| `saveCheckpoint()` / `restoreCheckpoint()` | 完整状态快照（含寄存器、调用栈、播放、等待、队列） |
| `snapshot()` | 只读快照 |
| `drainActions()` / `enqueueEvent()` / `processNextEvent()` | 队列操作 |

### 执行规则

- 普通指令 PC+1；`GOTO` 目标 ≥ 指令数视为对象结束（回到 `idle`，不 fault）。
- `JUMP_OBJECT`：进入目标对象 PC 0，保留挂起的播放上下文；结束挂起播放时发 `PLAY_STOP`。
- `CALL_OBJECT`：保存当前对象/下一 PC 与 PSR4–8、10–12 到备份 PSR；IG 按钮调用会停放播放并 `PLAY_STOP`，`RESUME` 重发停放的动作。
- `JUMP_TITLE` / `CALL_TITLE`：发 `TITLE_SEARCH`，不设媒体等待；`CALL_TITLE` 会保存调用者，选定标题后可 `RESUME`。
- `PLAY_PL*`：挂起到 `ended`；在 IG 按钮上下文忽略。
- `TERMINATE_PL`：发 `PLAY_STOP`，消费旧播放回信，恢复保存的 MovieObject PC。
- `SET_STREAM` / `SET_SEC_STREAM`：解析 GPR 操作数，更新 PSR0/1/2/3（次级为 PSR14/2），动作载荷保留原始与解析后的字。
- `SET_BUTTON_PAGE`：MovieObject 上下文按标志更新 PSR10/11；IG 上下文发打包请求并终止该按钮序列。
- 算术：ADD/MUL 饱和到 `0xffffffff`；SUB 到 0 饱和；DIV/MOD 除零返回 `0xffffffff`；移位/位操作计数必须 0–31，否则 fault。
- `RND`：固定种子的 64 位 LCG，取高字模 N + 1；`RND(0)` 返回 1 并报 `HDMV_RND_ZERO_RANGE`。

### 异步与等待

| 动作 | 等待 |
| --- | --- |
| `PLAY_PLAYLIST` / `PLAY_PLAYLIST_ITEM` / `PLAY_PLAYLIST_MARK` | `ended` |
| 需要精确落点的动作 | `seeked` |
| `STILL_ON` 相关 | `still-completed`（当前无生产者） |
| 菜单动作（`MENU_CALL`、`POPUP_OFF`、按钮启停等） | 无 VM 等待 |

回信必须匹配 `generation` + `responseTo`；不匹配记 `HDMV_DUPLICATE_EVENT` / `HDMV_IGNORED_EVENT` 并忽略。媒体错误/不可用结束对应等待并进入 `stopped` + 诊断，不永久 `suspended`。

播放状态事件回写 PSR：`PLAYITEM_CHANGED` → PSR7，`TIME_UPDATED`/`MEDIA_SEEKED` → PSR8（45 kHz），播放列表 → PSR6，PSR5 置 `0xffff`。

### 用户操作掩码

`handleEvent({ type: "MENU_INPUT", channel: "keyboard" | "pointer", ... })` 与运行时 `MenuController` 用同一份页面 UO mask 判定；被禁操作报 `HDMV_UO_BLOCKED`，键盘与指针结果一致。`MEDIA_*` 与 still 完成事件走系统事件路径，不受 UO 过滤。

### 预算与 fault

| 码 | 触发 |
| --- | --- |
| `VM_EXECUTION_LIMIT` | 单轮超过 `maxInstructionsPerTurn`；保留最后快照 |
| `VM_QUEUE_LIMIT` | 待处理队列超过 `maxQueueDepth` |
| `VM_CALL_DEPTH_LIMIT` | `maxCallDepth < 1` 时遇到 CALL |
| `HDMV_UNKNOWN_OPCODE` / `HDMV_UNKNOWN_GROUP` / `HDMV_INVALID_INSTRUCTION` | 无法解码；保留 raw 与来源 |
| `HDMV_ILLEGAL_OPERAND` / `HDMV_INVALID_REGISTER_ENCODING` / `INVALID_REGISTER_ACCESS` | 操作数或寄存器非法 |
| `HDMV_INVALID_TARGET` / `HDMV_INVALID_PC` | 对象/标题/PC 越界 |
| `HDMV_OPCODE_CONTEXT_SKIPPED` | 上下文不允许该指令（info，继续执行） |
| `HDMV_RESUME_WITHOUT_CALL` | 空调用栈执行 `RESUME`（继续） |

## 导航图

```ts
buildNavigationGraph(objects, appendedPrograms?, { maxStates?, entries? }): NavigationGraph
```

- 节点：`object:<id>`、`command:<objectId>:<index>`；`status: known | unknown`。
- 边：`sequence`、`conditional`、`jump`、`call`、`resume`、`play`、`unknown`；`resolution` 为 `resolved | unresolved`。
- 立即数目标可解析就建 resolved 边；寄存器目标、缺失目标、编码非法、预算耗尽保留 `unresolved` 并写 `diagnostics`。不把未解析路径标成不可达。
- `findStaticNavigationLoops(graph)` 用 DFS 回边，返回 `{ backEdge, cycle, movieObjects, commandLocations }`。`scripts/visualize-hdmv-vm-flow.mjs` 用它生成 Markdown 流程图。

## 测试

| 文件 | 覆盖 |
| --- | --- |
| `src/index.test.ts` | 寄存器初始化、指令语义、SET_STREAM/SET_BUTTON_PAGE、PSR 更新、trace、checkpoint |
| `src/control-flow.test.ts` | GOTO/BREAK/RESUME、JUMP_TITLE/CALL_TITLE 事件边界、越界目标 |
| `src/loops.test.ts` | 静态循环检测 |
| `src/reference-golden.test.ts` | 从 libbluray 源码推导的检查点 golden（首个差异即失败） |
| `src/bdmvkit-rnd.test.ts` | RND 三个播放列表分支 |

golden 文件：`src/fixtures/libbluray-1.5.0-source-derived-reference-golden.json`。它由源码推导，不是 libbluray 运行 trace。

## 改动入口

| 需求 | 位置 | 同步 |
| --- | --- | --- |
| 新增/修正操作码语义 | `vm.ts` 对应 case + `decode.ts` 的选项表 | `docs/support/hdmv-support.md` 的 opcode 表、`src/index.test.ts` |
| 改寄存器默认/权限 | `registers.ts` `reset` / `READ_ONLY_PSRS` | `docs/support/hdmv-support.md` 寄存器矩阵 |
| 改等待条件 | `vm.ts` 的等待声明与 `handleEvent` | `openspec/specs/hdmv-navigation/spec.md` 的异步场景 |
| 改导航图 | `graph.ts` | `packages/media-export/src/closure.ts`（消费闭包）与图相关测试 |

改语义前先确认有无独立证据：`unverified` 的行可以按固定实现改，但要在 `docs/support/hdmv-support.md` 保留证据状态，不能写成“已核验”。
