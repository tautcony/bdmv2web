# Spec Delta

## MODIFIED Requirements

### Requirement: 导航图与可复现 trace

系统 SHALL 输出带源条件的导航边及确定性 trace，未解析动态目标和探索超限保持 unknown；RND 使用固定的项目 seed 状态执行。

#### Scenario: 动态目标未知

- **WHEN** 静态分析无法证明寄存器导航目标集合
- **THEN** 保留 unresolved 及来源，不把本轮未走路径当不可达

#### Scenario: 重放

- **WHEN** 以同一初始状态/profile/seed 和事件序列运行两次
- **THEN** 语义 trace 的指令、delta、动作和状态一致，墙钟不参与比较

#### Scenario: 随机数指令范围

- **WHEN** HDMV 程序用正整数上界执行 RND
- **THEN** VM 按固定参考算法推进随机状态，并将目标 GPR 写为 1 至上界（含上界）的值

#### Scenario: 随机数指令零上界

- **WHEN** RND 的上界解析为零
- **THEN** VM 按固定参考行为将目标 GPR 写为 1，记录零上界诊断并继续执行

#### Scenario: 带固定种子的随机导航

- **WHEN** 相同 VM 初始状态、随机 seed 和输入事件重放含 RND 的路径
- **THEN** 输出相同随机值、导航动作和语义 trace；不同 seed 可产生不同合法随机序列
