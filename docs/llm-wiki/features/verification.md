# 功能：交付验证

验证层报告包内资源是否齐全，以及这次交付是否满足完成条件。两者由不同函数回答。

## 两条判定

| 判定 | 函数 | 输出字段 | 使用命令 |
| --- | --- | --- | --- |
| 阶段是否达成 | `decideStageOutcome` | `stageStatus` | `inspect`、`extract` |
| 交付是否完整 | `decideDelivery` | `status` | `build`、`validate` |

`inspect`/`extract` 永远不会输出 `status`；`build`/`validate` 也不会用 `stageStatus` 表达交付结论。

## 交付状态规则

```text
failed  ← 有 fail 检查 / 有 fatal / 无 HDMV 入口 / 缺必需资产
partial ← 可达性未解析 / 可达能力不支持 / 有 error（无 fatal）/ 诊断严重性未识别
complete← 以上都没有
```

关键点：

- **缺证据不降低状态**。未执行的检查、未提供的入口计数、未验证的覆盖率只进 `notVerified`。这类包的 `complete` 表示没有已知失败。
- **strict 只改变接受策略**。`partial` 在非 strict 下退出 0，strict 下退出 2；`failed` 始终 1；`complete` 始终 0。
- **acknowledged 的 error 仍是 partial**。确认只影响说明文字。
- **limitations 不参与判定**，只出现在 `reasons` 与报告说明里。

## 包审计

`auditOutputPackage(root)` 产出 `checks[]`，每项 `{ checkId, result: pass|fail|not-verified, message, path?, details? }`。

审计四类：

| 类别 | 例子 |
| --- | --- |
| 结构 | 根目录、`index.html`、`manifest.json`、manifest 形状、文件存在、无 symlink |
| 路径 | 相对 POSIX 路径、无重复、不占用报告路径、解析后仍在包内 |
| 引用 | 所有 `src`/`href`/`url()`/JSON 路径都指向包内普通文件；无外部 URL |
| 脚本 | 无 module script、无 `import`、无 `eval`、无网络 API；动态访问记 `not-verified` |

详见 [packages/test-runner.md](../packages/test-runner.md) 的检查项 ID 表。

## `build` 与 `validate` 的关系

| 项 | `build` | `validate` |
| --- | --- | --- |
| 输入 | 原 BDMV | 已生成的包目录 |
| 判定依据 | 解析/提取/适配诊断 + 入口计数 | 包审计 + `manifest.diagnostics` + 入口计数 |
| 写 `manifest.json` | 是（按 `decideDelivery` 结果） | 否 |
| 写 `report.json` | 是 | 否 |
| 写 `compatibility.json` / `dependency-audit.json` / `reports/release-summary.json` | 否 | 是，三者同源 |
| 结论标注 | `auditScope: "convert"` | `auditScope` 不参与判定 |

同一个包由两者判定应给出一致状态。若 `manifest.status` 与当前证据不一致：

1. 追加 `MANIFEST_STATUS_UNVERIFIED`（`not-verified`）。
2. 输出 `manifestStatus` 与真实 `decision.status`。
3. 不改写 `manifest.json`。

## 报告字段

### `manifest.json`

```json
{
  "schemaVersion": "1.0",
  "status": "complete",
  "declaredEntryCount": 3,
  "hdmvEntryCount": 3,
  "files": [{ "path": "index.html", "kind": "html", "required": true, "byteLength": "1234" }],
  "diagnostics": [{ "code": "...", "message": "...", "severity": "warning" }],
  "profile": { "...": "..." },
  "assets": { "sounds": [], "media": {}, "pgsTracks": [] },
  "limitations": ["..."]
}
```

`compatibility.json` 与 `asset-manifest.json` 是报告元数据，不出现在 `files`。

### `reports/release-summary.json`

```json
{
  "schemaVersion": "1.0",
  "release": { "status": "partial", "strict": false, "exitCode": 0, "reasons": [], "notVerified": [], "gaps": [] },
  "compatibility": { "status": "...", "checks": [] },
  "dependencyAudit": { "status": "...", "externalReferences": [], "checks": [] },
  "coverage": {},
  "checks": []
}
```

`gaps[]` 只列 `fail` 与 `not-verified`，带 `action` 说明要做什么。

## 证据类型

| 证据 | 产生方式 | 缺失时 |
| --- | --- | --- |
| 包审计 | `auditOutputPackage` | `PACKAGE_AUDIT_REQUIRED`（not-verified） |
| 依赖审计 | `createDependencyAuditReport` | `DEPENDENCY_AUDIT_REQUIRED` |
| 覆盖率 | `summarizeDeliveryCoverage` | 四维计数缺失，`COVERAGE_INCOMPLETE` |
| 对照证据 | `compareVmTraces` / `compareIgRgbaFrames` | `REFERENCE_EVIDENCE_REQUIRED` |

当前 `validate` 不读取历史对照证据，固定传空数组，因此对照证据总是 `not-verified`。这不会把 `complete` 降级。

## 常见判断

| 看到 | 含义 | 下一步 |
| --- | --- | --- |
| `status: complete` + 多条 `notVerified` | 没有已知失败，但证据不全 | 看 `notVerified` 决定补哪类证据 |
| `status: partial` + `MANIFEST_STATUS_UNVERIFIED` | manifest 写的是旧结论 | 以 `decision.status` 为准；重新生成或接受差异 |
| `status: failed` + `PACKAGE_MISSING_ASSET` | manifest 列了文件但磁盘没有 | 重新 `build`，或修生成逻辑 |
| `OFFLINE_URL_MISSING` | 运行时引用的资产没打包 | 检查 `asset-manifest.json` 与 `disc-data.js` 引用 |
| `BUNDLE_NETWORK_API` | 运行时代码出现网络 API | 改 `runtime-web`，不要改审计放行 |
| `BUNDLE_DYNAMIC_ACCESS` | 动态访问全局 | `not-verified`，需要人工确认该表达式不会取到网络 API |

## 证据边界

- 不校验内容哈希/指纹；报告只记录路径、类型、字节数。
