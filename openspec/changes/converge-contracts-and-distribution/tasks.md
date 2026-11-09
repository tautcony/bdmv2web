# Tasks

对应决策：D3（契约常量）、D5（性能基准先行）、D7（builder 解耦）、D9=C（证据链减承诺）、D11（图/VM 语义）、D12（源位置保真）、D13（运行时生命周期）。D6 明确不做，见 §I。

前置：第 1 批 [`restore-build-gate-and-delivery-status`](../restore-build-gate-and-delivery-status/tasks.md) 完成——本 change 的验收依赖 `build` / `typecheck` / `test:all` 可跑，且 `dist` 不再含测试产物。共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。决策与证据来源见 [`docs/archive/reviews/review-2026-11-04/index.md`](../../../docs/archive/reviews/review-2026-11-04/index.md)。

## 当前实现复核（2026-11-09）

内容摘要计算与字段已删除。媒体 `ended` 回执、主音轨 PSR1 写回、菜单 VM/sound 连接、HDMV 默认 Limits 收敛与 `convert --limits` 接线均已实现，回归验收状态见下列任务。无菜单媒体启动、normal-only 按钮命中、来源路径保真、上下文导航图和性能基准仍未完成。浏览器 bundle 构建与 package-builder 对 bundle 的消费代码已存在；隔离安装验收仍未确认。`CALL_TITLE` 由 `TITLE_SEARCH` 动作触发浏览器侧 `selectTitle()`。

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
- [ ] B.5 在发布验证文档中记录 compatibility 构建与审计仍缺的工具版本及诊断字段。
- [x] B.6 实施基线与离线审计规范已更新；M6 中内容完整性相关任务未勾选。
- [ ] B.7 对历史包格式的兼容性仍需独立验证。

## C. 图与 VM 语义（D11）

- [ ] C.1 `packages/hdmv/src/graph.ts:63` 的 `terminatesFlow` 改为按上下文判定：签名 `(opcode, context: "object" | "playlist")`；MovieObject 上下文中 `LINK_PI` / `LINK_MK` 不终止，`JUMP_TITLE` 结束当前 run 且不生成到下一条指令的 `sequence` 边，`TERMINATE_PL` 仅在 playlist 上下文终止。验收：单测覆盖两种上下文 × 四个 opcode 共 8 组判定。
- [ ] C.2 为 `NavigationGraphEdge` 增加 `origin` 字段（类型与 schema 同步，读取方忽略未知值），再由 `buildNavigationGraph` 为 `JUMP_TITLE` 生成指向目标 entry 首个 program 的 `sequence` 边，标 `origin: "jump-title"`，与静态 `jump` 边并存。验收：最小 `JUMP_TITLE` 程序的图同时含 `jump` 与 `sequence` 两类边；目标 entry 在可达集合中；原位置下一条指令不因该跳转成为可达。
- [x] C.3 核对当前 `CALL_TITLE` 恢复路径：VM 暂停并发出 `TITLE_SEARCH`，runtime 调用 `selectTitle()`。验收覆盖有效 HDMV 目标、不可用目标及 BD-J/无效目标；VM 不永久 suspended，trace 保留结果与来源。不新增与现行直接选择路径重复的 `responseTo` 桥接机制。2026-11-06 审计修复：`selectTitle()` 失败释放标题切换，BD-J/缺表使用 `unsupportedOperation`；回归在 `packages/hdmv/src/index.test.ts`。
- [ ] C.4 桥端只对 `waitFor` 匹配的动作回复：`runtime-web` 的 `PreviewPlaybackBridge` 与 `MenuLoopPlaybackBridge` 增加"是否有匹配等待"的检查，不再把任意事件交给 `handleEvent` 试。验收：无等待时收到事件不产生副作用（trace 记录 discarded 原因）。
- [x] C.5 被上下文忽略的指令留诊断：`vm.ts:460-470` 的静默 `return` 改为记 `HDMV_OPCODE_CONTEXT_SKIPPED`（info 级，含 opcode 与 context）。验收：在 IG 上下文放入 `PLAY_PL` 或 MovieObject 上下文放入 `LINK_PI`，trace 出现该诊断且 VM 继续执行；`docs/support/hdmv-support.md` 已补充该码说明。回归在 `packages/hdmv/src/index.test.ts`。
- [x] C.6 回归：现有 74 个 hdmv 用例全部通过；新增用例不少于 6 条（C.1 两组上下文、C.2 可达性、C.3 两条、C.5）。验收：`corepack pnpm --filter @bdmv2web/hdmv test` 计数 ≥ 80 且无跳过。2026-11-06：88 项通过；新增 JUMP_TITLE 单动作、标题切换释放、IG CALL_OBJECT、PSR5–8、播放等待期间 POPUP/TOP/按钮、CALL_OBJECT 缺目标继续等回归。
- [ ] C.7 对 `.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c` 的每个已解码 opcode 建立实现状态表；逐项确认上下文、PC、寄存器、事件/等待和诊断。修复与参考行为不符的可实现语义；参考本身未实现的操作保持显式状态。验收：表覆盖 `decode.ts` 的全部 opcode；每项有直接回归；不把 `ig_object` 规则绑定到单张碟片。

## D. 源位置保真（D12）

- [ ] D.1 `apps/cli/src/commands/build.ts` 的 DiscIR entry 来源从原始 `ParsedDisc` 的 `entry.source` 生成，保留 `path` / `origin` / `byteOffset`；不再写 `source/structural` 与 `byteOffset: "0"`。`DiscIR` 中 required 的 `SourceRef` 不得为 `null`；无实际位置的 Diagnostic 允许 `sourcePath` / `offset` 为 `null` 并保留 `stage`。验收：`grep -rn "source/structural" apps packages` 无命中；对 Tamako 样本执行 `extract` 与 `convert` 后，entry 来源为 `index.bdmv`（含 `BACKUP/index.bdmv` 与 `origin: "backup"`），Playlist/CLIPINF 来源出现在对应子对象中，Schema 校验通过。
- [ ] D.2 `apps/cli/src/commands/build.ts` 的 `vmPrograms` 保留原始指令 `source.path` / `offset` / `instructionIndex`，不再写 `<MovieObject>`；必要时扩充中间类型，不在 CLI 二次推导字节偏移。验收：`grep -rn "<MovieObject>" apps packages` 无命中；trace 与 source-map 中任一指令能回到源文件与字节偏移，`byteOffset` 为有效十进制字符串。
- [ ] D.3 `packages/igs/src/extract.ts` 的 `toIgsSource` 由调用方传入真实 `path` / `clipId` / `pid` / `origin`；位置未知时使用显式可空字段与准确诊断阶段，不生成 `STREAM/.m2ts` 或 `pid: 0` 占位。验收：`source-map.json` 的 `diagnostics[].source` 对已知结构位置含 `clipId` 与 `pid`，对未知位置为空并带阶段。
- [ ] D.4 路径约定锁定为"相对 BDMV 根"（`PLAYLIST/00001.mpls`，不带 `BDMV/` 前缀）；`parseDiscIR` 对旧占位值（`source/structural`、`<MovieObject>`）报 `SCHEMA_SOURCE_PLACEHOLDER` 并拒绝。验收：单测用旧 IR 断言拒绝；新 IR 通过；`grep` 确认 parser 与 CLI 只用一种写法。
- [ ] D.5 `docs/support/protocol-support.md` / `docs/support/hdmv-support.md` 的 Sources 章节补充"路径相对 BDMV 根"的约定与示例。验收：两份文档含该约定且示例路径符合格式。

## E. 运行时生命周期（D13）

- [ ] E.1 `packages/runtime-web/src/browser.ts` 的初始 `runTurn()` / First Play 与媒体存在性解耦：无条件执行初始 turns，媒体播放作为其产生的 action 处理。验收：构造无 `media` 与 `menuMedia` 字段的包，打开后 VM 有初始动作（trace 非空、`status` 进入预期状态），按钮可导航。
- [ ] E.2 回归已实现的菜单媒体 `ended`/`error`/`abort` 回执：按 action/responseTo 关联，非循环背景结束发 `MEDIA_ENDED`，错误解除等待并保留诊断。回归证据确认后勾选。
- [ ] E.3 回归已实现的音轨 PSR1 写回：成功选择和失败回滚均经 `systemWrite(1, streamNumber)` 更新系统寄存器；验证按钮程序读取所选值。回归证据确认后勾选。
- [ ] E.4 命中几何统一：`MenuController.hit()` 按可用性决定命中集（可用即 `selected ?? normal` 的 bounds）。验收：只有 `normal` 视觉的启用按钮可被点击命中；单测覆盖"仅 normal""selected 与 normal 不同几何"两种情况。
## F. 发布布局可构建（D7）

- [ ] F.1–F.2 验收现有发布布局：`runtime-web` 构建产出 `dist/browser.bundle.js` 并导出 `./browser-bundle`；`package-builder` 通过该导出消费 bundle。以隔离安装的最小菜单包构建验证两个包可在不安装 workspace `src/` 的情况下运行；确认 bundle 是可直接加载的 classic script，不依赖未注入的 Node 内建模块。隔离安装验收记录行为证据。
- [ ] F.4 补齐 `@bdmv2web/package-builder` 的 `files: ["dist"]`；`@bdmv2web/runtime-web` 已有该白名单，本项只复核。验收：两包 `npm pack --dry-run` 清单不含 `src/`、不含 `*.test.*`。

## G. 性能基准与修复（D5=B）

- [ ] G.1 建立基准入口 `scripts/bench/`（Node 脚本，不引入新依赖）：五项 case 见 `design.md` §7，输出 `{ case, n, ms, rss }` 到 `test-data/bench/<git-sha>.json`；该路径加入 `.gitignore`。验收：`corepack pnpm exec node scripts/bench/index.mjs` 跑完全部 case 并写出文件。
- [ ] G.2 记录基线到 `openspec/changes/converge-contracts-and-distribution/benchmark.md`：机器型号、Node/pnpm 版本、样本生成方式、每项测量结果及重复测量的波动范围。验收：记录足以在相同环境重跑并解释测量波动；不设统一波动百分比门槛。
- [ ] G.3 判定：按数据把五项分为"呈超线性 / 常数浪费 / 可接受"三类并写入 `benchmark.md`。验收：每项有数据支撑的归类理由，无"凭印象"结论。
- [ ] G.4 只修被数据判为超线性或占比显著的项，并记录修复前后测量结果。候选项为 `PesAssembler.append`、`buildGraph`、`choose()`；不要求采用指定实现或固定倍数阈值。验收：数据支持修复有效，相关用例通过。
- [ ] G.5 根据 `directoryBytesExcluding` 的测量结果选择轮询间隔，记录目录扫描开销与超限中止的实测延迟。验收：短时模拟覆盖预算内完成与超限中止，字节预算在超限时仍会中止任务。
- [ ] G.6 `buildInputFileTable` 的 root 只解析一次后透传（重复 `realpath`）。验收：1000 文件输入的 `canonicalDirectory` 调用次数从 1000 降到 1（用计数器断言）。
- [ ] G.7 未优化的基准项写入 `benchmark.md`，记录测量结论；数据支持后续触发处理的项写明触发条件。

## H. 整体验收

- [ ] H.1 一致性 grep 三连（同 `design.md` Exit Criteria 1）：
  1. 无重复常量：`grep -rn "maxCallDepth: 64\|maxQueueDepth: 256" packages apps` 无命中。
  2. 无占位源位置：`grep -rn "source/structural\|<MovieObject>" packages apps` 无命中。
  3. `内容摘要字段` 口径：`grep -rn "内容摘要字段" packages apps --include=*.ts` **无命中**；`test-data` 内仅 `BDMV-menu.backup-2026-11-04`（B.7 的旧包夹具）保留；`docs` / `openspec` 中只作为历史与迁移说明出现，不出现"已校验/可检测篡改"的表述。
  
  验收：三条命令的输出与上述口径逐字一致；第 3 条若在代码内有命中，说明 B.1 漏删，不得以"仅剩迁移说明"放过。
- [ ] H.2 全量验证：`corepack pnpm build && corepack pnpm typecheck && corepack pnpm test:all` 全绿；该结果同时覆盖 E.6 的 runtime-web 与 headless 导航回归。
- [ ] H.3 端到端两条链路不退化：`extract` → `convert` → `validate --offline` 在 `test-data` 样本上结果与第 1 批一致（除内容摘要字段移除与源位置字段变真实）；该结果同时覆盖 F.5。
- [ ] H.4 文档与范围核对：README 说明未实现字节级完整性校验、外部系统播放器状态不回传、`loop=false` 不提供独立末帧状态；M6 未验证项保持未勾选。活动 OpenSpec 与实现符合本 change 的边界：正片通过系统 URL Protocol 交接，不增加浏览器内正片播放或未计划的 CI workflow；不保留实机播放、人工目视和跨浏览器解码验收条目。
- [ ] H.6 归档前按当前 delta 路径核对规格归属：`disc-contracts`、`hdmv-navigation`、`interactive-graphics-extraction`、`offline-menu-runtime` 主规格已存在，本 change 直接以 MODIFIED 应用；`offline-media-playback` 主规格已由 `fix-hdr-color-pipeline` 于 2026-11-09 归档时建立（7 条色彩与编码要求），`export-playable-media` 以 ADDED 追加 8 条播放与交接要求，本 change 不持有该 delta。`offline-delivery-assurance` 的收敛要求已并入 `verify-offline-release` 的 ADDED 主规格。剩余归档顺序为 `export-playable-media` → `verify-offline-release` → 本 change；不得对缺失主规格应用 MODIFIED-only delta。

本节合并记录：F.3 并入 F.1–F.2；E.6 并入 H.2；F.5 并入 H.3；H.5 并入 H.4。合并项不代表已验证。

## I. 已移出范围

原 I.1 针对本地 GET bridge 和 URL token。当前浏览器正片路径使用操作系统 URL Protocol；`runtime-web/src/browser.ts` 不含该本地桥。旧任务已移出当前范围。外部目标约束与审计由 `export-playable-media` 和 `verify-offline-release` 跟踪。

浏览器验收（Chrome 版本锁定、浏览器证据绑定、跨浏览器矩阵及 `docs/guides/browser-matrix.md`）已移出范围，`packages/test-runner` 的浏览器证据模块与 `BROWSER_EVIDENCE_*` 检查一并删除。原 B.4 与 E.5 随该项移出；`loop=false` 的结束语义由 `offline-menu-runtime` 的「非循环背景结束」场景定义。
