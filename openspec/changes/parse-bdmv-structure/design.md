# Design

## Context

仓库目前只有架构基线和 OpenSpec 配置。上游依赖：establish-core-contracts。架构基线见仓库根目录 `bdmv_hdmv_offline_web_architecture.md`；具体行为以本 change 的规格为准。

## Goals / Non-Goals

**Goals:** 识别 BDMV 和 BACKUP，解析 index、MovieObject、MPLS、CLPI 与 sound，形成有来源的引用图与 inspect/extract 输出。

**Non-Goals:** 不执行 BD-J、破解保护或要求导出物运行后台服务；不把未经验证的功能声明为支持。

## Decisions

分离发现、二进制解析和引用图；主文件失效时采用明确的同类 BACKUP 规则并记录来源，保留不可达声明。MovieObject 保留 12 字节指令原文供 VM 解码；不以文件排序猜测入口。

共享边界遵循版本化 IR、结构化诊断和来源追踪；上游交付接口与样本，下游负责自己集成时验证接口。实现时依照架构文档核验二进制字段和规范，而非把示意接口当成已验证协议。

## Risks / Trade-offs

- 版本和私有扩展可能无法解析 → 记录源偏移和不支持版本，不将未知字段假设为有效。
- 浏览器矩阵及媒体支持依赖实际环境 → 记录版本和证据，未验证项目不能作为通过。

## Migration Plan

项目为新建系统，无现有数据迁移；按前置依赖逐步集成，保留兼容的版本化契约。若集成失败，回退对应模块或构建产物，并保留诊断与测试证据。
