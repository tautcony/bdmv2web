# Phase 2：CLI 与 IGS 包（07b287b..19d323b）

返回 [index](../index.md) · checklist 见 [../fix-checklist.md](../fix-checklist.md)

审查范围：apps/cli/src（index.ts、index.test.ts、tsconfig.dev.json）、packages/igs/src（extract、igs、png、transport、types）与 packages/igs/test。覆盖审查期间落盘的 19d323b（含 findTopMenuPlaylist 的 fallbackTarget/preMenuPlaylistIds 增量与 ICS 分片重组）。已运行验证：packages/igs vitest（39 通过）、apps/cli tsc + vitest（35 通过）、igs 包 tsc 通过。

## Findings

### P1-2 fallbackTarget 按引用共享 preMenuPlaylistIds 数组，fallback 播放列表自身被静默吞掉
- 位置：`apps/cli/src/index.ts:645-647`（`fallbackTarget ??= { ..., preMenuPlaylistIds }` 后紧跟 `preMenuPlaylistIds.push(...)`）；消费链 `apps/cli/src/index.ts:857` → package-builder → `packages/runtime-web/src/browser.ts:289`（preMenu 分支）
- 触发：Top Menu VM 链上没有任何 playlist 命中 uiModel-0 场景（`menuSceneKeys`），链在 64 步内耗尽或无 TITLE_SEARCH，返回 fallbackTarget。
- 影响：fallbackTarget 捕获活数组引用，赋值后立即把 fallback 播放列表自身 ID push 进去，`fallbackTarget.preMenuPlaylistIds` 恒包含自身。该 playlist 的命中场景必为 uiModel=1（否则早已命中 `menuTarget`），不进 `menuPlaylistIds`；运行时分支顺序 menuPlaylistIds → preMenuPlaylistIds → external（browser.ts:248/289/291），其 `PLAY_PLAYLIST*` 动作在 preMenu 分支被 `MEDIA_ENDED` 静默完成：既不本地播放也不交外部播放器。主 `scene` 是 uiModel-1 popup 构图被当顶层菜单渲染。改动前此类盘以 `MENU_PLAYLIST_NOT_RESOLVED` 失败（旧代码返回 undefined）。
- 修复方向：快照 `preMenuPlaylistIds`，或 fallback 路径排除自身；更根本的是 fallback 命中的 playlist 若无 uiModel-0 场景应保持硬失败。
- 证据：静态路径 + 分支顺序核对；置信度机制高、触发频率低。

### P2-4 ICS continuation 拼接无 limits 约束
- 位置：`packages/igs/src/igs.ts:126`（`current.ics = appendIcsFragment(...)`）、`:70-81`
- 触发：畸形流在 END 前发送大量 continuation ICS 段（每段 ≤64KB，段数无上限）。
- 影响：`appendIcsFragment` 无 `Limits` 检查（对比 ODS 重组有 `maxReassemblyBytes` 逐次检查），每次追加全量拷贝（O(n²)）。探针实测：200 个 60KB fragment 累积约 12MB，全程零诊断。
- 修复方向：追加循环按 limits 检查累计长度并抛 `LIMIT_EXCEEDED`。
- 证据：测试复现（探针）+ 静态路径；置信度高。

### P2-5 PesAssembler.end() 新完成的 EOF 包被唯一调用方丢弃
- 位置：`packages/igs/src/transport.ts:283-296`（`end()` 返回完成包）、`packages/igs/src/extract.ts:134`（`pes.end();` 返回值被忽略）
- 触发：流末尾存在 PES_packet_length=0（unbounded）的 pending PES。
- 影响：end() 产出的 PesPacket 不进 `consumeSegment`，payload 字节不计入 `streamByteLengths`/MNU 导出；若含前一段残段尾巴会误报 residual bytes。原先必有的 `PES_TRUNCATED_EOF` warning 消失，改变 status 计算（warning→partial）输入。功能改动未接线。
- 修复方向：extract.ts 消费 end() 返回值，或回退为不发包但保留诊断。证据：静态路径；置信度高。

### P2-6 共享 PGS 轨道缓存导致后续引用的时间戳偏移取第一条
- 位置：`apps/cli/src/index.ts:244-249`（`extractReachablePgsTracks`，`key = clipId:pid`，`timestampOffset90k: BigInt(reference.sourceIn90k)`）
- 触发：同一 clip+pid 被多个 PlayItem 以不同 `inTime45k`/`sourceIn90k` 引用。
- 影响：第二次起复用缓存 track，display set 时间戳按第一条引用偏移，后续引用条目自身的 `sourceIn90k` 被忽略，sup 呈现时间对第二个引用点不正确。
- 修复方向：去重键加入 `sourceIn90k`，或按引用分别偏移后共享 display sets。
- 证据：静态路径；机制置信度高，实际触发取决于盘面结构。

### P2-7 extract 产物 scenes.json 在 schemaVersion 不变下移除 `indices` 字段
- 位置：`apps/cli/src/index.ts:519`（`objects` 映射移除 `indices`，替换为 `indicesLength`）
- 触发：外部流程按 `schemaVersion: "1.0"` 解析 `objects[].indices`。
- 影响：同版本载荷形状变化。仓库内 grep 无 scenes.json 消费者读取 `indices`（运行时用内存对象与 pngBytes），当前无内部破坏；动机（避免大菜单超 JSON 字符串限制）成立。
- 修复方向：升级 `schemaVersion` 或在 manifest limitations 声明字段收缩。证据：静态 + grep；置信度中。

### P2-9 preMenuPlaylistIds 的 CLI→package→runtime 链路无端到端测试
- 位置：`apps/cli/src/index.ts:645-647,857`；`packages/runtime-web/src/browser.test.ts:241`（手写 `preMenuPlaylistIds: [13]`）
- 影响：CLI 侧生成 preMenuPlaylistIds 与 menuPlaylistIds 的交互（含 fallback 自包含）无 CLI 级或集成测试；P1-2 正是该缺口漏出的。
- 修复方向：CLI 测试用多 PlayItem/logo 链 fixture 断言 disc-data.js 中 preMenuPlaylistIds 内容及运行时分支行为。

### P2-8 IGS_UNSUPPORTED_EFFECT 诊断移除与保留的 limitation 文案不一致
- 位置：`packages/igs/src/png.ts:6-49`（移除该诊断及 `scene.complete = false`）、`apps/cli/src/index.ts:491`（manifest limitations 仍写 "IGS animation and visual effects are not fully verified"）
- 影响：含 enter/exit effects 的场景从 `complete:false` + warning 变为 `complete:true` 且无 warning，改变 status/delivery 决策输入；manifest 仍声明效果未完全验证——诊断面与声明面结论不同。effects 结构化数据已解码（duration90k/paletteId/crop），渲染侧实际呈现需确认。
- 修复方向：runtime 已实现效果呈现则更新 manifest limitation；未实现则保留等价 warning。置信度中。

## INFO / 观察项

- `transport.ts:290`：`declared>0 && length>=declared+6` 的 EOF 分支在现有 `push()` 逻辑下不可达，静默无实际影响。
- `hdmv-navigation-packet-fixtures.test.ts`：6/8 例改 `renderAssets:false` 缩短运行时间，PNG 渲染覆盖收窄到 tamako 00005 与 battle-royale-uhd 00005；`validateIgsSceneAssets` 与渲染路径诊断等价，可分离性约束未破坏。
- `apps/cli/tsconfig.dev.json`：未被任何 package.json script 引用；`rootDir:"../.."` 仅可作 `--noEmit` 用途。
- 进度回调（onMediaProgress）：按 assetPath 重置节流、duration=0 百分比归 0、TTY 分支正确；ffmpeg 失败经 `exportMenuLoopMedia` → `buildMenuPackage` → `transaction.abort()`，无半成品输出（abort 语义静态确认）。
- `menuLoopMediaInput` 的 `loopBackground` 由 `stillMode === 2 || (...)` 标记 still 菜单为循环背景，与 README 生成文案一致。
- PGS `extract --type sup` 只保留 sup/tracks.json 并 unlink .sup：与 manifest files 列表一致。

## 硬约束核查（未命中）

- 未新增 SHA-256/指纹/文件大小校验（manifest `byteLength` 仅记录字段，非 gate）。
- 提取与渲染可分离性保持；fixtures/测试/日志无真实盘标题、机器挂载路径、file:// URL（诊断经 `safeDiagnosticMessage` 脱敏）。
- src 无样例盘名绑定；注释/状态消息为直接描述；`--mode` 移除后对比式断言与 modeSource 兜底逻辑被清理。

## 残留疑点

1. ICS continuation 9 字节公共头假设仅由合成测试自洽验证（测试自己按 9 字节头构造分片）；真实盘是否覆盖分片 ICS 未证实。若真实 continuation 头不含 composition_state 字节，`fragment.subarray(9)` 会错位且合成测试无法发现。
2. `parseEffectSequence` 的 crop（flags&0x80）/forcedOn（flags&0x40）位含义仅由合成 fixture 验证，未与参考实现逐元素比对。
3. 19d323b 为审查过程中落盘的最终状态；其后的新改动不在覆盖范围。

## 漏检复盘

输出写入失败与半成品（staging transaction + abort 覆盖）、命令参数校验反路径（未知选项/多余参数/空值均失败）、路径特殊字符（safe id、safeAssetLanguage、escapeRegExp）、exit code 语义、fixtures 渲染收窄的诊断等价性——均排查未命中。`findTopMenuPlaylist` 64 步上限对深层 VM 链是否充足无法静态判定，留作观察项。
