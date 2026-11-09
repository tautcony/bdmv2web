# G 性能基准

## 环境与样本

- 机器：Apple M4 Pro，arm64，48 GiB 内存
- 操作系统：macOS 27.2，Darwin 27.2.0
- Node.js：v24.18.0
- pnpm：11.25.0
- 基准入口：`corepack pnpm exec node scripts/bench/index.mjs`
- 输出：`test-data/bench/274dbb2.json`，93 条记录；`test-data/bench/` 已加入 `.gitignore`
- 每个 case 连续测量 3 次，使用 `performance.now()` 记录运行时间，并在每次测量后记录基准 Node 进程 RSS。RSS 是共享进程读数，包含之前 case 的分配与保留内存。
- 表内运行时间按“最小值 / 中位数 / 最大值”列出，单位为毫秒。

合成样本包括 200、1000、5000 个 PlayItem 的 BDMV、1000/10000/50000 个 TS 包的 PES、8 MiB 主备 index 比较，以及 1000 个文件的输入文件表。文件表基线对每个文件路径重复解析 root，优化组通过 `buildInputFileTable` 解析一次 root。

真实 BDMV 解析样本来自 `test-data/fixtures/hdmv-navigation/disc-data` 下的 MyGO、Battle Royale UHD、Kyoani OVA、Tamako。`n` 是 BDMV 元数据文件字节数。真实 IGS 输出样本使用七个现有过滤 TS 包文件，按 4093 字节块流式读取并指定 PID `0x1400`；`n` 是过滤包文件字节数。MNU 样本抽取场景并写出 MNU；PNG 样本额外渲染场景图像并写出全部 PNG。真实碟片夹具不含完整 M2TS。

`synthetic-all-features` 端到端样本调用 `parseBdmv` 和 `extractIgsScenes`，捕获两路 MNU、渲染三张 PNG 并写入临时输出目录；输入 BDMV 共 22,106 字节，包含三个 playlist、两个完整场景和两个 IGS stream。该流程不调用 FFmpeg。

参考命令 `bd_info` 和 `bd_list_titles -a` 分别对四个真实碟片目录单独计时。每条记录包含 Node 启动的参考工具子进程墙钟时间；RSS 字段仍是基准 Node 进程读数。两类命令输出的结构字段和 `parseBdmv` 的完整解析、文件图构建范围不同，结果单独列出。

libbluray 1.5.0 的固定参考工具可以运行。通过 `scripts/generate-libbluray-baselines.py` 的生成函数，在临时目录编译工具并生成 9 个 IGS case、5 个 navigation case；生成对象与 `test-data/baselines/libbluray-1.5.0-{igs,navigation}-baseline.json` 完全相同。生成结果只在内存中比较，没有写入基线文件。`scripts/compare-igstools-reference.py` 在当前环境不能运行：Python 缺少 `png` 模块，且没有安装 `igstools` 模块。

## 合成基准结果

| Case | N | 最小 / 中位 / 最大 ms | 分类与结论 |
|---|---:|---:|---|
| `buildGraph` | 200 PlayItems | 1.391 / 1.484 / 2.246 | 可接受。 |
| `buildGraph` | 1000 PlayItems | 7.617 / 7.779 / 8.002 | 可接受。 |
| `buildGraph` | 5000 PlayItems | 66.489 / 67.651 / 78.217 | 可接受。该规模中位耗时低于 100 ms；后续 5000 项中位耗时超过 100 ms 时再评估 graph 构建。 |
| `PesAssembler.append` | 1000 packets | 0.153 / 0.202 / 0.364 | 修复前呈超线性；几何扩容后随包数增长。 |
| `PesAssembler.append` | 10000 packets | 0.830 / 0.866 / 1.359 | 修复前呈超线性；几何扩容后随包数增长。 |
| `PesAssembler.append` | 50000 packets | 3.354 / 4.271 / 4.292 | 修复前呈超线性；几何扩容后随包数增长。 |
| `choose()` primary/backup | 8,388,608 bytes | 8.080 / 8.244 / 8.886 | 修复前存在显著常数浪费；长度检查和逐字节比较后中位耗时约 8 ms。 |
| `buildInputFileTable` 重复 root | 1000 files | 54.593 / 54.882 / 55.168 | 常数浪费；root 每个路径重复解析。 |
| `buildInputFileTable` 单次 root | 1000 files | 27.846 / 28.046 / 28.050 | 修复后中位耗时约快 1.96 倍；计数器断言 root 的 `canonicalDirectory` 调用 1 次。 |

修复前后对比记录来自同一 benchmark harness 的修复前后测量。后续重复运行的读数列在上表，体现当前机器上的波动。

| Case | 修复前最小 / 中位 / 最大 ms | 修复后最小 / 中位 / 最大 ms | 修复后中位耗时变化 |
|---|---:|---:|---:|
| PES 1000 packets | 6.331 / 6.538 / 7.087 | 0.207 / 0.240 / 0.579 | 27.2 倍更快 |
| PES 10000 packets | 260.701 / 278.814 / 288.418 | 0.878 / 0.920 / 1.178 | 303 倍更快 |
| PES 50000 packets | 8781.969 / 8955.748 / 8972.977 | 3.406 / 4.915 / 5.069 | 1822 倍更快 |
| `choose()` 8 MiB | 1039.946 / 1077.561 / 1187.544 | 6.136 / 8.022 / 11.009 | 约 134 倍更快 |

`PesAssembler.append` 使用几何扩容缓冲区，完成 PES 时只复制实际长度。`choose()` 将主备 `raw` 的 hex 字符串比较改为长度检查和逐字节比较。当前重跑的中位值分别为 4.271 ms（50000 packets）和 8.244 ms（8 MiB）。

## 真实 BDMV parse

| Case | 元数据字节数 | 最小 / 中位 / 最大 ms | 解析结果 | 分类与结论 |
|---|---:|---:|---|---|
| `parseBdmv-real/bang-dream-mygo-vol1` | 80,068 | 18.051 / 33.263 / 41.228 | 4 playlists，4 MovieObjects | 真实样本基线；该次运行没有显示需要单独修改的热点。 |
| `parseBdmv-real/battle-royale-uhd` | 218,766 | 80.500 / 80.689 / 81.388 | 22 playlists，24 MovieObjects | 真实样本基线；解析含 249 条诊断。 |
| `parseBdmv-real/kyoani-ova` | 17,412 | 4.447 / 8.101 / 10.528 | 5 playlists，5 MovieObjects | 真实样本基线。 |
| `parseBdmv-real/tamako` | 275,532 | 38.638 / 46.361 / 68.446 | 26 playlists，17 MovieObjects | 真实样本基线；解析含 1037 条诊断。 |

各真实样本完成 BDMV 元数据读取、index/MovieObject/MPLS/CLPI 解析和输入图构建。结果保留为基线；没有基于这些测量改动 parser。

## libbluray 命令计时

| Case | 输入元数据字节数 | 最小 / 中位 / 最大 ms |
|---|---:|---:|
| `libbluray/bd_info/bang-dream-mygo-vol1` | 80,068 | 4.140 / 4.505 / 4.728 |
| `libbluray/bd_list_titles/bang-dream-mygo-vol1` | 80,068 | 4.814 / 5.079 / 5.292 |
| `libbluray/bd_info/battle-royale-uhd` | 218,766 | 4.045 / 4.119 / 4.293 |
| `libbluray/bd_list_titles/battle-royale-uhd` | 218,766 | 5.757 / 6.132 / 6.847 |
| `libbluray/bd_info/kyoani-ova` | 17,412 | 3.980 / 4.222 / 4.438 |
| `libbluray/bd_list_titles/kyoani-ova` | 17,412 | 4.224 / 4.375 / 4.726 |
| `libbluray/bd_info/tamako` | 275,532 | 4.140 / 4.165 / 5.121 |
| `libbluray/bd_list_titles/tamako` | 275,532 | 6.268 / 6.307 / 6.387 |

libbluray 工具输出用于单独观察参考命令开销。命令结果覆盖 disc-info 或 title-list 行为；时间不与完整 `parseBdmv` case 作直接比较。

## 真实 IGS 抽取与输出

| Case | 过滤 TS 包字节数 | 输出 | 最小 / 中位 / 最大 ms | 分类与结论 |
|---|---:|---|---:|---|
| `bang-dream-mygo-vol1/00010/mnu` | 481,536 | 1 个 MNU；7 pages、182 objects、6 palettes | 11.377 / 13.380 / 16.812 | 可接受的 IGS parse/write 基线。 |
| `bang-dream-mygo-vol1/00011/mnu` | 178,560 | 1 个 MNU；2 pages、51 objects、1 palette | 4.058 / 4.206 / 4.678 | 可接受的 IGS parse/write 基线。 |
| `battle-royale-uhd/00002/mnu` | 2,545,920 | 1 个 MNU；21 pages、215 objects、21 palettes | 44.400 / 44.901 / 45.329 | 可接受的 IGS parse/write 基线。 |
| `battle-royale-uhd/00005/mnu` | 328,704 | 1 个 MNU；4 pages、55 objects、4 palettes | 6.760 / 8.191 / 8.243 | 同一输入的 scene-only 输出基线。 |
| `battle-royale-uhd/00005/png` | 328,704 | 1 个 MNU、68 张 PNG | 181.522 / 185.283 / 192.458 | PNG 渲染和写出占主要新增耗时；与同输入 MNU case 配对记录。 |
| `kyoani-ova/00005/mnu` | 211,200 | 1 个 MNU；4 pages、32 objects、4 palettes | 4.394 / 4.405 / 4.657 | 可接受的 IGS parse/write 基线。 |
| `tamako/00005/mnu` | 8,947,968 | 1 个 MNU；7 pages、168 objects、7 palettes | 137.855 / 140.544 / 140.827 | 同一输入的 scene-only 输出基线。 |
| `tamako/00005/png` | 8,947,968 | 1 个 MNU、168 张 PNG | 1179.291 / 1194.749 / 1351.755 | PNG 渲染和写出占主要新增耗时；与同输入 MNU case 配对记录。 |
| `tamako/00043/mnu` | 11,544,960 | 1 个 MNU；7 pages、168 objects、7 palettes | 178.178 / 179.163 / 181.979 | 大型过滤流的 IGS parse/write 基线。 |

同一输入的 MNU 与 PNG case 显示渲染输出的增量：Battle Royale 00005 中位耗时增加约 22.6 倍，Tamako 00005 增加约 8.5 倍。新增耗时与写出 68/168 张 PNG 同时出现。数据支持 PNG 输出是该路径的主要耗时项；本批没有针对渲染算法作修改。

## 合成端到端抽取

| Case | BDMV 字节数 | 最小 / 中位 / 最大 ms | 结果 |
|---|---:|---:|---|
| `extractIgs-export-synthetic-all-features` | 22,106 | 5.587 / 5.688 / 9.372 | 完成 BDMV parse、2 个完整 IGS scene 抽取、2 个 MNU 和 3 张 PNG 写出。 |

该 case 走完整 BDMV 与 M2TS 输入路径，作为端到端功能和耗时基线。

## Tamako 完整 CLI 菜单媒体导出

`test-data/bdmv/tamako-love-story-bd/BDMV/STREAM` 含两个媒体文件：`00004.m2ts` 为 315,211,776 字节，`00005.m2ts` 为 8,957,952 字节。`PLAYLIST/00003.mpls` 的列表区位于偏移 58（`0x3a`），PlayItem 数量字段为 `0x03e7`（999）；parser 输出 999 项。每项均引用 `STREAM/00004.m2ts` 的 524,280–5,439,815 ticks 时间区间、视频 PID `0x1011` 和音频 PID `0x1100` / `0x1101`。

旧导出路径逐 PlayItem 编码。停止旧转换时，staging 已有 49 个 background MP4 和 48 个英文 M4A，转换已运行超过 10 分钟。当前构建按输入路径、Playlist、区间、循环参数、PID、音轨映射和编码设置归组；同组 PlayItem 引用相同文件。

| Case | 编码设置 | PlayItem 映射 | FFmpeg 编码数 | 唯一媒体文件 | 总耗时 |
|---|---|---:|---:|---:|---:|
| Tamako 完整 `convert` | HEVC / CRF 24 / veryfast（默认），FFmpeg 9.0.2 | 1 个主项 + 998 个附加项 | 1 视频 + 2 音频 | 3 | 17.0 s（媒体导出 14.1 s） |

转换写出 13 个 manifest 文件，包体为 108 MiB。`validate --offline` 退出码为 0，manifest 状态为 `partial`；999 个菜单媒体入口指向一个背景视频和两条音轨，`manifest.files` 无重复路径检查错误。运行时 metadata 保留每个 PlayItem 的独立索引。

包构建测试使用 999 个同区间 PlayItem 和 1 个不同区间 PlayItem；媒体 runner 实际调用为 2 次视频编码、4 次音频编码，manifest 含 6 条唯一媒体文件路径和 2 条媒体计划路径。

## Output size reporting

菜单和线性媒体导出在开始、结束时各测量一次输出目录大小，并在结果中返回两次实测值。导出期间按 `maxAssetBytes` 检查当前媒体资产。

## 未优化项

- `buildGraph`：5000 个 PlayItem 的中位耗时为 67.651 ms；后续合成样本超过 100 ms 中位耗时时再评估 graph 构建。
- 真实 BDMV parser 样本：将当前四个碟片的结果作为后续比较基线；新增真实碟片样本超过现有测量波动或出现稳定热点时再评估。
- IGS PNG 输出：同输入的 MNU/PNG 配对测量显示 PNG 输出是主要新增耗时项；后续出现可复现的渲染算法热点时再评估。
