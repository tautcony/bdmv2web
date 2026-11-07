# 文档索引

按用途查找项目文档。项目行为与阶段验收以 [OpenSpec 规格](../openspec/specs/) 和对应变更记录为准。

文档分三类：

- **现状类**描述当前行为、支持边界与开发流程，随代码更新，是日常工作入口。
- **设计类**记录早期技术方案，拟议内容可能与当前实现不一致。
- **审查类**记录历次评审与审计的结论和修复过程。

设计类与审查类收录于 [archive/](archive/README.md)，只用于历史语境，不作为当前行为的依据；各篇状态见文首声明与归档清单。

## 现状类

### 使用与开发

- [开发指南](guides/development.md)：工具链、CLI、测试和构建流程。
- [发布指南](guides/release.md)：npm 包名、版本与 tag、发布工作流和一次性配置。
- [llm-wiki](llm-wiki/README.md)：面向 LLM/agent 的工程知识索引——任务路由、包/功能/诊断/排查文档与机器可读 `index.json`。
- [开发参考索引](references/README.md)：固定版本参考实现、规范入口、许可与 [M0–M6 阶段资料](references/stages/)。

### 能力与支持范围

- [协议支持矩阵](support/protocol-support.md)：BDMV 结构解析（M1）的支持边界和证据。
- [HDMV 支持](support/hdmv-support.md)：指令、虚拟机行为和支持状态。
- [IGS 支持](support/igs-support.md)：场景提取、图像处理和已知边界。

## 历史记录

### 设计

- [BDMV/HDMV 离线 Web 架构方案（2026-11-02）](archive/design/bdmv_hdmv_offline_web_architecture.md)：初版技术设计与组件关系，含未实现的设计名和早期包结构。

### 审查

- [2026-11-02 开发充分性评估](archive/reviews/readiness-review-2026-11-02.md)：实施前方案评审与缺口补齐记录。
- [第一轮全仓代码评审](archive/reviews/code-review.md)：分模块评审结论与 D1–D13 决策表。
- [2026-11-04 第二轮 diff 复审](archive/reviews/review-2026-11-04/index.md)：25 条 finding 的阶段记录、决策与修复清单。
- [2026-11-06 提交批次审查](archive/reviews/review-2026-11-06-daily/index.md)：当日 16 提交的批次审查与修复记录。
- [2026-11-06 HDMV VM 一致性审计](archive/reviews/review-2026-11-06-hdmv-vm-conformance/index.md)：对照 libbluray/libhdmv 的逐指令核对、运行模型差异与修复顺序。
- [2026-11-07 过度防御与辩解式内容审计](archive/reviews/review-2026-11-07-over-defensive-audit/index.md)：源码死防御、吞错与文档辩解残留的逐条清单。
- [归档清单](archive/README.md)：以上记录的范围与状态一览。
