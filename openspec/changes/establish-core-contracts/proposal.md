# Proposal

## Why

项目尚无实现；解析、虚拟机与浏览器需要共同的数据、时间、错误和版本语义。

## What Changes

- 建立 TypeScript 工作区、共享 IR、版本化 schema、诊断、安全二进制读取和可复现测试基础。
- 实施前置依赖：无。依赖表示前置 change 的契约和相关验收已完成；允许先基于稳定接口并行开发，但集成及完成验收必须等待前置项。
- 首期只支持 HDMV；BD-J 执行、解密和在线服务均不在范围内。

## Capabilities

### New Capabilities

- `disc-contracts`：建立共享契约与安全基础。

### Modified Capabilities

无。

## Impact

影响转换器、共享契约、测试和离线运行时的相关模块；当前仓库尚无实现。以架构基线的范围和验收约束为准，具体实施见 design 和 tasks。
