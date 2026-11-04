# Spec Delta

## Purpose

让默认预算与来源位置各自只有一个来源：`core` 定义、下游引用；交付层不得用占位值代替真实 `SourceRef`。

## MODIFIED Requirements

### Requirement: 安全读取与诊断

系统 SHALL 在读取/分配前检查长度、偏移、计数乘积及 Limits；默认 Limits 只有 `core` 一个导出源，任何消费方必须引用或派生该值，不得自建同名常量；失败保留源相对路径、无损偏移和稳定错误码。

#### Scenario: 截断与超大声明

- **WHEN** Cursor 读取越界或 count×size 溢出
- **THEN** 在读取/分配前安全终止，不补零，不修改失败操作前游标，并报告 expected/actual

#### Scenario: 子窗口来源

- **WHEN** 从文件偏移100的窗口创建长度8的 subview，再在子窗口偏移2读取
- **THEN** 父游标成功推进8，子游标从0起，诊断源偏移可还原为102

#### Scenario: 默认预算无第二份

- **WHEN** 在仓库内检索 `maxCallDepth` / `maxQueueDepth` 的默认值定义
- **THEN** 只有 `core` 的 `DEFAULT_LIMITS` 一处定义；VM 等消费方以引用或派生方式取得，数值与 `DEFAULT_LIMITS` 一致

#### Scenario: 消费方接收 Limits

- **WHEN** 调用方传入自定义 `Limits` 给虚拟机
- **THEN** 预算按该对象生效；若同时传入等价的零散预算字段，以 `Limits` 为准并记录一条可观察的诊断，不静默择一

### Requirement: 版本化数据与精确时间

系统 SHALL 为 DiscIR、资产、来源、诊断和事件提供版本化可校验契约；90k 时间使用规范十进制字符串持久化并显式还原 bigint；`SourceRef` 的 `path` 一律为相对 BDMV 根的 POSIX 路径，任何交付产物不得用占位路径或占位偏移代替真实来源。

#### Scenario: 大数往返

- **WHEN** 序列化并重新装载 time90k="9007199254740993"
- **THEN** 值逐位不变；原始单位和来源仍可追踪

#### Scenario: 拒绝非法时间或版本

- **WHEN** 装载负数、小数、指数时间或未知 schemaVersion
- **THEN** 在进入 VM/渲染前拒绝并报告对应字段，不做浮点取整或猜测兼容

#### Scenario: 实体引用失效

- **WHEN** 通过 JSON 语法校验的 IR 含重复全局 ID 或悬空必需引用
- **THEN** 引用校验仍失败，并定位实体和字段

#### Scenario: 来源不得为占位值

- **WHEN** 生成交付 IR、指令 trace 或 IGS 结构诊断
- **THEN** 每条来源都含真实的相对 BDMV 根路径、origin 与文件字节偏移；无位置时明确为空，不写 `source/structural`、`<MovieObject>` 一类占位串

#### Scenario: 旧占位来源被拒绝

- **WHEN** 装载含占位来源路径的历史 IR
- **THEN** 校验以 `SCHEMA_SOURCE_PLACEHOLDER` 拒绝并指出字段，要求重新提取，而不是静默接受后当作可追溯
