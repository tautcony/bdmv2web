# Proposal

## Why

`export` 只接受 BDMV 目录输入。社区外挂字幕封装（如 `.rsks`）与孤立 `.m2ts` 剪辑也是真实的 m2ts 字节流，其 PGS/IGS 负载可以用现有提取管线导出，但当前必须手工搭建 BDMV 结构才能触达 `export`。分析 `test-data/fixtures/sup/` 样本确认：这类文件以 PAT/PMT 声明图形流（stream_type 0x90/0x91），现有 `extractPgsTracks` 与 `extractIgsFromChunks` 已具备按 PID 提取的全部能力，只缺输入分发与 PMT 发现。

## What Changes

- `export` 接受单个 `.m2ts`/`.rsks` 常规文件作为输入：按 PMT stream_type 发现 PGS（0x90）与 IGS（0x91）PID，导出 `.sup` 与 `.mnu`，产物命名以文件 stem 代替 clipId。
- 新增 `@bdmv2web/igs` transport 探测器 `probeTransportStreams`：扫描输入并在第一个 PMT 段处取得 PID → stream_type 声明快照，同时上抛全部传输/PSI 诊断（含尾部杂讯），供 stage 判定降级为 `partial`。
- 独立流导出的 `.sup` 保留源 90kHz 时间戳；`sup-png` 秒数以轨道首个显示集为 0。
- 选择契约：流模式下 `--m2ts` 与未在 PMT 声明的 `--pid` 以 `CLI_EXPORT_SELECTION` 拒绝；无法作为 m2ts 解析的文件以 `EXPORT_INVALID_STREAM` 在写产物前失败。
- BDMV 目录输入行为不变。

## Capabilities

### New Capabilities

- `asset-export`: 形式化 `export` 命令的 BDMV 资产导出行为，并新增独立流文件输入、PMT 图形流发现、时间轴保真与失败报告契约。

### Modified Capabilities

None.

## Impact

新增 `packages/igs` transport 探测模块与 `apps/cli` 输入分类/发现共享模块；`apps/cli/src/commands/export.ts` 增加分发分支；CLI 文档与 `docs/guides/development.md` CLI 状态表同步。不改变 BDMV 模式输出、package-builder、runtime 行为；不提交真实光盘内容 fixture（测试使用合成流）。
