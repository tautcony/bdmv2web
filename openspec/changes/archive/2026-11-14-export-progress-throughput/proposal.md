# Proposal

## Why

`export --render` 对一条 55 MB 的外挂字幕流实测 19.5 s（`00000.SumiSora.sc.rsks`，800 资产）。CPU profile 显示两个可修的开销，而不是"本来就该慢"：

- `processChunkSync @ node:zlib` 占 47.6%（10.7 s）：799 个 1920×1080 显示集在主线程同步 deflate，level 6。
- `concatBytes` + `PsiAssembler.push` 合计 15%（3.4 s）、GC 15%（3.4 s）：PMT/PAT 的 `0xff` stuffing 被当作段数据留在缓冲区，每个 PUSI 包把上一包的 stuffing 重新拼到前面，缓冲区线性增长到 3.1 MB，拼接退化为二次方。分阶段计时：探测 5.42 s，而提取同一文件只需 0.36 s。

同时，长程导出把全部输出留给最后一行 JSON，没有任何进度反馈；`build` 已有成熟的步骤/进度条渲染，`export` 应当复用。

## What Changes

- `export` 增加 `--progress` / `--no-progress`，复用 `build` 的 `ProgressReporter`：TTY 一条实时行 + 每步一行永久行，管道默认静默，`--progress` 在管道下退化为每 10% 一行。步骤与 `build` 同构（`x/N`、spinner、`[███░░░]`、耗时）。stdout 的 `{stageStatus, output, assetCount}` 契约不变。
- 显示集 PNG 的解压移到 libuv 线程池（4 路并发），Compositing 仍在主线程做；产物字节、`assets-manifest.json` 内容与顺序完全不变。
- 修复 `PsiAssembler` 的 stuffing 残留：`0xff` 表示该包的段流已结束，残留必须清空。同一解析结果下探测从 5.42 s 降到 0.19 s；`extractIgsScenes` 走同一汇编器，长流同样受益。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `asset-export`: 新增导出进度报告契约，并明确解码吞吐优化不得改变产物字节与清单形态。

## Impact

`packages/igs`（transport 汇编器、PNG 编码器）、`packages/media-export`（PGS 画布/异步编码）、`apps/cli`（`progress.ts` 共用工厂、并行解码共享模块、`export`/`build` 接线、`export` 选项）；文档同步 `docs/llm-wiki/features/cli-commands.md`、`docs/llm-wiki/packages/cli.md`、`docs/guides/development.md`。不改变 BDMV 与流模式产物、manifest schema、package-builder 与 runtime 行为；`render` 的逐帧流式解码不在本次范围。
