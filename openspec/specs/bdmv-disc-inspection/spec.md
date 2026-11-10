# bdmv-disc-inspection Specification

## Purpose

从真实入口和文件声明构建可追踪的 ParsedDisc 与结构图：每个实体、来源与诊断都能回读到原盘文件位置，未知与解析失败明确保留，不以占位值或推测关系掩盖缺失信息。

## Requirements

### Requirement: 入口及备份来源

系统 SHALL 解析 First Play/Top Menu/Title 的类型、目标和属性；按主文件优先、匹配元数据整文件回退规则保留实际来源。

#### Scenario: 匹配备份恢复

- **WHEN** 主 index 缺失或结构损坏且匹配 BACKUP 有效
- **THEN** 整文件使用备份，输出实际备份路径及回退诊断，不混用主备字段

#### Scenario: 未知版本不回退

- **WHEN** 主文件版本未知且备份为已知旧版本
- **THEN** 报告 BDMV_UNSUPPORTED_VERSION，不将旧备份默认为同等有效主版本

#### Scenario: 主备冲突

- **WHEN** 主备均有效但内容不同
- **THEN** 使用主文件并记录差异，不拼接内容；跨文件引用仍独立校验

### Requirement: 目录发现与歧义

系统 SHALL 只接受 BDMV 根或其直接父目录，遵守路径安全，不按排序猜碟片或入口。

#### Scenario: 父目录及特殊路径

- **WHEN** 输入含中文与空格的父目录且只有一个有效 BDMV
- **THEN** 发现同一规范根，保留实际路径，扫描不改源文件

#### Scenario: 多候选

- **WHEN** 目录大小写变体形成多个可选 BDMV 根
- **THEN** 返回歧义诊断，不按文件名选择其中之一

### Requirement: 结构与引用图

系统 SHALL 解析 MOBJ/MPLS/CLPI/sound，保留 PlayItem/Mark/STN/SubPath、流及原始来源；未知引用显式 unresolved/missing。

#### Scenario: 缺失 Clip

- **WHEN** MPLS 的 PlayItem 引用不存在的 STREAM 或 CLPI
- **THEN** 分别给出缺失目标及声明字段来源，不报告完整结构

#### Scenario: 章节越界

- **WHEN** Mark 关联不存在的 PlayItem 或时间不在其有效区间
- **THEN** 报告 BDMV_INVALID_REFERENCE 和原始时间单位，不创建可执行章节

#### Scenario: 结构阶段未知边

- **WHEN** 命令目标尚未由 M3 解码
- **THEN** 结构图将相关边保留 unresolved，不把对应目标直接标为不可达

### Requirement: 原始命令及协议边界

系统 SHALL 保留每条12字节 MovieObject记录、索引、属性和文件偏移；格式版本与边界必须经过已登记依据核验。

#### Scenario: 原始指令交接

- **WHEN** 解析具有两条指令的 MOBJ
- **THEN** 输出恰好两组 raw 三字及各自精确偏移，未知 opcode 不在容器层丢弃

#### Scenario: 记录截断

- **WHEN** 命令数声明超过剩余字节
- **THEN** 有界失败并定位记录，不以补零指令凑数

### Requirement: 可选元数据不得决定可读性

系统 SHALL 只把主 index section（入口表）视为 critical；AppInfo 与 UHD 扩展等可选元数据解析失败时降级为 warning 诊断并继续解析导航，不得把整张盘判为不可解析。

#### Scenario: UHD 元数据损坏

- **WHEN** INDX 扩展区长度、entry 上界或 3.1 payload 损坏
- **THEN** `entries` 仍完整保留，`discInfo.uhd` 为 null，产生 `warning` 级诊断，`inspect` / `extract` / `convert` 不因此退出 1

#### Scenario: 声明长度不自洽

- **WHEN** 扩展区或 CLPI 的长度字段少报/越界，但记录仍落在文件内
- **THEN** 记 `BDMV_DECLARED_LENGTH_MISMATCH`（`warning`）并按文件边界继续解析，不丢弃整个 section 或 CLPI

#### Scenario: 真的读越文件

- **WHEN** 记录的计数或偏移确实超出文件边界
- **THEN** 仍以 `BDMV_INVALID_COUNT` / `BDMV_INVALID_SECTION` 有界失败，不把相邻 section 当作本 section 的数据

### Requirement: 轨道与可选资源

系统 SHALL 保留 STN/CLPI 轨道、角度/SubPath 标记和 sound 原始采样范围；冲突或未支持能力显式可见。

#### Scenario: PID 冲突

- **WHEN** STN 与 CLPI 声明互相冲突
- **THEN** 保留双方信息及来源，给 M2 交叉核验，不静默覆盖

#### Scenario: 无 sound 文件

- **WHEN** 碟片未提供可选 sound 且尚无已知声音引用
- **THEN** 记录资源不存在而非一律关键失败；后续出现引用时可追踪缺口

### Requirement: 检查与提取

系统 SHALL inspect/extract 输出来源可追踪的结构、全部声明及诊断，区分结构预测与最终交付状态。

#### Scenario: 混合入口

- **WHEN** 碟片含 HDMV 和 BD-J 标题
- **THEN** 分别保留类型/目标，BD-J 标 unsupported，不从统计分母删除

#### Scenario: 结构 JSON

- **WHEN** 运行 inspect --format json
- **THEN** stdout 可独立 JSON 解析，含 analysisStage=structural；日志到 stderr，不声称动态路径已全验证

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
