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

## Goals / Non-Goals

**Goals:** 每个事实只有一个来源；已声明的契约要么成立、要么显式标记未验证；性能优先级由数据决定。

**Non-Goals:** 实现字节级完整性校验（D9=C 明确不做）；改本地桥的请求方式与 token 位置（D6）；实现 `standalone-full`；引入 CI（D1=A）；BD-J 执行；把 `maxCallDepth` 做成真正的多帧栈（结构改动，单列后续 change）。

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

本 change 选择**如实标注**而不是改结构：字段名保留（`Limits` 是对外契约，改名会波及 schema 与配置），在 `IMPLEMENTATION_BASELINE` §5 与 `docs/hdmv-support.md` 写明"当前为 CALL 开关（0 禁用），真正的深度限制需多帧调用栈，列为后续 change"。同时补一条测试锁定"`maxCallDepth` 为 0 时 `CALL_OBJECT` 报 `VM_CALL_DEPTH_LIMIT`"，防止改动时无声漂移。

若后续要做真深度上限，必须同时改 `callStack` 结构、`MenuCheckpoint` 与 `libbluray` 单帧行为的对照结论——那是独立 change，不在本批夹带。

### 2. 证据链选择"减承诺"，而不是"补实现"（D9=C）

补实现的工作量并不大，但会牵动三处 schema、两个包的写入路径、全部既有产物的重算，且无法在没有独立参考的情况下证明"重算的指纹是对的"。相比之下，当前最大的风险是**看起来已验证**：`compatibility.json` 有 `payloadFingerprint` 字段、`M6 1.1/4.3` 已勾选、报告写"篡改会失败"。

因此本 change 做减法：

1. 删除 `packages/test-runner/src/package-audit.ts:337` 及所有提前返回的 `payloadFingerprint: null`；从 `AuditResult` 类型、报告/汇总类型、产物输出（`compatibility.json` / `manifest.json`）中移除该字段；`bdmv-io` 的导出函数 `payloadFingerprint()` 一并删除（无调用方，留在 git 历史）。实测影响 **13 个 `.ts` 文件**，清单见 `tasks.md` B.1 表。
   **注意**：`packages/core/schema` 下只有 `disc-ir.schema.json`，不含该字段——不存在"改 core schema"这一步。
2. 删除 `packages/package-builder` 的 `hashGeneratedPayload` 与其写入点；不再生成"看起来像校验值"的字段。
3. 浏览器证据：`mismatch` 列表保持 `profileFingerprint / mode / matrixFingerprint / environmentFingerprint`（即现状事实），并在 check message 中显式写 `artifact hash recorded, not re-verified`；不新增字段表达同一件事。
4. `compatibility.json` 的 `toolVersion` / `runtimeVersion` / `diagnostics` 缺口（构建侧缺前者、validate 侧缺后两者）**只记录为实现缺口**，不修（属 D9=C 的边界），写入 `verify-offline-release` 的 tasks 未完成项。
5. M6 tasks 1.1、4.3 取消勾选；`offline-delivery-assurance` spec 中"资产被篡改 → 失败"的场景改为"未实现完整性校验 → 记 `not-verified` 并阻止 complete"。

连带影响：`packages/test-runner/src/index.test.ts:68`（断言"不检查 hash"）与 `apps/cli/src/index.test.ts:352` 需改为断言"审计结果不含该字段"。这两个断言原本把缺陷固化成了预期，必须一起改，否则减法做不干净。

**为什么不保留字段只写 null**：字段存在即承诺。下游（含未来的第三方集成）会读它、会以为是校验值。删字段 + 文档说明的成本远低于"字段在但永远为 null"的解释成本。

### 3. 导航图按"上下文"而不是"opcode 黑名单"判定（D11）

`graph.ts:63` 的 `terminatesFlow` 把 `JUMP_TITLE` / `LINK_PI` / `LINK_MK` / `TERMINATE_PL` 一律当终止，而 VM 在 MovieObject 上下文的实际行为是：

- `JUMP_TITLE`：跳到目标 title 的 MovieObject 继续执行（`vm.ts:427-436`），**有后继**。图上缺 `sequence` 边会让静态可达性把目标 title 判成不可达，覆盖统计随之失真。
- `LINK_PI` / `LINK_MK` / `TERMINATE_PL`：在 PlayList 上下文终止该流；在 MovieObject 上下文不作为流终止符。
- `CALL_TITLE`（`vm.ts:437-458`）：设置 `pendingTitleCall` 后 suspended，没有 continuation。桥返回 `MEDIA_UNAVAILABLE` 时 `handleEvent` 因找不到等待记录而丢弃（`HDMV_IGNORED_EVENT`），VM 永久停在 suspended。

决策：

- `terminatesFlow` 改为 `(opcode, context)` 两参数，`context: "movie-object" | "playlist"`；MovieObject 上下文只有 `TERMINATE_PL` 之外的真终止码才终止，`LINK_*` 不终止。
- `buildNavigationGraph` 为 `JUMP_TITLE` 生成指向目标 entry 的 `sequence` 边（target = 目标 title 的首个 program），边来源标注为 `jump-title`，与 `jump` 边区分。
- `CALL_TITLE` 建立 continuation：`{ actionId, generation, waitFor: "started" }` 记入等待表，`selectTitle` 的结果（`started` / `unavailable`）都按 `responseTo` 恢复。桥端只在 `waitFor` 匹配时回复，不再对任意事件尝试 `handleEvent`。
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
- **桥补 `ended` / `error` / `abort`**：`MenuLoopPlaybackBridge`（`runtime-web/src/index.ts:496-588`）当前只听 `loadeddata`/`started`。非循环背景的 `PLAY_PLAYLIST` 以 `waitFor: "ended"` 等待，永远收不到事件 → 永久 suspended。补监听并按 `responseTo` 回执。
- **`loop=false` 结束语义**：选择回 `MEDIA_ENDED`（不引入 `MEDIA_HELD`）。理由：product 上"背景停最后一帧"需要新的等待语义与 UI 约定，属新能力；当前先让 VM 不挂死，画面是否停在末帧由渲染层自然结果决定（视频元素 `ended` 后保持末帧）。若后续产品要求显式 `HELD` 状态，单列 change。
- **PSR1 写回**：`confirmedPrimaryAudioStream` 只在构造时读 PSR1（`index.ts:512-513`），选轨后不写回，`registers.ts` 的 PSR1 默认是 `0xff`。改为选轨成功后 `systemWrite(1, psrStreamNumber)`，并保证该写入走"系统事件授权入口"而不是程序写入路径（基线要求程序不能写只读 PSR）。
- **命中几何统一**：`MenuController.hit()` 只用 `states.selected` 的 bounds（`index.ts:292`），而 `igs-adapter` 允许只有 `normal` 的按钮被启用（`igs-adapter.ts:109-118`），造成"可聚焦不可点"。改为按"可用性判定"决定命中集：可用即用 `selected ?? normal` 的几何。

### 6. builder 依赖产物，不依赖源码树（D7）

`packages/package-builder/src/index.ts:127-128` 用 `resolve(import.meta.dirname, "../../runtime-web/src/browser.ts")` 取入口，并把 `@bdmv2web/hdmv` alias 到 `../../hdmv/src/index.ts`。在 monorepo 内成立，在 `dist` 发布布局下必然断（`src/` 不在包内）。

改动：`runtime-web` 新增 `build:browser`（esbuild 打包 `src/browser.ts` → `dist/browser-entry.js`，IIFE、ES2020），`package.json` 的 `exports` 增加 `"./browser-entry"`；builder 改为解析该子路径，删除两处相对路径 alias。补 `files: ["dist"]` 白名单，避免发布带上 `src` 与测试。

验收方式不用"临时删 `src`"这种破坏性操作，改为断言：`grep` builder 产物与源码中不再出现 `runtime-web/src`、`hdmv/src`；并加一条单测用 `node:fs` 拦截读取 `**/src/*.ts` 的路径（若被读取即失败）。

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

- **删字段会打断既有产物**：旧包的 `manifest.json` / `compatibility.json` 仍带 `payloadFingerprint`。读取侧按"未知字段忽略"处理即可，但 `validate` 必须不再写它——需要一个迁移说明（见下）。
- **M6 取消勾选会让"发布完成"后退**：这是有意为之。当前勾选本身就是错的；退回去比留着假通过安全。
- **`CALL_TITLE` 改 continuation 会动 `PreviewPlaybackBridge` 与 `MenuLoopPlaybackBridge` 的接口**：两个桥都要改，且 `browser.ts` 的 TITLE_SEARCH 分支与它语义重叠——本 change 只保证"不可用能解除等待"，不合并两处语义（合并属更大重构）。
- **`SourceRef` 改为真实路径后输出体积上升**：每条指令带 path/offset 会让 IR 变大。用"同文件短索引 + 文件表"记路径可缓解，但会增加一层间接。先按可读性优先（逐条 path），体积问题在有实测数据后处理。
- **D6 不做**：本地桥仍是 GET + token 在 URL，审计仍无法归因该调用。这是已知残余风险，写入 README 的"已知限制"，不假装已解决。

## Migration Plan

1. **产物兼容**：`payloadFingerprint` 移除后，旧包 `validate` 不报错（忽略未知字段），但 `compatibility.json` 会因 schema 变化重新生成；旧证据（`browserEvidence`）若引用 `payloadFingerprint` 绑定，按"绑定范围不含 payload"重新判定，不追溯失效。
2. **IR schema**：`SourceRef` 的 `path` 约定从"两种写法混用"收敛为"相对 BDMV 根"。旧 IR（`source/structural`、`<MovieObject>`）在 `parseDiscIR` 时以 `SCHEMA_SOURCE_PLACEHOLDER` 警告拒绝，不静默接受——旧的空跑 IR 必须重新 `extract`。
3. **`dist` 布局**：`runtime-web` 的 `build` 顺序变为 `tsc → build:browser`；`package-builder` 的构建依赖前者，`pnpm -r build` 的拓扑顺序由 workspace 依赖保证（两者已有依赖关系）。
4. **测试夹具**：`IgsButton` 的 `numericSelectValue` 已在第 1 批补；本 change 若调整 `SourceRef` 形状，需同步 `packages/test-fixtures` 的 golden。

## Verification / Exit Criteria

1. **一致性**：`grep -rn "maxCallDepth: 64\|maxQueueDepth: 256" packages apps` 无命中；`grep -rn "source/structural\|<MovieObject>" packages apps` 无命中；`grep -rn "payloadFingerprint" packages apps --include=*.ts` **无命中**（代码内不保留"迁移说明"式引用）；`test-data` 内仅 `BDMV-menu.backup-2026-11-04` 保留（作为旧包兼容夹具）。
2. **行为**：见 `tasks.md` 每条的正反例，尤其 `JUMP_TITLE` 后继可达、`CALL_TITLE` 不可用能解除等待、无媒体包执行初始 VM、非循环背景 `ended` 后恢复、PSR1 随选轨更新。
3. **诚实**：`verify-offline-release` 的 1.1 / 4.3 未勾选；`offline-delivery-assurance` 的篡改场景为 `not-verified` 语义；README 有"未实现完整性校验"与"本地桥 token 在 URL"两条已知限制。
4. **基准**：`benchmark.md` 记录每项 case 的机器/版本/样本/前后数据；修复项均有对应数据。
