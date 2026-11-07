# Phase 4 审查报告: 验证与门禁

> 日期: 2026-11-04
> 后续状态（2026-11-05）: 三个目标包已设 15000ms，`scripts/ci.sh` 与根脚本改用 `corepack pnpm`，仓库新增 `.github/workflows/ci.yml`。本机门禁通过记录见 [index](../index.md)；GitHub Actions 首次运行仍待确认。以下为原始审查时的基线事实。
> 范围: `scripts/ci.sh`、各包 `tsconfig.build.json` / `vitest.config.ts`、门禁实测
> 发现: P0(0) / P1(0) / P2(1) / INFO(1)
> 导航: [返回 review index](../index.md) | [查看修复 checklist](../fix-checklist.md)

## 已审查文件

- `scripts/ci.sh`（新增）、`package.json`、11 个包的 `tsconfig.build.json`、`vitest.config.ts`（`hdmv` / `test-runner` / `package-builder` / `runtime-web`）

## 门禁实测（本机，Node v24.18.0 / pnpm 11.25.0）

```text
pnpm build                      → exit 0（11 包全部 Done）
pnpm -r --no-bail typecheck     → exit 0，error TS 计数 0
pnpm -r --no-bail test（空载）  → exit 0，451 passed / 1 skipped
pnpm -r --no-bail test（高负载）→ 1 fails / 10 passes（cli 2 条超时 + media-export 1 条）
```

空载逐包结果：

| 包 | 用例 |
| --- | --- |
| core | 14 passed |
| test-runner | 50 passed |
| test-fixtures | 5 passed |
| bdmv-io | 7 passed |
| bdmv-parser | 65 passed |
| hdmv | 74 passed |
| media-export | 51 passed / 1 skipped |
| package-builder | 10 passed |
| igs | 54 passed |
| runtime-web | 93 passed（`tamako-headless-navigation` 单条 ~47s） |
| apps/cli | 28 passed |

## 已确认落地（D1/D2）

- `dist/` 内 `*test*` 文件计数为 0：`tsconfig.build.json`（`exclude: ["**/*.test.ts", "**/*.test-d.ts"]`）生效，产物编译与测试编译已分离。
- `hdmv` 补上 `vitest.config.ts`（`include: ["src/**/*.test.ts"]`），不再重复执行 `dist/*.test.js`；`test-runner` / `package-builder` / `runtime-web` 的 `include` 也已补齐，"441 用例里含 dist 重复"的口径问题消失。
- `scripts/ci.sh` 与平台无关（`PNPM="${PNPM:-pnpm}"`，可被覆盖），顺序为 install → generate → build → typecheck → test，`set -euo pipefail` + 逐步计时，符合 D1 的"门禁可复现"落地拆分。
  - **修复轮更正（2026-11-05）**：默认值已改为 `PNPM="${PNPM:-corepack pnpm}"`（按数组解析，`PNPM=pnpm` 仍可覆盖）；根 `package.json` 的 5 个脚本同步改为 `corepack pnpm …`。原因见下方"环境备注"的失败模式，实测结果见 [Phase 4 未覆盖区域](#未覆盖区域) 的更正段落。

## Findings

### P4-P2-1: [P2] 默认 5s 超时让 CLI 重用例在负载下假失败，门禁具备"红灯噪声"

- 位置: `apps/cli/src/index.test.ts:130`（默认输出目录转换）、`:290`（结构提取）。所有包的 `vitest.config.ts` 都**没有全局 `testTimeout`**，这两条因此落到 vitest 默认 5000ms。
- 已排除（2026-11-05 更正）: 最慢单条 ~47s 的语料回归在 **`runtime-web`**，不是 `hdmv`；该用例 `packages/runtime-web/src/tamako-headless-navigation.test.ts:214` 已显式写 `}, 120_000)`，同类还有 `hdmv-navigation-corpus-dfs.test.ts:34`。它们不受 5s 默认值影响，也不是本次假失败的对象。
- 触发条件: 与其它重活并行时（本次为 3 个审查 agent + 另一个 `-r test` 同时跑）
- 实测: CLI 两条用例分别 5821ms / 5876ms 撞上 5000ms 超时；`media-export` 另有 1 条失败（日志被截断，未保留首行，**是否超时未确认**）。**空载重跑同一命令 exit 0、451 passed**，两个包单独重跑也全绿（28/28、51 passed+1 skipped）。
- 影响: 门禁在共享 runner / 并行任务下会产生假红灯。刚修好的"门禁可信"很容易被这类抖动重新破坏——而这正是 D1 想解决的问题。
- 置信度: 高（同一命令同一提交，负载差异导致结果不同；失败点与默认值吻合）
- 修复方向: 对 `apps/cli`、`media-export` 显式设置 `testTimeout`（按实测 2–3 倍余量，取 15000ms）。`runtime-web` 可同样设 15000ms 作为默认值，但三条语料用例的 per-test `120_000` 优先，不会被缩短；`hdmv` 没有实测慢例，不需要设。`ci.sh` 里对 `test:all` 保持串行（当前 `-r` 已是串行，但同机其它任务仍会争抢 CPU）。

### P4-INFO-1: [INFO] 仍未接入任何流水线（原始审查时）

- 位置: 仓库根（原审查提交无 `.github/`、无其它 CI 配置）
- 事实: 与 D1 的决策一致（"流水线单独立项"）。后续已新增 GitHub Actions workflow；当前等待首次运行证据。

## 漏检复盘

- 默认分支 / 未知输入: `ci.sh` 对 `PNPM` 不可用时会在第一步失败并给出明确 `Gate failed at:`，无静默降级。**未发现新问题**。
- 异步失败 / 前提失效: 不适用。
- 半完成状态 / 重建窗口: 不适用。
- 渲染 / 导出 / 编码: `build:core-browser` 与 `esbuild` 打包产物随 build 一起生成，未单独校验产物字节。**证据不足**（未比对 bundle 内容）。
- 隐式协议: `typecheck` 用全量 `tsconfig.json`（含测试），`build` 用 `tsconfig.build.json`——两者分离正确，但 `package-builder` 仍直接引用 `runtime-web/src/browser.ts`（D7 未做），意味着 `tsc` 类型检查会跨包解析源码；本轮 build 通过，未暴露问题。

## 未覆盖区域

- 原审查未在干净容器运行 `scripts/ci.sh`；修复轮将脚本与根脚本统一改为 `corepack pnpm`，并在本机记录一次脚本通过。GitHub runner 首次运行待验证。
- 未跑 `compare` 命令与 FFmpeg 真实编码。
- 未比对生成 bundle 的字节/体积变化（菜单页 CSS 大幅改动 + 新增 toast 逻辑）。

> 原始环境备注（已处理）：本机曾只有 `corepack`、没有 `pnpm` shim，导致旧脚本嵌套调用失败。修复轮改为显式 `corepack pnpm` 后，本机门禁记录通过；远端 workflow 结果待确认。
