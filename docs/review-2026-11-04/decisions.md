# 决策记录（2026-11-05）

> 来源: 对 [`fixes-plan.md`](./fixes-plan.md) 中待决问题的集中确认
> 状态: **仅记录决策，本轮不推进实现**（用户明确：本轮要的是决策点确认，不是修复排期）
> 影响: 已同步到 [`fix-checklist.md`](./fix-checklist.md) 对应条目；批次划分保留为待排期候选

## 决策一览

| 编号 | 议题 | 结论 | 类型 |
| --- | --- | --- | --- |
| D-1 | 本轮修复范围 | 不定范围、不执行，只固化决策 | 用户 |
| D-2 | `convert` 交付状态 | **生成菜单即 `complete`**；`not-verified` / `not fully verified` 不阻断，只有失败证据才阻断（2026-11-05 09:40 修订，原「恒 partial」撤销） | 用户 |
| D-3 | 解析层严格度 | **对齐 libbluray 放宽**：上界用文件长度，长度不自洽降级 warning | 用户 |
| D-4 | letterbox 布局 | **无案例不处理**，转为条件触发 + 已知限制 | 用户 |
| D-5 | `stageFailure` 字段名 | 统一为 `stageStatus`（D-2 的派生结论） | 派生 |
| D-6 | `testTimeout` 取值 | `apps/cli` / `media-export` / `runtime-web` 设 15000ms；`hdmv` 不动（47s 用例在 runtime-web 且已自带 `120_000`） | 默认 |
| D-7 | 0x24 剩余属性位 | 只修注释，不扩展模型 | 默认 |
| D-8 | `disc-title` | 删死代码，标题只留 `<title>` | 默认 |
| D-9 | `extract` 先 IGS 再判 fatal | 提到 `hasFatal` 之前，顺带修 | 默认 |
| D-10 | `profile` 双源 | 随 `validate` 审计一起做，不单独排 | 默认 |
| D-11 | `--player-profile` 非法值 | 复用 `profileWord` 规则，报 `CLI_INVALID_PROFILE` | 默认 |
| D-12 | 报告同源 | `validate` 先算 summary，再写 `dependency-audit.json`，只写最终值 | 默认（2026-11-05 增补） |
| D-13 | 失败包 mode 来源 | `manifest` → `report.json` → `assumed`，并记 `modeSource`，禁止静默默认 | 默认（2026-11-05 增补） |

---

## D-1 本轮范围：只定决策，不排期

**结论**：本轮产出决策与 spec 条款，不承诺改动范围、不动代码。

**理由**：范围需要在决策确定后才谈得上有意义（例如 D-3 决定了两条原观察项是否升级）。

**落地**：`fixes-plan.md` 的批次表保留为候选排期，顶部标注"待用户确认后执行"。

---

## D-2（已修订）`convert` 生成菜单即 `complete`

> **2026-11-05 09:35 修订**：原结论「恒 partial」撤销。用户裁定：**生成出菜单就不算 partial，算 complete**。
> 本节的旧结论与旧实现要点全部作废，仅保留"依据（代码现状）"作为 bug 证据。

**结论**：

- `convert` 成功构建出菜单包 → `complete`（前提：没有失败证据——无 fatal、无 blocking error、无 `fail` check、无缺失资产）。
- "没有做审计"不再是 partial 的理由。`convert` 判定的是"转换是否达成"，不是"审计是否通过"。
- `manifest.status` 跟随 `decision.status`，**允许 `complete`**。
- `auditScope` 只标注结论来源（convert / validate）；两者用**同一套判定规则**，不存在两套标准，因此 convert 与 validate 对同一个包会给出相同状态。

### 依据（代码现状，即需要修的 bug）

- `apps/cli/src/index.ts:432-440` 调用 `decideDelivery({ checks: [], ... })`，`checks` 恒空。
- `packages/test-runner/src/decisions.ts:101` 的 `partialConditions` 首项即 `input.checks.length === 0`。
- 同一数组里 `hasUnresolvedReachability !== false`（`:104`）、`hasUnsupportedReachableCapability !== false`（`:105`）、`requiredEvidenceComplete !== true`（`:110`）、`coverageComplete !== true`（`:111`）在 convert 场景全部为 `undefined`，同样恒真。
- `packages/package-builder/src/index.ts:14,103,145` 把 `status` 写死为字面量 `"partial"`；`:229` 的包内 README 写 "always **partial**"。

### 判定规则（convert 与 validate 共用）

**核心**：`complete` 只看**是否存在失败证据**，不看**是否缺少证据**（absence of evidence ≠ evidence of failure）。`not fully verified` 属于后者，不阻断。

| 条件 | status | 退出码 |
| --- | --- | --- |
| fatal 诊断 / 菜单构建失败 | failed | 1（不 commit） |
| 有 `fail` 的 audit check | failed | 1 |
| 有未认可的 blocking error | partial | 0；strict 2 |
| `hasUnresolvedReachability === true` / `hasUnsupportedReachableCapability === true` | partial | 0；strict 2 |
| `hasMissingRequiredAsset === true` | partial | 0；strict 2 |
| 只有 `not-verified` / 未收集的证据 / `not fully verified` 说明 | **complete** | 0（strict 也是 0） |

用户裁定原话：**"数据有缺失那确实应该 partial，现有校验通过就是 complete"**；**"not fully verified 这个不算 complete 的阻碍项"**。

### 实现要点

1. 从 `partialConditions`（`decisions.ts:100-113`）移出以下"缺失 / 未验证"类条件：
   - `checks.length === 0`（`:101`）
   - `declaredEntryCount === undefined || hdmvEntryCount === undefined`（`:102`）
   - `hasMissingRequiredAsset === undefined`（`:103`）
   - `hasUnresolvedReachability !== false`（`:104`）→ 只保留 `=== true`
   - `hasUnsupportedReachableCapability !== false`（`:105`）→ 只保留 `=== true`
   - `requiredEvidenceComplete !== true`（`:110`）
   - `coverageComplete !== true`（`:111`）
   - `unverifiedChecks.length > 0`（`:112`）
2. `not-verified` 的 check 改为收集进返回值的新字段 `notVerified: string[]`，供 report / compatibility / README 展示，不再影响 status。
3. `reasons` 同步：不再输出 `"No audit checks were supplied."` / `"Entry counts are missing."` / `"Required evidence is missing or not verified."` / `"Coverage is incomplete..."` 这类"缺证据"理由——它们进 `notVerified`。
4. `limitations` 只作说明，不影响 status：移除 `decisions.ts:123` 的 `input.limitations?.length` 条件。真实缺口用 `severity: "error"` 的诊断表达，不用 limitations 伪装。
5. **`auditScope` 只用于标注结论来源**（写进 `report.json`），不再作为判定分支——规则对 convert 与 validate 完全一致。这比"按 scope 分支"更简单，也避免两套标准。
6. convert 侧 `index.ts:438` 的 `hasMissingRequiredAsset: false` 保留并加注释（`buildMenuPackage` 已成功返回，事实成立）。
7. `MenuPackageMetadata.status`（`package-builder/src/index.ts:14`）从 `"partial"` 放宽为 `"failed" | "partial" | "complete"`；本地定义，不引 branded `DeliveryStatus`。`buildMenuPackage` 接收 `status`，`:103` metadata 与 `:145` manifest 同源。
8. builder 补写 `declaredEntryCount` / `hdmvEntryCount` 到 manifest（`disc.entries` 已知）。它们已不参与判定，但能让 validate 报告有据可查，消除"数据缺失"的观感。
9. 包内 README（`:229`）的 `always **partial**` 改为按 status 动态措辞。
10. validate 不回写 `manifest.status`；不一致时输出 `manifestStatus` 与实际 `status`，诊断码 `MANIFEST_STATUS_UNVERIFIED`（不是 `STALE`——不是过期，是证据不足）。

### 预期效果（以真实碟为验收标准）

样本：工作区完整 BDMV（6 playlist / 7 clip / 6 entry，STREAM 齐全，解析诊断 7 info、0 error）。

**改动前实测基线**：

| 命令 | status | 证据 |
| --- | --- | --- |
| `convert ... --out /tmp/menu` | `partial` | exit 0；诊断 7 info + 6 warning，**0 error**；reasons 3 条全是缺证据 |
| `validate /tmp/menu --offline --format json` | `partial` | exit 0；checks 5 pass / 3 not-verified / **0 fail**；reasons 7 条全是缺证据或 limitation |

**改动后期望**：两者都 `complete`。`validate` 的 `notVerified` 仍列出 3 条（browser evidence、reference evidence、coverage），但不影响状态。

**反例（防止过度放宽）**：`test-data/bdmv/tamako-love-story-bd` 只有 2 个 STREAM 文件，playlist 引用的 clip 中有 37 个没有对应文件，产生 37 条 `BDMV_MISSING_STREAM`（error）→ 必须保持 `partial`。这条用来验证"error 仍然阻断"，避免把 error 也当成 not-verified。

### spec 影响

- `cli-delivery-status/spec.md:58`「按实际缺口判定状态；无缺口时退出 0」**保持不变**——它是本决策的规范依据。
- `spec.md:65-68`「状态可为 complete」**保持不变**。
- 新增澄清条款：`not-verified` 不阻断 complete、`limitations` 不参与判定、`auditScope` 字段、`manifest.status` 允许 complete 且 validate 不回写。

### 已知代价（用户已明确接受）

- 一个"什么都没验证"的包也会 `complete`。这是本决策的语义：**complete = 没有已知失败，不等于已充分验证**。未验证项在 `notVerified` 与 `limitations` 中可见。
- 因此 README / 文档必须写明 "complete ≠ 已验证"，否则读者会把 complete 读成"审计通过"。
- 之前写的"convert 恒 partial 会让 partial 失去区分度"不再成立；新的风险反过来：`complete` 的门槛变低，需要靠 `notVerified` 保留信息量。

### 测试影响（已核实）

- `apps/cli/src/index.test.ts:59` 的用例名 "stays partial in default and strict modes" 及断言（`:67` stdout、`:76` compatibility、`:77` manifest、`:78` README 文案、strict 期望 exit 2）**全部要重写**。
- 合成碟默认含菜单流（`includeMenuStream !== false`），改后应为 `complete`，strict 也 exit 0；需新增"只有 not-verified、无 fail → complete"的用例。
- `packages/test-runner/src/index.test.ts:175-233` 需复核：`:233` 的 `decideDelivery({ mode: "menu-only", checks: [], diagnostics: [] })` 现在应为 `complete`（原来是 partial）。
- `packages/package-builder/src/index.test.ts:71-72,179` 直接传 `status: "partial"`，类型放宽后仍合法，不必改。
- `packages/test-runner/src/package-audit.ts:46` 只把 `status` 当 string 透传，不校验值，写 `complete` 不会让离线审计失败。

---

## D-3 解析层：对齐 libbluray 放宽

**结论**：两条原观察项升级为必修，方向是"容忍 + 记录"，不再用声明长度做上界。

### P1-P2-1 扩展区上界（`parser.ts:80-90`）

- `length` 只作一致性诊断，不再作 entry/payload 上界。
- entry 与 payload 的上界改用 `data.length`；`length + 4` 这类魔数比较（`:87`）一并换成文件边界。
- 越界保护**保留**：读之前仍要 `offset + size <= data.length`，只是不再信任声明长度。

### P1-P2-2 CLPI 长度自洽（`parser.ts:267-270,278-289`）

- `seqLen < 2`、`tsTypeLength < 5` 从 `throw` 改为 warning，按文件边界继续解析。
- 目标：`BDMV_MISSING_CLPI` 不再因字段不自洽而出现；graph/media plan 退化的概率下降。

### 统一原则（本轮沉淀，写进 `docs/guides/development.md`）

> 无法从参考实现确认的字段长度/取值，默认降级为诊断，不得直接判定整块数据不可用。

这条与 `summary.md` 跨模块问题 2 一致，此前只是结论，现在有决策背书。

### 新增诊断码（建议）

- `BDMV_DECLARED_LENGTH_MISMATCH`（warning）：声明长度与实际可读范围不一致。
- 现有 `BDMV_INVALID_SECTION` 保持"读越界"语义，不与长度不自洽混用。

### 放宽的边界（必须写进实现注释）

放宽不等于不校验。仍必须保证：

- 单个 section 的解析不会越过 `data.length`；
- 相邻 section 不被当作本 section 的一部分继续读（否则会把垃圾解析成合法记录，比直接失败更危险）。

---

## D-4 letterbox：无案例不处理

**结论**：不写没有验证目标的布局改动；转条件触发。

### 前提已核实

`test-data/bdmv/` 的 tamako 真实碟是 16:9、1080p，菜单视频与 IGS scene 比例一致，**无法复现** `P3-P2-2` 的错位。

### 处理方式

- 代码动作挂起，`fix-checklist.md` 中标记为条件触发。
- 文档动作保留：在 `docs/guides/browser-matrix.md` 的已知限制里写明「素材比例 ≠ scene 比例时，video 与 canvas 各自 letterbox 可能导致按钮错位，尚未验证」。
- 触发条件：`test-data/bdmv/` 新增一张 4:3 或非等比例菜单素材，或拿到"视频分辨率 ≠ scene 尺寸"的真实包。
- 触发后的首选方案不变：由 JS 用同一份 letterbox rect 同时设置 video 与 canvas，而不是各自交给 CSS `contain`。

---

## D-5 `stageFailure` 统一为 `stageStatus`（D-2 的派生结论）

**结论**：`inspect` / `extract` 的失败输出改 `status` → `stageStatus`。

**理由**：D-2 已确认 `status` 只表示交付结论。`extract` 失败时不存在交付结论，用 `status: "failed"` 会让同一个字段在两个场景表示两种东西。

**落地**：

- `apps/cli/src/index.ts:105` 改为 `{ stageStatus: "failed", code, diagnostics }`。
- `openspec/specs/cli-delivery-status/spec.md:30` 的 "stdout 报 `status: "failed"`" 同步改为 `stageStatus: "failed"`。
- `README` 的字段说明（约 100 行）同步。
- `apps/cli/src/index.test.ts` 中三条失败用例的字段断言同步改写。

---

## 默认假设（未逐条确认，按最小改动定；不同意可推翻）

### D-6 `testTimeout`

只给出现过假失败的包设 `testTimeout: 15000`：`apps/cli`、`media-export`、`runtime-web`，其余包不动，不启用 `slow` 标注。

**2026-11-05 更正**：上一版写"实测最慢单条 47s 的导航回归在 `hdmv`，需要单独看"，这是错的。47s 用例在 `runtime-web`（`src/tamako-headless-navigation.test.ts:214`），且已显式 `}, 120_000)`；`hdmv-navigation-corpus-dfs.test.ts:34` 同样带 `120_000`。per-test 超时优先于全局配置，所以给 `runtime-web` 设 15000 不会缩短这三条；`hdmv` 没有实测慢例。设置全局值的目的是兜住 CLI 那种 5–6s 的用例，不是覆盖语料回归。

### D-7 0x24 剩余属性位

`cr_flag` / `hdr_plus_flag` 不扩展进模型，只把注释改成"仅取 dynamic_range / color_space"，避免模型层为一个当前无消费者的字段扩大面积。

### D-8 `disc-title`

删除 `browser.ts:98-99` 的 heading 写回与 `title` 变量，测试两侧断言同步删除。页面不显示标题，碟名只体现在 `<title>`（浏览器标签）。若之后要页面内标题，作为独立需求加，不在这条里反复。

### D-9 `extract` 的 fatal 顺序

`extractIgsScenes` 挪到 `hasFatal` 判断之后（`index.ts:144-148`）。属于"顺手改"，不单独立项。

### D-10 `profile` 双源

`manifest.profile` 与 `compatibility.profile` 的一致性校验并入 `validate` 的审计项，与 `P3-INFO-3` 一起做，不单独排批次。

### D-11 `--player-profile` 非法值

在 CLI 解析参数时复用 `profileWord` 的长度/ASCII/大小写规则（`packages/hdmv/src/registers.ts:45-49`），非法值直接 `CLI_INVALID_PROFILE` 退出 1。

**不选**"捕获 VM 构造错误再转换码"：那要等真的构造出 IR 才报错，既晚又可能已经写进 staging，属于事后补救。

### D-12 报告同源（2026-11-05 增补）

`validate` 的所有落盘报告必须来自同一个 `releaseSummary`。`dependency-audit.json` 改为在 `releaseSummary` 计算后写一次，禁止"先写中间态、再用最终态覆盖别的文件"（`P2-P2-6`）。理由：落盘文件是唯一可离线核对的证据，不能与 stdout 出现两套结论。

### D-13 失败包的 mode 来源（2026-11-05 增补）

`manifest.mode` 缺失时用 `report.json.mode` 作回退（只取形态字段，不信任其 `status`），并在 summary 里记 `modeSource: "manifest" | "report" | "assumed"`；两者都没有时报 `PACKAGE_MODE_ASSUMED`（`not-verified`），不再静默默认 `standalone-full`（`P2-P2-7`）。

选 `report.json` 作回退而不是"直接报错"，是因为失败包本来就只有这份文件能说明它想产出什么形态；但 `status` 仍不可信，只取 `mode`。

---

## 待办：这些决策要落进 spec

按影响从大到小：

1. `cli-delivery-status/spec.md`：新增 `auditScope` 字段与 convert 的 `complete` 语义（D-2R）。**`:58`、`:68` 保持原文不动**。
2. `cli-delivery-status/spec.md`：修订 `:30`（`status: "failed"` → `stageStatus: "failed"`，D-5）。
3. manifest 相关 spec：写明 `manifest.status` 允许 `complete`，`validate` 不回写、不一致时报 `MANIFEST_STATUS_UNVERIFIED`（D-2R）。
4. `bdmv-disc-inspection/spec.md`：写明"可选元数据损坏不影响导航解析"（`P1-P1-1`）+ "声明长度不自洽不导致整块不可用"（D-3）。
5. `docs/guides/development.md`：新增"无法从参考实现确认的字段默认降级为诊断"原则（D-3）。
6. `docs/guides/browser-matrix.md`：letterbox 已知限制（D-4）。
7. `cli-delivery-status/spec.md`：补 mode 来源与回退（D-13），以及"落盘报告与 stdout 必须同源"（D-12）。

## 仍未决策

- `compatibility.json` 的 `status` 由 builder 写入、`validate` 会覆盖。它是否也要带 `auditScope` / `manifestStatus`？目前只计划在 `report.json` 与 validate 的输出里带。
- `validate` 若因 `fail` 把状态降为 `partial` / `failed`（而 manifest 是 complete），是否要提示"重新 convert"？本轮只报状态差异，不提供修复入口。
- 是否引入 `staged` / `unaudited` 第三态：**不需要了**。convert 的 `complete` 语义已由 `auditScope` 区分，再加状态只会增加消费者分支。
