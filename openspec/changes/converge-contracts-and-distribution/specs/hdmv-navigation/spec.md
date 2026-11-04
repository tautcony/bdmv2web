# Spec Delta

## Purpose

修正导航图与虚拟机的上下文判定：`JUMP_TITLE` 有后继、`LINK`/`TERMINATE` 按上下文生效、`CALL_TITLE` 有可关联的等待与回执，被忽略的指令必须留痕。

## MODIFIED Requirements

### Requirement: 异步动作与执行边界

系统 SHALL 以相关动作/代次和显式等待条件挂起恢复；限制每轮指令、栈和队列预算；跨对象调用（`CALL_TITLE`）必须建立可被回执解除的等待，不得进入无法恢复的挂起状态。

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

- **WHEN** 程序执行 `CALL_TITLE` 后目标 title 无法启动，桥回不可用
- **THEN** 该回执按 responseTo 关联并解除等待，VM 报告不可用并继续可执行路径，不永久 suspended

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
- **THEN** 图中该节点同时存在跳转边与指向目标标题首个程序的顺序边，目标标题因该边可达

#### Scenario: 上下文决定是否终止

- **WHEN** MovieObject 上下文出现 `LINK_PI` / `LINK_MK` / `TERMINATE_PL`
- **THEN** 该流不因这些指令被判定为终止；同一指令出现在 playlist 上下文时才作为终止符处理

#### Scenario: 被忽略的指令留痕

- **WHEN** 指令因上下文不适用而被跳过
- **THEN** trace 记录 `HDMV_OPCODE_CONTEXT_SKIPPED`（含 opcode 与上下文），执行继续，不出现无诊断的静默返回
