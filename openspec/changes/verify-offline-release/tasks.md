# Tasks

当前任务全部勾选：validate 覆盖包内 schema、引用、manifest、启动项、必需资产、外部目标分类与状态聚合，`compare` 已接线并按规格退出。跨阶段 M4/M5 制品与参考 golden 仍按各自门槛执行，不因本 change 勾选而被视为已验证。

验收口径：离线包结构审计、路径与 URL 编码、模拟浏览器事件、协议请求模拟、检查结果聚合、独立参考对照。外部播放器的实机打开、人工音画观察与跨浏览器解码记录不计入本 change 的验收。范围调整见 [scope-changes.md](../scope-changes.md)。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列行为案例及结果；未取得参考或环境证据不得勾选对应验收。M6 原语位于 `packages/test-runner/src`；`validate --offline` 生成当前 `compatibility.json`、`dependency-audit.json` 和 `reports/release-summary.json`，缺失的覆盖率或参考证据列入 `notVerified`。跨阶段 M4/M5 制品和参考 golden 仍须按后续门槛完成。

## 1. 独立包检查

- [x] 1.1 回归现有 validate schema/引用/manifest/启动资产检查；实现已检查 `index.html` 存在且为必需 manifest 项，并检查必需文件缺失。验收仍需覆盖无原碟/FFmpeg运行、manifest 缺启动项及必需资产缺失。2026-11-09：三条用例见 e2e（`offline validate CLI`、`offline validate CLI (M6)`），证据见 [verification.md](./verification.md)。
- [x] 1.2 解析HTML/CSS/数据/JS资源入口并统一URL/realpath检查；验收：远程/协议相对/file原盘/编码逃逸/外symlink均定位，合法中文/百分号路径和说明链接不误报。
- [x] 1.2a 补齐 external target 审计验收：确认包内 runtime 资源只允许包内引用，声明的影片目标只来自输入 BDMV 的 `STREAM/*.m2ts`；外部配置的实际路径和系统关联状态标为未验证，路径逃逸不得作为有效目标。2026-11-09：`auditExternalTargets` 校验 `STREAM/<clipId>.m2ts`，绝对路径/上跳/反斜线/scheme/跨 clip 记 `EXTERNAL_TARGET_UNDECLARED` fail；`EXTERNAL_CONFIG` 仍为 not-verified。
- [x] 1.3 限制data MIME并检查嵌套依赖和bundle禁用入口；验收：HTML/SVG执行载荷与远程嵌套拒绝，已生成PNG data允许。
- [x] 1.4 生成dependency-audit及checks[]；验收：每项有pass/fail/not-verified和具体字段/证据，不盲信旧status。

## 2. 完整度与覆盖

- [x] 2.1 以共享决策表实现failed/partial/complete和strict退出码；验收：convert、混合/纯BD-J、unknown opcode、缺媒体、缺证据逐行测试。
- [x] 2.1a 按当前 convert 产物更新共享决策表和 strict 退出码；覆盖请求结果不可观测、混合/纯 BD-J、unknown opcode、缺源 M2TS 和缺证据。验收：`complete` 只表示无已知失败证据；`not-verified` 不降低状态且逐条列入 `notVerified`；`fail` 优先于 `not-verified`。2026-11-09：真值表用例 8 条落在 `release-summary.test.ts`，见 [verification.md](./verification.md)。
- [x] 2.2 实现acknowledged错误和降级记录；验收：不删除原严重性/影响，strict策略变化不提升能力状态。
- [x] 2.3 实现入口/指令/媒体/测试的分母和未知计数；验收：零分母N/A、探索超限unknown，不能报虚假100%。

## 3. 差分与安全回归

- [x] 3.1 定义compare输入序列/PlayerProfile/初始寄存器/seed和参考工具适配；验收：记录fixture ID或样本标签及工具版本，不生成原盘素材哈希，参考缺席not-verified。
- [x] 3.2 实现VM语义trace首差异报告；验收：已知寄存器/栈/动作偏差可回到源指令，忽略非语义墙钟。
- [x] 3.3 实现独立IG像素对照和视频质量分离；验收：调色板/alpha/时序偏差准确定位，视频编码噪声不混入IG判定。
- [x] 3.4 汇总截断/超尺寸/路径/跳转环安全回归；验收：预算内终止，诊断准确且源/旧输出不变。

## 4. 发布与离线包交接

- [x] 4.2 自动化验证独立离线包的启动引用、目录迁移、配置修改后的路径解析、特殊字符 URL 编码、协议请求模拟、无同步回执时的 VM 恢复、菜单媒体静音与恢复；记录 expected/actual/checkId。验收：在测试进程中屏蔽源码路径与 FFmpeg 可执行文件，包仍可审计；不要求真实设备、系统默认程序或人工播放观察。2026-11-09：移动包 + 中文空格路径 + `PATH=/nonexistent` 用例，协议/静音/无回执由 `runtime-web` 用例覆盖；见 [verification.md](./verification.md)。
- [x] 4.4 生成最终 compatibility/audit/manifest/发布摘要和 README；验收：`status` 由已知失败证据决定，`not-verified` 记入 `notVerified` 并按条列出缺口，完整包无开发/参考工具依赖。该验收文字按 2026-11-09 决策 D-01/D-02 修正，实施结果不变。

## 5. 新增任务（2026-11-09）

- [x] X-AUDIT 统一检查结果聚合优先级为 `fail > not-verified > pass`，空集合为 `not-verified`；混合检查项不得掩盖 `fail`。验收：`release-summary.ts::summarizeCheckResult()` 与 `report.ts::createDependencyAuditReport()` 对 `fail + not-verified` 的两种顺序、多项混合、空检查、重复检查与 strict 两档分别断言子状态、最终状态、退出码与缺口列表；含一条"把 fail 放回时测试必须失败"的负例。2026-11-09：5 条用例通过；还原旧顺序时其中 2 条失败。
- [x] X-COMPARE 将 `packages/test-runner/src/compare.ts` 的参考对照能力接入 `apps/cli/src/commands/compare.ts`：定义输入序列、初始 VM 状态、实际 trace、独立参考 trace、参考工具与版本、输出路径；CLI 不再返回无条件 `E_NOT_IMPLEMENTED`。验收：按规格退出码断言——一致 0、分歧/输入错误/执行错误 1、参考缺席 `not-verified` 2；三组 fixture（相同 trace、首处分歧、缺独立参考）断言稳定报告 JSON、最早差异位置与错误信息；不得用被测 trace 作为参考。2026-11-09：6 条 e2e 通过，含同一文件作参考被拒绝。
