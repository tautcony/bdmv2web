# hdmv-navigation Specification

## Purpose

执行可追踪、可挂起且有界的 HDMV 导航语义：每条指令产生可回读的来源与状态变化，等待中的播放或用户交互不阻塞虚拟机，异常与预算耗尽在有限步内终止并保留诊断。

## Requirements

### Requirement: 命令解码与支持覆盖

系统 SHALL 统一解码 MOBJ/按钮12字节指令，保留 raw/操作数/来源；supported 项必须有精确编码和语义证据。

#### Scenario: 未知操作码

- **WHEN** 可达程序含未知编码
- **THEN** 报告 HDMV_UNKNOWN_OPCODE、raw 和来源，阻止该路径完整，不转成静默 no-op

#### Scenario: 相同来源语义

- **WHEN** MOBJ 和按钮含相同指令记录
- **THEN** 同一解码/执行器产生相同指令语义，来源字段各自正确

#### Scenario: 非法操作数

- **WHEN** 编码引用越界寄存器或非法立即数/寄存器组合
- **THEN** 输出 HDMV_ILLEGAL_OPERAND 或 INVALID_REGISTER_ACCESS，不截断索引

### Requirement: 寄存器与控制流

系统 SHALL 按已核验矩阵维护32-bit GPR/PSR、初始化/权限、条件下一条执行及 Jump/Call/Resume 的各自上下文。

#### Scenario: 比较与恢复

- **WHEN** 执行 Compare 下一条控制及跨对象 Call/Resume golden 路径
- **THEN** 寄存器/PC/栈/播放上下文与独立参考一致，不把所有跳转统一push/pop

#### Scenario: 非法 PSR 写入

- **WHEN** 程序试图写只读 PSR
- **THEN** 拒绝程序写入并报告，系统事件更新仍走独立授权入口

#### Scenario: 固定 PlayerProfile

- **WHEN** 相同语言/地区/能力配置重置两次 VM
- **THEN** 初始化 PSR 和 trace 相同，默认值/字段映射可查证

### Requirement: 异步动作与执行边界

系统 SHALL 以相关动作/代次和显式等待条件挂起恢复；限制每轮指令、栈和队列预算。

#### Scenario: 媒体成功反馈

- **WHEN** VM 发播放动作后收到匹配 started/seeked/ended 中其规定等待事件
- **THEN** 动作发出前分配的新 generation 与等待记录一致；合法回信至多恢复一次并更新规定状态，媒体桥不得再次递增代次，不对所有动作统一等待 ended

#### Scenario: 旧或重复回信

- **WHEN** 旧 generation 或已消费 responseTo 再次到达
- **THEN** 忽略且 trace 记录原因，不改当前 PC/寄存器

#### Scenario: 循环超预算

- **WHEN** 同步跳转循环超 maxInstructionsPerTurn
- **THEN** 停止该执行，报告 VM_EXECUTION_LIMIT 与最后快照，不无限 yield 重试

### Requirement: 失败及用户操作反馈

系统 SHALL 处理媒体错误/unavailable/菜单输入的明确状态转换；UO mask 对所有用户输入通道一致生效。

#### Scenario: 预览媒体不可用

- **WHEN** 菜单桥回 unavailable
- **THEN** 结束对应等待并报告不可用，不永久 suspended、不伪造正常 MEDIA_ENDED

#### Scenario: 受限菜单键

- **WHEN** 当前 UO mask 禁止相应菜单操作
- **THEN** 键盘和指针操作均不触发被禁导航，必要系统反馈仍处理

### Requirement: 导航图与可复现 trace

系统 SHALL 输出带源条件的导航边及确定性 trace，未解析动态目标和探索超限保持 unknown。

#### Scenario: 动态目标未知

- **WHEN** 静态分析无法证明寄存器导航目标集合
- **THEN** 保留 unresolved 及来源，不把本轮未走路径当不可达

#### Scenario: 重放

- **WHEN** 以同一初始状态/profile/seed 和事件序列运行两次
- **THEN** 语义 trace 的指令、delta、动作和状态一致，墙钟不参与比较
