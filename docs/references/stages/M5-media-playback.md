# M5 — 媒体导出与播放参考

对应 change：[tasks.md](../../../openspec/changes/export-playable-media/tasks.md) / [design.md](../../../openspec/changes/export-playable-media/design.md)。

| 来源 | 任务 | 可用内容 | 使用边界 |
| --- | --- | --- | --- |
| `FFMPEG-DOCS`, `FFMPEG-FORMATS`, `FFMPEG-SEEK` | 2.1–2.5, 3.1–3.4 | [CLI `-map`/`-progress`](https://ffmpeg.org/ffmpeg.html), [`-ss`/seek](https://ffmpeg.org/ffmpeg.html#Main-options), [MOV/MP4 `+faststart` 与 concat](https://ffmpeg.org/ffmpeg-formats.html), [ffprobe 流与容器信息](https://ffmpeg.org/ffprobe.html). | 在线文档会更新。锁定实际 build、版本、hash 和 configure flags；以参数数组启动。编码器可用性、配置和许可因 build 而异。seek 受关键帧和 demuxer 影响，应实测一帧误差要求。 |
| `FFMPEG-RELEASES` | 2.1–2.3 | [官方发行下载](https://ffmpeg.org/download.html), [上游 git](https://git.ffmpeg.org/ffmpeg.git). | 应选择固定发行版/commit 并记录二进制 hash；本索引未替项目选定 FFmpeg 版本。 用 ffprobe 检查输出，不能只看进程退出码。 |
| `LIBBLURAY-1.5.0` | 1.2, 2.4, 3.1–3.6 | 复用 M1/M2/M3 的解析参考；固定 [PG 解码器](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/pg_decode.c), [图形处理器](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/graphics_processor.c), [RLE](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/rle.c). | 只用于输入映射和语义交叉核对，不证明转码或字幕渲染完整。 |
| `LIBHDMV-2026-03` | 3.5 | 固定版本 PGS [`decode.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/pgs/src/decode.rs), [`palette.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/pgs/src/palette.rs), [`rle.rs`](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/pgs/src/rle.rs). | PGS 是字幕图形，IGS 是菜单交互，必须使用不同解码路径和 fixture。Alpha 代码只作交叉核对，不能充当像素 golden。 |
| `PNG-SPEC`, `ITU-BT709` | 2.2, 3.5, 3.6 | [PNG 第三版](https://www.w3.org/TR/png-3/)定义 PNG chunk、采样、alpha 和色彩元数据。ITU [BT.709-6 记录](https://www.itu.int/rec/R-REC-BT.709/en)提供适用的 HDTV 色度参数。 | PNG 不定义 Blu-ray 调色板转换；只有源内容指明时才采用 BT.709。应单独固定转换矩阵、取整、alpha 规则和像素 golden。 |
| `ITU-H222-2025` | 2.4, 3.1–3.2 | 一般 TS/PES 时间戳基础；v10 记录和历史 2014 PDF 状态见 [README](../README.md#可复现获取). | 本环境无法匿名获取 v10 PDF，旧版已被替代。两者都不覆盖 Blu-ray 私有约束。 |
| `MDN-MEDIA` | 2.5, 3.1–3.4, 4.2 | [`HTMLMediaElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement), [`play()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play). | 浏览器 codec 和平台支持有差异；需验证真实 `file://` 播放链路，切轨不依赖浏览器支持不一致的 `audioTracks`。 |

各项时间映射仍以本项目明确的 `Time90k`、半开区间、媒体时间轴规格为准。参考版本、许可与获取方式在 [`sources.json`](../sources.json)。
