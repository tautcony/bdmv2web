# `@bdmv2web/test-runner`

交付判定层：审计菜单包、把检查项与诊断折算成状态、汇总覆盖率/对照证据，输出可复核的报告。不含业务包依赖，输入是文件与 JSON 事实。

## 文件

| 文件 | 内容 |
| --- | --- |
| `src/package-audit.ts` | `auditOutputPackage`、`inspectRuntimeUrl` |
| `src/decisions.ts` | `decideDelivery`、`decideStageOutcome`、`classifyDiagnostics`、`acknowledgeDiagnostic` |
| `src/coverage.ts` | `summarizeCoverage`、`summarizeDeliveryCoverage`、`isCoverageReportComplete` |
| `src/release-summary.ts` | `createReleaseSummary`：合并审计/依赖/覆盖/证据，产出 `gaps` |
| `src/types.ts` | `CheckResult`、`DeliveryStatus`、`OfflinePackageAudit` 等公共类型 |
| `src/compare.ts` | `compareVmTraces`、`compareIgRgbaFrames`、`videoQualityNote` |
| `src/report.ts` | `createCompatibilityReport`、`createDependencyAuditReport`、`createCompareReport` |

## 包审计

```ts
auditOutputPackage(inputRoot: string): Promise<OfflinePackageAudit>
inspectRuntimeUrl(raw: string): UrlAuditResult
```

审计内容：

1. 根目录存在、非 symlink、是目录。
2. 遍历文件：包内不允许 symlink、设备文件等非普通项。
3. `index.html` 必须存在；`manifest.json` 必须存在且可解析。
4. 校验 manifest 形状：`schemaVersion === "1.0"`、`files` 为数组、每项 `path` + `kind` 字符串。
5. 校验每个 manifest 条目：相对 POSIX 路径、无重复、不占用报告路径、`index.html` 必须 `required`、文件存在且是普通文件、解析后仍在包内。
6. 报告文件（`manifest.json`、`compatibility.json`、`dependency-audit.json`、`reports/*`）不得出现在 `manifest.files`。
7. 静态扫描 `.html`/`.css`/`.js`/`.mjs`/`.json`（跳过报告文件）：
   - 禁止 `type="module"`、`import`、`importScripts`、`eval`/`Function`、`fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`。
   - 提取 `src`/`href`/`poster`/`url(...)`/`@import`/JSON 中的 `url|src|href|relativePath`，逐个解析到磁盘。
   - 越界、symlink、非普通文件、缺失都判 `fail`；能定位到包内普通文件判 `pass`。
   - 动态访问（`globalThis[expr]`、计算 `setAttribute`）判 `not-verified`，不判失败。
8. `manifest.profile` 存在时，要求与 `compatibility.json`、`runtime/disc-data.js` 的 `profile` 一致，否则 `PLAYER_PROFILE_MISMATCH`。

### 检查项 ID

| 组 | ID |
| --- | --- |
| 根/遍历 | `PACKAGE_ROOT_MISSING`、`PACKAGE_ROOT_INVALID`、`PACKAGE_DIRECTORY_UNREADABLE`、`PACKAGE_SYMLINK`、`PACKAGE_FILE_TYPE` |
| 入口/清单 | `PACKAGE_ENTRY_MISSING`、`PACKAGE_ENTRY_OPTIONAL`、`PACKAGE_ENTRY_UNLISTED`、`PACKAGE_UNLISTED_PAYLOAD`、`MANIFEST_MISSING`、`MANIFEST_UNREADABLE`、`MANIFEST_INVALID_JSON`、`MANIFEST_SCHEMA`、`MANIFEST_DUPLICATE_PATH`、`MANIFEST_PATH_RESERVED` |
| 路径/文件 | `PACKAGE_PATH_INVALID`、`PACKAGE_PATH_ESCAPE`、`PACKAGE_FILE_INVALID`、`PACKAGE_MISSING_ASSET`、`PACKAGE_OPTIONAL_ASSET_MISSING` |
| 静态离线 | `OFFLINE_URL_LOCAL`、`OFFLINE_URL_MISSING`、`OFFLINE_URL_ESCAPE`、`OFFLINE_URL_SYMLINK`、`OFFLINE_URL_NOT_FILE`、`OFFLINE_EXTERNAL_URL`、`OFFLINE_UNSAFE_URL`、`OFFLINE_STATIC_AUDIT` |
| 脚本 | `BUNDLE_MODULE_SCRIPT`、`BUNDLE_IMPORT`、`BUNDLE_EVAL`、`BUNDLE_NETWORK_API`、`BUNDLE_DYNAMIC_ACCESS`、`BUNDLE_DYNAMIC_URL_SINK` |
| 扫描预算 | `RUNTIME_FILE_TOO_LARGE`、`RUNTIME_FILE_UNREADABLE` |
| 档案一致性 | `PLAYER_PROFILE_INVALID`、`PLAYER_PROFILE_MISMATCH`、`PLAYER_PROFILE_SYNC` |
| 外部配置 | `EXTERNAL_CONFIG`、`EXTERNAL_CONFIG_INVALID` |

## 状态判定

### 交付（`decideDelivery`）

| 输入事实 | 结果 |
| --- | --- |
| 任一 `fail` 检查 / `fatal` 诊断 / 无 HDMV 入口 / 缺失必需资产 | `failed`，退出码 1 |
| 可达性有未解析项 / 可达能力不支持 / 有 `error`（无 fatal）/ 诊断严重性未识别 | `partial`，`--strict` 时退出码 2 |
| 以上都没有 | `complete`，退出码 0 |

`notVerified` 只记录缺失证据，**不降低状态**：没有检查（`NO_AUDIT_CHECKS`）、没给入口计数（`ENTRY_COUNTS_MISSING`）、能力事实不全（`CAPABILITY_FACTS_INCOMPLETE`）、所需证据不全（`REQUIRED_EVIDENCE_INCOMPLETE`）、覆盖率不全（`COVERAGE_INCOMPLETE`）。

`acknowledged` 的 `error` 仍保持 `partial`；确认只影响说明，不提升状态。

### 阶段（`decideStageOutcome`）

| 诊断 | `stageStatus` | 退出码 |
| --- | --- | --- |
| 有 `fatal` | `failed` | 1 |
| 有 `error` 无 `fatal` | `partial` | `--strict` 时 2，否则 0 |
| 都没有 | `complete` | 0 |

`StageStatus` 与 `DeliveryStatus` 是两个品牌类型，`inspect`/`extract` 只输出 `stageStatus`，不输出 `status`。

## 报告

| 函数 | 产物 |
| --- | --- |
| `createCompatibilityReport(audit, decision, coverage)` | `compatibility.json`：`status`、`checks`、`coverage`、`notVerified` |
| `createDependencyAuditReport(audit)` | `dependency-audit.json`：`OFFLINE_*` 检查与 `externalReferences` |
| `createReleaseSummary(input)` | `reports/release-summary.json`：`release.{status,strict,exitCode,reasons,notVerified,gaps}` + `compatibility` + `dependencyAudit` + `coverage` + `checks` |

`createReleaseSummary` 会忽略各报告的存储状态，用新鲜事实重算：

- 没有审计检查 → 补 `PACKAGE_AUDIT_REQUIRED`（`not-verified`）。
- 没有依赖检查 → 补 `DEPENDENCY_AUDIT_REQUIRED`。
- 没有覆盖率 → 四个维度都按缺证据处理。
- 没有对照证据 → `REFERENCE_EVIDENCE_REQUIRED`。

`gaps` 只列 `fail` 与 `not-verified`，附 `action`（要做什么）与路径/实体。

## 覆盖与证据

- `summarizeCoverage({ total, covered, ... })` → `{ covered, total, ratio, complete }`；`REQUIRED_COVERAGE = ["entries","instructions","media","tests"]`。
- 对照证据：`compareVmTraces(reference, actual)` 逐事件比较，首个差异返回索引与期望/实际；`compareIgRgbaFrames` 比较尺寸与像素，输出差异计数与最大通道差；`videoQualityNote` 明确视频编码质量不在 IG 像素比较范围内。

## 测试

`src/index.test.ts`（审计主路径）、`coverage.test.ts`、`compare.test.ts`、`release-summary.test.ts`。

## 改动入口

| 需求 | 位置 | 同步 |
| --- | --- | --- |
| 新增审计项 | `package-audit.ts` 的 `add(...)` | 上面的检查项表、`openspec/changes/verify-offline-release/specs/offline-delivery-assurance/spec.md` |
| 改状态规则 | `decisions.ts` | `openspec/specs/cli-delivery-status/spec.md` 的「结论只由失败证据决定」 |
| 改报告字段 | `report.ts` / `release-summary.ts` | `packages/cli` 的 `validate` 写盘、`docs/guides/development.md` |

不要引入 SHA-256、内容指纹或字节级校验来强化判定；本仓库明确不使用这类检查。
