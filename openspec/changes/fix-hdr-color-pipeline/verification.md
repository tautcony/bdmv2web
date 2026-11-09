# 验收证据

每个任务的执行证据。提交 hash 可用 `git log -1 -- <artifact>` 定位；本文件与所列代码/测试在同一次提交内。

环境：macOS，Node 24.18.0，pnpm 11.25.0，Homebrew `ffmpeg 9.0.2`（configure 未含 libzimg、libplacebo）。

## 7.5 FFmpeg 滤镜链与色调映射

| 字段 | 内容 |
| --- | --- |
| taskId | 7.5 |
| artifact | `packages/media-export/src/color-pipeline.ffmpeg.test.ts`（case：`tone maps HDR to BT.709 with measurable 8-bit output`） |
| 执行命令 | `corepack pnpm --filter @bdmv2web/media-export test` |
| fixture | `lavfi testsrc2=size=64x48:rate=10:duration=1` → `format=yuv420p10le` → libx264 标记 `colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc` |
| 预期 | 有 `zscale` 时选 `zscale-tonemap`，否则 `libplacebo-tonemap`；输出 `bt709/bt709/bt709`、8 位；YAVG 落在 16–235，帧内动态范围 > 10 |
| 实际 | 本机 `ffmpeg -filters` 无 `zscale` 与 `libplacebo`，用例按 `skipIf` 跳过，输出 `1 skipped`；降级路径由同一文件的相邻 case 实测（输出 `h264,yuv420p10le,bt2020nc,smpte2084,bt2020`） |
| 结论 | **not-verified**：滤镜链选择与编码参数由 `color.test.ts` 锁定，真实色调映射在本机构建上无法执行 |
| 限制 | 需要带 libzimg 或 libplacebo 的 FFmpeg；具备该构建时同一条用例自动执行断言，不改测试代码 |

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

| 用例 | 依赖 | 本机结果 |
| --- | --- | --- |
| SDR 标记与亮度守恒 | ffmpeg + libx264 + ffprobe | pass |
| 无色调映射滤镜时保留 BT.2020/PQ | 同上，且无 zscale/libplacebo | pass |
| 色调映射到 BT.709 | 同上，且有 zscale 或 libplacebo | skipped（not-verified） |

缺少 ffmpeg 的环境整体跳过该文件，不阻断构建；`color.test.ts` 的计划与参数断言不依赖外部程序，始终执行。
