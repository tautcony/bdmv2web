# Design

## Context

当前 `master` 有三类"声明与事实不一致"，本 change 只消除它们，不引入新业务行为：

| 声明 | 事实 | 证据 |
| --- | --- | --- |
| `pnpm build` / `pnpm typecheck` 通过 | `-r build` 2 失败、`-r typecheck` 失败 | `test-runner/src/index.test.ts:109-118`、`igs-adapter.test.ts:14` |
| `dist/` 是发布产物 | `dist/` 含 70 个 `*.test.js` / `*.test.d.ts` | `find packages apps -path "*/dist/*" -name "*.test.*" \| wc -l` |
| 退出码区分状态（基线 §3/§4） | 空 BDMV `extract` 输出 `{"status":"partial"}` 并 `exit 0` | 复现命令见 `docs/code-review.md` §五 |
| `convert` 默认可用 | 默认 `standalone-full` 未实现，裸跑恒定 `exit 2` | `apps/cli/src/index.ts:26,257` |

基线见 [IMPLEMENTATION_BASELINE.md](../IMPLEMENTATION_BASELINE.md) §3（CLI 与输出事务）、§4（状态统一判定）。

## Goals / Non-Goals

**Goals:** 门禁可复现、作用域可归因、退出码与诊断一致、参数不留静默无效项、文档对同一事实只有一种说法。

**Non-Goals:** 新增 CI 流水线；实现 `standalone-full`；实现字节级完整性校验；性能优化；改变业务判定规则（`decideDelivery` 的状态条件只做必要修正）。

## Decisions

### 1. 用 `tsconfig.build.json` 而不是 `exclude` 塞进主配置

主 `tsconfig.json` 的 `include: ["src/**/*.ts"]` 同时服务 `build`（emit）与 `typecheck`（noEmit）。若直接在它上面 `exclude` 测试，`typecheck` 就看不到测试文件，会丢掉"测试代码本身能否编译"的检查——这正是当前两条 P0 中第一条本该更早暴露的地方。

因此每包新增 `tsconfig.build.json`：

```json
{ "extends": "./tsconfig.json", "exclude": ["**/*.test.ts", "**/*.test-d.ts"] }
```

`build` 走 `tsc -p tsconfig.build.json`，`typecheck` 保持 `tsc -p tsconfig.json --noEmit`。两者失败互不掩盖：产物编译失败只影响 `build`，测试编译失败只影响 `typecheck`。

`packages/core` 的 `build` 还有第二步 `node ../../scripts/build-core-browser.mjs`，保持在后。

### 2. 测试作用域由配置锁定，脚本字面统一

现状 6 个包用 `vitest run`（无路径），5 个包用 `vitest run src`，2 个包（`igs`、`media-export`）测试在 `test/` 或 `src/` 混合。`vitest run` 的默认 `include` 会匹配 `dist/*.test.js`，于是：编译产物被当作测试再跑一遍；`hdmv` 因 `dist/fixtures/...-golden.json` 缺失而失败；聚合执行时各包实际作用域不同，出现"逐包跑有 51 例、聚合跑报 no tests"。

决策：脚本统一为 `vitest run`，作用域写进各包 `vitest.config.ts` 的 `include`（`src` 有测试就写 `src/**/*.test.ts`，`igs` 额外含 `test/**/*.test.ts`），`hdmv` / `test-runner` 补配置文件。配置是唯一事实源，脚本不再携带路径参数。

`dist` 里不再有测试产物（决策 1）后，即使某包配置写错也不至于把产物当测试；两道防线是有意的。

### 3. 阶段结果与交付状态用两个函数，不共用一个 `status`

`decideDelivery` 的输入契约是"交付包"（checks / 证据 / 模式），不适用于 `inspect` / `extract` 这类阶段命令。当前把阶段命令硬塞进交付语义，导致两个方向的错误：要么 `fatal` 也 `exit 0`（现状），要么 strict 下所有阶段命令都退 2（因为"阶段未完成"被当成"交付 partial"）。

拆成两个入口，共用诊断分类：

- `classifyDiagnostics()`：把 `Diagnostic[]` 归约为 `{ hasFatal, hasBlockingError, acknowledged }`。`decideDelivery` 与阶段判定都调它，severity 判断只有一份。
- `decideStageOutcome({ stage, diagnostics })`：仅服务 `inspect` / `extract`。
  - 有 `fatal` → `{ status: "failed", exitCode: 1 }`
  - 有未认可的 `error` → `{ status: "partial", exitCode: strict ? 2 : 0 }`
  - 无阻断 → `{ status: "complete", exitCode: 0 }`（这里的 complete 指"本阶段目标达成"，不代表交付 complete）
- 交付状态仍只由 `decideDelivery` 给出，只有 `convert` / `validate` 调用。

基线 §3 已写明"inspect/extract 的命令执行结果与交付状态分开"，本决策是把它落到代码结构上。

### 4. `mode` 停止作为"不完整"的依据

`decideDelivery` 的 `partialConditions` 含 `input.mode === "menu-only"`，而 D4=A 之后产物只有 `menu-only` 一种形态——这条规则会让所有交付恒定 `partial`，`complete` 不可达，与基线 §4 的状态表（partial 条件是 BD-J / 不支持能力 / 证据缺失，不含模式）矛盾。

决策：删除该条件，`mode` 退化为记录字段；partial 只由实际缺口驱动。这会让 `packages/test-runner/src/index.test.ts:182-183` 的现有断言失效，需要同步改写成"无缺口时 complete / 0，有缺口时 partial"。

### 5. `--mode` 只接受 `menu-only`，非法值不落盘

`--mode standalone-full` 显式报 `CLI_UNSUPPORTED_MODE` 并 `exit 1`，在任何 `beginOutputTransaction` 之前返回。默认值改 `menu-only`，同时删掉 `strictDefault()` 中"非 menu-only 即 strict"的分支——它把"未实现"伪装成"严格拒绝"，是裸跑退 2 的直接原因。

`--limits` 与 `--player-profile`：`--player-profile` 本 change 接线生效（读取、校验、传给 builder/VM）；`--limits` 依赖 D3 的 `VmOptions.limits`（第 2 批），本 change 改为解析后立即报 `CLI_NOT_IMPLEMENTED` 并 `exit 1`。宁可显式未实现，也不留"解析后丢弃"的旗标。错误码不复用 `E_NOT_IMPLEMENTED`（该码现用于 `compare` 等整体未实现的命令，混用会让"命令不存在"与"参数未实现"无法区分）。

### 6. 文档只有一个事实源

`development.md`（离线 `file://` 未验证）、`browser-matrix.md`（`not-verified`）、`M6-release-verification.md`（已验收）、两份 tasks 的 4.1（已勾选）对同一件事给出四种说法。本 change 只统一**表述**为："已完成 macOS Chrome `file://` 实测，证据未绑定制品指纹"，并把证据出处收敛到一处引用。

勾选状态与 `payloadFingerprint` 字段的最终处置属 D9（第 2 批），本 change 不改勾选、不改字段——避免在批 1 里制造半完成状态。

M6 的测试计数（42/40/56/51）按本 change 第 1 节记录的逐包基线重算后替换。

## Risks / Trade-offs

- **无 CI 兜底**（D1=A）：本 change 修好的门禁仍可能在下次提交重新变红。已在 proposal 记录为单独立项；本 change 的基线表至少让"计数变化"可见。
- **改 `decideDelivery` 的 partial 条件会影响既有断言**：属预期内，但必须同步 `test-runner` 与 `cli` 两处测试，否则等于削弱检查。
- **`decideStageOutcome` 新增 `complete` 字样**可能与交付 complete 混淆。用独立类型（`StageStatus = "complete" | "partial" | "failed"`）并在报告字段名上区分（`stageStatus` vs `status`）。
- **`--limits` 从静默忽略改为报错**会打断任何依赖该旗标"能跑就行"的脚本——按现状它本来就没生效，报错比假装生效安全。
- **文档统一表述**可能被读成"降低门槛"。故要求每处修正都带证据链接（阶段文档 + 运行命令），不写成"已通过"。

## Migration Plan

无数据迁移。旧产物 `dist/` 需清理重建一次（`rm -rf packages/*/dist apps/*/dist && pnpm build`），因为清理前 `dist` 里的测试产物会让 `vitest run` 继续误执行。旧包的 CLI 行为变化（裸跑 `convert` 从退 2 变退 0）写入 `docs/development.md` 的 CLI 状态表。

## Verification / Exit Criteria

1. `pnpm generate:contracts && pnpm build && pnpm typecheck && pnpm test:all` 四步全绿；`find packages apps -path "*/dist/*" -name "*.test.*" | wc -l` 为 0。
2. 逐包用例数与 `docs/development.md` 的基线表一致；`pnpm test:all` 的总数等于逐包之和，且日志中无 "No test files found"。
3. 四条 CLI 行为用固定命令可复现（见 `tasks.md` §7）。
4. 文档一致性清单逐条通过（同一事实只有一种表述，且都带证据链接）。
