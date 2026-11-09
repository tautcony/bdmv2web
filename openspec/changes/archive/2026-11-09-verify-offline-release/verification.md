# 验收证据

执行环境：macOS，Node 24.18.0，pnpm 11.25.0。各任务的提交见 `git log -1 -- <artifact>`。

## 2.1a 共享决策表与 strict 退出码

| 字段 | 内容 |
| --- | --- |
| artifact | `packages/test-runner/src/release-summary.test.ts`（`delivery decision truth table`） |
| 命令 | `corepack pnpm --filter @bdmv2web/test-runner test` |
| 覆盖 | 全 pass → complete/0；仅 not-verified → complete/0 且逐条列入 `notVerified`；fail + not-verified → failed/1 且 `blockingChecks` 只含 fail；可达不支持 → partial，strict 2 / 非 strict 0；已确认 error → partial；纯 BD-J、fatal、缺必需资产 → failed/1 |
| 实际 | 52 passed（含新增 14 条） |
| 结论 | pass |

## X-AUDIT 检查结果聚合优先级

| 字段 | 内容 |
| --- | --- |
| 改动 | `release-summary.ts::summarizeCheckResult` 与 `report.ts::createDependencyAuditReport` 改为 `fail → not-verified → pass`，空集合 `not-verified` |
| artifact | `release-summary.test.ts`（`check result aggregation priority`，5 条） |
| 反例 | 临时还原旧顺序后同一组测试 2 条失败（`reports fail when fail and not-verified coexist`、`keeps fail ahead of not-verified…`），还原后 52 passed |
| 结论 | pass |

## X-COMPARE `compare` CLI 接线

| 字段 | 内容 |
| --- | --- |
| 改动 | `apps/cli/src/commands/compare.ts` 读取输入序列、实际 trace、可选参考 trace 与工具版本，删除 `E_NOT_IMPLEMENTED`；`program.ts` 增加 `--actual/--reference/--reference-tool/--reference-version/--out` |
| artifact | `apps/cli/tests/e2e/index.test.ts`（`compare command`，6 条） |
| 覆盖 | 一致 → 0；首处分歧 → 1（`comparison.index=0`、`/opcode`）；无参考 → 2 且 `referenceTrace: null`；参考与被测同一文件 → `COMPARE_REFERENCE_NOT_INDEPENDENT`；非法输入序列 / 缺失 actual → 1；`--out` 与 stdout 内容相同 |
| 实际 | 6 passed；完整 e2e 40 passed |
| 结论 | pass |

## 1.1 独立包检查

| 字段 | 内容 |
| --- | --- |
| artifact | `apps/cli/tests/e2e/index.test.ts`（`offline validate CLI`、`offline validate CLI (M6)`） |
| 覆盖 | 无 BDMV/FFmpeg 仍可审计；manifest 列出的必需资产缺失 → `PACKAGE_MISSING_ASSET` fail 且退出 1；`index.html` 未列入 manifest → `PACKAGE_ENTRY_UNLISTED` fail；无 payload 包写出 `DEPENDENCY_AUDIT_REQUIRED` |
| 实际 | 全部通过 |
| 结论 | pass |

## 1.2a 外部目标审计

| 字段 | 内容 |
| --- | --- |
| 改动 | `package-audit.ts` 新增 `auditExternalTargets`：`streamPath` 必须严格等于 `STREAM/<clipId>.m2ts`；绝对路径、`..`、反斜线、URL scheme、跨 clip 引用均判 `EXTERNAL_TARGET_UNDECLARED` fail；全部合法时记 `EXTERNAL_TARGETS_DECLARED` pass |
| artifact | `packages/test-runner/src/index.test.ts`（5 类负例 + 1 正例）、`apps/cli/tests/e2e/index.test.ts`（`accepts declared STREAM targets…`） |
| 保留 | `EXTERNAL_CONFIG` 仍为 `not-verified`：配置的 BDMV 实际路径与系统关联状态在包内不可观察 |
| 实际 | 52 passed（test-runner）、40 passed（e2e） |
| 结论 | pass |

## 4.2 离线包自动化验收

| 字段 | 内容 |
| --- | --- |
| artifact | `apps/cli/tests/e2e/index.test.ts`（`audits a moved package on a unicode path without ffmpeg on PATH`、`defaults to a sibling BDMV-menu output with a configurable BDMV path`）、`packages/runtime-web/src/browser.test.ts` |
| 覆盖 | 启动引用与静态 URL 审计；目录移动到含中文与空格的路径；编辑 `runtime/bdmv-config.js` 后 `EXTERNAL_CONFIG` 为 not-verified；`PATH=/nonexistent` 时 `validate --offline` 仍为 complete/0；`iina://` 目标构造与 `mpv_start`；无同步回执时释放 VM 等待（`routes a dynamic title to an external playlist and releases the VM wait`）；请求前自动静音与返回后恢复、手动静音保持 |
| 实际 | 该 e2e 用例 pass；`runtime-web` 相关用例 pass |
| 结论 | pass |
| 限制 | 不验证第三方程序是否真正打开文件，也不读取宿主文件系统；系统关联状态保持未验证 |
