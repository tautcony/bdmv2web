# Spec Delta

## ADDED Requirements

### Requirement: Popup composition classification and playback association

系统 SHALL 保留 IGS composition 的 popup 类型，并将其关联到声明该 IG 流的 clip，以便播放时按 popup 输入呈现覆盖层。

#### Scenario: 提取 popup composition

- **WHEN** IG 流包含 popup composition
- **THEN** 场景结果保留 popup 标志、clip/PID、页面、按钮资源和命令来源，不将其误标为独立静态菜单

#### Scenario: 当前标题打开 popup

- **WHEN** POPUP_MENU 事件发生且该标题 clip 有完整 popup 场景
- **THEN** 在当前影片画面上显示匹配 popup 菜单，保持影片时钟和位置

#### Scenario: popup 关闭

- **WHEN** popup 按钮执行 popup-off 或导航离开当前标题
- **THEN** 移除覆盖层并按导航结果继续，不重置底层影片时间

#### Scenario: popup 场景不可用

- **WHEN** 当前 clip 没有可解析 popup 场景或其必要资源缺失
- **THEN** 报告带 clip 和来源的不可用状态，保留当前影片与菜单输入可用性
