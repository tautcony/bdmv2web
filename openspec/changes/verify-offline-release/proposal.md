# Proposal

## Why

生成文件不能证明路径完整、无外部依赖或跨浏览器兼容，需要独立审计及可复查证据。

## What Changes

- 实现输出包独立 validate、hash/引用/URL/脚本依赖审计及完整度/strict 决策。
- 建立有分母的支持统计、VM/IG 独立参考对照和安全回归。
- 执行实际浏览器版本矩阵及 A–J 适用场景，绑定制品指纹后形成发布摘要。
- 前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime、export-playable-media。可基于稳定契约先开发，集成验收须等待相应上游结果。
- 范围保持首期 HDMV；BD-J 仅识别和保留扩展槽，不实施解密、Java 执行或输出后台服务。

## Capabilities

### New Capabilities

- `offline-delivery-assurance`：离线交付验证。

### Modified Capabilities

无；当前尚无已发布主规格。

## Impact

packages/test-runner、CLI validate/compare、reports 和发布清单；参考工具只用于开发验收。

## Acceptance Boundary

缺资源/外部引用为 failed，能力/证据缺口为 partial；只有完整资源行为与全部声明证据通过才 complete。

详细行为见本 change 规格，设计/任务采用 [共享实施基线](../IMPLEMENTATION_BASELINE.md)；OpenSpec 格式校验不等于产品测试已通过。
