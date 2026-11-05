# Code Review Index（第二轮 · diff 复审）

> 日期: 2026-11-04
> 范围: `614b4fe..9b86daa`（6 个提交，48 个代码文件，+1142 / -184）
> 结论: 第 1 批（D1/D2/D4/D10）已落地且门禁空载全绿；但"状态由事实决定"未真正成立，且解析层新增的"可选 UHD 元数据失败即 fatal"会让一张可播的盘完全不可解析。**修复轮及后续推进（2026-11-05）已完成 17 条，6 条部分完成，1 条挂起，1 条 INFO 观察项暂缓**，详见 [`fix-checklist.md`](./fix-checklist.md)。
> 决策与执行: 2026-11-05 确认 4 组待决问题（[`decisions.md`](./decisions.md)）；随后已按决策落地修复，并继续推进可执行 INFO 项。D-2 于 09:35 修订为「生成菜单即 `complete`」，09:40 补充「`not fully verified` 不算阻碍项」。
> 勘误: 2026-11-05 修正 5 处事实/统计问题，并增补 2 条漏检（`P2-P2-6`、`P2-P2-7`），见文末「勘误（2026-11-05）」。

## 从这里开始

1. 只想了解风险 → 读 [`summary.md`](./summary.md)
2. 需要知道"为什么这么定" → 读 [`decisions.md`](./decisions.md)
3. 准备修问题 → 从 [`fix-checklist.md`](./fix-checklist.md) 勾具体 finding，按 [`fixes-plan.md`](./fixes-plan.md) 排批次
4. 需要核对证据 → 进 [`phases/`](./phases/) 对应 phase
5. 需要核验审查过程 → 读 [`agent-findings.md`](./agent-findings.md)（含 7 条被驳回的候选）

## 当前状态

> 2026-11-05 修复轮及后续推进后更新，逐条证据见 [`fix-checklist.md`](./fix-checklist.md)。

- P0: 0 / P1: 1 / P2: 12 / INFO: 12
- 已完成: **17**（P1-P1-1、P1-P2-1、P1-P2-2、P2-P2-1~7、P3-P2-1、P1-INFO-1/3、P2-INFO-2/3/4、P3-INFO-1）
- 部分完成: **6**（`P4-P2-1`、`P1-INFO-2`、`P3-INFO-2`、`P3-INFO-3`、`P3-INFO-4`、`P4-INFO-1`；实现已落地，仍缺回归测试 / 首次 CI 证据）
- 挂起（条件触发）: **1**（`P3-P2-2`，无比例不等的样本；D-4 要求有样本后再处理）
- 未开始: **1**（`P2-INFO-1`：目前没有 fatal 级 IGS 诊断生产者，暂时没有可触发案例）
- 决策已实现: 4 组（`P1-P2-1`、`P1-P2-2`、`P2-P2-3`、`P2-INFO-2`）+ 2 条默认假设（D-12 `P2-P2-6`、D-13 `P2-P2-7`）全部落地
- D-2R 验收结果: baja `convert` → `complete`（exit 0），`validate --strict` → `complete`（exit 0，12 项 `notVerified` 不阻断）；tamako `convert` → `partial`（37 条 error），`validate --strict` → exit 2

## 优先处理

| Finding | 级别 | 状态 | 问题 | 证据 |
| --- | --- | --- | --- | --- |
| [P1-P1-1](./phases/phase-1-format-parsing.md) | P1 | [x] | 可选 UHD 元数据解析失败 → index fatal、`entries` 为空 | 已改为 `optionalSection` + warning，`entries` 保留 |
| [P2-P2-2](./phases/phase-2-cli-status.md) | P2 | [x] | 未知/拼错选项静默忽略（`--stric`、`--ou`） | `commandOptions` + `validateCommandLine` |
| [P2-P2-1](./phases/phase-2-cli-status.md) | P2 | [x] | `validate` 在参数校验前改写三份报告 | 参数期先解析 `--format`，失败零写盘 |
| [P2-P2-3](./phases/phase-2-cli-status.md) | P2 | [x] | `convert`/`validate` 状态恒 partial + 三处结论源（D-2R） | 失败证据才阻断，缺证据进 `notVerified` |
| [P3-P2-1](./phases/phase-3-runtime-packaging.md) | P2 | [x] | 关键行动提示 4.5s 消失、不可复制 | `persist` + `.is-persistent` 可选中 |
| [P2-P2-6](./phases/phase-2-cli-status.md) | P2 | [x] | `dependency-audit.json` 落盘与 stdout 不一致 | 先算 summary 再写，三份产物同源 |
| [P2-P2-7](./phases/phase-2-cli-status.md) | P2 | [x] | 失败包 mode 静默回落 `standalone-full` | manifest → report → `PACKAGE_MODE_ASSUMED` |

> D-2R 验收标准：对 `test-data/bdmv/[BDMV][アニメ][1710XX] バジャのスタジオ`（完整 BDMV，STREAM 齐全），`convert` 与随后的 `validate --offline` 都应输出 `complete`。反例：`tamako-love-story-bd` 缺 37 个 STREAM，必须仍是 `partial`。

其余 P2：[`P2-P2-4`](./phases/phase-2-cli-status.md)（profile 错误码，D-11）、[`P2-P2-5`](./phases/phase-2-cli-status.md)（失败 report schema）、[`P1-P2-1`](./phases/phase-1-format-parsing.md) / [`P1-P2-2`](./phases/phase-1-format-parsing.md)（比参考实现更严格，D-3 已定放宽）、[`P3-P2-2`](./phases/phase-3-runtime-packaging.md)（letterbox 错位，**挂起** D-4）、[`P4-P2-1`](./phases/phase-4-verification.md)（5s 超时假失败，D-6）。

## 文档地图

| 文档 | 用途 | 何时阅读 |
| --- | --- | --- |
| [`summary.md`](./summary.md) | 结论、统计、跨模块问题、差异化反证复盘 | 首次阅读 |
| [`fix-checklist.md`](./fix-checklist.md) | 每个 finding 的修复进度主记录（25 节） | 修复期间持续更新 |
| [`decisions.md`](./decisions.md) | 4 组用户决策 + 8 条默认假设，含 spec 修订清单 | 动手前先读 |
| [`fixes-plan.md`](./fixes-plan.md) | 4 个批次（17 条）+ 1 条挂起 + 7 条观察项，候选排期（本轮不执行） | 规划迭代 |
| [`phases/`](./phases/) | 代码证据、触发条件、漏检复盘、未覆盖区域 | 核对具体问题 |
| [`agent-findings.md`](./agent-findings.md) | 34 条候选的采纳/合并/驳回记录 | 审计 review 过程 |

## Phase 导航

- [Phase 0: Baseline](./phases/phase-0-baseline.md)
- [Phase 1: 二进制格式解析](./phases/phase-1-format-parsing.md) — 1 P1 / 2 P2 / 3 INFO
- [Phase 2: CLI 与交付状态链](./phases/phase-2-cli-status.md) — 7 P2 / 4 INFO
- [Phase 3: 浏览器运行时与菜单包产出](./phases/phase-3-runtime-packaging.md) — 2 P2 / 4 INFO
- [Phase 4: 验证与门禁](./phases/phase-4-verification.md) — 1 P2 / 1 INFO

## 门禁口径

GitHub Actions 已通过 [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) 接入 `scripts/ci.sh`，触发条件为 master push、pull request 和手动运行；首次远端运行结果待回填。

```text
corepack pnpm -r build                     → exit 0（11 包全部 Done）
corepack pnpm -r typecheck                 → exit 0（error TS 0）
corepack pnpm -r --no-bail test            → 空载 exit 0，461 passed / 1 skipped
bash scripts/ci.sh                         → 文档记录 exit 0，2m32s（install 0s / contracts 1s / build 14s / typecheck 19s / test 117s）；本轮未重跑
```

门禁脚本与根脚本统一改用 `corepack pnpm`：`package.json` 里的 `packageManager: pnpm@11.25.0` 由此生效，嵌套调用（`build` = `generate:contracts` + `-r build`）不再依赖全局 `pnpm`，也不需要 pnpm shim。

高负载并行时同一命令出现 2 条 CLI 超时 + 1 条 media-export 失败，空载重跑全绿（见 [Phase 4](./phases/phase-4-verification.md)）。该假失败已由 `P4-P2-1` 的三包 `testTimeout: 15000` 消除。

## 勘误（2026-11-05）

| 项 | 原表述 | 更正 |
| --- | --- | --- |
| 参考实现缓存 | Phase 1 把 `extdata_parse.c` 列为已审查文件，并称它"同样忽略 handler 返回值" | 缓存内**没有**该文件，也没有 `bdmv_parse_extension_data` 的定义，只有三处调用点（`index_parse.c:285` 等）。已改为"上游实现，本地缓存未包含"并写入限制。`index_parse.c:284-289` 的主证据仍成立，P1 结论不变 |
| `P4-P2-1` | "47s 导航回归在 `hdmv`"、"各包无显式 `testTimeout`" | 47s 在 `runtime-web` 的 `tamako-headless-navigation.test.ts:214`，且该用例已显式 `120_000`；另两条语料用例同样带 `120_000`（`baja-studio-headless-navigation.test.ts:229`、`hdmv-navigation-corpus-dfs.test.ts:34`）。D-6 与 D1 的"不碰 hdmv"理由作废，已重写 |
| `P3-P2-1` | `browser.ts:145` = 外部播放不可用 | `:145` 是 `SET_BUTTON_PAGE` 缺 packed 操作数的警告；`unavailable` 分支在 `:157` |
| 统计 | 未开始 15 + 观察项 8 + 挂起 1 = 24（与 23 条 finding 不符） | 当时 checklist 实为 **16 条批次 + 7 条观察项 = 23**；增补 A8/A9 后为 **17 条批次 + 1 条挂起 + 7 条观察项 = 25**。旧口径把挂起项同时算进"未开始"和"挂起"，观察项也多算 1 |
| 候选数 | 一处写 28，一处写 32 | **34**：31 条来自 3 个独立 agent + 1 条主 agent 门禁实测 + 2 条用户复扫（AF-33/34） |

新增 finding 的证据与修复方向见 [Phase 2](./phases/phase-2-cli-status.md)：`P2-P2-6`（落盘报告与 stdout 不同源）、`P2-P2-7`（失败包 mode 回落）。

## 限制

- 未在真实浏览器 / 真实碟片上回归；`file://` 验收仍为未验证。
- 未在 GitHub runner 首次执行新接入的 workflow；本机可用 `corepack pnpm` 跑通门禁（修复轮已把脚本与根脚本从裸 `pnpm` 改为 `corepack pnpm`）。
- 未做 I/O 故障注入，未验证并发 `convert` 竞态。
- MPLS 0x24 属性字节数只能依据参考实现与样本推断，本地白皮书无位级语法。
- 参考实现缓存不完整：缺 `extdata_parse.c`（`bdmv_parse_extension_data` 的实现）。INDX 扩展布局与"上游忽略 handler 返回值"只能依据样本字节与调用点推断，凡涉及该函数的结论都不算逐行核对。
- 本轮只审 `614b4fe..9b86daa` 的差异，上一轮已登记但本轮未触碰的问题仍见 [`openspec/changes/REVIEW_BACKLOG.md`](../../openspec/changes/REVIEW_BACKLOG.md)。
