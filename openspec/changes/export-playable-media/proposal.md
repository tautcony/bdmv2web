# Proposal

## Why

离线网页提供菜单交互，并在用户选择影片时请求系统关联程序打开实际 M2TS 文件。

## What Changes

- `convert INPUT --out DIR` 当前生成一种离线菜单产物；manifest、report 和 stdout 不记录产物模式。
- 根据结构和导航信息确定影片动作对应的源 M2TS，保留 Playlist、PlayItem、来源、时间范围及无法确定的映射。
- 通过操作系统 URL Protocol 请求打开实际 M2TS；当前实现按平台选择 IINA 或 PotPlayer 协议。
- 菜单背景与音效在网页中播放；影片由系统 URL Protocol 交给外部播放器。网页不承诺正片播放控制、章节/字幕渲染、影片时钟或外部播放状态回传。
- 当前边界：只维护实际菜单包、菜单媒体导出、源 M2TS 映射和外部播放器交接。BD-J 仍不实施。

## Capabilities

### New Capabilities

- `offline-media-playback`：从离线菜单交接实际影片文件给默认关联程序。

### Modified Capabilities

`offline-media-playback`：追加影片映射、菜单媒体和外部播放器交接要求。

## Impact

CLI、package-builder、runtime 播放动作分发、源文件映射与发布验证。

## Acceptance Boundary

离线菜单按已声明的 BDMV STREAM 目标构造 URL Protocol 请求，并由纯函数、模拟浏览器事件与离线包审计验证路径编码、时间参数、目标约束与请求结果分类（`requested` / `unavailable` / `unknown`）。外部程序是否打开、是否播放、是否跳转不作为验收条件，也不产生回传状态。播放控制与状态由外部播放器处理。
