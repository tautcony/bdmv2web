# M2 — TS/PES 与 IGS 场景参考

对应 change：[tasks.md](../../../openspec/changes/extract-igs-scenes/tasks.md) / [design.md](../../../openspec/changes/extract-igs-scenes/design.md)。

| 来源 | 任务 | 精确入口 | 用途和限制 |
| --- | --- | --- | --- |
| `ITU-H222-2025` | 1.1–1.3 | [当前 v10 记录](https://www.itu.int/rec/T-REC-H.222.0-202504-I)；匿名 PDF 下载被 TIES 登录拦截。匿名可取得的[已替代 2014 PDF](https://www.itu.int/rec/dologin_pub.asp?id=T-REC-H.222.0-201410-S%21%21PDF-E&lang=e&type=items)之 hash 与章节见 [README](../README.md#可复现获取)。 | 2014 版仅作适用的基础 TS/PES 语法对照。目录确认 TS packet/PES syntax 在 2.4.3.2–2.4.3.7，PSI 在 2.4.4；v10 章节未核实。任何版本均不定义 Blu-ray 192-byte M2TS、IG/PG PID 或 IGS ICS/PDS/ODS。 |
| `LIBBLURAY-1.5.0` | 1.1–1.4, 2.1–2.4, 3.1–3.5 | 固定 commit 文件：[`m2ts_demux.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/m2ts_demux.c), [`m2ts_filter.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/m2ts_filter.c), [`pes_buffer.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/pes_buffer.c), [`ig_decode.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/ig_decode.c), [`graphics_processor.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/graphics_processor.c), [`pg_decode.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/pg_decode.c), [`rle.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/rle.c), [`graphics_controller.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/graphics_controller.c). | LGPL-2.1 上游实现；不是规范性语法，也不保证输出完全正确。`pg_decode_palette()` zero-initializes all 256 slots before applying sparse PDS entries; the shared PDS path accepts both IG and PG composition sets. This is implementation evidence for transparent-zero handling of omitted IGS entries, not a normative BDA specification. |
| `IGSTOOLS-2019` | 1.1, 1.3, 2.1–2.4, 3.5 | 固定 commit `34a133150ca8b52237284da4d47d93911bcd4954`：[`ts_reader.py`](https://github.com/SAPikachu/igstools/blob/34a133150ca8b52237284da4d47d93911bcd4954/igstools/ts_reader.py)、[`parser.py`](https://github.com/SAPikachu/igstools/blob/34a133150ca8b52237284da4d47d93911bcd4954/igstools/parser.py)、[`model.py`](https://github.com/SAPikachu/igstools/blob/34a133150ca8b52237284da4d47d93911bcd4954/igstools/model.py)、[`export.py`](https://github.com/SAPikachu/igstools/blob/34a133150ca8b52237284da4d47d93911bcd4954/igstools/export.py)。 | 已确认可访问的 IGS 解析/导出工具；README 表明解析器/解码器移植自 libav patches，且有速度慢、已知问题。仓库含 GPL-3.0 与 LGPL-3.0 许可证文本；复用前按文件核验来源与许可。不是规范。 |
| `LIBHDMV-2026-03` | 2.1–2.4, 3.1–3.5 | 固定 commit [`igs/decode.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/igs/src/decode.rs)、[`igs/types.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/igs/src/types.rs)、[`pgs/decode.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/pgs/src/decode.rs)、[`pgs/palette.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/pgs/src/palette.rs)、[`pgs/rle.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/pgs/src/rle.rs)。 | Apache-2.0；README 标为 Alpha，仅供交叉核对。IGS 和 PGS 是不同路径；PG PID 不等于 IG，PGS 字幕解码不等于菜单提取。 |
| `PNG-SPEC`, `ITU-BT709` | 2.3–2.4, 3.5 | [PNG 第三版](https://www.w3.org/TR/png-3/)提供图像编码、alpha 和色彩元数据依据；[BT.709-6 官方记录](https://www.itu.int/rec/R-REC-BT.709/en)用于核对适用的 HDTV 色彩参数。 | PNG 不定义 IGS 调色板转换；不能只凭画面分辨率默认采用某个矩阵。按源语义固定矩阵、范围、取整和透明度，再建立独立像素预期。 |
| `BDedit` | 2.2–2.4, 3.5 | [BDedit 官方产品站](https://bdedit.pel.hu/) | 闭源专有 GUI，可作人工检查/提取；当前站点未找到可固定版本源码。工具导出可能出错，不能作为唯一预期或源码依据。 |

像素预期必须独立建立并记录 fixture ID、工具版本和色彩转换约定；不为外部原盘素材生成哈希。libbluray 与 igstools 的来源可能重合（后者 README 明确提及 libav patches），不能把两者导出简单计作两份独立验证。来源完整 URL 和 revision 见 [`sources.json`](../sources.json)。

## MenuScene 场景验收拆分

以下 `M2-SYN-*` / `M2-REAL-*` 是本页的证据标签，分别指向现有测试或 workspace-local 输入，不是新增 fixture 文件。合成 fixture 的 expected 是测试中编码的结构/像素断言；它们不能充当独立参考实现。`actual` 只记录当前测试或 smoke 的观察值。

### M2-SYN-STATIC-01 — 静态单页场景

- **Fixture / evidence / source:** `packages/igs/test/extraction.test.ts`，`synthetic IGS extraction > reassembles a complete menu scene with page, BOG, button, object, palette and PNG source mapping`；由 `packages/igs/test/fixtures.ts::syntheticClip()` 生成 TS/PES/ICS/PDS/ODS 输入。
- **Expected:** 一个已闭合 Display Set；scene 有来源、PTS、分辨率、page 与资源引用；未通过真实参考验证时，颜色规则仍标未验证。
- **Actual:** 测试断言一个完整的合成 scene（composition 7、PTS 90000、page 1、默认选择 button 1、palette 0、一个 1×1 object 5、一个 PNG asset）；来源指向 Clip `00001` / PID `0x120` / packet offset `384`。导出色彩规则为 `unverified-bt601-limited-round-nearest`，support 为 `unverified`。
- **Result:** 合成结构与来源映射断言通过。没有真实菜单页的独立图像 golden，不能据此声称像素保真。

### M2-SYN-BUTTON-BOG-02 — 多页按钮与 BOG 作用域

- **Fixture / evidence / source:** 同文件 `preserves page-scoped button IDs and defaults, and diagnoses invalid explicit references`；`syntheticMenuSegments({ twoPages: true, invalidReferences: true })`。
- **Expected:** page-local button IDs 保持各自作用域；保留 page/BOG 默认值、自动动作、坐标、邻接、三态视觉对象和原始命令；非法显式引用要诊断，不推断邻接。
- **Actual:** 测试断言 page 1 与 page 2 各自有 button 1；page 默认和 BOG 默认分别为 2 与 1；button 的 auto-action、坐标、邻接及 normal/selected/activated object 引用与 fixture 预期相符。无效 page-default、BOG default、neighbor-up 产生三条 `IGS_INVALID_BUTTON_REFERENCE`，scene `complete: false`。12 字节命令内容由静态单页测试断言，M3 导航语义不在此测试范围。
- **Result:** 合成场景的作用域和显式引用负例通过。测试没有验证这些按钮在实际播放器中的导航语义；12 字节命令交由 M3 解码。

### M2-SYN-RESOURCE-03 — 对象版本与双 PDS

- **Fixture / evidence / source:** `packages/igs/test/extraction.test.ts` 两项：`keeps complete object versions attached to the Display Set and epoch that received them`；`maps one ODS through two palettes and preserves palette alpha in provisional PNG pixels`。
- **Expected:** 不同版本不混拼；同一图像资源使用不同 palette 时，palette/version 映射可追踪，透明度按输入保留。
- **Actual:** 第一项直接向状态机馈入合成 ICS/PDS/ODS，并用两个 time domain 断言 scene 分别绑定 object/palette version 0 和 1。第二项先解析合成 scene，再在内存中添加 page 2 和 palette 1；渲染得到 object 5/version 0 与 palette 0/1 的两个 asset，解码像素分别为 `[255,255,255,255]`、`[255,0,0,173]`。色彩转换标签仍是未验证的 provisional BT.601 limited/rne。
- **Result:** 版本隔离与两个 palette 输入的渲染行为通过合成断言。双 PDS 像素样本是程序构造且非独立 golden；测试没有证明真实 M2TS 中先后到达的两个 PDS 对应这些颜色。

### M2-SYN-TIME-EFFECT-04 — 动画字段、超时与效果

- **Fixture / evidence / source:** `packages/igs/test/extraction.test.ts`，`keeps unknown effect semantics unverified and marks the page incomplete`；使用 `syntheticClip({ effects: true, richEffects: true, uiModelWithTimeouts: true, animated: true })`。
- **Expected:** 保留可解析的时间、帧/循环字段及原始效果字节；未实现的效果不得静默解释成静态完整画面。
- **Actual:** 测试断言 composition timeout `90000`、selection timeout `45000`、user timeout duration `123`、frame-rate code `1`、normal/selected visual object range `5..5` 与 repeat。进入/退出效果原始字节和数量保留；产生 `IGS_UNSUPPORTED_EFFECT`，scene 不完整，extract 为 `partial`。
- **Result:** 字段保留及“未知效果保持未验证”断言通过。fixture 不提供动画逐帧参考、效果播放时序 golden 或用户可见结果，不能断言效果语义正确。

### M2-SYN-DAMAGE-05 — 缺失资源、损坏流与不完整 Display Set

- **Fixture / evidence / source:** `packages/igs/test/extraction.test.ts` 中 `does not submit a Display Set when the END marker is missing`、`does not commit an EOF Display Set with an unfinished ODS fragment`、`does not retain complete=true for ...`、`clears incomplete scene and ... cache after transport damage`、`rejects a PMT PID mismatch against the M1 MPLS/CLPI cue`、`does not discover a PG PMT stream as IGS when no structural cue exists`。
- **Expected:** 缺 END/ODS 片、对象、palette、损坏 RLE、传输资源或 PID 线索冲突时，不把相关 scene 冒充 complete；诊断保留来源和受影响对象。
- **Actual:** 合成负例分别断言 `IGS_UNCOMPLETED_DISPLAY_SET`、`IGS_INVALID_SEGMENT`、`UNRESOLVED_OBJECT`、`UNRESOLVED_PALETTE`、`IGS_INVALID_RLE`、`IGS_INCOMPLETE_OBJECT` 和传输损坏后的缓存清理；PG 流不会仅因 PMT 被当成 IGS。真实盘损坏流没有在这些测试中出现。
- **Result:** 当前覆盖是可复现的合成正反例，不代表对真实损坏盘的经验观察。真实输入缺失项见下一节。

### M2-REAL-00005 — Tamako workspace-local 观察范围

- **Fixture / evidence / source:** 用户提供的 `test-data/tamako-love-story-bd/BDMV/CLIPINF/00005.clpi` 与 `STREAM/00005.m2ts`；证据测试 `packages/igs/test/tamako-real-smoke.test.ts`（仅在本地 STREAM 存在时运行）。测试命令：`pnpm --filter @bdmv-web/igs exec vitest run test/tamako-real-smoke.test.ts`。本次运行结果：1 test passed。
- **Expected:** smoke 只检查结构提取事实和 partial/unverified 状态，不把合成预期或人工猜测填入真实 disc 观察。
- **Actual:** CLPI 声明 IGS PID `0x1400`；菜单 playlist `00003` 有 999 个 play item，主项只引用 Clip `00004`，SubPath 含 Clip `00005`。Clip `00005` 得到一个 `1920×1080` scene，7 pages、168 objects、7 palettes，存在对应 PNG assets。当前阶段记录观察到 page 2 和 3 的默认按钮均为 `65534`；smoke 自动断言的是两条 `IGS_INVALID_BUTTON_REFERENCE`，没有断言具体 page/button ID。extract 为 `partial`、support 为 `unverified`。CLPI `00043` 也声明 IGS，但 workspace 缺少匹配 `STREAM/00043.m2ts`，报告 `BDMV_MISSING_STREAM`。
- **Result:** 已观察到 Clip `00005` 的真实解析路径及两个显式缺口。真实 smoke 不对 PNG 像素、页面含义、按钮意图、效果时序或画面相似度作断言；缺失的 Clip `00043` 也没有真实流结果。输入为用户本地素材，本记录不添加内容 hash。
- **独立参考缺口:** 仍需独立像素 golden（明确 fixture、参考工具/版本、palette 与颜色转换规则、时间/裁剪预期）。libbluray 与 igstools 可能共享来源，不能不加分析地当成两份独立参考。此缺口不由本次 smoke、PNG 可打开或合成像素断言关闭。
