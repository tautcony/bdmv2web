# Proposal

## Why

导航依赖寄存器、条件执行和恢复上下文，硬编码按钮页面动作无法复现行为。

## What Changes

- 统一解码 MovieObject 和按钮12字节记录，建立逐编码支持/证据矩阵。
- 实现寄存器/PC/条件/Jump/Call/Resume/系统动作及有界异步状态机。
- 输出确定性 trace 和保留 unknown 的导航图，供运行时与媒体分析消费。
- 前置依赖：establish-core-contracts、parse-bdmv-structure。可基于稳定契约先开发，集成验收须等待相应上游结果。
- 范围保持首期 HDMV；BD-J 仅识别和保留扩展槽，不实施解密、Java 执行或输出后台服务。

## Capabilities

### New Capabilities

- `hdmv-navigation`：HDMV 导航语义。

### Modified Capabilities

无；当前尚无已发布主规格。

## Impact

packages/navigation-hdmv、导航分析及支持文档；不依赖 DOM/视频，M2 按钮通过同一接口追加。

## Acceptance Boundary

支持项逐条有依据和正反例；模拟桥可验证成功/失败/旧回信、恢复一次、循环终止及参考轨迹。

详细行为见本 change 规格，设计/任务采用 [共享实施基线](../IMPLEMENTATION_BASELINE.md)；OpenSpec 格式校验不等于产品测试已通过。
