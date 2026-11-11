# 注释与辩解式内容审计（no-comments）

> 日期：2026-11-11
> 审计范围：`apps/`、`packages/`、`scripts/` 全部 `*.ts` / `*.mjs` 源文件（193 个），基线 `68fdc51`，工作区无未提交改动。
> 对照标准：`no-comments` skill（comment-sicko 判定）与 [AGENTS.md](../../../../AGENTS.md) 的「直接描述、删除对照式解释、反对冗余守护层」条款。
> 前情：[review-2026-11-07-over-defensive-audit](../review-2026-11-07-over-defensive-audit/index.md) 已处理过度防御与辩解式文档；本轮处理同一批纪律在代码注释上的残留。

## 0. 范围与方法

工作区相对 `master` 无 diff，因此范围取全仓源码而非增量。执行方式：按包分四路并行扫描（`apps/cli`、`hdmv`+`bdmv-parser`+`igs`、`runtime-web`+`media-export`、`package-builder`+`test-runner`+`test-fixtures`+`scripts`），每路逐文件通读，判定为「删 / 保留 / 需重塑」。回收全部结果后由主流程做行级复核并剔除误判，复核样本覆盖四个包的关键条目，行号与引文均与实际代码一致。

四条判定口径（与 skill 一致）：叙述代码正在做什么、复述相邻字面量、分节横幅、注释掉的尸体、长篇辩解，一律删除；许可证头、外部依赖/平台/协议强制且无法通过改名消除的非显然行为、`prettier-ignore`、定义公共 API 契约的文档注释、解释约束的 issue/RFC 链接，允许保留。不确定即删除。

## 1. 结论摘要

| 项 | 数量 |
| --- | --- |
| 扫描文件 | 193 |
| 判定可删 | 476 |
| 判定保留 | 217 |
| 标记待重塑（`MUST KILL`） | 56，复核后确认 39 项 |
| 复核后拒绝的删除 | 20（证据型字节标注）+ 15（行为决策型重塑） |
| 已执行 | 2 条死内容 + 29 项结构改动 |

476 条中约 300 条是纯叙述与复述（`// PDS`、`// Set the output path`、断言上方的同义改写），删除后代码语义不变。真正有价值的部分是 39 项重塑：它们指向的不是措辞问题，而是魔数、哨兵值、跨模块重复规则等本可自解释却被注释代劳的结构。

## 2. 已执行

### 2.1 死内容

| 位置 | 内容 | 复核 |
| --- | --- | --- |
| `packages/media-export/src/index.ts:308` | `// const maxAssetBytes = options.maxAssetBytes ?? null;` | 注释掉的赋值。同函数 `:303` 已直接用 `options.maxAssetBytes`，此行是重构残留 |
| `apps/cli/src/commands/validate.ts:107-109` | 文件末尾无声明跟随的 JSDoc | `readJsonObject` 已迁出，注释留在 EOF |

### 2.2 结构改动

| 位置 | 改动 | 消除的注释 |
| --- | --- | --- |
| `packages/media-export/src/pgs.ts` | `SEGMENT` 常量（`PDS`/`ODS`/`PCS`/`END`）替代 `case 0x14/0x15/0x16/0x80` 与四个十六进制标签 | 段类型标签 4 条、`readDisplaySets` 内性能与设计说明 6 条、私有函数 JSDoc 3 条 |
| `packages/igs/src/transport.ts` | `M2TS_PACKET_BYTES`、`SYNC_OFFSET_IN_PACKET`、`SPLIT_RETAINED_BYTES` 替代 192/4/195 | 残留字节前瞻说明 |
| `packages/hdmv/src/decode.ts` | `RESERVED_WORD0_BITS` 常量 | 保留位段叙述、宽容解码说明 |
| `packages/bdmv-parser/src/parser.ts` | `VERSION_3D_MVC` 参与 `SUPPORTED_VERSIONS` | 版本策略说明、`Warn` 类型 JSDoc、`optionalSection` 与 `parseExtensionData` 说明 |
| `packages/igs/src/igs.ts` | `ICS_SEQUENCE_FLAGS_OFFSET`/`ICS_LENGTH_OFFSET`/`ICS_PREFIX_BYTES` 与 `sealCombinedIcs()`，替代 `ics[8] = 0xc0` 与 `u24Bytes(len - 12)` | 组合完成说明 |
| `packages/igs/src/png.ts` | `palettesByLastDefinition`/`objectsByLastDefinition` 命名末次定义语义 | 末次定义说明、IDAT 分配历史；压缩级别基准移入 [igs-support.md](../../../support/igs-support.md) |
| `apps/cli/src/cli/stages.ts` | `StageFailureRecord` 类型承载 `stageStatus` | stage 与 delivery 状态约定 |
| `apps/cli/src/index.ts` | `plainMessage` 按 `code`/`path` 字段切片，去掉前缀正则 | `ContractError.message` 前缀说明 |
| `apps/cli/src/commands/build.ts` | `primaryPlayItem` 用 `null` 替代 `-1` 哨兵；提取 `clpiPrimaryIgsTargets`、`isMenuSurfaceScene` | 主菜单 PlayItem 说明、CLPI 优先级说明、IGS 组合归属说明、Top Menu 拓扑说明、步骤表说明 |
| `apps/cli/src/commands/extract.ts` | `withoutPixelIndices()` | 像素索引归属说明 |
| `apps/cli/src/shared/pgs.ts` | `trackIdentityBySourceIn()` | 共享流身份说明 |
| `packages/hdmv/src/vm.ts` | 删除 `runTurn` 中空控制转移分支 | 该分支内的旁白 |
| `packages/runtime-web/src/index.ts` | `escapeTarget()`、`buttonsInBogScanOrder()`、`confirmStarted()`（两处 `MEDIA_STARTED` 重绑合一） | 隐藏 auto-action 说明、BOG 扫描顺序段落、两处重绑说明 |
| `packages/runtime-web/src/browser.ts` | `startMenuPreview()` 与 `armAutoMuteRestoreAfterDispatch()` 提取 | 监听器说明、静音恢复时序说明 |
| `packages/runtime-web/src/igs-adapter.ts` | `hitTestableOrAutoAction` 命名命中判定 | 无视觉 auto-action 说明 |
| `packages/package-builder/src/index.ts` | `RESERVED_REPORT_FILES` 常量 | 保留文件名说明、bundle 来源说明、媒体复用说明、返回说明、PNG 级别基准 |
| `packages/igs/src/png.test.ts` | 测试调色板按 `IgsPalette` 定型，去掉 `as never` | 常量介绍注释 |

### 2.3 验证

逐包 `tsc --noEmit`：`igs`、`hdmv`、`bdmv-parser`、`media-export`、`runtime-web`、`package-builder`、`apps/cli` 全部退出 0。全仓 `npx eslint .` 退出 0。

测试：`packages/igs`（38）、`packages/hdmv`（138）、`packages/bdmv-parser`（83）、`packages/media-export`（`pgs` 9）、`packages/runtime-web`（120）、`packages/package-builder`（13）、`apps/cli` 单测（19）、`apps/cli` 的 `build.test.ts`（5）全部通过。未运行构建产物相关的 e2e 与 `pnpm bench:test`。


## 3. 分类与影响面

### A. 死内容（2 条，已处理）
注释掉的代码与无宿主 JSDoc。全仓仅此两处，无其它 `// const`、`// return` 型尸体。

### B. 叙述与复述（约 300 条）
最大宗。三种形态：

- **协议段缩写**：`packages/media-export/src/pgs.ts:103/114/147` 的 `case 0x14: { // PDS`，四个段类型各带一个十六进制字面量标签。删除标签即失去可读性，正确做法是具名常量（并入 §4 的 `SEGMENT_*`）。
- **断言同义改写**：`packages/hdmv/src/index.test.ts:379-415` 的 `// EQ skips on inequality`、`// MUL saturation` 等 20 余条，紧邻的期望值已经表达同一事实。
- **流程旁白**：`apps/cli/src/commands/build.ts`、`packages/runtime-web/src/index.ts` 中大量「下面三行在做什么」的句子。

影响面：仅注释行，不改变行为、不改变类型、不改变 lint 结果（仓库 `eslint.config.mjs` 无 jsdoc 规则）。

### C. 辩解式长注释（约 60 条）
以 `libbluray` 内部实现为依据，为一段本地代码辩护。集中在 `packages/hdmv/src/vm.ts`（约 25 条）、`packages/igs/src/png.ts`、`scripts/bench/*`。

这一类与仓库现行约定冲突，需要明确取舍：AGENTS.md 要求「状态描述当前行为、删除对照式解释」，而 VM 与解析器的一致性审计（[hdmv-vm-conformance](../review-2026-11-06-hdmv-vm-conformance/index.md)）以 libbluray 1.5.0 为参照，引用 vendor 函数名是当时的取证痕迹。口径：**保留 vendor 引用，删除解释「为什么这样写」的段落**；两者在同一段里混写时先拆再删。本轮未处理该类，见 §6。

### D. 抑制指令（3 处，全仓仅此）

| 位置 | 指令 | 结论 |
| --- | --- | --- |
| `packages/runtime-web/src/browser.ts:852` | `eslint-disable-next-line @typescript-eslint/no-misused-promises` | 真实抑制。`browser.test.ts` 的 `fire()` 逐个 `await` 监听器，异步监听器的返回值在测试路径上被消费；产品路径上 DOM 丢弃该 Promise。抑制保护的是测试可确定性，形状应改：把异步启动提取为返回 `Promise<void>` 的命名函数，监听器转为同步调用 |
| `packages/test-runner/src/index.test.ts:255` | `@ts-expect-error` 交付状态不可用于阶段状态 | 保留。该被拒绝的程序就是契约本身（`StageStatus` / `DeliveryStatus` 为不同 unique symbol 品牌） |
| `packages/test-runner/src/index.test.ts:257` | 反向同理 | 保留 |

### E. 公共 API 文档注释（217 条保留中的主体）
`packages/*/src/index.ts` 与 `types.ts` 的导出契约。其中约 65 条只是把字段名换成一句话（`coverage.ts` 12 条、`package-builder` 约 28 条、`scripts/bench` 约 20 条），属复述而非契约定义。删除与否取决于这些包是否作为库对外发布并依赖编辑器提示，属策略选择，本轮未动。

## 4. 重塑清单（39 项）与落地状态

| 状态 | 项 | 说明 |
| --- | --- | --- |
| 已落地 | `pgs.ts` 段类型常量、`transport.ts` 包长与前瞻常量、`decode.ts` 保留位掩码、`parser.ts` 版本集合、`igs.ts` ICS 前缀常量与 `sealCombinedIcs`、`png.ts` 末次定义命名、`png.ts` 压缩级别依据外移、`stages.ts` 类型化 stage 记录、`cli/index.ts` `plainMessage`、`cli/build.ts` 哨兵与两处提取、`extract.ts` `withoutPixelIndices`、`shared/pgs.ts` 身份键、`vm.ts` 空分支、`runtime-web/index.ts` 三处提取与去重、`browser.ts` 两处提取、`igs-adapter.ts` 命中判定、`package-builder` 保留文件常量、`png.test.ts` 类型化 fixture | 共 29 项，见 §2.2 |
| 未落地 | `apps/cli/src/commands/build.ts:124` `preMenuPlaylistIds` 改名 | 该字段是 `disc-data.js` 的序列化契约，被 `package-builder` 类型、`runtime-web/browser.ts` 读取端与两处 e2e 断言共用；改名需同步四个包与包格式文档，超出注释审计范围 |
| 未落地 | `packages/runtime-web/src/browser.ts:852` 抑制指令 | 改为同步监听器后 `browser.test.ts` 出现 7 个失败：测试宿主 `fire()` 以监听器返回值作为完成信号，同步后异步启动在断言前未完成。删除抑制需要先在模块契约上暴露「进行中的启动」供宿主等待，属测试宿主改造 |
| 未落地 | `packages/test-runner/src/decisions.ts:66`、`report.ts:26`、`release-summary.ts:128` | 三处共用同一套 fail → not-verified → pass 优先级规则；合并要跨模块统一结果类型，超出单个注释的根因 |
| 未落地 | `packages/hdmv/src/vm.ts:1012` trace 观察者隔离 | 该行为在 [review-2026-11-07](../review-2026-11-07-over-defensive-audit/index.md) §1.5 已判定有真实作用，仅删除注释会让空 catch 失去解释 |
| 未落地 | `packages/hdmv/src/registers.ts:38` | 需要把只读寄存器初始化改成单一类型化路径，属行为与类型设计改动 |
| 未落地 | `packages/test-runner/src/package-audit.ts:44`、`packages/test-fixtures/src/bdmv.ts:36` | 前者要改 `validate` 的对外 JSON 结果类型；后者是 fixture 构造函数表驱动化，均不属注释问题 |
| 未落地 | `apps/cli/tests/e2e/index.test.ts:495,816,862,879`、`packages/igs/tests/integration/extraction.test.ts:389,418,451,471`、`scripts/generate-synthetic-all-features.mjs:72`、`scripts/bench/fixture-audit.mjs:13` | 测试与基准脚本的结构化改动。e2e 用例以字节偏移直接改写合成碟，替换为具名 patch helper 需重写四处构造器；extraction 的 `as unknown as ParsedDisc` fixture 缺字段，补齐 `ParsedDisc` 全量要求四个用例体 |

## 5. 复核后拒绝的条目

| 类别 | 数量 | 理由 |
| --- | --- | --- |
| 捕获字节的译注 | 20 | `control-flow.test.ts:112-114`、`hdmv/index.test.ts:608-610`、`647-649`、`headless-menu-synthetic.test.ts:29-36`、`52`、`55` 等，是在碟片原始十六进制上方标注操作码含义。字节不可通过改名消除，属外部协议证据；同一路的判定里 `0x22800000 → PLAY_PL` 已被保留，删除其余属口径不一 |
| 行为决策型重塑 | 15 | `vm.ts:1012` 的 trace 观察者隔离在 [review-2026-11-07](../review-2026-11-07-over-defensive-audit/index.md) §1.5 已判定「有真实作用」；`vm.ts:349`、`registers.ts:38` 与 `test-runner`、`scripts/bench` 的 12 项需要改行为或跨包去重，超出注释审计范围 |
| 复述型保留 | 约 65 | 见 §3.E，待策略决定 |

## 6. 未执行与开放项

- 叙述与复述类注释的删除只覆盖了与 §2.2 结构改动同一文件的区域（`pgs.ts`、`parser.ts`、`decode.ts`、`png.ts`、`build.ts`、`runtime-web/index.ts`、`browser.ts`、`package-builder`），其余约 250 条未处理。分批方案：`apps/cli` → `hdmv`/`igs`/`bdmv-parser` → `runtime-web`/`media-export` → `scripts`，每批单独提交并跑对应包测试。
- §3.C 的 60 条 vendor 引用类长注释未处理。已定口径：保留 vendor 函数名等引用，删除解释「为什么这样写」的段落；两者在同一段混写时先拆再删。集中在 `packages/hdmv/src/vm.ts`。
- §4 表内 10 项重塑未落地，各自的原因为序列化契约、测试宿主契约、跨模块规则合并或行为设计。
- 本记录的行号基于 `68fdc51`；执行时按符号而非行号定位。
