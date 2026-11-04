# Proposal

## Why

`master`（`614b4fe`）当前构建门禁是红的：`packages/test-runner/src/index.test.ts:109-118` 有整段重复粘贴导致 `"await" can only be used inside an "async" function`，`packages/runtime-web/src/igs-adapter.test.ts:14` 的夹具缺 `IgsButton.numericSelectValue`。`build` 2 失败、`typecheck` 失败、`test-runner` 的 `index.test.ts` 整文件（20 条用例）无法加载。同时 `extract` 对 `fatal` 诊断仍提交 staging 并 `exit 0`，CLI 退出码与 [实施基线](../IMPLEMENTATION_BASELINE.md) §3/§4 的状态表直接冲突；`convert` 默认 `--mode standalone-full` 但只实现 `menu-only`，裸跑恒定 `exit 2`。

这些都不是设计分歧，而是"声明与事实不一致"：门禁声称通过、文档声称未实现/已实现、退出码声称区分状态，实际都对不上。本 change 只做让事实与声明对齐的最小集合。

## What Changes

- **恢复门禁**：删除重复块、补夹具字段，使 `build` / `typecheck` / `test` 重新可归因；同时落一份平台无关门禁脚本 `scripts/ci.sh`。CI **流水线**不在本 change（决策 D1=A，单独立项）——脚本是它的承接物，不是流水线本身。
- **分离构建与类型检查作用域**：每包新增 `tsconfig.build.json`（排除测试），`build` 不再把 `*.test.ts` 编译进 `dist/`（当前 70 个测试产物），`typecheck` 仍覆盖含测试的全量源码。
- **统一测试入口**：脚本字面统一为 `vitest run`，作用域由各包 `vitest.config.ts` 锁定，杜绝 `dist/*.test.js` 被重复执行与聚合跑漏用例。
- **CLI 失败状态与退出码**：`inspect` / `extract` / `convert` 共用一套诊断分类；`fatal` 一律 `failed` / `exit 1` 且不提交输出；strict 只改变接受策略。
- **单一产物形态**：`convert` 只保留 `menu-only`，`--mode standalone-full` 显式拒绝；`mode` 不再作为"不完整"的判定依据（否则 complete 永远不可达）。
- **参数契约明确**：`--out` 缺值报参数错误；`--player-profile` 真正生效；`--limits` 在 D3 接线前不静默忽略。
- **文档与仓库卫生**：修正 `development.md` 的 CLI 状态、`igs-support.md` 的 Tamako 结论、M6 的测试计数、架构文档的旧包布局；`.gitignore` 补 `.DS_Store`；大二进制不动。

## Capabilities

### New Capabilities

- `workspace-build-gate`：构建/类型检查/测试入口的作用域与可归因性。
- `cli-delivery-status`：阶段结果与交付状态分离、退出码与参数契约。

### Modified Capabilities

无；本 change 不改变已声明能力的业务语义（只让既有声明变成事实）。`offline-delivery-assurance` 的降级由同批次之后的 change 处理。

## Impact

`packages/test-runner`、`packages/runtime-web`、`apps/cli`、全部包的 `tsconfig*.json` / `package.json` / `vitest.config.ts`、根 `package.json`、`docs/development.md`、`docs/igs-support.md`、`docs/references/stages/M6-release-verification.md`、`bdmv_hdmv_offline_web_architecture.md`、`.gitignore`。

## Acceptance Boundary

本 change 完成的条件是"可复核的事实一致"，不是新功能：`generate:contracts` → `build` → `typecheck` → `test:all` 四步全绿且 `dist` 无测试产物；四条 CLI 行为（空 BDMV extract 退 1、裸跑 convert 退 0、`--mode standalone-full` 退 1、`--out` 缺值退 1）可被同一组命令复现；文档中不再存在互相矛盾的同一事实。

**明确不在本 change**：CI workflow（D1=A 单独立项）、`payloadFingerprint` 与证据绑定（D9）、性能基准与热点修复（D5）、契约常量收敛（D3）、源位置保真（D12）。

## Related

决策来源：[`docs/code-review.md`](../../../docs/code-review.md) 第 1 批（D1、D2、D4、D8、D10）。第 2 批见 [`converge-contracts-and-distribution`](../converge-contracts-and-distribution/proposal.md)。

评审里标 `⚠需确认` 但本 change 已按某个假设推进的 6 项，见 [`assumptions.md`](assumptions.md)——每条都写了反选后的改动点。
