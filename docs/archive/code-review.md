# 代码评审（分模块 · 分功能）

> 本文件是一次评审快照，用于推动后续修复排期，不是长期规范文档。
> 「待决策事项」一节保留了填写位，评审人确认后请直接在本文件内填写再提交。

| 项 | 值 |
| --- | --- |
| 评审对象 | `bdmv2web` monorepo（10 个包 / 约 9k 行非测试 TS） |
| 基线提交 | `614b4fe` (master) `feat(igs): complete field and color validation` |
| 评审时间 | 2026-11-04（第一轮模块/性能；同日第二轮补验收链、失败状态与文档事实，已合并进本文件） |
| 评审方式 | 通读源码 + 实际执行 `build` / `typecheck` / `test` / CLI 端到端校验；第二轮另做空 BDMV、Tamako `source-map`、`JUMP_TITLE` 图与参考实现对照 |
| 结论 | 工程质量偏上，但当前 HEAD 构建门禁为红，且无 CI 兜底；第二轮发现验收链与失败状态仍有"字段存在、校验不生效"的缺口 |
| 决策状态 | 第一轮 8 项已预填（15 处标 `⚠需确认`）；第二轮新增 D9–D13（已预填，待确认） |

## 总体结论

设计取向是这个仓库最突出的优点：契约优先（JSON Schema → 生成类型 → Ajv 严格校验）、诊断可追溯（每条异常都带 `code` + `path`）、二进制解析逐段做边界校验、每个包都有测试。代码里没有 `any` / `@ts-ignore` / `TODO`，`strict` 与 `noUncheckedIndexedAccess` 全开。

问题集中在四类，且都不是"写错逻辑"，而是**流程与一致性**：

1. **门禁是红的，但没人拦**——两处编译/语法错误已经合进 `master`，说明缺少 CI。
2. **同一份契约有两套数值**——默认播放器配置与调用深度上限在 `core` 与 `hdmv` 各写一份且数值不同，这是长期最危险的隐患。
3. **性能热点统一呈现"大输入 + 二次方"**——真实 UHD 碟会先在 parser / PES / 字节预算这三处顶墙。

## 一、门禁实测状态

```text
corepack pnpm -r build      → 2 failed, 8 passed
corepack pnpm -r typecheck  → failed（test-runner + runtime-web；-r 在第一个失败处中止）
单测                        → 441 passed / 1 skipped（第二轮复测口径，含 dist 重复执行）
                              按源码口径的逐包数字见第 1 批任务 0.1，需重测后入表
                              test-runner 报 2 failed | 8 passed (10) / 42 passed：
                              源码只有 5 个 .test.ts，10 = src 与 dist 各跑一遍；
                              index.test.ts 语法错误导致该文件 20 条用例整体未执行
```

> **口径警告**：`441` 不能直接当作"当前有多少用例"。至少 `test-runner`、`package-builder`、`runtime-web` 三个包的 `vitest` 配置没有 `include`，会把 `dist/*.test.js` 再跑一遍。任何用于跨版本对比的数字，必须先清理 `dist` 测试产物再测。

> 第二轮复测（同日）确认：`runtime-web` 的 `TS2741` 在单独 `tsc -p packages/runtime-web --noEmit` 下可复现；`test-runner` 的 `index.test.ts` 仍因重复代码块整体不可加载。第一轮记录的 "393 passed" 与本次 "441 passed / 1 skipped" 差异来自统计口径（是否计入 `dist/*.test.js` 的重复执行、是否包含各包新增用例），以本轮复测为准。
>
> 修正：`test-runner` 的 "42 passed" 是 `src` 与 `dist` 各跑一遍的合计（5 个源码文件 × 2）。清理 `dist` 测试产物后为 `5 passed (5) / 41 passed`，`index.test.ts` 的 20 条用例在修复语法错误后计入。

| 位置 | 现象 | 影响 |
| --- | --- | --- |
| `packages/test-runner/src/index.test.ts:109-118` | 一段测试体被整段重复粘贴到 `it()` 之外（第 108 行已 `});` 闭合），触发 `"await" can only be used inside an "async" function` | `typecheck` / `build` / `test` 三处同时失败 |
| `packages/runtime-web/src/igs-adapter.test.ts:14` | `TS2741: Property 'numericSelectValue' is missing` | `IgsButton` 新增必填字段后夹具未同步，编译期先于测试断言失败 |
| 仓库根 | 无任何 CI 配置（无 `.github/`） | 本地红灯也能推，上述两条已进入主干 |
| `packages/hdmv` | 没有 `vitest.config.ts`；直接 `vitest run` 会同时执行 `dist/*.test.js`，并因 `dist/fixtures/*.json` 未被 `tsc` 复制而失败（包脚本用 `vitest run src` 规避） | 测试入口不统一，开发者直接运行时得到假失败 |

结构性诱因：所有包 `tsconfig.json` 均为 `include: ["src/**/*.ts"]`，测试文件因此进入 `build`，`dist/` 里可见 `parser.test.js`、`index.test.d.ts`。建议拆 `tsconfig.build.json`（`exclude **/*.test.ts`），让"产物编译失败"与"测试编译失败"归因分离。

## 二、分模块评审

### `@bdmv2web/core` — 契约层

- ✅ Ajv 严格模式之外还叠加了 `DUPLICATE_ID` / `DANGLING_REFERENCE` 手工二次校验，错误统一带 `code` + `path`。
- ⚠️ `validateStage()`（`src/index.ts:154-162`）是空操作：`if` 分支内只有注释。API 上看起来做了分级校验，实际 `parsed` / `normalized` 直接返回入参。建议删除或真正实现。
- ⚠️ `parseDiscIR` 返回入参同一引用且未冻结，校验通过后调用方仍可改坏 IR。建议 `structuredClone` / `Object.freeze`，或显式文档化该契约。
- ⚠️ `validateLimits()`（`src/index.ts:121-129`）只校验已知键的类型，未知键会被原样合并；拼错 `maxCallDepht` 之类不会报错，`--limits` 的无效键会静默失效。
- ⚠️ `DEFAULT_PLAYER_PROFILE` 在此定义后，又在 `packages/hdmv/src/vm.ts:31-35` 原样复制；`Limits` 的 `maxCallDepth=128` / `maxQueueDepth=1024` 在 `vm.ts:30` 变成 `64` / `256`。**同名常量两套数值**，详见横切问题 1。

### `@bdmv2web/bdmv-io` — 文件系统与安全边界

- ⚠️ **性能**：`buildInputFileTable`（`src/index.ts:88-99`）对每个文件调 `resolveInputFile`，后者每次都 `canonicalDirectory(root)`（`realpath` + `stat`）。千文件级碟会做千次重复 root 解析，root 应只解析一次后透传。
- ⚠️ `beginOutputTransaction` 的 `lstat` 存在检查与 `rename` 之间有 TOCTOU 窗口（`src/index.ts:162-173`）；`rename` 落到已存在的空目录上仍会成功，注释里 `TARGET_EXISTS` 的保证不严格。
- `readRegisteredFile` 先以 `MAX_SAFE_INTEGER` 求 size 再自判 `maxBytes`，逻辑无误但可读性差。

### `@bdmv2web/bdmv-parser` — BDMV 结构解析

- ✅ 位级 `Bits` 封装、每个 section 都校验 `end` / `length` 越界、错误码语义化（`BDMV_INVALID_SECTION` 等），是相当克制的二进制解析实现。
- ⚠️ **`choose()` 用十六进制字符串比较主/备份**（`src/parser.ts:257`）：`hex(primary.raw) !== hex(backup.raw)` 会把最大 8MB 的 buffer 变成两份 16M 字符字符串。应改逐字节比较。
- ⚠️ **`buildGraph` 是 O(n²)**：`nodes.some(...)` 去重、每个 PlayItem 内 `clips.find(...)`、每处诊断 `files.find(...)`（`src/parser.ts:267,296,299`）。建议预建 `Map` / `Set` 索引。
- ⚠️ `parseMpls` 的 `attrBytes` 计算（`src/parser.ts:126`）两个分支结果都是 `4`，条件列表却不同，属"看起来在区分、实际没区分"的死逻辑。
- ⚠️ `asUtf8` 实际用 `TextDecoder("ascii")`（第 7 行），命名与实现不符。
- ⚠️ **CLPI HEVC 属性长度可能拒绝合法 UHD 盘**：`parseClpi` 对 `codingType === 0x24` 要求 `attrBytes = 8` 并 `skip(8)`（`src/parser.ts:200`），而 pinned libbluray 的 `clpi_parse.c` 对 0x24 只读 32 bit = 4 字节（format/rate/aspect/oc/cr/dynamic-range/color-space/hdr_plus，见 `.reference-cache/libbluray-1.5.0/src/libbluray/bdnav/clpi_parse.c:79-90`）。仓库没有 0x24 样本，这个分支未被测试覆盖，真实 HEVC CLPI 很可能抛 "attributes exceed record"。
- ⚠️ **可选 sound 损坏会中止整个解析**：`parseSound` 在 `choose()` 之外直接调用（`src/parser.ts:364`），异常不再转成诊断。实测放一个内容为 `junk` 的 `AUXDATA/sound.bdmv`，`inspect` 直接 `exit 1`，没有 `parsed-disc.json`。设计只规定"无 sound"要记录资源缺失，没有要求损坏的可选文件使 inspect 整体失败；建议纳入 `choose()` 的 diagnose 路径，或明确写成 fatal。
- ⚠️ **结构图有不存在的 `command:*` 端点**：`buildGraph` 为每条指令加 `edges.push({ to: "command:<object>:<index>" })`（`src/parser.ts:286`），但从未 `add` 对应节点。`findStaticNavigationLoops` 会跳过这些边，其他消费者如果假设"边两端都在 nodes 中"就会拿到悬空引用。要么补节点，要么删除这些边。
- 可维护性：`parseMpls` / `parseClpi` 是 60+ 行、分号密集的大函数，边界校验高度重复，建议抽 `readBoundedSection()` 之类的助手。

### `@bdmv2web/hdmv` — 虚拟机

- ✅ 罕见的高质量仿真层：`continuation` + `generation` + `consumedResponses` 三重去重防"迟到事件重入"；`beginMenuAction` / `recoverMenuAction` 检查点回滚；`callStack` 单帧行为与 libbluray 对齐并留注释；`HDMV_UNVERIFIED_OPCODE` 降级为 idle 而非 fault。测试 74 个且含源码派生 golden。
- ⚠️ 常量重复（见横切问题 1），本模块应最先解决。
- ⚠️ **静态图把 `JUMP_TITLE` 当终止指令**（`src/graph.ts:63` 的 `terminatesFlow`），但 VM 在 `JUMP_TITLE` 后继续执行下一 PC（`src/vm.ts:427-436`）；`LINK_PI` / `LINK_MK` / `TERMINATE_PL` 在 MovieObject 上下文也被 VM 忽略后继续，图却同样终止流。实测最小 JUMP_TITLE 程序只得到 `jump` 边，没有到 `command:7:1` 的 `sequence` 边。这会让后续指令被误判不可达，影响媒体闭包、静态环检测和覆盖统计。
- ⚠️ **`CALL_TITLE` 没有 continuation**：`src/vm.ts:437-458` 只设置 `pendingTitleCall` 并进入 `suspended`，不建立 `continuation`。任何播放桥回复 `MEDIA_UNAVAILABLE` 都会被 `handleEvent` 以"没有等待中的 continuation"丢弃并记录 `HDMV_IGNORED_EVENT`，桥侧无法解除这个等待。
- ⚠️ `maxCallDepth` 的检查是 `if (this.opts.maxCallDepth < 1)`（`src/vm.ts:409,447`），不是深度比较；实现只保留一个调用上下文，所以它实际是"允许/禁止 CALL"的开关，而不是文档写的调用深度上限。`HdmvVm` 也未接收 `Limits`，`--limits` 无法穿透。
- ⚠️ `execute()` 中 `PLAY_PL*` / `LINK_*` / `TERMINATE_PL` 按 `context` 静默 `return`（`src/vm.ts:460-470`）。被忽略的指令既不产生 action 也不产生诊断，"按了没反应"极难排查。建议至少记一条 `HDMV_OPCODE_CONTEXT_SKIPPED`。
- ⚠️ `emit()` 的 `generation` 每次自增，与 `snapshot().generation` 共用同一计数，语义上"会话代次"与"动作代次"混在一起。
- 清理项：`runTurn` 的 `if (this.programId !== from.programId || this.pc !== from.pc + 1) { /* comment */ }`（`src/vm.ts:258`）是空分支；`transfer()` 的 `target` 变量和 `execute()` 的 `program` 参数未使用（`noUnusedLocals` 可复现）。

### `@bdmv2web/igs` — TS / PES / IGS

- ✅ 192 字节 M2TS 同步搜索、连续性计数器含重复包判定、PTS 回绕（`MAX_PTS/2`）与"无回绕倒退则开新时域"、PSI CRC 全量计算——协议细节扎实，异常全部落成诊断。
- ⚠️ **`PesAssembler.append()` 是 O(n²)**（`src/transport.ts:262,349`）：每收一个 184 字节 TS 包就整段复制已有 PES 缓冲，1MB PES 产生约 5.7GB 复制量。应改为"TS 包切片数组 + 结束时拼接"。
- ⚠️ `PsiAssembler.programsHasPid()` 每包执行 `[...this.programs.values()].includes(...)`（`src/transport.ts:177`）——每包一次 O(n) 展开，加一个 PID `Set` 缓存即可。
- ⚠️ **结构性诊断的源位置被压扁**：`toIgsSource()`（`src/extract.ts:178`）把 MPLS/CLPI 的 `SourceLocation` 转成 `clipId: ""`、`pid: 0`、各 offset 都等于源 offset 的 `IgsSource`；CLI 的 `mapIgsSource()` 再按空 clipId 拼出 `BDMV/STREAM/.m2ts`。实测 Tamako 的 `source-map.json` 中 `BDMV_MISSING_STREAM` 来源就是 `BDMV/STREAM/.m2ts`。应保留原 path/pid/origin，或在结构诊断中单独保留 `SourceLocation`。
- ⚠️ `extractIgsScenes()` 的 `seen` 只按 `clipId` 去重（`src/extract.ts:15,39`）；同一个 Clip 若在不同 PlayItem 中声明两个 IG PID，第二个 PID 会被跳过。去重键应包含 pid，或合并 expected PID 集合。
- 次要死代码：`parseSegments` 的 `length > 0xffff`（`src/igs.ts:25`）对 16 位长度永远为 false；`parseIcs` 的 `pageCount > 255`（`src/igs.ts:222`）对 `u8` 永远为 false。
- 测试目录在 `packages/igs/test/`，其它包在 `src/`（vitest `include` 因此不同），建议统一。

### `@bdmv2web/media-export` — FFmpeg 导出

- ✅ 字节预算是亮点：编码前估算 + 编码中轮询 + 完成后复核，三层 `assertActualWithinLimit`；`spawn` 带超时 / SIGKILL 升级 / 4MiB 输出上限 / abort 传播；`-n` 防覆盖；编码后 ffprobe 校验 codec、偶数尺寸、宽高比、时长误差 0.25s。
- ⚠️ **轮询开销**：`runWithBudget` 每 10ms 调一次 `directoryBytesExcluding()`（`src/index.ts:420,452`），每次 `readdir` + `stat` 整棵输出树。20 分钟编码 × 100 次/秒 ≈ 12 万次全树遍历，并与 ffmpeg 抢 IO。建议降到 250–500ms，或只 stat 当前写入文件。
- ⚠️ `probeEncodedOutput` 走 `invoke` 而非 `runWithBudget`，probe 阶段不受字节预算监控，语义不一致。
- ⚠️ `durationSeconds()` 与 `inTime45k` 的 45kHz 单位耦合，函数名不体现单位（VM 侧用的是 90k），跨模块易误用。

### `@bdmv2web/package-builder` — 打包

- ✅ `serializeSafeScriptData` 转义 `<` `>` `&` U+2028 防 `</script>` 截断；`makePngBatches` 有单资源/单批/总量三级上限；`convertSounds` 对 BCLK PCM 的属性与范围校验很细。
- ⚠️ **构建期耦合源码路径**：`resolve(import.meta.dirname, "../../runtime-web/src/browser.ts")` + `alias` 指向 `../../hdmv/src/index.ts`（`src/index.ts:127-128`）。在 monorepo 内可跑，一旦按 `dist/` 发布（`src/` 不在包内）或目录调整即失败。建议 runtime-web 预构建 `browser-entry.js`，builder 依赖产物而非 `.ts`。
- ⚠️ 单次 `buildMenuPackage` 内 `Promise.all` 并发写 10+ 文件，音频分支内部再 `mkdir`（第 123 行），有目录创建竞态（`recursive: true` 通常幂等）。
- ⚠️ **`compatibility.json` schema 不一致**：`createCompatibility()`（`src/index.ts:54-63`）缺少 `IMPLEMENTATION_BASELINE §4` 要求的 `toolVersion`；`test-runner` 的 `createCompatibilityReport()` 又缺 `runtimeVersion` / `diagnostics`，且 `validate` 会覆盖构建产物。详见横切问题 7。

### `@bdmv2web/runtime-web` — 浏览器运行时

- ✅ `MenuController` 对 UO mask 位序（`63 - fieldIndex`）、BOG 变体选择、`autoAction` 递归深度上限、指针与键盘路径分离（hover 不触发 autoAction）都处理得比一般实现细；`MenuSoundPlayer` / `MenuLoopPlaybackBridge` 对 `NotAllowedError` 的"可关联重试"很实用。
- ⚠️ **审计盲区（安全相关）**：`src/browser.ts:130` 用 `image.src = \`http://127.0.0.1:${port}/open?token=...\`` 以 `<img>` 发 GET 触发本地桥——GET-with-side-effect 且 token 落在 URL 里。更关键的是 `package-audit.ts:214` 的 URL 正则只匹配 `= "字面量"`，**模板字面量完全不被采集**，离线审计无法把这条 loopback 调用归因，只能靠 `BUNDLE_DYNAMIC_ACCESS` 笼统标 `not-verified`。实测 `validate test-data/output/baja-studio-menu --offline` 输出中没有任何一条指向 `127.0.0.1` 的检查项。
- ⚠️ `MenuController` 构造第 4 参为 `MenuScheduler | Partial<MenuInputConfig>`，靠 `isMenuScheduler()` 运行时判别（`src/index.ts:151-157`）。传错类型不报错，只会静默降级。建议改重载或合并为 `options`。
- ⚠️ `EventScheduler.advance()` 对 `due <= now` 的回调立即执行（第 84-87 行），若回调以 0 延迟重新调度自身会**死循环且无迭代上限**。`runAutomaticAction` 有 32 层保护，scheduler 层没有。
- ⚠️ `dispatchActions()` 已集中处理 action，但 `TITLE_SEARCH` 在 `PreviewPlaybackBridge` 里另有分支，语义重叠。
- ⚠️ **没有菜单循环媒体时初始 VM 不执行**：`browser.ts:164-173` 的 `if (data.vmInitialProgramId !== undefined && data.media && video && audio)` 把初始 `runTurn()` / First Play 绑定在 `data.media` 上。`convert` 在找不到菜单循环媒体时仍会生成包（只记 `M5_MENU_LOOP_UNAVAILABLE`，`apps/cli/src/index.ts:319`），这类包会跳过 MovieObject 初始化，按钮程序读到的 GPR/PSR 与参考不一致。
- ⚠️ **`MenuLoopPlaybackBridge` 没有 `ended` / `error` 监听**（`src/index.ts:496-588`）：启动成功后只在 `play()` Promise 失败时回 `MEDIA_ERROR`。非循环背景（`stillMode !== 2` / `loop=false`）的 `PLAY_PLAYLIST` 永远等不到 `ended`；播放中解码错误也不会回传 VM。
- ⚠️ **菜单音轨选择未写回 PSR1**：构造时读取 PSR1 选择音轨（`src/index.ts:512-513`），但选完没有 `systemWrite(1, psrStreamNumber)`；而 `registers.ts` 的 PSR1 默认是 `0xff`。按钮程序若比较 PSR1 会看到错误值。
- ⚠️ `MenuController.hit()` 只用 `states.selected` 的 bounds（`src/index.ts:292`），而 `igs-adapter` 允许只有 `normal` 的按钮被启用（`igs-adapter.ts:109-118`）；这种按钮会"可聚焦但不可点"。需要统一"可命中几何"的定义。
- 测试：`tamako-headless-navigation.test.ts` 单用例 50s，`runtime-web` 整体 56s，是全部包最慢的，建议拆分或用采样数据集。

### `@bdmv2web/test-runner` — 审计与决策

- ✅ 静态审计覆盖度好：HTML 属性 / `srcset` / inline handler / `<base>` / meta refresh / CSS `url()` / `@import` / data URL 签名（PNG magic、RIFF/WAVE）/ base64 规范性 / 路径多层 decode 防穿越 / `setAttribute` 动态 sink。`not-verified` 降级策略比"假绿"健康得多。
- ⚠️ `codeOnly` 用正则剥注释与字符串（`src/package-audit.ts:194`），对正则字面量、`${}` 嵌套、`a / b` 除法可能误判。目前靠 `not-verified` 兜底可接受，建议注释写明这是启发式而非解析器。
- ⚠️ 上文 P0 坏文件所在包。且它是唯一 `private: true` 却承担发布门禁逻辑的包，同时被 CLI 直接依赖——发布链路依赖了一个测试工具包，位置略尴尬。
- ⚠️ `createReleaseSummary` 接收了 `reportedStatus`，但函数内从未读取（`src/release-summary.ts:19-21`）；`summarizeCheckResult` 的优先级是"有 not-verified 就返回 not-verified"，会掩盖同时存在的 fail（`src/release-summary.ts:135-138`）。

### `apps/cli`

- ✅ 事务式输出（staging + commit/abort）、`failMenuConversion` 写出带诊断的失败包而非静默退出、`safeDiagnosticMessage` 把源码根路径替换为 `<source>` 防信息泄漏、`--format json` 有结构化错误。
- ⚠️ **`convert` 的模式契约不自洽**：仅实现 `menu-only`，但默认 `--mode` 是 `standalone-full`（`src/index.ts:257`），且 `strictDefault()`（第 26 行）在非 `menu-only` 时返回 true，导致不带参数执行 `bdmv2web convert X` **恒定 `exitCode = 2`**，而产物其实是 menu-only。
- ⚠️ `--limits`、`--player-profile` 只出现在 `inputPath()` 的 `takesValue` 列表（第 29 行），**解析后从未使用**；`--title` 生效，`--format` 只影响 `validate`。属"看起来支持、实际不生效"的旗标。
- ⚠️ **`extract` / `inspect` 不把 fatal 诊断变成失败**：`parseBdmv` 在缺少 `index.bdmv` 时写入 `fatal BDMV_REQUIRED_FILE_MISSING`，但 `extract()` 仍提交 staging 并 `exit 0`。实测空 BDMV：

  ```text
  {"status":"partial","output":"/private/tmp/bdmv-empty-out"}
  exit=0
  ```

  包内 `parsed-disc.json` 的 diagnostics 是 `fatal`。这与 `IMPLEMENTATION_BASELINE §3` 的"1 = failed"和 §4 的"关键解析损坏 = failed"冲突。`convert` 只有"没有 scene / 没有 Top Menu playlist"才失败，同样没有统一走 `decideDelivery`。
- ⚠️ **交付 IR 的源位置被伪造**：`createMenuDiscIR()` 把所有 entry 的 `source` 写成 `{ path: "source/structural", origin: "primary", byteOffset: "0" }`，并把诊断的 `sourcePath` / `offset` 置 null（`src/index.ts:194-204`）；`vmPrograms` 又把指令来源路径改成 `<MovieObject>`（`src/index.ts:303`）。这违反 baseline §2"SourceRef 至少含相对 BDMV 根的 path、origin、文件字节偏移"和"反汇编行号不能替代原始指令索引"的可追溯要求。
- ⚠️ **`convert` 的模式标签仍写死**：失败报告和成功输出都固定 `mode: "menu-only"`（`src/index.ts:274,335`），`package-builder` 的 metadata / manifest 也固定 `menu-only`；即使传入 `--mode standalone-full`，产物和 stdout 也不会体现。与 baseline §3 的"统一产物、不再以模式区分"冲突。
- ⚠️ `optionValue("--out")` 在 `--out` 为最后一个参数时返回 `undefined`，`inspect --out` 会静默走 stdout 而非报参数错误。
- `inspect` 用 `writeFile(tmp) → link(tmp, target) → unlink(tmp)`（第 48-50 行），未复用 `beginOutputTransaction`，与其它命令风格不一致。

## 三、横切问题（按修复收益排序）

1. **契约常量有两份**：`DEFAULT_PLAYER_PROFILE`（core / hdmv 各一份）、`maxCallDepth` / `maxQueueDepth`（core 为 128/1024，hdmv 为 64/256）。数值型仿真契约一旦分叉，各包测试会各自为政——这是本仓库最该优先消除的隐患。
2. **性能热点统一是"大输入 + 二次方"**：`buildGraph` O(n²)、`PesAssembler.append` O(n²)、`hex()` 全量字符串比较、`directoryBytesExcluding` 每 10ms 全树轮询、`buildInputFileTable` 重复 `realpath`。真实 UHD 碟会先在这五处顶墙。
3. **构建产物污染**：`dist/` 内含 `*.test.js` / `*.test.d.ts`（未入 Git，但会进 npm 包）。
4. **文档漂移**：`docs/guides/development.md` 仍写"CLI 五个命令目前都返回 `E_NOT_IMPLEMENTED`"，实际 `inspect` / `extract` / `convert` / `validate` 均已实现（仅 `compare` 未实现）。
5. **仓库卫生**：`.gitignore` 缺 `.DS_Store`；`test-data/fixtures/.../00043.m2ts_ig-packets.bin` 11MB、`00005` 8.7MB 直接进 Git 历史（建议 Git LFS 或按 manifest 脚本生成）。
6. **测试聚合链路不稳**：`pnpm -r test` 时 `media-export` / `igs` 报 "no tests"，单独 `cd` 进去却分别正常跑 51 / 54 用例。各包 `test` 脚本不统一（`vitest run` vs `vitest run src`），建议统一并加 `--reporter=verbose`。
8. **失败状态没有贯穿 CLI**：`extract` / `inspect` 对 `fatal` 诊断仍 `exit 0` 并生成包；`convert` 只用"有没有 scene"判失败，没有统一走 `decideDelivery`。这与 baseline §3/§4 的状态表和退出码直接冲突。详见 D10。
9. **静态图与 VM 语义不一致**：`graph.ts` 把 `JUMP_TITLE` / `LINK_*` / `TERMINATE_PL` 当终止流，VM 在 MovieObject 上下文却继续执行；`CALL_TITLE` 没有 continuation，桥的 `MEDIA_UNAVAILABLE` 无法解除等待。详见 D11。
10. **源位置在交付层丢失**：`createMenuDiscIR` 伪造 `source/structural`，`vmPrograms` 使用 `<MovieObject>`，IGS 结构诊断落到 `BDMV/STREAM/.m2ts`。这直接削弱 M6 要求的"可回到源指令/源文件"证据。详见 D12。
11. **文档对同一事实互相矛盾**：`browser-matrix.md` 说 `not-verified`，M6 阶段文档说已验收，M4/M6 tasks 已勾选；`igs-support.md` 说 Tamako 场景 incomplete，测试断言 `complete: true`；M6 的测试计数（42/40/56/51）与当前（parser 47、igs 54、hdmv 74，总 441 passed）不一致；架构文档的包布局和 `DiscIR` 形状仍是旧设计。详见 D8。

## 四、待决策事项

状态：**D1–D13 均有取值**。`决策总览`表是唯一权威；下面各节的详述若与总览表不一致，以总览表为准（历史原因曾出现详节保留旧预填值，已在本版对齐）。

`【预填】` 表示"评审方代填、待你确认"，不代表已拍板。凡标 `⚠需确认` 的是代码里读不出来的信息；实施时已按某个具体假设推进的那些，统一列在两个 change 的 `assumptions.md` 中，每条都写了反选后要改哪个任务——不确认不会阻塞开工，但假设不成立时需要改判。

### 决策总览

| 编号 | 事项 | 预填决策 | 负责人 | 目标节点 |
| --- | --- | --- | --- | --- |
| D1 | P0 修复与 CI 门禁 | A | 待指派：______ | 第 1 批 |
| D2 | 构建/测试配置拆分 | A | 待指派：______ | 第 1 批（随 D1） |
| D3 | 契约常量收敛方向 | A | 待指派：______ | 第 2 批 |
| D4 | CLI `convert` 默认模式 | A：仅需保留`menu-only` | 待指派：______ | 第 1 批 |
| D5 | 性能热点修复范围 | B | 待指派：______ | 第 2 批 |
| D6 | 本地桥与审计规则 | 先不修改 | 待指派：______ | 第 2 批 |
| D7 | package-builder 解耦 | A | 待指派：______ | 第 2 批 |
| D8 | 文档与仓库卫生 | B | 待指派：______ | 第 1 批 |
| D9 | 验收/证据链（指纹、浏览器证据、compatibility） | C | 待指派：______ | 第 2 批 |
| D10 | 失败状态与 CLI 退出码 | A：fatal→failed/1；阶段命令走 `decideStageOutcome`，`convert`/`validate` 走 `decideDelivery` | 待指派：______ | 第 1 批 |
| D11 | 静态图与 VM 语义（JUMP_TITLE/CALL_TITLE/LINK） | A：按参考实现修正 | 待指派：______ | 第 2 批 |
| D12 | 交付层源位置保真 | A：IR/vmPrograms/IGS 全链路保留 | 待指派：______ | 第 2 批 |
| D13 | 浏览器运行时生命周期（初始 VM、媒体桥、PSR1） | A：解耦并补齐事件 | 待指派：______ | 第 2 批 |

批次含义：
- **第 1 批** = 让主干回绿且不引入设计争议（D1、D2、D4、D8、D10）→ `restore-build-gate-and-delivery-status`
- **第 2 批** = 一致性与安全可见性（D3、D5、D6、D7、D9、D11、D12、D13）→ `converge-contracts-and-distribution`

早前草稿里单独的"第 3 批"已取消：D8 的 test 脚本统一随第 1 批做（它决定后续所有计数基线），D7 与 D5 的剩余项需要第 1 批的产物布局作前提，因此整体并入第 2 批。下面各节的目标节点以本表为准。

---

### D1 — P0 修复与 CI 门禁

**现状**：两处破坏已在 `master`。修复本身是机械性的（删重复块、补夹具字段），没有设计争议；争议在于是否顺带把 CI 建起来。

**选项**

- **A**：只修 P0，先让主干变绿，CI 单独立项。
- **B**：P0 修复 + 同时加最小 CI（一条 workflow：`install` → `generate:contracts` → `build` → `typecheck` → `test`）。
- **C**：B 之外再加 pre-commit / pre-push 钩子（本地先拦一层）。

**建议**：A（最终决策）。只修 P0 让主干先绿；CI 建流水线涉及远端与凭据，单独立项更合适。
>
> 决策：A —— 只在第 1 批修 P0 让主干回绿，CI 流水线单独立项。
>
> 落地拆分（避免"CI 单独立项"变成悬空承诺）：
>
> - **本批做**：落一份与平台无关的门禁脚本 `scripts/ci.sh`（`install --frozen-lockfile` → `generate:contracts` → `-r build` → `-r typecheck` → `-r test`），任何人/任何平台都可用同一条命令复现门禁。对应 `restore-build-gate-and-delivery-status` 任务 1.6。
> - **本批不做**：`.github/workflows/` 等任何平台专属配置、pre-commit / pre-push 钩子。
> - **单独立项**：流水线本身（触发条件、缓存、超时、是否联网装依赖）留给后续 change；本批只在 `docs/guides/development.md` 记录"门禁未接入流水线"的已知风险。
>
> ⚠需确认（不影响本批执行）：托管在哪（GitHub / GitLab / 内网自建）、是否允许联网安装依赖（内网通常要离线缓存或私有 registry）。脚本形态与平台无关，故本批可先落地。______

---

### D2 — 构建与测试配置拆分

**现状**：`tsconfig.json` 的 `include` 把测试文件带进了 `build`，`dist/` 里出现 `*.test.js`。拆分会改变所有包的产物清单，属"动一次、影响十处"的配置变更，需要确认发布面。

**选项**

- **A**：每个包加 `tsconfig.build.json`（`exclude **/*.test.ts`），`build` 走它，`typecheck` 仍走全量。
- **B**：不改 tsconfig，只在发布前置（`files` 字段 / `.npmignore`）排除测试产物。
- **C**：暂不处理，仅记录。

**建议**：A。B 会导致"本地 `dist` 与发布包不一致"，反而更难排查。

> 决策：【预填】A —— 每包加 `tsconfig.build.json`（`exclude: ["**/*.test.ts", "**/*.test-d.ts"]`），`build` 走它，`typecheck` 保持全量（含测试），这样"产物编译"和"测试编译"失败可分开归因。
>
> 备注：`package-builder` 里 `resolve(..., "../../runtime-web/src/browser.ts")` 依赖源文件路径，拆 build 配置时**不要**顺手删掉 `src/`（与 D7 联动）。⚠需确认：目前是否已有包发到 registry？若都没有，可一次性改完不必考虑向后兼容。______

---

### D3 — 契约常量收敛方向

**现状**：`core` 与 `hdmv` 各有一份默认播放器配置；调用深度/队列上限两处数值不同（128/1024 vs 64/256）。**必须先确认哪个是真值**，否则改哪边都是猜。

**选项**

- **A**：以 `core` 为准，`hdmv` 直接引用，`hdmv` 的 64/256 视为早期临时代码删除。
- **B**：以 `hdmv` 的 64/256 为准（即 core 的声明是错的），反向修正 core。
- **C**：保留两套，但改名为"默认值"与"运行时安全上限"，并在文档中写明两者关系。

**建议**：需要你先给出结论——libbluray 的 `bd_set_virtual_package` / 调用栈行为对应的实际限制是哪一个？确认后我按 A 或 B 执行。

补充证据（评审时补查）：

- `Limits` 是 `core` 的公开契约类型（`src/index.ts:39-48`），`DEFAULT_LIMITS` 同时导出了 `maxInstructionsPerTurn: 10_000`、`maxQueueDepth: 1024`、`maxCallDepth: 128`，且被 `validateLimits` / `assertWithinLimit` 使用——即"对外承诺的默认值"在 core。
- `hdmv` 的 `DEFAULTS`（`vm.ts:30`）是**私有常量**，只在 `VmOptions` 未传时兜底，没有任何文档或导出把它作为契约。其中 `maxInstructionsPerTurn` 与 core 一致（10_000），说明它是从 core 抄来的，但两个深度值被改小了。
- 由于 `hdmv` 只接受 `VmOptions` 的三个散字段、不接受 `Limits`，CLI 的 `--limits` 才无法穿透到 VM（D4 里"解析后不生效"的根因之一）。
- 无论选 A/B/C，都要同时处理一个实现事实：`maxCallDepth` 当前只做 `if (this.opts.maxCallDepth < 1)`（`vm.ts:409,447`），且 `callStack` 只保存一个上下文，所以它不是真正的深度上限。若保留"单保存上下文"语义，应在文档中改名为开关；若要有深度，必须改调用栈结构。

> 决策：【预填】A —— `core` 为准（128 / 1024），`hdmv` 的 `DEFAULTS` 改为引用 `DEFAULT_LIMITS`；同时给 `VmOptions` 增加可选的 `limits?: Limits`，让 `--limits` 有落地路径。
>
> ⚠需确认：评审无法从代码判断 64/256 是"早期随手写的"还是"按实测调小的"。若你记得当初是为了防某类碟的爆栈而调小，请改选 C（保留 64/256 作为运行时安全上限，核心契约仍是 128/1024，两者在文档中写明关系）。
>
> 依据（参考实现或实测数据）：⚠需确认 —— 若沿用 A，我会补一条测试锁定"默认深度 = `DEFAULT_LIMITS.maxCallDepth`"，避免再次漂移。______
>
> 若选 C，两者的语义定义：运行时安全上限 = 卡死保护（可被碟片真实结构触发），契约默认值 = 对外承诺的常规上限。______

---

### D4 — CLI `convert` 默认模式

**现状**：默认 `--mode` 是 `standalone-full`，但只实现了 `menu-only`，且非 `menu-only` 时 `strictDefault()` 返回 true，导致**裸跑 `convert` 恒定 exit 2**。

**选项**

- **A**：默认值改为 `menu-only`（裸跑即成功，符合当前实际能力）。
- **B**：保留 `standalone-full` 默认，但立即返回 `E_NOT_IMPLEMENTED` 并给出明确提示（显式暴露"未实现"，不误导）。
- **C**：保留默认值并实现 `standalone-full`（工作量最大）。

**建议**：A（若近期不做 standalone 全盘转换）；同时清理 `--limits` / `--player-profile` 这两个解析后不生效的旗标。

> 决策：A —— 默认值改 `menu-only`；`standalone-full` 显式保留为"接受但立即报错"，不再靠 `strictDefault()` 间接变成 exit 2。
>
> 错误码用 CLI 现有的 `CLI_` 前缀风格：`CLI_UNSUPPORTED_MODE`（与 `CLI_USAGE` / `CLI_MISSING_INPUT` 一致），不使用裸的 `E_NOT_IMPLEMENTED`。返回值 `exit 1`，且在创建任何输出目录/事务之前。
>
> `standalone-full` 的路线：⚠需确认 —— 按"长期做、近期不做"处理（先把 menu-only 做成可靠可用）。本批只做拒绝，不实现。
>
> 无效旗标处理：`--player-profile` **本批接线生效**（读取、校验、传入 builder/VM）；`--limits` 依赖 D3 的 `VmOptions.limits`（第 2 批），本批改为"解析成功即报 `CLI_NOT_IMPLEMENTED` 并 `exit 1`"（新增该码，不复用 `CLI_UNSUPPORTED_MODE`——后者语义是"模式不支持"，用在这里会让日志误导），不留静默无效旗标；`--out` 缺值时改为报 `CLI_MISSING_VALUE` 而不是静默写 stdout。

---

### D5 — 性能热点修复范围

**现状**：五处热点（parser graph O(n²)、PES append O(n²)、`hex()` 全量比较、字节预算 10ms 全树轮询、`buildInputFileTable` 重复 `realpath`）。前三处影响正确性边界内的大输入，后两处是常数级浪费。

**选项**

- **A**：全修（五处，一次 PR）。
- **B**：只修有实测数据支撑的（需要先加基准测试）。
- **C**：先只修 `PesAssembler.append` 与 `directoryBytesExcluding`（收益最直接、改动最局部）。

**建议**：B。没有基准的"优化"无法验收；先建可复现基准，再按数据决定修哪几处。
>
> 决策：B —— 基准先行。先建 `scripts/bench/`（五项 case，输出 `test-data/bench/<sha>.json`），记录机器/版本/样本与前后数据；只修被数据判为超线性的项，其余写入"已知未优化"。
>
> 例外（不等数据、本批直接改）：`directoryBytesExcluding` 的 10ms 轮询是常数级浪费（20 分钟编码约 12 万次全树遍历），不依赖测量即可判定，按 `converge` 任务 G.5 直接调整为 400ms。
>
> 是否有真实碟片/大样本可用于基准：⚠需确认 —— `test-data/` 下现有的碟样本是否够作为基准输入；若不够，基准用合成数据（N 个 PlayItem、1MB/8MB PES），不阻塞本批。
>
> 性能目标：只设回归门限——同一 case 相对记录基线退化 > 20% 需说明；不设 CPU 百分比之类依赖稳定测量环境的目标。

---

### D6 — 本地桥与审计规则（安全相关）

**现状**：`browser.ts` 用 `<img src="http://127.0.0.1:PORT/open?token=...">` 触发本地桥，属 GET-with-side-effect 且 token 在 URL 中；同时审计的 URL 正则不采集模板字面量，导致这条调用在离线审计里**不可归因**。

**选项**

- **A**：改本地桥为 `POST` + 显式声明（不再用 `<img>` 触发），审计增加"模板字面量中的绝对 URL"规则。
- **B**：只补审计规则（让现状可见、标 `not-verified`），桥的实现不动。
- **C**：A 的桥改造 + 把 token 从 URL 移到 header（需同步改本地服务端）。

**建议**：先不修改。本轮不动桥实现，也不补审计规则；把"审计无法归因该调用"登记为已知限制。理由：桥的接收端是 **生成代码**（`package-builder/src/local-player-bridge.ts`），改请求方式需要跨包联动且要考虑已分发旧包的兼容；审计规则改动会让离线审计的 `not-verified` 基线发生漂移，与第 2 批其他改动混在一起时难以归因。
>
> 决策：先不修改（本轮不做）。本地桥继续以 `<img src>` 发 GET、token 继续留在 URL；审计继续以 `BUNDLE_DYNAMIC_ACCESS` 记 `not-verified`。
>
> 承接方式：**记录而非实现**——`README` 与 `docs/guides/browser-matrix.md` 的已知限制各写一条（`converge` 任务 I.1）；本批不新增审计规则、不改 `browser.ts`、不改 `local-player-bridge.ts`。
>
> 后续归属：D6-2 独立 change，需先回答下面两个问题。
>
> 本地桥的调用方是否只有 `browser.ts` 一处：**调用方只有一处**（`runtime-web/src/browser.ts:130`，并有 `browser.test.ts:184` 断言该 URL）；**接收端是生成代码**（`package-builder/src/local-player-bridge.ts` 绑定 `127.0.0.1`、处理 `/open`），因此改成 POST 需要同时改"生成的模板"与 `browser.ts`。⚠需确认：`local-player-bridge` 是否需要兼容已经分发出去的旧包（旧包只有 GET 桥）？______
>
> 是否允许破坏性变更（旧包需重新构建）：⚠需确认 —— 若将来做 D6-2，建议新旧桥共存一个版本（同时接受 GET/POST）；若要求严格向后兼容，则 token 从 URL 移到 header 这步永远做不了。______

---

### D7 — package-builder 解耦源码路径

**现状**：builder 在构建期直接读 `../../runtime-web/src/browser.ts` 并把 `hdmv` alias 到 `.ts` 源码。monorepo 内可跑，按 `dist/` 发布即断。

**选项**

- **A**：runtime-web 增加 `build:browser` 产物，builder 依赖产物。
- **B**：把 builder 限制为"仅在 monorepo 内使用"，显式声明不支持独立安装（改 `private: true` + 文档）。
- **C**：暂不处理，仅记录风险。

**建议**：取决于这个包是否要对外发布——**这一点需要你确认**。

> 决策：【预填】A —— runtime-web 增加 `build:browser` 预构建产物，builder 依赖产物而非 `.ts` 源码。
>
> `@bdmv2web/package-builder` 是否对外发布：**实质上必然发布**。依据：`apps/cli` 声明了 `bin: bdmv2web` 且依赖 `@bdmv2web/package-builder`，CLI 若可安装，builder 就会被一并装上；builder 自身无 `private: true`、`main` 指向 `./dist/index.js`，也没有 `files` 白名单（等于会带上全部文件）。所以 B 不成立，C 是把已知故障留给安装用户。⚠需确认：CLI 是否有"对外安装"的实际计划（还是只在本仓库 devDependencies 里跑）？若确定永不对外安装，B 反而最省事。______
>
> 若发布，目标使用场景：预填假设为"CLI 内部依赖，不承诺第三方直接调用 builder API"——因此 D7 只要求 `buildMenuPackage` 在 `dist/` 布局下能跑，不需要稳定的公开 API。若要做第三方集成，需要额外定 API 兼容策略。______

---

### D8 — 文档与仓库卫生

**现状**：`development.md` 的 CLI 状态描述已过期；`.gitignore` 缺 `.DS_Store`；两个大二进制（11MB / 8.7MB）在 Git 历史中；各包 `test` 脚本不统一导致聚合跑漏用例。

**选项**

- **A**：全部处理，大二进制迁 Git LFS（需改写历史或仅对新文件生效）。
- **B**：只改文档 + `.gitignore` + 统一 `test` 脚本；大二进制保留现状（仅后续文件走 LFS）。
- **C**：只改文档。

**建议**：B。重写 Git 历史成本高且影响所有协作者，收益主要是克隆体积；先把"会误导人"和"会漏跑测试"的部分解决。

> 决策：【预填】B —— 改 `docs/guides/development.md` 的 CLI 状态表（标注 `compare` 未实现、`convert` 仅 menu-only）、补 `.gitignore` 的 `.DS_Store`、统一各包 `test` 脚本为 `vitest run`；同时按上方"第二轮补充"修正浏览器验收事实、Tamako 场景结论、M6 计数与架构文档的旧布局。大二进制**不动**。
>
> 大二进制处理方式：保留现状。理由：两个文件已在历史中，重写历史会打断所有协作者的本地 clone，而收益只是克隆体积；若将来新增 >1MB 的 fixture，改为按 manifest 脚本生成而非入库。⚠需确认：这两个 fixture 是否被测试直接读取（若只是"生成后比对用的样本"，可以改成脚本生成并从此不入库）。______
>
> 是否接受统一 `test` 脚本后部分包耗时上升：接受。当前"聚合跑漏用例"比多花几十秒严重得多；`runtime-web` 的 50s 单条导航回归会另开一项拆分（不在 D8 内）。______

**第二轮补充（D8 范围内一并处理）**：

- `docs/support/igs-support.md:22` 说 Tamako 场景 incomplete、0xfffe 语义未建立，但 `packages/igs/test/tamako-real-smoke.test.ts:29-40` 断言 `complete: true` 且 0xfffe 是 activated 哨兵；包 partial 的真实原因是 Clip 00043 缺失。需要改掉这段原因。
- `docs/references/stages/M6-release-verification.md:22-26` 的测试计数（42/40/56/51）已过期。当前实测：parser 47、igs 54、hdmv 74、runtime-web 91、test-runner **5 个文件 / 41 用例**（修复 P0 前为 2 failed + 8 passed / 42，因 `dist/*.test.js` 被重复执行）。修复 P0 后按 `pnpm test:all` 统一重算。
- `bdmv_hdmv_offline_web_architecture.md:145-168` 的包布局（`m2ts-demux` / `igs-decoder` / `navigation-hdmv` / `ir-builder` / `apps/studio`）和 `:530-538` 的 `DiscIR`（`kind`/`role`）仍是旧设计，应标注为历史设计或补"设计名 → 实际包/字段"映射。

D9 的历史方案已由 `converge-contracts-and-distribution` 收敛；当前实现边界见实施基线和离线审计规范。


---

### D10 — 失败状态与 CLI 退出码

**现状**：空 BDMV 会记录 `fatal BDMV_REQUIRED_FILE_MISSING`，但 `extract` 仍提交 staging、输出 `{"status":"partial"}` 并 `exit 0`（实测）。`convert` 只在没有 scene / 没有 Top Menu playlist 时失败，未统一使用 `decideDelivery`。这与 `IMPLEMENTATION_BASELINE §3` 的退出码和 §4 的状态表冲突。

**选项**

- **A**：`inspect`/`extract`/`convert` 统一走 `decideDelivery`；fatal 或关键 required file 错误不 commit，返回 `failed`/1。
- **B**：只修 `extract`；`inspect` 仍输出诊断并返回 0（把它定义为纯查看命令）。
- **C**：不改退出码，只在文档中写明"partial 包可能包含 fatal 诊断"。

**决策修正（与实现对齐）**：`inspect` / `extract` 是**阶段命令**，其输入契约（诊断列表）与 `decideDelivery` 的交付契约（checks / 证据 / 模式）不同，硬塞进去会让 strict 下所有阶段命令都退 2。因此拆成两个入口、共用一个诊断分类函数：

- `classifyDiagnostics(diagnostics)`：severity 归约只有一份。
- `decideStageOutcome({ stage, diagnostics, strict })` → `StageStatus = "complete" | "partial" | "failed"`，服务 `inspect` / `extract`。
- `decideDelivery(...)` 保留交付语义，只有 `convert` / `validate` 调用。

> 决策：A（按上述拆分落地）—— 在 CLI 入口把 `disc.diagnostics` / `extraction.diagnostics` 汇总为 decision facts；fatal 一律 `failed` / `exit 1` 且不 commit；未认可 `error` 在 strict 下 `partial` / `exit 2`，非 strict 下 `exit 0`。`inspect` 默认也返回 1，并提供 `--allow-partial` 显式覆盖（输出中仍保留 `stageStatus: "failed"`，只看视图不改事实）。
>
> ⚠需确认：`inspect` 默认返回 1 会打断现有"只看诊断"的脚本。若你更希望保留 `exit 0`，正确做法是新增 `--strict` 语义并写入 README，而不是维持"fatal 也 0"的默认。本批按"默认 1 + `--allow-partial`"实现，改动点集中在 CLI 入口一处。

---

### D11 — 静态图与 VM 语义（JUMP_TITLE / CALL_TITLE / LINK / TERMINATE）

**现状**：`graph.ts:63` 把 `JUMP_TITLE`、`LINK_PI`、`LINK_MK`、`TERMINATE_PL` 当终止流；VM 在 MovieObject 上下文实际继续执行（`vm.ts:427-436`、`463-470`）。最小 JUMP_TITLE 程序实测只有 `jump` 边，没有后继 `sequence` 边。`CALL_TITLE` 只设置 `pendingTitleCall` 并 suspended，不建立 continuation（`vm.ts:437-458`），`PreviewPlaybackBridge` 的 `MEDIA_UNAVAILABLE` 会被 `handleEvent` 丢弃。

**选项**

- **A**：按 pinned libbluray 修正图/VM：JUMP_TITLE 补 sequence 边，LINK/TERMINATE 按 context 处理，CALL_TITLE 建立可关联的等待/响应契约。
- **B**：只修 graph.ts；VM 与桥的契约保持不变并文档说明。
- **C**：不改行为，只在报告中把相关边标 unresolved。

**建议**：A。媒体闭包和覆盖统计直接依赖这些边；只改文档会把"不可达"当成事实。

> 决策：【预填】A —— 修改 `terminatesFlow` 与 `buildNavigationGraph` 的 JUMP_TITLE 边；`CALL_TITLE` 增加 continuation 或专用 `selectTitle` 回执，桥只对 `waitFor` 动作回复。同步补测试：JUMP_TITLE 后继可达、LINK/TERMINATE 在 MovieObject 不终止、CALL_TITLE 的 MEDIA_UNAVAILABLE 能解除等待。
>
> ⚠需确认：`CALL_TITLE` 的响应是否应走 `TITLE_SEARCH` action 的 `responseTo`（需要新增 action 语义），还是保持当前"运行时直接调用 `selectTitle()`"并让桥不回复？两种都能修，但会影响 `PreviewPlaybackBridge`/`MenuLoopPlaybackBridge` 的接口。______

---

### D12 — 交付层源位置保真

**现状**：`createMenuDiscIR()` 把 entry 的 `source` 固定为 `source/structural`/offset 0，并把诊断的 `sourcePath`/`offset` 置 null（`apps/cli/src/index.ts:194-204`）；`vmPrograms` 把指令路径改为 `<MovieObject>`（`apps/cli/src/index.ts:303`）；`toIgsSource()` 丢失 path/clipId/pid，实际输出 `BDMV/STREAM/.m2ts`（`packages/igs/src/extract.ts:178`，Tamako 实测）。

**选项**

- **A**：全链路保留 `SourceLocation`：IR entry 使用原始 entry source，vmPrograms 使用原始指令 source，IGS 结构诊断单独保留 path/pid/origin。
- **B**：只修 IR entry；trace 与 IGS source-map 继续使用占位值并文档说明。
- **C**：不改，降低 M6 对"可回溯源位置"的要求。

**建议**：A。当前占位值会让"首分歧可定位"和"诊断可回到源文件"两条验收失效。

> 决策：【预填】A —— `createMenuDiscIR` 改为复制 `entry.source`/诊断原始位置；`vmPrograms` 保留 `source.path`；`toIgsSource` 保留原始 path/pid/origin（或让 IGS 诊断直接携带 `SourceLocation`）。
>
> ⚠需确认：IR 中 `SourceRef.path` 的约定是相对 BDMV 根（`PLAYLIST/...`）还是带 `BDMV/` 前缀（`BDMV/PLAYLIST/...`）？当前 parser/CLI 两种写法混用，必须在 D12 中锁定一种。______

---

### D13 — 浏览器运行时生命周期（初始 VM、媒体桥、PSR1）

**现状**：`browser.ts:164-173` 只有在 `data.media && video && audio` 时才执行初始 `runTurn()`/First Play；没有菜单循环媒体的包会跳过 MovieObject 初始化。`MenuLoopPlaybackBridge` 启动成功后没有 `ended`/`error` 监听（`runtime-web/src/index.ts:496-588`），非循环背景的 `PLAY_PLAYLIST` 永远等不到结束。音轨选择没有写回 PSR1（`src/index.ts:512-513`，而默认是 `0xff`）。

**选项**

- **A**：解耦初始 VM 与媒体；媒体桥补 `ended`/`error`/`abort` 的关联回执；首次选轨写回 PSR1。
- **B**：只修初始 VM，媒体桥与 PSR1 留到后续。
- **C**：只在 README 说明"无媒体包不执行 MovieObject / 非循环背景不支持"，不改实现。

**建议**：A。初始 VM 是菜单正确性的前提；媒体桥生命周期是 M4/M5 的既有等待契约，不能靠文档绕过。

> 决策：【预填】A —— 初始 `runTurn`/First Play 不再依赖 `data.media`；`MenuLoopPlaybackBridge` 监听并回传 `ended`/`error`/`abort`；`confirmedPrimaryAudioStream` 与 PSR1 同步。
>
> ⚠需确认：`loop=false` 的背景在单 PlayItem 结束后应回 `MEDIA_ENDED` 还是保持 final frame 并只解除 VM 等待？若产品语义是"背景停留最后一帧"，需要新增一个明确的 `MEDIA_HELD`/策略，而不是让 VM 永久 suspended。______

---

### 自由补充区

预填的执行顺序（按批次，每批结束应保证 `build` / `typecheck` / `test` 全绿）：

| 批次 | 内容 | 依赖关系 |
| --- | --- | --- |
| 第 1 批 | D1（P0，不含 CI 流水线）、D2（tsconfig 拆分）、D4（`convert` 默认值 + 旗标清理）、D8（文档 + `.gitignore` + `test` 脚本统一）、D10（阶段/交付状态与退出码） | D2 与 D1 同一 PR 更省事；D8 的 `test` 脚本统一必须早于任何用例计数基线；D10 依赖 D1 的测试可跑 |
| 第 2 批 | D3（常量收敛 + `VmOptions.limits`）、D4 的 `--limits` 真正接线（A.6）、D5（基准 + 按数据修复）、D6（明确不做，仅记录）、D7（builder 解耦）、D9（证据链做减法）、D11（图/VM 语义）、D12（源位置）、D13（运行时生命周期） | D7 依赖 D2 完成后的产物布局；D9 与 D10 共享状态枚举；D11 影响 D12 的 source-map；D13 的媒体指纹条目已随 D9=C 删除 |

> "第 3 批"已取消：D8 的 `test` 脚本统一提前到第 1 批（它决定后续所有计数基线），D7 与 D5 剩余项并入第 2 批。
>
> 不属于 D1–D13、但评审中确认存在的问题（CLPI HEVC 属性长度、`sound.bdmv` 损坏中止 `inspect`、`EventScheduler` 零延迟自旋、`summarizeCheckResult` 误分类、`validateLimits` 未知键静默失效）登记在 [`openspec/changes/REVIEW_BACKLOG.md`](../../openspec/changes/REVIEW_BACKLOG.md)，每条附触发条件，本轮不展开。

> 其它需要纳入本轮的问题、约束或优先级调整：
>
> 1. ⚠需确认：本轮是否有对外交付时间点（决定第 1 批是否能独占一个 PR）。______
> 2. ⚠需确认：`numericSelectValue` 的语义。本批已按「每个夹具显式声明」推进（`igs-adapter.test.ts` 填 `11`，与协议字段一致，见第 1 批任务 1.2），理由是该字段由 `igs.ts:240` 实际解析，可选化会掩盖解析缺失。若你要的是「类型上给默认值」，改动点是 `IgsButton` 类型定义 + `igs-adapter`，需同步放宽一条测试。
> 3. 其余：______

## 五、复现命令

```sh
# 环境（Node 24.18.0 / pnpm 11.25.0）
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"

corepack pnpm install --frozen-lockfile
corepack pnpm generate:contracts
corepack pnpm -r build        # 当前：2 failed
corepack pnpm -r typecheck    # 当前：failed（test-runner；-r 会先停在第一个失败）
corepack pnpm -r --no-bail typecheck
corepack pnpm -r --no-bail test

# 单包测试（聚合跑会漏用例，需单独确认）
corepack pnpm --filter @bdmv2web/core test            # 14 用例
corepack pnpm --filter @bdmv2web/bdmv-parser test     # 47 用例
corepack pnpm --filter @bdmv2web/hdmv test            # 74 用例（vitest run src）
corepack pnpm --filter @bdmv2web/media-export test    # 51 用例 + 1 skipped
corepack pnpm --filter @bdmv2web/igs test             # 54 用例
corepack pnpm --filter @bdmv2web/runtime-web test     # 91 用例

# 端到端：离线校验示例包
node apps/cli/dist/index.js validate test-data/output/baja-studio-menu --offline

# 第二轮补充复现：空 BDMV 当前仍 exit 0 并生成 partial 包
mkdir -p /tmp/bdmv-empty/BDMV
node apps/cli/dist/index.js extract /tmp/bdmv-empty/BDMV --out /tmp/bdmv-empty-out; echo "exit=$?"
cat /tmp/bdmv-empty-out/parsed-disc.json | grep -o '"severity": "fatal"'

# Tamako source-map 的结构性诊断路径（当前为 BDMV/STREAM/.m2ts）
node apps/cli/dist/index.js extract test-data/bdmv/tamako-love-story-bd/BDMV --out /tmp/tamako-extract
python3 - <<'PY'
import json
for item in json.load(open('/tmp/tamako-extract/source-map.json'))['diagnostics']:
    print(item['source'])
PY
```

> 注 1：`validate --offline` 的输出中查不到 `127.0.0.1` 相关检查项，即 D6 所述审计盲区的实测证据。
>
> 注 2：`JUMP_TITLE` 图边可用 `buildNavigationGraph` 最小程序复现，当前只会得到 `jump` 边，没有后继 `sequence` 边；`CALL_TITLE` 的 `MEDIA_UNAVAILABLE` 被丢弃可在 `runtime-web` 的 bridge 测试输出中看到 `diag=HDMV_IGNORED_EVENT`。
>
> 注 3：`cd packages/hdmv && ../../node_modules/.bin/vitest run`（不带 `src`）会额外执行 `dist/*.test.js` 并因 `dist/fixtures/libbluray-1.5.0-source-derived-reference-golden.json` 缺失而失败；包脚本 `vitest run src` 不会。参考 D1/D2 的测试入口统一。
