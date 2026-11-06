# Spec Delta

## Purpose

从可达 M2TS 中抽取并解析 Blu-ray PGS 字幕，将可验证的显示集、RGBA 像素和来源时间映射写入当前包格式，供后续播放集成使用。

## ADDED Requirements

### Requirement: 可达 PGS 流抽取

系统 SHALL 根据媒体闭包识别可达 PlayItem 的 PGS PID，从对应 M2TS 无损抽取 SUP，并保留 playlist、PlayItem、clip、PID、STN 轨序号、语言和源时间区间。

#### Scenario: 抽取同一源流的多个引用

- **WHEN** 多个可达 playlist/PlayItem 引用同一个 clip/PID
- **THEN** 包含一个 SUP 文件，并为每个引用记录各自的 playlist、PlayItem 和时间映射

#### Scenario: PID 缺失或流损坏

- **WHEN** 源 M2TS 不含所声明的 PGS PID，或抽取出的 SUP 无法解析
- **THEN** 转换失败并保留可定位的来源错误，不得静默省略字幕后宣称完成

### Requirement: PGS 显示集解析与有界序列化

系统 SHALL 验证 SUP 片段边界、PCS、PDS 调色板、ODS 分片、RLE 对象和裁切区域，并将显示集图像编码为 PNG 后以 Base64 写入有界 JSON-safe runtime 数据。显示时间、画面尺寸、调色板、对象标识/尺寸、位置、裁切区域和来源映射 SHALL 保留；展开后的 RGBA 字节 SHALL NOT 写入 runtime JSON。

#### Scenario: 解析生成盘字幕

- **WHEN** 解析 bdmvkit 生成的 PGS 流
- **THEN** 保留 show/clear 显示集、PNG 视觉内容、调色板、对象标识/尺寸、坐标、裁切区域和 90 kHz PTS

#### Scenario: PTS 跨越 32-bit 回绕

- **WHEN** 同一 SUP 流的 PTS 从 32-bit 最大值回绕到低值
- **THEN** 解析结果将后续显示集映射到延续的 90 kHz 时间，而不把它排序到流起点

#### Scenario: SUP 时间戳保持参考导出结果

- **WHEN** 从 M2TS PES 组装 SUP 并保留播放区间时间基准
- **THEN** 每个 PGS 段的 PTS/DTS 与同源参考 SUP 一致，显示集时间不因重新组装而偏移

#### Scenario: 像素或包数据超过界限

- **WHEN** 解码对象或序列化后的 PGS 数据超过配置界限
- **THEN** 转换拒绝该输出，不生成越界分配或不完整字幕包

#### Scenario: 序列化 PGS 显示集图像

- **WHEN** 成功序列化已验证的 PGS 显示集
- **THEN** runtime 数据以 PNG Base64 保存完整合成画面及既有显示集元数据，并在运行时数据预算内拒绝超限包

#### Scenario: 从 Blu-ray M2TS 抽取 PGS

- **WHEN** 用户运行 PGS `export-assets`
- **THEN** 系统使用内置 M2TS/PES 读取和 SUP 组装，不调用 FFmpeg

#### Scenario: 包资源完整性

- **WHEN** 成功写入 PGS 资源
- **THEN** SUP 文件和包含显示集/像素的 runtime 数据都在 manifest 中记录字节数与 SHA-256
