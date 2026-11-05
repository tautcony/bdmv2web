# Tasks

前置依赖：establish-core-contracts。接口可提前消费；完成集成验收前必须取得上游契约及相关验收。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。任务完成状态以勾选及对应验证记录为准。

## 1. 发现及协议基线

- [x] 1.1 实现BDMV自身/直接父目录发现；验收：中文/空格、大小写候选、歧义和symlink负例符合规格。
- [x] 1.2 按 design 的主备表实现整文件回退；验收：有效主、缺失主、损坏主、未知版本、双有效冲突、双无效逐行有测试及实际来源。
- [x] 1.3 登记index/MOBJ/MPLS/CLPI/sound候选版本、字段依据与固定参考revision；验收：每种格式都有独立字节fixture，未知版本不误报支持。

## 2. 结构解析

- [x] 2.1 实现index入口/标题/访问属性；验收：First Play/Top Menu/HDMV/BD-J各自目标及索引正确，混合入口不丢失。
- [x] 2.2 实现MOBJ容器、对象属性、12字节raw命令与精确源偏移；验收：两记录golden一致，截断/异常count不补零。
- [x] 2.3 实现MPLS PlayItem/IN-OUT/Mark/STN/UO mask；验收：两PlayItem章节及单位正确，非法Mark可定位。
- [x] 2.4 保留SubPath/角度/连接属性及支持状态；验收：高级播放标记完整交给M5，不能在归一化中消失。
- [x] 2.5 实现CLPI ProgramInfo/CPI/EP映射及PID/语言/编码；验收：时间与SPN黄金数据一致，段越界安全失败。
- [x] 2.6 实现sound条目/编码/采样信息及有界样本范围；验收：多条声音和截断负例，未输出假WAV。
- [x] 2.7 解析并保留MPLS/CLPI HEVC视频流的色彩空间与动态范围字段；验收：字段与视频流来源可追踪，未声明值保持未知。

## 3. 图与CLI交接

- [x] 3.1 建立类型化引用图、missing/unresolved与全部声明；验收：缺STREAM/CLPI/对象、PID冲突、循环和未解码命令边可追踪且遍历有界。
- [x] 3.2 接入inspect JSON/文件输出与支持预测；验收：stdout可解析，计数不删BD-J，analysisStage=structural。
- [x] 3.3 接入extract结构产物/raw源映射/manifest；验收：输出事务完成且源文件字节不变，未接IG阶段明确声明；不生成源目录哈希。
- [x] 3.4 提供M2/M3消费ParsedDisc的集成fixture；验收：入口/轨道/raw命令来源一致，结构成功不宣称全路径已验证。

## Remaining evidence gaps

- 2.4 now has a media-plan handoff test that preserves PlayItem codec/STC/connection/UO/still/angle markers and SubPath/SubPlayItem codec/STC/sync markers. Advanced playback remains partial/unsupported; this verifies retention, not normative semantics or playback.

## Completed evidence notes

- 3.1 now has a cycle-safe bounded traversal API with explicit unresolved edges, missing targets, and an unvisited frontier; synthetic cycle and node-budget cases are covered in `packages/bdmv-parser/src/parser.test.ts`.
- 3.4 uses `m1-m2-m3-source-handoff` in `packages/igs/test/m1-m2-m3.integration.test.ts`; the fixture checks First Play to MovieObject source, MPLS/CLPI audio PID and coding match, raw command source through M3 graph, M2 IGS extraction, and structural-only partial status.
- 2.7 reads HEVC (`codingType=0x24`) dynamic-range and color-space nibbles from MPLS STN and CLPI ProgramInfo using the respective field order in pinned VideoLAN libbluray 1.5.0 `mpls_parse.c:156-174` and `clpi_parse.c:60-84` (`d75c88e54c893e5cbf4c61d356477655eb435769`, LGPL-2.1). Parsed streams retain source file and record offset; non-HEVC metadata is `null`, while explicitly encoded zero values remain `0`. `buildM1PlaylistWithHevcVideo` and `buildM1ClipInfoWithHevcVideo` exercise populated/zero fields and source locations. `corepack pnpm --filter @bdmv2web/test-fixtures build`, `corepack pnpm --filter @bdmv2web/bdmv-parser test` (50 passed), and typechecks for `bdmv-parser`, `igs`, and `media-export` passed. Per user decision, the pinned libbluray implementation is accepted as the format reference in place of an independent parser/player comparison.
