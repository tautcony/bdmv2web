# Design

## Context

仓库目前只有架构基线和 OpenSpec 配置。上游依赖：establish-core-contracts、parse-bdmv-structure。架构基线见仓库根目录 `bdmv_hdmv_offline_web_architecture.md`；具体行为以本 change 的规格为准。

## Goals / Non-Goals

**Goals:** 实现 M2TS/TS/PES 解复用、IG Display Set、ICS/PDS/ODS 和无损场景资源提取。

**Non-Goals:** 不执行 BD-J、破解保护或要求导出物运行后台服务；不把未经验证的功能声明为支持。

## Decisions

以结构解析提供的 PID 和 Clip 映射作为输入，分层重组 192B 包、PES 和跨 PES 的 IG 段；保留 PID、偏移与 PTS。对象和调色板分别建模后生成 RGBA PNG，避免把 PGS 字幕提取当成 IGS 菜单。

共享边界遵循版本化 IR、结构化诊断和来源追踪；上游交付接口与样本，下游负责自己集成时验证接口。实现时依照架构文档核验二进制字段和规范，而非把示意接口当成已验证协议。

## Risks / Trade-offs

- 分片、色彩和特效的组合容易造成误渲染 → 以合成碎片和参考帧比对；未知特效诊断而非静默忽略。
- 浏览器矩阵及媒体支持依赖实际环境 → 记录版本和证据，未验证项目不能作为通过。

## Migration Plan

项目为新建系统，无现有数据迁移；按前置依赖逐步集成，保留兼容的版本化契约。若集成失败，回退对应模块或构建产物，并保留诊断与测试证据。
