# Phase 0 审查报告: Baseline

> 日期: 2026-11-04
> 范围: `614b4fe..9b86daa`（6 个提交）
> 导航: [返回 review index](../index.md) | [查看修复 checklist](../fix-checklist.md)

## 审查对象与基线

| 项 | 值 |
| --- | --- |
| 仓库 | `bdmv2web` monorepo（11 个 workspace 包） |
| 上一轮评审基线 | `614b4fe`，结论见 [`docs/review-2026-11-04/index.md`](../index.md)（D1–D13 决策表） |
| 本轮 HEAD | `9b86daa` `docs: add README setup and usage guide` |
| 代码层改动 | 48 文件，+1142 / -184（排除 docs、openspec、`.agents/skills`） |
| 涉及包 | `apps/cli`、`bdmv-parser`、`core`、`hdmv`、`igs`、`media-export`、`package-builder`、`runtime-web`、`test-fixtures`、`test-runner` |
| 审查深度 | 针对 diff 的 systemic 复审：验证上一轮结论是否真正落地 + 新代码是否引入回归 |

## 本轮声称修复的内容（用于对照验证）

- D1/D2：P0 修复、`tsconfig.build.json` 拆分、`vitest include` 统一、`scripts/ci.sh` 门禁脚本。
- D4：`convert` 默认 `menu-only`、`--limits` 显式未实现、`--out`/`--title` 缺值报错、`--player-profile` 接线。
- D8：文档与仓库卫生（不在本 phase 展开）。
- D10：阶段状态与交付状态分离（`decideStageOutcome` / `classifyDiagnostics` / `exitCode`）。
- 额外（非 D 项）：INDX AppInfo/UHD 扩展、MPLS AppInfo、MPLS/CLPI 0x24 属性、CLPI header/sequence 解析；菜单页全屏布局与状态 toast；profile 穿透到浏览器运行时。

## 门禁实测

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `pnpm build` | 通过（11 包） | `tsconfig.build.json` 生效，`dist/` 内 `*test*` 产物计数 0 |
| `pnpm -r --no-bail typecheck` | 通过，`error TS` 计数 0 | 全量（含测试）走 `tsconfig.json` |
| `pnpm -r --no-bail test`（高负载并行时） | `apps/cli` 2 条超时、`media-export` 1 条失败 | 详见 [Phase 4](./phase-4-verification.md) |
| 单包重跑 `cli` / `media-export` | 28 passed / 51 passed + 1 skipped | 全绿，指向负载型抖动而非逻辑失败 |

复现环境: Node v24.18.0、pnpm 11.25.0（`corepack pnpm`，本机无常驻 `pnpm` shim，需自建 shim 供 workspace 脚本内的嵌套 `pnpm` 使用）。

## 本轮最容易漏掉的风险类型（先声明，后续 phase 逐项回报）

- 默认分支 / 未知输入：新增的 INDX/MPLS/CLPI 分支是否覆盖未知取值；CLI 是否覆盖未知参数。
- 异步失败路径：`report.json` 写入与事务 commit 的顺序；`validate` 的副作用顺序。
- 半完成状态窗口：`staging → report → commit`；`validate` 在参数校验前改写报告。
- 渲染 / 导出链路：菜单页全屏化后 canvas 与 video 的坐标一致性；状态提示的可见性。
- 隐式协议：`stageStatus` 与 `status` 的字段分工；`manifest.status` / `report.json.status` / `compatibility.status` 三处结论是否一致。

## 未覆盖区域

- 真实浏览器与真实碟片回归（`file://` 验收仍未验证，与本轮改动无关）。
- `compare` 命令、BD-J、FFmpeg 真实编码路径。
- 未注入 I/O 故障（`report.json` 写失败、`rename` 失败）。
