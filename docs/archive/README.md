# 归档文档

本目录收录历史记录：设计类方案与审查类评审/审计。日常实现、文档工作和代码评审不以这些内容为依据；只在任务需要历史语境或用户明确要求时阅读。当前行为以[现状类文档](../README.md)为准，每篇记录的定位另见其文首声明。

## 设计

| 文档 | 日期 | 状态 |
|---|---|---|
| [bdmv_hdmv_offline_web_architecture.md](design/bdmv_hdmv_offline_web_architecture.md) | 2026-11-02 | 初版技术设计方案；拟议命令、接口和包结构与当前实现不一致，当前能力以 support 矩阵为准 |

## 审查

| 记录 | 范围 | 状态 |
|---|---|---|
| [readiness-review-2026-11-02.md](reviews/readiness-review-2026-11-02.md) | 实施前开发充分性评估 | 实施前方案；影片交接与产物模式已调整，现行边界以实施基线为准 |
| [code-review.md](reviews/code-review.md) | 第一轮全仓代码评审（基线 614b4fe） | 结论已被 D-2 决策修订与单词命令重构取代 |
| [review-2026-11-04](reviews/review-2026-11-04/index.md) | 第二轮 diff 复审，25 条 finding | 修复完成：17 完成、6 部分、1 挂起、1 未开始 |
| [review-2026-11-06-daily](reviews/review-2026-11-06-daily/index.md) | 当日 16 提交批次审查，16 条 finding | P1/P2 全部修复，遗留 6 条 INFO |
| [review-2026-11-06-hdmv-vm-conformance](reviews/review-2026-11-06-hdmv-vm-conformance/index.md) | HDMV VM 逐指令一致性审计（对照 libbluray 1.5.0 与 libhdmv 2026-03） | VM-01~08 已修复；当前 VM 行为以 hdmv-support.md 为准 |
| [review-2026-11-07-over-defensive-audit](reviews/review-2026-11-07-over-defensive-audit/index.md) | 过度防御与辩解式内容审计 | 含 §7 修正记录（已修正/保留/未复现三分类） |
