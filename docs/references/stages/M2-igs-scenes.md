# M2 — TS/PES 与 IGS 场景参考

对应 change：[tasks.md](../../../openspec/changes/archive/2026-11-04-extract-igs-scenes/tasks.md) / [design.md](../../../openspec/changes/archive/2026-11-04-extract-igs-scenes/design.md)。

| 来源 | 任务 | 精确入口 | 用途和限制 |
| --- | --- | --- | --- |
| `ITU-H222-2025` | 1.1–1.3 | [当前 v10 记录](https://www.itu.int/rec/T-REC-H.222.0-202504-I)；匿名 PDF 下载被 TIES 登录拦截。匿名可取得的[已替代 2014 PDF](https://www.itu.int/rec/dologin_pub.asp?id=T-REC-H.222.0-201410-S%21%21PDF-E&lang=e&type=items)章节定位见 [README](../README.md#可复现获取)。 | 2014 版仅作适用的基础 TS/PES 语法对照。目录确认 TS packet/PES syntax 在 2.4.3.2–2.4.3.7，PSI 在 2.4.4；v10 章节未核实。任何版本均不定义 Blu-ray 192-byte M2TS、IG/PG PID 或 IGS ICS/PDS/ODS。 |
| `LIBBLURAY-1.5.0` | 1.1–1.4, 2.1–2.4, 3.1–3.5 | 固定 commit 文件：[`m2ts_demux.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/m2ts_demux.c), [`m2ts_filter.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/m2ts_filter.c), [`pes_buffer.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/pes_buffer.c), [`ig_decode.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/ig_decode.c), [`graphics_processor.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/graphics_processor.c), [`pg_decode.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/pg_decode.c), [`rle.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/rle.c), [`graphics_controller.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/graphics_controller.c). | LGPL-2.1 上游实现；不是规范性语法，也不保证输出完全正确。`pg_decode_palette()` zero-initializes all 256 slots before applying sparse PDS entries; the shared PDS path accepts both IG and PG composition sets. This is implementation evidence for transparent-zero handling of omitted IGS entries, not a normative BDA specification. |
| `IGSTOOLS-2019` | 1.1, 1.3, 2.1–2.4, 3.5 | 固定 commit `34a133150ca8b52237284da4d47d93911bcd4954`：[`ts_reader.py`](https://github.com/SAPikachu/igstools/blob/34a133150ca8b52237284da4d47d93911bcd4954/igstools/ts_reader.py)、[`parser.py`](https://github.com/SAPikachu/igstools/blob/34a133150ca8b52237284da4d47d93911bcd4954/igstools/parser.py)、[`model.py`](https://github.com/SAPikachu/igstools/blob/34a133150ca8b52237284da4d47d93911bcd4954/igstools/model.py)、[`export.py`](https://github.com/SAPikachu/igstools/blob/34a133150ca8b52237284da4d47d93911bcd4954/igstools/export.py)。 | 已确认可访问的 IGS 解析/导出工具；README 表明解析器/解码器移植自 libav patches，且有速度慢、已知问题。仓库含 GPL-3.0 与 LGPL-3.0 许可证文本；复用前按文件核验来源与许可。不是规范。 |
| `LIBHDMV-2026-03` | 2.1–2.4, 3.1–3.5 | 固定 commit [`igs/decode.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/igs/src/decode.rs)、[`igs/types.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/igs/src/types.rs)、[`pgs/decode.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/pgs/src/decode.rs)、[`pgs/palette.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/pgs/src/palette.rs)、[`pgs/rle.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/pgs/src/rle.rs)。 | Apache-2.0；README 标为 Alpha，仅供交叉核对。IGS 和 PGS 是不同路径；PG PID 不等于 IG，PGS 字幕解码不等于菜单提取。 |
| `PNG-SPEC`, `ITU-BT709` | 2.3–2.4, 3.5 | [PNG 第三版](https://www.w3.org/TR/png-3/)提供图像编码、alpha 和色彩元数据依据；[BT.709-6 官方记录](https://www.itu.int/rec/R-REC-BT.709/en)用于核对适用的 HDTV 色彩参数。 | PNG 不定义 IGS 调色板转换；不能只凭画面分辨率默认采用某个矩阵。按源语义固定矩阵、范围、取整和透明度，再建立独立像素预期。 |
| `BDedit` | 2.2–2.4, 3.5 | [BDedit 官方产品站](https://bdedit.pel.hu/) | 闭源专有 GUI，可作人工检查/提取；当前站点未找到可固定版本源码。工具导出可能出错，不能作为唯一预期或源码依据。 |

字段逐项登记、解析表示和固定 libbluray revision 见 [IGS 字段与版本依据](M2-igs-field-register.md)。

像素预期必须独立建立并记录 fixture ID、工具版本和色彩转换约定。libbluray 与 igstools 的来源可能重合（后者 README 明确提及 libav patches），不能把两者导出简单计作两份独立验证。来源完整 URL 和 revision 见 [`sources.json`](../sources.json)。

## MenuScene 场景验收拆分

以下 `M2-SYN-*` / `M2-REAL-*` 是本页的证据标签，分别指向现有测试或 workspace-local 输入，不是新增 fixture 文件。合成 fixture 的 expected 是测试中编码的结构/像素断言；它们不能充当独立参考实现。`actual` 只记录当前测试或 smoke 的观察值。

### M2-SYN-STATIC-01 — 静态单页场景

- **Fixture / evidence / source:** `packages/igs/tests/integration/extraction.test.ts`，`synthetic IGS extraction > reassembles a complete menu scene with page, BOG, button, object, palette and PNG source mapping`；由 `packages/igs/tests/helpers/fixtures.ts::syntheticClip()` 生成 TS/PES/ICS/PDS/ODS 输入。
- **Expected:** 一个已闭合 Display Set；scene 有来源、PTS、分辨率、page 与资源引用；未通过真实参考验证时，颜色规则仍标未验证。
- **Actual:** 测试断言一个完整的合成 scene（composition 7、PTS 90000、page 1、默认选择 button 1、palette 0、一个 1×1 object 5、一个 PNG asset）；来源指向 Clip `00001` / PID `0x120` / packet offset `384`。项目当前使用 BT.709 limited-range round-nearest；多 fixture 比较在显式指定同一矩阵时结果相同，但这些对照没有独立判定各盘 IGS 源数据的矩阵；整体 IGS support 仍为 `unverified`。
- **Result:** 合成结构与来源映射断言通过。没有真实菜单页的独立图像 golden，不能据此声称像素保真。

### M2-SYN-BUTTON-BOG-02 — 多页按钮与 BOG 作用域

- **Fixture / evidence / source:** 同文件 `preserves page-scoped button IDs and defaults, and diagnoses invalid explicit references`；`syntheticMenuSegments({ twoPages: true, invalidReferences: true })`。
- **Expected:** page-local button IDs 保持各自作用域；保留 page/BOG 默认值、自动动作、坐标、邻接、三态视觉对象和原始命令；非法显式引用要诊断，不推断邻接。
- **Actual:** 测试断言 page 1 与 page 2 各自有 button 1；page 默认和 BOG 默认分别为 2 与 1；button 的 auto-action、坐标、邻接及 normal/selected/activated object 引用与 fixture 预期相符。无效 page-default、BOG default、neighbor-up 产生三条 `IGS_INVALID_BUTTON_REFERENCE`，scene `complete: false`。12 字节命令内容由静态单页测试断言，M3 导航语义不在此测试范围。
- **Result:** 合成场景的作用域和显式引用负例通过。测试没有验证这些按钮在实际播放器中的导航语义；12 字节命令交由 M3 解码。

### M2-SYN-RESOURCE-03 — 对象版本与双 PDS

- **Fixture / evidence / source:** `packages/igs/tests/integration/extraction.test.ts` 两项：`keeps complete object versions attached to the Display Set and epoch that received them`；`maps one ODS through two palettes and preserves palette alpha in provisional PNG pixels`。
- **Expected:** 不同版本不混拼；同一图像资源使用不同 palette 时，palette/version 映射可追踪，透明度按输入保留。
- **Actual:** 第一项直接向状态机馈入合成 ICS/PDS/ODS，并用两个 time domain 断言 scene 分别绑定 object/palette version 0 和 1。第二项验证同一 object 通过两个合成 palette 渲染且保留 alpha；真实 Battle Royale UHD Clip `00005` 另断言 object 13/version 0 映射到 palette 0–3，object 22、23、24、27、30/version 0 映射到 palette 1–3。
- **Result:** 真实同 ODS 多 palette 资产映射、BT.709 limited 色彩向量和 alpha 通道都有逐像素断言；真实多 fixture 逐元素结果见下方独立对照记录。合成双 palette 用于隔离渲染行为，真实 fixture 用于验证实际资源映射。

### M2-SYN-TIME-EFFECT-04 — 动画字段、超时与效果

- **Fixture / evidence / source:** `packages/igs/tests/integration/extraction.test.ts`，`decodes libbluray effect durations, palette refs, composition objects and crop data`；使用 `syntheticClip({ effects: true, richEffects: true, uiModelWithTimeouts: true, animated: true })`。
- **Expected:** 解码效果持续时间、palette、composition 对象、裁剪区域，以及按钮动画帧率和循环字段。
- **Actual:** 测试断言 composition timeout `90000`、selection timeout `45000`、user timeout duration `123`、frame-rate code `1`、normal/selected visual object range `5..5` 与 repeat，并逐字段校验进入/退出效果结构。`returns extracted effect data and rendered assets with the clip result` 校验效果字段与渲染资产共同返回。
- **Result:** 合成输入上的效果解析、资产输出与动画字段测试通过。`MenuController` 的帧推进、页面效果时序和 checkpoint 恢复由 `packages/runtime-web/src/index.test.ts` 覆盖；libbluray 未实现的 composition/selection timeout 自动触发不作为已验证行为。

### M2-SYN-DAMAGE-05 — 缺失资源、损坏流与不完整 Display Set

- **Fixture / evidence / source:** `packages/igs/tests/integration/extraction.test.ts` 中 `does not submit a Display Set when the END marker is missing`、`does not commit an EOF Display Set with an unfinished ODS fragment`、`does not retain complete=true for ...`、`clears incomplete scene and ... cache after transport damage`、`rejects a PMT PID mismatch against the M1 MPLS/CLPI cue`、`does not discover a PG PMT stream as IGS when no structural cue exists`。
- **Expected:** 缺 END/ODS 片、对象、palette、损坏 RLE、传输资源或 PID 线索冲突时，不把相关 scene 冒充 complete；诊断保留来源和受影响对象。
- **Actual:** 合成负例分别断言 `IGS_UNCOMPLETED_DISPLAY_SET`、`IGS_INVALID_SEGMENT`、`UNRESOLVED_OBJECT`、`UNRESOLVED_PALETTE`、`IGS_INVALID_RLE`、`IGS_INCOMPLETE_OBJECT` 和传输损坏后的缓存清理；PG 流不会仅因 PMT 被当成 IGS。真实盘损坏流没有在这些测试中出现。
- **Result:** 当前覆盖是可复现的合成正反例，不代表对真实损坏盘的经验观察。真实输入缺失项见下一节。

### M2-REAL-00005 — Tamako workspace-local 观察范围

- **Fixture / evidence / source:** 用户提供的 `test-data/bdmv/tamako-love-story-bd/BDMV/CLIPINF/00005.clpi` 与 `STREAM/00005.m2ts`；入库证据是同碟 `STREAM/00005` 与 `00043` 的 IG 包切片，由 `packages/igs/tests/integration/hdmv-navigation-packet-fixtures.test.ts` 的 tamako 用例驱动。
- **Expected:** 只记录结构提取事实和 partial 状态，不把合成预期或人工猜测填入真实 disc 观察。
- **Actual:** CLPI 声明 IGS PID `0x1400`；菜单 playlist `00003` 有 999 个 play item，主项只引用 Clip `00004`，SubPath 含 Clip `00005`。Clip `00005` 得到一个 `1920×1080` scene，7 pages、168 objects、7 palettes，存在对应 PNG assets。当前阶段记录观察到 page 2 和 3 的默认按钮均为 `65534`；两条 `IGS_INVALID_BUTTON_REFERENCE` 诊断不绑定具体 page/button ID。extract 为 `partial`、support 为 `unverified`。CLPI `00043` 也声明 IGS，但 workspace 缺少匹配 `STREAM/00043.m2ts`，报告 `BDMV_MISSING_STREAM`。
- **Result:** 已观察到 Clip `00005` 的真实解析路径及两个显式缺口。当前测试不对 PNG 像素、页面含义、按钮意图、效果时序或画面相似度作断言；缺失的 Clip `00043` 也没有真实流结果。输入为用户本地素材。
- **独立参考记录：** 此处记录的是 2026-11-03 当时的状态；随后已对 Tamako `00005`、`00043` 及其他 packet fixture 完成同类工具逐元素/逐像素对照，详见下方 2026-11-04 记录。动画帧在本次输入中没有可比较的多帧对象范围。


## 2026-11-03 — Tamako 00005 逐元素同类工具对照

- **输入：** workspace-local `test-data/bdmv/tamako-love-story-bd/BDMV/STREAM/00005.m2ts`（IG PID 0x1400）。
- **参考工具：** `SAPikachu/igstools` 0.9.3，固定 commit `34a133150ca8b52237284da4d47d93911bcd4954`，Python 3.15.0、pypng 0.20220715.0、Pillow 13.0.0。工具解码器源自 libav patches，属于实现对照，不能等同规范。
- **参考方式：** igstools 整体页面模型在 `_find_button` 处抛出 `KeyError: Button not found`；不修改工具或输入。改用该工具自身的 M2TS、IGS、RLE、palette 解码及 `picture_to_png`，按项目产物中对象 ID/版本和调色板 ID 对应生成元素参考。其默认 `matrix_from_menu_height` 对 1080 行选择 BT.709；显式设置 BT.709、limited range。参考输出为 16-bit RGBA，以 `(value + 128) // 257` 取整为 8-bit 后与项目 PNG 比较全部通道。
- **结果：** 项目产出的 168 个元素、14,881,965 像素全部精确一致，RGBA 差异像素为 0；逐项报告由脚本写到命令行指定目录，不入库。这证明在上述固定转换规则下，已导出对象与同类工具结果一致；不证明规范要求或其他未导出对象/不同版本/动画帧均一致。另按参考解码器的原始按钮状态核对：168 条非空状态引用对应 168 个元素，项目无缺漏或额外元素；本样本没有多帧对象范围，不能据此覆盖动画帧。页面模型组装失败不阻断这些元素的对比。
- **更正：** 初次强制 BT.601 与旧实现完全一致只说明实现使用同一矩阵，不足以证明色彩正确。固定参考 BT.709 时旧实现 165/168 个元素存在差异（最大 RGB 差分别为 14/26/7，alpha 差 0）；现在实现改为 BT.709，Tamako 元素与该显式矩阵下的参考结果一致。背景视频 ffprobe 显示 1920×1080，但未返回色彩元数据；因此这些结果验证的是对照矩阵下的实现一致性，不判定原盘实际矩阵。
- **复现：** 编译后用 CLI `extract` 提取当前 BDMV 到独立目录；在包含上述 igstools、pypng 和 Pillow 的隔离 Python 环境中运行 `PYTHONPATH=<igstools源码目录> python scripts/compare-igstools-reference.py <00005.m2ts> <extract输出目录> <对照输出目录>`。脚本只读源素材，参考图片与计算结果输出到指定目录。

## 2026-11-04 — 多 fixture 逐元素独立参考对照

- **目的：** 把同类 IGS 工具作为独立的图像解码/调色板转换参考，对按钮 normal/selected/activated 状态引用的图像逐项核对，再逐像素比较导出的 PNG。比较键包含 page、object ID/version、palette ID/version；覆盖报告分别列出缺失和额外引用。每个图像逐 RGBA 通道比较，包括 alpha，不只比整页或按钮截图。
- **参考实现与转换：** `SAPikachu/igstools` 固定 commit `34a133150ca8b52237284da4d47d93911bcd4954`，Python `3.15.0`、pypng `0.20220715.0`、Pillow `13.0.0`。参考解码显式配置 BT.709 limited range；工具的 16-bit RGBA 样本按 `(value + 128) // 257` 转为 8-bit 后，与项目对应 PNG 的 RGBA 像素做精确比较。输入由项目的提取器生成；工具页面组装不用于计算，参考图像由其 IGS segment、RLE、palette 解码路径和 `picture_to_png` 导出。此处是固定对照条件，不代表各 fixture 的原盘色彩矩阵已被独立确认。
- **结果：** 8 个案例共 993 条按钮状态图像引用，覆盖 891 个唯一元素，共 45,752,163 像素。元素覆盖无缺失/额外项；对象版本及 palette 版本均在逐项报告中；所有 RGBA 像素完全一致，差异像素数为 0。样本无多帧对象范围，因此未产生动画帧对照。2026-11-08 追加 `synthetic-all-features` `00002`（6 条按钮状态引用、1 个唯一元素、1 像素、0 差异），参考 PNG 在 `.reference-cache/verification/igs-fixtures-20261108/`。

| Fixture | Clip | 按钮状态引用 | 唯一元素 | 像素 | 不同 RGBA 像素 |
| --- | --- | ---: | ---: | ---: | ---: |
| bang-dream-mygo-vol1 | `00010` | 188 | 188 | 1,195,478 | 0 |
| bang-dream-mygo-vol1 | `00011` | 57 | 51 | 1,157,482 | 0 |
| battle-royale-uhd | `00002` | 277 | 215 | 4,396,600 | 0 |
| battle-royale-uhd | `00005` | 87 | 68 | 8,363,970 | 0 |
| kyoani-ova | `00005` | 45 | 32 | 834,622 | 0 |
| synthetic-all-features | `00002` | 6 | 1 | 1 | 0 |
| synthetic-igs-parser | `00001` | 3 | 1 | 1 | 0 |
| tamako | `00005` | 168 | 168 | 14,881,965 | 0 |
| tamako | `00043` | 168 | 168 | 14,922,045 | 0 |

- **执行脚本：** [compare-igstools-reference.py](../../../scripts/compare-igstools-reference.py) 与 [export-igs-packet-fixtures.mjs](../../../scripts/export-igs-packet-fixtures.mjs)。参考 PNG 输出到本地忽略目录 `.reference-cache/verification/igs-fixtures-20261104/reference/{case}/{clip}/reference/`；逐元素报告由脚本输出到命令行指定目录，逐项记录 PNG 文件名、尺寸、像素数、通道差异和元素版本。真实盘只使用已筛选 IGS packet fixture，没有复制整段 M2TS；合成用例由 [syntheticReferenceClip](../../../packages/igs/tests/helpers/fixtures.ts) 生成。参考 PNG 的逐元素摘要由 [summarize-igstools-references.py](../../../scripts/summarize-igstools-references.py) 写入 `test-data/baselines/igs-reference-element-summary.json`。
- **igstools 效果段限制：** 固定 revision 的 igstools 以 `>4H` 读取效果对象描述符，把规范中的 window id（u8）与 forced-on 标志（u8）合并为一个 u16 作为窗口键（如 windowId=1、forced-on=0x40 时查键 0x140），任何非空效果序列都会触发 KeyError。2026-11-04 对照的 8 个 clip 能通过解析，说明它们的按钮段效果序列为空。`synthetic-all-features` `00001` 是第一个携带效果序列的 fixture，不纳入 igstools 对照与 libbluray IGS 基线；其菜单效果的解码行为由 libbluray 导航基线与项目单元测试覆盖。
- **适用范围：** 结果覆盖这 9 个静态场景的当前图像元素、调色板、alpha 与固定颜色转换路径。任务 2.1 的逐字段依据见 [字段登记](M2-igs-field-register.md)；任务 2.4 的独立颜色向量和真实同 ODS 多 PDS 资产映射由 `packages/igs/tests/integration/extraction.test.ts` 与 `packages/igs/tests/integration/hdmv-navigation-packet-fixtures.test.ts` 断言。

Battle Royale UHD 的 `00005` 对照报告同样将 igstools 显式设置为 BT.709 limited range。该 packet fixture 只含 PAT、PMT 与 IGS PID 的筛选包，不含主视频码流；ICS 的 1920×1080 菜单分辨率也不能单独确定 PDS 的颜色矩阵。因此现有结果只能说明该 IGS 图像在 BT.709 对照条件下与参考输出一致，不能回答这张 UHD 盘的菜单源是否应按 BT.709 解码。

## 2026-11-04 — IGS 字段登记与 BT.709 向量核验

- **字段登记：** ICS、page、BOG、button、PDS、ODS 与 Display Set 的实现字段、版本键、libbluray 1.5.0 固定 revision 和本地样本见 [IGS 字段与版本依据](M2-igs-field-register.md)。解析器现保留此前被跳过的 ICS frame-rate code 和 button numeric-select value；外部真实 ICS 样本断言 frame-rate code 为 1、首按钮 numeric-select value 为 `65535`。
- **独立颜色向量：** `packages/igs/tests/integration/extraction.test.ts` 对 6 个固定 YCbCrA 输入解码 PNG RGBA 全像素并与静态预期比较。输入和结果为：`(Y,Cb,Cr,A)=(16,128,128,0) → (0,0,0,0)`；`(235,128,128,1) → (255,255,255,1)`；`(126,128,128,127) → (128,128,128,127)`；`(81,90,240,128) → (255,24,0,128)`；`(145,54,34,254) → (0,216,0,254)`；`(41,240,110,255) → (0,15,255,255)`。覆盖黑白/中性灰、色彩分量、舍入、裁剪和 alpha 直通。
- **真实多 palette 映射：** Battle Royale UHD Clip `00005` 的 packet fixture 断言 object 13/version 0 各自生成 palette 0、1、2、3 的资产；object 22、23、24、27、30/version 0 各自生成 palette 1、2、3 的资产。还断言 PDS 0/version 0 entry 0 值和 ODS 27/version 0 的尺寸及 RLE 索引样本。对应全部真实元素的同类工具像素比较在前节报告中为零差异。

## 2026-11-07 — libbluray 1.5.0 IGS 元素级解码基线

- **参考实现：** VideoLAN libbluray 1.5.0，固定 revision `d75c88e54c893e5cbf4c61d356477655eb435769`，解码入口 `src/libbluray/decoders/graphics_processor.c` 的 `graphics_processor_decode_ts()`。`scripts/libbluray-igs-dump.c` 链接本机 libbluray 静态库并由 `scripts/generate-libbluray-baselines.py` 调用。
- **输入：** 已入库的 8 个 IG packet fixture（`test-data/fixtures/hdmv-navigation/disc-data/` 与 `test-data/fixtures/igs-parser/`）。192 字节 TS 包按 6144 字节 read unit 重新分组，不足处补 null packet；`stc=-1` 让 libbluray 立即解码完整 display set。
- **入库证据：** [libbluray-1.5.0-igs-baseline.json](../../../test-data/baselines/libbluray-1.5.0-igs-baseline.json)。9 个 clip、52 组 256 项调色板、873 个对象。逐 case 记录 display set 的 complete/epochStart/validPts、ICS 的页面/BOG/按钮/进入退出效果/超时、按钮的 20 个字段、调色板 256 项 YCrCbT，以及对象 RLE 的宽高、run/EOL 计数、48 个等距索引采样和 16 个索引分箱。
- **自动化对照：** `packages/igs/tests/integration/libbluray-igs-baseline.test.ts`（10 例）。逐 case 把 `extractIgsFromChunks()` 的结果与上述字段全部比对，并逐 case/clip 核对 libbluray 解出的 object id/version 集合与 igstools RGBA 参考摘要的 892 个资产名解析出的 873 个 object id/version 集合一致。测试只读入库 JSON 和夹具，运行时不需要本机 libbluray。
- **结果：** 9 个 clip 的 display set、ICS、调色板与对象 RLE 摘要全部一致；object id/version 集合与 igstools 参考逐 clip 相等，无缺失或额外项。
- **适用范围：** libbluray 解码给出 YCrCbT 调色板条目与 RLE 索引；逐像素 RGBA 保真由 pinned igstools 的 `picture_to_png` 参考覆盖（见 2026-11-04 节）。按本页已记录的来源关系，igstools 解码器源自 libav patches，与 libbluray 来源可能重合，两份证据分别覆盖元素结构/RLE 与 RGBA 转换路径，按一个参考族计。本次比对未涉及动画帧、多帧对象范围或各盘原始色彩矩阵判定。
