# Spec Delta

## Purpose

让 CLI 的阶段结果、交付状态与进程退出码三者一致，并使参数契约不出现"接受但不生效"的项。

## ADDED Requirements

### Requirement: 阶段结果与交付状态分离

系统 SHALL 用独立类型表示"命令阶段是否达成"与"交付包是否完整"，阶段成功不得表述为交付完成。

#### Scenario: 结构成功但无菜单

- **WHEN** `extract` 完成结构阶段且未生成播放器
- **THEN** 报告 `stageStatus: "complete"`，交付状态仍为未完成，不出现 `status: "complete"`

#### Scenario: 报告字段可区分

- **WHEN** 读取 `inspect` / `extract` 的机器输出
- **THEN** 阶段结论位于 `stageStatus`，交付结论只出现在 `validate` / `convert` 的 `status`

### Requirement: fatal 诊断不得成功退出

系统 SHALL 在任何 `fatal` 诊断出现时拒绝提交输出并返回失败退出码。

#### Scenario: 缺少必需入口

- **WHEN** 输入的 BDMV 缺少 `index.bdmv`，解析记录 `fatal BDMV_REQUIRED_FILE_MISSING`
- **THEN** `extract` 不提交 staging、不生成正式输出目录，stdout 报 `status: "failed"` 与错误码，进程退出码为 1

#### Scenario: 转换期 fatal

- **WHEN** `convert` 的解析或打包阶段出现 `fatal` 诊断
- **THEN** 不产生可被误认为完成的新包，退出码为 1

### Requirement: strict 只改变接受策略

系统 SHALL 让 strict 仅把可接受的 partial 变为拒绝，不改变诊断事实、不把 partial 升级为 complete、不把 failed 降级。

#### Scenario: 非 strict 的 partial

- **WHEN** 存在未认可的 error 但无 fatal
- **THEN** 阶段或交付状态为 partial，非 strict 退出 0 且报告显著标注，strict 退出 2

#### Scenario: acknowledged 错误

- **WHEN** 用户确认某条 error 为可接受
- **THEN** 原 severity 与功能影响保留，状态不因此提升为 complete

### Requirement: 单一产物形态

系统 SHALL 只产出 `menu-only` 形态的菜单包，产物形态不得作为"交付不完整"的判定依据；不支持的模式必须在产生任何输出前被拒绝。

#### Scenario: 裸跑转换

- **WHEN** 执行 `convert INPUT` 不带模式参数
- **THEN** 使用 `menu-only` 并按实际缺口判定状态；无缺口时退出 0

#### Scenario: 请求未支持模式

- **WHEN** 传入 `--mode standalone-full`
- **THEN** 在任何输出目录或事务创建前返回 `CLI_UNSUPPORTED_MODE`，退出码 1，磁盘无新目录

#### Scenario: 状态判定不含模式

- **WHEN** 交付包除模式外无任何缺口
- **THEN** 状态可为 complete；`mode` 只作为记录字段出现在报告中

### Requirement: 参数契约明确

系统 SHALL 对每个被接受的参数给出可观察效果；未实现的参数必须报未实现，缺值必须报参数错误，不得静默忽略或降级到其它行为。

#### Scenario: 旗标缺值

- **WHEN** 旗标出现在命令末尾且没有值（如 `inspect INPUT --out`）
- **THEN** 返回参数错误 `CLI_MISSING_VALUE` 并退出 1，不回退到 stdout 输出

#### Scenario: 未接线的参数

- **WHEN** 使用依赖其它 change 尚未接线的参数（`--limits`）
- **THEN** 明确报未实现并退出 1，不出现"接受但无效果"

#### Scenario: 已接线参数生效

- **WHEN** 用两份不同的 `--player-profile` 分别生成菜单包
- **THEN** 产物中记录的 profile 随之不同，profile 缺失或非法时退出 1
