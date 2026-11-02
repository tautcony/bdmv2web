# Proposal

## Why

各模块缺少统一数据和错误语义会使解析、VM 与浏览器无法可靠交接；当前仓库尚无实现。

## What Changes

- 建立固定工具链的 TypeScript/pnpm 工作区、CLI 骨架、测试与 fixture 入口。
- 定义版本化 IR、来源/资产/诊断 schema、精确时间及动作事件信封。
- 提供有界 Cursor/流式读取、路径隔离、事务输出和可追踪内容指纹。
- 前置依赖：无。可基于稳定契约先开发，集成验收须等待相应上游结果。
- 范围保持首期 HDMV；BD-J 仅识别和保留扩展槽，不实施解密、Java 执行或输出后台服务。

## Capabilities

### New Capabilities

- `disc-contracts`：共享契约与安全基础。

### Modified Capabilities

无；当前尚无已发布主规格。

## Impact

packages/core、bdmv-io、test-fixtures、apps/cli 及根构建配置；core 保持浏览器可用，不依赖 Node/DOM。

## Acceptance Boundary

下游可以消费最小 HDMV/混合入口样本；非法版本、时间、引用、越界/逃逸及中断均有明确结果。

详细行为见本 change 规格，设计/任务采用 [共享实施基线](../IMPLEMENTATION_BASELINE.md)；OpenSpec 格式校验不等于产品测试已通过。
