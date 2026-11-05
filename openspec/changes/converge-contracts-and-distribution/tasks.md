# Tasks

对应决策：D3（契约常量）、D5（性能基准先行）、D7（builder 解耦）、D9=C（证据链减承诺）、D11（图/VM 语义）、D12（源位置保真）、D13（运行时生命周期）。D6 明确不做，见 §I。

前置：第 1 批 [`restore-build-gate-and-delivery-status`](../restore-build-gate-and-delivery-status/tasks.md) 完成——本 change 的验收依赖 `build` / `typecheck` / `test:all` 可跑，且 `dist` 不再含测试产物。共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。决策与证据来源见 [`docs/code-review.md`](../../../docs/code-review.md)。

## A. 契约常量收敛（D3）

- [ ] A.1 `packages/hdmv/src/vm.ts:30` 的 `DEFAULTS` 改为从 `@bdmv2web/core` 的 `DEFAULT_LIMITS` 派生（三个字段逐项引用，不写字面量）。验收：`grep -rn "maxCallDepth: 64\|maxQueueDepth: 256" packages apps` 无命中；`grep -n "DEFAULT_LIMITS" packages/hdmv/src/vm.ts` 有命中。
- [ ] A.2 删除 `packages/hdmv/src/vm.ts:31-35` 的 `DEFAULT_PLAYER_PROFILE` 复制品，改为引用 `@bdmv2web/core` 的同名导出。验收：`grep -rn "menuLanguage: \"eng\"" packages` 仅在 `core/src/index.ts` 命中一次。
- [ ] A.3 `VmOptions` 增加 `limits?: Limits`；内部 `this.limits = validateLimits(options.limits ?? DEFAULT_LIMITS)`；散字段与 `limits` 同时出现时以 `limits` 为准并记一条 `VM_LIMITS_OVERRIDDEN` 诊断。验收：单测覆盖"仅散字段""仅 limits""两者并存"三种构造，第三种产出该诊断且取 limits 值。
- [ ] A.4 补漂移锁：单测断言 `new HdmvVm([])` 的 `maxCallDepth` / `maxQueueDepth` / `maxInstructionsPerTurn` 等于 `DEFAULT_LIMITS` 对应字段。验收：故意把 `DEFAULTS` 改成字面量 64，该测试失败（验证后还原）。
- [ ] A.5 `maxCallDepth` 语义如实标注：在 `IMPLEMENTATION_BASELINE.md` §5 与 `docs/hdmv-support.md` 写明"当前为 CALL 开关（0 禁用），非深度上限；真正的多帧栈限制列为后续 change"，并补单测锁定 `maxCallDepth: 0` → `CALL_OBJECT` 报 `VM_CALL_DEPTH_LIMIT`。验收：两处文档有该表述；测试存在且通过。
- [ ] A.6 `--limits` 接线：`apps/cli` 的 `convert` 读取文件 → `validateLimits` → 传入 `VmOptions.limits`；删除第 1 批中临时加的 `CLI_NOT_IMPLEMENTED` 分支。验收：`convert <样本> --limits <合法 json>` 成功且 VM 使用该值（可通过 trace 中的 limit 字段观察）；非法值 → `exit 1` 且错误码为 `INVALID_LIMIT`；`grep -n "CLI_NOT_IMPLEMENTED" apps/cli/src/index.ts` 无命中。

## B. 证据链减承诺（D9=C）

- [x] B.0 更新实施基线：包清单不声明文件内容完整性；必需资产缺失仍为 failed。
- [x] B.1 移除产品侧内容摘要字段和计算。DiscIR 资产、包 manifest、审计报告及浏览器产物均不记录文件内容摘要；manifest 保留路径和长度。浏览器证据直接保存 profile、mode、生成媒体清单、矩阵和环境值。
- [x] B.2 检查仓库样本产物；当前 test-data 中没有需要重新生成的交付包。
- [x] B.3 删除旧内容摘要逻辑对应的专属测试和夹具，保留常规资源审计与文件长度行为测试。
- [x] B.4 浏览器证据按 profile/mode/生成媒体清单/矩阵/环境值判断是否过期；artifact 记录路径、类型和长度。
- [ ] B.5 在发布验证文档中记录 compatibility 构建与审计仍缺的工具版本及诊断字段。
- [x] B.6 实施基线与离线审计规范已更新；M6 中内容完整性相关任务未勾选。
- [ ] B.7 对历史包格式的兼容性仍需独立验证。

## C. 图与 VM 语义（D11）

- [ ] C.1 `packages/hdmv/src/graph.ts:63` 的 `terminatesFlow` 改为按上下文判定：签名 `(opcode, context: "movie-object" | "playlist")`；MovieObject 上下文中 `LINK_PI` / `LINK_MK` / `JUMP_TITLE` 不终止，`TERMINATE_PL` 仅在 playlist 上下文终止。验收：单测覆盖两种上下文 × 四个 opcode 共 8 组判定。
- [ ] C.2 `buildNavigationGraph` 为 `JUMP_TITLE` 生成 `sequence` 边，指向目标 entry 的首个 program，边带 `origin: "jump-title"` 以便区分静态 `jump` 边。验收：最小 `JUMP_TITLE` 程序的图同时含 `jump` 与 `sequence` 两类边（当前只有 `jump`）；目标 entry 在可达集合中。
- [ ] C.3 `CALL_TITLE` 建立 continuation：`vm.ts:437-458` 记录 `{ actionId, generation, waitFor: "started" }` 到等待表，`selectTitle` 的 `started` 与 `unavailable` 都按 `responseTo` 恢复；移除"无 continuation 即 suspended"的路径。验收：单测构造 `CALL_TITLE` → 桥回 `MEDIA_UNAVAILABLE` → VM 恢复且状态为预期的 unavailable；trace 中不再出现 `HDMV_IGNORED_EVENT`。
- [ ] C.4 桥端只对 `waitFor` 匹配的动作回复：`runtime-web` 的 `PreviewPlaybackBridge` 与 `MenuLoopPlaybackBridge` 增加"是否有匹配等待"的检查，不再把任意事件交给 `handleEvent` 试。验收：无等待时收到事件不产生副作用（trace 记录 discarded 原因）。
- [ ] C.5 被上下文忽略的指令留诊断：`vm.ts:460-470` 的静默 `return` 改为记 `HDMV_OPCODE_CONTEXT_SKIPPED`（info 级，含 opcode 与 context）。验收：在 MovieObject 上下文放入 `PLAY_PL` 指令，trace 出现该诊断且 VM 继续执行；`docs/hdmv-support.md` 补充该码说明。
- [ ] C.6 回归：现有 74 个 hdmv 用例全部通过；新增用例不少于 6 条（C.1 两组上下文、C.2 可达性、C.3 两条、C.5）。验收：`corepack pnpm --filter @bdmv2web/hdmv test` 计数 ≥ 80 且无跳过。

## D. 源位置保真（D12）

- [ ] D.1 `apps/cli/src/index.ts:194-204` 的 `createMenuDiscIR` 复制 `entry.source` 与诊断原始 `sourcePath` / `offset`，不再写 `source/structural` 与 `byteOffset: "0"`；无位置时保留 `null` 并保留 `stage`。验收：`grep -rn "source/structural" apps packages` 无命中；对 Tamako 样本执行 `extract` 后 `parsed-disc.json` 的每条 entry 都有真实 `PLAYLIST/*.mpls` / `CLIPINF/*.clpi` 路径。
- [ ] D.2 `apps/cli/src/index.ts:303` 的 `vmPrograms` 保留原始指令 `source.path` / `offset` / `instructionIndex`。验收：`grep -rn "<MovieObject>" apps packages` 无命中；trace 中任一指令能回读到源文件与字节偏移。
- [ ] D.3 `packages/igs/src/extract.ts:178` 的 `toIgsSource` 改为接收真实 `path` / `clipId` / `pid` / `origin`；IGS 结构诊断直接携带 `SourceLocation`。验收：对 Tamako 样本执行 `extract`，`source-map.json` 的 `diagnostics[].source` 不再出现 `BDMV/STREAM/.m2ts`，且含 `clipId` 与 `pid`。
- [ ] D.4 路径约定锁定为"相对 BDMV 根"（`PLAYLIST/00001.mpls`，不带 `BDMV/` 前缀）；`parseDiscIR` 对旧占位值（`source/structural`、`<MovieObject>`）报 `SCHEMA_SOURCE_PLACEHOLDER` 并拒绝。验收：单测用旧 IR 断言拒绝；新 IR 通过；`grep` 确认 parser 与 CLI 只用一种写法。
- [ ] D.5 `docs/protocol-support.md` / `docs/hdmv-support.md` 的 Sources 章节补充"路径相对 BDMV 根"的约定与示例。验收：两份文档含该约定且示例路径符合格式。

## E. 运行时生命周期（D13）

- [ ] E.1 `packages/runtime-web/src/browser.ts:164-173` 的初始 `runTurn()` / First Play 与 `data.media` 解耦：无条件执行初始 turns，媒体播放作为其产生的 action 处理。验收：构造无 `media` 字段的包，打开后 VM 有初始动作（trace 非空、`status` 进入预期状态）。
- [ ] E.2 `MenuLoopPlaybackBridge`（`runtime-web/src/index.ts:496-588`）补 `ended` / `error` / `abort` 监听，按 `responseTo` 回执；`loop=false` 且单 PlayItem 结束时回 `MEDIA_ENDED`。验收：非循环背景播放结束后 VM 从等待恢复（当前永久 suspended）；错误路径回 `MEDIA_ERROR` 并解除等待。
- [ ] E.3 音轨选择写回 PSR1：选轨成功后经系统事件入口 `systemWrite(1, psrStreamNumber)`，不通过程序写入路径。验收：选轨后 `snapshot().registers.psr` 的 PSR1 等于所选流号；单测断言按钮程序读到该值（当前读到 `0xff`）。
- [ ] E.4 命中几何统一：`MenuController.hit()` 按可用性决定命中集（可用即 `selected ?? normal` 的 bounds）。验收：只有 `normal` 视觉的启用按钮可被点击命中；单测覆盖"仅 normal""selected 与 normal 不同几何"两种情况。
- [ ] E.5 `docs/browser-matrix.md` 记录 `loop=false` 结束语义为"回 `MEDIA_ENDED`，画面停留末帧由渲染决定"，并注明如需 `MEDIA_HELD` 属后续能力。验收：文档含该条，且未声称支持 `HELD`。
- [ ] E.6 回归：`corepack pnpm --filter @bdmv2web/runtime-web test` 现有 91 用例通过；`tamako-headless-navigation.test.ts` 仍通过（该用例 50s，若因此变慢需在本 change 记录耗时）。

## F. 发布布局可构建（D7）

- [ ] F.1 `packages/runtime-web` 增加 `build:browser`：esbuild 打包 `src/browser.ts` → `dist/browser-entry.js`（IIFE / ES2020），`build` 顺序为 `tsc → build:browser`；`exports` 增加 `"./browser-entry"`。验收：`corepack pnpm --filter @bdmv2web/runtime-web build` 后该文件存在，且产物内不含 `require(` 之外的 Node 内建引用。
- [ ] F.2 `packages/package-builder/src/index.ts:127-128` 改为解析 `@bdmv2web/runtime-web/browser-entry`，删除 `runtime-web/src/browser.ts` 与 `hdmv/src/index.ts` 两处相对路径与 alias。验收：`grep -rn "runtime-web/src\|hdmv/src" packages/package-builder/src` 无命中；`corepack pnpm --filter @bdmv2web/package-builder build` 成功。
- [ ] F.3 防回归单测：拦截 `node:fs` 读取 `**/src/*.ts`（用 `vi.mock` 或 `module.register`），断言 `buildMenuPackage` 执行期间不发生此类读取。验收：测试通过；把实现改回相对路径时测试失败（验证后还原）。
- [ ] F.4 `@bdmv2web/runtime-web` 与 `@bdmv2web/package-builder` 增加 `files: ["dist"]`。验收：两包 `npm pack --dry-run` 清单不含 `src/`、不含 `*.test.*`；生成的包仍能被 `apps/cli` 构建使用（`corepack pnpm -r build` 全通过）。
- [ ] F.5 端到端：`convert` 一个现有样本，产物结构与此前一致。验收：`find <out> -type f | sort` 与改动前快照一致（除时间戳/版本字段）；`validate --offline` 结果不变。

## G. 性能基准与修复（D5=B）

- [ ] G.1 建立基准入口 `scripts/bench/`（Node 脚本，不引入新依赖）：五项 case 见 `design.md` §7，输出 `{ case, n, ms, rss }` 到 `test-data/bench/<git-sha>.json`；该路径加入 `.gitignore`。验收：`corepack pnpm exec node scripts/bench/index.mjs` 跑完全部 case 并写出文件。
- [ ] G.2 记录基线到 `openspec/changes/converge-contracts-and-distribution/benchmark.md`：机器型号、Node/pnpm 版本、样本生成方式、每项 ms/rss。验收：他人按文档可复现（同一机器重复 3 次，波动 < 10% 视为可复现）。
- [ ] G.3 判定：按数据把五项分为"呈超线性 / 常数浪费 / 可接受"三类并写入 `benchmark.md`。验收：每项有数据支撑的归类理由，无"凭印象"结论。
- [ ] G.4 只修被数据判为超线性的项，逐项独立提交并附前后对比。候选与预期（需数据确认）：`PesAssembler.append` 改"TS 切片数组 + 末尾拼接"、`buildGraph` 预建 `Map`/`Set` 索引、`choose()` 逐字节比较替代 `hex()` 全量字符串。验收：修复项基准改善 ≥ 2× 或复杂度下降（如 n 翻倍时耗时不再 4 倍），且相关用例全通过。
- [ ] G.5 `directoryBytesExcluding` 轮询间隔从 10ms 调整为 400ms（常数浪费，改前需记录单次耗时）。验收：一次 20 分钟量级编码的调用次数下降 ≥ 90%（用缩短时长的模拟编码验证计数）；字节预算仍能在超限时中止（正反例各一条）。
- [ ] G.6 `buildInputFileTable` 的 root 只解析一次后透传（重复 `realpath`）。验收：1000 文件输入的 `canonicalDirectory` 调用次数从 1000 降到 1（用计数器断言）。
- [ ] G.7 未修的项写入 `benchmark.md` 的"已知未优化"，说明原因与触发条件。验收：无"顺手重构"未记录项；`git log` 中每项性能提交都有对应数据。

## H. 整体验收

- [ ] H.1 一致性 grep 三连（同 `design.md` Exit Criteria 1）：
  1. 无重复常量：`grep -rn "maxCallDepth: 64\|maxQueueDepth: 256" packages apps` 无命中。
  2. 无占位源位置：`grep -rn "source/structural\|<MovieObject>" packages apps` 无命中。
  3. `内容摘要字段` 口径：`grep -rn "内容摘要字段" packages apps --include=*.ts` **无命中**；`test-data` 内仅 `BDMV-menu.backup-2026-11-04`（B.7 的旧包夹具）保留；`docs` / `openspec` 中只作为历史与迁移说明出现，不出现"已校验/可检测篡改"的表述。
  
  验收：三条命令的输出与上述口径逐字一致；第 3 条若在代码内有命中，说明 B.1 漏删，不得以"仅剩迁移说明"放过。
- [ ] H.2 行为回归：`corepack pnpm build && corepack pnpm typecheck && corepack pnpm test:all` 全绿；hdmv ≥ 80 用例、runtime-web ≥ 95 用例（含新增），其余包不低于第 1 批基线。
- [ ] H.3 端到端两条链路不退化：`extract` → `convert` → `validate --offline` 在 `test-data` 样本上结果与第 1 批一致（除 `内容摘要字段` 字段移除与源位置字段变真实）。
- [ ] H.4 诚实性检查：README「已知限制」含"未实现字节级完整性校验""本地桥 token 在 URL（审计无法归因）""`loop=false` 不支持独立末帧状态"三条；M6 的 1.1 / 4.3 未勾选。
- [ ] H.5 范围守界：`git diff --stat` 不包含本地桥实现改动（D6）、不包含 `standalone-full` 实现、不包含新增 CI workflow。
- [ ] H.6 规格归属处理（apply 的第一步，先于任何代码改动）：`openspec validate` 通过但 archive 会拒绝 5 个 MODIFIED delta。按 `proposal.md` 的表执行——`disc-contracts`、`hdmv-navigation`、`interactive-graphics-extraction` 的上游 change 已标记 Complete，先 `openspec archive` 使主规格存在；`offline-menu-runtime`（`build-offline-menu-runtime` 13/16）与 `offline-delivery-assurance`（`verify-offline-release` 14/17）上游未完成，把本 delta 内容并入上游 `spec.md` 后删除本 change 的对应目录。验收：处理后 `openspec archive converge-contracts-and-distribution --dry-run`（或等效检查）不再报"target spec does not exist"；删除的 delta 内容可在上游 spec.md 中原样检出。

## I. 明确不做（D6）

- [ ] I.1 记录而非修改：在 `README` / `docs/browser-matrix.md` 的已知限制中写明"本地桥以 `<img src>` 发起 GET 且 token 在 URL；离线审计无法把该调用归因到具体规则，仅以 `BUNDLE_DYNAMIC_ACCESS` 记 `not-verified`"。验收：文档含该条；`grep -rn "127.0.0.1" packages/runtime-web/src/browser.ts` 仍为 1 处（确认未改）。
