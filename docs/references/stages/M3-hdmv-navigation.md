# M3 — HDMV 导航 VM 参考

对应 change：[tasks.md](../../../openspec/changes/archive/2026-11-04-execute-hdmv-navigation/tasks.md) / [design.md](../../../openspec/changes/archive/2026-11-04-execute-hdmv-navigation/design.md)。

| 来源 | 任务 | 精确入口 | 用途和限制 |
| --- | --- | --- | --- |
| `LIBBLURAY-1.5.0` | 1.1–1.3, 2.1–2.4, 3.1–3.5, 4.1–4.3 | 固定 commit：[`hdmv_insn.h`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/hdmv/hdmv_insn.h), [`hdmv_vm.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/hdmv/hdmv_vm.c), [`mobj_parse.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/hdmv/mobj_parse.c), [`mobj_print.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/hdmv/mobj_print.c), [`register.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/register.c), [`register.h`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/register.h), [`player_settings.h`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/player_settings.h), [`bluray.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/bluray.c), [`strutl.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/util/strutl.c), [`navigation.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/bdnav/navigation.c), [`uo_mask.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/bdnav/uo_mask.c). | LGPL-2.1 实现，可对照 12-byte MOBJ、VM、寄存器与导航；不是 opcode/PSR 规范。 |
| `LIBHDMV-2026-03` | 1.1–1.3, 2.1–2.4, 3.1–3.5, 4.1–4.3 | 固定 commit：[`decode.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/hdmv-insn/src/decode.rs), [`disasm.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/hdmv-insn/src/disasm.rs), [`opcodes.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/hdmv-insn/src/opcodes.rs), [`registers.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/hdmv-vm/src/registers.rs), [`session.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/hdmv-vm/src/session.rs), [`event.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/hdmv-vm/src/event.rs). | Apache-2.0 的另一实现，可用于交叉核对；README 标为 Alpha，不能单独证明覆盖完整。 |
| `BDA-PUBLIC-WHITEPAPERS` | 架构背景 | BD-ROM Part 3 V2.5 (2011) 印刷 pp. 17–24，HDMV mode concepts；BD-ROM Part 3 V3.2 (2018) pp. 3–9，UHD HDMV core-function concepts。来源版本与 provenance 见 [`sources.json`](../sources.json) 和 `.reference-cache/specs/SOURCE.md`。 | BDA 历史白皮书只作其页面覆盖范围内的架构背景；不定义 opcode、PSR 或控制流规范，不称规范正文。 |
| `BDA-BDMV-SPECS` | 访问边界 | BDA 的[格式规范授权说明](https://blu-raydisc.info/format-spec/faq-info.php)。 | 规格书受授权协议管理；此访问状态不阻止按固定实现参考开发， |
| `ITU-H222-2025` | 2.4, 3.1–3.2 | 仅供 PTS/DTS/PES 背景参考；当前 [v10 record](https://www.itu.int/rec/T-REC-H.222.0-202504-I) 及匿名可下载的已替代 2014 PDF 详情见 [README](../README.md#可复现获取). | 不定义 HDMV VM；不得从 PES 时间戳推断 PSR、Call/Resume 或指令控制语义。 |

每个 opcode 应记录固定实现 revision、源文件/位置、许可、原始 12 bytes、测试/golden provenance、执行前后寄存器与 Action/Event 等待条件；若使用白皮书背景，附标题/版本/印刷页码。实现冲突须记录分歧及采用理由。证据不足的行为保留为 unverified；BD-J 执行由浏览器 Java runtime 承担，见[BD-J 支持说明](../../support/bdj-support.md)。来源清单 [`sources.json`](../sources.json)。

## 2026-11-07 — libbluray 1.5.0 导航、逐命令反汇编与完整 CFG 基线

- **参考实现：** VideoLAN libbluray 1.5.0，固定 revision `d75c88e54c893e5cbf4c61d356477655eb435769`。`scripts/generate-libbluray-baselines.py` 调用以下入口：

  | 入口 | 采集内容 |
  | --- | --- |
  | `bd_info <disc>` | First Play、Top Menu、HDMV / BD-J / UNSUPPORTED title 数 |
  | `bd_list_titles -a <disc>` | 每个 title 的 playlist、clip、chapter、angle 与流数量 |
  | `mobj_dump -d <disc>/BDMV/MovieObject.bdmv` | 固定源码 `src/devtools/mobj_dump.c` 与 `src/libbluray/hdmv/mobj_print.c` 编译出的逐对象逐指令反汇编 |
  | `bd_get_disc_info()` + `bd_play()` / `bd_read_ext()` | title id_refs 与 HDMV VM 的 PLAYLIST / TITLE 事件 |

- **原始命令字还原：** `mobj_print.c` 的 `_cmd_to_u32()` 输出 `HDMV_INSN` 位域重新序列化的值。生成脚本的 `raw_command_word()` 按位域布局还原盘上原始 word0，5 个盘 5241 条命令与 `parseBdmv()` 的 12 字节逐字节一致，opcode 一致。
- **index 布局：** `_fill_disc_info()` 把 `titles[0]` 留给 Top Menu、`titles[num_titles+1]` 留给 First Play，index titles 从 `titles[1]` 起。生成脚本按此读取，5 个盘派生的 CFG 与 `buildNavigationGraph()` 逐边一致。
- **入库证据：** [libbluray-1.5.0-navigation-baseline.json](../../../test-data/baselines/libbluray-1.5.0-navigation-baseline.json)。5 盘、54 个 MovieObject、5241 条命令、6286 条 CFG 边。边 `[from,to,kind,resolution]` 由 libbluray 自身反汇编的助记符和它解析出的 index id_refs 独立派生。基线由 `scripts/generate-libbluray-baselines.py` 再生成；再生成后重新统计本节与 `docs/llm-wiki/testing.md` 引用的盘数、MovieObject、命令与 CFG 边计数并同步。

  | Case | MovieObject | 命令 | CFG 边 | title | VM playlist 事件 |
  | --- | ---: | ---: | ---: | ---: | --- |
  | tamako | 17 | 4969 | 5907 | 26 | 1, 2, 3, 57 |
  | kyoani-ova | 5 | 87 | 108 | 5 | 0, 1, 4 |
  | bang-dream-mygo-vol1 | 4 | 56 | 86 | 4 | 0, 2, 3 |
  | battle-royale-uhd | 24 | 113 | 168 | 22 | 1997, 1999 |
  | synthetic-all-features | 4 | 16 | 17 | 3 | 1 |

- **自动化对照：** `apps/cli/tests/integration/libbluray-navigation-baseline.test.ts`（5 例）。逐盘对照 `parseBdmv()` 的 index 条目与对象引用和 `bd_info` / `bd_get_disc_info()`、5241 条命令的字节与 opcode 和 `mobj_dump -d`、`bd_list_titles -a` 的 playlist / clip / chapter 结构，并逐边对照完整 CFG。VM playlist 事件由 `bd_list_titles` 声明且被本项目解析。测试只读入库 JSON 与夹具，运行时不需要本机 libbluray。
- **结果：** 5 个盘全部逐边一致（missing 0 / extra 0）；5241 条命令 byteMismatch 0、opcodeMismatch 0；playlist 结构 missing 0、clipDiff 0、markDiff 0。
- **适用范围：** VM 事件覆盖 `bd_play()` 本次到达的 playlist；静态 CFG 覆盖反汇编出的全部命令。`packages/runtime-web/tests/integration/hdmv-navigation-corpus-dfs.test.ts` 的 DFS 统计是本项目探索器的实现回归 pin，其索引条目数与静态 PLAY_PL 目标由本基线驱动。BD-J 执行属于 runtime-web，不属于 M3 的 HDMV VM 一致性范围。
- **其他参考工具记录：** 固定 commit `ec0e5b27d2852ca6b008719f66aa3324c0b43f28` 的 libhdmv `hdmv-inspect` 在当时登记的 5 个语料盘均以 index 解析 `unexpected end of data` 结束；`hdmv-insn` crate 可独立编译，其分支/opcode 映射输出与 libbluray 当前基准不一致，未纳入入库基线。
