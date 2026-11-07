# 过度防御与辩解式内容审计

> 日期：2026-11-07
> 审计范围：`packages/`、`apps/` 源码；全部 `*.test.ts`、`scripts/`、`package.json`、`scripts/ci.sh`；`docs/`、`openspec/changes/`（活跃 change 与基线文件）。
> 对照标准：[AGENTS.md](../../AGENTS.md)（禁止文件大小/指纹校验进发布门禁、禁止只证明"不存在"的测试、要求直接描述、反对冗余守护层）。
> 修正记录：见 §7（2026-11-07 逐条复核与处理结果）。结果分三类：**已修正**、**保留**（附复核依据）、**未复现**（原判在当前代码中不存在）。
>
> 方法：三路并行扫描（源码 / 测试与脚本 / 文档与 OpenSpec），全部发现逐条回到工作区行级复核。本文所有位置与引文在 2026-11-07 均已确认存在；每条标注复核结论，含复核中修正原判的条目。

## 0. 结论摘要

- 源码中无 SHA-256 / checksum / fingerprint 代码；样例碟名只出现在测试与 fixture；浏览器包无 Node-only 全局。整体防御纪律良好，多数 catch 转为显式 diagnostic。
- 需要处理的问题分四类：死防御代码（无效果守卫）、吞错（防御掩盖失败）、冗余校验层（同一数据多层验证）、验证表演（自比冒充独立参考、只证明存在性的测试）。
- 文档问题集中在：现行文档中的历史辩解残留、同一免责跨文件重复、"pinned ≠ independent golden" 免责在表格已有 Evidence 列的情况下逐段重复。
- 一处接近 AGENTS.md 红线的活代码：`browser-evidence` binding 的 `byteLength` 比对（文件大小进发布证据门禁）。
- 复核中发现一个疑似 bug：`igs-adapter` 的 PTS `reduce` 忽略累加器（§1.4）。

## 1. 源码

### 1.1 死防御代码（无效果守卫）

| 位置 | 问题 | 状态 |
| --- | --- | --- |
| `packages/runtime-web/src/igs-adapter.ts:174-175` | `for (const page of scene.pages) {}` 空循环体，不检测、不改变任何行为 | 已复核 |
| `packages/core/src/index.ts:113-121` | `validateStage` 全仓库零调用者；`runtime` 分支的 BD-J 检测体为空（仅注释），且白跑一遍完整 `parseDiscIR`；`parsed`/`normalized` 分支原样返回 | 已复核 |
| `packages/runtime-web/src/index.ts:487-489` | `isPageMember` 在全部现存调用点（`applySetButtonPage`、`setButtonEnabled`、`selectButton`、`isUsable`）传入的按钮均来自 `this.page.buttons.find(...)`，从数组查出的元素回查"是否在该数组"恒真；却在 `isUsable` 热路径做 O(n) 扫描。收窄时需确认"同 id 不同 bog"的重复按钮是否可能出现：可能出现则保留 bog 比对、去掉数组扫描 | 已复核 |
| `packages/runtime-web/src/index.ts:993-994` | `targetTime = logicalTime % duration`；`logicalTime` 来自 `video.currentTime`（:959），`duration` 两行前已校验为有限正数，结果不可能 NaN 或负，分支不可达 | 已复核 |
| `packages/runtime-web/src/browser.ts:15-16` | `createMenuVm` 的 profile 形状检查只拦"非对象"，拦不住的内容 `HdmvVm` 构造函数内的 `normalizeProfile` 全都会拦，且报不同错误码 | 已复核 |

### 1.2 吞错掩盖失败（修复方向是让错误可见，不是删检查）

| 位置 | 问题 | 状态 |
| --- | --- | --- |
| `packages/bdmv-io/src/index.ts:156-160` | 提交失败后把 backup 还原回目标路径的 `rename(backupPath, canonicalTarget).catch(() => undefined)`：还原失败时原输出目录留在隐藏的 `.xxx.backup-<uuid>` 下，调用者只看到原始错误。还原失败应并入抛出的错误；提交成功后删除备份的 `.catch(() => undefined)` 属次级清理抑制，可保留 | 已复核 |
| `packages/test-runner/src/package-audit.ts:241-242` | `auditJsonUrls` 对内联 JSON 解析失败直接 `return`，不产生任何 check——被截断/篡改的 `<script type="application/json">` 整体逃过 URL 审计。同文件 `:262` 对超大文件记 `RUNTIME_FILE_TOO_LARGE`/`not-verified`，此处应记同型 check 而非沉默 | 已复核 |
| `apps/cli/src/index.ts:1132-1137`（调用点 `:1043-1044`） | `readJsonObject` 把不可读的 manifest.json 吞成 `{}`。`validate` 已由 `auditOutputPackage` 完整校验过同一 manifest，随后又重读一遍；重读失败时 `manifestStatus` 变 undefined，`:1084-1087` 的"manifest 状态与当前判定不一致须报告"契约（D-2R）静默失效。应复用 audit 已解析的 manifest | 已复核 |

### 1.3 冗余校验层

| 位置 | 问题 | 状态 |
| --- | --- | --- |
| `packages/package-builder/src/index.ts:130` | `buildMenuPackage` 对入参 IR 再跑一遍完整 `parseDiscIR`；主调用链 `apps/cli/src/index.ts:621`（`createMenuDiscIR` 末尾）已对同一对象校验过。作为库边界防第三方调用者可辩护，按 AGENTS.md 反对冗余守护层应收窄 | 已复核 |
| `packages/runtime-web/src/browser.ts:448-468` | `validateEmbeddedDiscIR` 是同一份 DiscIR 的第三层校验（cli 生成时、builder 打包时各一次 `parseDiscIR`），浏览器端手工重实现了重复 ID 与 playlist→program/menu 悬挂引用检查，与 `parseDiscIR` 逐条等价 | 已复核 |
| `packages/package-builder/src/index.ts:220-226` | `convertSounds` 重推 parser 已保证的不变式：`parseSound`（`packages/bdmv-parser/src/parser.ts:388-398`）已对 offset/byteLength 对照文件长度抛 `TRUNCATED_INPUT`。两处规则漂移：parser 对未知 code 保留 `channels: null` 的 entry，builder 的 `SOUND_FORMAT_UNSUPPORTED` 直接丢弃——同一事实两个真理源。`SOUND_FORMAT_UNSUPPORTED` 过滤有真实作用应保留；`SOUND_RANGE_INVALID` 一段是纯双保险 | 已复核 |

### 1.4 复核中发现的疑似 bug（非防御问题）

`packages/runtime-web/src/igs-adapter.ts:223`：

```ts
const latestPts = active.reduce((latest, scene) => BigInt(scene.source!.pts90k!), 0n);
```

`reduce` 忽略累加器 `latest`，返回的是数组**最后一个元素**的 PTS。`active` 来自 `candidates.filter(...)`（`:211-215`），调用链中未看到按 PTS 排序的保证；若最后一个元素不是最大 PTS，`latest` 组选择错误。应改为对全数组取最大值。**已确认并修正（见 §7.1）：改为取最大值，并加乱序候选用例。**

### 1.5 有真实作用、审计确认保留的防御

以下防御经复核有明确检测对象与恢复/诊断路径，不属于清理对象：`bdmv-parser` 的 optionalSection 与 BACKUP 文件回退（产出 diagnostic）；`hdmv/src/vm.ts:976` 的 trace 观察者隔离；`igs/src/igs.ts:176-191` 的坏段→diagnostic+清缓存续流；`media-export` 的 reuseMenuLoopMedia 失败回退全量重编码；`package-audit` 的 symlink/realpath 双层路径逃逸检查（TOCTOU）；parser 与 limits 的全部边界检查（逐一对应真实畸形盘形态）。

## 2. 测试与脚本

### 2.1 自比冒充独立验证

| 位置 | 问题 | 状态 |
| --- | --- | --- |
| `packages/runtime-web/src/hdmv-navigation-corpus-dfs.test.ts`（517 行） | 约 380 行为测试本地重实现的 DFS explorer，把自身内部计数器（`states: 7416` 等）作为 `regressionPins` 逐项 `toEqual`；`:15-22` 头部注释自述"regression pins, not independent baselines"；`:96-98` 三连空数组断言叠在 `edgeAccountingComplete` 逐边断言之上。重构即断，bug 不断。保留对 libbluray golden 的 entries/playlists 断言，删除本地 explorer 与 pins | 已复核 |
| `packages/test-runner/src/compare.test.ts:19-28` | `reference.trace` 与 `actualTrace` 传入同一个数组对象，"reference compare" 通过是自比；报告层号称有独立参考（`ReferenceVM`），实际参考工具未运行 | 已复核 |
| `packages/runtime-web/src/tamako-headless-navigation.test.ts` | `expectedControls` 由测试自身从同一 scene 数据计算后与同一测试 explorer 收集的 `testedControls` 比较；`:257` `expect(outcomes).not.toHaveLength(0)` 仅证明非空 | 已复核 |
| `packages/igs/test/libbluray-igs-baseline.test.ts:138-156` | libbluray golden 与 igstools golden 互比 object id 集合。复核修正：这是两个**独立工具**产物间的元素级比对，符合 AGENTS.md 偏好的独立对照方向，但它不执行本项目代码，验证的是参考间一致性；与逐 case pixel 独立对比测试（`:158-204`）并存时价值有限。可保留，定位应标注为参考一致性检查 | 已复核（含修正） |

### 2.2 只证明存在性 / 自我描述

| 位置 | 问题 | 状态 |
| --- | --- | --- |
| `packages/igs/test/libbluray-igs-baseline.test.ts:126-136` | "keeps the complete eight-clip decoder baseline in the repository"：只断言 golden 元数据与魔数 872，防截断守卫，非行为验证 | 已复核 |
| `apps/cli/src/libbluray-navigation-baseline.test.ts:42-52` | 同型，魔数 5225 / 6224 | 已复核 |
| `packages/igs/test/igs-reference-element-summary.test.ts:111-121` | 同型，魔数 891 / 45_752_163 | 已复核 |
| `packages/hdmv/src/reference-golden.test.ts:33-41` | 断言 golden 内"诚实标注"文案本身（`toMatch(/not produced by running libbluray/)`），纯自我描述检查 | 已复核 |
| `apps/cli/src/index.test.ts:536-544` | 用字面量 `"removed"` 作 `--mode` 值证明旧选项确实被拒；未知 option 拒绝契约已由 `:585`（"rejects misspelled options"）覆盖。后半段 INVALID_LIMIT 是合法错误契约，应保留 | 已复核 |
| `packages/igs/test/tamako-real-smoke.test.ts` | `describe.skipIf` 门控在 gitignore 的 `test-data/bdmv/` 本地碟上，CI 恒跳过；`:36` 断言生产代码返回的字面量常量 `"unverified"`；测试名自带免责声明（"without claiming pixel fidelity"）。主体断言（pages 7、objects 168 等）有真实 smoke 价值 | 已复核 |

### 2.3 冗余覆盖

| 位置 | 问题 | 状态 |
| --- | --- | --- |
| `packages/bdmv-parser/src/parser.test.ts:54-64` 与 `:66-80` | 同一 tamako fixture 同一计数（33/17/4969）断言两遍，第二个只是展开为 `it.each` 表格；删其一 | 已复核 |
| `packages/media-export/src/linear.test.ts:133` 与 `linear-variants.test.ts:9,17` | PSR1/语言序行为两文件各写一遍。复核修正：前者是端到端持久化测试，后者是纯函数测试，属分层覆盖；重复部分是"语言排序不影响 PSR1"这一定性在两处重复，可合并定性断言到一处 | 已复核（含修正） |
| `packages/test-runner/src/index.test.ts:169-200` 与 `release-summary.test.ts:33-48` | D-2R"缺证据记 gap 不降级"在两层各断言一遍。复核修正：两层测试的是不同函数（`decideDelivery` vs `createReleaseSummary`），属管线分层各有职责；重复点仅在规则定性句。严重度低于 2.1/2.2 | 已复核（含修正） |

### 2.4 脚本与门禁

| 位置 | 问题 | 状态 |
| --- | --- | --- |
| `packages/test-runner/src/browser-evidence.ts:16,37,60-63,115` | binding 记录 generated media 的 `byteLength` 并做 canonical JSON 全等比对判 stale；测试 `browser-evidence.test.ts:66-71` 验证"binding blob 不变也能拒绝编辑"。文件大小校验进入发布证据门禁，落在 AGENTS.md "Do not add ... file-size verification to package validation or release gates. Do not recreate equivalent content-fingerprint checks under another name" 禁区。缓解：结果只降级 `not-verified` 不产生 fail。应从 binding 移除 `byteLength`（profile/matrix/environment 已足够标识） | 已复核 |
| `package.json:13` | `typecheck` 第一步 `corepack pnpm build` 整体重跑 CI 已执行的 build；`typecheck` 应只做 `-r typecheck` | 已复核 |
| `package.json:16-17` | `test`（bail）与 `test:all`（`--no-bail`）双入口，CI 只用 `test:all` | 已复核 |
| `scripts/ci.sh:11-15` | 门禁脚本预写 "It does NOT verify the integrity of the large binary fixtures" 免责块 | 已复核 |
| `scripts/generate-synthetic-all-features.mjs:7-8` | "no bdmvkit checkout" 对已删除依赖（ba4119b）的陈旧否认；"no FFmpeg" 是现行事实可保留 | 已复核 |

### 2.5 fixture 真实碟名（AGENTS.md 边界）

- `test-data/fixtures/hdmv-navigation/disc-data/` 下 tracked 目录名即真实碟标题：`tamako`、`bang-dream-mygo-vol1`、`battle-royale-uhd`、`kyoani-ova`。已复核。
- 测试名直接使用碟名/自称 real-disc：`parser.test.ts:53`（"Tamako Love Story metadata sample"）、`hdmv-navigation-packet-fixtures.test.ts:20`（`describe("real-disc IGS packet fixtures")`）、`tamako-headless-navigation.test.ts:7`、`tamako-external-navigation.test.ts:12`、`tamako-real-smoke.test.ts:12`。已复核。
- AGENTS.md 允许"在明确定义覆盖范围的测试里保留 sample 名单"；但碟名同时出现在 tracked fixture 目录名与共享 corpus 常量（`libbluray-navigation-baseline.test.ts:39`、`hdmv-navigation-corpus-dfs.test.ts:10`）中，按 AGENTS.md "Do not commit real disc titles ... in fixtures" 应匿名化目录名。
- baja / bdmvkit 删除无断链残留（仅 2.4 的 `generate-synthetic-all-features.mjs:8` 一句）。

### 2.6 测试命名中的否定式描述

以下测试名以"不做什么"命名（断言本身多为合法错误契约，问题在命名）：

- `apps/cli/src/index.test.ts:250`（"does not substitute an unrelated scene..."）、`:270`（"does not guess a scene..."）、`:555`（"instead of silently falling back"）、`:585`（"instead of ignoring them"）
- `packages/media-export/src/external-targets.test.ts:23`（"without claiming concatenated playback"）、`:32`（"without guessing"）
- `packages/media-export/src/linear.test.ts:176`（"instead of exporting a flattened path"）
- `packages/bdmv-parser/src/parser.test.ts:82`（"without comparing its IGS cue to the main clip"）
- `packages/runtime-web/src/index.test.ts:802`（"explains that external title video cannot be overlaid"）

已抽查确认 `:250`、`:270`、`:555`、`:585`、`external-targets.test.ts:23`、`parser.test.ts:82`、`linear.test.ts:176`；其余同型。

## 3. 文档与 OpenSpec

### 3.1 现行文档

| 位置 | 问题 | 状态 |
| --- | --- | --- |
| `docs/guides/development.md:99-115` | "Differences from the counts quoted in the batch-1 review" 与"Round-2 review fixes moved four rows"两大块历史辩解，向旧评审批次解释计数差异；现行基线表（`:79-91`）与 `:96` 的一次性变更注记已足够 | 已复核 |
| `docs/guides/development.md:96` | "The 2026-11-07 revision removed one real-disc fixture ... 43 → 42" 变更日志式叙述残留在现行指南 | 已复核 |
| `docs/guides/development.md:137` | "Why corepack" 加粗理由叙述（含 "more importantly" 修辞性强调）；一句"版本由 `packageManager` 锁定"即可 | 已复核 |
| `docs/guides/development.md:141` | "Load assumption" 为测试超时预设开脱条件（机器忙、负载高），"红门禁不一定是真失败"是辩解大于行为说明 | 已复核 |
| `docs/guides/development.md:146-152` | "Repository hygiene" 解释"为什么留着两个大文件没删"；`:150` 加粗自我澄清"证据未绑定制品指纹……而不是说场景没有跑过"双层否定预防质疑 | 已复核 |
| `docs/guides/browser-matrix.md:11-17` | 实测记录 1 行对 5 条连续免责；`:11` 为两张样碟（均 16:9）复现不了的假想问题写完整风险加修复处方 | 已复核 |
| `docs/references/README.md:39-48` | 第一人称会话日志混入常设索引（"本轮匿名 curl 获得的"、"本轮下载得 PDF 3,127,517 bytes"、"不能将旧版定位假装成 v10 的独立确认"） | 已复核 |
| `docs/references/README.md:70-74` | "没买规范书但该限制不阻止开发"辩护三段重复；证据层级定义（L4-10）已表达一次 | 已复核 |
| `docs/support/hdmv-support.md` | "pinned-implementation assertions, not independent-player goldens / remain unverified / remains pending" 免责短语出现 17 处；表格 Evidence status 列已表达同一信息，段落级重复属堆叠 | 已复核（计数） |
| `docs/support/protocol-support.md:35,42` | 先否认一个未发生的指责再陈述状态（"lack of BDA text alone is not the reason"）；同型辩护 L10、L15、L42 三处 | 已复核 |
| `README.md:53` | `maxCallDepth`"是 CALL 开关不是深度上限"免责，与 IMPLEMENTATION_BASELINE.md:99、hdmv-support 等 4+ 处逐字级重复（见 §4） | 已复核 |

### 3.2 身份未解决的历史文档

| 位置 | 问题 | 状态 |
| --- | --- | --- |
| `docs/architecture/bdmv_hdmv_offline_web_architecture.md:1` | 页首自标"历史架构方案，不是当前实现规格"，但根 `README.md:146` 与 `docs/README.md:19` 以"架构说明 / 技术设计与组件关系"链入现行索引 | 已复核 |
| 同文件 `:142,546` | 内嵌两块"历史设计（非当前实现）"补丁 + 页首一块，正文与现状分离靠注释维持 | 已复核 |
| 同文件 `:445` | 反问句节标题"9.1 为什么不能直接使用常见 SPA 打包方式" | 已复核 |
| 同文件 `:531,592,880` | "声明边界"段连续"不可能/而不是声称/无法保证"；对未做且明确不做的 BD-J 展开防御性边界说明；收尾免责被页首定位覆盖 | 已复核 |
| `openspec/changes/READINESS_REVIEW.md` | 自标历史记录却位于活跃 changes 目录，含大段自我评估与"未验证"清单，易被当作现行状态报告 | 位置已复核，内容未逐段核 |

### 3.3 活跃 OpenSpec change 中的对话式辩解残留

| 位置 | 问题 | 状态 |
| --- | --- | --- |
| `converge-contracts-and-distribution/proposal.md:55-73` | 整节"当前实现与归档状态"声明初始清单"部分过时"，正文保留自标"仅作历史背景，不作为当前执行指令"的表——正文应改写而非层层加注 | 已复核 |
| `converge-contracts-and-distribution/assumptions.md:29-31` | "那正是本 change 要消除的病"；blockquote 第二人称会话残留"只有你知道 64/256 的来历。若记不清……" | 已复核 |
| `converge-contracts-and-distribution/assumptions.md:88-91` | 同一删除在 L17、L89、L91 辩护三遍（"一个能算出哈希的导出函数同样是承诺……"） | 已复核 |
| `converge-contracts-and-distribution/design.md:49-53` | "本 change 选择如实标注而不是改结构"、"不在本批夹带"辩解句式；可直接写"当前语义为 CALL 开关，深度上限列为后续 change" | 已复核 |
| `converge-contracts-and-distribution/design.md:106` | 先否认一个没人提议的做法再给方案（"不用临时删 src 这种破坏性操作"） | 已复核 |
| `converge-contracts-and-distribution/design.md:125` | Risks 一节道德化辩解（"退回去比留着假通过安全"） | 已复核 |
| `REVIEW_BACKLOG.md:5-10` | 用两段"不是 X 而是 Y"定义文件自身用途（"登记的目的不是以后再说"、"不是待办清单，不逐条勾选"） | 已复核 |
| `REVIEW_BACKLOG.md:26` | "X4 与 D9 的区别……不要合并处理"预辩解 | 已复核 |

### 3.4 其他活跃 change 中的免责句式（轻度）

- `export-playable-media/design.md:23`：单句内三层"不等同/限制/不声称"，"不声称等价播放"把免责写成行为要求。已复核。
- `export-playable-media/proposal.md:27`：对未实现事物补充否认（"未接入的线性媒体/浏览器播放原语不构成当前产品交付路径"）。已复核。
- `verify-offline-release/design.md:31`：边界规则合理，"阻止全碟完整承诺"措辞是对承诺表态，可改"记 unknown"。已复核。

### 3.5 llm-wiki（轻度）

- `docs/llm-wiki/testing.md:13`：括号内"现在也不再产出"对比残留。
- `docs/llm-wiki/features/offline-menu.md:112-116`、`verification.md:24`："`complete` 不是全部验证通过"、"缺证据不是失败证据"的否定式定义与其他文档成套重复（见 §4）。

## 4. 跨文件重复免责

同一免责在多个面向不同读者的文档中重复：

| 免责 | 出现位置（已确认） |
| --- | --- |
| `maxCallDepth` 是 CALL 开关不是深度上限 | `README.md:53`、`openspec/changes/IMPLEMENTATION_BASELINE.md:99`、`docs/guides/development.md`、`docs/support/hdmv-support.md`（≥4 处） |
| `complete` = "没有已知失败"，不是"全部验证通过" | `docs/llm-wiki/features/offline-menu.md:116`、`verification.md:24`、`development.md:69`、cli-delivery-status spec（≥4 处） |
| 缺证据不是失败证据 | `verification.md:24`、specs、`development.md`（≥3 处） |
| pinned-implementation ≠ independent golden | `docs/support/hdmv-support.md`（17 处）、`protocol-support.md`（3 处）、`IMPLEMENTATION_BASELINE.md`、`browser-matrix.md` |

## 5. 处理优先级

1. `browser-evidence.ts` binding 移除 `byteLength`（含对应测试）——唯一贴近 AGENTS.md 红线的活代码。
2. 删除死防御：`igs-adapter.ts:174` 空循环、`core/index.ts:113` `validateStage`、`runtime-web/index.ts:487` `isPageMember`（先确认 bog 重复按钮可能性）、`index.ts:994` 不可达分支、`browser.ts:15` profile 形状检查。
3. 修复吞错：`bdmv-io/index.ts:157` 还原失败并入错误、`package-audit.ts:241` 记 not-verified check、`apps/cli` 复用 audit 已解析 manifest。
4. `compare.test.ts` 自比 reference compare 改名或接真实参考 trace。
5. `hdmv-navigation-corpus-dfs.test.ts` 删除本地 explorer 与 regressionPins，保留对 libbluray golden 的断言。
6. golden 元数据三测合并为一条 sanity check 或删魔数断言。
7. 冗余校验收窄：`package-builder:130` 第二次 `parseDiscIR`、`browser.ts:448-468` 重复 ID/悬挂引用段、`convertSounds` 的 `SOUND_RANGE_INVALID` 段。
8. 脚本：`package.json` typecheck 去 build、删 `test`/`test:all` 双入口之一、`ci.sh:11-15` 免责块、`generate-synthetic-all-features.mjs:8` 陈旧否认句。
9. 文档改写：`development.md:96-115` 历史辩解块改为现行基线、`browser-matrix.md` 免责收敛、`references/README.md` 会话日志移出、`hdmv-support.md` 段落级重复免责收敛到 Evidence 列。
10. `docs/architecture/bdmv_hdmv_offline_web_architecture.md` 移入 archive 或改写为现行架构，同步根 README 与 docs/README 索引。
11. OpenSpec 活跃 change 清理：`converge` proposal:55-73 正文改写、assumptions 会话残留、design 辩解句式、REVIEW_BACKLOG 定义段。
12. 独立核实 `igs-adapter.ts:223` reduce 语义后修复（§1.4）。
13. fixture 目录名匿名化 + 测试名碟名清理（§2.5）。

## 6. 审计边界

- 审计阶段为只读记录，未修改任何文件；后续修正与处理结果见 §7。
- 源码类每条均经行级复核；测试类全部复核（2.1 igstools 互比、2.3 linear/test-runner 两条为复核后修正定性）；文档类引文全部确认存在，`READINESS_REVIEW.md` 内容未逐段核。
- 未验证项：无。历史目录（`docs/archive/`、`docs/review-2026-11-04/`、`docs/review-2026-11-06-daily/`、`openspec/changes/archive/`）按历史记录定位，不在清理范围。

## 7. 修正记录（2026-11-07）

逐条复核后执行的结果。验证方式：`corepack pnpm build`、`corepack pnpm -r typecheck`、`corepack pnpm lint`、`corepack pnpm -r --no-bail test`（Node 22.22.2 / pnpm 11.25.0，本机）全部退出 0，无失败、无跳过。

### 7.1 源码（§1）

| 位置 | 复核 | 处理 |
| --- | --- | --- |
| `igs-adapter.ts:174-175` 空循环 | 未复现。当前文件该行为 `return { scene: ... }`，全仓无 `for (const page of scene.pages) {}` 空体 | 无需处理 |
| `core/src/index.ts:113` `validateStage` | 确认存在，全仓零调用者（仅 `dist` 声明残留），`runtime` 分支对 BD-J 无任何行为 | 已删除 |
| `runtime-web/src/index.ts:487` `isPageMember` | 确认存在且恒真：四个调用点的入参都来自 `this.page.buttons.find(...)`，回查同一数组恒成立；`bog` 比对也是同一对象自比 | 已删除，`applySetButtonPage`/`setButtonEnabled` 改为 `!target` 判断 |
| `runtime-web/src/index.ts:993-994` 不可达分支 | 确认存在：`duration` 两行前已校验为有限正数，`logicalTime` 取自 `video.currentTime` | 已删除 |
| `browser.ts:15-16` profile 形状检查 | 保留。原判依据不成立：`normalizeProfile` 只做 `{ ...defaults, ...profile }` 展开，传入字符串/数组时不会抛错，而是静默生成错误 profile（如 `{0:"j","1":"p"}`） | 保留（改为记录理由） |
| `bdmv-io/src/index.ts` 还原失败被吞 | 确认存在 | 已修正：还原失败抛出 `OUTPUT_RESTORE_FAILED`，消息带原错误与遗留备份路径 |
| `package-audit.ts:242` JSON 解析失败沉默 | 确认存在（既用于 `.json` 文件，也用于内联 `<script type="application/json">`） | 已修正：记 `RUNTIME_JSON_UNPARSABLE` / `not-verified` |
| `apps/cli/src/index.ts:1042` manifest 重读吞错 | 确认存在：重读失败时 `manifestStatus` 变 undefined，D-2R 的“状态不一致须报告”静默失效 | 已修正：读失败记 `MANIFEST_REREAD_FAILED` / `not-verified`。未改为“复用 audit 已解析结果”——`OfflinePackageAudit` 不携带原始 manifest，把它塞进 audit 结果会改变 CLI JSON 输出契约 |
| `package-builder/src/index.ts:130` 第二次 `parseDiscIR` | 保留。这是库入口对 `input.ir` 的唯一校验，会写进 `runtime/disc-data.js`；CLI 路径已校验不构成删除依据（第三方调用不会经过 CLI） | 保留 |
| `browser.ts:450-471` `validateEmbeddedDiscIR` | 确认是第三层校验且运行时从不读取 `ir` | 已收窄：只保留对象身份检查（`schemaVersion`、必需数组），删除与 `parseDiscIR` 逐条等价的重复 ID / 悬挂引用 / program title 段；依赖该段的 `browser.test.ts` 悬挂引用子用例同步删除 |
| `package-builder` `convertSounds` 的 `SOUND_RANGE_INVALID` | 原判不完整：`sampleByteLength % (channels*2)` 的帧对齐与 `0xffffffff - 36` 的 RIFF 尺寸上限不是 `parseSound` 的不变式 | 保留（只删去与 parser 重复的措辞不再成立，实际规则有独立内容） |
| `igs-adapter.ts:220` `reduce` 忽略累加器 | 确认是缺陷：返回数组最后一个元素的 PTS，候选未按 PTS 排序 | 已修正为取最大值；`igs-adapter.test.ts` 增加乱序候选用例 |

### 7.2 测试与脚本（§2）

| 位置 | 复核 | 处理 |
| --- | --- | --- |
| `hdmv-navigation-corpus-dfs.test.ts` `regressionPins` | 确认是 explorer 自身计数器的快照 | 已删除 `regressionPins` 与逐项 `toEqual`；保留 libbluray 派生的断言（条目数、PLAY 目标集合）与 explorer 的边记账不变量。本地 explorer 未删除：`observedPlaylists ⊇ libbluray 静态 PLAY 目标` 这条独立对照依赖它 |
| `compare.test.ts:19-28` 自比 | 确认：reference 与 actual 是同一数组对象 | 已改为两份独立 trace，测试名改为断言适配器行为 |
| `tamako-headless-navigation.test.ts` | `expectedControls` 源自场景数据、`testedControls` 源自执行，属覆盖记账，保留；`:242` `not.toHaveLength(0)` 与同段落其他断言重叠 | 已删除该行 |
| `libbluray-igs-baseline.test.ts:126-136`、`apps/cli/.../libbluray-navigation-baseline.test.ts:42-52`、`igs-reference-element-summary.test.ts:111-121` | 确认是 golden 元数据与魔数（872 / 5225+6224 / 891+45752163），每个 clip 的真实对照由同文件 `it.each` 覆盖 | 三个用例全部删除 |
| `libbluray-igs-baseline.test.ts` igstools 互比 | 两个独立工具产物间的元素级比对，不执行本项目代码 | 保留，测试名改为 `compares the libbluray and igstools reference object id sets` |
| `reference-golden.test.ts:33-41` | 断言 golden 内的自我描述文案 | 已删除 |
| `apps/cli/src/index.test.ts` `--mode removed` 子用例 | 与 `:577` 未知选项契约重复 | 已删除该子用例，用例改名为 “rejects an invalid limit before creating output” |
| `tamako-real-smoke.test.ts` | 整文件：唯一独有的断言是 `support.status` 恒为字面量 `"unverified"`；其余（playlist 00003 的 999 个 playItem、PID 语言、clip 00005 的 pages 7 / objects 168 / palettes 7、缺失 00043 的诊断）分别由 `hdmv-navigation-packet-fixtures.test.ts` 的 tamako 用例与 `tamako-external-navigation.test.ts` 覆盖；测试名带免责尾句 | 已删除整个文件 |
| `parser.test.ts:54-64 / 66-80` | 同一 fixture 同一计数断言两遍 | 已合并为一个用例 |
| `linear.test.ts:133` 与 `linear-variants.test.ts` | 端到端与纯函数分层，重复点只在定性断言；`linear-variants` 内两条 `expect(["eng","jpn"].sort()).toEqual(...)` 是对 `Array.sort` 的恒真断言 | 恒真断言已删除，定性断言保留在一处 |
| `test-runner/src/index.test.ts:169-200` 与 `release-summary.test.ts:33-48` | 断言对象是不同函数（`decideDelivery` / `createReleaseSummary`） | 保留 |
| `browser-evidence.ts` binding 的 `byteLength` | 确认：binding 记录并全等比对生成媒体字节长度，落在 AGENTS.md 禁区（结果只降级 `not-verified`，不产生 fail） | 已移除：`generatedMedia` 只保留 `path`/`kind`；`BrowserEvidenceContext.generatedFiles` 收窄为 `ManifestFile[]`；`browser-evidence.test.ts` 与 `browser-matrix.md` 同步 |
| `package.json:13` typecheck 含 build | 原判前提不成立：`scripts/ci.sh` 直接跑 `-r typecheck`，从不调用根 `typecheck`；各包 `package.json` 的 `types` 指向 `dist`，去掉 build 后干净检出会失败 | 保留 |
| `package.json:16-17` `test` / `test:all` 双入口 | 原判不成立：两者语义不同（`test` 快速失败、`test:all` 收集全部失败），且 README、`testing.md`、`development.md`、`troubleshooting.md` 共 5 处按两种模式分别介绍；与 `lint` / `lint:fix` 结构相同 | 保留（删除后 `corepack pnpm test` 返回 exit 1，等于让文档命令失效） |
| `scripts/ci.sh:11-15` 免责块 | 确认 | 已删除 |
| `scripts/generate-synthetic-all-features.mjs:7-8` | 确认 `bdmvkit checkout` 是已删除依赖的陈旧否认 | 已删除该短语 |
| fixture 目录名与测试名中的碟名（§2.5） | 确认存在 | **未执行**，见 7.4 |
| 否定式测试名（§2.6） | 确认存在 | 已改名：`cli` 4 处、`external-targets` 2 处、`linear` 1 处、`parser` 1 处、`runtime-web` 1 处、`linear-variants` 2 处 |

### 7.3 文档与 OpenSpec（§3、§4）

| 位置 | 处理 |
| --- | --- |
| `development.md` Test baseline 的两块历史辩解与变更日志句 | 已删除，整节改写为逐包命令与测试作用域说明 |
| `development.md` “Why corepack” / “Load assumption” / “Repository hygiene” / 末尾中文免责 | 改为直接说明：pinned 版本、超时数值、两个超 1 MiB 夹具与生成规则、Chrome 证据唯一位置 |
| `development.md` `complete` 双重否定定义、`maxCallDepth` 长句 | `complete` 改为正向陈述；`maxCallDepth` 只在此处与 README 各保留一处（中英分读者） |
| `browser-matrix.md:11-17` | 五条连续免责收敛为四条事实条目；删除“不校验校验和”与“证据未绑定指纹”的否定式表述 |
| `references/README.md:39-48`、`:70-74` | 会话日志改为常设事实（v10 需 TIES 登录、2014 版可匿名获取、clause 位置）；“证据边界”改为按层级指向阶段页，删去重复辩护 |
| `hdmv-support.md` | 逐行 `no independent golden` / `independent cross-check pending` 与段落级重复免责全部删除，改由表头一句与 State / fixture 列承载；Register 矩阵 Evidence 列改为来源 |
| `protocol-support.md` | `Lack of BDA text alone is not the reason` 等三处否定式辩护删除；“Evidence and fixture gaps”逐条改为状态陈述 |
| `README.md:53` | 保留（用户配置 `--limits` 的上下文） |
| `openspec/.../IMPLEMENTATION_BASELINE.md`、`hdmv-support.md` 的 `maxCallDepth` 重复 | 改为指向 limits 表 |
| `docs/architecture/bdmv_hdmv_offline_web_architecture.md` | 已移至 `docs/archive/`；`README.md` 与 `docs/README.md` 索引改标为历史归档；删除正文两块内嵌“历史设计”补丁，反问句标题改为陈述式，“声明边界”段删去自我否认 |
| `openspec/changes/READINESS_REVIEW.md` | 已移至 `docs/archive/readiness-review-2026-11-02.md`，`DEPENDENCIES.md` 链接同步 |
| `converge` proposal `:55-73` | 改写为现状态陈述，删除自标“过时”的归档前置表 |
| `converge` assumptions `:29-31`、`:88-91` | 删除“本 change 要消除的病”与第二人称 blockquote；哈希函数删除理由改为直接陈述 |
| `converge` design `:49-53`、`:106`、`:125` | 三处辩解句式改为方案陈述与验收断言 |
| `REVIEW_BACKLOG.md:5-10`、`:26` | “不是待办清单”式自我定义改为处理规则；X4/D9 区别改为并列陈述 |
| `export-playable-media` design/proposal、`verify-offline-release` design | 三处轻度免责改为行为陈述 |
| `llm-wiki/testing.md`、`offline-menu.md`、`verification.md` | “现在也不再产出”删除；交付状态双重否定改为单处定义 + 链接 |
| `llm-wiki/packages/foundation.md:30`、`:41` | 随 `validateStage` 删除：API 表去掉该行，“runtime 阶段对 BDJ 只保留不报错”一条同时删除 |
| `llm-wiki/contracts.md:35` | 改为现状：`ir` 在打包阶段过 `parseDiscIR`，运行时只做对象身份检查 |
| `llm-wiki/packages/runtime-web.md:96` | `validateEmbeddedDiscIR` 由“按 schema 校验”改为对象身份检查，指向打包阶段 |
| `llm-wiki/testing.md:77` | 删去已不存在的 `regressionPins` 描述，改为 explorer 与 libbluray 导航基线的三组对照 |

### 7.4 未执行项

**§2.5 fixture 目录名匿名化。** 复核确认 `test-data/fixtures/hdmv-navigation/disc-data/` 下四个 tracked 目录名是真实碟标题，同时作为 `libbluray-1.5.0-igs-baseline.json`、`libbluray-1.5.0-navigation-baseline.json`、`igs-reference-element-summary.json` 中的 `case` 键，并被 8 个测试文件、`docs/support/igs-support.md` 等文档引用。改动范围：24 MB 已提交 fixture 的 `git mv`、三份基线 JSON 的键名、`corpus` 常量与测试文件名、文档引用。这是一次机械式全仓重命名，与本次逐条修正的粒度不同，单独执行并逐项复核更容易验证。测试名中的碟名保留同样原因：目录仍以原名存在时，只改测试名会制造新的不一致。

**§2.4 `verify-offline-release` tasks 4.3 的勾选。** 该任务包含“移除长度门槛”与“按新边界重新采集证据”两部分。前者已由本次代码修正完成，后者的浏览器证据仍未采集，任务保持未勾选。

### 7.5 复核后修正的原判

| 原判 | 复核结果 |
| --- | --- |
| `browser.ts:15` profile 检查拦不住的内容 `HdmvVm` 全都会拦 | 不成立。`normalizeProfile` 只做展开，基本类型会静默产出错误 profile |
| `convertSounds` 的 `SOUND_RANGE_INVALID` 是纯双保险 | 不成立。帧对齐与 RIFF 尺寸上限不属于 `parseSound` 不变式 |
| `package.json` typecheck 重跑 CI 已执行的 build | 不成立。CI 不调用根 `typecheck`；该脚本服务于干净检出的本地运行 |
| `package.json` 的 `test` / `test:all` 是重复入口，可删除 `test` | 不成立。删除后 5 处文档命令返回 exit 1；两者是 fail-fast 与 collect-all 两种模式，非重复 |
| 删除本地 explorer 后仍可保留 libbluray 的 playlists 断言 | 不成立。`observedPlaylists` 由该 explorer 产出 |
| `igs-adapter.ts:174-175` 存在空循环 | 未复现；文件在该位置是 `return` |

### 7.6 计数基线移除

用例计数不构成证据，且每次增删用例都要同步多处，维护成本高于信息价值。按「计数基线不必维护」的要求移除：

| 位置 | 处理 |
| --- | --- |
| `docs/guides/development.md` | `Test baseline` → `Test suites`：删去总数、逐包用例数与「计数变化须同步本表」规则，保留逐包命令与 `vitest.config.ts` 作用域说明 |
| `docs/llm-wiki/testing.md` | `逐包基线` → `逐包入口`：删去用例数、「42 个测试文件」与两处同步句，保留逐包命令与覆盖说明 |
| `docs/references/stages/M6-release-verification.md` | focused suite 表去掉「结果」计数列，删去 2026-11-04 重测段 |
| `docs/references/stages/M2-igs-scenes.md` | 真实样本条目改指向 IG 包切片测试；删去已删除的 `tamako-real-smoke.test.ts` 与「1 test passed」 |
| `openspec/changes/converge-contracts-and-distribution/tasks.md` E.6 / H.2 | 去掉用例数与「不低于基线」阈值，验收改为全绿 |

历史记录（`docs/review-2026-11-04/`、`openspec/changes/archive/`）保留当时的计数，它们是观察记录，不改写。`tamako-real-smoke.test.ts` 本已删除（§7.2），本次一并清掉指向它的文档引用。
