# GC 压力审查（2026-11-15）

> 日期：2026-11-15
> 范围：全量 `pnpm bench`（47 行，3 forks）的 GC 事件与 `--mode heap` 分配归因；基线 `e44e422`，工作区含本轮未提交改动。
> 定位：历史记录。文中的毫秒值只描述 Node 24.18.0 下一次运行的结果；当前基准口径以 [性能基准指南](../../../guides/performance.md) 为准。

## 0. 结论

全量基准没有失败行。逐 fork 记录显示 GC 时间集中在 VM trace 构造、导航闭包计算、图构建和 IGS 解析上。按 `gcMs / iterations` 估算，`hdmv.vm-trace.growth` 每次调用的 GC 从 21.8 ms 降到 1.5 ms，`hdmv.nav-graph-tamako.build` 从 7.0 ms 降到 3.7 ms。同时，`hdmv.vm-trace.growth` 的中位耗时从 152.2 ms 降到 8.8 ms（-94.2%），`hdmv.nav-graph-tamako.build` 从 98.2 ms 降到 62.2 ms（-36.6%），`MovieObject` 解析从 1.59 ms 降到 0.96 ms（-39.2%）。

## 1. 观测方法

基线记录 `test-data/bench/runs/2026-11-15T140436-448Z-9510a491`，候选记录 `test-data/bench/runs/2026-11-15T142140-608Z-3ebdc98b`；两者使用同一 Node 版本和同一基准配置 `--build-mode normal --forks 3 --warmup-ms 100 --time-ms 500 --min-samples 10`。运行记录留在 `test-data/bench/`（gitignored），不作为可复现的仓库输入。

```sh
env -u NODE_OPTIONS corepack pnpm bench --mode benchmark --build-mode normal --suite all --forks 3 --warmup-ms 100 --time-ms 500 --min-samples 10 --out test-data/bench/runs
node scripts/bench/compare.mjs test-data/bench/runs/<baseline> test-data/bench/runs/<candidate> --out test-data/bench/reports/gc-comparison.json
```

每个 fork 的 GC 事件在 `run.json` 里只有 `gc.eventCount` 和 `gc.series` 引用，四列数据存放在 `gc.f64`。归因使用 Chrome DevTools 堆采样（32 KiB 间隔，`includeObjectsCollectedBy*GC: true`）：

```sh
env -u NODE_OPTIONS corepack pnpm bench --mode heap --case <caseId> --duration-ms 3000 --out test-data/bench/profiles
```

固定窗口里的 GC 总量不能直接跨运行比较：操作变快后同一窗口执行更多调用，分配总量反而上升。本轮比较使用 `gcMs / iterations`（这些 case 的 `callsPerSample` 多为 1；trace 行为 1），并同时看中位耗时。CLI case 的父进程记录不覆盖子进程，因此 CLI 行的 GC 没有作为结论依据。

## 2. 归因

改动前的堆采样主要分配点：

| case | 主要分配点（profile 自计） |
| --- | --- |
| `hdmv.vm-trace.growth` | `decodeInstruction`（`bytesFrom` 的 regex `match`、`padStart`、`Uint8Array.from`、`DataView`）、`record` 的 trace entry、`deltaSinceMark` 的 Map 与空记录 |
| `hdmv.nav-graph-tamako.build` | `computeMediaClosure` 每条 route 克隆全部 observed edge、每个 root 新建 visited Set、`markKey` 字符串；`buildNavigationGraph` 的逐指令数组字面量 |
| `perf.igs.battle-royale.parse` | `validateIgsSceneAssets` 的 `objectId:paletteId` 字符串键与值对象、逐按钮状态数组；`consumeSegment` 的 source 与诊断对象 |
| `perf.pgs.baja.parse` | 整条 SUP 的 `Segment[]`、逐段 BigInt epoch、segment 对象 |
| `scale.pes-4x.extract` | transport packet 对象与 payload 视图；本轮的 IGS 侧只移除了未捕获流时每 PES 的 10 字节头 |

## 3. 改动

| 文件 | 改动 |
| --- | --- |
| `packages/utils/src/bytes.ts` | `bytesToHex` 使用 256 项预计算表，去掉每字节的 `toString` + `padStart`。`bdmv-parser` 的 MovieObject 十六进制转换走这条路径，因此解析行同步受益 |
| `packages/hdmv/src/bytecode/decode.ts` | 字符串命令直接解析为三个大端 word：去掉 `match(/../g)`、`Uint8Array.from`、`DataView` 和递归；规范小写输入复用原字符串；opcode 集合、源位置、目标操作数规则提升为模块常量 |
| `packages/hdmv/src/virtual-machine/vm.ts` | 每 VM 缓存解码结果：字符串命令按内容、对象命令按身份，`WeakMap` 随程序回收；显式 `source` 覆盖时绕过缓存；trace 文本按解码对象记忆，重复指令共享同一字符串 |
| `packages/hdmv/src/virtual-machine/registers.ts` | 无写入时 `deltaSinceMark` 返回共享空 delta，不再分配两个空记录和去重 Map；有写入时按 gpr/psr 两个数值键 Map 去重 |
| `packages/hdmv/src/virtual-machine/vm-semantics.ts` | `textInstruction` 用逐操作数拼接，去掉 `filter`/`map`/`join` 的中间数组 |
| `packages/hdmv/src/graph/graph.ts` | `terminatesFlow` 与分支判断复用模块级 opcode Set，去掉逐指令数组字面量 |
| `packages/media-export/src/closure.ts` | 每条 observed edge 只投影一次，route 保存前缀数组并共享投影对象；route 签名用 root + 前缀长度；跨 root 复用一个 generation 标记的 visited Map；unknown 去重改为按 label 分组的 key Set；缺边返回共享空数组 |
| `packages/igs/src/rendering/png.ts` | 渲染与校验共用 `collectPageObjectPalettes`：`objectId * 65536 + paletteId` 数值键，去掉字符串键与值对象、逐状态数组 |
| `packages/igs/src/scene/igs.ts` | 按钮校验不再为每个按钮建 `Object.entries(neighbors)` 数组和 `map` 数组 |
| `packages/igs/src/scene/extract.ts` | 只有 `captureStreams` 时才分配并填充每个 PES 的 10 字节 MNU 头 |
| `packages/media-export/src/pgs/pgs.ts` | `readSegments` 改为生成器，解析不再保留整条 `Segment[]`；epoch 用 number 累计，去掉逐段 BigInt |

`decodeInstruction` 的字节数组路径仍保留 `bytesToHex`；这是低频入口，字符串和对象命令已不走该路径。VM 缓存假定程序与按钮命令数组在 add 之后不被原地改写；如果调用方修改同一个 `MovieInstruction` 对象的 `bytes`，缓存不会重新校验 `words`。仓库内没有这种用法，现有测试覆盖了 `words` 不匹配的首轮校验。

## 4. 验证

`scripts/bench/compare.mjs` 对 47 行给出 5 个确认改善、0 个确认退化；其余行是 no-regression。多行出现 +2%~4% 的漂移，未同时越过 10% 相对阈值与 0.05 ms 绝对阈值，且同样出现在本轮未改动的 PNG/RLE/browser 行上，按运行时段差异处理。

| case | 中位 ms/call | GC ms/call |
| --- | --- | --- |
| `hdmv.vm-trace.growth` | 152.241 → 8.806（-94.2%） | 21.75 → 1.45 |
| `hdmv.nav-graph-tamako.build` | 98.213 → 62.220（-36.6%） | 7.04 → 3.68 |
| `hdmv.vm-tamako.exec` | 10.613 → 9.734（-8.3%） | 0.49 → 0.64 |
| `perf.movieobject.heavy.parse` | 1.585 → 0.963（-39.2%） | 0.10 → 0.07 |
| `perf.graph.tamako.build` | 2.050 → 2.019（-1.5%） | 0.30 → 0.10 |
| `perf.igs.battle-royale.parse` | 29.490 → 30.632（+3.9%） | 0.36 → 0.27 |

`hdmv.vm-trace.growth` 的候选 fork 内 CV 为 29%~36%（fork 间中位 CV 3.4%），因为每次调用分配 10 万条 trace entry，窗口内偶尔落进一次 GC；这行的中位数仍按 3 个独立 fork 的进程级区间确认改善。`hdmv.vm-tamako.exec` 的 GC/call 略升而中位下降，说明该行剩余分配不在关键路径上；没有为它继续加缓存。

已执行：

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm test`（包含 `scripts/bench/*.test.mjs`）
- `node scripts/bench/compare.mjs <baseline> <candidate>`（见上表）

## 5. 未验证

- 浏览器 case 只走 benchmark 行，未另做浏览器堆分析。
- CLI case 的 GC 只在父进程记录；子进程内部的分配未纳入本表。对小体积 synthetic disc 直接跑 `node --trace-gc apps/cli/dist/index.js export …` 能看到 90 ms 内约 10 次 scavenge，但没有和改动前做同输入对比。
- 未用真实光盘验证；本轮的解析与渲染行为由现有测试和固定 fixture 覆盖。
