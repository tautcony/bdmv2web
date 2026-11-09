# Proposal

## Why

生成文件不能证明路径完整或无外部依赖，需要独立审计及可复查证据。

## What Changes

- 实现输出包独立 validate、文件引用/URL/脚本依赖审计及完整度/strict 决策。
- 建立有分母的支持统计、VM/IG 独立参考对照和安全回归。
- 在当前产品边界内执行菜单启动、导航、音效与影片请求的自动化验收，记录 profile、生成媒体清单和矩阵后形成发布摘要。
- 验收以当前 parser、IGS、HDMV、菜单运行时及协议目标构造实现为准；未验证项明确保留。
- 范围保持首期 HDMV；BD-J 仅识别和保留扩展槽，不实施解密、Java 执行或输出后台服务。

## Capabilities

### New Capabilities

- `offline-delivery-assurance`：离线交付验证。

### Modified Capabilities

无；当前尚无已发布主规格。

## Impact

packages/test-runner、CLI validate/compare、reports 和发布清单；参考工具只用于开发验收。

## Acceptance Boundary

缺资源、非法外部引用与阻断诊断为 failed；可达但未支持的能力为 partial。`complete` 表示无已知交付失败证据，未执行或不可观察的检查进入 `notVerified` 且不改变状态。检查结果聚合优先级为 `fail > not-verified > pass`。外部播放器的实机打开与人工音画观察不属于验收项。

详细行为见本 change 规格，设计/任务采用 [共享实施基线](../IMPLEMENTATION_BASELINE.md)；OpenSpec 格式校验不等于产品测试已通过。
