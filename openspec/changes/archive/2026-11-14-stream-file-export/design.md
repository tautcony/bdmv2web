# Design

## Context

`.rsks` 外挂字幕结构与孤立 `.m2ts` 均为 BDAV m2ts 字节流（192 字节包）。现有提取管线中：

- `packages/media-export/src/pgs/pgs-extract.ts` `extractPgsTracks(sourcePath, requests)` 直接扫任意 m2ts 字节文件；尾杂讯产生的传输诊断 `source: null`，不触发其按请求 PID 的 error 门。
- `packages/igs/src/scene/extract.ts` `extractIgsFromChunks(clipId, chunks, expectedPidCues=[], options)` 已含 PMT 0x91 发现与 `.mnu` 字节捕获。
- `packages/igs/src/transport/transport.ts` `PsiAssembler.streamsByPid` 保存 PMT stream_type 表，但没有任何调用方把它用于 0x90 发现。

## Goals / Non-Goals

- Goals：单文件 `.m2ts`/`.rsks` 输入导出 sup/mnu；PMT 图形流发现；时间轴保真；明确的失败与选择契约；BDMV 模式零改动。
- Non-Goals：目录扫描多流文件（保持 BDMV 目录语义）；`list`/`extract` 命令的独立流支持；rsks 私有 trailer 的解析（保留为噪声诊断）；语言声明发现（无结构声明，记录 `und`）。

## Decisions

- **探测器放在 `@bdmv2web/igs` transport 层**（`transport/probe.ts`）：PAT/PMT 探测是传输域职责，`M2tsPacketReader`/`PsiAssembler` 就在该模块；输入为 `AsyncIterable<Uint8Array>`，不引 Node API，CLI 层用 `readFileChunks` 供数。探测器全量扫描输入，直接从第一个 PMT 段字节读取流声明（样本 rsks 的 PMT CRC 无效，`PsiAssembler` 会丢弃该段但 `push()` 仍返回段字节），快照不受后续 PSI_INVALIDATED 影响，并把包括尾部杂讯在内的诊断全部上抛，供 stage 判定降级为 `partial`。
- **PGS 用探测器 PID 列表，IGS 以探测结果为结构 cue**：`extractPgsTracks` 无发现能力，由探测器提供 0x90 PID；IGS 侧 `extractIgsFromChunks` 必须传入 cue（空 cue 且发现到流会被判为 `IGS_PID_CONFLICT` 并丢弃场景），cue 取探测器声明的全部 0x91 PID（与 PMT 一致，通过其一致性校验），`--pid` 选择只作用于产物写出。
- **时间轴保真**：不传 `timestampOffset90k`。`extractPgsTracks` 的 anchor 规则只在首 PTS ≤ 2s 时重定基，源起点 > 2s 的流保留原始 PTS；`sup-png` 秒数传 `origin90k = 首个显示集 pts90k`（与 `render` 独立 SUP 语义一致）。mnu 头本就携带原始 PTS32。
- **保留 PID 过滤**：探测器结果过滤 `pid < 0x20`（样本 PMT 声明 `0x81@PID 0x0000` 的假条目由此排除）；`extractPgsTracks` 的 `validatePid` 亦不接受保留 PID。
- **失败契约**：PAT/PMT 不完整 → `EXPORT_INVALID_STREAM`（写产物前失败）；声明的 0x90 PID 无完整显示集 → 同码包装 `extractPgsTracks` 抛错；流模式 `--m2ts` 与未声明 `--pid` → `CLI_EXPORT_SELECTION`（镜像 `render` 的 `CLI_RENDER_SELECTION` 模式）。
- **命名与清单**：stem 取 `safeAssetStem`；manifest schema 不变，sup 记录 `language: "und"`、`streamNumber` 为发现序号；stdout 契约与 BDMV 模式一致。
- **测试策略**：不提交 >1MiB 二进制与真实光盘内容；集成测试用 `tests/helpers` 中的合成 m2ts 构造器（PAT/PMT/PES + 最小 PGS display set），真实 `.rsks` 结果作为 change verification 中的环境特定证据。

## Risks / Trade-offs

- 尾部杂讯可能伪同步出垃圾包：`findSync` 要求 192 字节间隔双重命中，命中概率低；即使产生 `PSI_INVALIDATED`，重复 PAT/PMT 会重灌 `streamsByPid`。真实样本验证作为证据记录。
- 两侧发现不对称：若杂讯导致 IGS 侧 PMT 晚到，PMT 前的 PES 不参与（与 BDMV 模式行为一致）。

## Migration Plan

单次交付，无迁移。BDMV 路径代码仅移动（`exportAssets` 拆出 `exportAssetsFromBdmv`），行为不变。

## Open Questions

None.
