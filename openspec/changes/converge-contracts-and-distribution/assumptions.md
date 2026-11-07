# 待确认假设

本 change 的任务把评审文档里标 `⚠需确认` 的若干问题按**一个具体假设**推进了。这份清单把它们单独列出：每条给出"假设值 / 依据 / 若判断相反要改什么"。

处理规则同第 1 批（[`restore-build-gate-and-delivery-status/assumptions.md`](../restore-build-gate-and-delivery-status/assumptions.md)）：假设不成立不阻塞开工，反选后改对应任务并标"已改判"。

## 状态总览

| 编号 | 假设 | 关联任务 | 反选成本 | 状态 |
| --- | --- | --- | --- | --- |
| R2-1 | `maxCallDepth` 以 core 的 128 为准，64/256 是随手写的 | A.1–A.4 | 低（改派生源为 hdmv 的 64/256 或保留两份并写明关系） | 按本 change 的单一契约决策执行；hdmv 默认值现已从 core 派生 |
| R2-2 | `CALL_TITLE` 的恢复路径 | C.3、C.4 | 中 | 已按当前实现修订：VM 暂停并发出 `TITLE_SEARCH`，浏览器调用 `selectTitle()` 恢复；不要求另造桥端 `responseTo` 回执 |
| R2-3 | `SourceRef.path` 统一为"相对 BDMV 根"，不带 `BDMV/` 前缀 | D.4、D.5 | 中（改 parser 输出 + 全链路断言 + golden） | 待确认 |
| R2-4 | `loop=false` 结束语义 | E.2、E.5 | 中（新增等待语义与 UI 约定） | 当前代码回 `MEDIA_ENDED`，不引入 `MEDIA_HELD`；需保留实际播放器验收缺口 |
| R2-5 | `@bdmv2web/package-builder` 会随 CLI 发布，必须解耦源码路径 | F.1–F.4 | 中（若确定永不发布，可退化为 `files` 白名单 + 文档声明） | 待确认 |
| R2-6 | 正片交接路线 | 不在本 change 实现 | 低 | 已由用户确认：继续使用系统播放器交接；浏览器内正片播放不属于当前路线 |
| R2-7 | `内容摘要字段` 的导出函数一并删除（不仅是字段） | B.1 | 低（从 git 历史恢复该函数） | 已实施；不是待确认假设 |

---

## R2-1 `maxCallDepth` 的真实限制值

**假设**：以 `core` 的 `DEFAULT_LIMITS` 为准（`maxCallDepth 128` / `maxQueueDepth 1024`），`hdmv` 的私有 `DEFAULTS`（64/256）改为派生引用。

**依据**：
- `core` 的 `Limits` 是**公开契约**（被 `validateLimits` / `assertWithinLimit` 使用、出现在基线 §5 的工程初值表里）；`hdmv` 的 `DEFAULTS` 是私有常量。
- `maxInstructionsPerTurn` 两边都是 `10_000`，说明 `hdmv` 的 `DEFAULTS` 是从 core 抄来的，只改了两个深度值。

**若判断相反**（64/256 是为防某类碟爆栈调小的实测值）：采用"core 的 128 是契约上限，hdmv 的 64/256 是运行时安全下限"，两值并存但名字区分（`DEFAULT_LIMITS` vs `RUNTIME_SAFE_LIMITS`），并在 A.4 的漂移锁里断言"运行时值 ≤ 契约值"。两个 `DEFAULTS` 数值不同是本 change 要消除的状态。

64/256 的来历未在仓库中记录。按本假设执行，并在 `docs/support/hdmv-support.md` 注明运行时值为保守取值。

---

## R2-2 `CALL_TITLE` 的响应路径

**当前实现**：`CALL_TITLE` 保存标题调用上下文并挂起 VM，发出 `TITLE_SEARCH` 动作；浏览器入口消费该动作并直接调用 `selectTitle()`。这是当前代码采用的恢复路径。

**依据**：`responseTo` 是事件信封里已有的契约（其它 action 都靠它关联），新增一条"直接调用"路径会让同一类事件有两种投递方式。

**未完成点**：需要验证目标 unavailable/BD-J/错误路径如何恢复并留下诊断；任务不再要求为标题选择重复增加一套 `responseTo` 桥接语义。

---

## R2-3 `SourceRef.path` 的前缀约定

**假设**：相对 BDMV 根，`PLAYLIST/00001.mpls`，**不带** `BDMV/` 前缀。

**依据**：基线 §2 原文即如此；`bdmv-io` 的 containment 判定也以 BDMV 根为基准。`BDMV/` 前缀只在用户可见输出文案里出现。

**若判断相反**（要带 `BDMV/` 前缀）：D.4 改为锁定"带前缀"，并同步改 `bdmv-io` 的 `within()` 判定基准与全部既有断言。成本高于反向。

> 这条是纯粹的"选一个"，但必须选。当前 parser 与 CLI 两种写法混用，正是 D12 的根因之一。

---

## R2-4 `loop=false` 的结束语义

**假设**：单 PlayItem 非循环背景播放结束后回 `MEDIA_ENDED`，VM 从等待恢复；画面是否停在末帧由渲染层自然结果决定，**不引入** `MEDIA_HELD` 状态。

**依据**：`MEDIA_HELD` 需要新的等待语义（"永远不返回"或"返回但保持"）与 UI 约定，属新能力；当前首要是让 VM 不永久 suspended。

**若判断相反**（产品要求显式"停留最后一帧"状态）：E.2 增加 `MEDIA_HELD` 的等待与恢复规则，E.5 的文档条目改写，并需要同步 `hdmv-navigation` 的 spec delta。这是一个可独立成 change 的扩展。

---

## R2-5 `package-builder` 是否对外发布

**假设**：会随 `apps/cli` 一起被安装/发布，因此必须解耦对 `runtime-web/src/browser.ts` 与 `hdmv/src/index.ts` 的源码路径依赖。

**依据**：`apps/cli` 有 `bin: bdmv2web` 且依赖 `package-builder`；`package-builder` 自身既无 `private: true` 也无 `files` 白名单。CLI 一旦可安装，builder 必然被带上，`src/` 若不在发布清单内则构建期必然失败。

**若判断相反**（确定永不对外安装，只在本仓库内跑）：F.1–F.3 可降级为"仅在 `README` 声明本包不独立发布 + 给 `files` 白名单"，省掉 `build:browser` 与 esbuild 依赖。但 `npm pack` / 未来的发布路径仍会踩坑。

---

## R2-6 正片交接路线

**决策**：继续使用系统播放器交接。浏览器内正片播放不属于当前路线。

**依据**：当前 convert 生成一个菜单包，正片映射至源 M2TS 并通过 URL Protocol 请求系统播放器。

旧的“长期做、近期不做”措辞已过时；相关浏览器播放能力从本 change 任务范围移除。

---

## R2-7 `内容摘要字段` 的删除范围

**已实施**：产物/报告/类型中的内容摘要字段和无调用方的导出函数均已删除。

**依据**：仓库内无其它调用方（实测仅 `index.ts` 定义与 `index.test.ts` 使用）。导出函数同样表达校验能力的存在，因此与字段一并删除；需要时从 git 历史恢复。

该假设已结案。
