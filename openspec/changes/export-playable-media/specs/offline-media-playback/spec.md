# Spec Delta

## Purpose

为离线 BDMV 转换和浏览器运行提供可验证的导出可播放媒体并同步时间轴能力，明确输入、输出、错误及对下游的可观察行为。

## ADDED Requirements

### Requirement: 可达媒体导出

系统 SHALL 在 standalone-full 导出所有可达且需要的受支持播放媒体，并将引用限制在输出目录。

#### Scenario: 可达播放路径包含多个 PlayItem

- **WHEN** 可达播放路径包含多个 PlayItem
- **THEN** 生成本地可播放片段或合成文件及每段映射，不引用原盘

### Requirement: 统一时间与反馈

系统 SHALL 显式映射源时间、播放列表时间和导出媒体时间，并向导航反馈播放、章节、seek、结束及错误事件。

#### Scenario: seek 到跨 PlayItem 的章节

- **WHEN** seek 到跨 PlayItem 的章节
- **THEN** 恢复正确的逻辑时间、菜单状态和 VM 播放上下文

### Requirement: 媒体能力与不支持项

系统 SHALL 对声明支持的音轨及图形字幕提供同步选择，对无法等效的可达能力报告影响和降级。

#### Scenario: 可达分支要求未支持的无缝切换或字幕

- **WHEN** 可达分支要求未支持的无缝切换或字幕
- **THEN** 在报告中列出受影响路径，strict 模式不得标记 complete

### Requirement: 动态交互同步

系统 SHALL 在播放、暂停、seek 和媒体切换时按当前时间重建菜单、动画、still 和 pop-up 状态。

#### Scenario: seek 或切换媒体后旧异步回调到达

- **WHEN** seek 或切换媒体后旧异步回调到达
- **THEN** 丢弃过期回调并保持当前场景与播放状态一致
