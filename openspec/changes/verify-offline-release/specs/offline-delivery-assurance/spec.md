# Spec Delta

## Purpose

通过独立资源审计、差分和浏览器证据判定交付状态。

## ADDED Requirements

### Requirement: 资源与离线审计

系统 SHALL 独立验证 schema、包内引用、生成资产 hash、URL 边界和依赖，不盲信既有 status；由可编辑配置指向、已声明且受约束的源 M2TS 与包内菜单资源分开检查；配置变化使相关交接证据失效。

#### Scenario: 远程或越界

- **WHEN** 菜单运行资源含远程或协议相对 URL、未经授权的外部 file URL、编码目录逃逸或外部 symlink
- **THEN** validate --offline 报具体引用与规范化目标，状态failed

#### Scenario: 资产被篡改

- **WHEN** 必需媒体/JS/PNG字节与manifest不一致
- **THEN** 报告 PACKAGE_MISSING_ASSET 或校验错误并拒绝complete，旧证据失效

#### Scenario: 合法说明网址

- **WHEN** README或报告含不被运行时加载的参考链接
- **THEN** 不当成运行依赖误报；运行资源字段仍逐项审计

#### Scenario: 包独立验证

- **WHEN** 原始BDMV和FFmpeg均不可用但包完整
- **THEN** 仍能校验包内 manifest/资源/引用及已有证据，并将外部 M2TS 可用性和系统交接记为未验证，不要求安装转换工具

### Requirement: 完成度与严格模式

系统 SHALL 按共享决策表区分complete/partial/failed；strict只改变接受策略，不能改变支持事实。

#### Scenario: 混合入口或未支持操作

- **WHEN** 包可启动但含BD-J或可达unsupported/unknown
- **THEN** 状态partial并保留受影响入口；strict退出2，非strict不因此升级complete

#### Scenario: 纯BD-J或关键损坏

- **WHEN** 没有有效HDMV启动，或入口/必需资源损坏
- **THEN** 状态failed，退出非零，不发布正式完整包

#### Scenario: 确认错误

- **WHEN** 用户acknowledge一个阻断功能的Error
- **THEN** 原severity与功能影响保留，不将partial改complete

#### Scenario: 所有门槛满足

- **WHEN** 统一产物的菜单资源、声明范围内的系统交接、支持/对照及 V1 macOS Chrome 场景全部通过
- **THEN** 才可 complete，strict 退出 0；外部播放器能力和未证明的 Playlist 语义不得冒充已验证

### Requirement: 覆盖统计与未知项

系统 SHALL 分别报告入口、指令、媒体和测试分母及支持/失败/未知，保留未验证项。

#### Scenario: 缺分母或动态未知

- **WHEN** 分析预算耗尽或存在未解析目标
- **THEN** 报告unknown与具体来源，不能宣称全路径100%

#### Scenario: 零项类别

- **WHEN** 某包不存在对应指令/媒体类别
- **THEN** 记N/A和原因，不以0/0自动算100%

### Requirement: 对照与浏览器证据

系统 SHALL 保存指定profile/输入路径的参考VM及IG对照，并绑定制品指纹与真实浏览器/OS版本。

#### Scenario: 首个行为分歧

- **WHEN** 参考和Web在某条指令的寄存器/动作首次不同
- **THEN** 报告首个分歧及双方状态/来源，墙钟差异不冒充语义差异

#### Scenario: 图层比较

- **WHEN** 同时间/分辨率/颜色规则比较 IG 和菜单背景视频
- **THEN** IG 图形按同类工具对同一测试案例生成的参考逐元素比较尺寸与 RGBA，覆盖各按钮状态引用的图像；菜单背景视频质量另计

#### Scenario: V1 Chrome 证据缺席

- **WHEN** V1 macOS Chrome 环境无实际版本记录或场景证据
- **THEN** 记not-verified并阻止complete，不假设另一个平台结果可代替

#### Scenario: 制品变动

- **WHEN** 获得浏览器证据后运行bundle或profile变化
- **THEN** 相关证据失效，要求重验，不能复用旧截图宣称通过

### Requirement: 直接打开与便携性

系统 SHALL 在 V1 macOS Google Chrome 环境中断网直接 `file://` 验证菜单，并在源 M2TS 可用且满足已声明接入条件时验证系统默认程序交接。跨系统和其它浏览器不属于 V1 发布门槛。

#### Scenario: 移动断网播放

- **WHEN** 整目录复制到含中文/空格的新路径并直接打开
- **THEN** 记录脚本/图形/菜单声音及系统打开实际 M2TS 的结果和版本；源不可用时记录缺口，不能以 HTTP 测试代替

#### Scenario: 播放被拒后的恢复

- **WHEN** 默认浏览器策略拒绝自动播放
- **THEN** 用户手势可继续且不重复VM副作用，证据明确有声结果

### Requirement: 安全失败

系统 SHALL 对损坏/超限/不安全路径有界终止并保留诊断，执行模块与发布校验共用预算和状态语义。

#### Scenario: 回归恶意样本

- **WHEN** 输入含超大尺寸、跳转环、非法路径或截断
- **THEN** 在预算内终止，报告源位置/错误码，源与旧输出不变

#### Scenario: 证据不足发布

- **WHEN** 存在失败或未验证必测项时生成发布摘要
- **THEN** 清楚列缺口，不勾选发布通过，也不将未完成实施任务标完成
