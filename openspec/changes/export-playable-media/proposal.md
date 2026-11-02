# Proposal

## Why

菜单播放、章节和返回必须由包内真实媒体完成，只有图形预览不足以交付完整行为。

## What Changes

- 合并结构/命令/按钮导航图，保守计算媒体闭包并先输出预算/媒体计划。
- 转换阶段导出经校验 H.264/AAC MP4、本地音轨变体和普通 PGS 位图层。
- 建立双向 TimelineMap，接入章节/seek/暂停/still/pop-up/结束反馈和 standalone-full。
- 前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime。可基于稳定契约先开发，集成验收须等待相应上游结果。
- 范围保持首期 HDMV；BD-J 仅识别和保留扩展槽，不实施解密、Java 执行或输出后台服务。

## Capabilities

### New Capabilities

- `offline-media-playback`：离线媒体与播放时间轴。

### Modified Capabilities

无；当前尚无已发布主规格。

## Impact

packages/media-export、媒体闭包/时间表、runtime MediaController；转换机需要 FFmpeg/FFprobe，输出包不需要。

## Acceptance Boundary

两 PlayItem/章节映射数值可核对，切轨/字幕/菜单返回闭环；高级或未验证能力保持 partial，最终 complete 等待 M6 证据。

详细行为见本 change 规格，设计/任务采用 [共享实施基线](../IMPLEMENTATION_BASELINE.md)；OpenSpec 格式校验不等于产品测试已通过。
