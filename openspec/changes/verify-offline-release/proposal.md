# Proposal

## Why

生成文件不能证明路径完整、无外部依赖或 V1 Chrome 环境中的实际可用性，需要独立审计及可复查证据。

## What Changes

- 实现输出包独立 validate、文件引用/URL/脚本依赖审计及完整度/strict 决策。
- 建立有分母的支持统计、VM/IG 独立参考对照和安全回归。
- V1 在 Google Chrome 执行直接 `file://` 及当前产品边界内的适用场景，记录 Chrome 完整版本、profile、mode、生成媒体清单、矩阵和环境后形成发布摘要；不按操作系统限定验收范围。
- 验收以当前 parser、IGS、HDMV、菜单运行时及系统播放器交接实现为准；未验证项明确保留。
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
