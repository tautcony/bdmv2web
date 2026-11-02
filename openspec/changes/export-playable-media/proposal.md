# Proposal

## Why

完整交付必须覆盖可达影片及其时间驱动菜单，不能仅提供菜单截图或预览。

## What Changes

- 分析可达播放路径，离线转码媒体、映射 90 kHz 时间、处理章节和运行时播放反馈，并实现 standalone-full。
- 实施前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime。依赖表示前置 change 的契约和相关验收已完成；允许先基于稳定接口并行开发，但集成及完成验收必须等待前置项。
- 首期只支持 HDMV；BD-J 执行、解密和在线服务均不在范围内。

## Capabilities

### New Capabilities

- `offline-media-playback`：导出可播放媒体并同步时间轴。

### Modified Capabilities

无。

## Impact

影响转换器、共享契约、测试和离线运行时的相关模块；当前仓库尚无实现。以架构基线的范围和验收约束为准，具体实施见 design 和 tasks。
