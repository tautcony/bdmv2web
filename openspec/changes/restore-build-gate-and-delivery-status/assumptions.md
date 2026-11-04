# 待确认假设

本 change 的任务把评审文档里标 `⚠需确认` 的若干问题按**一个具体假设**推进了。这份清单把它们单独列出：每条给出"假设值 / 依据 / 若判断相反要改什么"。

处理规则：

- 假设不成立**不阻塞开工**——下面每条都写了反选后的改动点，成本都是局部的。
- 反选后请直接改对应任务，并把本条状态标为"已改判"。
- 本清单不是决策记录（决策在 `docs/code-review.md`），只是把"实施时替你做的那一步"摊开。

## 状态总览

| 编号 | 假设 | 关联任务 | 反选成本 | 状态 |
| --- | --- | --- | --- | --- |
| R1-1 | `numericSelectValue` 每个夹具显式声明，不给类型默认值 | 1.2 | 低（1 处类型 + 1 条测试） | 待确认 |
| R1-2 | 阶段命令用 `decideStageOutcome`，不复用 `decideDelivery` | 4.2–4.4 | 中（改 3 个任务 + 1 个类型） | 待确认 |
| R1-3 | `mode === "menu-only"` 不再作为 partial 条件 | 5.3 | 低（1 行条件 + 2 条断言） | 待确认 |
| R1-4 | `--limits` 用新增码 `CLI_NOT_IMPLEMENTED` | 5.6 | 低（1 个错误码字符串） | 待确认 |
| R1-5 | CI 单独立项，本批只落 `scripts/ci.sh` | 1.5、1.6 | 低（加一份 workflow） | 待确认 |
| R1-6 | `inspect` 默认退 1，靠 `--allow-partial` 覆盖 | 4.4 | 低（交换默认与旗标语义） | 待确认 |

---

## R1-1 `numericSelectValue` 的处理方式

**假设**：在 `packages/runtime-web/src/igs-adapter.test.ts` 的夹具里显式写 `numericSelectValue: 11`，类型上保持必填。

**依据**：该字段由 `packages/igs/src/igs.ts:240` 从 IG 流实际解析，`id: 11` 的按钮其数值选择值就是 11。改成可选会让"解析丢字段"变成静默通过。

**若判断相反**（应给类型默认值）：改 `IgsButton` 类型声明给默认值，或把字段改可选，然后 1.2 的夹具可以留空。代价是任何真实的解析缺失都不再被类型系统拦住。

---

## R1-2 阶段结果与交付状态分两个函数

**假设**：`inspect` / `extract` 走新函数 `decideStageOutcome()`（返回 `StageStatus = complete/partial/failed`），`convert` / `validate` 继续走 `decideDelivery()`。

**依据**：`decideDelivery` 的输入是"交付包"（checks / 证据 / 模式），阶段命令没有这些输入。硬塞的结果是两种错误二选一：要么 fatal 也退 0（现状），要么 strict 下所有阶段命令都退 2（因为"阶段未完成"被当成"交付 partial"）。

**若判断相反**（必须统一走 `decideDelivery`）：4.2 改为给 `decideDelivery` 增加 `stage` 参数并在内部分支；4.3 / 4.4 的调用点不变但输出字段改名为 `status`。代价是交付状态与阶段状态共用同一个枚举，`status: "complete"` 再次产生两种含义。

---

## R1-3 `mode` 不再影响 partial 判定

**假设**：删除 `decideDelivery` 的 `partialConditions` 中的 `input.mode === "menu-only"`。

**依据**：D4=A 之后产物只有 `menu-only` 一种形态。保留这条规则 → 所有交付恒定 partial，`complete` 永不可达；而基线 §4 的 partial 条件（BD-J、不支持能力、证据缺失）本来就不含模式。

**若判断相反**（保留该条件）：5.3 只改测试不改实现，同时必须接受"`complete` 不可达"，并在基线 §4 里补上"menu-only 即 partial"——否则基线与实现继续矛盾。

---

## R1-4 未实现功能的错误码

**假设**：新增 `CLI_NOT_IMPLEMENTED`，不复用 `E_NOT_IMPLEMENTED`，也不复用 `CLI_UNSUPPORTED_MODE`。

**依据**：CLI 现有码全部是 `CLI_` 前缀（`CLI_USAGE` / `CLI_MISSING_INPUT` / `CLI_MISSING_OUTPUT` / `CLI_OFFLINE_REQUIRED` / `CLI_UNSUPPORTED_MODE`）。`CLI_UNSUPPORTED_MODE` 的语义是"模式不支持"，用在 `--limits` 上会让日志误导归因。

**若判断相反**（复用 `CLI_UNSUPPORTED_MODE`）：5.6 的验收字符串改一处即可，但错误码语义会变宽。

---

## R1-5 CI 的承接方式

**假设**：本批只落平台无关的 `scripts/ci.sh`，不加任何平台专属配置；流水线单独立项。

**依据**：仓库 `git remote -v` 为空，托管平台无法推断；而"CI 单独立项"若不指定承接物，就会变成一条无人认领的承诺（评审已指出这个风险）。

**若判断相反**（本批就把流水线建起来）：在 1.6 之后追加一个任务写 `.github/workflows/ci.yml`（或对应平台的配置），并删掉 1.5 里"属后续独立 change"的表述。需要先确定平台与是否允许联网装依赖。

---

## R1-6 `inspect` 的默认退出码

**假设**：`inspect` 遇到 fatal 默认退 1；需要"只看诊断"的调用方显式加 `--allow-partial`。

**依据**：基线 §3/§4 要求退出码区分状态；当前"fatal 也退 0"是明确的缺陷。

**若判断相反**（保留默认退 0）：4.4 改为"默认退 0 + 新增 `--strict` 退 1"，并在 README 写明默认语义。代价是"默认不安全"——脚本不加 `--strict` 就仍然分不清可用与不可用。
