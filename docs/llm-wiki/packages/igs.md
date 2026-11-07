# `@bdmv2web/igs`

从 M2TS 传输流里恢复 IGS（交互图形）菜单：重组 TS/PES，拼装 ICS/PDS/ODS 段，产出场景与无损 PNG 元素。

## 文件与职责

| 文件 | 内容 |
| --- | --- |
| `src/transport.ts` | `M2tsPacketReader`（192 字节源包）、`PsiAssembler`（PAT/PMT）、`PesAssembler`、`decodeTimestamp`、`source()` |
| `src/igs.ts` | `parseSegments`、`consumeSegment`、`decodeRle`、`createIgsState`、`IgsError` |
| `src/png.ts` | `renderSceneAssets`、`renderIgsAssets`、`validateIgsSceneAssets`、`encodeRgbaPng` |
| `src/extract.ts` | `extractIgsScenes`（基于 `ParsedDisc`）、`extractIgsFromChunks`（任意分块输入） |
| `src/types.ts` | `IgsScene`、`IgsPage`、`IgsButton`、`IgsAsset`、`IgsExtraction`、`IgsOptions` |

## 公开接口

```ts
extractIgsScenes(disc: ParsedDisc, options?: IgsOptions & { table?: InputFileTable }): Promise<IgsExtraction>
extractIgsFromChunks(clipId, chunks: AsyncIterable<Uint8Array>, expectedPidCues?, options?): Promise<IgsExtraction>
parseSegments(input, baseOffset?, residual?, clipId?, pid?, pts?): SegmentParseResult
consumeSegment(state, segment, clipId, pid, pts, packetOffset, pesOffset, segmentFileOffset, limits?)
decodeRle(data, width, height, limits?): Uint8Array
renderSceneAssets(scene): { assets: IgsAsset[]; diagnostics: IgsDiagnostic[] }
parseIgsMnu(data, options?): IgsExtraction
encodeRgbaPng(width, height, rgba): Uint8Array
```

`IgsOptions`：

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `limits` | `DEFAULT_LIMITS` | 读窗口、重组、像素上限 |
| `chunkSize` | `limits.maxReadWindowBytes`（默认 8 MiB） | 读文件块大小 |
| `renderAssets` | `true` | 关闭后只解析场景，不生成 PNG（`extract --type hdmv` 用） |
| `captureStreams` | `false` | 保留 igstools 兼容 `.mnu` 字节（`export` 用） |
| `table` | 自动发现 | 复用已验证的输入文件表 |

`parseIgsMnu` 接受每段带 `IG` + PTS + DTS 头的 MNU，也接受旧版每 PES 一个 `IG` 头、后续段复用 PTS 的形态。

## 提取流程

1. 遍历 `ParsedDisc.playlists[].playItems`。
2. 判定 IGS 载体：
   - MPLS STN 中 `streamType === 1` 且编码为 IG 的主路径流；
   - CLPI 中 `codingType === 0x91` 的流（MPLS 未声明时补充）；
   - `streamType === 2` 的 SubPath 流，按 `subPathId`/`subClipId` 解析到实际 clip。
3. clip 去重；从 `disc.graph` 取 `clip:<id>` 的 `STREAM/xxxxx.m2ts` 路径，缺失 → `BDMV_MISSING_STREAM`。
4. `readFileChunks` 流式读；`M2tsPacketReader` 校验 192 字节包与同步字节。
5. `PsiAssembler` 解析 PAT/PMT；`PesAssembler` 按 PID 拼 PES，`decodeTimestamp` 解 33 位 PTS 并处理回绕/时间域重置。
6. `parseSegments` 在 PES 载荷上切段（3 字节头：类型 + 16 位长度），残片留到下一块。
7. `consumeSegment` 按段类型更新流状态：

| 段 | 作用 |
| --- | --- |
| `0x14` PDS | 调色板，按 `(id, version)` 缓存；缺省索引渲染为全透明 |
| `0x15` ODS | 图像对象，支持跨段续传；超过 `maxObjectPixels` 在分配前拒绝 |
| `0x18` ICS | 组合/页/BOG/按钮/效果；完整后才提交场景 |
| `0x80` END | 结束当前 Display Set |

8. 场景完整后才 `complete: true`；损坏数据、未解析对象/调色板、未完成对象序列都使其不完整。
9. `renderAssets` 时对每个被引用对象按当前调色板做 RLE 解码 → RGBA → PNG。
10. 汇总 `status`：有 `error` 且无场景 → `failed`；有 `error` 或有 `warning` 或无场景 → `partial`；否则 `complete`。

## 场景模型

| 结构 | 关键字段 |
| --- | --- |
| `IgsScene` | `id`、`clipId`、`pid`、`compositionNumber/State`、`width/height`、`frameRateCode`、`timeDomain`、`pts90k`、`uiModel`、`compositionTimeout90k`、`selectionTimeout90k`、`rawIcs`、`pages`、`objects`、`palettes`、`complete`、`source` |
| `IgsPage` | `id`、`version`、`uoMask`、`defaultSelectedButtonId`、`defaultActivatedButtonId`、`paletteId`、`buttons`、`bogs`、`animationFrameRateCode`、`effects.{enter,exit}` |
| `IgsButton` | `id`、`numericSelectValue`、`x/y`、`autoAction`、`neighbors`、`visuals.{normal,selected,activated}`（对象区间 + 音效）、`commands[]`（12 字节 + `recordIndex` + `sourceOffset`） |
| `IgsAsset` | `id`、`relativePath`、`mimeType: "image/png"`、`width/height`、`pngBytes`、`objectId/Version`、`paletteId/Version`、`source`、`colorConversion: "bt709-limited-round-nearest"` |

`uiModel === 1` 表示弹出菜单组合，`0` 表示常显菜单。场景 ID 由 clip/pid/组合号派生，跨层保留。

`0xffff` / `0xfffe` 按钮默认值是哨兵（“无选中” / “激活当前选中”），不是悬空引用；按此处理才不会误报 `IGS_INVALID_BUTTON_REFERENCE`。

## 诊断码

| 码 | 严重性 | 含义 |
| --- | --- | --- |
| `TS_SYNC_LOST` | error | 不是受支持的 192 字节源包布局 |
| `TS_CONTINUITY_ERROR` | error | 连续计数异常；丢弃受影响的待组装单元 |
| `TS_DUPLICATE_PACKET` / `TS_TRANSPORT_ERROR` / `TS_TRUNCATED_PACKET` / `TS_INVALID_ADAPTATION_*` | warning/error | 包级异常 |
| `PSI_CRC_INVALID` / `PSI_INVALID_LENGTH` / `PSI_INVALID_POINTER` / `PSI_INVALIDATED` | warning/error | PAT/PMT 异常；损坏的 section 丢弃 |
| `PES_INVALID_HEADER` / `PES_INVALID_TIMESTAMP` / `PES_TRUNCATED_EOF` / `PES_INVALIDATED` | warning/error | PES 头/时间戳问题 |
| `IGS_INVALID_SEGMENT` | error | 段长度或结构非法 |
| `IGS_INCOMPLETE_OBJECT` / `IGS_UNCOMPLETED_DISPLAY_SET` / `IGS_ORPHAN_END` | warning | 对象/显示集未收齐 |
| `IGS_INVALID_RLE` / `IGS_RLE_OVERRUN` / `IGS_RLE_TRUNCATED` | error | RLE 越界或截断 |
| `IGS_INVALID_BUTTON_REFERENCE` / `IGS_PID_CONFLICT` / `IGS_PID_UNRESOLVED` | error | 引用或 PID 不一致 |
| `IGS_STREAM_INVALIDATED` / `IGS_TIME_DOMAIN_RESET` | warning/info | 传输损坏或时间域重置 |
| `IGS_UNSUPPORTED_SEGMENT` / `IGS_NO_DISPLAY_SETS` | warning | 未支持段类型 / 没有场景 |

## 边界（与 `docs/support/igs-support.md` 一致）

- BT.709 limited-range、round-to-nearest、保留 alpha；只在固定向量与八个包级夹具上对照过 igstools。
- 效果、动画、窗口裁剪、组合生命周期规则未完整验证；未知效果保留原始字节并让场景不完整。
- 稀疏调色板按 libbluray 的零初始化 256 项表处理：缺省索引为全透明。
- 不解析 PGS（`0x90`），那是 `media-export` 的职责。

## 测试

| 文件 | 覆盖 |
| --- | --- |
| `packages/igs/test/transport.test.ts` | 192B 包、PSI/PES、PTS 回绕、连续性错误 |
| `packages/igs/test/extraction.test.ts` | 段拼装、版本缓存、RLE、场景完整性 |
| `packages/igs/test/hdmv-navigation-packet-fixtures.test.ts` | 打包的 IG 包夹具（`test-data/fixtures/hdmv-navigation/`） |
| `packages/igs/test/igs-reference-element-summary.test.ts` | 重算 8 个 clip、891 个 asset 的 RGBA 渲染，与 pinned igstools 参考 PNG 的逐元素像素值和通道分布比对；golden 在 `test-data/baselines/igs-reference-element-summary.json` |
| `packages/igs/test/libbluray-igs-baseline.test.ts` | 对 8 个 clip 的 display set、ICS 页面/BOG/按钮/进入退出效果、256 项调色板与 872 个对象 RLE 与 libbluray 1.5.0 `graphics_processor_decode_ts()` 输出逐项比对；golden 在 `test-data/baselines/libbluray-1.5.0-igs-baseline.json` |
| `packages/igs/test/m1-m2-m3.integration.test.ts` | 解析 → 场景 → 命令的来源交接 |
| `packages/igs/test/real-igs.test.ts`、`tamako-*.test.ts` | 工作区本地样本；数据缺失时跳过 |

跨包一站式覆盖见 `apps/cli/src/synthetic-all-features.test.ts`：两页多 BOG 菜单、effect/animation、按钮音效与弹出菜单超时字段。

合成字节在 `packages/igs/test/fixtures.ts`；外部来源的 ICS 样本在 `test-data/fixtures/igs-parser/`，旁边带来源与许可说明。

两份独立 golden 覆盖同一批对象：`libbluray-igs-baseline.test.ts` 逐 case/clip 核对 libbluray 解码出的 object id/version 集合与 igstools RGBA 参考摘要的资产集合一致。libbluray golden 由 `scripts/generate-libbluray-baselines.py` 调用 `scripts/libbluray-igs-dump.c` 本地生成，测试只读入库 JSON。

## 改动入口

| 需求 | 位置 | 同步 |
| --- | --- | --- |
| 支持新段/效果 | `consumeSegment` | `types.ts`、`docs/support/igs-support.md`、场景完整性测试 |
| 改 RLE/像素规则 | `decodeRle`、`png.ts` | `igs-reference-element-summary.test.ts` 的 igstools 参考逐元素对照 |
| 改 IGS 载体判定 | `extract.ts` 的 `isIgStream` 与 SubPath 解析 | `docs/support/igs-support.md` 的「Implemented and exercised」 |
| 新增诊断 | `igs.ts`/`transport.ts` | [diagnostics.md](../diagnostics.md) |
