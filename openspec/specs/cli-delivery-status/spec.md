# cli-delivery-status Specification

## Purpose

让 CLI 的阶段结果、交付状态与进程退出码三者一致：状态判定只反映已验证事实，参数契约不出现"接受但不生效"的项，未实现能力明确报错并退出，状态不由接受策略改写。

## Requirements

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
- **THEN** `extract` 不提交 staging、不生成正式输出目录，stdout 报 `stageStatus: "failed"` 与错误码，进程退出码为 1

#### Scenario: 失败对象与成功对象同字段

- **WHEN** `inspect` / `extract` 以失败结束
- **THEN** 失败对象同样使用 `stageStatus`，不出现只表示交付结论的 `status`

#### Scenario: 转换期 fatal

- **WHEN** `convert` 的解析或打包阶段出现 `fatal` 诊断
- **THEN** 不产生可被误认为完成的新包，退出码为 1

### Requirement: 状态只由失败证据决定

系统 SHALL 让阶段与交付状态只由诊断与审计事实决定：fatal 为 failed 并退出 1，其余可接受的 partial 退出 0 且报告显著标注，不得把 partial 升级为 complete、不得把 failed 降级。

#### Scenario: 可接受的 partial

- **WHEN** 存在未认可的 error 但无 fatal
- **THEN** 阶段或交付状态为 partial，退出 0 且报告显著标注

#### Scenario: acknowledged 错误

- **WHEN** 用户确认某条 error 为可接受
- **THEN** 原 severity 与功能影响保留，状态不因此提升为 complete

### Requirement: 单一产物形态

系统 SHALL 通过 `convert` 产出唯一的菜单包，且不提供模式参数；stdout、manifest、report、兼容性报告和发布汇总不记录产物模式。产物形态不得作为"交付不完整"的判定依据。

#### Scenario: 裸跑转换

- **WHEN** 执行 `convert INPUT`
- **THEN** 生成统一菜单包，并按实际缺口判定状态；无缺口时退出 0

#### Scenario: 传入已移除的模式参数

- **WHEN** `convert` 收到 `--mode`
- **THEN** 在任何输出目录或事务创建前返回 `CLI_UNKNOWN_OPTION`，退出码 1，磁盘无新目录

#### Scenario: 状态判定不含模式

- **WHEN** 菜单包无任何缺口
- **THEN** 状态可为 complete；stdout、manifest、report 与 compatibility 均不包含 `mode` 字段

### Requirement: 结论只由失败证据决定

系统 SHALL 以"是否存在失败证据"判定交付状态，不得把"缺少证据"当作失败证据：未执行的检查、未提供的条目计数、未验证的覆盖率都不降低状态。

#### Scenario: 未验证证据不阻断

- **WHEN** 交付包的检查项全部为 `pass` 或 `not-verified`，且无 `fail` 检查、无 fatal、无 blocking error
- **THEN** 状态为 `complete`，`not-verified` 项记入 `notVerified` 字段，退出码为 0

#### Scenario: 失败证据仍然阻断

- **WHEN** 存在 `fail` 检查、`error` 级诊断或缺失必需资产
- **THEN** 状态不为 `complete`（`error` 为 `partial`，`fail`/`fatal`/缺失资产为 `failed`），不受 `notVerified` 影响

#### Scenario: 生成菜单即完成

- **WHEN** `convert` 成功产出菜单包，且诊断中没有 `error` 或 `fatal`
- **THEN** `reports.json.compatibility.status`、`reports.json.conversion.status`、`manifest.json.status` 与 stdout 同为 `complete`

#### Scenario: 转换与验证报告分开更新

- **WHEN** 同一个包分别由 `convert` 与 `validate` 判定
- **THEN** 两者使用同一套判定规则并给出相同状态；`build` 写入 `conversion`，`validate` 更新 `compatibility`

#### Scenario: manifest 结论不被回写

- **WHEN** `validate` 的判定结果与 `manifest.status` 不一致
- **THEN** 不修改 `manifest.json`，改为输出 `manifestStatus` 与真实状态，并给出 `MANIFEST_STATUS_UNVERIFIED`（`not-verified`）

#### Scenario: limitations 只作说明

- **WHEN** manifest 记录了 limitations
- **THEN** limitations 只出现在说明与 `reasons` 中，不参与状态判定

### Requirement: 参数契约明确

系统 SHALL 对每个被接受的参数给出可观察效果；未实现的参数必须报未实现，缺值必须报参数错误，不得静默忽略或降级到其它行为。

#### Scenario: 旗标缺值

- **WHEN** 旗标出现在命令末尾且没有值（如 `inspect INPUT --out`）
- **THEN** 返回参数错误 `CLI_MISSING_VALUE` 并退出 1，不回退到 stdout 输出

#### Scenario: limits 已接线

- **WHEN** `convert` 收到 `--limits FILE`
- **THEN** 合法文件中的 Limits 对象传入转换阶段与打包后的 HDMV VM，可通过 trace 的 limit 字段观察生效值

#### Scenario: limits 非法

- **WHEN** `--limits` 的文件不可读、JSON 非法或取值不合法
- **THEN** 以 `INVALID_LIMITS_FILE` / `INVALID_LIMITS` / `INVALID_LIMIT` 诊断退出 1，不启动转换，不生成输出目录

#### Scenario: 已接线参数生效

- **WHEN** 用两份不同的 `--player-profile` 分别生成菜单包
- **THEN** 产物中记录的 profile 随之不同，profile 缺失或非法时退出 1

#### Scenario: 拼错选项

- **WHEN** 传入命令不支持的选项（`--stric`、`--ou`）
- **THEN** 报 `CLI_UNKNOWN_OPTION` 并退出 1，不产生输出目录，不降级到默认行为

#### Scenario: 多余位置参数

- **WHEN** 一个命令收到多于一个位置参数
- **THEN** 报 `CLI_USAGE` 并退出 1

#### Scenario: 参数错误不产生副作用

- **WHEN** `validate` 的 `--format` 缺值或取值不受支持
- **THEN** 在读写任何报告前失败（`CLI_MISSING_VALUE` / `CLI_INVALID_FORMAT`），包内文件字节不变

#### Scenario: profile 字段按 PSR 规则

- **WHEN** `--player-profile` 的语言或国家码不是规定长度的 ASCII 字母
- **THEN** 在参数解析阶段报 `CLI_INVALID_PROFILE` 并退出 1，不等到 VM 构造时才以 `E_IO` 失败

### Requirement: 落盘报告与命令输出同源

系统 SHALL 用同一份汇总结论生成 `dependency-audit.json`、`reports.json`、`reports/release-summary.json` 与 stdout，不得让磁盘与命令输出给出两套结论。

#### Scenario: 空检查集

- **WHEN** 包内没有静态载荷，依赖审计检查集为空
- **THEN** 磁盘 `dependency-audit.json` 与 stdout 的 `dependencyAudit.checks` 完全相等（都含 `DEPENDENCY_AUDIT_REQUIRED`）
