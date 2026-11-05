# 代码审查汇总（第二轮 · diff 复审）

> 日期: 2026-11-04
> 范围: `614b4fe..9b86daa`（6 个提交，48 个代码文件，+1142 / -184）
> Phase 数: 5（baseline + 解析层 + CLI 状态链 + 运行时与产出 + 验证门禁）
> 审查方式: 并行 sub agent（解析层 / CLI 状态链 / 运行时与产出），主 agent 负责范围、证据核验、去重与严重度
> 上一轮: [`docs/code-review.md`](../code-review.md)（D1–D13 决策表）
> **修复轮（2026-11-05）**: 本文件是审查当时的结论快照，保留不动；已修/未修状态见 [`fix-checklist.md`](./fix-checklist.md)，批次执行结果见 [`fixes-plan.md`](./fixes-plan.md)。25 条中 17 条已修完、1 条部分完成、1 条挂起、6 条 INFO 观察项不动。

## 统计

- P0: 0
- P1: 1
- P2: 12
- INFO: 12

## 一句话结论

**第 1 批（D1/D2/D4/D10）确实落地了**：门禁空载全绿（build/typecheck 通过，451 passed / 1 skipped），fatal 不再成功退出，`dist/` 不再含测试产物；**但"状态由事实决定"还没真正成立**——`convert` 的交付状态由"没有提供 checks"决定，同一份包里并存三个结论源；**解析层新增的"可选元数据解析失败即 fatal"是本轮最值得修的风险**：一个 UHD HDR 字段损坏就能让整张盘不可解析。

## 高优先级问题

### [P1-P1-1] 可选 UHD 元数据解析失败会把整个 index 升级为 fatal

INDX AppInfo / UHD 3.1 扩展解析抛错后，`parseIndex` 整体失败；BACKUP 若为同字节副本则记为 `fatal BDMV_REQUIRED_FILE_MISSING`，`entries` 变空。参考实现 `index_parse.c:284-289` 调用扩展解析后**不检查返回值**，只把主 index section 当致命（`extdata_parse.c` 的定义不在本地缓存，未逐行核对，见 [index.md 的勘误](./index.md)）。更糟的是 `parser.test.ts:388-401` 把"entries 长度为 0"写成了期望值，等于把该行为固化为契约。

修法很局部：把 AppInfo/UHD 解析包成"内部 catch → 返回 null + warning 诊断"，index 主 section 保持 critical。详见 [Phase 1](./phases/phase-1-format-parsing.md)。

## 各 Phase 摘要

- **Phase 0**: 基线、改动面、门禁实测；本轮最容易漏的五类风险已提前声明。
- **Phase 1（解析层）**: 新增字段布局与 libbluray 逐项核对，位对齐/越界无新问题；问题集中在**错误策略**（可选元数据 → fatal）与**比参考实现更严格**（扩展/CLPI 长度上界）。1 P1、2 P2、3 INFO。
- **Phase 2（CLI 状态链）**: D10 的核心行为正确（fatal 不提交、strict 只改接受策略、`report.json` 不进审计载荷）；但 `validate` 在参数校验前改写报告、未知选项静默忽略、`convert` 状态恒定 partial、profile 校验与 PSR 规则不一致。**2026-11-05 复扫增补两条**：`dependency-audit.json` 落盘与 stdout 不同源（`P2-P2-6`）、失败包 mode 静默回落（`P2-P2-7`）。7 P2、4 INFO。
- **Phase 3（运行时与产出）**: profile 穿透链路完整、无注入风险；两处可用性回归（关键提示 4.5s 消失、`contain` 导致按钮与背景可能错位）+ 一处死代码被测试固化。2 P2、4 INFO。
- **Phase 4（验证门禁）**: build/typecheck 绿、空载全量测试 451 passed / 1 skipped；但默认 5s 超时使重用例在负载下假失败（本次已复现）。1 P2、1 INFO。

## 跨模块问题

1. **`status` 语义在 5 处载体上未收敛**：CLI stdout（阶段失败用 `status`、阶段成功用 `stageStatus`）、`manifest.status`（builder 硬编码 `partial`）、`report.json.status`（decision）、`compatibility.status`（builder 初始 `partial`，validate 再覆盖）、`reports/release-summary.json`。今天数值恰好一致，但它们由三条不同代码路径各自写入。这与上一轮 D9 的教训同源：**字段存在 ≠ 有唯一权威来源**。
2. **"严格性"策略不统一**：解析层新增的硬校验大多直接抛错并升级为诊断 error/fatal，而参考实现普遍是"容忍 + 记录"。上一轮登记表 X1（HEVC 属性长度）的思路是"需要样本才改"，本轮反过来在没有样本的情况下新增了若干硬校验——方向相反，需要一条统一原则：**无法从参考实现确认的字段，默认降级为诊断而非失败**。
3. **门禁可信度仍然依赖空闲机器**：5s 默认超时让 CLI 的 5–6s 用例在负载下假失败。47s 语料回归在 `runtime-web`，已自带 `120_000`，不是假失败来源；真正缺的是给 `apps/cli` / `media-export` 兜底的全局值。D1 修好了"红灯能看见"，还没解决"红灯是否真实"。
4. **同一命令开始出现两套事实**：`validate` 先写 `dependency-audit.json`（中间态），再算 `releaseSummary`（注入 `DEPENDENCY_AUDIT_REQUIRED`），导致落盘文件与 stdout/summary 结论不同（`P2-P2-6`）。这与第 1 条同源——**只要同一事实有多个写入点，就一定会漂移**。

## 差异化反证复盘

按漏检模式横向扫过一遍（不沿 phase 顺序）：

- **默认分支 / 交互协议闭合**：CLI 命令分发、选项白名单、`--flag=` 空值、index object type、扩展 entry 未知 type、MPLS playbackType 非 2/3。→ 新增 `P2-P2-2`（未知选项静默）、`P2-INFO-2`（失败对象字段名）。
- **异步失败 / 超时 / 取消 / 幂等**：`staging → report → commit`、`commit` 失败清理、`abort` 可达性、`validate` 写前校验、toast 定时器。→ 新增 `P2-P2-1`。
- **状态写入顺序 / 半提交 / 重建窗口**：`report.json` 写在 commit 前（正确）、失败包不含 manifest（不会被误认为完成）。→ 当时判"未新增"，2026-11-05 复扫补出 `P2-P2-7`：不会被当成完成，但下游会把形态读成 `standalone-full`。
- **渲染 / 导出 / 编码 / 时间 / 摘要**：菜单页全屏布局、canvas letterbox 与 video letterbox 的一致性、`disc-title`、`serializeSafeScriptData`、`payloadFingerprint` 覆盖面。→ 新增 `P3-P2-2`、`P3-INFO-1`、`P3-INFO-3`。
- **高杠杆工具函数**：`lookupOption`（值以 `--` 开头）、`profileWord`（长度/ASCII）、`classifyDiagnostics`（severity 大小写）。→ 新增 `P2-P2-4`；`classifyDiagnostics` 对大小写做了 `toLowerCase()`，无问题。

本轮复盘新增发现：**4 条**——复盘阶段 2 条（`P3-P2-2`、`P3-INFO-3`），2026-11-05 用户独立复扫 2 条（`P2-P2-6`、`P2-P2-7`）。

## 修复跟踪

- 逐 finding 的 checklist: [`fix-checklist.md`](./fix-checklist.md)（25 条，P1 1 / P2 12 / INFO 12）
- 决策记录: [`decisions.md`](./decisions.md)（2026-11-05：4 组用户决策 + 8 条默认假设）
- 批次与顺序: [`fixes-plan.md`](./fixes-plan.md)（候选排期，本轮不执行）
- 未完成: 25；批次内: 17（A 9 / B 3 / C 2 / D 3）+ 挂起 1（`P3-P2-2`）；观察项: 7

## Sub Agent 核验摘要

- 候选: 34（31 条来自 3 个独立 agent，1 条由主 agent 门禁实测补充，2 条由用户复扫补充）
- 形成 finding: 25（P1 1、P2 12、INFO 12；其中 23 条可追溯到 AF 行，`P3-INFO-3`、`P4-INFO-1` 由主 agent 跨模块复核补充）
- 合并: 2 条 AF → 1 条 finding（AF-02、AF-03 → `P1-P2-1`）；AF-24 并入 `P3-INFO-1` 的漏检复盘，不单独成条
- 驳回/降级为观察项: 7（其中 2 条是 agent 结论与参考实现不符，已逐字节复核）
- P0/P1 双人核验: 已完成（`P1-P1-1` 主 agent 复读代码 + agent 提供 libbluray 对照）

## 未覆盖区域

- 真实浏览器 / 真实碟片回归；`file://` 验收仍为未验证（与本轮改动无关，manifest limitations 已注明）。
- 未在干净容器验证 `scripts/ci.sh`（修复轮已把根脚本与门禁脚本从裸 `pnpm` 改为 `corepack pnpm`，本机已可跑通，不再需要 pnpm shim；容器内仍需 `corepack enable` 或预装 pnpm）。
- 未注入 I/O 故障（report 写失败、rename 失败）；未验证并发两次 `convert` 的竞态。
- MPLS 0x24 的属性字节数在本地白皮书中无位级语法，只能依据参考实现与样本推断。
