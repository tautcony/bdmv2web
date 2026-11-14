# Design

## Context

`export` 的两条路径（BDMV 目录、独立流文件）都要为每个可见显示集产出一张全画布 PNG：1920×1080 RGBA 合成为 8.3 MB，再补 1 字节过滤位成为 8.5 MB scanline 交给 deflate。一条 55 MB 的流有 1199 个显示集、799 个可见，主线程同步 level 6 压缩占整个进程 CPU 的 47.6%。

同样在读取阶段，`PsiAssembler.push` 在遇到 `0xff` stuffing 时 `break`，却把"从 stuffing 开始到包尾"的字节留在了 `buffers` 里。下一个 PUSI 包把这段残留 `append` 到新 payload 前面，于是缓冲区每包增长约 184 字节。真实样本上 PID 0 与 0x100 的残留都涨到 3.1 MB，17040 个包各复制一次。

`build` 已有 `ProgressReporter`：命令声明步骤，逐步上报，可选 0..1 比例；TTY 渲染实时行，管道静默或按 10% 增量打印。`export` 没有接入。

## Goals / Non-Goals

- Goals：导出吞吐提升到与产物质量无关的部分（不牺牲 PNG 字节），导出具备与 `build` 一致的进度展示，`--progress` 语义与 `build` 完全相同。
- Non-Goals：改变 PNG 压缩档位默认值；裁剪画布到内容包围盒（会改变产物语义与清单 `width`/`height`）；`render` 命令的逐帧解码（它刻意保持流式以控制内存）；worker_threads 池（见 Risks）。

## Decisions

- **异步 deflate，而不是降低压缩档**：同一批 799 帧实测 `sync level 6` 10.57 s/32.0 MB、`sync level 1` 2.92 s/64.2 MB、`sync level 3` 2.98 s/59.1 MB、`async level 6 并发 4` 2.69 s/32.0 MB。在线程池下档位差异几乎被摊平（`async level 4` 2.52 s/35.2 MB），所以降档换不到时间，只会让产物变大。保留 level 6，产物字节与优化前完全一致。
- **并发度取 4**：Node 的异步 zlib 跑在 libuv 线程池上，默认 4 线程；实测 6/8 路在噪声范围内（2.92 s / 2.83 s vs 3.15 s），多排只会排队。峰值内存由 4 张 8.3 MB 画布 + 扫描线构成，约 70 MiB。
- **Compositing 留在主线程，只把 deflate 搬走**：`renderPgsCanvas` 输出合成好的 RGBA，`renderPgsDisplaySetAsync` 在此基础上异步编码；`renderPgsDisplaySet`（同步）保留原签名与行为，供 `render` 与测试继续使用。`encodeRgbaPngAsync` 与 `encodeRgbaPng` 共用同一套扫描线/分块构造，差别只有 `deflate` 与 `deflateSync`，因此字节必然一致（有用例断言）。
- **清单顺序不变**：解码仍按轨道推进——先写该轨道的 `sup` 记录，再写它的 PNG 记录，避免"所有 SUP 在前、所有 PNG 在后"的改动带来的无谓 diff；进度比例用"已完成显示集 / 全部显示集"在轨道间累计，因此多轨道仍是一条单调进度条。
- **进度步骤与 `build` 同构**：BDMV 输入为 `Parse BDMV structure` / `Extract IGS scenes` / `Extract SUP tracks` / `Decode display sets` / `Write manifest and commit`；流输入为 `Probe stream tables` / `Extract graphics streams` / `Decode display sets` / `Write manifest and commit`。不适用步骤走 `skip`，与 `build` 的 `--type`/`--menu-media` 分支一致。比例只在 `Decode display sets` 上可测（显示集数），其余步骤显示耗时。
- **共用构造入口**：`progressMode()`（读 `--progress`/`--no-progress`）、`countOf()`、`commandProgress()` 移入 `apps/cli/src/progress.ts`，`build` 与 `export` 都只声明自己的步骤与头部字段，不再各自复制 mode 分支。
- **PSI 残留修正**：`0xff` 是 stuffing 的起点，表示该包的段流结束；把 `cursor` 置为 `bytes.length` 后，`bytes.slice(cursor)` 为空，残留不再增长。副产品是修掉一个解析缺陷：旧实现中，若下一个包 `pointer > 0`，残留 stuffing 会被拼到真正的前一段字节之前，导致该段被当作 stuffing 丢弃。

## Risks / Trade-offs

- 线程池只有 4 线程，且与文件 I/O 共用：`--render` 期间小文件写入会与 deflate 争线程。实测该竞争在 799 个 40 KB 写入下可忽略；`mkdir` 已按目录去重，避免每文件一次。
- 主线程仍承担合成与 GC（约 1.5 s / 799 帧），进一步加速需要 worker_threads 池（绕过 4 线程上限）或直接渲染进扫描线布局。两者都会显著增加改动面，收益相对当前 2.4× 有限，留待有真实需求时再做。
- 进度条写入 stderr：管道场景默认静默，`--progress` 显式要求时才输出，因此 JSON stdout 契约与脚本解析不受影响。

## Migration Plan

单次交付，无迁移。`renderPgsDisplaySet` 与 `encodeRgbaPng` 保持原名与行为；新增的异步入口是增量 API。

## Open Questions

None.
