# 功能：IGS 菜单提取

链路：`STREAM/*.m2ts` → 192 字节源包 → TS/PSI/PES → IG 段 → Display Set → 场景 → PNG 元素。每一层都带来源偏移，失败按层定位。

## 1. 找到 IGS 载体

`extractIgsScenes(disc)` 不扫描全部 STREAM，只按声明找：

| 线索 | 来源 | 说明 |
| --- | --- | --- |
| 主路径 IG 流 | MPLS STN，`streamType === 1` | 常规菜单 |
| CLPI IG 流 | `codingType === 0x91` | MPLS 未声明时的补充 |
| SubPath IG 流 | `streamType === 2` + `subPathId`/`subClipId` | 解析到实际 clip |

同一 clip 只处理一次。STREAM 路径从 `disc.graph` 的 `clip:<id>` 节点取；缺失 → `BDMV_MISSING_STREAM`（error）。

## 2. 传输层

| 步骤 | 实现 | 关键检查 |
| --- | --- | --- |
| 192 字节包 | `M2tsPacketReader` | 同步字节、包长、adaptation field |
| 连续计数 | 同上 | `TS_CONTINUITY_ERROR` 时使受影响单元失效 |
| PAT/PMT | `PsiAssembler` | CRC、指针字段、长度；损坏 section 丢弃 |
| PID 选择 | PMT + 声明线索 | 不一致 → `IGS_PID_CONFLICT` / `IGS_PID_UNRESOLVED` |
| PES 拼装 | `PesAssembler` | 头长度、时间戳、跨包截断 |
| PTS | `decodeTimestamp` | 33 位回绕用 epoch 延续；显式不连续重置时间域 |

PES 载荷按 3 字节段头（类型 + 16 位长度）切分；不完整的段留作下一块的 `residual`。跨读取块、跨 PES 的重组结果与一次性输入一致。

## 3. 段与场景

| 段 | 处理 |
| --- | --- |
| PDS | 调色板按 `(id, version)` 缓存；稀疏表缺省索引为透明 |
| ODS | 对象按 `(id, version)` 缓存；支持跨段续传；尺寸乘积超 `maxObjectPixels` 在分配前拒绝 |
| ICS | 组合、页、BOG、按钮、效果；只有引用齐全且对象/调色板已解析才提交场景 |
| END | 结束当前 Display Set |

场景 `complete: true` 的条件：数据未损坏、所有引用对象/调色板已解析、对象序列已收齐、按钮引用有效。否则保持 `false` 并写诊断，不用透明占位补。

关键字段：

- `uiModel`：0 常显菜单，1 弹出菜单。
- `compositionState` / `compositionTimeout90k` / `selectionTimeout90k`：组合生命周期。
- `pages[].uoMask`：64 位用户操作掩码；运行时把非规范十进制视为无效并阻断该页输入（报诊断）。
- `defaultSelectedButtonId` / `defaultActivatedButtonId`：`0xffff` 表示无选中，`0xfffe` 表示激活当前选中。
- `buttons[].commands[]`：12 字节原始命令 + `recordIndex` + `sourceOffset`，交给 `hdmv` 解码。

## 4. PNG 元素

`renderSceneAssets(scene)`：

1. 对每个被按钮三态引用的对象，用当前调色板做 RLE 解码。
2. YCbCrA → RGBA：BT.709 limited range、round-to-nearest、alpha 直通。
3. 编码 PNG，`IgsAsset` 记录 `objectId/objectVersion`、`paletteId/paletteVersion`、来源。
4. 每个元素独立成文件，路径由场景与对象派生；不做整页合成。

`validateIgsSceneAssets(scenes)` 检查引用资产是否存在，缺失报 `IGS_UNRESOLVED_VISUAL_ASSET` / `IGS_UNRESOLVED_EFFECT_ASSET`。

## 5. 输出形态

| 调用方 | 选项 | 产物 |
| --- | --- | --- |
| `convert` | `renderAssets: true`（默认） | 场景 + PNG，交给 `package-builder` |
| `extract --type igs` | `renderAssets: false` | 场景 JSON + 诊断 + source-map，不含 PNG |
| `export-assets` | `captureStreams: true` | 额外保留 igstools 兼容 `.mnu` 字节 |

`IgsExtraction.status`：有 error 且无场景 → `failed`；有 error/warning 或无场景 → `partial`；否则 `complete`。`support.status` 固定 `unverified`。

## 6. 验证方式

| 目的 | 做法 |
| --- | --- |
| 段/场景正确性 | `packages/igs/test/extraction.test.ts` 的合成段 |
| 传输正确性 | `transport.test.ts` 的回绕、连续性、跨块 |
| 像素正确性 | 九个包级夹具逐元素对照 igstools（配置 BT.709），记录在 `docs/evidence/` |
| 真实结构 | `test-data/fixtures/igs-parser/` 的外部 ICS 样本（1920×1080、四页） |
| 本地真实样本 | `tamako-real-smoke.test.ts`，数据缺失时跳过 |

## 常见问题

| 现象 | 原因 | 检查 |
| --- | --- | --- |
| `IGS_NO_DISPLAY_SETS` | PID 线索错误，或该 clip 没有 IG 流 | `list-assets --type igs` 看 PID；CLPI `0x91` 声明 |
| 场景 `complete: false` | 缺对象/调色板、效果未支持、段损坏 | `igs/diagnostics.json` 的 `affectedSceneIds` |
| PNG 全透明 | 调色板索引缺失（稀疏表）或 PDS 版本不匹配 | 对照 `objectId`/`paletteId` 版本 |
| 按钮命中偏移 | 场景坐标与视频比例不同（见 [troubleshooting.md](../troubleshooting.md)） | 场景宽高、`object-fit: contain` 的双重 letterbox |
| 画面元素对不上 | 颜色矩阵按 BT.709 limited 处理，源盘可能不同 | `colorConversion` 字段与对照记录 |
