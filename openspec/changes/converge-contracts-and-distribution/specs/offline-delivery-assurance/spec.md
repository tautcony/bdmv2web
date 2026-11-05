# Spec Delta

## Purpose

把"完整性校验"与"证据绑定"从过度承诺降级为可复核的事实：字节级完整性校验不在首期实现，相关检查一律显式未验证，不得以字段存在冒充校验能力。

## MODIFIED Requirements

### Requirement: 资源与离线审计

系统 SHALL 独立验证 schema、包内引用、清单一致性、URL 边界和依赖，不盲信既有 status；由可编辑配置指向、已声明且受约束的源 M2TS 与包内菜单资源分开检查；在完整性校验实现之前，系统不得声称可检测字节篡改，相关结论必须记为未验证并阻止 complete。

#### Scenario: 远程或越界

- **WHEN** 菜单运行资源含远程或协议相对 URL、未经授权的外部 file URL、编码目录逃逸或外部 symlink
- **THEN** validate --offline 报具体引用与规范化目标，状态failed

#### Scenario: 清单与文件不一致

- **WHEN** 启动文件缺失、未列入清单，或清单登记的字节长度与实际不符
- **THEN** 报告 PACKAGE_ENTRY_MISSING / PACKAGE_ENTRY_UNLISTED 等具体检查项并拒绝 complete

#### Scenario: 内容被替换但长度未变

- **WHEN** 包内资产的字节被替换而清单登记的长度不变
- **THEN** 系统不声称检测到该变化；完整性相关结论记为未验证，交付不得 complete，报告说明"未实现字节级校验"

#### Scenario: 合法说明网址

- **WHEN** README或报告含不被运行时加载的参考链接
- **THEN** 不当成运行依赖误报；运行资源字段仍逐项审计

#### Scenario: 包独立验证

- **WHEN** 原始BDMV和FFmpeg均不可用但包完整
- **THEN** 仍能校验包内 manifest/资源/引用及已有证据，并将外部 M2TS 可用性和系统交接记为未验证，不要求安装转换工具

### Requirement: 对照与浏览器证据

系统 SHALL 保存指定profile/输入路径的参考VM及IG对照，并记录 Google Chrome 版本与证据的适用边界；浏览器证据绑定 Chrome 版本和其实际比较过的维度（profile、模式、矩阵），不得声称覆盖制品内容。

#### Scenario: 首个行为分歧

- **WHEN** 参考和Web在某条指令的寄存器/动作首次不同
- **THEN** 报告首个分歧及双方状态/来源，墙钟差异不冒充语义差异

#### Scenario: 图层比较

- **WHEN** 同时间/分辨率/颜色规则比较 IG 和菜单背景视频
- **THEN** IG 图形按同类工具对同一测试案例生成的参考逐元素比较尺寸与 RGBA，覆盖各按钮状态引用的图像；菜单背景视频质量另计

#### Scenario: V1 Chrome 证据缺席

- **WHEN** V1 Google Chrome 版本记录或场景证据缺失
- **THEN** 记not-verified并阻止complete，不以其他浏览器的结果代替

#### Scenario: 环境或配置变动

- **WHEN** 获得浏览器证据后 profile、模式、矩阵或环境记录发生变化
- **THEN** 相关证据失效，要求重验，不能复用旧截图宣称通过

#### Scenario: 制品内容变动

- **WHEN** 生成制品的文件内容被替换而 profile/模式/矩阵/环境记录不变
- **THEN** 系统不声称自动识别该替换；报告须明示证据绑定不含制品内容、artifact 哈希仅记录未复验，交付不得据此宣称已验证

#### Scenario: 证据字段不得冒充校验

- **WHEN** 产物或报告中出现与完整性相关的字段
- **THEN** 该字段不得以"已校验"语义呈现；未实现校验时相关结论记为 not-verified，不输出看起来像校验值的占位内容
