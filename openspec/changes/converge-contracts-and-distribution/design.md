# Design

## Context

本 change 定义默认预算、导航、来源位置、媒体生命周期、发布布局和性能基准的契约。共享约定见 [实施基线](../IMPLEMENTATION_BASELINE.md) §2、§4 和 §5。

实现与验收状态见 [tasks.md](tasks.md)。

## Goals / Non-Goals

**Goals:** 每个事实只有一个来源；已声明的契约要么成立、要么显式标记未验证；性能优先级由数据决定。

**Non-Goals:** 实现字节级完整性校验；实现浏览器内正片播放；引入 CI；BD-J 执行；把 `maxCallDepth` 做成真正的多帧栈（结构改动，单列后续 change）；新增本地 HTTP bridge。

## Decisions

### 1. `core` 是默认值的唯一来源（D3）

`hdmv` 的 `DEFAULTS` 改为从 `DEFAULT_LIMITS` 派生：

```ts
const DEFAULTS = {
  maxInstructionsPerTurn: DEFAULT_LIMITS.maxInstructionsPerTurn,
  maxCallDepth: DEFAULT_LIMITS.maxCallDepth,
  maxQueueDepth: DEFAULT_LIMITS.maxQueueDepth,
};
```

`DEFAULT_PLAYER_PROFILE` 同理，删除 `vm.ts:31-35` 的复制品，改为引用 `core` 导出的同名常量。

`VmOptions` 增加 `limits?: Limits`，内部 `validateLimits(options.limits ?? DEFAULT_LIMITS)`；原有三个散字段保留（测试在用），但当 `limits` 与散字段同时出现时以 `limits` 为准并记一条诊断，避免"两份值谁赢"的隐含规则。

**关于 `maxCallDepth` 的当前语义**：代码里只有 `if (this.opts.maxCallDepth < 1) throw ...`（`vm.ts:409,447`），且 `callStack` 只保存一帧——它不是深度上限，而是"CALL 是否允许"的开关。这与 `Limits` 中"128 = 保护性预算"的声明不符。

字段名保留（`Limits` 是对外契约，改名会波及 schema 与配置）。当前语义记录在 `IMPLEMENTATION_BASELINE` §5 与 `docs/support/hdmv-support.md`：`maxCallDepth` 是 CALL 开关，深度上限列为后续 change，需要同时改 `callStack` 结构、`MenuCheckpoint` 与 libbluray 单帧行为的对照结论。本批补一条测试锁定"`maxCallDepth` 为 0 时 `CALL_OBJECT` 报 `VM_CALL_DEPTH_LIMIT`"。

### 2. 证据记录保留实际执行的检查（D9=C）

不实现文件内容完整性检查。DiscIR 资产不包含内容摘要，包清单只记录相对路径、类型和长度，离线审计检查 schema、引用、路径边界和依赖。

证据文件记录路径、类型和长度。

M6 对文件完整性与制品替换的验证任务保持未完成。文档只描述实际执行的结构检查，不作字节替换检测结论。

### 3. 导航图与标题调用（D11）

- `terminatesFlow` 按 `opcode` 和 `context: "object" | "playlist"` 判定。MovieObject 中的 `LINK_PI`、`LINK_MK` 和 `TERMINATE_PL` 不终止该流；playlist 上下文中的对应指令终止该流。
- `JUMP_TITLE` 生成指向目标标题首个 program 的 `sequence` 边，标记 `origin: "jump-title"`；跳转后的原位置下一条指令不因此可达。
- `CALL_TITLE` 保存标题调用上下文并发出 `TITLE_SEARCH`；浏览器动作分发器调用 `selectTitle()`。目标不可用或出错时解除等待并记录诊断。
- 上下文不适用的指令记录含 opcode 与 context 的 `HDMV_OPCODE_CONTEXT_SKIPPED`（info），随后继续执行。

### 4. 来源位置（D12）

`SourceRef.path` 使用相对 BDMV 根的 POSIX 路径，例如 `PLAYLIST/00001.mpls`。来源保留 `origin` 和文件字节偏移。

- DiscIR entry 保留 `entry.source`；必需的 `SourceRef` 使用真实来源或明确标记的合成来源。没有实际位置的 Diagnostic 使用空位置字段并保留 `stage`。
- `vmPrograms` 保留指令的原始 `source.path`、`offset` 和 `instructionIndex`。
- IGS 结构诊断保留调用方提供的 path、clipId、pid 和 origin；未知位置使用可空字段并标明诊断阶段。
- entry 来源指向 `index.bdmv` 或 `BACKUP/index.bdmv`；Playlist 和 CLPI 来源保留在对应子对象中。

### 5. 媒体生命周期（D13）

- 初始 `runTurn()` 和 First Play 在有无菜单媒体时均执行；媒体播放由产生的 action 处理。
- 媒体桥按 action 和 `responseTo` 关联结束、错误和中断回执；非循环背景结束返回 `MEDIA_ENDED`。
- 主音轨选择成功或回滚时，PSR1 写入对应流号。
- 按钮命中区域使用可用按钮的 `selected ?? normal` bounds。

### 6. 发布布局（D7）

`runtime-web` 的 build 由 `tsc` 生成 dist，再由 esbuild 将 `src/browser.ts` 打包为 `dist/browser.bundle.js`（IIFE、ES2020）。`package.json` 通过 `./browser-bundle` 导出该产物。`package-builder` 消费该导出。两个包通过 `files: ["dist"]` 声明发布内容。

隔离安装验收使用发布包构建最小菜单包，并检查 bundle 可作为 classic script 加载。

### 7. 基准先行，修复按数据排序（D5=B）

基准覆盖以下五项：

- `packages/bdmv-parser`：`buildGraph` 用 N = 200 / 1000 / 5000 个 PlayItem 的合成 disc；
- `packages/igs`：`PesAssembler.append` 用 184 B × {1000, 10000, 50000} 个 TS 包拼 1 MB / 8 MB PES；
- `packages/bdmv-parser`：`choose()` 的主/备比较用 8 MB 缓冲；
- `packages/media-export`：`directoryBytesExcluding` 在 10k 文件目录上单次耗时（决定轮询间隔）；
- `packages/bdmv-io`：`buildInputFileTable` 在 1000 文件上相对"一次性 root 解析"的耗时差。

每项输出 `{ case, n, ms, rss }` 到 `test-data/bench/<git-sha>.json`（不入库，路径加入 `.gitignore`）。修复针对实测呈超线性或占比显著的项，每项记录前后对比；其他项的测量结论写入 `benchmark.md`。

基准记录重复测量的波动范围；同一 case 相对记录基线退化超过 20% 时记录原因。

## Risks / Trade-offs

- 历史包的未知清单字段由读取侧忽略；历史包兼容性需独立验证。
- `SourceRef` 逐条记录 path 和 offset；输出体积可通过实测评估。
- 系统交接记录目标和请求结果类别；外部程序执行和播放状态记为未验证。

## Migration Plan

1. **产物兼容**：旧包中的未知清单字段由读取侧忽略；重新生成的报告使用当前格式。
2. **IR schema**：`SourceRef` 的 `path` 约定从"两种写法混用"收敛为"相对 BDMV 根"。旧 IR（`source/structural`、`<MovieObject>`）在 `parseDiscIR` 时以 `SCHEMA_SOURCE_PLACEHOLDER` 警告拒绝，不静默接受——旧的空跑 IR 必须重新 `extract`。
3. **`dist` 布局**：`runtime-web` 的 `build` 顺序变为 `tsc → build:browser`；`package-builder` 的构建依赖前者，`pnpm -r build` 的拓扑顺序由 workspace 依赖保证（两者已有依赖关系）。
4. **测试夹具**：`IgsButton` 的 `numericSelectValue` 已在第 1 批补；本 change 若调整 `SourceRef` 形状，需同步 `packages/test-fixtures` 的 golden。

## Verification / Exit Criteria

1. **一致性**：`grep -rn "maxCallDepth: 64\|maxQueueDepth: 256" packages apps` 无命中；`grep -rn "source/structural\|<MovieObject>" packages apps` 无命中；产品代码、测试、缓存清单和生成脚本不记录文件内容校验值。参考缓存清单只记录上游仓库地址和固定 revision，fetch 脚本按该 revision clone/check out。
2. **行为**：见 `tasks.md` 每条的正反例，尤其 `JUMP_TITLE` 后继可达、`CALL_TITLE` 不可用能解除等待、无媒体包执行初始 VM、非循环背景 `ended` 后恢复、PSR1 随选轨更新。
3. **诚实**：`verify-offline-release` 的包审计任务只有在当前验收完成后才勾选；`offline-delivery-assurance` 不承诺字节级内容校验；README 描述系统播放器交接边界与当前未验证项。
4. **基准**：`benchmark.md` 记录每项 case 的机器/版本/样本/前后数据；修复项均有对应数据。
