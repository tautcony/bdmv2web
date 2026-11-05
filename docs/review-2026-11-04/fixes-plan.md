# 修复计划（已执行）

> 决策来源: [`decisions.md`](./decisions.md) · 逐条进度见 [`fix-checklist.md`](./fix-checklist.md)
> 状态: **原修复批次已执行，2026-11-05 后续推进仍在进行**。可执行 INFO 项与 CI 接入进度见 [`fix-checklist.md`](./fix-checklist.md)，原批次划分保留作为历史记录。

## 原修复批次结果（2026-11-05）

| 批次 | 计划 | 实际 | 结论 |
| --- | --- | --- | --- |
| A（9 条） | A1–A9 | 9 条全部完成 | 解析层 3 条 + CLI 6 条，无对外契约变更 |
| B（3 条） | B1–B3 | 3 条全部完成 | B2 与 builder 的 `status` 参数化同批合入，没有出现"report 说 complete、manifest 说 partial"的中间态 |
| C（2 条 + 1 挂起） | C1、C3；C2 挂起 | C1、C3 完成；C2 只做文档动作 | `docs/browser-matrix.md` 记录 letterbox 限制，代码未动 |
| D（3 条） | D1–D3 | D2、D3 完成；D1 部分完成 | 三包 timeout 已落地；GitHub Actions 已接入，等待首次运行与连续稳定证据 |
| 观察项（7 条） | 不在本批 | 额外做了 `P2-INFO-4`（死代码） | 删除 `PLAYER_PROFILE_KEYS` / `reportedStatus`，其余 6 条不动 |

当时记录的门禁口径：`bdmv-parser` 47 → 69、`test-runner` 50 → 51、`runtime-web` 92 → 93、`cli` 28 → 33，全量 **461 passed / 1 skipped**（原 451 / 1）。本轮另跑 build 与 typecheck；新增回归测试和远端 CI 首次结果尚未完成。

## 执行前提

每批开工前必须满足：

1. 该批涉及的决策条款已写进 spec（清单见 [`decisions.md`](./decisions.md)）。
2. B2 的判定规则（`decisions.ts`）与 builder 的 `status` 参数化必须同批合入——只改一半会出现"report 说 complete、manifest 说 partial"的中间态。

## 批次划分

### Batch A — 确定缺陷（8 条 + 1 条顺带，不改对外契约）

| 顺序 | Finding | 涉及文件 | 决策依据 | 验证方式 |
| --- | --- | --- | --- | --- |
| A1 | `P1-P1-1` 可选 UHD 元数据失败降级为 warning | `bdmv-parser/src/parser.ts`、`parser.test.ts:388-401` | — | 改测例为"entries 仍为 2 + warning"；`bdmv-parser` 65 用例 |
| A2 | `P2-P2-2` 未知选项报错 | `apps/cli/src/index.ts` | — | `--stric` / `--ou` 断言 `CLI_UNKNOWN_OPTION` + exit 1 + 不建目录 |
| A3 | `P2-P2-1` `validate` 先校验 `--format` 再写报告 | `apps/cli/src/index.ts:450-524` | — | 缺值失败后三份报告字节不变 |
| A4 | `P2-P2-5` 失败 `report.json` 与成功同 schema | `apps/cli/src/index.ts:365-376` | — | 三条失败用例断言完整字段集 |
| A5 | `P1-P2-1` 扩展区上界改用文件长度 | `parser.ts:80-90` | **D-3** | `length` 少报仍可解析 + warning；真实样本结果不变 |
| A6 | `P1-P2-2` CLPI 长度不自洽降级 | `parser.ts:267-270,278-289` | **D-3** | `seqLen<2` / `tsTypeLength<5` 两分支不再丢整条 CLPI |
| A7（顺带） | `P2-INFO-3` `extract` 先判 fatal 再跑 IGS | `apps/cli/src/index.ts:144-148` | **D-9** | 失败场景断言 IGS 未被调用 |
| A8 | `P2-P2-6` `dependency-audit.json` 与 stdout 同源 | `apps/cli/src/index.ts:454-461,501` | **D-12** | 无静态 payload 的包：磁盘与 stdout 的 `checks` 相等 |
| A9 | `P2-P2-7` 失败包 mode 不再静默回落 | `apps/cli/src/index.ts:463-466,472` | **D-13** | 失败包四处 `mode === "menu-only"`，`modeSource === "report"` |

A1/A5/A6 只动 `bdmv-parser`，可独立并行；A2/A3/A4/A7/A8/A9 只动 `apps/cli`。两组互不依赖。`apps/cli` 内部 A3（参数校验前移）与 A8/A9（同一 `validate()` 的写盘顺序与 mode 解析）应串行：A3 → A8 → A9，避免三处改同一段代码互相挡。

### Batch B — 状态语义（3 条，决策已定）

| 顺序 | Finding | 决策结论 | 涉及文件 |
| --- | --- | --- | --- |
| B1 | `P2-INFO-2` 阶段失败字段名 | **D-5**：统一 `stageStatus`，spec `:30` 同步 | `index.ts:105`、`spec.md:30`、README、3 条 CLI 用例 |
| B2 | `P2-P2-3` convert 状态恒 partial + 三处结论源 | **D-2（已修订）**：菜单生成即 `complete`；只有失败证据阻断，`not-verified` 不阻断 | `index.ts:432-445`、`decisions.ts:99-123`、`release-summary.ts:63-93`、`package-builder/src/index.ts:14,103,145,229`、`index.test.ts:59-79` |
| B3 | `P2-P2-4` profile 校验与 PSR 规则对齐 | **D-11**：复用 `profileWord`，报 `CLI_INVALID_PROFILE` | `index.ts:71-79` vs `hdmv/src/registers.ts:45-49` |

依赖：B2 的 spec 改动是**新增澄清**，不再推翻 `spec.md:58,68`——它们本来就是对的，是实现偏离了 spec。B1 依赖 B2 的字段语义。B3 独立。

**B2 有两处与上一版相反的结论**：

- `package-builder/src/index.ts:229` 的 `always **partial**` 文案**必须改**（上一版说不用改，已作废）。
- `spec.md:58,68` **不要改**（上一版说要改成"恒 partial"，已作废）。

### Batch C — 运行时可用性（2 条 + 1 条挂起）

| 顺序 | Finding | 决策依据 | 涉及文件 |
| --- | --- | --- | --- |
| C1 | `P3-P2-1` 关键提示不自动消失 | — | `runtime-web/src/browser.ts:157,160,164-165` |
| C2（挂起） | `P3-P2-2` video/canvas letterbox 一致性 | **D-4：挂起，无案例不处理** | 触发后才动 `package-builder/src/index.ts:208-209`、`runtime-web/src/index.ts:54-60` |
| C3 | `P3-INFO-1` 清理 `disc-title` 死代码 | **D-8**：删除，标题只留 `<title>` | `browser.ts:98-99`、两侧测试断言 |

C2 本轮只做文档动作（`docs/browser-matrix.md` 已知限制），代码不动。触发条件与首选方案见 [`decisions.md`](./decisions.md)。

### Batch D — 门禁稳定与测试补强（3 条）

| 顺序 | Finding | 决策依据 | 涉及文件 |
| --- | --- | --- | --- |
| D1 | `P4-P2-1` 显式 `testTimeout` | **D-6**：仅 3 个包设 15000ms | `apps/cli`、`media-export`、`runtime-web` 的 `vitest.config.ts` |
| D2 | `P1-INFO-3` 真实 UHD 的 0x24 断言 | — | `parser.test.ts` |
| D3 | `P1-INFO-1` 0x24 未读位 | **D-7**：只修注释，不扩展模型 | `parser.ts:198-201,309-313` |

D1 需注意：最慢单条（~47s 语料回归）在 `runtime-web` 的 `tamako-headless-navigation.test.ts:214`，该用例已显式 `120_000`，另有两条同类用例（`baja-studio-headless-navigation.test.ts:229`、`hdmv-navigation-corpus-dfs.test.ts:34`）。per-test 值优先，设全局 15000 不会缩短它们；`hdmv` 无实测慢例，不要顺手加配置。上一版写的"47s 在 hdmv"是事实错误，已更正。

### 不在本批（观察项 6 条 + 挂起 1 条）

`P1-INFO-2`、`P3-INFO-2`、`P3-INFO-3`、`P3-INFO-4` 已落实现代码，仍需补回归测试；`P2-INFO-1` 当前无 fatal 级 IGS 生产者，暂缓；`P4-INFO-1` 已新增 GitHub Actions workflow，等待首次运行；`P3-P2-2` 仍按 D-4 挂起。

原列的 `P2-INFO-4`（死代码）在执行时顺手做掉了：`PLAYER_PROFILE_KEYS` 与 `ReleaseSummaryInput.reportedStatus` 删除，`DeliveryDecisionInput.mode` / `StageOutcomeInput.stage` 加"仅记录、不参与判定"注释。

## 建议执行顺序与门禁

- **A（含 A5/A6/A8/A9）→ B** 串行：两批都触及 CLI 输出与状态语义，`apps/cli` 的用例会被改写两轮。
- **A1/A5/A6（解析层）** 与 A2/A3/A4/A7（CLI）可并行，文件不重叠。
- **C、D** 与其他批无依赖，可并行。
- 每批结束：`scripts/ci.sh` 全绿（本机空载口径 **461 passed / 1 skipped**）。
- D1 落地后需连续 3 次全绿才算完成，不能只跑一次。

## 与上一版的差异

| 项 | 上一版 | 现在 |
| --- | --- | --- |
| Finding 总数 | 23 | 25（增补 `P2-P2-6`、`P2-P2-7`） |
| Batch A 规模 | 4 条 | 8 条 + 1 顺带（`P1-P2-1`、`P1-P2-2` 升级，`P2-INFO-3` 顺带，A8/A9 为 2026-11-05 增补） |
| Batch B | 3 条待决策 | 3 条决策已定（D-2R / D-5 / D-11） |
| Batch C | 3 条 | 2 条在列，`P3-P2-2` 挂起（D-4） |
| 观察项 | 10 条 | 7 条 + 1 条挂起 |
