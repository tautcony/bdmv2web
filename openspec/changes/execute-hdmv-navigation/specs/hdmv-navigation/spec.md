# Spec Delta

## Purpose

为离线 BDMV 转换和浏览器运行提供可验证的执行 HDMV 导航语义能力，明确输入、输出、错误及对下游的可观察行为。

## ADDED Requirements

### Requirement: 命令解码与支持覆盖

系统 SHALL 解码 12 字节 HDMV 指令并保留原始字节、操作数和来源，对未知或非法指令提供诊断。

#### Scenario: 遇到未知操作码

- **WHEN** 遇到未知操作码
- **THEN** 输出来源与操作码，并禁止把该可达路径判为完整

### Requirement: 寄存器与控制流

系统 SHALL 按已验证的 HDMV 语义维护 GPR、PSR、条件执行、对象跳转及 Call/Resume 状态。

#### Scenario: 比较指令控制下一条指令并执行对象调用后恢复

- **WHEN** 比较指令控制下一条指令并执行对象调用后恢复
- **THEN** 寄存器、程序计数器和调用栈与参考轨迹一致

### Requirement: 异步动作与执行边界

系统 SHALL 发出媒体及菜单动作、接收事件恢复执行，并限制指令和事件预算。

#### Scenario: 循环程序超出预算

- **WHEN** 循环程序超出预算
- **THEN** 终止该执行并报告 VM_EXECUTION_LIMIT 与 trace
