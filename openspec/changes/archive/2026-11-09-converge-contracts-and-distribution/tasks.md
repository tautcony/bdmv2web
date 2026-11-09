# Tasks

对应决策：D3（契约常量）、D5（性能基准先行）、D7（builder 解耦）、D9=C（证据链减承诺）、D11（图/VM 语义）、D12（源位置保真）、D13（运行时生命周期）。D6 明确不做，见 §I。

前置：第 1 批 [`restore-build-gate-and-delivery-status`](../restore-build-gate-and-delivery-status/tasks.md) 完成——本 change 的验收依赖 `build` / `typecheck` / `test:all` 可跑，且 `dist` 不再含测试产物。共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。决策与证据来源见 [`docs/archive/reviews/review-2026-11-04/index.md`](../../../docs/archive/reviews/review-2026-11-04/index.md)。

## 当前实现复核（2026-11-09）

内容摘要字段与计算已删除。无菜单媒体启动、媒体结束回执、音轨 PSR1 写回、按钮命中几何、来源位置、上下文导航图和 `convert --limits` 均有对应回归。D.3 已由 CLI E2E 检查实际 `igs/diagnostics.json` 与 `igs/source-map.json`。F.1–F.2 已通过隔离部署构建菜单包。G 基准覆盖四个真实 BDMV 解析、七个真实 IGS 输入的 MNU/PNG 导出、synthetic-all-features 端到端导出、Tamako 完整 CLI 转换及 libbluray CLI 计时；当前环境缺少 `png` 与 `igstools` Python 模块，未取得 igstools 直接计时。Tamako `PLAYLIST/00003.mpls` 声明 999 个相同媒体区间的 PlayItem；导出按区间、PID 和编码设置共享一套文件，默认转换 17.0 秒，包中有 3 个媒体文件和 998 个额外 PlayItem 映射。H.2 与 H.3 已完成。

## A. 契约常量收敛（D3）

- [x] A.1 `packages/hdmv/src/vm.ts:30` 的 `DEFAULTS` 改为从 `@bdmv2web/core` 的 `DEFAULT_LIMITS` 派生（三个字段逐项引用，不写字面量）。验收：`grep -rn "maxCallDepth: 64\|maxQueueDepth: 256" packages apps` 无命中；`grep -n "DEFAULT_LIMITS" packages/hdmv/src/vm.ts` 有命中。
- [x] A.2 删除 `packages/hdmv/src/vm.ts:31-35` 的 `DEFAULT_PLAYER_PROFILE` 复制品，改为引用 `@bdmv2web/core` 的同名导出。验收：默认对象定义只存在于 `packages/core/src/defaults.ts`，消费方通过 core 导出引用。
- [x] A.3 `VmOptions` 增加 `limits?: Limits`；内部 `this.limits = validateLimits(options.limits ?? DEFAULT_LIMITS)`；散字段与 `limits` 同时出现时以 `limits` 为准并记一条 `VM_LIMITS_OVERRIDDEN` 诊断。验收：单测覆盖"仅散字段""仅 limits""两者并存"三种构造，第三种产出该诊断且取 limits 值。
- [x] A.4 补漂移锁：单测断言 `new HdmvVm([])` 的 `maxCallDepth` / `maxQueueDepth` / `maxInstructionsPerTurn` 等于 `DEFAULT_LIMITS` 对应字段。验收：故意把 `DEFAULTS` 改成字面量 64，该测试失败（验证后还原）。
- [x] A.5 `maxCallDepth` 语义如实标注：在 `IMPLEMENTATION_BASELINE.md` §5 与 `docs/support/hdmv-support.md` 写明"当前为 CALL 开关（0 禁用），非深度上限；真正的多帧栈限制列为后续 change"，并补单测锁定 `maxCallDepth: 0` → `CALL_OBJECT` 报 `VM_CALL_DEPTH_LIMIT`。验收：两处文档有该表述；测试存在且通过。
- [x] A.6 `--limits` 接线：`apps/cli` 的 `convert` 读取文件 → `validateLimits` → 传入 `VmOptions.limits`；删除第 1 批中临时加的 `CLI_NOT_IMPLEMENTED` 分支。验收：`convert <样本> --limits <合法 json>` 成功且 VM 使用该值（可通过 trace 中的 limit 字段观察）；非法值 → `exit 1` 且错误码为 `INVALID_LIMIT`；`grep -n "CLI_NOT_IMPLEMENTED" apps/cli/src/index.ts` 无命中。

## B. 证据链减承诺（D9=C）

- [x] B.0 更新实施基线：包清单不声明文件内容完整性；必需资产缺失仍为 failed。
- [x] B.1 移除产品侧内容摘要字段和计算。DiscIR 资产、包 manifest 及审计报告均不记录文件内容摘要；manifest 保留路径和长度。
- [x] B.2 检查仓库样本产物；当前 test-data 中没有需要重新生成的交付包。
- [x] B.3 删除旧内容摘要逻辑对应的专属测试和夹具，保留常规资源审计与文件长度行为测试。
- [x] B.5 在发布验证文档中记录 compatibility 构建与审计仍缺的工具版本及诊断字段。
- [x] B.6 实施基线与离线审计规范已更新；M6 中内容完整性相关任务未勾选。
## C. 图与 VM 语义（D11）

- [x] C.1 `packages/hdmv/src/graph.ts:63` 的 `terminatesFlow` 改为按上下文判定：签名 `(opcode, context: "object" | "playlist")`；MovieObject 上下文中 `LINK_PI` / `LINK_MK` 不终止，`JUMP_TITLE` 结束当前 run 且不生成到下一条指令的 `sequence` 边，`TERMINATE_PL` 仅在 playlist 上下文终止。验收：单测覆盖两种上下文 × 四个 opcode 共 8 组判定。
- [x] C.2 为 `NavigationGraphEdge` 增加 `origin` 字段（类型与 schema 同步，读取方忽略未知值），再由 `buildNavigationGraph` 为 `JUMP_TITLE` 生成指向目标 entry 首个 program 的 `sequence` 边，标 `origin: "jump-title"`，与静态 `jump` 边并存。验收：最小 `JUMP_TITLE` 程序的图同时含 `jump` 与 `sequence` 两类边；目标 entry 在可达集合中；原位置下一条指令不因该跳转成为可达。
- [x] C.3 核对当前 `CALL_TITLE` 恢复路径：VM 暂停并发出 `TITLE_SEARCH`，runtime 调用 `selectTitle()`。验收覆盖有效 HDMV 目标、不可用目标及 BD-J/无效目标；VM 不永久 suspended，trace 保留结果与来源。不新增与现行直接选择路径重复的 `responseTo` 桥接机制。2026-11-06 审计修复：`selectTitle()` 失败释放标题切换，BD-J/缺表使用 `unsupportedOperation`；回归在 `packages/hdmv/src/index.test.ts`。
- [x] C.4 桥端只对 `waitFor` 匹配的动作回复：`runtime-web` 的 `PreviewPlaybackBridge` 与 `MenuLoopPlaybackBridge` 增加"是否有匹配等待"的检查，不再把任意事件交给 `handleEvent` 试。验收：无等待时收到事件不产生副作用（trace 记录 discarded 原因）。
- [x] C.5 被上下文忽略的指令留诊断：`vm.ts:460-470` 的静默 `return` 改为记 `HDMV_OPCODE_CONTEXT_SKIPPED`（info 级，含 opcode 与 context）。验收：在 IG 上下文放入 `PLAY_PL` 或 MovieObject 上下文放入 `LINK_PI`，trace 出现该诊断且 VM 继续执行；`docs/support/hdmv-support.md` 已补充该码说明。回归在 `packages/hdmv/src/index.test.ts`。
- [x] C.6 回归：现有 74 个 hdmv 用例全部通过；新增用例不少于 6 条（C.1 两组上下文、C.2 可达性、C.3 两条、C.5）。验收：`corepack pnpm --filter @bdmv2web/hdmv test` 计数 ≥ 80 且无跳过。2026-11-06：88 项通过；新增 JUMP_TITLE 单动作、标题切换释放、IG CALL_OBJECT、PSR5–8、播放等待期间 POPUP/TOP/按钮、CALL_OBJECT 缺目标继续等回归。
- [x] C.7 对 `.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c` 的每个已解码 opcode 建立实现状态表；逐项确认上下文、PC、寄存器、事件/等待和诊断。修复与参考行为不符的可实现语义；参考本身未实现的操作保持显式状态。验收：表覆盖 `decode.ts` 的全部 opcode；每项有直接回归；不把 `ig_object` 规则绑定到单张碟片。

## D. 源位置保真（D12）

- [x] D.1 `apps/cli/src/commands/build.ts` 的 DiscIR entry 来源从原始 `ParsedDisc` 的 `entry.source` 生成，保留 `path` / `origin` / `byteOffset`；不再写 `source/structural` 与 `byteOffset: "0"`。`DiscIR` 中 required 的 `SourceRef` 不得为 `null`；无实际位置的 Diagnostic 允许 `sourcePath` / `offset` 为 `null` 并保留 `stage`。验收：`grep -rn "source/structural" apps packages` 无命中；对 Tamako 样本执行 `extract` 与 `convert` 后，entry 来源为 `index.bdmv`（含 `BACKUP/index.bdmv` 与 `origin: "backup"`），Playlist/CLIPINF 来源出现在对应子对象中，Schema 校验通过。
- [x] D.2 `apps/cli/src/commands/build.ts` 的 `vmPrograms` 保留原始指令 `source.path` / `offset` / `instructionIndex`，不再写 `<MovieObject>`；必要时扩充中间类型，不在 CLI 二次推导字节偏移。验收：`grep -rn "<MovieObject>" apps packages` 无命中；trace 与 source-map 中任一指令能回到源文件与字节偏移，`byteOffset` 为有效十进制字符串。
- [x] D.3 `packages/igs/src/extract.ts` 的 `toIgsSource` 由调用方传入真实 `path` / `clipId` / `pid` / `origin`；位置未知时使用显式可空字段与准确诊断阶段，不生成 `STREAM/.m2ts` 或 `pid: 0` 占位。验收：`source-map.json` 的 `diagnostics[].source` 对已知结构位置含 `clipId` 与 `pid`，对未知位置为空并带阶段。
- [x] D.4 路径约定锁定为"相对 BDMV 根"（`PLAYLIST/00001.mpls`，不带 `BDMV/` 前缀）；`parseDiscIR` 对旧占位值（`source/structural`、`<MovieObject>`）报 `SCHEMA_SOURCE_PLACEHOLDER` 并拒绝。验收：单测用旧 IR 断言拒绝；新 IR 通过；`grep` 确认 parser 与 CLI 只用一种写法。
- [x] D.5 `docs/support/protocol-support.md` / `docs/support/hdmv-support.md` 的 Sources 章节补充"路径相对 BDMV 根"的约定与示例。验收：两份文档含该约定且示例路径符合格式。

## E. 运行时生命周期（D13）

- [x] E.1 `packages/runtime-web/src/browser.ts` 的初始 `runTurn()` / First Play 与媒体存在性解耦：无条件执行初始 turns，媒体播放作为其产生的 action 处理。验收：构造无 `media` 与 `menuMedia` 字段的包，打开后 VM 有初始动作（trace 非空、`status` 进入预期状态），按钮可导航。
- [x] E.2 回归已实现的菜单媒体 `ended`/`error`/`abort` 回执：按 action/responseTo 关联，非循环背景结束发 `MEDIA_ENDED`，错误解除等待并保留诊断。回归证据确认后勾选。
- [x] E.3 回归已实现的音轨 PSR1 写回：成功选择和失败回滚均经 `systemWrite(1, streamNumber)` 更新系统寄存器；验证按钮程序读取所选值。回归证据确认后勾选。
- [x] E.4 命中几何统一：`MenuController.hit()` 按可用性决定命中集（可用即 `selected ?? normal` 的 bounds）。验收：只有 `normal` 视觉的启用按钮可被点击命中；单测覆盖"仅 normal""selected 与 normal 不同几何"两种情况。
## F. 发布布局可构建（D7）

- [x] F.1–F.2 验收现有发布布局：`runtime-web` 构建产出 `dist/browser.bundle.js` 并导出 `./browser-bundle`；`package-builder` 通过该导出消费 bundle。以隔离安装的最小菜单包构建验证两个包可在不安装 workspace `src/` 的情况下运行；确认 bundle 是可直接加载的 classic script，不依赖未注入的 Node 内建模块。隔离安装验收记录行为证据。2026-11-09：`pnpm deploy --prod --legacy` 隔离部署只含发布 dist；部署中的 `buildMenuPackage` 生成菜单包且无诊断；bundle 符合 classic IIFE，未发现 Node builtin specifier 或 `require()`。
- [x] F.4 补齐 `@bdmv2web/package-builder` 的 `files: ["dist"]`；`@bdmv2web/runtime-web` 已有该白名单，本项只复核。验收：两包 `npm pack --dry-run` 清单不含 `src/`、不含 `*.test.*`。2026-11-09：两份清单只含 `dist/**` 与 package.json，无 src 或测试文件；package-builder 把模板复制到 `dist/templates/` 后发布。

## G. 性能基准与修复（D5=B）

- [x] G.1 建立基准入口 `scripts/bench/`（Node 脚本，不引入新依赖）：覆盖合成 case、四个真实 BDMV parse、七个真实碟片 IGS 抽取/输出、synthetic-all-features 端到端抽取，以及可用时的 libbluray CLI 命令；输出 `{ case, n, ms, rss }` 到 `test-data/bench/<git-sha>.json`，该路径加入 `.gitignore`。验收：`corepack pnpm exec node scripts/bench/index.mjs` 跑完可用 case 并写出文件。2026-11-09：生成 93 条样本到 `test-data/bench/274dbb2.json`。
- [x] G.2 记录基线到 `openspec/changes/converge-contracts-and-distribution/benchmark.md`：机器型号、Node/pnpm 版本、样本来源与字节数、工具可用性、每项测量结果及三次重复测量范围。验收：记录足以在相同环境重跑并解释参考工具与项目 case 的测量范围。
- [x] G.3 按数据分类：`PesAssembler.append` 修复前呈超线性，主备 `choose()` 存在显著常数浪费，输入文件表重复解析 root；真实 parser 与 IGS 输出列为实测基线，并写入 `benchmark.md`。libbluray 命令各自列出，不与完整 `parseBdmv` case 作直接比较。
- [x] G.4 只修被数据判为超线性或占比显著的项，并记录修复前后测量结果。候选项为 `PesAssembler.append`、`buildGraph`、`choose()`；不要求采用指定实现或固定倍数阈值。验收：数据支持修复有效，相关用例通过。历史修复测量：`PesAssembler.append` 几何扩容后 50000 包中位耗时为 4.915 ms；`choose()` 逐字节比较后 8 MiB 中位耗时为 8.022 ms，修复前为 1077.561 ms。当前全量重跑分别为 4.271 ms 和 8.244 ms。
- [x] G.5 菜单和线性媒体导出在开始与结束时各统计一次输出目录大小并报告实测值；导出期间保持单个资产 `maxAssetBytes` 检查。验收：菜单与线性导出测试覆盖开始、结束大小；编码仍按 `maxAssetBytes` 检查单个资产。2026-11-09：成功编码的起止目录大小测试正常运行；media-export 74 passed / 1 skipped；package-builder 10 passed；CLI build and menu-media encoding tests 9 passed。
- [x] G.6 `buildInputFileTable` 的 root 只解析一次后透传（重复 `realpath`）。验收：1000 文件输入的 `canonicalDirectory` 调用次数从 1000 降到 1（用计数器断言）。2026-11-09：root realpath 计数器断言为 1；当前基准中位耗时从重复 root 解析的 54.882 ms 降到 28.046 ms。
- [x] G.7 未优化的基准项写入 `benchmark.md`，记录测量结论和触发条件：5000 项 `buildGraph` 中位耗时超过 100 ms 时重新评估；真实 parser 样本出现稳定热点时重新评估；IGS PNG 渲染出现可复现的算法热点时重新评估。
- [x] G.8 等价菜单 PlayItem 共用编码产物：按输入路径、Playlist、时间区间、循环模式、视频 PID、音轨映射和编码设置分组；每组只编码和存储一套媒体文件，每个 PlayItem 保留独立运行时映射。验收：999 个相同区间加 1 个不同区间只编码两套媒体；manifest 只列实际文件，所有相同 PlayItem 映射到同一路径。2026-11-09：包构建测试断言 2 个视频与 4 个音频编码、6 条唯一媒体文件路径和 1000 个映射；Tamako 默认 CLI 转换 17.0 秒，999 个映射共用 3 个媒体文件。

## H. 整体验收

- [x] H.1 一致性 grep 三连（同 `design.md` Exit Criteria 1）：
  1. 无重复常量：`grep -rn "maxCallDepth: 64\|maxQueueDepth: 256" packages apps` 无命中。
  2. 无占位源位置：`grep -rn "source/structural\|<MovieObject>" packages apps` 无命中。
  3. `内容摘要字段` 口径：`grep -rn "内容摘要字段" packages apps --include=*.ts` **无命中**；`docs` / `openspec` 中不出现"已校验/可检测篡改"的表述。
  
  验收：三条搜索均无命中。2026-11-09：三条搜索无命中。
- [x] H.2 全量验证：`corepack pnpm build && corepack pnpm typecheck && corepack pnpm test:all` 全绿；该结果同时覆盖 E.6 的 runtime-web 与 headless 导航回归。2026-11-09：复跑 build 与 typecheck 成功；test:all 的 11 个 workspace 包均通过，media-export 为 74 passed / 1 skipped。
- [x] H.3 端到端两条链路不退化：`extract` → `convert` → `validate --offline` 在 `test-data` 样本上结果与第 1 批一致（除内容摘要字段移除与源位置字段变真实）；该结果同时覆盖 F.5。2026-11-09：Tamako `extract --type hdmv` 返回 partial；默认 HEVC `convert` 返回 partial，17.0 秒生成 13 文件包；`validate --offline` 退出码 0、manifest status partial、无重复路径检查错误。999 个 PlayItem 映射共用 3 个媒体文件。
- [x] H.4 文档与范围核对：README 说明未实现字节级完整性校验、外部系统播放器状态不回传、`loop=false` 不提供独立末帧状态；M6 未验证项保持未勾选。活动 OpenSpec 与实现符合本 change 的边界：正片通过系统 URL Protocol 交接，不增加浏览器内正片播放或未计划的 CI workflow；不保留实机播放、人工目视和跨浏览器解码验收条目。
- [x] H.6 归档前按当前 delta 路径核对规格归属：`disc-contracts`、`hdmv-navigation`、`interactive-graphics-extraction`、`offline-menu-runtime` 与 `offline-media-playback` 的主规格均已存在，本 change 的 MODIFIED/ADDED delta 已合并；新增 `distribution-budget` 主规格。`offline-media-playback` 保留已有色彩与播放要求，并加入菜单/线性媒体导出的起止目录大小报告及单资产 `maxAssetBytes` 契约。`offline-delivery-assurance` 由 `verify-offline-release` 维护，本 change 不包含该 delta。

本节合并记录：F.3 并入 F.1–F.2；E.6 并入 H.2；F.5 并入 H.3；H.5 并入 H.4。合并项不代表已验证。

## I. 已移出范围

原 I.1 针对本地 GET bridge 和 URL token。当前浏览器正片路径使用操作系统 URL Protocol；`runtime-web/src/browser.ts` 不含该本地桥。旧任务已移出当前范围。外部目标约束与审计由 `export-playable-media` 和 `verify-offline-release` 跟踪。

浏览器验收（Chrome 版本锁定、浏览器证据绑定、跨浏览器矩阵及 `docs/guides/browser-matrix.md`）已移出范围，`packages/test-runner` 的浏览器证据模块与 `BROWSER_EVIDENCE_*` 检查一并删除。原 B.4 与 E.5 随该项移出；`loop=false` 的结束语义由 `offline-menu-runtime` 的「非循环背景结束」场景定义。
