# Fixes Plan

返回 [index](index.md) · 逐项步骤见 [fix-checklist.md](fix-checklist.md)。

## 批次 1：当日新引入的 P1 回归

| ID | 影响 | 复杂度 | 验证 |
| --- | --- | --- | --- |
| P1-2 | CLI 对窄输入类盘从响亮失败变为静默吞播放列表 | 低（快照一行 + fallback 语义决策） | apps/cli vitest + 新回归测试 |
| P1-1 | HdmvVm 公共 API 在挂起期转移后状态回退 | 中（需 libbluray 挂起语义背书） | packages/hdmv vitest + 新回归测试 |

顺序：先 P1-2（无行为基线依赖），再 P1-1（先读 `hdmv_vm.c` 确认基线再改）。

## 批次 2：hdmv VM 剩余行为缺陷

P2-1（fault 销毁 continuation）→ P2-2（TOP_MENU 重入）→ P2-3（unsupportedOperation 状态）。
三项共用一次 libbluray 源码复核（`hdmv_vm.c` `_hdmv_step`/fault、`bluray.c` `bd_menu_call`），逐项实现、逐项回归。每项修复后运行 packages/hdmv 全套测试，防止行为断言连锁变化。

## 批次 3：igs 与 CLI 提取链

P2-4（ICS limits）→ P2-5（PesAssembler.end 接线）→ P2-6（PGS 缓存偏移）→ P2-8（effects 诊断一致性）→ P2-7（scenes.json schema 决策）→ P2-9（端到端测试补充，最后做，覆盖批次 1 修复后的最终行为）。

## 批次 4：runtime-web 与 package-builder

P2-12（监听器泄漏，最小改动）→ P2-10（bridge 选择）→ P2-11（MARK 映射，跨 package-builder 与 runtime-web）→ P2-13（manifest 清洗路径）→ P2-14（恢复路径重试）。

## 收尾

- 全量 `pnpm -r test`（或各包 vitest）记录结果
- 更新 fix-checklist 终态与 summary 统计
- 差异化反证复盘：修复是否引入新的默认分支缺失、半完成窗口、监听器泄漏、协议字段错配

## 决策点（需要时向维护者确认）

- P1-2 fallback 语义：硬失败 vs 保留 fallback
- P2-7：schemaVersion 升级 vs manifest 声明
- P2-8：manifest limitation 更新 vs 恢复 warning 诊断
- INFO-3：片头 playlist 合成 MEDIA_ENDED 的忠实性取舍
