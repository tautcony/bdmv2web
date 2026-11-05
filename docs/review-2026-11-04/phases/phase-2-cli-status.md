# Phase 2 审查报告: CLI 与交付状态链

> 日期: 2026-11-04
> 文件数: 5（`apps/cli/src/index.ts`、`index.test.ts`、`test-runner/src/{decisions,types,package-audit}.ts`）+ `package-builder` 的 manifest 写入
> 发现: P0(0) / P1(0) / P2(7) / INFO(4)
> 导航: [返回 review index](../index.md) | [查看修复 checklist](../fix-checklist.md)

## 已审查文件

- `apps/cli/src/index.ts`（`lookupOption`/`optionValue`/`rawOptionValue`、`strictDefault`、`loadPlayerProfile`、`inspect`、`extract`、`convert`、`validate`、`main`）
- `apps/cli/src/index.test.ts`（新增 147 行）
- `packages/test-runner/src/decisions.ts`（`StageStatus` brand、`classifyDiagnostics`、`decideStageOutcome`、`decideDelivery`）
- `packages/test-runner/src/types.ts`（`DeliveryStatus` brand）、`src/package-audit.ts`（`REPORT_FILES` 增加 `report.json`）
- 规范: `openspec/specs/cli-delivery-status/spec.md`、`openspec/changes/IMPLEMENTATION_BASELINE.md`

## 已实测通过的检查项

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| fatal 不提交输出 | `inspect /tmp/rv/BDMV`（空 BDMV） | `{"status":"failed","code":"BDMV_REQUIRED_FILE_MISSING",...}`，exit 1 |
| fatal 不创建目录 | `extract /tmp/rv/BDMV --out /tmp/rv-out` | exit 1，`/tmp/rv-out` 不存在 |
| `--out` 缺值 | `inspect INPUT --out` / `--out=` | `CLI_MISSING_VALUE`，stdout 为空，exit 1 |
| `--mode` 未支持 | `convert INPUT --mode standalone-full` | `CLI_UNSUPPORTED_MODE`，输出目录未创建 |
| `--limits` | 裸用 → `CLI_MISSING_VALUE`；带值 → `CLI_NOT_IMPLEMENTED` | 与 spec 一致 |
| strict 只改接受策略 | `inspect`/`extract` 真实碟：默认 0，`--strict` 2 | partial 未被升级/降级 |
| `report.json` 不进审计载荷 | 真实包 `validate --offline` | 无 `PACKAGE_UNLISTED_PAYLOAD`，`discoveredPayloadFiles` 不含它 |
| profile 穿透 | `convert --player-profile p.json` | 同时出现在 `manifest.profile` 与 `runtime/disc-data.js` |
| 源路径不泄漏 | `grep -r "/Users/" /tmp/rv-menu` | 无命中（`safeDiagnosticMessage` 生效） |

## Findings

### P2-P2-1: [P2] `validate` 在校验 `--format` 之前已经改写包内报告

- 位置: `apps/cli/src/index.ts:457`（写 `dependency-audit.json`）、`:516-517`（写 `compatibility.json`、`reports/release-summary.json`）、`:524`（才 `optionValue("--format")`）
- 触发条件: `node apps/cli/dist/index.js validate PKG --offline --format`
- 影响: 实测 exit 1（`CLI_MISSING_VALUE`），但三个报告文件已被重新生成/覆盖。用户认为命令失败、包未被改动，实际相反。与同一轮在 `convert` 里确立的"参数契约先于任何副作用"（`index.ts:340-352` 注释）自相矛盾。
- 置信度: 高（实测）
- 修复方向: 在任何写操作前解析并校验 `--format`（并把取值限定为 `json`）；`--strict` 目前用 `argv.includes("--strict")`，也与其它命令的 `strictDefault()` 不一致，建议统一。

### P2-P2-2: [P2] 未知/拼错参数被静默忽略，可造成错误交付

- 位置: `apps/cli/src/index.ts:45-53`（`inputPath` 白名单）、`:17-29`（`lookupOption` 只做精确名匹配）、`main()` 无未知参数校验
- 触发条件与实测:
  - `inspect test-data/bdmv/tamako-love-story-bd --stric` → exit 0，strict 未生效（应为 2）；
  - `convert DISC --ou /tmp/typo-out` → 包被写到 `<disc 父目录>/BDMV-menu`，`/tmp/typo-out` 不存在；
  - 多余位置参数同样被忽略。
- 影响: 直接违反 `cli-delivery-status` 的「参数契约明确 —— 不得静默忽略或降级到其它行为」。`--stric` 会绕过 strict 门禁，`--ou` 会把产物写到非预期目录，属于可导致错误交付的静默降级。
- 置信度: 高（实测）
- 修复方向: 每个命令声明允许的选项集合，对未知 `--*` 报 `CLI_UNKNOWN_OPTION` 并 exit 1；位置参数多于 1 个时报 `CLI_USAGE`。

### P2-P2-3: [P2] `convert` 的交付状态结构性恒为 `partial`，归因也不是事实

- 位置: `apps/cli/src/index.ts:429-444`（`decideDelivery({ mode, checks: [], ... })`）、`packages/test-runner/src/decisions.ts:100-113`
- 触发条件: 任意一次成功 `convert`
- 影响: `checks: []` 与未提供的 `hasUnresolvedReachability` / `hasUnsupportedReachableCapability` 使 `decideDelivery` 恒返回 `partial`，`report.json.reasons` 首条恒为 `"No audit checks were supplied."`。实测 tamako 转换：`status=partial`、exit 0，reasons 四条里三条是"事实缺失"而非"真实缺口"。这与代码注释「Delivery status is decided from facts, not from the fact that packaging succeeded」相反：状态由"没有提供 checks"决定，任何干净交付也无法得到 `complete`。
- 关联风险: 包内同时存在三个结论源——`report.json.status`（decision）、`manifest.status`（`package-builder/src/index.ts:145` 硬编码 `"partial"`）、`compatibility.json`（`package-builder/src/index.ts:59-68` 初始写 `partial`，`validate` 再覆盖）。今天三者恰好都是 partial；一旦 decision 变成 `complete`（库层测试已证明可达）或 `failed`，`manifest.status` 与包内 README 就会与 `report.json` 矛盾。
- 置信度: 高（恒 partial / 硬编码），中（冲突当前不可复现）
- 修复方向: ①把 convert 已知的事实（`declaredEntryCount`、`hdmvEntryCount`、`hasUnresolvedReachability: true`、limitations）显式传入；②把 `decision.status` 传给 builder 由它写 `manifest.status`，删除 `MenuPackageMetadata.status` 的字面类型 `"partial"`；③若产品上确实"convert 永不为 complete"，在 spec 写明，不要靠 `checks: []` 的副作用表达。

### P2-P2-4: [P2] `--player-profile` 的校验弱于 PSR 规则，非法值报 `E_IO` 而非 `CLI_INVALID_PROFILE`

- 位置: `apps/cli/src/index.ts:71-79`（只要求非空字符串）；`packages/hdmv/src/registers.ts:45-49`（`profileWord(value, 3|2)` 的 ASCII/长度规则）
- 触发条件: `{"country":"USA"}`、`{"menuLanguage":"jp"}`、`{"subtitleLanguage":"eng "}`
- 影响: 通过 CLI 校验后在 `findTopMenuPlaylist` 构造 `HdmvVm` 时抛 `TypeError`，被 `main().catch` 归为 `E_IO`，与 `docs/development.md` 承诺的 `CLI_INVALID_PROFILE` 不符。失败发生在事务创建前，**不会产出坏包**，所以影响是错误码与可诊断性。
- 置信度: 高（代码路径；错误码映射在 `index.ts:572-578`）
- 修复方向: `loadPlayerProfile` 复用同一套 word 规则（长度 2/3、ASCII、大小写规范化），或捕获 VM 构造错误转成 `ContractError("CLI_INVALID_PROFILE")`。

### P2-P2-5: [P2] 失败路径的 `report.json` 与成功路径是两套 schema

- 位置: `apps/cli/src/index.ts:370-374`（失败）vs `:442`（成功）
- 触发条件: 无 IGS scene / Top Menu playlist 解析不出 / 场景歧义
- 影响: 失败报告只有 `schemaVersion/status/code/mode/diagnostics`，缺少 `reasons`、`blockingDiagnostics`，且 `diagnostics` 丢掉了 `severity`（三处 map 都只保留 `code`/`message`）。同一文件名两种结构，消费方无法统一判断 blocking；现有测试用 `toMatchObject` 掩盖了这一点。
- 置信度: 高
- 修复方向: 失败时也写 `reasons` 与 `blockingDiagnostics`，诊断保留 `severity`（至少主错误标 `error`/`fatal`）。

### P2-P2-6: [P2] `validate` 落盘的 `dependency-audit.json` 与同一命令的 stdout / summary 不一致（2026-11-05 复扫增补）

- 位置: `apps/cli/src/index.ts:454`（先算 `dependencyAudit`）、`:457`（立即落盘）、`:501`（改用 `releaseSummary.dependencyAudit`）、`:526`（stdout 输出最终值）；`packages/test-runner/src/release-summary.ts:58-61`（checks 为空时注入 `DEPENDENCY_AUDIT_REQUIRED`）
- 触发条件: 包内没有 `OFFLINE_*` / `BUNDLE_*` / `ACTIVE_EMBED` 检查——典型是只含 `README.md` + `report.json` 的 convert 失败包。`createDependencyAuditReport`（`report.ts:43`）过滤后得到 `checks: []`。
- 实测（2026-11-05，构造失败包后 `validate --offline --format json`）:
  - 磁盘 `dependency-audit.json`: `{"status":"not-verified","checks":[]}`
  - stdout `dependencyAudit.checks`: `[{"checkId":"DEPENDENCY_AUDIT_REQUIRED","result":"not-verified",...}]`
  - `reports/release-summary.json` 与 `compatibility.json` 跟 stdout 一致，与磁盘文件矛盾
- 影响: 同一命令产出的"唯一权威落盘文件"和命令输出给出两套结论。消费方读文件会认为"没有检查、状态 not-verified"，读 stdout 会看到一条显式的 `DEPENDENCY_AUDIT_REQUIRED` 缺口；两者无法对齐。测试 `apps/cli/src/index.test.ts:495-496` 的 `toEqual` 只覆盖 `makePackage` 固定写 `index.html` 的分支（此时 `OFFLINE_STATIC_AUDIT` 存在，两侧相等），从未走到空 checks 分支。
- 置信度: 高（代码顺序 + 实测）
- 修复方向: 先算 `releaseSummary`，再写 `dependency-audit.json`，且只写 `releaseSummary.dependencyAudit`；即把 `:456-461` 的写盘移到 `:501` 之后。补一条"无静态 payload 的包"用例断言磁盘与 stdout 相等。

### P2-P2-7: [P2] 失败包缺 `manifest.json` 时 mode 静默回落 `standalone-full`，与 `report.json` 的 `menu-only` 矛盾（2026-11-05 复扫增补）

- 位置: `apps/cli/src/index.ts:472`（`const mode = manifest.mode === "menu-only" ? "menu-only" : "standalone-full"`）；`:463-466` 读 manifest 失败时保留 `{}`
- 触发条件: `convert` 的 `failMenuConversion` 只写 `README.md` + `report.json` 就 commit（`:366-376`），不写 `manifest.json`；随后对该目录执行 `validate`
- 实测（2026-11-05）:
  - `report.json` = `{"status":"failed","code":"MENU_SCENE_NOT_FOUND","mode":"menu-only"}`
  - `decision.mode` / `compatibility.json.mode` / `reports/release-summary.json.release.mode` / stdout 全部为 `standalone-full`
- 影响: 四个出口系统性记错交付形态，且没有任何诊断提示"mode 来源缺失"。`mode` 当前不参与 `auditOutputPackage` 的 checks（该函数不接收 mode），所以不会直接改判定；但它是 `compatibility.json` / `release-summary.json` / stdout 的语义字段，错值会让消费方按 `standalone-full` 解读一个 `menu-only` 的失败包，并与 `report.json` 自相矛盾。问题只发生在失败包上，容易被当成"失败包无所谓"而长期不修。
- 保护路径（反例）: 成功包总有 `manifest.json`，`mode` 正确；因此该问题只在失败路径暴露。
- 置信度: 高（代码路径 + 实测）
- 修复方向: mode 解析顺序改为 `manifest.mode` → `report.json.mode`（只取形态字段，不信任其 `status`）→ 未知。未知时输出 `PACKAGE_MODE_ASSUMED`（`not-verified`）而不是静默默认 `standalone-full`；若确认走回退，也在 summary 里记 `modeSource: "report"`。

### P2-INFO-1: [INFO] `convert` 只对解析阶段做 fatal 门禁

- 位置: `apps/cli/src/index.ts:353-357`（只 `classifyDiagnostics(disc.diagnostics)`）
- 事实: `extraction.diagnostics` / `adapted.diagnostics` 若出现 `fatal`，会一路 `buildMenuPackage` → commit → `report.status: "failed"` + exit 1，磁盘上留下 `index.html` + `runtime/*` 齐备的包（`manifest.status` 仍是 `partial`）。
- 保护路径: 当前 IGS（`packages/igs/src/types.ts:15`）与 adapter（`igs-adapter.ts:45`）都没有 `fatal` 生产者，不可触发。
- 建议: commit 前用三处诊断合并判定 `hasFatal`，与 spec「转换期 fatal 不产生可被误认为完成的新包」对齐。

### P2-INFO-2: [INFO] 阶段失败输出用 `status`，与"阶段结论位于 `stageStatus`"的 spec 场景冲突

- 位置: `apps/cli/src/index.ts:104-107`（`stageFailure` 写 `{status:"failed"}`）、`:121`（成功写 `{...disc, stageStatus}`）
- 事实: 实测 `inspect`/`extract` 的空 BDMV 失败输出为 `{"status":"failed","code":...}`，没有 `stageStatus`。spec 的「报告字段可区分」要求阶段结论在 `stageStatus`，但同一份 spec 的「缺少必需入口」场景又明确写"stdout 报 `status: "failed"`"。
- 结论: 这是 spec 内部矛盾，不是实现单方面错误。需要二选一：失败对象统一加 `stageStatus`，或在 spec 里为失败对象写例外条款。

### P2-INFO-3: [INFO] `extract` 先跑完 IGS 提取再判 fatal

- 位置: `apps/cli/src/index.ts:144-148`
- 事实: 先 `extractIgsScenes(disc)` 再 `decideStageOutcome`。缺 `index.bdmv` 的输入会先扫一遍 STREAM 再失败。不产生错误结果（不建目录），只是白跑 I/O。
- 建议: 先 `classifyDiagnostics(disc.diagnostics).hasFatal` 快速失败，再取 IGS 诊断。

### P2-INFO-4: [INFO] 死代码与死参数

- `apps/cli/src/index.ts:58` `PLAYER_PROFILE_KEYS` 定义后从未使用（无 `noUnusedLocals`，编译不报）。
- `packages/test-runner/src/decisions.ts:45` `StageOutcomeInput.stage` 不参与判定（inspect/extract 规则完全相同）。
- `decisions.ts:15` `DeliveryDecisionInput.mode` 在 `decideDelivery` 内已完全不使用。
- `apps/cli/src/index.ts:497` `reportedStatus` 仍无消费者（`release-summary.ts:14-23`），上一轮已记录，本轮保留。

## 漏检复盘

- 默认分支 / 未知输入: 已查命令分发（`supported` 集合）、`--flag=` 空值、旗标在末尾、值以 `--` 开头、多余位置参数。**发现 P2-2**（未知选项未校验）；`--out --weird` 被判缺值属有意行为，已在 README 建议用 `--out=...`。
- 异步失败 / 前提失效: 已查 `staging → report → commit` 顺序、`commit` 失败清理、`abort` 可达性、`validate` 的写前校验。**发现 P2-1**。
- 半完成状态 / 重建窗口: 已查 convert 的三类失败出口与 `failMenuConversion`；失败包只含 `README.md` + `report.json`，无 manifest/index.html，**不会被误认为完成**。但 `validate` 对这类包的 mode 回落成 `standalone-full`，**发现 P2-7**（2026-11-05 补检）。上一版此处写"未发现新问题"是漏检：只看了"会不会被当成完成"，没看"下游读出来的形态对不对"。
- 报告一致性: 同一命令的落盘文件与 stdout 是否同源。**发现 P2-6**：`dependency-audit.json` 写的是中间态，stdout/summary 用的是注入 `DEPENDENCY_AUDIT_REQUIRED` 之后的最终态。
- 渲染 / 导出 / 编码: 不属本层。
- 隐式协议: `stageStatus` / `status` / `manifest.status` / `compatibility.status` 四者关系已逐一比对。**发现 P2-3、INFO-2**。

## 未覆盖区域

- 未注入 I/O 故障（`report.json` 写失败、`rename` 失败）后的 staging 清理。
- 未验证仓库外消费者是否读 `manifest.status` / `report.json`（仓内仅 `validate` 读 `manifest.status`，且 `reportedStatus` 未被使用）。
- 未验证并发两次 `convert` 到同一输出的竞态。
