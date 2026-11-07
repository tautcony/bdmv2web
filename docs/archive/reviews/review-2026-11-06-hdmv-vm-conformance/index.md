# HDMV VM 一致性审计（对照 libbluray 1.5.0 与 libhdmv 2026-03）

> 日期：2026-11-06
> 审计对象：[packages/hdmv/src/vm.ts](../../../../packages/hdmv/src/vm.ts)（817 行，工作区未提交版本）、[decode.ts](../../../../packages/hdmv/src/decode.ts)、[registers.ts](../../../../packages/hdmv/src/registers.ts)
> 主要基线：[libbluray 1.5.0 hdmv_vm.c](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c)、[hdmv_insn.h](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_insn.h)、[mobj_parse.c](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/mobj_parse.c)、[register.c](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/register.c)、[bluray.c](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c)
> 次要基线：[libhdmv 2026-03 session.rs](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs)、[decode.rs](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-insn/src/decode.rs)
> 语料：`test-data/bdmv` 2 张盘 + `test-data/fixtures/hdmv-navigation/disc-data` 5 张盘的 MovieObject，以及 8 个 IGS 包 fixture 中的按钮命令。

> **修复状态（2026-11-06）**：本文列出的 P0/P1 已落地，逐项状态与验证见第 9 节。第 0–8 节保留审计当时的证据和 `vm.ts` 行号；修复后行号已变化，当前实现状态以 [hdmv-support.md](../../../support/hdmv-support.md) 为准。

## 0. 结论摘要

### 0.1 基线选择

- **libbluray 1.5.0 是行为基线。** 它有完整的指令分派、对象挂起/恢复、播放列表控制、PSR 写保护、随机数、导航定时器和 UO mask 处理。
- **libhdmv 2026-03 不能作为行为 golden。** 它是 Alpha 实现，解码位布局与 HDMV 不符，比较指令使用 `condition` 标志而不是“跳过下一条”，算术语义与 libbluray 不同，SETSYSTEM 只发事件不写 PSR。仓库 [hdmv-support.md](../../../support/hdmv-support.md) 已声明这一点；本次逐项核对确认该结论。它只能用于交叉检查文件结构，不能用于判定 `vm.ts` 正确性。

### 0.2 审计时直接破坏菜单导航的问题（已修复）

本次审计用真实盘的按钮命令复现了 3 个 P0 问题，均与“事件边界”和“挂起状态”有关：

| ID | 现象 | 语料证据 |
| --- | --- | --- |
| VM-01 | `JUMP_TITLE` 发出 `TITLE_SEARCH` 后继续执行同一程序的下一条命令，同一个按钮会发出两个 `TITLE_SEARCH` | `battle-royale-uhd` clip `00002` page 10–20 button 0：`LT GPR[5],#2; JUMP_TITLE #0; JUMP_TITLE GPR[5]`；GPR5=1 时复现为 `TITLE_SEARCH title=0` 后紧跟 `TITLE_SEARCH title=1` |
| VM-02 | 菜单播放列表处于等待状态时，`TOP_MENU` / `POPUP_MENU` / `RETURN` 全部被拒绝，弹出菜单和主菜单键无响应 | [vm.ts:426-429](../../../../packages/hdmv/src/vm.ts#L426-L429)；VM 复现输出 `HDMV_INPUT_WHILE_SUSPENDED`，动作数为 0 |
| VM-03 | `TOP_MENU` 被建模为“等待 `MEDIA_STARTED`”的 VM 动作，运行时不回应该动作；按一次主菜单键会把 VM 永久留在 `suspended` | `WAIT_BY_ACTION` 第 49 行；[browser.ts:317-320](../../../../packages/runtime-web/src/browser.ts#L317-L320) 与 [index.ts:724](../../../../packages/runtime-web/src/index.ts#L724) 都没有 `TOP_MENU` 分支 |

### 0.3 高优先级问题（已修复）

| ID | 问题 |
| --- | --- |
| VM-04 | `RESUME` 在没有调用帧时把 VM 置为 `faulted`；libbluray 记录错误后继续执行。语料 `tamako` 主菜单 button 0 第 68 条就是 `RESUME` |
| VM-05 | MovieObject 中的 `BREAK` 把 VM 置为终态 `stopped`；libbluray 把它当作对象结束并允许后续选择对象。语料 `kyoani-ova` 主菜单对象第 29 条是 `BREAK` |
| VM-06 | IG 按钮程序在播放列表等待期间包含 `CALL_OBJECT` 会被整体拒绝；libbluray 允许从 IG 对象调用对象并挂起正在播放的 MovieObject |
| VM-07 | PSR5/6/7/8 没有按播放状态更新；语料读取 PSR5 46 次、PSR6 16 次、PSR7 18 次、PSR8 16 次。`MEDIA_SEEKED` 的 payload 字段名也与 VM 读取的字段不一致 |
| VM-08 | 单一 `status` 同时表示“MovieObject 正在执行”“MovieObject 等待播放列表结束”“等待标题选择”三种状态，导致 VM-02/06 和一批特判；这是模型层面的根因 |

### 0.4 总体判断（审计时）

- 指令的**解码位布局**与 libbluray 一致；算术/比较/位操作的核心语义一致；PSR 默认值、写保护、备份寄存器范围一致。
- **运行逻辑**与 libbluray 的差异集中在：事件边界、对象槽位、用户输入与 UO、播放 PSR、错误处理策略。
- 语料中 0 条 MovieObject / 0 条 IG 命令被解码器判为非法，说明现有盘的编码没有触发解码严格性；解码严格性仍是其他盘的风险点。

## 1. 审计方法与证据

### 1.1 已执行的检查

1. 逐函数对照 `vm.ts` 与 libbluray `hdmv_vm.c` / `hdmv_insn.h` / `register.c` / `bluray.c`。
2. 对 2 张完整盘和 5 张 fixture 盘的 `MovieObject.bdmv` 做全量解码统计。
3. 对 8 个 IGS packet fixture 做完整 IGS 提取，统计 550 个按钮、2472 条按钮命令的指令分布。
4. 在 VM 层构造最小复现，记录 `status`、动作、trace 与寄存器结果。
5. 运行现有测试：`packages/hdmv` 82 项、`packages/igs` 56 项、`packages/runtime-web` 104 项，全部通过（审计时）；修复后为 hdmv 88 项，其余见第 9 节。测试通过只说明现有断言成立，不说明行为与参考实现一致；多处断言本身固化了本文列出的差异。

### 1.2 未执行的检查

- 未在真实播放器或 libbluray 运行时上做逐指令 trace 对照。
- 未在浏览器中手工验收主菜单键、弹出菜单键和跨标题导航；本文的运行时结论来自代码路径与 VM 层复现。
- 未覆盖 BD-J、UHD 扩展、二级视频/音频的实际播放效果。

### 1.3 评估口径

| 标记 | 含义 |
| --- | --- |
| 一致 | 与 libbluray 的可观察行为相同，或差异仅在日志/内部表示 |
| 部分一致 | 主路径相同，但边界条件、错误处理、事件时序或状态不同 |
| 不一致 | 会产生不同的寄存器、PC、动作或状态 |
| 产品差异 | 与 libbluray 不同，但属于本项目的明确产品选择（需在文档中说明） |

### 1.4 libhdmv 2026-03 基线核对

[hdmv-insn decode.rs](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-insn/src/decode.rs) 与 [hdmv-vm session.rs](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs) 的语义与 libbluray 冲突，不能用作行为 golden：

| 主题 | libhdmv 2026-03 | libbluray | 影响 |
| --- | --- | --- | --- |
| 指令位布局 | group 取 bits 31–30，subgroup 取 bits 27–24（4 bit），option 统一取 bits 19–16（[decode.rs:88-98](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-insn/src/decode.rs#L88-L98)） | group 28–27、subgroup 26–24（3 bit）；branch option 19–16、compare option 11–8、set option 4–0 | group/subgroup/compare/set 都会被错误解码 |
| 操作数 | PSR 索引 `raw & 0x0FFF`，无有效位检查（[decode.rs:103-116](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-insn/src/decode.rs#L103-L116)） | PSR 索引 `raw & 0x7f`，并检查非法位 | 越界寄存器读被静默当作 0 |
| 条件执行 | compare 设置 `condition` 标志，`Goto` 只在条件为真时跳转（[session.rs:114-127](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs#L114-L127)、[session.rs:185-198](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs#L185-L198)） | GOTO 无条件；compare 通过“条件不成立则跳过下一条”控制下一条指令 | 控制流模型不同 |
| BC | `(lhs & rhs) != 0`（[session.rs:117-125](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs#L117-L125)） | `(dst & ~src) != 0`（[hdmv_vm.c:1137](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1137)） | BC 结果不同 |
| 算术 | ADD/SUB/MUL 使用 wrapping；DIV/MOD 除零返回 0；RND 固定返回 1（[session.rs:129-174](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs#L129-L174)） | ADD/MUL 饱和；SUB 下溢归零；DIV/MOD 除零返回 `0xffffffff`；RND 使用 LCG | 寄存器结果不同 |
| 位操作 | BitSet 使用 `src & 31`，移位使用 wrapping_shl/shr（[session.rs:164-170](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs#L164-L170)） | 未定义行为；x86 实际按 5 位取模 | 行为未对齐 |
| SETSYSTEM | 只发 `NavEvent`，不写 PSR；SET_STREAM 只使用第一个操作数（[session.rs:244-279](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs#L244-L279)） | 直接更新 PSR0/1/2/3/14 等 | 寄存器状态完全不同 |
| 播放列表 | `BranchOp::PlayPl` 只发事件，run 循环继续执行后续指令（[session.rs:223-240](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs#L223-L240)） | `_play_at` 挂起 MovieObject，等待播放结束 | 与本文 VM-01 同类的问题 |
| 调用栈 | `Vec` 深度 16，`Resume` 弹栈（[session.rs:197-222](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs#L197-L222)） | 只保留一个 suspended object | 嵌套调用语义不同 |
| 寄存器 | 所有 PSR 初始为 0，无只读策略（[registers.rs:59-85](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/registers.rs#L59-L85)） | 有完整默认值、只读集合、备份 PSR | 初始化状态不同 |
| 未知指令 | 记录 warning 后继续（[session.rs:178-181](../../../../.reference-cache/libhdmv-2026-03/crates/hdmv-vm/src/session.rs#L178-L181)） | 记录日志后继续（[hdmv_vm.c:1217-1220](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1217-L1220)） | 这一点接近，但当前项目 spec 要求阻止路径 |

结论：`libhdmv` 的 VM 是未完成的执行器，适合作为“另一种解码尝试”的参考，不适合作为本项目的期望状态来源。本文所有“参考行为”均指 libbluray 1.5.0。

## 2. 运行模型对照

### 2.1 对象槽位

libbluray 的 `hdmv_vm_s` 有四个独立槽位：

| 槽位 | 含义 | 当前实现 |
| --- | --- | --- |
| `object` | 正在执行的 MovieObject 或 IG object | `programId` + `pc` + `status === "running"` |
| `playing_object` / `playing_pc` | 被 `PLAY_PL` 挂起、等待播放结束的 MovieObject | `continuation`（`action.waitFor === "ended"`）+ `status === "suspended"` |
| `suspended_object` / `suspended_pc` | 被 `CALL_OBJECT` / `CALL_TITLE` 保存的对象 | `callStack`（实际最多 1 帧） |
| `ig_object` | 当前 IGS 按钮命令对象 | `executeButtonProgram` 的局部 `pc` + `context === "ig_object"` |

libbluray 允许 `playing_object` 与 `ig_object` 同时存在：播放列表播放时 `object` 为 NULL，但 IGS 解码器仍可通过 `hdmv_vm_set_object` 设置按钮对象并执行。当前实现把 `playing_object` 折叠进 `status === "suspended"`，因此“等待播放列表”同时意味着“拒绝用户输入”，只能靠 `isSafeIgProgramDuringPlaylistWait` 开后门放行按钮程序。

**结论：不一致，属于模型级根因（VM-08）。** 修复时应把 `playingContinuation`（播放位置）与 `executionStatus`（是否可接收输入/能否运行 IG 程序）分开，而不是继续给 `suspended` 增加例外。

### 2.2 状态机

| libbluray | 当前 | 差异 |
| --- | --- | --- |
| `hdmv_vm_running() == !!object` | `status === "running"` | 基本对应 |
| `object == NULL && playing_object != NULL`（播放列表播放中） | `status === "suspended"` + `continuation` | 被当成“不可输入”状态；用户事件被拒绝 |
| `object == NULL && suspended_object != NULL`（CALL 保存） | `status === "suspended"` + `callStack` | 同上；`RESUME` 前不能接收用户事件 |
| `object != NULL && ig_object != NULL` | `status === "running"` + 局部按钮 PC | 基本对应 |
| 对象结束 → `object = NULL`，发 `HDMV_EVENT_END` / `IG_END` | `status === "idle"`，记 `PROGRAM_END` | 产品化差异；VM 可被复用，合理，但 `BREAK` 走了另一条路（`stopped`） |
| 指令异常 → `hdmv_vm_run` 返回 -1 | `status === "faulted"` | 基本对应，但当前对很多 libbluray 容忍的情况直接 fault |

`stopped` 只由 `BREAK` 和媒体错误路径产生。`BREAK` 使用终态与 libbluray 的“对象结束”语义不一致（VM-05）。

### 2.3 执行循环与事件边界

libbluray `_vm_run` 的规则（[hdmv_vm.c:1399-1452](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1399-L1452)）：

1. 如果事件队列非空，直接返回事件，不执行指令。
2. 每执行一条指令后检查事件队列；**只要产生事件就返回**。应用处理事件后再次调用 `hdmv_vm_run` 才继续。
3. `pc >= num_cmds` → 对象结束，发 `END` / `IG_END`。
4. 1,000,000 条指令上限。

当前 `runTurn`（[vm.ts:304-336](../../../../packages/hdmv/src/vm.ts#L304-L336)）只在“动作带 `waitFor`”时把状态改成 `suspended`；`JUMP_TITLE`、`LINK_PI`、`LINK_MK`、`ENABLE_BUTTON`、`STILL_*`、`POPUP_OFF` 等动作不会中断执行。这与 libbluray 的“事件即返回”不同。

直接后果：

- `JUMP_TITLE` 后面的指令继续执行，包括第二条 `JUMP_TITLE`、`BREAK`、`PLAY_PL`。这是 VM-01。
- `LINK_PI` / `LINK_MK` 后面的按钮命令在运行时执行 seek 之前就执行了；影响较小，因为语料里的 LINK 通常位于程序末尾。
- `ENABLE_BUTTON` / `DISABLE_BUTTON` / `POPUP_OFF` 后面的命令先执行；对寄存器无影响，通常无害。
- `BREAK` 在 `executeButtonProgram` 中被当作局部“结束程序”（[vm.ts:280-281](../../../../packages/hdmv/src/vm.ts#L280-L281)），在 `runTurn` 中却被当作终态（[vm.ts:460](../../../../packages/hdmv/src/vm.ts#L460)）；同一指令有两条语义。

### 2.4 播放列表挂起与恢复

MovieObject 的 `PLAY_PL` 主路径与 libbluray 一致：

- 当前 `actionAndSuspend` 保存 `nextProgramId` / `nextPc`，状态 `suspended`，等待 `MEDIA_ENDED`（[vm.ts:753-758](../../../../packages/hdmv/src/vm.ts#L753-L758)）。
- libbluray `_suspend_for_play_pl` 保存 `playing_object` / `playing_pc`，`object = NULL`；应用在播放结束时调用 `hdmv_vm_resume`，PC 设为 `playing_pc + 1`（[hdmv_vm.c:440-470](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L440-L470)）。
- 当前 `nextPc` 在 `runTurn` 中已递增，等价于 `playing_pc + 1`。

差异：

- libbluray 在播放列表播放期间仍允许 IG 按钮程序；当前只允许“安全程序”，且 `CALL_OBJECT` 被拒绝（[vm.ts:669-678](../../../../packages/hdmv/src/vm.ts#L669-L678)）。
- libbluray 的 `TERMINATE_PL` 在没有 `playing_object` 时仍发 `PLAY_STOP` 并继续执行下一条；当前直接结束按钮程序（[vm.ts:543-548](../../../../packages/hdmv/src/vm.ts#L543-L548)）。
- 当前 `TERMINATE_PL` 恢复 MovieObject 后立即 `runTurn`（[vm.ts:297-300](../../../../packages/hdmv/src/vm.ts#L297-L300)），libbluray 只把 `PLAY_STOP` 交给应用，稍后再运行。
- 当前 `JUMP_OBJECT` 在 IG + 播放列表等待时先发 `PLAY_STOP` 再跳转（[vm.ts:482-484](../../../../packages/hdmv/src/vm.ts#L482-L484)），这是对 libbluray `_jump_object` 的合理适配；但 MovieObject 上下文没有等价的 `PLAY_STOP` 事件。

### 2.5 CALL / RESUME

一致的部分：

- 只保留一个挂起上下文。`CALL_OBJECT` 用 `splice(0, length, frame)` 替换旧帧（[vm.ts:490](../../../../packages/hdmv/src/vm.ts#L490)），符合 libbluray “discard old suspended object (10.2.4.2.2)” 的注释（[hdmv_vm.c:476-479](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L476-L479)）。
- 保存/恢复 PSR4–8、PSR10–12 到 PSR36–40、PSR42–44，恢复后重置备份寄存器（[vm.ts:716-729](../../../../packages/hdmv/src/vm.ts#L716-L729)；[register.c:276-360](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/register.c#L276-L360)）。
- 恢复 PC 为调用指令的下一条。当前保存的 `pc` 已是下一条，语义等价。

不一致的部分：

- `RESUME` 在 `callStack` 为空时 `throw RegisterFault`（[vm.ts:494-497](../../../../packages/hdmv/src/vm.ts#L494-L497)）。libbluray `_resume_object` 返回 -1，`_hdmv_step` 忽略失败并继续执行下一条（[hdmv_vm.c:512-518](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L512-L518)）。
- 在 IG 按钮程序中执行 `CALL_OBJECT` 时，保存的是 `this.pc`（MovieObject 的 PC），不是按钮程序的 PC；libbluray 在 IG 上下文挂起的是 `playing_object`，IG 程序本身不会成为“被调用返回点”。因此即使移除 `isSafe...` 的限制，当前 CALL/RESUME 在 IG 中也不能按 libbluray 工作（VM-06）。
- `RESUME` 的“挂起在 PLAY_PL 时恢复播放”分支由 `suspendedPlaylistContinuation` 模拟（[vm.ts:498-503](../../../../packages/hdmv/src/vm.ts#L498-L503)），只在 `CALL_TITLE` 中设置；`CALL_OBJECT` 不会设置它。libbluray 的 `_resume_object` 检查的是被挂起对象本身是否停在 `PLAY_PL`，与调用指令无关。

### 2.6 标题导航

libbluray：

- `JUMP_TITLE`：验证标题；丢弃 `suspended_object` 和 `playing_object`；重置备份 PSR；发 `HDMV_EVENT_TITLE`。事件处理中 `_close_playlist`，应用 `_play_title` 设置 PSR4 并打开目标对象（[hdmv_vm.c:591-608](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L591-L608)；[bluray.c:3735-3743](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L3735-L3743)）。
- `CALL_TITLE`：`_suspend_object(psr_backup=1)`，发 `HDMV_EVENT_TITLE`；目标对象执行 `RESUME` 时恢复调用者。
- 应用层标题搜索（`bd_play_title` / `bd_menu_call`）不是 VM 动作：主菜单走 `bd_menu_call` → `hdmv_vm_suspend_pl` → `_play_title(top menu)`，UO 由 `menu_call` 位控制（[bluray.c:3662-3730](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L3662-L3730)）。

当前：

- `JUMP_TITLE` 清空 `callStack`、`suspendedPlaylistContinuation`、备份 PSR，发 `TITLE_SEARCH`，但**不中断执行**（[vm.ts:505-514](../../../../packages/hdmv/src/vm.ts#L505-L514)）。
- `CALL_TITLE` 设置 `pendingTitleCall` 并挂起，`selectTitle` 以 `isCallReturn` 区分（[vm.ts:515-537](../../../../packages/hdmv/src/vm.ts#L515-L537)、[vm.ts:338-372](../../../../packages/hdmv/src/vm.ts#L338-L372)）。主路径与 libbluray 接近。
- 主菜单没有被实现为“播放器导航”：`handleUserEvent` 把 `TOP_MENU` 变成 VM 动作并等待 `MEDIA_STARTED`（VM-03）。
- `selectTitle` 只写 PSR4；libbluray 的播放器在打开播放列表时还写 PSR5/6/7/8（见 2.8）。

### 2.7 用户输入与 UO mask

libbluray：

- `hdmv_vm_get_uo_mask` 暴露两位：`menu_call_mask`（bit0）和 `title_search_mask`（bit1）（[hdmv_vm.c:1324-1342](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1324-L1342)）。
- `bd_menu_call`（主菜单）检查 `uo_mask.menu_call`；`bd_play_title`（标题搜索）检查 `uo_mask.title_search`（[bluray.c:3662-3730](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L3662-L3730)）。
- 弹出菜单是独立的 UO（`UO_MASK_POPUP_ON_MASK_INDEX = 24`），由播放列表/IGS 的 UO mask 控制，不由 MovieObject 的 `menu_call_mask` 控制（[uo_mask_table.h:24-46](../../../../.reference-cache/repositories/libbluray-1.5.0/src/libbluray/bdnav/uo_mask_table.h#L24-L46)）。
- UO 在播放列表播放期间照常处理；`hdmv_vm_suspend_pl` 保存播放位置后切换标题。

当前：

- 状态为 `suspended` 时，所有 `MENU_INPUT` / `TOP_MENU` / `POPUP_MENU` / `RETURN` 都被拒绝（[vm.ts:426-429](../../../../packages/hdmv/src/vm.ts#L426-L429)）。菜单背景循环播放时 VM 一直是 `suspended`，所以弹出菜单/主菜单键在菜单里基本不可用。
- `TOP_MENU` 用 `titleSearchMask` 判断（[vm.ts:439](../../../../packages/hdmv/src/vm.ts#L439)），与 libbluray 的 `menu_call_mask` 相反。
- `POPUP_MENU` 用 `menuCallMask` 判断（[vm.ts:439](../../../../packages/hdmv/src/vm.ts#L439)），多了一层 libbluray 没有的门；页面/播放列表的 UO24 已经由 `MenuController.isUoAllowed(24)` 检查（[index.ts:404-410](../../../../packages/runtime-web/src/index.ts#L404-L410)）。
- `TOP_MENU` / `MENU_CALL` 都带 `waitFor: "started"`（[vm.ts:49](../../../../packages/hdmv/src/vm.ts#L49)）。`MENU_CALL` 由浏览器回应；`TOP_MENU` 没有回应方。

### 2.8 播放状态与 PSR5–8

libbluray 的播放器在播放过程中更新：

| PSR | 写入点 | 当前实现 |
| --- | --- | --- |
| PSR4 标题 | `_play_title` | `selectTitle` 写入（[vm.ts:364](../../../../packages/hdmv/src/vm.ts#L364)） |
| PSR5 章节 | `_update_playlist_psrs` 置 `0xffff`；章节更新时写 chapter+1（[bluray.c:410-458](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L410-L458)） | 不从播放状态写入；只在 `RESUME` 时从备份恢复（备份值同样来自未更新的 PSR） |
| PSR6 播放列表 | `_update_playlist_psrs` 写 `atoi(title->name)`（[bluray.c:410](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L410)） | 不从播放状态写入；只在 `RESUME` 时从备份恢复 |
| PSR7 PlayItem | `_update_clip_psrs` 写 `clip->ref`（[bluray.c:367](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L367)） | `RESUME` 从备份恢复；`PLAYITEM_CHANGED` 时写（[vm.ts:417](../../../../packages/hdmv/src/vm.ts#L417)）；运行时没有该事件的生产者 |
| PSR8 时间 | `_update_clip_psrs` 写 `clip->in_time`，播放中持续更新（[bluray.c:368](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L368)、[bluray.c:285-290](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L285-L290)） | `RESUME` 从备份恢复；`TIME_UPDATED` / `MEDIA_SEEKED` 时读 `payload.presentationTime`（[vm.ts:418](../../../../packages/hdmv/src/vm.ts#L418)）；运行时没有 `TIME_UPDATED` 生产者，`MEDIA_SEEKED` 发的是 `mediaTimeSeconds`（[linear-playback.ts:176](../../../../packages/runtime-web/src/linear-playback.ts#L176)） |

语料中这些 PSR 的读取次数：PSR5 46、PSR6 16、PSR7 18、PSR8 16。依赖这些寄存器的菜单分支会走默认路径。`PLAY_PLAYLIST_MARK` 也没有把 mark/章节写入 PSR5。

### 2.9 寄存器

一致：

- GPR 4096、PSR 128（[register.h:28-29](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/register.h#L28-L29)；[registers.ts:3-4](../../../../packages/hdmv/src/registers.ts#L3-L4)）。
- 默认值逐项匹配 `bd_psr_init`：PSR0=1、1=0xff、2=0x0fff0fff、3=1、4/5=0xffff、10=0xffff、12=0xff、13=0xff、14=0xffff、15=0xaaaa、29=0x03、30=0x1ffff、31=0x00030200、36/37=0xffff、42=0xffff、44=0xff、48–61=0xffffffff（[register.c:42-123](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/register.c#L42-L123)；[registers.ts:38-53](../../../../packages/hdmv/src/registers.ts#L38-L53)）。
- `bd_psr_write` 的只读集合 13、15–21、23–31、48–61 与 `READ_ONLY_PSRS` 一致（[register.c:450-461](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/register.c#L450-L461)；[registers.ts:5-10](../../../../packages/hdmv/src/registers.ts#L5-L10)）。
- 程序写 PSR 被拒绝（[vm.ts:706](../../../../packages/hdmv/src/vm.ts#L706)；[hdmv_vm.c:185-198](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L185-L198)）。

产品差异：

- PSR16/17/18=0x656e67 (`eng`)、PSR19=0x5553 (`US`)、PSR20=1 (A)，由 `DEFAULT_PLAYER_PROFILE` 注入；libbluray 默认是 0xffffff / 0xffffff / 0xffffff / 0xffff / 2 (B)。这是 [hdmv-support.md](../../../support/hdmv-support.md) 明确的产品选择，会改变语言选择分支。需要在支持文档里保持“产品默认值”的措辞。
- PSR21=0 与 libbluray 的 `BLURAY_OUTPUT_PREFER_2D` 一致。

### 2.10 随机数、预算、检查点

- RND 的 64 位 LCG、取高 32 位、`% range + 1`、range=0 返回 1 与 libbluray 一致（[vm.ts:707-714](../../../../packages/hdmv/src/vm.ts#L707-L714)；[hdmv_vm.c:1032-1042](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1032-L1042)）。
- 默认种子为 1；libbluray release 用 `time(NULL)`，DEBUG 用 1。当前选择可复现，属于产品差异。
- `maxInstructionsPerTurn` 默认 10,000（[limits.ts](../../../../packages/core/src/limits.ts)），libbluray `MAX_LOOP` 为 1,000,000。长循环盘会提前 fault。
- `maxCallDepth` 只作为“是否允许 CALL”的开关（小于 1 拒绝），因为实际只保留一帧；与文档一致，但参数名有误导性。
- `saveCheckpoint` / `restoreCheckpoint` 覆盖寄存器、PC、调用帧、continuation、播放上下文、随机状态、队列、trace、动作；属于产品能力，libbluray 的 `_save_state` 只保存 `playing/suspended` 对象索引和 PC（[hdmv_vm.c:83-146](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L83-L146)）。检查点不是标准语义，但实现本身完整。

## 3. 指令逐项对照

### 3.1 解码器

[decode.ts:47-78](../../../../packages/hdmv/src/decode.ts#L47-L78)：

| 字段 | libbluray `mobj_parse_cmd` | 当前 | 结论 |
| --- | --- | --- | --- |
| operand count | bits 31–29（3 bit） | `w0 >>> 29` | 一致 |
| group | bits 28–27（2 bit） | `(w0 >>> 27) & 3` | 一致 |
| subgroup | bits 26–24（3 bit） | `(w0 >>> 24) & 7` | 一致 |
| imm1 / imm2 | bits 23 / 22 | `0x00800000` / `0x00400000` | 一致 |
| branch option | bits 19–16 | `(w0 >>> 16) & 0xf` | 一致 |
| compare option | bits 11–8 | `(w0 >>> 8) & 0xf` | 一致 |
| set option | bits 4–0（5 bit） | `w0 & 0x1f` | 一致 |
| reserved | bits 21–20、15–12、7–5 | 掩码 `0x0030f8e0` | 不一致：多包含 bit 11（compare option 的最高位）；且没有检查 branch/compare 上下文中未使用的 set option 位 |

参阅 [mobj_parse.c:52-72](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/mobj_parse.c#L52-L72)。

其他解码差异：

- `HDMV_RESERVED_BITS_NONZERO`、`HDMV_ILLEGAL_OPERAND_COUNT`、`HDMV_INVALID_REGISTER_ENCODING` 都把 `status` 置为 `invalid`，随后 VM fault。libbluray 对保留位不检查，对多余操作数只打日志，对非法寄存器读返回 0、写返回 -1。
- `SETSYSTEM_0x10` 强制 2 个操作数；libbluray 只使用 dst，操作数个数未在参考中约束。
- 目标操作数为立即数的算术指令、RND 目标不是 GPR 会判非法；libbluray 会在 `_store_result` / `_store_reg` 失败后继续。当前策略更严格。
- 语料中 0 条非法解码。严格性目前没有影响这 7 张盘。

### 3.2 BRANCH / GOTO

| 指令 | 当前 | libbluray | 结论 |
| --- | --- | --- | --- |
| NOP | 无操作（[vm.ts:459](../../../../packages/hdmv/src/vm.ts#L459)） | 无操作（[hdmv_vm.c:1085](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1085)） | 一致；解码要求 0 操作数 |
| GOTO | `pc = av`（[vm.ts:461](../../../../packages/hdmv/src/vm.ts#L461)），越界由下一次循环判 `HDMV_INVALID_PC` | `pc = dst`；下一次循环 `pc >= num_cmds` → `END`（[hdmv_vm.c:1086](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1086)、[hdmv_vm.c:1424-1435](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1424-L1435)） | 部分一致：越界目标 fault，参考是正常结束 |
| BREAK | MovieObject：`status = "stopped"`（[vm.ts:460](../../../../packages/hdmv/src/vm.ts#L460)）；按钮程序：只设 `terminated`（[vm.ts:280-281](../../../../packages/hdmv/src/vm.ts#L280-L281)） | `pc = 1 << 17` → `END` / `IG_END`，VM 可继续选择对象（[hdmv_vm.c:1087](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1087)） | 不一致：MovieObject 变终态；两条路径语义不同 |

### 3.3 BRANCH / JUMP

| 指令 | 当前 | libbluray | 结论 |
| --- | --- | --- | --- |
| JUMP_OBJECT | 立即 `transfer(av, 0)`；IG + 播放列表等待时先 `stopPlaylistForIgJump`（[vm.ts:482-484](../../../../packages/hdmv/src/vm.ts#L482-L484)） | 发 `PLAY_STOP`，清 `playing_object`，`object = target`，`pc = 0`；保留 `suspended_object`（[hdmv_vm.c:568-589](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L568-L589)） | 部分一致：寄存器结果相同；MovieObject 上下文少 `PLAY_STOP` 事件，事件时序不同 |
| JUMP_TITLE | 验证标题、清调用栈/挂起播放列表/备份 PSR，发 `TITLE_SEARCH`，**继续执行**（[vm.ts:505-514](../../../../packages/hdmv/src/vm.ts#L505-L514)） | 验证标题、丢弃 `suspended_object` / `playing_object`、重置备份 PSR，发 `TITLE` 事件；`_vm_run` 立即返回（[hdmv_vm.c:591-608](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L591-L608)） | 不一致（P0）：后续指令在真实播放器中不会执行 |
| CALL_OBJECT | 保存单帧后立即跳转（[vm.ts:485-493](../../../../packages/hdmv/src/vm.ts#L485-L493)） | `_suspend_object(psr_backup=1)` 后 `_jump_object`；发 `PLAY_STOP`（[hdmv_vm.c:610-622](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L610-L622)） | 部分一致：单帧替换一致；IG 上下文保存的 PC 与 libbluray 的 `playing_object` 语义不同；`isSafe...` 在等待期间拒绝 |
| CALL_TITLE | 验证标题/对象，保存调用帧与 PSR，设置 `pendingTitleCall`，挂起，发 `TITLE_SEARCH`（[vm.ts:515-537](../../../../packages/hdmv/src/vm.ts#L515-L537)） | `_suspend_object(1)`，发 `TITLE` 事件（[hdmv_vm.c:624-639](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L624-L639)） | 主路径一致；错误标题响应会永久挂起（见 4 节 S9） |
| RESUME | 弹栈；空栈 fault；恢复 PSR 与 PC；有 `suspendedPlaylistContinuation` 时恢复等待（[vm.ts:494-504](../../../../packages/hdmv/src/vm.ts#L494-L504)） | 空上下文返回 -1 并继续；若挂起对象停在 `PLAY_PL`，恢复 `playing_object`；否则恢复对象并发 `PLAY_STOP`（[hdmv_vm.c:512-549](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L512-L549)） | 不一致：空栈 fault；播放恢复模型只覆盖 CALL_TITLE 路径 |

### 3.4 BRANCH / PLAY

| 指令 | 当前 | libbluray | 结论 |
| --- | --- | --- | --- |
| PLAY_PL | 仅 MovieObject；发动作并挂起（[vm.ts:538](../../../../packages/hdmv/src/vm.ts#L538)） | 仅非 IG；发 `PLAY_PL` 并 `_suspend_for_play_pl`（[hdmv_vm.c:645-668](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L645-L668)） | 一致（等待条件是本项目产品建模） |
| PLAY_PL_PI | 同上，payload `{ playlist, playItem }`（[vm.ts:539](../../../../packages/hdmv/src/vm.ts#L539)） | 发 `PLAY_PL_PI(playlist, playitem)` | 一致 |
| PLAY_PL_PM | 同上，payload `{ playlist, playMark }`（[vm.ts:540](../../../../packages/hdmv/src/vm.ts#L540)） | 发 `PLAY_PL_PM(playlist, playmark)` | 部分一致：不写 PSR5/mark |
| TERMINATE_PL | 仅 IG；有播放等待时恢复 MovieObject；否则只发 `PLAY_STOP` 并结束按钮程序（[vm.ts:543-548](../../../../packages/hdmv/src/vm.ts#L543-L548)） | 仅 IG；发 `PLAY_STOP(1)`；有 `playing_object` 时恢复，否则继续执行下一条（[hdmv_vm.c:691-708](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L691-L708)） | 部分一致：无播放对象时的路径不同；恢复后立即 `runTurn` 提前执行 |
| LINK_PI | 仅 IG；发 `LINK_PLAY_ITEM`，不挂起（[vm.ts:541](../../../../packages/hdmv/src/vm.ts#L541)） | 仅 IG；发 `PLAY_PI`；事件返回后由播放器 seek（[hdmv_vm.c:670-689](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L670-L689)） | 部分一致：事件后继续执行，时序不同；运行时不处理该动作 |
| LINK_MK | 同上（[vm.ts:542](../../../../packages/hdmv/src/vm.ts#L542)） | 发 `PLAY_PM` | 部分一致：同上 |

### 3.5 COMPARE

| 指令 | 当前 | libbluray | 结论 |
| --- | --- | --- | --- |
| BC | `(av & ~bv) !== 0` 跳过下一条（[vm.ts:462](../../../../packages/hdmv/src/vm.ts#L462)、[vm.ts:785](../../../../packages/hdmv/src/vm.ts#L785)） | `pc += !!(dst & ~src)`（[hdmv_vm.c:1137](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1137)） | 一致 |
| EQ | `av !== bv` 跳过（[vm.ts:463](../../../../packages/hdmv/src/vm.ts#L463)） | `pc += !(dst == src)`（[hdmv_vm.c:1138](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1138)） | 一致 |
| NE | `av === bv` 跳过 | `pc += !(dst != src)` | 一致 |
| GE | `av < bv` 跳过 | `pc += !(dst >= src)` | 一致 |
| GT | `av <= bv` 跳过 | `pc += !(dst > src)` | 一致 |
| LE | `av > bv` 跳过 | `pc += !(dst <= src)` | 一致 |
| LT | `av >= bv` 跳过 | `pc += !(dst < src)` | 一致 |

注意：比较是“条件不成立则跳过下一条”，不是 libhdmv 的 `condition` 标志 + 条件 GOTO。当前实现与 libbluray 一致。

### 3.6 SET / 算术与位操作

| 指令 | 当前 | libbluray | 结论 |
| --- | --- | --- | --- |
| MOVE | `write(a, bv)`（[vm.ts:469](../../../../packages/hdmv/src/vm.ts#L469)） | `dst = src`；写回（[hdmv_vm.c:1161](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1161)） | 一致；立即数目标当前 fault，参考忽略 |
| SWAP | 写 a=bv、b=av（[vm.ts:470](../../../../packages/hdmv/src/vm.ts#L470)） | 交换后写回（[hdmv_vm.c:1162](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1162)） | 一致；立即数源当前 fault，参考忽略 |
| ADD | `min(0xffffffff, av+bv)`（[vm.ts:471](../../../../packages/hdmv/src/vm.ts#L471)） | 饱和（[hdmv_vm.c:1044-1049](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1044-L1049)） | 一致 |
| SUB | `av > bv ? av-bv : 0`（[vm.ts:472](../../../../packages/hdmv/src/vm.ts#L472)） | 同上（[hdmv_vm.c:1163](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1163)） | 一致 |
| MUL | 饱和（[vm.ts:473](../../../../packages/hdmv/src/vm.ts#L473)） | 饱和（[hdmv_vm.c:1051-1056](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1051-L1056)） | 一致 |
| DIV | 除零 → `0xffffffff`（[vm.ts:474](../../../../packages/hdmv/src/vm.ts#L474)） | 除零 → `0xffffffff`（[hdmv_vm.c:1164](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1164)） | 一致 |
| MOD | 除零 → `0xffffffff`（[vm.ts:475](../../../../packages/hdmv/src/vm.ts#L475)） | 同上（[hdmv_vm.c:1165](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1165)） | 一致 |
| RND | 64 位 LCG，高 32 位取模（[vm.ts:476](../../../../packages/hdmv/src/vm.ts#L476)、[vm.ts:707-714](../../../../packages/hdmv/src/vm.ts#L707-L714)） | 相同（[hdmv_vm.c:1032-1042](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1032-L1042)） | 一致；默认种子是产品差异 |
| AND / OR / XOR | 32 位位运算后 `>>> 0` 写入（[vm.ts:477-479](../../../../packages/hdmv/src/vm.ts#L477-L479)、[vm.ts:706](../../../../packages/hdmv/src/vm.ts#L706)） | uint32 位运算 | 一致 |
| BITSET / BITCLR | 位号 ≥ 32 抛 `HDMV_ILLEGAL_OPERAND`（[vm.ts:480](../../../../packages/hdmv/src/vm.ts#L480)） | `1 << src`；C 未定义，x86 实际按 5 位取模 | 不一致：当前会 fault，参考不会 |
| SHL / SHR | 移位数 ≥ 32 抛错；SHR 用 `>>>`（[vm.ts:481](../../../../packages/hdmv/src/vm.ts#L481)） | `dst <<= src` / `dst >>= src`；C 未定义，x86 取模 | 不一致：当前会 fault |

### 3.7 SET / SETSYSTEM

| 指令 | 当前 | libbluray | 结论 |
| --- | --- | --- | --- |
| SET_STREAM | 解析双 GPR 编码；写 PSR1/0/3/2；发动作（[vm.ts:549-569](../../../../packages/hdmv/src/vm.ts#L549-L569)） | 相同位运算（[hdmv_vm.c:714-752](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L714-L752)） | 一致 |
| SET_NV_TIMER | timeout=0 清 PSR9；1–300 且目标对象存在时写 PSR9（[vm.ts:599-606](../../../../packages/hdmv/src/vm.ts#L599-L606)） | 相同，并记录定时器；到期逻辑在参考中也被注释掉（[hdmv_vm.c:924-982](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L924-L982)） | 一致（可观察部分） |
| SET_BUTTON_PAGE | MovieObject 写 PSR10/11；IG 打包并发动作并结束按钮程序（[vm.ts:607](../../../../packages/hdmv/src/vm.ts#L607)、[vm.ts:647-656](../../../../packages/hdmv/src/vm.ts#L647-L656)） | 相同（[hdmv_vm.c:837-863](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L837-L863)） | 一致 |
| ENABLE_BUTTON | 仅 IG 发动作；其他上下文记一条跳过诊断（[vm.ts:608](../../../../packages/hdmv/src/vm.ts#L608)） | 仅 IG 发事件；其他上下文静默忽略（[hdmv_vm.c:865-875](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L865-L875)） | 一致（诊断是附加信息） |
| DISABLE_BUTTON | 同上（[vm.ts:609](../../../../packages/hdmv/src/vm.ts#L609)） | 同上 | 一致 |
| SET_SEC_STREAM | 写 PSR14、PSR2；发动作（[vm.ts:570-598](../../../../packages/hdmv/src/vm.ts#L570-L598)） | 相同位运算（[hdmv_vm.c:754-806](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L754-L806)） | 一致 |
| POPUP_OFF | 仅 IG 发动作（[vm.ts:610](../../../../packages/hdmv/src/vm.ts#L610)） | 仅 IG 发事件（[hdmv_vm.c:885-891](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L885-L891)） | 一致 |
| STILL_ON / STILL_OFF | 仅 IG 发动作（[vm.ts:611-612](../../../../packages/hdmv/src/vm.ts#L611-L612)） | 仅 IG 发 `STILL(1/0)`（[hdmv_vm.c:877-883](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L877-L883)） | VM 一致；运行时不处理 still 动作 |
| SET_OUTPUT_MODE | `(PSR31 & 0x130240) == 0x130240` 时更新 PSR22 bit0（[vm.ts:613-618](../../../../packages/hdmv/src/vm.ts#L613-L618)） | 相同（[hdmv_vm.c:897-918](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L897-L918)） | 一致 |
| SET_STREAM_SS | PSR22 bit0 为 0 时忽略；为 1 时记 `HDMV_UNVERIFIED_OPCODE` 诊断（[vm.ts:619-623](../../../../packages/hdmv/src/vm.ts#L619-L623)、[vm.ts:701-705](../../../../packages/hdmv/src/vm.ts#L701-L705)） | 2D 忽略；3D 只打 `unimplemented` 日志（[hdmv_vm.c:808-818](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L808-L818)） | 部分一致：诊断码会被当成“未验证操作码” |
| SETSYSTEM_0x10 | 写 PSR103 = av（[vm.ts:624](../../../../packages/hdmv/src/vm.ts#L624)） | 写 PSR103 = dst（[hdmv_vm.c:820-831](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L820-L831)） | 一致；操作数个数 2 是未验证约束 |
| 未知 opcode / group | `HDMV_UNKNOWN_OPCODE` 或 `HDMV_ILLEGAL_OPERAND_COUNT` → fault（[vm.ts:625](../../../../packages/hdmv/src/vm.ts#L625)） | 打日志并继续（[hdmv_vm.c:1217-1220](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1217-L1220)） | 不一致：本项目 spec 要求报告并阻止路径，保留该策略需在文档中明确 |

## 4. 特殊分支清单

下表列出 `vm.ts` 中不属于 libbluray 语义、或为了适配本项目事件模型而加入的分支。判断基于“是否可以用标准对象槽位/事件模型替代”。

| # | 分支 | 位置 | 作用 | 判断 |
| --- | --- | --- | --- | --- |
| S1 | `WAIT_BY_ACTION` 给 `TOP_MENU` / `MENU_CALL` 加 `started` 等待 | [vm.ts:49](../../../../packages/hdmv/src/vm.ts#L49) | 把播放器导航建模成 VM 等待 | `MENU_CALL` 可保留（弹出覆盖层是产品能力）；`TOP_MENU` 应移除，改为播放器级标题选择 |
| S2 | `HDMV_INPUT_WHILE_SUSPENDED` | [vm.ts:426-429](../../../../packages/hdmv/src/vm.ts#L426-L429) | 播放列表等待期间拒绝用户输入 | 与 libbluray 不符；应由对象槽位模型替代，只允许在“标题切换中”拒绝输入 |
| S3 | `resumePendingPlaylist`（`executeButtonCommand` / `executeButtonProgram`） | [vm.ts:189](../../../../packages/hdmv/src/vm.ts#L189)、[vm.ts:239](../../../../packages/hdmv/src/vm.ts#L239) | 让特定按钮程序在等待播放时临时运行 | 模型修好后可删除；当前只放行 TERMINATE_PL / JUMP_OBJECT / “安全程序” |
| S4 | `isTerminatePlaylistCommand` / `isJumpObjectCommand` | [vm.ts:661-668](../../../../packages/hdmv/src/vm.ts#L661-L668) | 预解码按钮命令以决定是否放行 | 与 S3 一起删除 |
| S5 | `isSafeIgProgramDuringPlaylistWait` | [vm.ts:669-678](../../../../packages/hdmv/src/vm.ts#L669-L678) | 拒绝含 `CALL_OBJECT` 的 IG 程序 | libbluray 允许 IG CALL_OBJECT；应改为真正的 IG 对象上下文 |
| S6 | `stopPlaylistForIgJump` | [vm.ts:679-687](../../../../packages/hdmv/src/vm.ts#L679-L687) | IG JUMP_OBJECT 时结束播放等待 | 方向正确；标准模型下 `_jump_object` 自然会清 `playing_object` 并发 `PLAY_STOP` |
| S7 | `resumeMovieObjectAfterPlaylistStop` + `resumeAfterPlaylistStop` | [vm.ts:688-700](../../../../packages/hdmv/src/vm.ts#L688-L700)、[vm.ts:297-300](../../../../packages/hdmv/src/vm.ts#L297-L300) | TERMINATE_PL 后恢复 MovieObject 并立即运行 | 可保留恢复位置；立即 `runTurn` 应改为“发事件后返回” |
| S8 | `suspendedPlaylistContinuation` / `suspendedPlaylistPlayback` | [vm.ts:64](../../../../packages/hdmv/src/vm.ts#L64)、[vm.ts:527-529](../../../../packages/hdmv/src/vm.ts#L527-L529) | CALL_TITLE 时暂存 IG 的播放等待 | 标准模型用 `playing_object` 即可；当前只覆盖 CALL_TITLE |
| S9 | `pendingTitleCall` + `selectTitle` 匹配 | [vm.ts:339-343](../../../../packages/hdmv/src/vm.ts#L339-L343)、[vm.ts:533-535](../../../../packages/hdmv/src/vm.ts#L533-L535) | 等待外部标题选择；错误标题忽略 | 保留；缺少超时/取消路径，错误响应会让 VM 永久挂起 |
| S10 | `HDMV_UNVERIFIED_OPCODE` → `idle` + PC 回退 | [vm.ts:329](../../../../packages/hdmv/src/vm.ts#L329)、[vm.ts:769](../../../../packages/hdmv/src/vm.ts#L769) | 未实现操作码不把 VM 置为 faulted | 状态语义混合；应区分“fatal fault”“unsupported + 跳过”两种结果 |
| S11 | `noteInstructionDiagnostic` | [vm.ts:701-705](../../../../packages/hdmv/src/vm.ts#L701-L705) | 上下文不适用时记录非致命诊断 | 可保留；`SET_STREAM_SS` 使用 `HDMV_UNVERIFIED_OPCODE` 会污染诊断 |
| S12 | `menuCheckpoint` / `beginMenuAction` / `recoverMenuAction` | [vm.ts:156-186](../../../../packages/hdmv/src/vm.ts#L156-L186) | 按钮动作失败时恢复菜单状态 | 产品能力；`beginMenuAction` 在 suspended 时覆盖旧检查点，导致 VM-03 无法恢复 |
| S13 | `releaseExternalPlayback` | [vm.ts:374-382](../../../../packages/hdmv/src/vm.ts#L374-L382) | 外部播放器交接后释放等待 | 产品能力；恢复检查点或 idle，行为合理 |
| S14 | `MEDIA_STARTED` 对 `ended` 等待记 `HDMV_EVENT_NOT_READY` | [vm.ts:413](../../../../packages/hdmv/src/vm.ts#L413) | 记录非匹配事件 | 无害但每次正常播放都会留诊断；`playback.status` 一直停在 `requested` |
| S15 | `maxCallDepth < 1` 作为 CALL 开关 | [vm.ts:487](../../../../packages/hdmv/src/vm.ts#L487)、[vm.ts:525](../../../../packages/hdmv/src/vm.ts#L525) | 禁用 CALL | 与单帧实现匹配；参数名误导 |
| S16 | `validateTitleTarget` 对 top/firstPlay 额外要求 target ≠ 0xffff | [vm.ts:735](../../../../packages/hdmv/src/vm.ts#L735) | 把 sentinel 当作无效 | 未在参考中找到对应检查；保留需说明 |
| S17 | `SET_STREAM` 的 PSR2 读改写 | [vm.ts:557-561](../../../../packages/hdmv/src/vm.ts#L557-L561) | 只更新对应位 | 与参考一致，不是特判 |
| S18 | `SET_NV_TIMER` 用 `programs.has(objectId)` 校验 | [vm.ts:602](../../../../packages/hdmv/src/vm.ts#L602) | 目标对象必须存在 | 与参考 `mobj_id >= num_objects` 等价 |
| S19 | `transfer` 额外写 `TRANSFER` trace | [vm.ts:747](../../../../packages/hdmv/src/vm.ts#L747) | 记录控制转移 | 使 trace 出现无指令条目；仅可读性问题 |
| S20 | `executeButtonProgram` 的 `this.pc !== ownerPc` 作为控制转移判据 | [vm.ts:292](../../../../packages/hdmv/src/vm.ts#L292) | 检测 JUMP/CALL | 在 IG 上下文中 `this.pc` 是 MovieObject PC，语义混乱；随 VM-08 一起重构 |

## 5. 问题清单

### 5.1 P0

#### VM-01 `JUMP_TITLE` 之后继续执行

- **位置**：[vm.ts:505-514](../../../../packages/hdmv/src/vm.ts#L505-L514)；`runTurn` 循环 [vm.ts:304-336](../../../../packages/hdmv/src/vm.ts#L304-L336)；`executeButtonProgram` 循环 [vm.ts:254-293](../../../../packages/hdmv/src/vm.ts#L254-L293)。
- **参考**：`_jump_title` 只发 `HDMV_EVENT_TITLE`；`_vm_run` 在 `_hdmv_step` 后立即 `_get_event` 并返回（[hdmv_vm.c:591-608](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L591-L608)、[hdmv_vm.c:1443-1446](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1443-L1446)）。
- **现象**：同一按钮产生两个 `TITLE_SEARCH`。语料复现：`battle-royale-uhd` page 10–20 的 `LT GPR[5],#2; JUMP_TITLE #0; JUMP_TITLE GPR[5]`，当 GPR5<2 时执行第一条 `JUMP_TITLE #0` 后继续执行第二条：GPR5=1 时输出 `TITLE_SEARCH 0` 与 `TITLE_SEARCH 1`，GPR5=0 时输出两次 `TITLE_SEARCH 0`。浏览器会依次处理两个 `TITLE_SEARCH`：GPR5=1 时先选中主菜单再跳到 title 1，最终进入错误标题；GPR5=0 时重复进入主菜单。
- **影响**：主菜单/章节/语言按钮跳到错误标题；`JUMP_TITLE` 后的 `BREAK`、`PLAY_PL` 也会被提前执行。
- **修复**：`JUMP_TITLE` 发出 `TITLE_SEARCH` 后终止当前运行（类似 `CALL_TITLE` 的挂起，或专门的 `titleTransition` 状态），并让 `executeButtonProgram` 立即 break；`selectTitle` 负责继续。

#### VM-02 播放列表等待期间拒绝所有用户输入

- **位置**：[vm.ts:426-429](../../../../packages/hdmv/src/vm.ts#L426-L429)。
- **参考**：libbluray 在 `playing_object` 存在、`object == NULL` 时仍处理 UO；主菜单调用 `hdmv_vm_suspend_pl` 后再切换标题（[bluray.c:3662-3730](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L3662-L3730)）。
- **现象**：菜单背景播放列表处于等待时，`TOP_MENU` / `POPUP_MENU` / `RETURN` 记录 `HDMV_INPUT_WHILE_SUSPENDED`，动作数为 0。在 VM 驱动菜单（`vmInitialProgramId` + `media`）且菜单循环 `loop=true` 的包里，运行时不发 `MEDIA_ENDED`，所以整个菜单会话都处于该状态。弹出菜单键在编辑好的菜单里基本不可用。
- **修复**：把“播放列表等待”从 `status` 中拆出；用户事件只在标题切换/调用挂起期间拒绝。

#### VM-03 `TOP_MENU` 被建模为等待 `MEDIA_STARTED` 的 VM 动作

- **位置**：[vm.ts:49](../../../../packages/hdmv/src/vm.ts#L49)、[vm.ts:438-442](../../../../packages/hdmv/src/vm.ts#L438-L442)。
- **参考**：主菜单是播放器操作：`bd_menu_call` → `_try_menu_call` → `hdmv_vm_suspend_pl` → `_play_title(TOP_MENU)`；没有 VM 等待。UO 位是 `menu_call`（[bluray.c:3662-3730](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L3662-L3730)）。
- **现象**：`TOP_MENU` 发出 `waitFor: "started"` 的动作并挂起。浏览器在 `MENU_CALL` 等分支才回 `MEDIA_STARTED`，`TOP_MENU` 没有对应分支（[browser.ts:218-242](../../../../packages/runtime-web/src/browser.ts#L218-L242)）；`TOP_MENU` 落到通用分支，`MenuLoopPlaybackBridge.dispatch` 对非 `PLAY_PLAYLIST` 直接返回（[index.ts:724](../../../../packages/runtime-web/src/index.ts#L724)），`PreviewPlaybackBridge` 也不处理 `TOP_MENU`（[index.ts:654-664](../../../../packages/runtime-web/src/index.ts#L654-L664)）。VM 永久 `suspended`。
- **加重因素**：下一次按钮按下时 `beginMenuAction` 会用当前 `suspended` 状态覆盖检查点（[vm.ts:156-168](../../../../packages/hdmv/src/vm.ts#L156-L168)），`recoverMenuAction` 恢复的仍是 `suspended`，无法回到 `idle`。
- **附带的掩码错误**：`TOP_MENU` 用 `titleSearchMask` 判断，libbluray 用 `menu_call_mask`。`POPUP_MENU` 多加了 `menuCallMask` 判断，而 libbluray 的弹出 UO 由页面/播放列表 UO24 控制。
- **修复**：把 `TOP_MENU` 从 VM 等待中移除，改为运行时的标题导航（选择 index 的 topMenu entry，必要时先挂起当前播放对象并遵循 `resumeIntention`）。掩码：主菜单用 `menuCallMask`；弹出菜单只保留页面 UO24。

### 5.2 P1

#### VM-04 `RESUME` 空栈 fault

- **位置**：[vm.ts:494-497](../../../../packages/hdmv/src/vm.ts#L494-L497)。
- **参考**：`_resume_object` 返回 -1，`_hdmv_step` 继续（[hdmv_vm.c:512-518](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L512-L518)）。
- **现象**：`executeButtonProgram([RESUME])` 在 IG 上下文返回 `faulted / HDMV_RESUME_WITHOUT_CALL`。语料 `tamako` page 1 button 0 第 68 条是 `RESUME`，分支条件为 GPR3553==1；当前语料的菜单初始化把 GPR3553 置 0，所以该恢复分支未被走到。
- **修复**：空上下文记录诊断并按参考继续/结束；若存在 `playing_object` 恢复位置，优先恢复播放。

#### VM-05 MovieObject `BREAK` 变终态

- **位置**：[vm.ts:460](../../../../packages/hdmv/src/vm.ts#L460)、[vm.ts:305](../../../../packages/hdmv/src/vm.ts#L305)、[vm.ts:392-395](../../../../packages/hdmv/src/vm.ts#L392-L395)。
- **参考**：`pc = 1 << 17` → 下一次循环判 `END`；对象结束，VM 仍可运行新对象（[hdmv_vm.c:1087](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1087)、[hdmv_vm.c:1424-1435](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1424-L1435)）。
- **现象**：语料 `kyoani-ova` 主菜单对象第 29 条 `BREAK`。当前 `runTurn` 会把它置为 `stopped`；随后 `selectTitle` 如果运行新对象会重新置 `running`，但任何没有紧跟标题选择的 `BREAK` 都会让按钮输入永久被拒。
- **修复**：`BREAK` 结束当前对象并回到可复用状态（`idle` + `END` trace），不要使用 `stopped`。`executeButtonProgram` 的局部 `terminated` 保持不变。

#### VM-06 IG 上下文 `CALL_OBJECT` 被拒绝且上下文错误

- **位置**：[vm.ts:669-678](../../../../packages/hdmv/src/vm.ts#L669-L678)、[vm.ts:485-493](../../../../packages/hdmv/src/vm.ts#L485-L493)。
- **参考**：`_call_object` 从 IG 调用时 `_suspend_object` 保存的是 `playing_object`，然后跳转（[hdmv_vm.c:472-510](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L472-L510)、[hdmv_vm.c:610-622](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L610-L622)）。
- **现象**：播放列表等待期间含 `CALL_OBJECT` 的按钮程序被整体拒绝（`isSafeIgProgramDuringPlaylistWait`）。即使放行，`callStack` 保存的是 MovieObject PC，`RESUME` 会回到 MovieObject 而不是恢复播放。
- **修复**：为 IG 程序建立独立执行上下文；`CALL_OBJECT` 保存 `playingContinuation` 并进入目标对象，`RESUME` 按参考恢复。

#### VM-07 PSR5/6/7/8 不随播放更新

- **位置**：[vm.ts:416-419](../../../../packages/hdmv/src/vm.ts#L416-L419)。
- **参考**：[bluray.c:367-368](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L367-L368)、[bluray.c:410-422](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L410-L422)。
- **现象**：
  - PSR6 不从播放状态写入；`selectTitle` 也不重置 PSR5。PSR5–8 只在 `RESUME` 时从备份恢复。
  - PSR7/8 只在 `PLAYITEM_CHANGED` / `TIME_UPDATED` / `MEDIA_SEEKED` 时写；运行时没有 `PLAYITEM_CHANGED`/`TIME_UPDATED` 生产者。
  - `MEDIA_SEEKED` 的 payload 是 `mediaTimeSeconds`（[linear-playback.ts:176](../../../../packages/runtime-web/src/linear-playback.ts#L176)），VM 读 `presentationTime`，所以即使 seek 也不会写 PSR8。
- **证据**：语料读取 PSR5 46 次、PSR6 16 次、PSR7 18 次、PSR8 16 次；`tamako` 的初始化对象把 PSR5–8 备份到 GPR4075/4076，`bang-dream-mygo-vol1` 的按钮读取 PSR7。
- **修复**：在 `PLAY_PLAYLIST` 动作被接受/开始时写 PSR6（playlist）和 PSR5=0xffff；在播放项/时间事件中写 PSR7/8（确认 45kHz 或 90kHz 单位）；让媒体桥发送 `PLAYITEM_CHANGED` / `TIME_UPDATED`，并统一 `MEDIA_SEEKED` payload 字段。

#### VM-08 单一 `status` 混合三种对象状态

- **位置**：[vm.ts:61-70](../../../../packages/hdmv/src/vm.ts#L61-L70)、[vm.ts:753-758](../../../../packages/hdmv/src/vm.ts#L753-L758)；衍生特判 S2–S8。
- **参考**：`object` / `playing_object` / `suspended_object` / `ig_object` 四个槽位。
- **影响**：VM-02、VM-06、VM-03 的根因；也是“有时能用、有时不能用”的来源。
- **修复**：重构为 `execution`（当前对象） + `playing`（播放位置） + `callFrame`（调用保存） + `igProgram`（按钮局部 PC）。`status` 只描述执行槽位，不再表示播放等待。

#### VM-09 无效跳转/目标一律 fault

- **位置**：GOTO [vm.ts:461](../../../../packages/hdmv/src/vm.ts#L461) 与 `runTurn` 的越界判定 [vm.ts:311-318](../../../../packages/hdmv/src/vm.ts#L311-L318)；目标校验 [vm.ts:749-752](../../../../packages/hdmv/src/vm.ts#L749-L752)；标题校验 [vm.ts:730-742](../../../../packages/hdmv/src/vm.ts#L730-L742)。
- **参考**：`_jump_object` / `_call_object` / `_jump_title` / `_call_title` 在目标无效时返回 -1，`_hdmv_step` 继续执行；`GOTO` 越界是正常 `END`。
- **现象**：计算出的对象 ID/标题号越界时，当前 fault 并触发 `recoverMenuAction`；libbluray 会继续。对依赖“失败后继续下一句”的盘，按钮会表现为“什么都不做”。
- **修复**：区分“不可恢复的编码错误”和“运行时目标无效”；后者按参考记录诊断并继续/结束。

#### VM-10 `HDMV_UNVERIFIED_OPCODE` 的 `idle` + PC 回退

- **位置**：[vm.ts:329](../../../../packages/hdmv/src/vm.ts#L329)、[vm.ts:766-771](../../../../packages/hdmv/src/vm.ts#L766-L771)。
- **问题**：把“未实现/不支持”与“fatal”混在同一个 `fail` 路径；`runTurn` 还把 PC 回退到失败指令，下一次 `runTurn` 会重复失败。`CALL_TITLE` / `selectTitle` 的 BD-J/缺失表路径也走这个状态。
- **修复**：增加明确的 `unsupported` 结果：记录诊断、按需要跳过该指令或保持等待，不要伪装成 `idle`。

### 5.3 P2

| ID | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| VM-11 | 解码器把保留位/多余操作数/非法寄存器编码判为 fatal；libbluray 忽略或继续 | [decode.ts:59-76](../../../../packages/hdmv/src/decode.ts#L59-L76) | 保留位与多余操作数降级为诊断；未知 opcode 继续按 spec 阻止路径 |
| VM-12 | `executeButtonCommand` 的 GOTO/比较会改 MovieObject PC，不是按钮局部 PC | [vm.ts:273-279](../../../../packages/hdmv/src/vm.ts#L273-L279)、[vm.ts:461-468](../../../../packages/hdmv/src/vm.ts#L461-L468) | 该 API 只用于单条控制转移命令，或在内部维护局部 PC；运行时优先使用 `executeButtonProgram` |
| VM-13 | `MEDIA_STARTED` 对 `ended` 等待记 `HDMV_EVENT_NOT_READY`，`playback.status` 停在 `requested` | [vm.ts:413-416](../../../../packages/hdmv/src/vm.ts#L413-L416) | 对 `PLAY_*` 的 started 回执更新 `playback.status`，不记“未就绪”诊断 |
| VM-14 | `resumeIntention` 被解析和存储但从未使用；主菜单无法恢复播放位置 | [vm.ts:96](../../../../packages/hdmv/src/vm.ts#L96) | 与 VM-03 一起实现 `suspend_pl` 语义 |
| VM-15 | `SET_STREAM_SS` 用 `HDMV_UNVERIFIED_OPCODE` 作为诊断码 | [vm.ts:619-623](../../../../packages/hdmv/src/vm.ts#L619-L623)、[vm.ts:701-705](../../../../packages/hdmv/src/vm.ts#L701-L705) | 用专用非错误码（如 `HDMV_3D_SUBTITLE_ALIGNMENT_UNIMPLEMENTED`） |
| VM-16 | PSR16–20 默认值与 libbluray 不同（eng/US/A vs 全 1/B） | [registers.ts:45-49](../../../../packages/hdmv/src/registers.ts#L45-L49)、[defaults.ts](../../../../packages/core/src/defaults.ts) | 产品选择；在支持矩阵中保持“产品默认值”说明 |
| VM-17 | RND 默认种子 1，libbluray release 用 `time(NULL)` | [vm.ts:89](../../../../packages/hdmv/src/vm.ts#L89)、[vm.ts:812-816](../../../../packages/hdmv/src/vm.ts#L812-L816) | 产品选择；在 trace 中保留种子（已实现） |
| VM-18 | 每轮指令上限 10,000，libbluray 1,000,000 | [limits.ts](../../../../packages/core/src/limits.ts) | 确认菜单语料的最长循环；必要时提高默认值或按盘覆盖 |
| VM-19 | 运行时未处理 `LINK_PLAY_ITEM` / `LINK_PLAY_MARK` / `STILL_*` / `MENU_RETURN` | [index.ts:711-724](../../../../packages/runtime-web/src/index.ts#L711-L724)、[browser.ts:317-321](../../../../packages/runtime-web/src/browser.ts#L317-L321) | 明确标为不支持，或实现 seek/still/return；不要让动作静默消失 |
| VM-20 | `diagnostics` / `trace` / `actions` 只增不减；`recoverMenuAction` 不回滚诊断与动作历史 | [vm.ts:169-186](../../../../packages/hdmv/src/vm.ts#L169-L186)、[vm.ts:772-776](../../../../packages/hdmv/src/vm.ts#L772-L776) | 长会话内存与报告污染；按检查点记录诊断边界 |
| VM-21 | 解码保留位掩码多包含 bit 11 | [decode.ts:59](../../../../packages/hdmv/src/decode.ts#L59) | 改为 `0x0030f0e0`，并按 group 细化保留位 |
| VM-22 | `maxCallDepth` 名称暗示多帧深度，实际只允许一帧 | [vm.ts:487](../../../../packages/hdmv/src/vm.ts#L487)、[vm.ts:525](../../../../packages/hdmv/src/vm.ts#L525) | 文档已说明；可改名为 `callObjectEnabled` 或真正实现深度限制 |
| VM-23 | `SETSYSTEM_0x10` 强制 2 个操作数；`SET_STREAM_SS` 3D 只记诊断。`SET_NV_TIMER` 到期未实现与参考一致 | 见 3.7 | 保留现状；在支持矩阵中保持“未验证”标记 |
| VM-24 | 公开类型 `ButtonCommandContext` 从 `movie-object`/`ig-button` 改为 `object`/`ig_object` | [vm.ts:32](../../../../packages/hdmv/src/vm.ts#L32) | 未提交的破坏性 API 变更；发布前统一 `runtime-web/dist` 类型并记录迁移 |

### 5.4 已验证一致的部分

- 12 字节指令字段布局与 `mobj_parse_cmd` 一致（除保留位掩码）。
- 比较指令的 skip-next 语义与 libbluray 一致。
- ADD/MUL 饱和、SUB 下溢归零、DIV/MOD 除零 `0xffffffff`、AND/OR/XOR、RND LCG 一致。
- `SET_STREAM` / `SET_SEC_STREAM` 的位域和双 GPR 编码解析一致。
- `SET_BUTTON_PAGE` 的 MovieObject PSR10/11 写法和 IG 打包格式一致。
- `SET_OUTPUT_MODE` 的 profile 检查和 PSR22 bit0 更新一致。
- `SETSYSTEM_0x10` 的 PSR103 写入一致。
- PSR 默认值、只读集合、备份寄存器保存/恢复范围一致。
- 标题号 0 / 0xffff / 1..N 的边界和 `CALL` 单帧替换语义一致。
- `PLAY_PL` 的 MovieObject 挂起/恢复位置一致。

## 6. 复现记录

以下脚本在 `packages/hdmv` 下用 `tsx` 运行，导入 `./src/index.js`，不修改仓库文件。

### 6.1 `JUMP_TITLE` 双动作（真实盘）

输入：`battle-royale-uhd` clip `00002` page 10 button 0 的三条命令字节：

```text
484007000000000500000002   LT GPR[5], #2
218100000000000000000000   JUMP_TITLE #0
210100000000000500000000   JUMP_TITLE GPR[5]
```

复现输出（GPR5=1，LT 条件成立，执行 `JUMP_TITLE #0`）：

```text
actions: [ 'TITLE_SEARCH:{"title":0}', 'TITLE_SEARCH:{"title":1}' ]
trace:
  0:LT gpr[5],#2 status=running
  1:JUMP_TITLE #0 status=running => TITLE_SEARCH
  2:JUMP_TITLE gpr[5] status=running => TITLE_SEARCH
```

参考行为：第一条 `JUMP_TITLE #0` 后 `_vm_run` 返回 `HDMV_EVENT_TITLE(0)`，第二条不会执行。

### 6.2 `TOP_MENU` 永久挂起

```text
after PLAY_PL: suspended PLAY_PLAYLIST
TOP_MENU while suspended: suspended, trace=HDMV_INPUT_WHILE_SUSPENDED, actions=0
after release: idle
TOP_MENU while idle: suspended, waiting=TOP_MENU, actions=['TOP_MENU:started']
next button: suspended
```

### 6.3 三种用户事件在播放等待期间均被拒绝

```text
POPUP_MENU -> suspended actions: 0 trace: HDMV_INPUT_WHILE_SUSPENDED
TOP_MENU   -> suspended actions: 0 trace: HDMV_INPUT_WHILE_SUSPENDED
RETURN     -> suspended actions: 0 trace: HDMV_INPUT_WHILE_SUSPENDED
```

### 6.4 `RESUME` / `BREAK` / `GOTO`

```text
RESUME in IG: { status: 'faulted', fault: 'HDMV_RESUME_WITHOUT_CALL', terminated: false }
BREAK in IG:  { status: 'running', terminated: true }
GOTO 5:       faulted HDMV_INVALID_PC
```

注意 `BREAK` 在 IG 路径是局部结束，在 MovieObject 路径是 `stopped`；两条路径不一致。

### 6.5 语料统计

MovieObject 全量扫描（7 张盘）：

```text
objects=56 instructions=5298
MOVE 1621, GOTO 1468, AND 455, GT 348, BITSET 348, BITCLR 348, SHR 235,
EQ 127, NOP 80, SET_STREAM 77, PLAY_PL 63, JUMP_TITLE 51, SHL 21, OR 21,
ADD 19, PLAY_PL_PM 4, NE 4, LE 2, JUMP_OBJECT 2, GE 1, LT 1, BREAK 1, CALL_TITLE 1
decode issues: 0
```

IG 按钮命令扫描（8 个 clip，550 个按钮）：

```text
commands=2472
MOVE 1144, GOTO 323, SET_BUTTON_PAGE 233, NOP 144, SET_STREAM 129,
JUMP_TITLE 127, EQ 98, AND 61, CALL_TITLE 32, GT 30, BITSET 30, BITCLR 30,
ADD 26, ENABLE_BUTTON 18, SHR 12, LT 11, GE 9, LE 7, POPUP_OFF 3, SUB 2, NE 2, RESUME 1
programs with JUMP_TITLE=116, multi-title=11, commands-after-last-title=20, title-then-control=11
decode issues: 0
```

多标题按钮全部位于 `battle-royale-uhd` clip `00002` page 10–20 button 0，命令形状为 `LT; JUMP_TITLE; JUMP_TITLE`。

### 6.6 最小复现代码

`JUMP_TITLE` 双动作不需要真实盘；三条命令的原始字节即可复现：

```ts
import { HdmvVm } from "./src/index.js";
const commands = [
  "484007000000000500000002", // LT GPR[5], #2
  "218100000000000000000000", // JUMP_TITLE #0
  "210100000000000500000000", // JUMP_TITLE GPR[5]
];
const vm = new HdmvVm([{ id: 0, instructions: [] }]);
vm.registers.gpr[5] = 1;
const result = vm.executeButtonProgram(commands, "ig_object");
console.log(result.actions.map((a) => `${a.type}:${JSON.stringify(a.payload)}`));
// [ 'TITLE_SEARCH:{"title":0}', 'TITLE_SEARCH:{"title":1}' ]
```

`TOP_MENU` 等待：

```ts
import { HdmvVm, m3Fixtures } from "./src/index.js";
const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.playPlaylist42] }]);
vm.runTurn();                                   // suspended, waiting PLAY_PLAYLIST
vm.handleEvent({ type: "TOP_MENU", channel: "keyboard" });
// records HDMV_INPUT_WHILE_SUSPENDED, no action
```

PSR 读取次数（MovieObject + IG）：

```text
PSR0 16, PSR1 42, PSR2 73, PSR3 16, PSR4 25, PSR5 46, PSR6 16,
PSR7 18, PSR8 16, PSR10 66, PSR11 42, PSR14 48, PSR16 2, PSR36 1, PSR39 1
```

## 7. 测试与验证缺口

以下缺口是审计时的状态；第 9 节列出已补的回归。

1. **`JUMP_TITLE` 没有“事件后必须停止”的断言。** `control-flow.test.ts` 只断言 `JUMP_TITLE` 发出动作、`selectTitle` 能选中目标，并期望后续 `BREAK` 执行（`pc=2`），没有断言后续指令不执行。需要新增真实盘按钮回归：`battle-royale-uhd` 的三条命令 + GPR5=1，断言 `actions.length === 1`。
2. **用户事件只在 `idle` 状态测试。** `index.test.ts` 的 `POPUP_MENU` / `TOP_MENU` 用例都在 `idle` 下构造，没有覆盖“`PLAY_PLAYLIST` 等待中按菜单键”。需要新增 VM 用例和浏览器用例。
3. **没有 `TOP_MENU` 的运行时消费测试。** 现有浏览器测试只验证 `POPUP_MENU` 打开弹出场景，没有验证主菜单键。
4. **没有 PSR5–8 的播放态断言。** 需要断言 `PLAY_PLAYLIST` 后 PSR6、`PLAYITEM_CHANGED` 后 PSR7、`TIME_UPDATED` 后 PSR8，以及 `MEDIA_SEEKED` 字段映射。
5. **语料 DFS 不执行 IG 按钮。** `hdmv-navigation-corpus-dfs.test.ts` 用 `buildNavigationGraph(disc.movieObjects, [], ...)`，只探索 MovieObject 图；真实按钮程序只有 `tamako-headless-navigation` 一个用例。需要把 8 个 IGS fixture 的按钮程序纳入回归，或至少加入 `battle-royale-uhd` 的多标题按钮。
6. **参考 golden 是源码推导的。** `reference-golden.test.ts` 的期望来自 libbluray 源码阅读，不是播放器 trace；这与 [hdmv-support.md](../../../support/hdmv-support.md) 的说明一致。本文的结论同样属于源码对照，需要后续用播放器 trace 或独立实现验证。
7. **缺少错误路径测试。** 没有覆盖 `RESUME` 空栈、`GOTO` 越界、无效对象/标题、`BREAK`、IG `CALL_OBJECT`。

## 8. 修复顺序（已按此顺序落地）

### 阶段 A：恢复菜单基本可用（对应 P0）

1. **重构对象槽位**（VM-08）：把 `playing` 从 `status` 拆出；`status` 只在执行对象时使用。`executeButtonProgram` 在 `playing` 存在时直接执行，不再依赖 `isSafeIgProgramDuringPlaylistWait`。
2. **`JUMP_TITLE` 终止执行**（VM-01）：发 `TITLE_SEARCH` 后设置标题切换状态并 break；`selectTitle` 继续。把 `graph.ts` 的 `terminatesFlow` 行为与 VM 对齐（目前 graph 已把 JUMP_TITLE 当终止）。
3. **用户输入**（VM-02/03）：移除 `status === "suspended"` 的一刀切拒绝；`TOP_MENU` 改为运行时标题导航（topMenu entry），`POPUP_MENU` 只检查页面 UO24；`TOP_MENU` 掩码改为 `menuCallMask`。
4. **`beginMenuAction` 检查点**：只在可恢复的执行状态保存；避免用 `suspended` 覆盖 `idle` 检查点。

### 阶段 B：恢复标准控制流错误处理（对应 P1）

5. `RESUME` 空栈 → 诊断 + 继续/恢复播放（VM-04）。
6. `BREAK` → 对象结束（VM-05），统一 MovieObject / IG 路径。
7. IG `CALL_OBJECT` → 独立 IG 上下文 + `playing` 保存（VM-06）。
8. 无效对象/标题/GOTO 的目标 → 按参考记录并继续（VM-09）；未知 opcode 保持 spec 要求的阻止路径。
9. PSR5–8 与媒体事件（VM-07）：先写 PSR6/5，再补 PSR7/8 和事件生产者；确认时间单位。

### 阶段 C：清理与加固（对应 P2）

10. 解码器保留位/操作数个数降级（VM-11、VM-21）。
11. `SET_STREAM_SS` 诊断码（VM-15）。
12. 运行时对 `LINK_*` / `STILL_*` / `MENU_RETURN` 的显式处理或“不支持”报告（VM-19）。
13. 文档：本次已修正 [hdmv-support.md](../../../support/hdmv-support.md) 中 `JUMP_TITLE` 和 RND 的表述；继续补充 `TOP_MENU` 行为、`maxCallDepth` 说明和本文的 P0/P1 跟踪表。

## 9. 修复记录（2026-11-06）

修复以 libbluray 1.5.0 的对象槽位和事件边界为准。第 0–8 节保留审计现场；本节的“修复后行为”是当前实现。

### 9.1 代码变更

- [decode.ts](../../../../packages/hdmv/src/decode.ts)：保留位掩码改为 `0x0030f0e0`；保留位、多余操作数、非法寄存器编码和非法目标降级为 `unverified` 诊断，只有无法解出 group/opcode 才返回 `invalid`。非法寄存器读返回 0，非法目标/PSR 写入被忽略并留诊断。
- [vm.ts](../../../../packages/hdmv/src/vm.ts)：
  - `JUMP_TITLE` 发出 `TITLE_SEARCH` 后进入 `suspended`/`titleTransition`，不再执行下一条；`selectTitle()` 释放切换并继续。没有标题表时仍会停止，`selectTitle()` 报告 `HDMV_UNVERIFIED_OPCODE` 并保持菜单可用。
  - `TOP_MENU` 改为播放器级标题请求：检查 `menuCallMask`，按 `resumeIntention` 暂存播放位置，发出 `TITLE_SEARCH title=0`，不建立 `MEDIA_STARTED` 等待。
  - `POPUP_MENU` 只发 `MENU_CALL` 动作，不再挂起 VM，也不再用 MovieObject 的 `menuCallMask` 二次拦截；页面/播放列表 UO24 由 runtime 检查。
  - 播放列表等待不再阻止用户事件或 IG 按钮程序；`executeButtonProgram` 在等待期间保留播放 continuation，程序结束后恢复 `suspended`。
  - `BREAK` 将 PC 设为程序末尾，对象以下一次 `PROGRAM_END` 结束，VM 保持可复用；IG 路径继续局部终止。
  - `RESUME` 无保存上下文时记录 `HDMV_RESUME_WITHOUT_CALL` 并继续；有暂存播放时重新发出播放动作并从保存的 PC 恢复。
  - IG `CALL_OBJECT` 允许执行：暂存播放位置、发出 `PLAY_STOP`、保存调用帧并进入目标；`RESUME` 重新发出播放动作。
  - 无效对象/标题目标改为非致命诊断并继续；`GOTO` 到程序末尾等同对象结束。
  - `PLAY_PLAYLIST`/`PLAY_PLAYLIST_ITEM`/`PLAY_PLAYLIST_MARK` 写 PSR5=0xffff、PSR6、PSR7 和 PSR8=0；`PLAYITEM_CHANGED` 写 PSR7，`TIME_UPDATED`/`MEDIA_SEEKED` 接受 `presentationTime`（45 kHz）或 `mediaTimeSeconds` 并写 PSR8。
  - `MEDIA_STARTED` 对 `PLAY_*` 等待只更新 `playback.status=playing`，不消费等待，也不记 `HDMV_EVENT_NOT_READY`。
  - `SET_STREAM_SS` 3D 路径使用 `HDMV_3D_SUBTITLE_ALIGNMENT_UNIMPLEMENTED`；`executeButtonCommand` 不再让 GOTO/compare 改 MovieObject PC；`recoverMenuAction` 截断失败动作产生的诊断。
- [runtime-web/index.ts](../../../../packages/runtime-web/src/index.ts)：`MENU_CALL` 不再要求 VM 回执；菜单循环媒体增加 1 Hz `TIME_UPDATED`；`LINK_*`/`STILL_*`/`MENU_RETURN` 给出明确“不支持”报告；`MEDIA_SEEKED` 增加 45 kHz `presentationTime`。
- [runtime-web/browser.ts](../../../../packages/runtime-web/src/browser.ts)：`TITLE_SEARCH` 不再依赖 `data.vmEntries`；没有标题表时由 `selectTitle()` 报告并恢复，不静默丢弃动作。
- [linear-playback.ts](../../../../packages/runtime-web/src/linear-playback.ts)：`MEDIA_SEEKED` 同时携带秒和 45 kHz 时间。

### 9.2 逐项状态

| ID | 状态 | 修复后行为 / 证据 |
| --- | --- | --- |
| VM-01 | 已修复 | `JUMP_TITLE` 后只产生 1 个 `TITLE_SEARCH`；`control-flow.test.ts` 的三命令回归；真实 `battle-royale-uhd` page 10 button 0 复现为 1 个动作 |
| VM-02 | 已修复 | 播放等待期间 `POPUP_MENU`/`TOP_MENU` 和按钮程序可用；`index.test.ts` 的 popup/top/button 用例 |
| VM-03 | 已修复 | `TOP_MENU` 发出 `TITLE_SEARCH title=0`，不进入 `MEDIA_STARTED` 等待；掩码改为 `menuCallMask`；浏览器 `TITLE_SEARCH` 路径 |
| VM-04 | 已修复 | `RESUME` 空上下文记录诊断并继续；`control-flow.test.ts`/`index.test.ts` |
| VM-05 | 已修复 | `BREAK` 后 `idle`，VM 仍可执行按钮程序；`control-flow.test.ts` |
| VM-06 | 已修复 | IG `CALL_OBJECT` 暂存播放、发 `PLAY_STOP`、`RESUME` 重发播放；`index.test.ts` |
| VM-07 | 已修复 | PSR5–8 播放更新、`MEDIA_SEEKED` 单位映射；`index.test.ts` 与 runtime PSR1/时间回归 |
| VM-08 | 部分修复 | 播放 wait 与输入/IG 执行已分离（`inputBlocked`、`continuation`、暂存播放）；`status` 仍复用 `suspended` |
| VM-09 | 已修复 | 无效对象/标题非致命；`GOTO` 越界结束对象；`index.test.ts`/`control-flow.test.ts` |
| VM-10 | 已修复 | 去掉 PC 回退；BD-J/缺表用 `unsupportedOperation` 明确结束当前 run；未知编码仍按 spec 阻止 |
| VM-11/21 | 已修复 | 保留位/操作数/寄存器编码降级为诊断；掩码修正；`decode.ts` |
| VM-12 | 已修复 | 单条按钮 API 拒绝 GOTO/compare，BREAK 局部终止；`index.test.ts` |
| VM-13 | 已修复 | `MEDIA_STARTED` 更新 `playback.status`，不再记 `HDMV_EVENT_NOT_READY` |
| VM-14 | 已修复 | `TOP_MENU` 按 `resumeIntention` 暂存播放位置，`RESUME` 重发 |
| VM-15 | 已修复 | 3D 字幕对齐诊断码改为 `HDMV_3D_SUBTITLE_ALIGNMENT_UNIMPLEMENTED` |
| VM-16/17 | 保留（产品差异） | PSR16–20 产品默认值、RND 固定种子；支持矩阵保留说明 |
| VM-18 | 保留（可配置） | 每轮 10,000 条可通过 `--limits`/`VmOptions.limits` 调整 |
| VM-19 | 已修复 | runtime 对 `LINK_*`/`STILL_*`/`MENU_RETURN` 明确报告不支持 |
| VM-20 | 部分修复 | `recoverMenuAction` 截断失败动作诊断；`trace`/`actions` 仍为会话历史 |
| VM-22 | 保留（文档） | `maxCallDepth` 仍是 CALL 开关；支持矩阵已说明 |
| VM-23 | 保留（未验证） | `SETSYSTEM_0x10` 操作数个数未在参考中约束；解码警告允许 1 个操作数执行 |
| VM-24 | 已处理 | 全 workspace 重新构建；`ButtonCommandContext` 使用 `object`/`ig_object` |

### 9.3 修复后验证

- `corepack pnpm build`：通过。
- `corepack pnpm -r typecheck`：通过。
- `corepack pnpm -r --no-bail test`：全部包通过；hdmv 88、igs 56、runtime-web 104、package-builder 11、media-export 55、cli 36。
- 新增回归：`JUMP_TITLE` 单动作、播放等待期间 TOP/POPUP/按钮、IG `CALL_OBJECT`、PSR5–8、`BREAK`/`RESUME`/无效目标、解码容错。
- 未执行：浏览器手工验收、libbluray 运行时 trace 对照、真实外置播放器交接。

## 10. 参考定位表

| 主题 | libbluray | 当前实现 |
| --- | --- | --- |
| 指令字段解析 | [mobj_parse.c:52-72](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/mobj_parse.c#L52-L72) | [decode.ts:47-78](../../../../packages/hdmv/src/decode.ts#L47-L78) |
| 指令分派 | [hdmv_vm.c:1062-1227](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1062-L1227) | [vm.ts:454-627](../../../../packages/hdmv/src/vm.ts#L454-L627) |
| 执行循环 | [hdmv_vm.c:1399-1452](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1399-L1452) | [vm.ts:304-336](../../../../packages/hdmv/src/vm.ts#L304-L336) |
| 对象挂起/恢复 | [hdmv_vm.c:424-549](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L424-L549) | [vm.ts:485-537](../../../../packages/hdmv/src/vm.ts#L485-L537) |
| 标题/对象跳转 | [hdmv_vm.c:556-639](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L556-L639) | [vm.ts:482-537](../../../../packages/hdmv/src/vm.ts#L482-L537) |
| 播放列表控制 | [hdmv_vm.c:645-708](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L645-L708) | [vm.ts:538-548](../../../../packages/hdmv/src/vm.ts#L538-L548)、[vm.ts:679-700](../../../../packages/hdmv/src/vm.ts#L679-L700) |
| 流选择 | [hdmv_vm.c:714-831](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L714-L831) | [vm.ts:549-624](../../../../packages/hdmv/src/vm.ts#L549-L624) |
| 按钮/Still/Popup | [hdmv_vm.c:837-891](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L837-L891) | [vm.ts:607-612](../../../../packages/hdmv/src/vm.ts#L607-L612)、[vm.ts:647-656](../../../../packages/hdmv/src/vm.ts#L647-L656) |
| 3D / 输出模式 | [hdmv_vm.c:897-918](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L897-L918) | [vm.ts:613-623](../../../../packages/hdmv/src/vm.ts#L613-L623) |
| 导航定时器 | [hdmv_vm.c:924-982](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L924-L982) | [vm.ts:599-606](../../../../packages/hdmv/src/vm.ts#L599-L606) |
| 随机数 | [hdmv_vm.c:1032-1042](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1032-L1042) | [vm.ts:707-714](../../../../packages/hdmv/src/vm.ts#L707-L714) |
| PSR 默认/写保护 | [register.c:42-123](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/register.c#L42-L123)、[register.c:450-461](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/register.c#L450-L461) | [registers.ts:38-77](../../../../packages/hdmv/src/registers.ts#L38-L77) |
| PSR 备份 | [register.c:276-360](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/register.c#L276-L360) | [vm.ts:716-729](../../../../packages/hdmv/src/vm.ts#L716-L729) |
| UO mask | [hdmv_vm.c:1324-1342](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c#L1324-L1342)、[bluray.c:3662-3730](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L3662-L3730) | [vm.ts:425-453](../../../../packages/hdmv/src/vm.ts#L425-L453) |
| 播放 PSR | [bluray.c:367-368](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L367-L368)、[bluray.c:410-422](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L410-L422) | [vm.ts:416-419](../../../../packages/hdmv/src/vm.ts#L416-L419) |
| 事件处理 | [bluray.c:3735-3815](../../../../.reference-cache/libbluray-1.5.0/src/libbluray/bluray.c#L3735-L3815) | [vm.ts:391-424](../../../../packages/hdmv/src/vm.ts#L391-L424) |

## 11. 局限

- 本文没有运行 libbluray；所有“参考行为”来自固定版本源码阅读。
- 没有在浏览器中手工验证主菜单键/弹出菜单键；运行时结论来自 `browser.ts`、`index.ts` 的调用路径和 VM 层复现。
- 语料只覆盖 7 张盘/8 个 clip；其他盘的编码严格性、PSR 使用和 UO 组合可能不同。
- `libhdmv` 的结论只用于说明它不能作为 golden，未逐函数与其做完整差异枚举。
