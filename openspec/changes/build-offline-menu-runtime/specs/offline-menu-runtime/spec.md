# Spec Delta

## Purpose

为离线 BDMV 转换和浏览器运行提供可验证的构建离线菜单运行时能力，明确输入、输出、错误及对下游的可观察行为。

## ADDED Requirements

### Requirement: 无服务器启动

系统 SHALL 生成可通过 file:// 启动的自包含目录，不依赖网络、服务器、原碟或安装运行依赖。

#### Scenario: 移动目录并断网打开 index.html

- **WHEN** 移动目录并断网打开 index.html
- **THEN** 支持版本的浏览器加载脚本和场景，所有引用仍在包内

### Requirement: 交互与视觉状态

系统 SHALL 根据结构化场景呈现按钮状态并按有效性、BOG、UO mask 和导航语义处理键盘及指针输入。

#### Scenario: 窗口 letterbox 缩放后点击有效按钮

- **WHEN** 窗口 letterbox 缩放后点击有效按钮
- **THEN** 命中原始坐标中的按钮并通过 VM 执行其命令

### Requirement: 菜单预览的限制

系统 SHALL 将 menu-only 标为不完整并明确提示不可用的媒体动作。

#### Scenario: 在 menu-only 中激活未打包的播放动作

- **WHEN** 在 menu-only 中激活未打包的播放动作
- **THEN** 显示 unavailable，不宣称完整播放

### Requirement: 播放策略恢复

系统 SHALL 对浏览器拒绝有声播放提供用户手势后的恢复路径。

#### Scenario: 自动播放被拒绝

- **WHEN** 自动播放被拒绝
- **THEN** 显示可操作的开始提示并在手势后继续
