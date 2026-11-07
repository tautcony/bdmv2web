# Design

## Context

本 change 处理 7 项评审决策，它们共享同一个根因：**同一事实存在两个来源，且较弱的那个被当真**。

| 事实 | 强来源 | 弱来源（当前被当真） |
| --- | --- | --- |
| 仿真预算 | `core.DEFAULT_LIMITS`（导出的公开契约） | `hdmv` 私有 `DEFAULTS`（64/256） |
| 完整性 | 设计文档声称"字节篡改会失败" | `auditOutputPackage` 恒返回 `null` 指纹 |
| 导航语义 | pinned libbluray 行为 | `graph.ts` 的"遇到这些 opcode 就终止" |
| 源位置 | parser 实际产出的 `SourceRef` | 交付层的占位常量 |
| 媒体生命周期 | 事件信封的 `responseTo` 契约 | 桥只处理 `started`，其余丢弃 |
| 构建输入 | 包产物（`dist`） | 相对路径指向 `src/*.ts` |
| 性能判断 | 无 | 静态阅读得出的优先级 |

基线见 [IMPLEMENTATION_BASELINE.md](../IMPLEMENTATION_BASELINE.md) §2（共享数据）、§4（状态与证据）、§5（首期固定选择）。

## 当前实现复核（2026-11-06）

以下事项已在代码中落地，剩余验收不得重复要求实现：内容摘要字段与计算已移除；菜单背景 `ended` 回执、主音轨选择后的 PSR1 写回、菜单输入与 VM/sound 集成已存在；浏览器的外部影片路径使用 URL Protocol，不使用本地桥。菜单循环结束和音轨变化仍需按各自 change 的验收证据确认。

HDMV 默认 Limits 已从 core 派生，`convert --limits FILE` 已将配置传入转换时与打包后的 HDMV VM；仍未完成的实现项包括：导航图上下文边、交付层真实来源路径、无菜单媒体时启动 VM、normal-only 按钮命中，以及 builder 不再读取 workspace 源码。媒体结束回执和 PSR1 写回已实现但本 change 的完整回归尚未复核。性能基准未建立。

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

浏览器证据直接保存 profile、mode、生成媒体清单、矩阵与浏览器环境，按这些值判断记录是否适用于当前场景。证据文件记录路径、类型和长度。

M6 对文件完整性与制品替换的验证任务保持未完成。文档只描述实际执行的结构检查和浏览器场景，不作字节替换检测结论。

### 3. 导航图按"上下文"而不是"opcode 黑名单"判定（D11）

`graph.ts:63` 的 `terminatesFlow` 把 `JUMP_TITLE` / `LINK_PI` / `LINK_MK` / `TERMINATE_PL` 一律当终止，而 VM 在 MovieObject 上下文的实际行为是：

- `JUMP_TITLE`：跳到目标 title 的 MovieObject 继续执行（`vm.ts:427-436`），**有后继**。图上缺 `sequence` 边会让静态可达性把目标 title 判成不可达，覆盖统计随之失真。
- `LINK_PI` / `LINK_MK` / `TERMINATE_PL`：在 PlayList 上下文终止该流；在 MovieObject 上下文不作为流终止符。
- `CALL_TITLE`（`vm.ts:437-458`）：设置 `pendingTitleCall` 后 suspended，没有 continuation。桥返回 `MEDIA_UNAVAILABLE` 时 `handleEvent` 因找不到等待记录而丢弃（`HDMV_IGNORED_EVENT`），VM 永久停在 suspended。

决策：

- `terminatesFlow` 改为 `(opcode, context)` 两参数，`context: "object" | "playlist"`；MovieObject 上下文只有 `TERMINATE_PL` 之外的真终止码才终止，`LINK_*` 不终止。
- `buildNavigationGraph` 为 `JUMP_TITLE` 生成指向目标 entry 的 `sequence` 边（target = 目标 title 的首个 program），边来源标注为 `jump-title`，与 `jump` 边区分。
- `CALL_TITLE` 当前建立 VM 标题调用上下文并挂起，发出 `TITLE_SEARCH`；浏览器动作分发器调用 `selectTitle()` 恢复 VM。任务应补齐该路径的目标不可用/错误行为与诊断，不额外引入重复的桥端 `responseTo` 事件路径。
- 被上下文忽略的指令（`PLAY_PL*` / `LINK_*` 在错误上下文）必须记 `HDMV_OPCODE_CONTEXT_SKIPPED`（info 级），替代当前静默 `return`（`vm.ts:460-470`）。没有诊断的"按了没反应"是排查成本最高的一类缺陷。

### 4. `SourceRef` 一条规则贯通到底（D12）

基线 §2 已规定 `SourceRef` 含"相对 BDMV 根的 `path`、`origin`、文件字节偏移"。当前交付层三处违反：

| 位置 | 现状 | 改为 |
| --- | --- | --- |
| `apps/cli/src/index.ts:194-204` | `{ path: "source/structural", origin: "primary", byteOffset: "0" }`，诊断 `sourcePath/offset` 置 `null` | 复制 `entry.source` 与诊断原始位置；无位置时保持 `null` 并保留 `stage` |
| `apps/cli/src/index.ts:303` | 指令来源写成 `<MovieObject>` | 保留原始 `source.path` + `offset` + `instructionIndex` |
| `packages/igs/src/extract.ts:178` | `BDMV/STREAM/.m2ts`（clipId/pid 丢失） | 由调用方传入真实 path/clipId/pid/origin；诊断直接携带 `SourceLocation` |

**路径约定锁定为"相对 BDMV 根"**（`PLAYLIST/00001.mpls`，不带 `BDMV/` 前缀）。理由：基线 §2 原文即如此，且 parser 与 `bdmv-io` 的 containment 判定都以 BDMV 根为基准。`BDMV/` 前缀只在用户可见的输出文案里出现。这条约定写入 `disc-contracts` 的 requirement，避免 parser/CLI 两种写法继续混用。

### 5. 媒体桥的生命周期按 `responseTo` 收全（D13）

三处缺口分开修：

- **初始 VM 与媒体解耦**：`browser.ts:164-173` 把 `runTurn()` / First Play 放在 `data.media && video && audio` 条件内，无媒体包因此不执行 MovieObject。改为无条件执行初始 `runTurn`，媒体播放作为其产生的 action 处理。这条是菜单正确性的前提——没有媒体的包也必须跑初始化。
- **背景媒体生命周期**：`MenuLoopPlaybackBridge` 当前已有 `ended` 监听和按动作回执的实现。该能力列为回归验收，不再描述为缺失代码；浏览器真实播放与错误路径的证据按 M6 任务记录。
- **`loop=false` 结束语义**：当前代码回 `MEDIA_ENDED`，不引入 `MEDIA_HELD`。运行时已有 `ended` 监听；真实浏览器结束行为仍属于待验证证据。
- **PSR1 写回**：当前主音轨切换成功及回滚路径均调用 `systemWrite(1, streamNumber)`。保留既有测试并在回归中验证，不再视为待实现功能。
- **命中几何统一**：当前 `MenuController.hit()` 仍只用 `states.selected` 的 bounds，而 adapter 允许只有 `normal` 图形的按钮可用，造成可聚焦但不可点。实现与验收仍待完成。

### 6. builder 依赖产物，不依赖源码树（D7）

`packages/package-builder/src/index.ts:127-128` 用 `resolve(import.meta.dirname, "../../runtime-web/src/browser.ts")` 取入口，并把 `@bdmv2web/hdmv` alias 到 `../../hdmv/src/index.ts`。在 monorepo 内成立，在 `dist` 发布布局下必然断（`src/` 不在包内）。

改动：`runtime-web` 新增 `build:browser`（esbuild 打包 `src/browser.ts` → `dist/browser-entry.js`，IIFE、ES2020），`package.json` 的 `exports` 增加 `"./browser-entry"`；builder 改为解析该子路径，删除两处相对路径 alias。补 `files: ["dist"]` 白名单，避免发布带上 `src` 与测试。

验收：`grep` builder 产物与源码中不再出现 `runtime-web/src`、`hdmv/src`；并加一条单测用 `node:fs` 拦截读取 `**/src/*.ts` 的路径（若被读取即失败）。

### 7. 基准先行，修复按数据排序（D5=B）

五处热点目前只有静态判断。先建基准再改，避免"感觉慢就重构"：

- `packages/bdmv-parser`：`buildGraph` 用 N = 200 / 1000 / 5000 个 PlayItem 的合成 disc；
- `packages/igs`：`PesAssembler.append` 用 184 B × {1000, 10000, 50000} 个 TS 包拼 1 MB / 8 MB PES；
- `packages/bdmv-parser`：`choose()` 的主/备比较用 8 MB 缓冲；
- `packages/media-export`：`directoryBytesExcluding` 在 10k 文件目录上单次耗时（决定轮询间隔）；
- `packages/bdmv-io`：`buildInputFileTable` 在 1000 文件上相对"一次性 root 解析"的耗时差。

每项输出 `{ case, n, ms, rss }` 到 `test-data/bench/<git-sha>.json`（不入库，路径加入 `.gitignore`）。修复只针对实测呈超线性或占比显著的项，每项独立提交并附前后对比；没有数据的项保留现状并写入 change 的 `benchmark.md`。

本 change 不设 CPU 百分比之类的产品级目标（缺少稳定测量环境），只设**回归门限**：同一 case 相对记录基线退化 > 20% 视为需要说明。

## Risks / Trade-offs

- **旧包兼容**：旧包可能含有当前不再使用的清单字段；读取侧忽略未知字段，重新生成报告时使用当前格式。
- **M6 取消勾选会让"发布完成"后退**：当前勾选与实际证据不符，取消后以实际证据为准。
- **`CALL_TITLE` 改 continuation 会动 `PreviewPlaybackBridge` 与 `MenuLoopPlaybackBridge` 的接口**：两个桥都要改，且 `browser.ts` 的 TITLE_SEARCH 分支与它语义重叠——本 change 只保证"不可用能解除等待"，不合并两处语义（合并属更大重构）。
- **`SourceRef` 改为真实路径后输出体积上升**：每条指令带 path/offset 会让 IR 变大。用"同文件短索引 + 文件表"记路径可缓解，但会增加一层间接。先按可读性优先（逐条 path），体积问题在有实测数据后处理。
- **系统交接**：当前正片动作使用 URL Protocol。M6 需记录实际请求、目标 M2TS 和系统播放器观察；没有播放器回传时不声称实际播放状态。

## Migration Plan

1. **产物兼容**：旧包中的未知清单字段由读取侧忽略；重新生成的报告使用当前格式。
2. **IR schema**：`SourceRef` 的 `path` 约定从"两种写法混用"收敛为"相对 BDMV 根"。旧 IR（`source/structural`、`<MovieObject>`）在 `parseDiscIR` 时以 `SCHEMA_SOURCE_PLACEHOLDER` 警告拒绝，不静默接受——旧的空跑 IR 必须重新 `extract`。
3. **`dist` 布局**：`runtime-web` 的 `build` 顺序变为 `tsc → build:browser`；`package-builder` 的构建依赖前者，`pnpm -r build` 的拓扑顺序由 workspace 依赖保证（两者已有依赖关系）。
4. **测试夹具**：`IgsButton` 的 `numericSelectValue` 已在第 1 批补；本 change 若调整 `SourceRef` 形状，需同步 `packages/test-fixtures` 的 golden。

## Verification / Exit Criteria

1. **一致性**：`grep -rn "maxCallDepth: 64\|maxQueueDepth: 256" packages apps` 无命中；`grep -rn "source/structural\|<MovieObject>" packages apps` 无命中；产品代码、测试、缓存清单和生成脚本不记录文件内容校验值。参考缓存清单只记录上游仓库地址和固定 revision，fetch 脚本按该 revision clone/check out。
2. **行为**：见 `tasks.md` 每条的正反例，尤其 `JUMP_TITLE` 后继可达、`CALL_TITLE` 不可用能解除等待、无媒体包执行初始 VM、非循环背景 `ended` 后恢复、PSR1 随选轨更新。
3. **诚实**：`verify-offline-release` 的包审计和浏览器证据任务只有在当前验收完成后才勾选；`offline-delivery-assurance` 不承诺字节级内容校验；README 描述系统播放器交接边界与当前未验证项。
4. **基准**：`benchmark.md` 记录每项 case 的机器/版本/样本/前后数据；修复项均有对应数据。
