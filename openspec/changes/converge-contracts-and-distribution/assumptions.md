# 待确认假设

本 change 的任务把评审文档里标 `⚠需确认` 的若干问题按**一个具体假设**推进了。这份清单把它们单独列出：每条给出"假设值 / 依据 / 若判断相反要改什么"。

处理规则同第 1 批（[`restore-build-gate-and-delivery-status/assumptions.md`](../restore-build-gate-and-delivery-status/assumptions.md)）：假设不成立不阻塞开工，反选后改对应任务并标"已改判"。

## 状态总览

| 编号 | 假设 | 关联任务 | 反选成本 | 状态 |
| --- | --- | --- | --- | --- |
| R2-1 | `maxCallDepth` 以 core 的 128 为准，64/256 是随手写的 | A.1–A.4 | 低（改派生源为 hdmv 的 64/256 或保留两份并写明关系） | 待确认 |
| R2-2 | `CALL_TITLE` 走 `responseTo` 的 continuation，不改为运行时直接 `selectTitle` | C.3、C.4 | 中（改 VM 与两个桥的接口） | 待确认 |
| R2-3 | `SourceRef.path` 统一为"相对 BDMV 根"，不带 `BDMV/` 前缀 | D.4、D.5 | 中（改 parser 输出 + 全链路断言 + golden） | 待确认 |
| R2-4 | `loop=false` 结束时回 `MEDIA_ENDED`，不引入 `MEDIA_HELD` | E.2、E.5 | 中（新增等待语义与 UI 约定） | 待确认 |
| R2-5 | `@bdmv2web/package-builder` 会随 CLI 发布，必须解耦源码路径 | F.1–F.4 | 中（若确定永不发布，可退化为 `files` 白名单 + 文档声明） | 待确认 |
| R2-6 | `standalone-full` 长期做、近期不做 | 不在本 change 实现 | 低（若近期要做，需单独立项） | 待确认 |
| R2-7 | `payloadFingerprint` 的导出函数一并删除（不仅是字段） | B.1 | 低（从 git 历史恢复该函数） | 待确认 |

---

## R2-1 `maxCallDepth` 的真实限制值

**假设**：以 `core` 的 `DEFAULT_LIMITS` 为准（`maxCallDepth 128` / `maxQueueDepth 1024`），`hdmv` 的私有 `DEFAULTS`（64/256）改为派生引用。

**依据**：
- `core` 的 `Limits` 是**公开契约**（被 `validateLimits` / `assertWithinLimit` 使用、出现在基线 §5 的工程初值表里）；`hdmv` 的 `DEFAULTS` 是私有常量。
- `maxInstructionsPerTurn` 两边都是 `10_000`，说明 `hdmv` 的 `DEFAULTS` 是从 core 抄来的，只改了两个深度值。

**若判断相反**（64/256 是当年为防某类碟爆栈调小的实测值）：改为"core 的 128 是契约上限，hdmv 的 64/256 是运行时安全下限"，两值并存但必须有名字区分（如 `DEFAULT_LIMITS` vs `RUNTIME_SAFE_LIMITS`），并在 A.4 的漂移锁里断言"运行时值 ≤ 契约值"。**不能让两个 `DEFAULTS` 都叫默认值而数值不同**——那正是本 change 要消除的病。

> 只有你知道 64/256 的来历。若记不清，按假设执行并在 `docs/hdmv-support.md` 留一句"运行时值为保守取值，非协议限制"。

---

## R2-2 `CALL_TITLE` 的响应路径

**假设**：`CALL_TITLE` 建立 `{ actionId, generation, waitFor: "started" }` 的 continuation，桥的 `started` / `unavailable` 都按 `responseTo` 恢复；不改 `PreviewPlaybackBridge` 的语义为"运行时直接调 `selectTitle()`"。

**依据**：`responseTo` 是事件信封里已有的契约（其它 action 都靠它关联），新增一条"直接调用"路径会让同一类事件有两种投递方式。

**若判断相反**（直接调用更贴近真实播放器）：C.3 改为 VM 内部同步调用 `selectTitle()` 并立刻恢复，C.4 退化为"桥不需要改"。风险是 `CALL_TITLE` 的失败路径（`MEDIA_UNAVAILABLE`）失去回执通道，只能靠 VM 自己的返回码——需要额外定义。

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

## R2-6 `standalone-full` 的路线

**假设**：长期做、近期不做。本 change 不实现，只在 CLI 侧拒绝并给出明确错误码。

**依据**：当前 `menu-only` 尚未做成可靠可用；先扩形态会把不确定项叠在一起。

**若判断相反**（近期必须交付全盘转换）：需要独立 change，涉及正片播放交接、Playlist 编排、外部播放器依赖，与本 change 的"一致性"主题不同。

---

## R2-7 `payloadFingerprint` 的删除范围

**假设**：不仅删除产物/报告/类型里的字段，也删除 `packages/bdmv-io/src/index.ts:124-147` 的导出函数 `payloadFingerprint()`。

**依据**：仓库内无其它调用方（实测仅 `index.ts` 定义与 `index.test.ts` 使用）。一个能算出哈希的导出函数同样是"承诺"——保留它会让人以为校验能力还在，将来做 A 方案时从 git 历史恢复即可。

**若判断相反**（保留函数作为工具）：B.1 只删字段与写入点，函数保留但在 JSDoc 注明"当前无调用方，不参与任何校验"。风险是下一个人会重新把它接回产物，再次制造"有字段但恒 null"。
