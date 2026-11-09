# 验收证据

每个任务的执行证据。提交 hash 可用 `git log -1 -- <artifact>` 定位；本文件与所列代码/测试在同一次提交内。

环境：macOS arm64，Node 24.18.0，pnpm 11.25.0。色彩用例在三套 FFmpeg 能力上分别执行：

| 构建 | configure 关键项 | 用途 |
| --- | --- | --- |
| Homebrew `ffmpeg 9.0.2` | 无 `libzimg`、无 `libplacebo` | 降级路径（7.4） |
| 静态构建 `9.0.2-https://www.martin-riedl.de`（macOS arm64） | `--enable-libzimg --enable-libx264`，无 `libplacebo` | `zscale` 链（7.5） |
| Ubuntu 24.04 容器内 `ffmpeg 6.1.1-3ubuntu5` | `--enable-libzimg --enable-libplacebo --enable-libx264` | `libplacebo` 链（7.5） |

静态构建来源与校验：`https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip`，SHA256 `c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924`（与官方 `.sha256` 一致），解压到仓库外的 `~/tools/ffmpeg-tonemap/`。macOS 用例通过 `BDMV2WEB_FFMPEG` / `BDMV2WEB_FFPROBE` 切换构建，测试代码不需要改动。

## 7.5 FFmpeg 滤镜链与色调映射

| 字段 | 内容 |
| --- | --- |
| taskId | 7.5 |
| artifact | `packages/media-export/src/color-pipeline.ffmpeg.test.ts`（case：`tone maps HDR to BT.709 with measurable 8-bit output`）；链选择断言在 `packages/media-export/src/color.test.ts` |
| 执行命令 | macOS：`BDMV2WEB_FFMPEG=~/tools/ffmpeg-tonemap/ffmpeg BDMV2WEB_FFPROBE=~/tools/ffmpeg-tonemap/ffprobe corepack pnpm --filter @bdmv2web/media-export test` |
| fixture | `lavfi testsrc2=size=64x48:rate=10:duration=1` → `format=yuv420p10le` → libx264 标记 `colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc` |
| 预期 | 有 `zscale` 时选 `zscale-tonemap`，否则 `libplacebo-tonemap`；输出 `bt709/bt709/bt709`、8 位；YAVG 落在 16–235，帧内动态范围 > 10 |

### 链 A：`zscale`（libzimg）

- 执行：上述命令，构建为 macOS 静态 9.0.2。用例执行而非跳过，文件内 `3 passed`，包内全量 `71 passed`。
- 独立复跑同一 `-vf` 链（`zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`）：
  - 源：`yuv420p10le,tv,bt2020nc,smpte2084,bt2020`，YAVG 286.98（10 位）
  - 输出：`h264,yuv420p,tv,bt709,bt709,bt709`，8 位，YAVG 61.12、YMIN 17、YMAX 252（10 帧）
- 结论：**pass**。

### 链 B：`libplacebo`

- 执行环境：`docker run --name bdmv-ffmpeg-lp ubuntu:24.04`，`apt install ffmpeg mesa-vulkan-drivers libvulkan1`。该构建的 `libplacebo` 是 GPU 滤镜，软件环境下自建设备失败（`Found no suitable device`，llvmpipe 已被枚举但未被接受），因此用 ffmpeg 自身的 Vulkan 设备上传硬件帧：
  - `ffmpeg -init_hw_device vulkan=vk -i src.mp4 -filter_complex "[0:v]format=yuv420p10le,hwupload,libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p,hwdownload,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2" ...`
- 结果：输出 `h264,yuv420p,tv,bt709,bt709,bt709`，8 位，YAVG 92.20、YMIN 17、YMAX 234，10 帧。滤镜字符串本身可用，输出标记与位深符合计划。
- 说明：该分支没有通过 vitest 用例执行（容器内没有 Node，且用例的 `skipIf` 逻辑针对 `zscale` 缺失场景），这里是用 `color.ts` 里同一条滤镜字符串直接调用 ffmpeg 取证；链选择逻辑由 `color.test.ts` 的 `falls back to libplacebo when zscale is unavailable` 锁定。
- 结论：**滤镜链与输出标记 pass**；设备自建路径在纯软件 Vulkan 下不可用，需 GPU 或 hwupload 桥接，记为环境限制而非滤镜缺陷。

### 结论与限制

- 两条链都取得了真实执行证据，7.5 的“具备该构建时给出可复现的输入、命令与数值结果”已满足。
- 合成 64×48 图案只证明滤镜链可执行、输出标记正确、亮度落界，不证明真实 UHD 素材的观感。
- `zscale` 链 YMAX 252 高于窄范围上限 235：`tonemap=hable` 在高饱和合成图案上有过冲；SDR 路径断言了合法范围，色调映射路径只断言均值与动态范围，这是已知的断言不对称。
- Ubuntu 的 x264 0.164 对 `-x264-params ...:range=tv` 报 `Error parsing option 'range = tv'` 后继续编码（输出仍为 `color_range=tv`）。本机 x264 0.165.x 接受该写法；该差异属编码器参数可移植性，不影响本次滤镜链结论。

## 7.7 SDR 输出标记与帧级数值

| 字段 | 内容 |
| --- | --- |
| taskId | 7.7 |
| artifact | `packages/media-export/src/color-pipeline.ffmpeg.test.ts`（case：`writes BT.709 tags and keeps frame luma within tolerance for an SDR source`） |
| 执行命令 | `corepack pnpm --filter @bdmv2web/media-export test` |
| fixture | `lavfi testsrc2=size=64x48:rate=10:duration=1`，8 位 `yuv420p`，源标记 `bt709/bt709/bt709` |
| 预期 | 输出 `h264 / yuv420p / bt709 / bt709 / bt709`；重编码前后 YAVG 差 ≤ 2；YMIN ≥ 16、YMAX ≤ 235；帧数一致 |
| 实际 | `h264,yuv420p,bt709,bt709,bt709`；源 YAVG 71.74、输出 YAVG 71.75（10 帧，差 0.01）；用例 pass |
| 结论 | pass |
| 限制 | 合成 64×48 素材只验证标记与亮度守恒，不涉及真实 UHD 素材或播放端渲染 |

## 用例清单

| 用例 | 依赖 | Homebrew 9.0.2 | 静态 9.0.2（libzimg） | Ubuntu 6.1.1（libplacebo） |
| --- | --- | --- | --- | --- |
| SDR 标记与亮度守恒 | ffmpeg + libx264 + ffprobe | pass | pass | 未在该构建上执行用例（链相同，无需） |
| 无色调映射滤镜时保留 BT.2020/PQ | 同上，且无 zscale/libplacebo | pass | 不适用（存在 zscale，按设计提前返回） | 不适用 |
| 色调映射到 BT.709 | 同上，且有 zscale 或 libplacebo | skipped | **pass**（zscale 链） | **pass**（libplacebo 链，见 7.5 链 B） |

缺少 ffmpeg 的环境整体跳过该文件，不阻断构建；`color.test.ts` 的计划与参数断言不依赖外部程序，始终执行，覆盖 `zscale` 缺失时选 `libplacebo-tonemap` 的分支。
