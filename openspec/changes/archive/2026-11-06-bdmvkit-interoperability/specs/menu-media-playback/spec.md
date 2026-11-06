# Spec Delta

## Purpose

保持 HDMV 菜单视频背景的导航时间与画面时间一致，包括 mark 驱动的循环、暂停和恢复。

## ADDED Requirements

### Requirement: 运动菜单 mark 循环

系统 SHALL 按菜单 MovieObject 与 Playlist Mark 的目标时间重播运动背景，并维持菜单媒体时间映射。

#### Scenario: 指定 loop point 的第二轮播放

- **WHEN** 运动菜单首轮播放结束并由导航指令从循环 mark 继续
- **THEN** 媒体从该 mark 对应的背景时间开始，而不是从片段开头或任意位置开始

#### Scenario: mark 时间无法映射

- **WHEN** 循环 mark 缺失、超出播放片段或没有对应媒体映射
- **THEN** 报告来源明确的不可用诊断并保持菜单交互可用，不谎报媒体已从目标点启动

#### Scenario: 暂停后恢复循环

- **WHEN** 用户在循环背景播放期间暂停并恢复
- **THEN** 菜单媒体时钟、导航动作和后续循环点仍对应同一播放时间线
