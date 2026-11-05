# Phase 1 审查报告: 二进制格式解析（bdmv-parser）

> 日期: 2026-11-04
> 文件数: 3（`parser.ts`、`model.ts`、`parser.test.ts`）
> 发现: P0(0) / P1(1) / P2(2) / INFO(3)
> 导航: [返回 review index](../index.md) | [查看修复 checklist](../fix-checklist.md)

## 已审查文件

- `packages/bdmv-parser/src/parser.ts` — `parseIndexAppInfo`、`parseIndexUhdExtension`、`parseIndex`、`parseMpls`（AppInfo 与 0x24 分支）、`parseClpi`（header / sequence / 0x24 分支）、`supportedVersions`
- `packages/bdmv-parser/src/model.ts` — `DiscAppInfo`、`UhdMetadata`、`PlaylistAppInfo`、`ClipHeader`、`AtcSequence`、`StcSequence`
- `packages/bdmv-parser/src/parser.test.ts` — 新增 177 行用例
- 对照参考实现: `.reference-cache/libbluray-1.5.0/src/libbluray/bdnav/{index_parse.c,mpls_parse.c,clpi_parse.c}`
- **本地缓存缺口**: 缓存内没有 `extdata_parse.c`，也没有 `bdmv_parse_extension_data` 的定义；该函数只以调用点形式出现（`index_parse.c:285`、`mpls_parse.c:1126`、`clpi_parse.c:783`）。凡涉及该函数内部行为的表述，一律标注为"上游实现，本地缓存未包含"，不作为已核证据。

## 已核实与参考实现一致

- `supportedVersions` 新增 `0240`（3D/MVC）与 libbluray `bdmv_parse_header` 的四个版本白名单一致。
- INDX 固定 `seek(40)`、`appLen` 语义、flags 位序（output mode / content exist / dynamic range）与 `index_parse.c` 一致；真实样本 5 个 index 全部 `appLen=34, index_start=78`。
- INDX 扩展 entry 表布局（`length u32` + `relative start s32` + 24 bit padding + `count u8`，entry 从 +12 开始）按 `battle-royale-uhd` 样本逐字节验证；`bdmv_parse_extension_data()` 的实现不在本地缓存中，只能与 `index_parse.c:284-289` 的调用方式对照，**未逐行核对该解析函数本身**。`battle-royale-uhd` 的 `discType=5 / exists4k / hdrFlags=3 / dolbyVision` 解码正确。
- MPLS AppInfo：`appLen<12` 抛错不是新增回归（旧实现在 `appLen=12` 时同样会跳过 11 字节）；真实 63 个 MPLS 全部 `appLen=14`。
- MPLS/CLPI 0x24 的位序与 `mpls_parse.c` / `clpi_parse.c` 一致，读取后均落在字节边界；CLPI `attrBytes=4`（32 bit）与 libbluray 一致。
- 越界防护：`BinaryCursor.seek` 对负值、超窗长度均抛错；u32 相加在 JS number 下不回绕。

## Findings

### P1-P1-1: [P1] 可选 UHD 元数据解析失败会把整个 index 升级为 fatal，导航全丢

- 位置: `packages/bdmv-parser/src/parser.ts` `parseIndexAppInfo`(65-77)、`parseIndexUhdExtension`(79-99)、调用点(106-107)；`parseBdmv` 以 `critical=true` 解析 index（456）
- 触发条件（任一）:
  - 扩展区 `length < 8`（79-81）；`ext` 落在 0..39 指向头部保留区；`address + entryLength > length + 4`（87）；3.1 payload `payloadLength < 8` 或越界（90）；
  - AppInfo `length` 非 34 且 `end > indexSection`（66-68）。
- 影响: `parseIndex` 抛 `ContractError` → `choose()` 记录 error；BACKUP 若为同字节坏副本则升级为 `fatal BDMV_REQUIRED_FILE_MISSING`，`entries` 变空、`discInfo` 为 null。一个**可选**的 HDR 元数据损坏，等价于整张盘不可解析：`inspect`/`extract`/`convert` 全部 exit 1 且不产出任何文件。
- 参考实现证据（本地可核对）: `index_parse.c:284-289` 调用扩展解析后**不检查返回值**；`_parse_indx_extension_hevc` 在 `len < 8` 时返回 0（`index_parse.c:203-207`）。libbluray 只把主 index section 的失败当致命，这一点由 `:284-289` 直接支持。
- **证据边界**: `extdata_parse.c`（`bdmv_parse_extension_data` 的定义）不在本地缓存中，无法核对它本身如何处理 handler 返回值。上一版写的"`extdata_parse.c` 同样忽略 handler 返回值"属推断，已撤回；本 finding 的结论只依赖上面两个可核对的调用点与返回路径。
- 已固化为期望: `packages/bdmv-parser/src/parser.test.ts:388-401` 断言截断/越界后 `entries` 长度为 0。
- 修复方向: 把 AppInfo/UHD 扩展解析包成"总函数"——内部 catch 后返回 `null` + 一条 `warning` 诊断（或 `{value, diagnostics}`），index 主 section 仍是唯一 critical 区域；测试改为"entries 仍为 2，且新增一条 warning"。若产品上确实希望 UHD 元数据损坏即失败，应在 spec 写明并保留 `fatal`，而不是由实现偶然决定。

### P1-P2-1: [P2] 扩展区上界用"声明长度"而非文件长度，比参考实现更严格

- 位置: `parser.ts:80-90`（`end = r.offset + length`、entry 上界 `length + 4`、payload 上界 `end`）
- 触发条件: extension 块 `length` 少报（entry 表/payload 实际仍在文件内）；或 entry `address + entryLength` 落在 `length` 之外。
- 影响: 同 P1-1 的爆炸半径（fatal index），但触发面比参考实现更宽——libbluray 的 entry 上界是 `bits->end`（文件尾），`length` 只用于 `length < 1` 判空。
- 置信度: 中（无真实反例；仓库内 UHD 样本 `ext=372`、`length=32` 恰好齐文件尾）
- 修复方向: entry/payload 上界改为 `data.length`（或 `Math.min(end, data.length)`），`length` 仅作一致性诊断。

### P1-P2-2: [P2] 新增的 CLPI 长度校验会整条丢弃"字段不自洽但可播"的 CLPI/Playlist

- 位置: `parser.ts:267-270`（`tsTypeLength > infoEnd - offset`、`tsTypeLength < 5`）、`parser.ts:278-289`（`seqLen < 2`、`seqEnd > data.length`）
- 触发条件: `sequence_info_start_addr != 0` 但长度字段为 0/1，或长度字段少报而记录实际落在文件内。
- 影响: `choose()` 丢弃该 CLPI（非 fatal，但触发 `BDMV_MISSING_CLPI`，进而影响 graph、`computeMediaClosure`、media plan）；MPLS 侧同理会让整个 Playlist 消失。
- 参考实现证据（事实）: `clpi_parse.c:222-263` 不读/不校验 sequence 长度字段，直接 seek 后按 count 读记录；TS type info 只在 `bs_seek_byte` 失败时让 clip 失败，不与 `infoLen` 比较。
- 置信度: 中低（79 个真实 CLPI 全部规范：`infoLen=176/192`、`seqLen=22`、`tsTypeLength=30`）
- 修复方向: 长度字段不自洽时记诊断并按文件边界继续；仅在记录确实读越文件时失败。

### P1-INFO-1: [INFO] 0x24 只读取部分属性位，注释与实现不符

- 位置: `parser.ts:198-201`（MPLS，读 `skip(1)+read(4)+read(4)` = 2 字节）、`parser.ts:309-313`（CLPI，读 24 bit）
- 事实: 两处都停在字节边界且 `seek(attrEnd)` 兜底，不会错位；CLPI 的 `dynamicRangeType`/`colorSpace` 与参考实现取值一致（真实记录 `24 67 30 01 00` → dr=0, cs=1）。但 `cr_flag` / `hdr_plus_flag` 未读（CLPI 注释写作 "oc_flag, cr_flag" 实际只是丢弃两个 bit），MPLS 侧 HDR10+ 信息不可得。
- 建议: 若要暴露 HDR10+，补读最后 2 bit 并扩展模型；否则修正注释，避免误导"已解析 cr_flag"。

### P1-INFO-2: [INFO] 新增诊断路径落到 `offset: 0`

- 位置: `parser.ts:360` 的 offset 提取正则只匹配 `offset/<数字>` 或 `at <数字>`
- 事实: 新分支使用 `/appInfoLength`、`/extensionLength`、`/sequenceInfoLength`、`/tsTypeInfoLength` 这类命名路径，都会被解析成 0，诊断无法定位到字节。
- 建议: 统一用数值 offset（如 `/offset/${lengthOffset}`），或扩展提取规则支持命名路径。

### P1-INFO-3: [INFO] 真实 UHD 样本的 0x24 路径未被断言

- 位置: `parser.test.ts:381-386` 只断言 `discInfo`；真实数据中恰有 17 条 MPLS 0x24（`attrLen=5`）与 13 条 CLPI 0x24（`attrLen=21`）
- 影响: `runtime-web` 的 corpus 测试只保证"不崩 + 边可解释"，无法区分"解析成功"与"clip 被丢弃后边变成 unresolved"。
- 建议: 对 `battle-royale-uhd` 补 `playlists`/`clips` 断言（例如 MPLS `00006` 的 dr/cs、CLPI `00011` 的 dr/cs）。

## 漏检复盘

- 默认分支 / 未知输入: 已核对 index object type（0 与未知值均抛错，与 libbluray 一致）、扩展 entry `type/version` 未命中时跳过、MPLS `playbackType` 非 2/3 时 `playbackCount=null`。**未发现新问题**。
- 异步失败 / 前提失效: 本层同步解析，无异步契约。
- 半完成状态 / 重建窗口: 不适用（纯内存解析）。
- 渲染 / 导出 / 编码: 不适用。
- 位级隐式协议: 已逐项核对 skipBits 与 read 混用后的字节对齐、`Math.floor((end-offset)/N)` 计数上界、`length + 4` 魔数语义。对齐正确；上界问题见 P1-2。

## 未覆盖区域

- **参考实现缓存不完整**: 缺少 `extdata_parse.c`（`bdmv_parse_extension_data` 的实现）。INDX 扩展 entry 布局与"上游忽略 handler 返回值"这两点只能依据样本字节和调用点推断，无法逐行对照。若后续要把 `P1-P1-1` 的修复理由写成"与 libbluray 完全一致"，需先补齐该文件。
- 无真实反例可验证 P1-2 / P1-2-2 的实际发生率（仓库样本全部规范）。
- MPLS 0x24 究竟要求 3 个还是 4 个属性字节，本地只有 BDA 白皮书（无位级语法），只能依据参考实现与样本推断；**上一轮 `REVIEW_BACKLOG` X1 登记的 HEVC 属性长度问题本轮已改为 4 字节，但样本不足以证明覆盖了所有真实布局**，建议保留在 backlog 而非直接关闭。
