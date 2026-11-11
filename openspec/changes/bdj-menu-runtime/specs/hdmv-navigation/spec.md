# Spec Delta

## MODIFIED Requirements

### Requirement: 异步动作与执行边界

系统 SHALL 以相关动作/代次和显式等待条件挂起恢复；限制每轮 HDMV 指令、调用栈和队列预算；BD-J 会话的标题请求 SHALL 先经过本地服务的 disc-level navigation router，共享寄存器 SHALL 由该会话维护。HDMV target 经 `selectTitle()` 进入 MovieObject；BD-J target 交给 本地 BD-J Java runtime。目标不可用时解除对应标题等待并记录诊断。

#### Scenario: 媒体成功反馈

- **WHEN** HDMV VM 发播放动作后收到匹配 started/seeked/ended 中其规定等待事件
- **THEN** 动作发出前分配的新 generation 与等待记录一致；合法回信至多恢复一次并更新规定状态，媒体桥不重复递增代次；各动作按其规定等待事件恢复

#### Scenario: HDMV 标题搜索

- **WHEN** HDMV VM 发出 `TITLE_SEARCH` 且 INDEX 目标为 HDMV
- **THEN** router 调用 `selectTitle()`，新 MovieObject 从 PC 0 开始，合法 `CALL_TITLE` continuation 按原语义恢复

#### Scenario: 旧或重复回信

- **WHEN** 旧 generation 或已消费 responseTo 再次到达
- **THEN** 忽略且 trace 记录原因，不改当前 PC/寄存器

#### Scenario: BD-J 标题搜索

- **WHEN** HDMV VM 发出 `TITLE_SEARCH` 且 INDEX 目标为 BD-J
- **THEN** router 将控制权和 title lifecycle 交给目标 BDJO 的 Java VM；`HdmvVm` 不把 BDJO file number 当作 MovieObject ID

#### Scenario: Java Xlet 请求 HDMV 标题

- **WHEN** Xlet 通过 `TitleContext.start()` 请求 INDEX 中的 HDMV title
- **THEN** router 将 title 请求交给 HDMV VM，保留共享寄存器和 action source，并向活动 Xlet 回报 title lifecycle

#### Scenario: 标题目标不可用

- **WHEN** router 无法解析目标 entry、BDJO、JAR、入口类或 Java host API
- **THEN** 结束当前标题等待、记录带 INDEX/BDJO/JAR 来源的诊断并恢复可用菜单输入，不永久 suspended、不伪造 `MEDIA_ENDED`

#### Scenario: 跨对象调用不可用

- **WHEN** HDMV 执行 `CALL_TITLE` 并发出 `TITLE_SEARCH` 后无法解析或启动 HDMV/BD-J 目标
- **THEN** 解除标题调用等待，保留不可用诊断并保持菜单可操作；HDMV target 通过 `selectTitle()`，BD-J target 通过 Java VM 处理

#### Scenario: 循环超预算

- **WHEN** 同步 HDMV 跳转循环超过 maxInstructionsPerTurn
- **THEN** 停止该执行，报告 `VM_EXECUTION_LIMIT` 与最后快照，不无限 yield 重试

#### Scenario: 无等待时的事件

- **WHEN** 桥收到与任何未完成 HDMV 等待都不匹配的事件
- **THEN** 不产生 HDMV 状态副作用，trace 记录丢弃原因

#### Scenario: 服务端共享寄存器

- **WHEN** Java 应用写入 GPR 后选择 HDMV title，随后返回 BD-J
- **THEN** 两个后端读取同一会话的寄存器状态，title 和 PSR4 保持一致，页面重连不重置该状态
