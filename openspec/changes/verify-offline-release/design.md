# Design

## Context

仓库目前只有架构基线和 OpenSpec 配置。上游依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime、export-playable-media。架构基线见仓库根目录 `bdmv_hdmv_offline_web_architecture.md`；具体行为以本 change 的规格为准。

## Goals / Non-Goals

**Goals:** 统一 validate、完整度判定、资源和依赖审计、差分对照、浏览器矩阵及发布证据。

**Non-Goals:** 不执行 BD-J、破解保护或要求导出物运行后台服务；不把未经验证的功能声明为支持。

## Decisions

将 schema、可达指令、媒体和资源哈希检查汇总为 complete/partial/failed，严格模式对未认可错误失败。使用 URL 解析检查 HTML/CSS/脚本数据而非简单 grep；浏览器矩阵记录实际版本与证据，参考工具只在开发时使用。

共享边界遵循版本化 IR、结构化诊断和来源追踪；上游交付接口与样本，下游负责自己集成时验证接口。实现时依照架构文档核验二进制字段和规范，而非把示意接口当成已验证协议。

## Risks / Trade-offs

- 平台和合规样本不可用会形成验收盲区 → 明确记录未验证项，阻止 complete；不以单机结果代替矩阵。
- 浏览器矩阵及媒体支持依赖实际环境 → 记录版本和证据，未验证项目不能作为通过。

## Migration Plan

项目为新建系统，无现有数据迁移；按前置依赖逐步集成，保留兼容的版本化契约。若集成失败，回退对应模块或构建产物，并保留诊断与测试证据。
