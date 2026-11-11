# offline-delivery-assurance Specification

## Purpose
通过独立资源审计和差分判定交付状态。

主规格归属：本 change 以 ADDED 建立 `offline-delivery-assurance`，并已把 `converge-contracts-and-distribution` 的收敛要求（清单一致性检查、不承诺字节级校验、证据字段不得冒充校验）并入下列 ADDED 需求；该 change 不持有本主规格的 delta。

## Requirements

### Requirement: 资源与引用审计

系统 SHALL 独立验证 schema、包内引用、清单一致性、URL 边界和依赖，不盲信既有 status；由可编辑配置指向、已声明且受约束的源 M2TS 与包内菜单资源分开检查；配置变化使相关交接证据失效；清单不计算包内文件内容校验和，系统不得声称可检测字节替换。

#### Scenario: 远程或越界引用

- **WHEN** 菜单运行资源含远程或协议相对 URL、未经授权的外部 file URL、编码目录逃逸或外部 symlink
- **THEN** `validate` 报具体引用与规范化目标，状态failed

#### Scenario: 清单与必需文件不一致

- **WHEN** 启动文件缺失、未列入清单，或必需清单路径不存在
- **THEN** 报告对应缺失/未登记检查项并拒绝 complete

#### Scenario: 文件内容变化

- **WHEN** 必需媒体/JS/PNG内容变化，但路径和引用仍有效
- **THEN** validate 只报告实际执行的路径、存在性和引用检查，不作内容一致性结论，也不声称检测到替换

#### Scenario: 合法说明网址

- **WHEN** README或报告含不被运行时加载的参考链接
- **THEN** 不当成运行依赖误报；运行资源字段仍逐项审计

#### Scenario: 包独立验证

- **WHEN** 原始BDMV和FFmpeg均不可用但包完整
- **THEN** `validate` 仍能校验包内 manifest/资源/引用及已有证据，并将外部 M2TS 可用性和系统交接记为未验证，不要求安装转换工具

### Requirement: 完成度与严格模式

系统 SHALL 按共享决策表区分complete/partial/failed；`complete` 只表示无已知失败证据。strict只改变接受策略，不能改变支持事实。未执行或无法观察的检查 SHALL 单独进入 `notVerified`，不得改写 `status`。

#### Scenario: 混合入口或未支持操作

- **WHEN** 包可启动但含BD-J或可达unsupported/unknown
- **THEN** 状态partial并保留受影响入口；strict退出2，非strict不因此升级complete

#### Scenario: 纯BD-J或关键损坏

- **WHEN** 没有有效HDMV启动，或入口/必需资源损坏
- **THEN** 状态failed，退出非零，不发布正式完整包

#### Scenario: 确认错误

- **WHEN** 用户acknowledge一个阻断功能的Error
- **THEN** 原severity与功能影响保留，不将partial改complete

#### Scenario: 缺参考证据但无已知失败

- **WHEN** 所有已执行检查为pass，另有not-verified，且无阻断诊断
- **THEN** 状态complete，strict退出0，并逐条列出notVerified；不声称这些检查已通过

#### Scenario: 检查失败与未验证并存

- **WHEN** 同一个审计包含fail与not-verified
- **THEN** 聚合结果为fail，最终交付状态由失败证据决定，not-verified不得掩盖fail

### Requirement: 覆盖统计与未知项

系统 SHALL 分别报告入口、指令、媒体和测试分母及支持/失败/未知，保留未验证项。

#### Scenario: 缺分母或动态未知

- **WHEN** 分析预算耗尽或存在未解析目标
- **THEN** 报告unknown与具体来源，不能宣称全路径100%

#### Scenario: 零项类别

- **WHEN** 某包不存在对应指令/媒体类别
- **THEN** 记N/A和原因，不以0/0自动算100%

### Requirement: 对照证据

系统 SHALL 保存指定profile/输入路径的参考VM及IG对照，并记录所用参考工具版本与测试场景；证据绑定不含制品字节校验。

#### Scenario: 首个行为分歧

- **WHEN** 参考和Web在某条指令的寄存器/动作首次不同
- **THEN** 报告首个分歧及双方状态/来源，墙钟差异不冒充语义差异

#### Scenario: 图层比较

- **WHEN** 同时间/分辨率/颜色规则比较 IG 和菜单背景视频
- **THEN** IG 图形按同类工具对同一测试案例生成的参考逐元素比较尺寸与 RGBA，覆盖各按钮状态引用的图像；菜单背景视频质量另计

#### Scenario: 制品字节变化

- **WHEN** 生成制品的文件内容被替换
- **THEN** 系统不声称自动识别该替换；既有报告不构成对当前制品内容的校验结论

#### Scenario: 证据字段不得冒充校验

- **WHEN** 产物或报告中出现与完整性相关的字段
- **THEN** 该字段不得以"已校验"语义呈现；未实现校验时相关结论记为 not-verified，不输出看起来像校验值的占位内容

#### Scenario: 比较命令的结果与退出码

- **WHEN** `compare` 收到实际 trace 与独立参考 trace
- **THEN** 一致时输出 `pass` 并退出 0；首处分歧、输入错误或执行错误输出 `fail` 并退出 1；参考 trace 缺席时输出 `not-verified` 并退出 2，不宣布通过；被测 trace 不得充当参考

### Requirement: 直接打开与便携性

系统 SHALL 支持从任意目录路径直接打开本地菜单包，运行引用保持包内；包迁移、配置修改、特殊字符路径与协议目标构造 SHALL 由自动化检查验证。

#### Scenario: 移动菜单包

- **WHEN** 整目录复制到含中文/空格的新路径并重新加载
- **THEN** 引用解析、脚本与图形入口、菜单音频状态与协议目标构造在模拟环境中保持一致；源 M2TS 是否可读与外部程序是否执行记为未验证

#### Scenario: 播放被拒后的恢复

- **WHEN** 浏览器策略拒绝媒体播放或拒绝协议导航
- **THEN** 用户手势可继续且不重复VM副作用；证据记录拒绝事件的类别与恢复后的菜单状态

### Requirement: 安全失败

系统 SHALL 对损坏/超限/不安全路径有界终止并保留诊断，执行模块与发布校验共用预算和状态语义。

#### Scenario: 回归恶意样本

- **WHEN** 输入含超大尺寸、跳转环、非法路径或截断
- **THEN** 在预算内终止，报告源位置/错误码，源与旧输出不变

#### Scenario: 证据不足的报告

- **WHEN** 存在未验证必测项或未完成实施任务时生成发布摘要
- **THEN** 缺口逐条列入notVerified并说明下一步；不勾选发布通过，也不将未完成实施任务标完成
