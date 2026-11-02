# Proposal

## Why

菜单按钮和播放链依赖寄存器与机器指令，不能用页面路由代替。

## What Changes

- 建立命令解码、寄存器、对象调用、动作事件协议、支持覆盖检查与可复现 trace。
- 实施前置依赖：establish-core-contracts、parse-bdmv-structure。依赖表示前置 change 的契约和相关验收已完成；允许先基于稳定接口并行开发，但集成及完成验收必须等待前置项。
- 首期只支持 HDMV；BD-J 执行、解密和在线服务均不在范围内。

## Capabilities

### New Capabilities

- `hdmv-navigation`：执行 HDMV 导航语义。

### Modified Capabilities

无。

## Impact

影响转换器、共享契约、测试和离线运行时的相关模块；当前仓库尚无实现。以架构基线的范围和验收约束为准，具体实施见 design 和 tasks。
