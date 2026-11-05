# Review Findings Fix Checklist

> 来源: [`docs/review-2026-11-04/`](./index.md)
> 最后更新: 2026-11-05
> 决策: 4 组待决问题已于 2026-11-05 确认，见 [`decisions.md`](./decisions.md)；另有 D-12 / D-13 两条默认假设（`P2-P2-6`、`P2-P2-7`）。**本轮已按决策落地实现**，逐条证据见各条目末尾的「落地证据」
> 状态约定: `[ ]` 未开始 · `[~]` 部分完成/范围缩小 · `[x]` 全部必需步骤完成且有验证证据 · `N/A` 不适用（注明原因） · `挂起` 条件触发
> 本轮结论（2026-11-05 后续推进）: 25 条 finding 中 **17 条已完成**、6 条部分完成、1 条挂起、1 条未开始。部分完成项已落代码或 CI 配置，仍缺回归测试 / 首次流水线证据；详见各条备注。

## 进度总表

| Finding | 级别 | 状态 | 一句话结论 |
| --- | --- | --- | --- |
| `P1-P1-1` | P1 | [x] | 可选 UHD/AppInfo 元数据损坏只降级为 warning，`entries` 保留 |
| `P1-P2-1` | P2 | [x] | 扩展区上界改为文件长度，声明长度只做诊断 |
| `P1-P2-2` | P2 | [x] | CLPI 长度字段不自洽改为 warning，不再整条丢弃 |
| `P2-P2-1` | P2 | [x] | `validate` 先校验参数再落盘，参数错误零副作用 |
| `P2-P2-2` | P2 | [x] | 未知/拼错选项报 `CLI_UNKNOWN_OPTION`，多余位置参数报 `CLI_USAGE` |
| `P2-P2-3` | P2 | [x] | 生成菜单即 `complete`，三处结论同源，缺证据进 `notVerified` |
| `P2-P2-4` | P2 | [x] | profile 按 PSR 规则校验，非法值报 `CLI_INVALID_PROFILE` |
| `P2-P2-5` | P2 | [x] | 失败 `report.json` 与成功同 schema |
| `P2-P2-6` | P2 | [x] | 落盘 `dependency-audit.json` 与 stdout 同源 |
| `P2-P2-7` | P2 | [x] | mode 回退 manifest → report → 记 `PACKAGE_MODE_ASSUMED` |
| `P3-P2-1` | P2 | [x] | 关键提示常驻且可选中复制 |
| `P3-P2-2` | P2 | 挂起 | 无比例不等样本，仅记录文档限制（D-4） |
| `P4-P2-1` | P2 | [~] | 三包超时已设 15000ms；门禁已有一次通过记录，CI 连跑待首次触发 |
| `P1-INFO-1` | INFO | [x] | 0x24 注释改为"仅建模 dynamic range / colour space" |
| `P1-INFO-2` | INFO | [~] | optional section warning 回退到区段起始偏移；缺回归测试 |
| `P1-INFO-3` | INFO | [x] | 真实 UHD 样本 0x24 取值已断言 |
| `P2-INFO-1` | INFO | [ ] | 无 fatal 生产者，观察项不动 |
| `P2-INFO-2` | INFO | [x] | 阶段失败统一输出 `stageStatus` |
| `P2-INFO-3` | INFO | [x] | `extract` 先判 fatal 再扫 IGS |
| `P2-INFO-4` | INFO | [x] | 删除 `PLAYER_PROFILE_KEYS` / `reportedStatus`，未用字段加注释 |
| `P3-INFO-1` | INFO | [x] | 删除 `#disc-title` 死代码，标题只留 `<title>` |
| `P3-INFO-2` | INFO | [~] | HDMV VM 默认 profile 改用 core 导出值；缺 parity 回归测试 |
| `P3-INFO-3` | INFO | [~] | audit 校验 manifest profile 与运行时数据一致；缺篡改和旧包回归测试 |
| `P3-INFO-4` | INFO | [~] | 启动菜单前先设置 canvas backing size；缺首帧尺寸回归测试 |
| `P4-INFO-1` | INFO | [~] | 已新增 GitHub Actions 门禁；等待首次流水线成功 |

## P1-P1-1 — [P1] 可选 UHD 元数据解析失败会把整个 index 升级为 fatal

- 来源: [`phases/phase-1-format-parsing.md`](./phases/phase-1-format-parsing.md)
- 位置: `packages/bdmv-parser/src/parser.ts` `parseIndexAppInfo` / `parseIndexUhdExtension` / `parseIndex`
- 批次: Batch A1 · 总体状态: [x]
- 影响摘要: 一个可选 HDR 字段损坏 → `entries` 为空、`inspect/extract/convert` 全部 exit 1 且无产物

### Checklist
- [x] 复现/确认触发条件：构造 `buildM1Index({uhd:{discType:5}})` 并篡改扩展长度字段，确认 `entries.length === 0` 与 `BDMV_REQUIRED_FILE_MISSING`
- [x] 实施修复：AppInfo/UHD 解析包成 `optionalSection(...)`（内部 catch）→ 返回 null + `warning` 诊断；index 主 section 保持 critical
- [x] 回归测试：把原"rejects an INDEX UHD extension…"改为 `keeps navigation entries when the optional INDEX UHD metadata is damaged`（断言 `entries.length === 2`、`uhd === null`、存在 warning），并补 payload 截断 / `address + entryLength` 越界 / 未知 entry type 三个分支
- [x] 相邻路径验证：`discInfo: { appInfo: DiscAppInfo | null; uhd: UhdMetadata | null }`（`model.ts:57`）在类型上已允许 null，全仓无第二个 `discInfo` 消费者（`grep` 仅命中 `model.ts` 与 `parser.ts:522`），下游不会解引用
- [x] 验证命令与证据：`corepack pnpm --filter @bdmv2web/bdmv-parser test` → **69 passed**；`battle-royale-uhd` 语料仍解析出 24 个 entry
- [x] 补充文档动作：`openspec/specs/bdmv-disc-inspection/spec.md` 新增 Requirement「可选元数据不得决定可读性」+ 3 场景
- 落地证据: `parser.ts` 新增 `Warn` / `ignoreWarning` / `optionalSection`，`parseBdmv` 注入 `warn` 回调（`severity: "warning"`）
- 最后更新: 2026-11-05

## P1-P2-1 — [P2] 扩展区上界用声明长度而非文件长度

- 来源: [`phases/phase-1-format-parsing.md`](./phases/phase-1-format-parsing.md)
- 位置: `parser.ts` `parseIndexUhdExtension` · 批次: **Batch A5** · 决策: [D-3](./decisions.md)（放宽） · 总体状态: [x]
- 影响摘要: `length` 少报的盘会被误判为损坏（libbluray 以文件尾为上界）

### Checklist
- [x] 决策：放宽 vs 维持严格 → **对齐 libbluray 放宽**（2026-11-05，D-3）
- [x] 复现/确认触发条件：构造 `length` 少报但 entry 仍在文件内的 index
- [x] 实施修复：entry/payload 上界改为 `dataLength`，`length` 只做一致性诊断（新 warning `BDMV_DECLARED_LENGTH_MISMATCH`；`address + entryLength > declaredEnd` 同样告警而不是抛错）
- [x] 保留越界保护：读前仍校验 `address < 4 || address + entryLength > dataLength` → `throw new ContractError("BDMV_INVALID_SECTION")`
- [x] 回归测试：新增 `bounds the INDEX extension by the file length, not the declared length`（`length: 8` 的少报样本仍解析出 entry，并带 warning）
- [x] 相邻路径/兼容性验证：`battle-royale-uhd` 真实样本结果不变（`clips.length >= 13`、MPLS `00006` / CLPI `00011` 的 0x24 取值不变）
- [x] 验证命令与证据：`corepack pnpm --filter @bdmv2web/bdmv-parser test` → 69 passed
- [x] 发布/监控/文档：`bdmv-disc-inspection` spec 新增场景「声明长度不自洽只降级为诊断」
- 最后更新: 2026-11-05

## P1-P2-2 — [P2] CLPI seq/TS 长度硬校验会整条丢弃"字段不自洽但可播"的 CLPI

- 来源: [`phases/phase-1-format-parsing.md`](./phases/phase-1-format-parsing.md)
- 位置: `parser.ts` `parseClpi` · 批次: **Batch A6** · 决策: [D-3](./decisions.md)（放宽） · 总体状态: [x]
- 影响摘要: 丢失 CLPI → `BDMV_MISSING_CLPI`、graph/media plan 退化

### Checklist
- [x] 决策：放宽 vs 维持严格 → **放行 + warning**（2026-11-05，D-3）
- [x] 复现/确认触发条件：构造 `seqLen<2` 或 `tsTypeLength<5` 但记录在文件内的 CLPI
- [x] 实施修复：`tsTypeLength` 不自洽 → warning 且跳过 TS type id（不再整条丢 CLPI）；`seqLen` 不自洽 → warning，计数上界改用 `data.length`（`sequenceLimit`）
- [x] 保留越界保护：`atcCount` 超过文件长度仍然 `throw`（`still rejects a CLPI whose ATC count exceeds the file`）
- [x] 回归测试：三条用例分别覆盖 TS type 长度越界、ATC 序列长度少报、ATC 计数超文件
- [x] 相邻路径/兼容性验证：两张真实碟（baja / tamako）解析出的 clip 未减少，导航用例结果不变
- [x] 验证命令与证据：`corepack pnpm --filter @bdmv2web/bdmv-parser test` → 69 passed
- [x] 发布/监控/文档：`bdmv-disc-inspection` spec 同步
- 最后更新: 2026-11-05

## P2-P2-1 — [P2] `validate` 在校验 `--format` 之前已改写包内报告

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)
- 位置: `apps/cli/src/index.ts` `validate()` · 批次: Batch A3 · 总体状态: [x]
- 影响摘要: 命令 exit 1，但 `dependency-audit.json` / `compatibility.json` / `reports/release-summary.json` 已被覆盖

### Checklist
- [x] 复现/确认触发条件：`validate PKG --offline --format` → exit 1 且三份报告 mtime 变化
- [x] 实施修复：在任何写操作前解析 `--format`（只接受 `json`，否则 `CLI_INVALID_FORMAT`）；`--strict` 统一走 `strictDefault()`
- [x] 回归测试：新增 `does not write any report when validate arguments are invalid`（断言三份报告与原字节一致）
- [x] 相邻路径验证：正常 `validate` 与 `--strict` 输出不变（baja `complete` exit 0、tamako `partial` exit 2）
- [x] 验证命令与证据：`corepack pnpm --filter @bdmv2web/cli test` → 33 passed
- [x] 发布/监控/文档：README 的 validate 用法补 `--format` 取值说明
- 最后更新: 2026-11-05

## P2-P2-2 — [P2] 未知/拼错选项被静默忽略

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)
- 位置: `apps/cli/src/index.ts` `commandOptions` / `validateCommandLine` / `main()` · 批次: Batch A2 · 总体状态: [x]
- 影响摘要: `--stric` 绕过 strict；`--ou` 把包写到默认目录；违反 spec「不得静默忽略」

### Checklist
- [x] 复现/确认触发条件：`inspect INPUT --stric`（exit 0）、`convert DISC --ou /tmp/x`（写到 `BDMV-menu`）
- [x] 实施修复：命令级 `commandOptions` 白名单（flags + values）；未知 `--*` 报 `CLI_UNKNOWN_OPTION` 并 exit 1；位置参数 >1 报 `CLI_USAGE`；在命令分发前统一调用
- [x] 回归测试：`rejects misspelled options and extra positionals instead of ignoring them`（`--stric` / `--ou` / 多余位置参数）+ `keeps every accepted option of each command working`（防误判）
- [x] 相邻路径验证：`--allow-partial`、`--offline`、`--no-strict`、`--format json` 等既有旗标全部仍在白名单内
- [x] 验证命令与证据：`corepack pnpm --filter @bdmv2web/cli test` → 33 passed（原 28）
- [x] 发布/监控/文档：README 命令行说明列出支持选项与报错行为
- 最后更新: 2026-11-05

## P2-P2-3 — [P2] `convert` 交付状态恒定 partial，且三处结论源并存

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)
- 位置: `apps/cli/src/index.ts`、`test-runner/src/decisions.ts`、`package-builder/src/index.ts` · 批次: Batch B2 · 决策: [D-2（已修订）](./decisions.md) · 总体状态: [x]
- 影响摘要: 菜单已生成却恒为 `partial`；`manifest.status` 硬编码，三处结论各自写入

### Checklist
- [x] 决策 1：允许 `complete` —— **生成出菜单就不算 partial，算 complete**（2026-11-05 09:35）
- [x] 决策 2：**`not fully verified` / `not-verified` 不算阻碍项**，只有失败证据才阻断（2026-11-05 09:40）
- [x] 决策 3：**完整 BDMV 生成后必须能通过校验**，以 baja（バジャのスタジオ）真实碟为验收标准
- [x] 复现/确认触发条件：`convert` → `partial`；`validate --offline --format json` → `partial`，7 条理由中 4 条是缺证据
- [x] 实施修复 1：从 `partialConditions` 移出缺证据类条件 → 只保留 `hasUnresolvedReachability === true`、`hasUnsupportedReachableCapability === true`、`errorDiagnostic && !failedDiagnostic`、未知 severity
- [x] 实施修复 2：保留 `=== true` 的失败条件（unresolved reachability / unsupported capability / missing asset）
- [x] 实施修复 3：返回新增 `notVerified: string[]`（未验证 checkId、`NO_AUDIT_CHECKS`、`ENTRY_COUNTS_MISSING`、`CAPABILITY_FACTS_INCOMPLETE`、`REQUIRED_EVIDENCE_INCOMPLETE`、`COVERAGE_INCOMPLETE`），不影响 status
- [x] 实施修复 4：移除 `input.limitations?.length` 判定条件，limitations 只作说明
- [x] 实施修复 5：reasons 不再输出缺证据类文案（`"No audit checks were supplied."` 等）
- [x] 实施修复 6：`hasMissingRequiredAsset: false` 加注释（`buildMenuPackage` 已成功返回）
- [x] 实施修复 7：`MenuPackageStatus = "failed" | "partial" | "complete"`；`buildMenuPackage` 接收 `status`，metadata 与 manifest 同源
- [x] 实施修复 8：builder 补写 `declaredEntryCount` / `hdmvEntryCount` 到 manifest（不参与判定，供报告引用）
- [x] 实施修复 9：`report.json` 增加 `auditScope: "convert"`（仅标注来源，不影响判定）
- [x] 必须改：`createReadme` 的 `always **partial**` 改为按 status 动态措辞（`Its delivery status is **${status}**. \`complete\` means no known failure was found…`）
- [x] 回归测试：重写 convert 用例；新增"只有 not-verified、无 fail → complete"；`test-runner/src/index.test.ts` 的 `checks: []` 改为 `complete` + `notVerified`
- [x] 验收（正例）：`convert "…バジャのスタジオ" --strict` → `{"status":"complete"}` exit 0；`validate --offline --format json --strict` → `release.status=complete`、`exitCode=0`、`notVerified` 12 项不阻断
- [x] 验收（反例）：`convert tamako-love-story-bd` → `partial`（37 条 error 诊断仍是 error，不进 notVerified）；`validate --strict` → exit 2
- [x] 相邻路径验证：`validate` 不回写 `manifest.status`；不一致时 stdout 给 `manifestStatus` 并追加 `MANIFEST_STATUS_UNVERIFIED`（`not-verified`）
- [x] 不要改：`cli-delivery-status/spec.md` 的「无缺口时退出 0」「状态可为 complete」保持原文
- [x] spec 新增澄清：新增 Requirement「结论只由失败证据决定」（未验证不阻断、失败证据阻断、`auditScope` 只标注、manifest 不回写、limitations 只说明）
- [x] 验证命令与证据：`bdmv-parser` 69 / `test-runner` 51 / `package-builder` 10 / `cli` 33 全绿
- 落地证据: 关键修复在于 `convert` 把带 `severity` 的 diagnostics 写进 manifest，`validate` 回读同一份证据 —— 否则 tamako 会在校验时从 `partial` 变成 `complete`
- 最后更新: 2026-11-05

## P2-P2-4 — [P2] `--player-profile` 校验弱于 PSR 规则，非法值报 `E_IO`

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)
- 位置: `apps/cli/src/index.ts` `loadPlayerProfile` / `profileWordField` vs `packages/hdmv/src/registers.ts` · 批次: Batch B3 · 决策: [D-11](./decisions.md) · 总体状态: [x]
- 影响摘要: `country:"USA"` 等语义非法值绕过 CLI 校验，最终以 `E_IO` 退出，与文档承诺不符

### Checklist
- [x] 决策：**参数期复用 `profileWord` 规则**，报 `CLI_INVALID_PROFILE`（2026-11-05，D-11）
- [x] 复现/确认触发条件：`--player-profile` 传 `{"country":"USA"}` → `E_IO`
- [x] 实施修复：`registers.ts` 的 `profileWord` 改为 export，CLI 用 `profileWordField` 按 3/3/3/2 宽度与 ASCII 校验，并规范化大小写（不采用"捕获 VM 错误再转换"）
- [x] 回归测试：四类非法值（`USA`、`jp`、`eng `、`日本語`）→ `CLI_INVALID_PROFILE`、无 `E_IO`、不创建目录；大小写规范化断言 `eng` / `US` 写入 manifest
- [x] 相邻路径验证：合法 profile 仍写入 `manifest.profile` 与 `runtime/disc-data.js`
- [x] 验证命令与证据：`corepack pnpm --filter @bdmv2web/cli test` → 33 passed
- [x] 发布/监控/文档：`docs/development.md` 与 README 的 profile 字段规则改成 PSR 口径（3/3/3/2 ASCII + 大小写规范化）
- 最后更新: 2026-11-05

## P2-P2-5 — [P2] 失败 `report.json` 与成功路径是两套 schema

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)
- 位置: `apps/cli/src/index.ts` `failMenuConversion` · 批次: Batch A4 · 总体状态: [x]
- 影响摘要: 失败报告缺 `reasons`/`blockingDiagnostics`，诊断丢 `severity`，消费方无法统一判断

### Checklist
- [x] 复现/确认触发条件：构造无 IGS scene 的碟，比对两份 `report.json` 字段
- [x] 实施修复：失败路径补 `reasons`、`notVerified`、`auditScope: "convert"`、带 `severity` 的 `diagnostics`、`blockingDiagnostics`
- [x] 回归测试：测试文件新增 `expectFailureReportSchema()`，四条失败分支（无 scene / playlist 未解析 / scene 不匹配 / ambiguous ×2）统一断言 `status`/`code`/`mode`/`auditScope`/`reasons`/`blockingDiagnostics[0].severity`/诊断 severity 齐全
- [x] 相邻路径验证：`failMenuConversion` 的 README 文案与 report 状态一致（`Status: **failed**.`）
- [x] 验证命令与证据：`corepack pnpm --filter @bdmv2web/cli test` → 33 passed
- [x] 发布/监控/文档：N/A（schema 收敛，不新增对外字段）
- 最后更新: 2026-11-05

## P2-P2-6 — [P2] `dependency-audit.json` 落盘与同一命令的 stdout/summary 不一致

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)（2026-11-05 用户复扫增补）
- 位置: `apps/cli/src/index.ts` `validate()`、`packages/test-runner/src/release-summary.ts` · 批次: Batch A8 · 决策: D-12 · 总体状态: [x]
- 影响摘要: 无静态 payload 的包（含 convert 失败包）落盘 `checks: []`，stdout/summary 却是 `["DEPENDENCY_AUDIT_REQUIRED"]`

### Checklist
- [x] 复现/确认触发条件：构造只含 `README.md` + `report.json` 的包 → `validate --offline --format json`；比对磁盘 `dependency-audit.json` 与 stdout
- [x] 实施修复：先算 `releaseSummary`，再与 `compatibility.json`、`reports/release-summary.json` 一起写，只写 `releaseSummary.dependencyAudit`
- [x] 回归测试：`writes the same dependency audit to disk as to stdout for a package without static payload`（断言磁盘 `checks` 与 stdout 相等，且 `modeSource === "report"`）
- [x] 相邻路径验证：有 `index.html` 的包结果不变；三份产物与 stdout 同源
- [x] 验证命令与证据：`corepack pnpm --filter @bdmv2web/cli test` → 33 passed；baja 真实包三份产物与 stdout 一致
- [x] 发布/监控/文档：`cli-delivery-status/spec.md` 新增 Requirement「落盘报告与命令输出同源」
- 最后更新: 2026-11-05

## P2-P2-7 — [P2] 失败包缺 manifest 时 mode 静默回落 `standalone-full`

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)（2026-11-05 用户复扫增补）
- 位置: `apps/cli/src/index.ts` `validate()` / `packageMode()`、`packages/test-runner/src/release-summary.ts` · 批次: Batch A9 · 决策: D-13 · 总体状态: [x]
- 影响摘要: `report.json` 声明 `menu-only`，但 decision / compatibility / release-summary / stdout 四处全部记成 `standalone-full`

### Checklist
- [x] 复现/确认触发条件：`convert` 触发 `MENU_SCENE_NOT_FOUND`（失败包只有 README + report.json），再 `validate`
- [x] 决策（已采纳）：mode 解析改为 `manifest.mode` → `report.json.mode`（只取形态，不信任 `status`）→ 未知；未知时报 `PACKAGE_MODE_ASSUMED`（`not-verified`）
- [x] 实施修复：读取 `report.json` 作为回退；summary 增加 `modeSource`（`manifest` / `report` / `assumed`），禁止静默默认
- [x] 回归测试：失败包用例断言 `mode === "menu-only"` 且 `modeSource === "report"`；两者都缺时断言 `PACKAGE_MODE_ASSUMED`
- [x] 相邻路径验证：成功包 `modeSource === "manifest"`（baja 实测）；`validate` 不因 report 的 `status: failed` 影响自己的 decision
- [x] 验证命令与证据：`corepack pnpm --filter @bdmv2web/cli test` → 33 passed
- [x] 发布/监控/文档：`cli-delivery-status/spec.md` 新增 Requirement「交付形态来源可追溯」
- 最后更新: 2026-11-05

## P3-P2-1 — [P2] 需要用户照做的提示 4.5s 自动消失且不可选中

- 来源: [`phases/phase-3-runtime-packaging.md`](./phases/phase-3-runtime-packaging.md)
- 位置: `packages/runtime-web/src/browser.ts` `createStatusToast` / `visibleError` / 外部播放三条路径、`package-builder/src/index.ts` CSS · 批次: Batch C1 · 总体状态: [x]
- 影响摘要: 最需要指引的失败路径上，用户还没抄完路径提示就淡出

### Checklist
- [x] 复现/确认触发条件：无 `#bridgePort` 时点播放按钮 → 提示 4.5s 后消失
- [x] 实施修复：`StatusToastOptions { persist?: boolean; error?: boolean }`；`is-persistent` 类阻止自动隐藏，`is-error` 只由 `error` 控制；`visibleError` 与外部播放三条路径（`unavailable`、缺 bridge 配置、`image.onerror`）改为 `{ persist: true }`
- [x] 选中复制：CSS 新增 `#runtime-status.is-persistent{pointer-events:auto;cursor:text;user-select:text}`，焦点态提示可被选中
- [x] 回归测试：`fades ordinary status toasts out but keeps a persistent one visible until the next update`（普通提示仍淡出、persist 超时后仍可见、下一条提示清掉 `is-persistent`）+ `package-builder` 断言该 CSS 规则存在
- [x] 相邻路径验证：普通提示仍能自动消失，不出现连续提示互相压制
- [x] 验证命令与证据：`runtime-web` 93 passed、`package-builder` 10 passed
- [x] 发布/监控/文档：N/A
- 最后更新: 2026-11-05

## P3-P2-2 — [P2] `contain` 让 video 与 canvas 各自 letterbox，比例不一致时按钮错位

- 来源: [`phases/phase-3-runtime-packaging.md`](./phases/phase-3-runtime-packaging.md)
- 位置: `packages/package-builder/src/index.ts`、`runtime-web/src/index.ts` · 批次: **挂起（条件触发）**，原提案 Batch C2 · 决策: [D-4](./decisions.md) · 总体状态: **挂起（条件触发）**
- 影响摘要: 素材比例 ≠ scene 比例时，背景与按钮视觉错位、点击位置与视觉不重合

### Checklist
- [x] 决策：**无案例不处理**（2026-11-05，D-4）
- [x] 前提核实：`test-data/bdmv/` 的两张碟（baja、tamako）均为 16:9，视频与 scene 比例一致，无法复现
- [x] 文档动作（本轮已做）：`docs/browser-matrix.md` 的「Known limitations」记录"素材比例 ≠ scene 比例时 background 与 canvas 各自 letterbox 可能错位，尚未验证"
- [ ] **触发条件**：新增 4:3 或非等比例菜单素材，或拿到"视频分辨率 ≠ scene 尺寸"的真实包
- [ ] 触发后：由 JS 用同一份 letterbox rect 同时设置 video 与 canvas，而非各自交给 CSS `contain`
- [ ] 触发后回归：加"scene 比例与视频比例不同仍对齐"的布局断言（可用 mock 尺寸）
- [ ] 触发后验证：`corepack pnpm --filter @bdmv2web/package-builder test` + 指针命中（viewport 逆变换）
- 最后更新: 2026-11-05

## P4-P2-1 — [P2] 默认 5s 超时让重用例在负载下假失败

- 来源: [`phases/phase-4-verification.md`](./phases/phase-4-verification.md)
- 位置: `apps/cli`/`media-export`/`runtime-web` 的 `vitest.config.ts` · 批次: Batch D1 · 决策: [D-6](./decisions.md) · 总体状态: [~]
- 影响摘要: 高负载下 2 条 CLI 用例（5821/5876ms）撞 5000ms 默认超时；空载重跑全绿（451 passed / 1 skipped）
- 事实更正（2026-11-05）: 47s 语料回归在 `runtime-web`，不在 `hdmv`；且该用例已显式 `120_000`（`tamako-headless-navigation.test.ts:214`），同类还有 `baja-studio-headless-navigation.test.ts:229`、`hdmv-navigation-corpus-dfs.test.ts:34`。per-test 优先，设全局 15000 不影响它们。

### Checklist
- [x] 复现/确认触发条件：并联其它重活跑 `corepack pnpm -r --no-bail test`，观察到 `records the requested player profile…` 撞 5000ms
- [x] 实施修复：`apps/cli` / `media-export` / `runtime-web` 的 `vitest.config.ts` 设 `testTimeout: 15000`；`hdmv` 未动
- [x] 不要做：三条语料用例的 per-test `120_000` 保留；`hdmv` 未加配置
- [~] 回归验证：此前记录本机全量测试连续 3 次通过（451 → 461 passed）；文档另记录 `bash scripts/ci.sh` 一次通过。新 CI workflow 尚未执行，等待流水线连续运行确认稳定
- [x] 相邻路径验证：门禁总耗时仍在可接受范围（全量测试约 2 分 10 秒）
- [~] 验证命令与证据：`index.md` 记录 `bash scripts/ci.sh` exit 0（2m32s）；该结果未在本轮重跑。旧版“缺少 pnpm 可执行文件”备注已由脚本改用 `corepack pnpm` 解决
- [x] 发布/监控/文档：`docs/development.md` 新增 **Load assumption** 段落说明 15000 的理由与"门禁失败只在机器未被压满时有意义"
- 最后更新: 2026-11-05

## P1-INFO-1 — [INFO] 0x24 只读部分属性位，注释与实现不符

- 来源: [`phases/phase-1-format-parsing.md`](./phases/phase-1-format-parsing.md)
- 位置: `parser.ts` 0x24 属性解析处 · 批次: Batch D3 · 决策: [D-7](./decisions.md) · 总体状态: [x]
- Checklist
  - [x] 决策：**不扩展模型，只修注释**（2026-11-05，D-7）；`cr_flag` / `hdr_plus_flag` 暂无消费者
  - [x] 实施修复：注释改为"仅取 / 仅建模 dynamic_range 与 colour space"
  - [x] 回归测试：不新增（无行为变化）
  - [x] 相邻路径/兼容性：`dynamicRangeType` / `colorSpace` 取值不变（真实样本断言仍过）
  - [x] 验证命令与证据：`bdmv-parser` 69 passed
  - [x] 发布/监控/文档：N/A
  - 最后更新: 2026-11-05

## P1-INFO-2 — [INFO] 新增诊断路径落到 `offset: 0`

- 来源: [`phases/phase-1-format-parsing.md`](./phases/phase-1-format-parsing.md)
- 位置: `parser.ts` 诊断 `path` 生成处 · 批次: 观察项 · 总体状态: [~]
- Checklist
  - [x] 确认受影响路径：ContractError 无 `/offset/<n>` 时原先默认 0
  - [x] 实施修复：optional section 解析失败时使用区段起始偏移（AppInfo=40，extension=扩展起点）
  - [ ] 回归测试：断言诊断 `offset` 为实际区段起点
  - [ ] 相邻路径/兼容性：既有 `offset/<n>` 诊断不变
  - [ ] 验证命令与证据：待补 parser 回归测试并运行
  - [ ] 发布/监控/文档：N/A
  - 备注: 缺少具体字段偏移时至少定位到可选区段起点；不再错误地落到文件偏移 0
  - 最后更新: 2026-11-05

## P1-INFO-3 — [INFO] 真实 UHD 样本的 0x24 路径未被断言

- 来源: [`phases/phase-1-format-parsing.md`](./phases/phase-1-format-parsing.md)
- 位置: `parser.test.ts` · 批次: Batch D2 · 总体状态: [x]
- Checklist
  - [x] 确认目标样本与期望值（`battle-royale-uhd`：MPLS `00006`、CLPI `00011`，`pid 4113`、`dynamicRangeType 0`、`colorSpace 1`）
  - [x] 实施修复：补 `playlists` / `clips` 断言
  - [x] 回归测试：断言 clip 未被丢弃（`clips.length >= 13`）
  - [x] 相邻路径/兼容性：`battle-royale-uhd` 语料测试结果不变
  - [x] 验证命令与证据：`bdmv-parser` 69 passed
  - [x] 发布/监控/文档：N/A
  - 最后更新: 2026-11-05

## P2-INFO-1 — [INFO] `convert` 只对解析阶段做 fatal 门禁

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)
- 位置: `apps/cli/src/index.ts` `convert()` · 批次: 观察项（当前无 fatal 生产者）· 总体状态: [ ]
- Checklist
  - [ ] 确认 IGS / adapter 是否会引入 fatal 级别
  - [ ] 实施修复：commit 前用三处诊断合并判定 `hasFatal`
  - [ ] 回归测试：注入一个 fatal 诊断，断言不 commit
  - [ ] 相邻路径/兼容性：`failMenuConversion` 行为不变
  - [ ] 验证命令与证据：`corepack pnpm --filter @bdmv2web/cli test`
  - [ ] 发布/监控/文档：N/A
  - 备注: 本轮不处理。`extract` 已改成"先判 fatal 再扫 IGS"（`P2-INFO-3`），`convert` 的打包前门禁待真有 fatal 生产者时再补
  - 最后更新: 2026-11-05

## P2-INFO-2 — [INFO] 阶段失败输出用 `status`，spec 两个场景自相矛盾

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)
- 位置: `apps/cli/src/index.ts` `stageFailure` vs `openspec/specs/cli-delivery-status/spec.md` · 批次: Batch B1 · 决策: [D-5](./decisions.md) · 总体状态: [x]
- 影响摘要: 同一命令成功用 `stageStatus`、失败用 `status`，一个字段两种语义

### Checklist
- [x] 决策：**统一为 `stageStatus`**（2026-11-05，D-5；由 D-2「status 只表交付结论」派生）
- [x] 实施修复：`stageFailure` 输出 `{ stageStatus: "failed", code, diagnostics }`
- [x] spec 修订：`cli-delivery-status/spec.md` 场景改为 `stageStatus: "failed"`，并补"失败对象与成功对象同字段"
- [x] 回归测试：三条失败用例改断言 `stageStatus`（`inspect` 无 `--allow-partial` / `extract` 缺 index / `convert` 缺 index）
- [x] 相邻路径/兼容性：`inspect` 成功路径已是 `stageStatus`，两侧一致；`convert` 的 `status` 不受影响
- [x] 验证命令与证据：`cli` 33 passed
- [x] 发布/监控/文档：README 字段说明同步（`stageStatus` 成功失败同字段）
- 最后更新: 2026-11-05

## P2-INFO-3 — [INFO] `extract` 先跑完 IGS 提取再判 fatal

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)
- 位置: `apps/cli/src/index.ts` `extract()` · 批次: Batch A7（顺带） · 决策: [D-9](./decisions.md) · 总体状态: [x]
- Checklist
  - [x] 确认 `extractIgsScenes` 在缺 index.bdmv 时的耗时量级（空盘需遍历 STREAM 候选后再失败）
  - [x] 实施修复：`classifyDiagnostics(disc.diagnostics).hasFatal` 快速失败，再做 IGS 提取
  - [~] 回归测试：`refuses a stage with a fatal diagnostic and writes no output` 断言 exit 1 + 不产生输出目录；**未做** mock 级"IGS 未被调用"断言（用例走 `spawnSync` 子进程，无法注入 mock，改由代码顺序保证 —— guard 在 `extractIgsScenes` 之前）
  - [x] 相邻路径/兼容性：正常场景诊断集合不变
  - [x] 验证命令与证据：`cli` 33 passed
  - [x] 发布/监控/文档：N/A
  - 最后更新: 2026-11-05

## P2-INFO-4 — [INFO] 死代码与死参数

- 来源: [`phases/phase-2-cli-status.md`](./phases/phase-2-cli-status.md)
- 位置: `apps/cli/src/index.ts`、`test-runner/src/decisions.ts` / `release-summary.ts` · 批次: 观察项 · 总体状态: [x]
- Checklist
  - [x] 确认 `reportedStatus` 是否应被 `createReleaseSummary` 消费（否则删除）→ 结论：删除。`validate` 自己在 `MANIFEST_STATUS_UNVERIFIED` 里做比较，函数内从未读过该字段
  - [x] 实施修复：删除 `PLAYER_PROFILE_KEYS`、删除 `ReleaseSummaryInput.reportedStatus`（含 CLI 传参与两处测试），给 `DeliveryDecisionInput.mode` / `StageOutcomeInput.stage` 加"仅记录、不参与判定"注释
  - [x] 回归测试：不适用（无行为变化），靠 typecheck + 既有断言（`test-runner` 51 passed 不变）
  - [x] 相邻路径/兼容性：`DeliveryDecisionInput.mode` 保留（外部调用方仍可传）
  - [x] 验证命令与证据：`corepack pnpm -r typecheck` exit 0、`test-runner` 51 passed、`cli` 33 passed
  - [x] 发布/监控/文档：N/A
  - 最后更新: 2026-11-05

## P3-INFO-1 — [INFO] `disc-title` 死代码被两处测试互相固化

- 来源: [`phases/phase-3-runtime-packaging.md`](./phases/phase-3-runtime-packaging.md)
- 位置: `runtime-web/src/browser.ts`、`browser.test.ts`、`package-builder/src/index.test.ts` · 批次: Batch C3 · 总体状态: [x]
- Checklist
  - [x] 决策：**删死代码，标题只留 `<title>`**（2026-11-05，D-8）
  - [x] 实施修复：删除 `#disc-title` heading 写回与 `title` 变量
  - [x] 回归测试：删除两侧对应断言，改为 `expect(app).not.toMatch(/heading\.textContent\s*=\s*title/)` 与 `expect(html).not.toContain("<h1")`
  - [x] 相邻路径/兼容性：`<title>` 标签仍正确（`escapeHtml`）
  - [x] 验证命令与证据：`runtime-web` 93 passed + `package-builder` 10 passed
  - [x] 发布/监控/文档：`createMenuIndexHtml` 注释改为 "document title"，README/文档口径一致
  - 最后更新: 2026-11-05

## P3-INFO-2 — [INFO] 默认 profile 仍有两份手抄

- 来源: [`phases/phase-3-runtime-packaging.md`](./phases/phase-3-runtime-packaging.md)
- 位置: `hdmv/src/vm.ts` vs `core/src/index.ts` · 批次: 观察项（D3 第 2 批）· 总体状态: [~]
- Checklist
  - [x] 实施修复：`HdmvVm` 使用 `core.DEFAULT_PLAYER_PROFILE`，删除本地重复常量；VM 独立执行上限仍保留
  - [ ] 回归测试：加 parity 测试，断言 `new HdmvVm([])` 的 PSR16–20 等于 `core.DEFAULT_PLAYER_PROFILE`
  - [ ] 相邻路径/兼容性：检查 browser bundle 未引入 Ajv 运行时代码
  - [ ] 验证命令与证据：待运行 typecheck / build 并检查 bundle
  - [ ] 发布/监控/文档：N/A
  - 最后更新: 2026-11-05

## P3-INFO-3 — [INFO] `manifest.profile` 与 `compatibility.profile` 双源，审计不校验

- 来源: [`phases/phase-3-runtime-packaging.md`](./phases/phase-3-runtime-packaging.md)
- 位置: `package-builder/src/index.ts`、`test-runner/src/package-audit.ts` · 批次: 观察项（随 `validate` 审计） · 决策: [D-10](./decisions.md) · 总体状态: [~]
- Checklist
  - [x] 确认 compatibility 的 `profile` 当前是 `portable` 标签；完整 PlayerProfile 以 manifest 与 runtime `disc-data.js` 为审计对象
  - [x] 实施修复：audit 校验 manifest profile 形状、`compatibility.json` 的 outputProfile 标签，并与 `disc-data.js` 比对；旧 manifest 无 profile 时跳过该项
  - [ ] 回归测试：篡改 runtime profile 时 audit 产生 fail，并确认旧包无 profile 不报错
  - [ ] 相邻路径/兼容性：`validate --offline` 对真实包无回归
  - [ ] 验证命令与证据：待补回归测试后运行 cli / test-runner 验证
  - [ ] 发布/监控/文档：`docs/browser-matrix.md` 补 profile 相关限制
  - 最后更新: 2026-11-05

## P3-INFO-4 — [INFO] 首帧未 resize（既有问题，被全屏布局放大）

- 来源: [`phases/phase-3-runtime-packaging.md`](./phases/phase-3-runtime-packaging.md)
- 位置: `runtime-web/src/browser.ts`（controller 创建 → 首次 `redraw`）· 批次: 观察项 · 总体状态: [~]
- Checklist
  - [x] 实施修复：Start handler 在 `controller.start()` 首次 render 前设置 viewport 和 canvas backing size
  - [ ] 回归测试：断言首帧 canvas backing store 尺寸与视口一致
  - [ ] 相邻路径/兼容性：验证 pointer input 安装时的二次 resize 不产生可见抖动
  - [ ] 验证命令与证据：补首帧 backing-size 回归断言后运行 runtime-web 测试
  - [ ] 发布/监控/文档：N/A
  - 最后更新: 2026-11-05

## P4-INFO-1 — [INFO] CI 已接入，等待首次运行

- 来源: [`phases/phase-4-verification.md`](./phases/phase-4-verification.md)
- 位置: 仓库根 · 批次: 观察项（D1 已决策单独立项）· 总体状态: [~]
- Checklist
  - [x] 实施修复：新增 `.github/workflows/ci.yml`，在 master push、PR 与手动触发时运行 `bash scripts/ci.sh`
  - [x] 使用仓库锁定 Node 版本；workflow 仅授予 `contents: read`
  - [ ] 验证命令与证据：等待 GitHub Actions 首次运行成功
  - [x] 文档：`docs/development.md` 更新为说明 CI workflow 已接入
  - 最后更新: 2026-11-05
