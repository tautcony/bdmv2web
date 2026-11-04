# Proposal

## Why

IGS 的按钮、BOG、版本与时间关系决定交互语义，截图或 PGS 字幕提取不能替代菜单解码。

## What Changes

- 实现分层有界 M2TS/TS/PES/IG 重组、PTS 时间域和缺包失效。
- 解析 ICS/PDS/ODS、RLE/颜色/透明度、版本与分片，输出无损 PNG 和来源映射。
- 保留多页/BOG/按钮/三态/动画/效果/命令，接入 extract 并交给 M3/M4。
- 前置依赖：establish-core-contracts、parse-bdmv-structure。可基于稳定契约先开发，集成验收须等待相应上游结果。
- 范围保持首期 HDMV；BD-J 仅识别和保留扩展槽，不实施解密、Java 执行或输出后台服务。

## Capabilities

### New Capabilities

- `interactive-graphics-extraction`：交互图形与菜单场景。

### Modified Capabilities

无；当前尚无已发布主规格。

## Impact

packages/m2ts-demux、igs-decoder 及 scene 归一化；不负责 PGS、VM 或视频解码。

## Acceptance Boundary

跨边界/版本/双 palette 图形与独立像素 golden 一致；缺片、RLE越界、超尺寸及未知效果不会生成伪完整场景。

详细行为见本 change 规格，设计/任务采用 [共享实施基线](../IMPLEMENTATION_BASELINE.md)；OpenSpec 格式校验不等于产品测试已通过。
