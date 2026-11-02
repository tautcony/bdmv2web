# Design

## Context

仓库目前只有架构基线和 OpenSpec 配置。上游依赖：establish-core-contracts、parse-bdmv-structure。架构基线见仓库根目录 `bdmv_hdmv_offline_web_architecture.md`；具体行为以本 change 的规格为准。

## Goals / Non-Goals

**Goals:** 建立命令解码、寄存器、对象调用、动作事件协议、支持覆盖检查与可复现 trace。

**Non-Goals:** 不执行 BD-J、破解保护或要求导出物运行后台服务；不把未经验证的功能声明为支持。

## Decisions

同一解码器处理 MovieObject 与按钮命令；执行器与媒体、场景通过 Action/Event 异步桥接。对未支持命令保留原始字节并报错；替代方案是将按钮编译为硬编码 JS，但不能保留条件及恢复语义。

共享边界遵循版本化 IR、结构化诊断和来源追踪；上游交付接口与样本，下游负责自己集成时验证接口。实现时依照架构文档核验二进制字段和规范，而非把示意接口当成已验证协议。

## Risks / Trade-offs

- 公开材料不能保证完整操作码语义 → 建立逐项覆盖表和参考轨迹，未经核验的操作不声明支持。
- 浏览器矩阵及媒体支持依赖实际环境 → 记录版本和证据，未验证项目不能作为通过。

## Migration Plan

项目为新建系统，无现有数据迁移；按前置依赖逐步集成，保留兼容的版本化契约。若集成失败，回退对应模块或构建产物，并保留诊断与测试证据。
