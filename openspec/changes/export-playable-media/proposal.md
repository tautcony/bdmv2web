# Proposal

## Why

菜单仍在离线网页中交互；用户选择影片后，应打开实际 M2TS 文件，由操作系统关联的默认程序播放。完整影片播放不在浏览器中实现。

## What Changes

- 将原 menu-only 与 standalone-full 合并为一个离线菜单产物和 `convert INPUT --out DIR` 入口，不再以模式区分交付。
- 根据结构和导航信息确定影片动作对应的源 M2TS，保留 Playlist、PlayItem、来源、时间范围及无法确定的映射。
- 通过操作系统 URL Protocol 将实际 M2TS 交给 macOS 上的 IINA 或 Windows 上的 PotPlayer。
- 菜单背景与音效仍可在网页中播放；不将影片转码、章节控制、字幕渲染、影片时钟或播放结束反馈作为浏览器功能。
- 前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime。BD-J 仍不实施。

## Capabilities

### New Capabilities

- `offline-media-playback`：从离线菜单交接实际影片文件给默认关联程序。

### Modified Capabilities

无已发布主规格；同步调整 M4 和 M6 的 active delta。

## Impact

CLI、package-builder、runtime 播放动作桥、源文件映射与发布验证。原媒体转码和浏览器影片播放代码属于既有实现，不因本规格修改而自动删除或视为新需求已完成。

## Acceptance Boundary

Chrome 离线菜单通过 macOS/IINA 与 Windows/PotPlayer URL Protocol 打开已映射的 M2TS；真实交接按平台记录测试结果。播放控制与状态由外部播放器处理。
