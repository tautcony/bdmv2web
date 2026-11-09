# disc-contracts Specification

## Purpose

建立跨包共享的版本化契约、精确的 90k 时间表示、安全 I/O 与可复现开发基础，使解析、执行、打包与校验对同一输入得到一致结果，契约变更可被检出而非静默漂移。

## Requirements

### Requirement: 可重复工作区与平台边界

系统 SHALL 提供固定工具链、lockfile 和 build/typecheck/test 入口；共享 core 不依赖 Node 或 DOM，未接入 CLI 功能明确报未实现。

#### Scenario: 干净构建

- **WHEN** 从干净 checkout 按记录的 Node/pnpm 版本安装并运行根脚本
- **THEN** 构建和类型检查通过，测试可复现，浏览器 core 产物无 Node 内建依赖

#### Scenario: 调用未接入命令

- **WHEN** 调用尚未交付的 convert 功能
- **THEN** 返回明确未实现诊断及非零退出码，不生成空壳成功包

### Requirement: 版本化数据与精确时间

系统 SHALL 为 DiscIR、资产、来源、诊断和事件提供版本化可校验契约；90k 时间使用规范十进制字符串持久化并显式还原 bigint。

#### Scenario: 大数往返

- **WHEN** 序列化并重新装载 time90k="9007199254740993"
- **THEN** 值逐位不变；原始单位和来源仍可追踪

#### Scenario: 拒绝非法时间或版本

- **WHEN** 装载负数、小数、指数时间或未知 schemaVersion
- **THEN** 在进入 VM/渲染前拒绝并报告对应字段，不做浮点取整或猜测兼容

#### Scenario: 实体引用失效

- **WHEN** 通过 JSON 语法校验的 IR 含重复全局 ID 或悬空必需引用
- **THEN** 引用校验仍失败，并定位实体和字段

### Requirement: 导航类型与扩展

系统 SHALL 使用 HDMV/BDJ 判别联合和独立后端接入契约；保留 BD-J 元数据，首期不执行 Java。

#### Scenario: BD-J 入口

- **WHEN** 消费包含 HDMV 和 BDJ 入口的契约样本
- **THEN** 保留 BDJO 标识并给出 UNSUPPORTED_NAVIGATION_BACKEND，不伪造 HDMV 目标

#### Scenario: 非法联合

- **WHEN** 同一 navigation 对象混入 HDMV 和 BDJ 专属目标字段
- **THEN** schema 拒绝该对象，而不是任选一类执行

### Requirement: 安全读取与诊断

系统 SHALL 在读取/分配前检查长度、偏移、计数乘积及 Limits；失败保留源相对路径、无损偏移和稳定错误码。

#### Scenario: 截断与超大声明

- **WHEN** Cursor 读取越界或 count×size 溢出
- **THEN** 在读取/分配前安全终止，不补零，不修改失败操作前游标，并报告 expected/actual

#### Scenario: 子窗口来源

- **WHEN** 从文件偏移100的窗口创建长度8的 subview，再在子窗口偏移2读取
- **THEN** 父游标成功推进8，子游标从0起，诊断源偏移可还原为102

### Requirement: 只读输入与事务输出

系统 SHALL 拒绝输入/输出/缓存重叠、路径逃逸和已有目标覆盖；以 staging 校验后提交新输出。

#### Scenario: 符号链接逃逸

- **WHEN** 资源引用的 symlink 指向源根或输出根外部
- **THEN** 拒绝访问并报告路径错误，外部目标及源文件不变

#### Scenario: 中断或目标冲突

- **WHEN** 构建中断，或输出目标已经存在
- **THEN** 不提交正式新包、不覆盖旧包；保留可诊断失败记录

### Requirement: 共享事件与证据基础

系统 SHALL 提供带 session/generation/actionId/responseTo 的事件契约及可复用 fixture；来源、PlayerProfile 和支持证据可被消费者追踪。

#### Scenario: 信封序列化

- **WHEN** 将动作及响应写入 JSON trace 再装载
- **THEN** 动作关联及代次无损保留，下游可识别所属等待操作

#### Scenario: 样本交接

- **WHEN** 下游加载已登记最小 HDMV 和混合 BD-J fixture
- **THEN** 通过同一 schema，expected 有独立字节依据而非待测实现自生成
