# Tasks

## 1. 读取路径：PSI 残留

- [x] 1.1 `packages/igs/src/transport/transport.ts`：遇 `0xff` stuffing 时把 `cursor` 推到包尾，残留清空，缓冲区不再逐包增长。

## 2. 解码路径：并行 PNG 编码

- [x] 2.1 `packages/igs/src/rendering/png.ts`：拆出 `rgbaScanlines` / `rgbaPng`，新增 `encodeRgbaPngAsync`（同一套字节构造，仅换异步 `deflate`）。
- [x] 2.2 `packages/media-export/src/pgs/pgs-render.ts`：新增 `renderPgsCanvas` 与 `renderPgsDisplaySetAsync`；`renderPgsDisplaySet` 保持同步与签名。
- [x] 2.3 `apps/cli/src/shared/concurrency.ts`：`mapWithConcurrency`（保序、限流、失败即停止派发）。
- [x] 2.4 `apps/cli/src/shared/pgs.ts`：`writeDisplaySetPngs` —— 4 路并发渲染+编码+写盘，按显示集顺序返回清单记录，目录创建按目录去重。
- [x] 2.5 `apps/cli/src/commands/export.ts`：两条路径改用并行解码，保持"每条轨道 SUP 记录后紧跟其 PNG 记录"的清单顺序。

## 3. 进度展示

- [x] 3.1 `apps/cli/src/progress.ts`：`progressMode` / `countOf` 迁入，新增 `commandProgress` 共用工厂。
- [x] 3.2 `apps/cli/src/commands/build.ts`：改用 `commandProgress`，删除本地重复的 mode 分支与 `countOf`。
- [x] 3.3 `apps/cli/src/commands/export.ts`：两步/五步进度、失败时 `fail`+`finish` 关闭实时行、成功时 `finish` 打印汇总。
- [x] 3.4 `apps/cli/src/cli/program.ts`：`export` 增加 `--progress` / `--no-progress`。

## 4. 验证

- [x] 4.1 单测：`png.test.ts`（异步与同步字节一致、非法尺寸 reject）、`pgs-render.test.ts`（异步等价、`renderPgsCanvas` 像素落位）、`concurrency.test.ts`（保序/限流/失败短路/边界）。
- [x] 4.2 集成：`export-stream.test.ts` 增加"默认静默 / `--progress` 输出步骤与比例"用例。
- [x] 4.3 回归：`synthetic-all-features/BDMV --type all --render` 产物与改动前 `diff -r` 完全一致（15 资产 + 清单，含顺序）。
- [x] 4.4 真实数据：`00000.SumiSora.sc.rsks --render` 800 资产与改动前逐字节一致（`diff -r` 无输出）。

## 5. 文档

- [x] 5.1 `docs/llm-wiki/features/cli-commands.md`：`export` 段落补 `--progress`/`--no-progress` 与并行解码说明。
- [x] 5.2 `docs/llm-wiki/packages/cli.md`：`export` 小节补进度与吞吐。
- [x] 5.3 `docs/guides/development.md`：`export` 用法行补选项。

## 证据（实际运行，2026-11-14）

环境：macOS，Node 24.18.0，`npx tsx --tsconfig apps/cli/tsconfig.dev.json apps/cli/src/index.ts`。

| 场景 | 改动前 | 改动后 |
| --- | --- | --- |
| `probeTransportStreams`（55 MB rsks） | 5.42 s | 0.19 s |
| 渲染+编码 799 个显示集（同一批帧，level 6） | 10.57 s | 2.69 s（异步 4 路） |
| `export 00000.SumiSora.sc.rsks --render` 墙钟 | 19.5 s | 8.0 s（其中 2.0 s 为 `npx tsx` 启动） |
| 同上，`Done in` 步进合计 | 17.5 s | 5.1 s |

步骤耗时（`--progress` plain 输出）：`Probe stream tables` 188 ms · `Extract graphics streams` 384 ms · `Decode display sets` 4.5 s · `Write manifest and commit` 39 ms。

测试：`packages/igs` 91 passed、`packages/media-export` 121 passed + 1 skipped、`apps/cli` 150 passed。

产物一致性：`diff -r /tmp/perf-p /tmp/final-run` 无输出（800 资产 + 清单，PNG 逐字节相同）。
