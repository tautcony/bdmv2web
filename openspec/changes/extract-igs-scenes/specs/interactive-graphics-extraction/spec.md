# Spec Delta

## Purpose

为离线 BDMV 转换和浏览器运行提供可验证的提取交互图形与菜单场景能力，明确输入、输出、错误及对下游的可观察行为。

## ADDED Requirements

### Requirement: 传输流重组

系统 SHALL 验证 M2TS 同步、解析 TS/PES 并按 PID 重组 IGS 段，同时保留源位置及时间戳。

#### Scenario: 包连续性错误或 IG 段不完整

- **WHEN** 包连续性错误或 IG 段不完整
- **THEN** 报告 PID、偏移及错误，不将不完整 Display Set 标记为有效

### Requirement: 菜单场景与无损资源

系统 SHALL 提取页面、BOG、按钮状态及命令、对象、调色板、动画和时间信息，并输出可追溯的无损图形。

#### Scenario: 同一对象使用两个调色板

- **WHEN** 同一对象使用两个调色板
- **THEN** 输出各自正确颜色及透明度的资源，并保留对象到资源映射

### Requirement: 异常与未知效果

系统 SHALL 检测无效 RLE、缺失对象和不支持的效果并输出诊断。

#### Scenario: 对象分片缺失或尺寸与解码结果不符

- **WHEN** 对象分片缺失或尺寸与解码结果不符
- **THEN** 报告错误而不产生看似完整的场景
