# Spec Delta

## Purpose

为离线 BDMV 转换和浏览器运行提供可验证的解析碟片结构与入口能力，明确输入、输出、错误及对下游的可观察行为。

## ADDED Requirements

### Requirement: 入口及备份来源

系统 SHALL 解析 First Play、Top Menu 和标题的导航类型与目标，并记录实际使用的主文件或 BACKUP 来源。

#### Scenario: 主索引不可用且匹配备份有效

- **WHEN** 主索引不可用且匹配备份有效
- **THEN** 使用备份并在检查结果中记录来源和回退诊断

### Requirement: 结构与引用图

系统 SHALL 解析 MovieObject、MPLS、CLPI 和 sound 的声明及引用，保留对象、PlayItem、章节、轨道和源位置。

#### Scenario: 播放列表引用缺失 Clip

- **WHEN** 播放列表引用缺失 Clip
- **THEN** 检查结果包含缺失引用与源位置，不能以完整结构报告

### Requirement: 检查与提取

系统 SHALL 提供 inspect 和 extract，输出来源可追踪的结构、命令和已发现资源，包括不可达声明。

#### Scenario: 存在混合 HDMV 和 BD-J 入口

- **WHEN** 存在混合 HDMV 和 BD-J 入口
- **THEN** 分别列出类型与目标，BD-J 标注 unsupported 而非丢弃
