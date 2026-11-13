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
- `JUMP_TITLE` / `CALL_TITLE`：发 `TITLE_SEARCH`，不设媒体等待；挂起的播放列表等待只被撤销，不发 `PLAY_STOP`（播放器在标题生效时关闭播放列表）。`CALL_TITLE` 会保存调用者，选定标题后可 `RESUME`。
- `PLAY_PL*`：挂起到 `ended`；在 IG 按钮上下文忽略。
- `TERMINATE_PL`：发 `PLAY_STOP`，消费旧播放回信，恢复保存的 MovieObject PC。
- `SET_STREAM` / `SET_SEC_STREAM`：解析 GPR 操作数，更新 PSR0/1/2/3（次级为 PSR14/2），动作载荷保留原始与解析后的字。
- `SET_BUTTON_PAGE`：MovieObject 上下文按标志更新 PSR10/11；IG 上下文发打包请求并终止该按钮序列。
- 算术：ADD/MUL 饱和到 `0xffffffff`；SUB 到 0 饱和；DIV/MOD 除零返回 `0xffffffff`；移位/位操作计数必须 0–31，否则 fault。
- `RND`：固定种子的 64 位 LCG，取高字模 N + 1；`RND(0)` 返回 1 并报 `HDMV_RND_ZERO_RANGE`。

### Opcode implementation audit

状态与逐项回归按 `.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c` 的 `_hdmv_step()`、操作 helper 和 `decode.ts` 的 47 个 opcode 核对。`implemented` 表示本地 VM 覆盖参考执行路径；`reference-limited` 表示参考实现本身不执行完整行为；`reference-ambiguous` 表示参考源码将该行为标记为猜测。

| Opcode | 上下文、PC 与状态 | Action、wait 与诊断 | 状态与直接回归 |
| --- | --- | --- | --- |
| `NOP` | `object`、`ig_object` 均保持寄存器，PC+1。 | 不发 action，不等待，无诊断。 | implemented；`opcode-reference.test.ts`：NOP 与 BREAK 执行。 |
| `GOTO` | 两种上下文均设置 PC 为目标；目标达到指令数时自然结束对象。 | 不发 action，不等待，无诊断。 | implemented；`control-flow.test.ts`：GOTO 目标 PC 与对象结束。 |
| `BREAK` | 两种上下文均将 PC 置于对象末尾。 | 不发 action，不等待，无诊断。 | implemented；`opcode-reference.test.ts`：NOP 与 BREAK 执行。 |
| `JUMP_OBJECT` | 两种上下文转到目标对象 PC 0；IG 上下文有播放等待时先发 `PLAY_STOP`。缺失目标保留当前位置并记录 `HDMV_INVALID_TARGET`。 | 可能发 `PLAY_STOP`；不建立等待。 | implemented；`control-flow.test.ts`：JUMP_OBJECT 与 RESUME 调用路径；`index.test.ts`：IG 跳转释放播放等待。 |
| `JUMP_TITLE` | 两种上下文校验 title 后丢弃播放等待并进入标题转换状态；未执行下一条指令。 | 发 `TITLE_SEARCH`，不发 `PLAY_STOP`，不设 VM wait；`selectTitle()` 完成转换或记录诊断。 | implemented；`control-flow.test.ts`：JUMP_TITLE 停止当前程序；`index.test.ts`：M1 entry 标题解析、播放等待撤销不产生 `PLAY_STOP`。 |
| `CALL_OBJECT` | 两种上下文保存一帧调用者与 PSR4–8、PSR10–12，再转到目标 PC 0；`maxCallDepth: 0` fault。缺失目标记录 `HDMV_INVALID_TARGET` 并继续。 | IG 播放等待会停放并发 `PLAY_STOP`；不设调用事件等待。 | implemented；`control-flow.test.ts`：嵌套调用与缺失目标；`index.test.ts`：调用与恢复。 |
| `CALL_TITLE` | 保存一帧调用者与备份 PSR；HDMV entry 目标选定后从调用后 PC 继续。缺失 entry 记录 `HDMV_INVALID_TARGET`；BD-J 记录 `HDMV_UNVERIFIED_OPCODE`。 | 发 `TITLE_SEARCH`，不发 `PLAY_STOP`，不设 `responseTo` wait；停放中的播放等待由 `RESUME` 重发；`selectTitle()` 选择或释放失败状态。 | implemented for HDMV targets；`control-flow.test.ts`：标题调用恢复；`index.test.ts`：CALL_TITLE selection 与恢复。 |
| `RESUME` | 弹出一帧并恢复调用者 PC 与备份 PSR；有停放的播放等待时重发播放 action。 | 没有调用帧且没有停放播放时记录 `HDMV_RESUME_WITHOUT_CALL`。 | implemented；`control-flow.test.ts`：RESUME 有无调用帧；`reference-golden.test.ts`：调用恢复检查点。 |
| `PLAY_PL` | 仅 `object` 执行；PC 保存为 action 后一条。其他上下文继续执行并记录 `HDMV_OPCODE_CONTEXT_SKIPPED`。 | 发 `PLAY_PLAYLIST`，等待 `ended`。 | implemented；`index.test.ts`：Playlist 命令等待与 IG 上下文。 |
| `PLAY_PL_PI` | 仅 `object` 执行；保留 playlist 与 PlayItem 操作数。其他上下文记录上下文诊断并继续。 | 发 `PLAY_PLAYLIST_ITEM`，等待 `ended`。 | implemented；`index.test.ts`：Playlist 命令等待与 IG 上下文。 |
| `PLAY_PL_PM` | 仅 `object` 执行；保留 playlist 与 PlayMark 操作数。其他上下文记录上下文诊断并继续。 | 发 `PLAY_PLAYLIST_MARK`，等待 `ended`。 | implemented；`index.test.ts`：Playlist 命令等待；章节按钮 PlayMark 解析。 |
| `TERMINATE_PL` | 仅 `ig_object` 执行；终止按钮序列，恢复停放的 MovieObject continuation。其他上下文记录上下文诊断并继续。 | 有 continuation 时发 `PLAY_STOP`；无 continuation 时发 `PLAY_STOP` action；不等待。 | implemented；`index.test.ts`：IG TERMINATE_PL 恢复 MovieObject。 |
| `LINK_PI` | 仅 `ig_object` 执行并继续按钮序列；其他上下文记录上下文诊断并继续。 | 发 `LINK_PLAY_ITEM`，不等待。 | implemented；`index.test.ts`：IG LINK action 与 MovieObject 忽略行为。 |
| `LINK_MK` | 仅 `ig_object` 执行并继续按钮序列；其他上下文记录上下文诊断并继续。 | 发 `LINK_PLAY_MARK`，不等待。 | implemented；`control-flow.test.ts`：最大 mark 操作数。 |
| `BC` | 两种上下文按 `(a & ~b) != 0` 决定是否跳过下一条；PC 按一条或两条推进。 | 不写寄存器，不发 action，不诊断。 | implemented；`index.test.ts`：七种 unsigned compare 分支。 |
| `EQ` | 两种上下文在 `a != b` 时跳过下一条。 | 不写寄存器，不发 action，不诊断。 | implemented；`index.test.ts`：七种 unsigned compare 分支。 |
| `NE` | 两种上下文在 `a == b` 时跳过下一条。 | 不写寄存器，不发 action，不诊断。 | implemented；`index.test.ts`：七种 unsigned compare 分支。 |
| `GE` | 两种上下文在 `a < b` 时跳过下一条。 | 不写寄存器，不发 action，不诊断。 | implemented；`index.test.ts`：七种 unsigned compare 分支。 |
| `GT` | 两种上下文在 `a <= b` 时跳过下一条。 | 不写寄存器，不发 action，不诊断。 | implemented；`index.test.ts`：七种 unsigned compare 分支。 |
| `LE` | 两种上下文在 `a > b` 时跳过下一条。 | 不写寄存器，不发 action，不诊断。 | implemented；`index.test.ts`：七种 unsigned compare 分支。 |
| `LT` | 两种上下文在 `a >= b` 时跳过下一条。 | 不写寄存器，不发 action，不诊断。 | implemented；`index.test.ts`：七种 unsigned compare 分支。 |
| `MOVE` | 两种上下文将源值写入目标寄存器。 | 不发 action，不等待，无诊断。 | implemented；`index.test.ts`：uint32 arithmetic 与寄存器增量。 |
| `SWAP` | 两种上下文交换两个目标寄存器。 | 不发 action，不等待，无诊断。 | implemented；`opcode-reference.test.ts`：双寄存器值与 trace 增量。 |
| `ADD` | 两种上下文相加并饱和到 `0xffffffff`。 | 不发 action，不等待，无诊断。 | implemented；`index.test.ts`：uint32 arithmetic 边界。 |
| `SUB` | 两种上下文相减并饱和到 0。 | 不发 action，不等待，无诊断。 | implemented；`index.test.ts`：uint32 arithmetic 边界。 |
| `MUL` | 两种上下文相乘并饱和到 `0xffffffff`。 | 不发 action，不等待，无诊断。 | implemented；`index.test.ts`：uint32 arithmetic 边界。 |
| `DIV` | 两种上下文执行无符号除法；除数为 0 时写入 `0xffffffff`。 | 不发 action，不等待，无诊断。 | implemented；`index.test.ts`：uint32 arithmetic 与除零。 |
| `MOD` | 两种上下文执行无符号余数；除数为 0 时写入 `0xffffffff`。 | 不发 action，不等待，无诊断。 | implemented；`index.test.ts`：uint32 arithmetic 与除零。 |
| `RND` | 两种上下文用 checkpoint 可恢复的 64 位 LCG 写入 1 到 N 的值。 | N 为 0 时写入 1 并记录 `HDMV_RND_ZERO_RANGE`。 | implemented；`index.test.ts`：固定 seed、checkpoint 与零范围。 |
| `AND` | 两种上下文按位 AND 后写入目标寄存器。 | 不发 action，不等待，无诊断。 | implemented；`index.test.ts`：uint32 arithmetic 与 bit 边界。 |
| `OR` | 两种上下文按位 OR 后写入目标寄存器。 | 不发 action，不等待，无诊断。 | implemented；`index.test.ts`：uint32 arithmetic 与 bit 边界。 |
| `XOR` | 两种上下文按位 XOR 后写入目标寄存器。 | 不发 action，不等待，无诊断。 | implemented；`index.test.ts`：uint32 arithmetic 与 bit 边界。 |
| `BITSET` | 两种上下文设置目标寄存器的指定 bit；bit index 0–31 可用。 | index 大于 31 时 fault `HDMV_ILLEGAL_OPERAND`。 | implemented；`index.test.ts`：uint32 arithmetic 与 bit 边界。 |
| `BITCLR` | 两种上下文清除目标寄存器的指定 bit；bit index 0–31 可用。 | index 大于 31 时 fault `HDMV_ILLEGAL_OPERAND`。 | implemented；`index.test.ts`：uint32 arithmetic 与 bit 边界。 |
| `SHL` | 两种上下文按 32 位左移写入目标寄存器；shift 0–31 可用。 | shift 大于 31 时 fault `HDMV_ILLEGAL_OPERAND`。 | implemented；`index.test.ts`：uint32 arithmetic 与 bit 边界。 |
| `SHR` | 两种上下文逻辑右移写入目标寄存器；shift 0–31 可用。 | shift 大于 31 时 fault `HDMV_ILLEGAL_OPERAND`。 | implemented；`index.test.ts`：uint32 arithmetic 与 bit 边界。 |
| `SET_STREAM` | 两种上下文按 operand flags 更新 PSR0/1/2/3。 | 发 `SET_STREAM` 选择 action，不等待。 | implemented；`index.test.ts`：PSR 更新、GPR selectors 与 action payload。 |
| `SET_NV_TIMER` | 两种上下文清除或写入 PSR9；timeout 为 1–300 且对象存在时记录值。无效对象或 timeout 不改 PSR9。 | 不发 action，不等待；libbluray 记录 timer expiry 未实现。 | reference-limited；`index.test.ts`：libbluray timer 行为。 |
| `SET_BUTTON_PAGE` | `object` 按 flags 更新 PSR10/11；`ig_object` 组装 packed action 并终止按钮序列。 | `ig_object` 发 `SET_BUTTON_PAGE`，不等待。 | implemented；`index.test.ts`：立即数、GPR 与 IG packed page。 |
| `ENABLE_BUTTON` | 仅 `ig_object` 发启用 action；其他上下文记录上下文诊断并继续。 | 发 `ENABLE_BUTTON`，不等待。 | implemented；`index.test.ts`：IG page、button、popup 与 still action。 |
| `DISABLE_BUTTON` | 仅 `ig_object` 发禁用 action；其他上下文记录上下文诊断并继续。 | 发 `DISABLE_BUTTON`，不等待。 | implemented；`index.test.ts`：IG page、button、popup 与 still action。 |
| `SET_SEC_STREAM` | 两种上下文按 flags 更新 PSR14 与 PSR2。 | 发 `SET_SECONDARY_STREAM` action，不等待。 | implemented；`index.test.ts`：PSR14/2 与编码 GPR operands。 |
| `POPUP_OFF` | 仅 `ig_object` 执行；其他上下文记录上下文诊断并继续。 | 发 `POPUP_OFF`，不等待。 | implemented；`index.test.ts`：IG page、button、popup 与 still action。 |
| `STILL_ON` | 仅 `ig_object` 执行；其他上下文记录上下文诊断并继续。 | 发 `STILL_ON`，不等待。 | implemented；`index.test.ts`：IG page、button、popup 与 still action。 |
| `STILL_OFF` | 仅 `ig_object` 执行；其他上下文记录上下文诊断并继续。 | 发 `STILL_OFF`，不等待。 | implemented；`index.test.ts`：IG page、button、popup 与 still action。 |
| `SET_OUTPUT_MODE` | profile capability mask 满足 `0x00130240` 时切换 PSR22 bit 0；不满足时保持状态。 | 不发 action，不等待，无诊断。 | implemented；`index.test.ts`：timer、output-mode 与 3D subtitle 行为。 |
| `SET_STREAM_SS` | PSR22 为 2D 时保持状态；3D 对齐行为在 pinned libbluray 中未实现。 | 3D 时记录 `HDMV_3D_SUBTITLE_ALIGNMENT_UNIMPLEMENTED`。 | reference-limited；`index.test.ts`：timer、output-mode 与 3D subtitle 行为。 |
| `SETSYSTEM_0x10` | 两种上下文将第一操作数写入 PSR103；pinned helper 将该映射注释为猜测。 | 不发 action，不等待，无诊断。 | reference-ambiguous；`index.test.ts`：pinned libbluray private PSR。 |

`opcode-reference.test.ts` 为 `OpcodeName` 的每个成员运行 option-field 解码回归；类型检查要求该列表覆盖完整 union。该文件还直接核对 NOP、BREAK 与 SWAP 的 PC、寄存器和 trace 行为。其他执行回归按表中测试名列出。

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
buildNavigationGraph(objects, appendedPrograms?, { maxStates?, entries?, context?: "object" | "playlist" }): NavigationGraph
```

- 节点：`object:<id>`、`command:<objectId>:<index>`；`status: known | unknown`。
- 边：`sequence`、`conditional`、`jump`、`call`、`resume`、`play`、`unknown`；`resolution` 为 `resolved | unresolved`。可选 `origin` 描述边来源；读取方忽略未识别值。
- `JUMP_TITLE` 同时生成指向目标 entry object 的 `jump` 边和 `origin: "jump-title"` 的 `sequence` 边；原程序下一条指令不会因此成为可达。
- `context` 默认是 `object`；`LINK_PI` / `LINK_MK` 在 object context 不终止指令流，在 playlist context 终止。`TERMINATE_PL` 只在 playlist context 终止。
- 立即数目标可解析就建 resolved 边；寄存器目标、缺失目标、编码非法、预算耗尽保留 `unresolved` 并写 `diagnostics`。不把未解析路径标成不可达。
- `findStaticNavigationLoops(graph)` 用 DFS 回边，返回 `{ backEdge, cycle, movieObjects, commandLocations }`。`scripts/visualize-hdmv-vm-flow.mjs` 用它生成 Markdown 流程图。

## 测试

| 文件 | 覆盖 |
| --- | --- |
| `src/index.test.ts` | 寄存器初始化、指令语义、SET_STREAM/SET_BUTTON_PAGE、PSR 更新、trace、checkpoint |
| `src/control-flow.test.ts` | GOTO/BREAK/RESUME、JUMP_TITLE/CALL_TITLE 事件边界、越界目标 |
| `src/loops.test.ts` | 静态循环检测 |
| `src/reference-golden.test.ts` | 从 libbluray 源码推导的检查点 golden（首个差异即失败） |

跨包一站式覆盖见 `apps/cli/tests/integration/synthetic-all-features.test.ts`：MOVE/RND/PLAY_PL 序列的解码与 VM 执行。

golden 文件：`src/fixtures/libbluray-1.5.0-source-derived-reference-golden.json`。它由源码推导，不是 libbluray 运行 trace。

## 改动入口

| 需求 | 位置 | 同步 |
| --- | --- | --- |
| 新增/修正操作码语义 | `vm.ts` 对应 case + `decode.ts` 的选项表 | `docs/support/hdmv-support.md` 的 opcode 表、`src/index.test.ts` |
| 改寄存器默认/权限 | `registers.ts` `reset` / `READ_ONLY_PSRS` | `docs/support/hdmv-support.md` 寄存器矩阵 |
| 改等待条件 | `vm.ts` 的等待声明与 `handleEvent` | `openspec/specs/hdmv-navigation/spec.md` 的异步场景 |
| 改导航图 | `graph.ts` | `packages/media-export/src/closure.ts`（消费闭包）与图相关测试 |

改语义前先确认有无独立证据：`unverified` 的行可以按固定实现改，但要在 `docs/support/hdmv-support.md` 保留证据状态，不能写成“已核验”。
