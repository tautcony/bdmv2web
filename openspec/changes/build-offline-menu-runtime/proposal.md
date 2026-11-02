# Proposal

## Why

用户需要在无服务器的浏览器中操作真实菜单，图形、输入和导航必须协同。

## What Changes

- 构建 file:// 兼容的菜单运行时、交互渲染、音效及 menu-only 打包；真实影片导出由后续 change 完成。
- 实施前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation。依赖表示前置 change 的契约和相关验收已完成；允许先基于稳定接口并行开发，但集成及完成验收必须等待前置项。
- 首期只支持 HDMV；BD-J 执行、解密和在线服务均不在范围内。

## Capabilities

### New Capabilities

- `offline-menu-runtime`：构建离线菜单运行时。

### Modified Capabilities

无。

## Impact

影响转换器、共享契约、测试和离线运行时的相关模块；当前仓库尚无实现。以架构基线的范围和验收约束为准，具体实施见 design 和 tasks。
