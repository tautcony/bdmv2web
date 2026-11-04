# Spec Delta

## Purpose

从真实入口和文件声明构建可追踪的 ParsedDisc 与结构图。

## ADDED Requirements

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
