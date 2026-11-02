# Proposal

## Why

仅凭生成文件不能证明导航完整、无网络依赖或浏览器实际兼容。

## What Changes

- 统一 validate、完整度判定、资源和依赖审计、差分对照、浏览器矩阵及发布证据。
- 实施前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime、export-playable-media。依赖表示前置 change 的契约和相关验收已完成；允许先基于稳定接口并行开发，但集成及完成验收必须等待前置项。
- 首期只支持 HDMV；BD-J 执行、解密和在线服务均不在范围内。

## Capabilities

### New Capabilities

- `offline-delivery-assurance`：验证离线交付并判定发布状态。

### Modified Capabilities

无。

## Impact

影响转换器、共享契约、测试和离线运行时的相关模块；当前仓库尚无实现。以架构基线的范围和验收约束为准，具体实施见 design 和 tasks。
