# Spec Delta

## Purpose

定义导航图与虚拟机的上下文判定、标题调用恢复和指令诊断。

## MODIFIED Requirements

### Requirement: 异步动作与执行边界

系统 SHALL 以相关动作/代次和显式等待条件挂起恢复；限制每轮指令、栈和队列预算；标题调用（`CALL_TITLE`）通过 `TITLE_SEARCH` 与 `selectTitle()` 恢复，目标不可用时解除等待并记录诊断。

#### Scenario: 媒体成功反馈

- **WHEN** VM 发播放动作后收到匹配 started/seeked/ended 中其规定等待事件
- **THEN** 动作发出前分配的新 generation 与等待记录一致；合法回信至多恢复一次并更新规定状态，媒体桥不得再次递增代次，不对所有动作统一等待 ended

#### Scenario: 旧或重复回信

- **WHEN** 旧 generation 或已消费 responseTo 再次到达
- **THEN** 忽略且 trace 记录原因，不改当前 PC/寄存器

#### Scenario: 循环超预算

- **WHEN** 同步跳转循环超 maxInstructionsPerTurn
- **THEN** 停止该执行，报告 VM_EXECUTION_LIMIT 与最后快照，不无限 yield 重试

#### Scenario: 跨对象调用不可用

- **WHEN** 程序执行 `CALL_TITLE` 并发出 `TITLE_SEARCH` 后，runtime 的 `selectTitle()` 无法解析或启动目标
- **THEN** VM 解除标题调用等待，保留不可用诊断并保持菜单可操作，不永久 suspended；实现使用当前 `TITLE_SEARCH → selectTitle()` 路径

#### Scenario: 无等待时的事件

- **WHEN** 桥收到与任何未完成等待都不匹配的事件
- **THEN** 不产生 VM 状态副作用，trace 记录丢弃原因

### Requirement: 导航图与可复现 trace

系统 SHALL 输出带源条件的导航边及确定性 trace，未解析动态目标和探索超限保持 unknown；边的存在与否必须按执行上下文判定，被上下文忽略的指令必须留诊断。

#### Scenario: 动态目标未知

- **WHEN** 静态分析无法证明寄存器导航目标集合
- **THEN** 保留 unresolved 及来源，不把本轮未走路径当不可达

#### Scenario: 重放

- **WHEN** 以同一初始状态/profile/seed 和事件序列运行两次
- **THEN** 语义 trace 的指令、delta、动作和状态一致，墙钟不参与比较

#### Scenario: 标题跳转有后继

- **WHEN** MovieObject 中的 `JUMP_TITLE` 指向另一个标题
- **THEN** 图中该节点同时存在跳转边与指向目标标题首个程序的顺序边，顺序边带已声明的 `origin` 属性（取值 `jump-title`）以区别于静态 `jump` 边，目标标题因该边可达；原位置的下一条指令不因该跳转成为可达

#### Scenario: 上下文决定是否终止

- **WHEN** MovieObject 上下文出现 `LINK_PI` / `LINK_MK` / `TERMINATE_PL`
- **THEN** 该流不因这些指令被判定为终止；同一指令出现在 playlist 上下文时才作为终止符处理

#### Scenario: 被忽略的指令留痕

- **WHEN** 指令因上下文不适用而被跳过
- **THEN** trace 记录 `HDMV_OPCODE_CONTEXT_SKIPPED`（含 opcode 与上下文），执行继续，不出现无诊断的静默返回

#### Scenario: 播放等待期间执行 IG button 跳转

- **WHEN** MovieObject 正等待 `PLAY_PL`、`PLAY_PL_PI` 或 `PLAY_PL_PM` 完成，IG button program 执行 `JUMP_OBJECT`
- **THEN** 按 libbluray 对象语义结束当前 playlist 等待、发出 `PLAY_STOP`、进入目标 MovieObject；旧媒体回执不得恢复已结束的等待
