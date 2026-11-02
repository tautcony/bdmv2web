# Proposal

## Why

必须从真实入口和引用关系确定可执行导航与媒体，而不能按文件名猜测。

## What Changes

- 识别 BDMV 和 BACKUP，解析 index、MovieObject、MPLS、CLPI 与 sound，形成有来源的引用图与 inspect/extract 输出。
- 实施前置依赖：establish-core-contracts。依赖表示前置 change 的契约和相关验收已完成；允许先基于稳定接口并行开发，但集成及完成验收必须等待前置项。
- 首期只支持 HDMV；BD-J 执行、解密和在线服务均不在范围内。

## Capabilities

### New Capabilities

- `bdmv-disc-inspection`：解析碟片结构与入口。

### Modified Capabilities

无。

## Impact

影响转换器、共享契约、测试和离线运行时的相关模块；当前仓库尚无实现。以架构基线的范围和验收约束为准，具体实施见 design 和 tasks。
