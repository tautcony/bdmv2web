# Tasks

决策已确认，按 1→7 顺序实施。`[x]` 表示代码与测试已落地；末尾的 7.5–7.8 是必须在真机/真素材上做的验收，尚未完成。

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
- [ ] 7.5 在带 zimg/libplacebo 的 ffmpeg 构建上验证 `zscale-tonemap` / `libplacebo-tonemap` 的标记与亮度分布（本机无该构建，未执行）
- [ ] 7.6 真实 UHD 菜单 Clip 人工目视比对，记录结果与素材来源的匿名描述
- [ ] 7.7 SDR 菜单回归：既有测试全绿，输出新增 BT.709 标记且无画面变化（测试侧已绿；目视部分未做）
- [ ] 7.8 HEVC 产物的跨浏览器播放记录：Safari、Chrome（有/无硬件解码）、Firefox 分别记录结果
