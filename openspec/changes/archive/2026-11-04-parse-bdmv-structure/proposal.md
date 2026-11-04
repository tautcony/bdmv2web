# Proposal

## Why

必须从真实入口与文件声明建立导航/媒体基础，按文件名猜菜单会遗漏标题和播放资源。

## What Changes

- 实现目录识别、整文件 BACKUP 回退和准确来源记录。
- 解析 index/MOBJ/MPLS/CLPI/sound，保留原始命令、轨道/章节/高级特性及结构引用图。
- 提供 inspect/extract 的结构输出及支持预测，明确动态命令边仍待下游分析。
- 前置依赖：establish-core-contracts。可基于稳定契约先开发，集成验收须等待相应上游结果。
- 范围保持首期 HDMV；BD-J 仅识别和保留扩展槽，不实施解密、Java 执行或输出后台服务。

## Capabilities

### New Capabilities

- `bdmv-disc-inspection`：碟片结构与入口。

### Modified Capabilities

无；当前尚无已发布主规格。

## Impact

packages/bdmv-parser、ir-builder 结构图、CLI inspect/extract；将 ParsedDisc/raw 命令交给 M2/M3。

## Acceptance Boundary

入口及主备组合、两 PlayItem/章节、混合 BD-J、未知版本/缺引用等 fixture 的字段、偏移与诊断可核对。

详细行为见本 change 规格，设计/任务采用 [共享实施基线](../IMPLEMENTATION_BASELINE.md)；OpenSpec 格式校验不等于产品测试已通过。
