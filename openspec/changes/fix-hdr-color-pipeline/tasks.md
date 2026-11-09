# Tasks

决策已确认，按 1→7 顺序实施。`[x]` 表示代码与测试已落地。7.5 与 7.7 的验收依据为可构造输入、FFmpeg 返回码、滤镜链、ffprobe 元数据与可计算帧数值；人工目视与跨浏览器播放记录不计入本 change 的验收。范围调整见 [scope-changes.md](../scope-changes.md)。

## 0. 决策

- [x] 0.1 单一产物，不做 HEVC + H.264 双份 `<source>` 回退
- [x] 0.2 默认 `codec=hevc`
- [x] 0.3 默认 `hdrMode=tonemap`
- [x] 0.4 tone map 不可用时降级为 HDR 直通 + warning，不阻断构建
- [x] 0.5 `crf` 默认按编码器区分：`hevc` 24 / `h264` 18，显式传入不换算
- [x] 0.6 参数自由组合，不因 `codec` × `hdrMode` 组合拒绝执行
- [x] 0.7 补齐 `specs/offline-media-playback/spec.md` 的 ADDED Requirements（色彩策略、降级语义、编码参数契约）

## 1. 探测

- [x] 1.1 `probeArgs` 增加 `pix_fmt`、`color_range`、`color_space`、`color_transfer`、`color_primaries`、`bits_per_raw_sample`
- [x] 1.2 读取 `stream_side_data=side_data_type` 以识别 Dolby Vision；Mastering display / Content light level 按 D2 决定不参与判定
- [x] 1.3 实现动态范围归类（`readSourceColor`），返回 `hdr10` / `hlg` / `dolby-vision` / `sdr` / `unknown`
- [x] 1.4 决定不做（D2）：不把 BDMV 层 `dynamicRangeType` 并入判定，无标记源按 SDR 编码
- [x] 1.5 单测：各分类的 probe 输入与输出（`color.test.ts`）

## 2. 滤镜链与能力探测

- [x] 2.1 工具阶段增加 `ffmpeg -filters` 探测，得到 `zscale` / `libplacebo` 可用性
- [x] 2.2 实现滤镜链选择（`planVideoColor`），返回 `zscale-tonemap` / `libplacebo-tonemap` / `hdr-passthrough-fallback` / `passthrough`
- [x] 2.3 tone map 不可用时选择 `hdr-passthrough-fallback`：按 `preserve` 编码，写 warning 级 `MEDIA_HDR_TONEMAP_UNAVAILABLE` 与 limitation，不抛错
- [x] 2.4 警告进 `manifest.json` 并在返回值里交出，CLI 合并进 `report.json`；退出码与 `status` 不变（stdout 摘要只报诊断条数，与其它 warning 一致）
- [x] 2.5 单测：能力组合 × 动态范围分类的链选择结果；降级时不产生 error 诊断

## 3. 编码参数

- [x] 3.1 视频参数按编码器与策略生成 `-c:v` / `-pix_fmt` / `-x264-params` 或 `-x265-params` / `-tag:v hvc1`（`videoEncoderArgs`）
- [x] 3.2 编码器检查按实际选择执行：`hevc` 需要 `libx265`，`h264` 需要 `libx264`，音频固定需要 `aac`
- [x] 3.3 `h264` + `preserve` 组合执行编码，并写 warning 级 `MEDIA_HDR_CODEC_UNSUPPORTED`
- [x] 3.4 `crf` 缺省值按最终 `codec` 决定（`hevc` 24 / `h264` 18），与参数书写顺序无关
- [x] 3.5 `exportLinearMedia` 复用同一滤镜链与参数构造函数
- [x] 3.6 单测：`tonemap`/`preserve` × `h264`/`hevc` 四组参数数组断言；`-tag:v hvc1` 只出现在 HEVC

## 4. 输出校验

- [x] 4.1 编码后按生效状态断言 `color_primaries` / `color_transfer` / `color_space` / 位深（`assertEncodedColor`）
- [x] 4.2 不一致抛 `MEDIA_OUTPUT_INVALID`，诊断含期望值与实测值
- [x] 4.3 单测：标记错误、位深错误两类输出

## 5. 计划与复用

- [x] 5.1 `MediaPlan.encoding.video` 增加 `color` 块与 `codec`
- [x] 5.2 `matchesReusablePlan` 加入 `codec`、`preset`、`crf`、`color.policy`（`filterChain`/源动态范围需探测后才知道，见 D7 的已知缺口）
- [x] 5.3 `LinearMediaPlan.encoding` 同步
- [x] 5.4 单测：仅策略或 codec 变化时判定为不可复用

## 6. 参数暴露

- [x] 6.1 `MenuLoopMediaOptions` / `LinearMediaExportOptions` 增加 `codec`、`hdrMode`
- [x] 6.2 `MenuPackageInput.mediaEncoding` 透传，删除 `packages/package-builder/src/index.ts` 里硬编码的 `preset: "veryfast"`
- [x] 6.3 CLI `convert` 增加 `--crf` / `--preset` / `--codec` / `--hdr`，解析期校验并列出允许值
- [x] 6.4 参数写入 `media-plan.json`；缺省值由媒体层决定并在计划里记录实际生效值
- [x] 6.5 测试：`--crf/--preset/--codec/--hdr` 的解析与 `menuMediaEncoding()` 映射（`apps/cli/tests/integration/menu-media-encoding.test.ts`）；`crf 22 / preset fast / codec hevc` 出现在 `media-plan.json` 与 ffmpeg 参数中（`media-export/src/index.test.ts`）

## 7. 文档与验证

- [x] 7.1 更新 `docs/llm-wiki/features/media.md` 编码参数表、HDR 策略、HEVC 播放前提
- [x] 7.2 更新 `docs/llm-wiki/packages/media-export.md` 滤镜链、降级行为、能力要求
- [x] 7.3 README 说明 ffmpeg 所需编码器与 tone map 滤镜能力
- [x] 7.4 用合成 HDR10 素材（bt2020/smpte2084、10-bit）确认降级路径的实际输出标记与 warning
- [x] 7.5 使用具备所需滤镜的 FFmpeg 与合成测试视频验证 `zscale` / `libplacebo` 两条色调映射链：断言滤镜链选择、命令返回状态、编码结果元数据与可测帧数值范围。验收：具备该构建时给出可复现的输入、命令与数值结果；不具备时该项标注 `not-verified`，不阻断本轮交付。2026-11-09：`zscale` 链在 macOS 静态 9.0.2（libzimg）上 pass（`bt709/bt709/bt709`、8 位、YAVG 61.12，全量 71 passed 无跳过）；`libplacebo` 链 not-verified（本机可得构建均未启用该滤镜，不使用容器执行 FFmpeg，链选择由 `color.test.ts` 断言但不作执行证据）。构建来源、SHA256 与命令见 [verification.md](./verification.md)。
- [x] 7.7 用合成 SDR 样本验证编码输出新增 BT.709 标记、未误用 HDR 处理链，且帧级数值回归在预先定义的容差内。验收：`ffprobe` 色彩字段与计划一致；固定容差的帧数值比较通过。2026-11-09：`h264/yuv420p/bt709/bt709/bt709`，YAVG 71.74 → 71.75（容差 2），pass；见 [verification.md](./verification.md)。

### Removed (scope change 2026-11-09)

- 7.6 原任务要求真实 UHD 菜单 Clip 的人工目视比对。该编号不再作为待办任务；记录见 [scope-changes.md](../scope-changes.md)。
- 7.8 原任务要求 HEVC 产物在 Safari、Chrome（有/无硬件解码）与 Firefox 的播放记录。该编号不再作为待办任务。
