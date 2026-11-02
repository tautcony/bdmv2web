# Design

## Context

仓库目前只有架构基线和 OpenSpec 配置。上游依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime。架构基线见仓库根目录 `bdmv_hdmv_offline_web_architecture.md`；具体行为以本 change 的规格为准。

## Goals / Non-Goals

**Goals:** 分析可达播放路径，离线转码媒体、映射 90 kHz 时间、处理章节和运行时播放反馈，并实现 standalone-full。

**Non-Goals:** 不执行 BD-J、破解保护或要求导出物运行后台服务；不把未经验证的功能声明为支持。

## Decisions

转换阶段以参数数组调用 FFmpeg/FFprobe，按路径预合成或按分支切段，生成 H.264/AAC MP4 和 MediaTimelineMap；运行时使用本地 video/currentTime 驱动事件。选择本地媒体变体处理支持的音轨，不能假定 audioTracks 通用。

共享边界遵循版本化 IR、结构化诊断和来源追踪；上游交付接口与样本，下游负责自己集成时验证接口。实现时依照架构文档核验二进制字段和规范，而非把示意接口当成已验证协议。

## Risks / Trade-offs

- 无缝分支、复杂字幕和多音轨并非所有浏览器可等效 → 按路径检测并明确报告降级，严格模式禁止误报 complete。
- 浏览器矩阵及媒体支持依赖实际环境 → 记录版本和证据，未验证项目不能作为通过。

## Migration Plan

项目为新建系统，无现有数据迁移；按前置依赖逐步集成，保留兼容的版本化契约。若集成失败，回退对应模块或构建产物，并保留诊断与测试证据。
