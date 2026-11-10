# Spec Delta

## ADDED Requirements

### Requirement: BDJO 结构查看
系统 SHALL 解析被 INDEX 引用的 BDJO 文件并输出其终端信息、缓存表、可访问播放列表、应用管理表、按键兴趣位和文件访问路径；这些数据 SHALL 带有 BDJO 文件来源，且不得执行 BD-J 程序。

#### Scenario: 引用的 BDJO 可解析
- **WHEN** INDEX entry 引用一个存在且结构有效的 BDJO 文件
- **THEN** inspect JSON 输出解析后的 BDJO 记录、应用/播放列表声明及来源，BD-J execution 状态为 `unsupported`

#### Scenario: BDJO 文件缺失或损坏
- **WHEN** INDEX entry 引用的 BDJO 文件缺失或记录越过其声明边界
- **THEN** 输出定位到 BDJO 路径和偏移的诊断，保留 INDEX entry 和其它可读数据

### Requirement: META/DL 元数据查看
系统 SHALL 读取 META/DL 中符合命名约定的 XML 清单，并输出语言、光盘名称、替代名称、套装位置、目录标题及缩略图声明。

#### Scenario: 有效的本地化清单
- **WHEN** META/DL 中存在有效的 `bdmt_<language>.xml` 文件
- **THEN** inspect JSON 输出其本地化字段、标题表和缩略图相对路径/尺寸，并保留 XML 文件来源

#### Scenario: 无效或超限的清单
- **WHEN** META/DL 清单 XML 无效或超过结构读取限制
- **THEN** 输出可定位的 recoverable 诊断，继续报告其他 BDMV 结构

### Requirement: MPLS 和 CLPI ExtensionData 查看
系统 SHALL 输出 MPLS/CLPI ExtensionData 的 entry 标识、版本、来源偏移、声明长度及已解码的支持类型；未知类型 SHALL 保留 entry 元数据并标注未解析。

#### Scenario: 已知扩展 entry
- **WHEN** MPLS 或 CLPI 含有受支持的 ExtensionData entry
- **THEN** inspect JSON 输出该 entry 的来源和字段，包括已识别的 PIP、扩展 SubPath、静态 HDR、extent start point、ProgramInfo SS 或 CPI SS 数据

#### Scenario: 未知扩展 entry
- **WHEN** ExtensionData entry 的 ID/version 组合没有对应解析器
- **THEN** 输出其 ID、version、offset 和 length，并给出该 entry 未解析的诊断

#### Scenario: 损坏扩展 entry
- **WHEN** ExtensionData 地址、数量或 payload 长度越过文件边界
- **THEN** 输出有界结构诊断，不读取相邻 section 作为 payload

### Requirement: MPLS 高级播放结构
系统 SHALL 保留多角度 PlayItem 的所有替代 Clip/codec/STC 记录、STN 流类别和视频属性，并为每条新增字段记录其原始来源。

#### Scenario: 多角度 PlayItem
- **WHEN** PlayItem 声明多个角度
- **THEN** 输出主角度与全部替代角度的 clip、codec 和 STC 标识，不将角度声明合并成一个计数

#### Scenario: 分类的 STN 流
- **WHEN** PlayItem 声明多个 STN 流类别及视频属性
- **THEN** 输出每条流的类别、类别内序号、编码属性、语言和可用的 HDR/色彩标志

### Requirement: CLPI 高级结构
系统 SHALL 输出 CLPI ClipMark、ProgramInfo group 数、视频流属性和 CPI coarse/fine 映射字段，并保留当前派生访问点。

#### Scenario: ClipMark 与 CPI 映射
- **WHEN** CLPI 声明 ClipMark 或 CPI coarse/fine 数据
- **THEN** inspect JSON 输出原始 mark 字段、分组的 coarse/fine 记录和现有派生访问点，所有来源位置指向其 CLPI 记录

#### Scenario: CLPI 可选结构损坏
- **WHEN** 可选 ClipMark、视频属性或 ExtensionData 结构无效
- **THEN** 输出定位诊断并保留已解析的 ClipInfo、ProgramInfo、SequenceInfo 和 CPI 数据

### Requirement: 解析证据状态
系统 SHALL 将结构字段已解析与协议行为已验证分别报告；只有具备登记的独立 expected/reference 证据时，才可将对应协议行为标为 verified/supported。

#### Scenario: 扩展字段已实现但缺少独立预期
- **WHEN** 解析器可输出某格式字段，但项目没有独立字段级 expected/reference 对照
- **THEN** 输出字段解析覆盖和当前 `unverified` 证据状态，不提升为 `supported`

#### Scenario: 独立证据已登记
- **WHEN** 某格式字段有固定来源、版本和独立字段级对照记录
- **THEN** 状态仅更新到该字段实际覆盖的范围，不推广为整个格式版本的支持声明
