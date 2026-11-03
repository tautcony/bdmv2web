# Proposal

## Why

用户需要双击即可操作真实菜单；普通 SPA 加载方式不能直接承担本地文件交付。

## What Changes

- 生成 classic IIFE、安全嵌入 IR/PNG 和无网络 portable 菜单目录。
- 实现 Canvas、坐标/DPI、BOG/三态/动画、键鼠触摸、UO mask、VM 与 WAV 音效。
- 提供统一菜单产物、明确 unavailable 媒体反馈与首次手势恢复；M5 接入系统默认程序打开影片。
- 前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation。可基于稳定契约先开发，集成验收须等待相应上游结果。
- 范围保持首期 HDMV；BD-J 仅识别和保留扩展槽，不实施解密、Java 执行或输出后台服务。

## Capabilities

### New Capabilities

- `offline-menu-runtime`：离线菜单运行时。

### Modified Capabilities

无；当前尚无已发布主规格。

## Impact

packages/runtime-web、package-builder、sound 输出、convert 菜单管线；媒体桥允许 M5 替换。

## Acceptance Boundary

file://断网/移动路径后可导航；图形/命中正确，失效回调与被拒播放可处理，影片接入不可用时菜单不挂死，状态如实反映缺口。

详细行为见本 change 规格，设计/任务采用 [共享实施基线](../IMPLEMENTATION_BASELINE.md)；OpenSpec 格式校验不等于产品测试已通过。
