# Design

## Context

仓库目前只有架构基线和 OpenSpec 配置。上游依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation。架构基线见仓库根目录 `bdmv_hdmv_offline_web_architecture.md`；具体行为以本 change 的规格为准。

## Goals / Non-Goals

**Goals:** 构建 file:// 兼容的菜单运行时、交互渲染、音效及 menu-only 打包；真实影片导出由后续 change 完成。

**Non-Goals:** 不执行 BD-J、破解保护或要求导出物运行后台服务；不把未经验证的功能声明为支持。

## Decisions

使用 classic IIFE 脚本和安全内嵌数据，Canvas 按原始坐标绘制，反变换 pointer 命中；动作通过 VM 事件桥接。menu-only 显式把缺失媒体操作标为 unavailable，避免占位实现伪装完整播放。

共享边界遵循版本化 IR、结构化诊断和来源追踪；上游交付接口与样本，下游负责自己集成时验证接口。实现时依照架构文档核验二进制字段和规范，而非把示意接口当成已验证协议。

## Risks / Trade-offs

- 本地图片和媒体策略因浏览器而异 → portable 图集和首次手势启动，并在目标版本验证；不依赖 fetch 或模块脚本。
- 浏览器矩阵及媒体支持依赖实际环境 → 记录版本和证据，未验证项目不能作为通过。

## Migration Plan

项目为新建系统，无现有数据迁移；按前置依赖逐步集成，保留兼容的版本化契约。若集成失败，回退对应模块或构建产物，并保留诊断与测试证据。
