# Proposal

## Why

菜单语义依赖 IGS 中的按钮、对象、调色板和时间信息，静态截图无法表达。

## What Changes

- 实现 M2TS/TS/PES 解复用、IG Display Set、ICS/PDS/ODS 和无损场景资源提取。
- 实施前置依赖：establish-core-contracts、parse-bdmv-structure。依赖表示前置 change 的契约和相关验收已完成；允许先基于稳定接口并行开发，但集成及完成验收必须等待前置项。
- 首期只支持 HDMV；BD-J 执行、解密和在线服务均不在范围内。

## Capabilities

### New Capabilities

- `interactive-graphics-extraction`：提取交互图形与菜单场景。

### Modified Capabilities

无。

## Impact

影响转换器、共享契约、测试和离线运行时的相关模块；当前仓库尚无实现。以架构基线的范围和验收约束为准，具体实施见 design 和 tasks。
