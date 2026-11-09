# offline-media-playback Specification

## Purpose
让包内菜单媒体在高动态范围源上保持正确的亮度与色彩，并把编码质量参数交给调用方决定。

主规格归属：本 delta 与 `export-playable-media` 共享 `offline-media-playback`。归档顺序为先 M5、后 HDR，两份 delta 合并为同一份主规格；本文件不单独声明与该 capability 冲突的编码语义。

## Requirements

### Requirement: 按源动态范围决定输出色彩

系统 SHALL 在编码前读取源视频流的 `pix_fmt`、`color_primaries`、`color_transfer`、`color_space`、`color_range` 与位深，归类为 `hdr10`、`hlg`、`dolby-vision`、`sdr` 或 `unknown`，并据此决定输出色彩标签、位深与滤镜链。无标记的流 SHALL 归类为 `unknown` 并按 BT.709 SDR 编码，不得推断为 HDR。

#### Scenario: HDR10 菜单源

- **WHEN** 源视频流为 `bt2020` + `smpte2084`、位深大于 8
- **THEN** 归类为 `hdr10`，按色彩策略选择色调映射或保留 HDR，不直接截断为 8 位 no-signal 输出

#### Scenario: HLG 与 Dolby Vision

- **WHEN** 源为 `arib-std-b67` 或带 Dolby Vision side data
- **THEN** 分别归类为 `hlg` / `dolby-vision`，只处理基础层并记录丢弃动态元数据的限制

#### Scenario: 无色彩标记

- **WHEN** 源流缺少色彩标记
- **THEN** 归类为 `unknown`，按 BT.709 SDR 编码，不猜测 HDR

### Requirement: 色调映射转换为 SDR

系统 SHALL 默认把 HDR 源转换为 SDR BT.709 8 位输出，使输出按 BT.709 解释并由 `ffprobe` 读出对应标记。转换 SHALL 使用 `zscale`（libzimg）链；该滤镜不可用时按“HDR 保留与降级”要求处理，不引入第二条滤镜链。系统不得使用无法接受 `smpte2084` 的 `colorspace` 滤镜。

#### Scenario: 使用 zscale 链

- **WHEN** HDR 源进入编码且 FFmpeg 提供 `zscale`
- **THEN** 使用 `zscale` 链，`media-plan.json` 记录 `color.filterChain` 为 `zscale-tonemap`

#### Scenario: SDR 源不受影响

- **WHEN** 源为 SDR 或 `unknown`
- **THEN** 不插入色调映射，仅做偶数尺寸约束，输出沿用源标记（缺省 BT.709）

### Requirement: HDR 保留与降级仅告警

系统 SHALL 支持 `preserve` 策略保留源 HDR 标记与 10 位深度。当 `zscale` 不可用且策略为 `tonemap` 时，系统 SHALL 继续完成导出，按保留路径编码，并给出 warning 级 `MEDIA_HDR_TONEMAP_UNAVAILABLE`；不得因缺少滤镜判定构建失败。

#### Scenario: 缺色调映射滤镜

- **WHEN** HDR 源需要色调映射，但当前 FFmpeg 无 `zscale`（libzimg）滤镜
- **THEN** 产物保留 BT.2020/PQ 标记与 10 位深度，`color.filterChain` 记为 `hdr-passthrough-fallback`，诊断含 `MEDIA_HDR_TONEMAP_UNAVAILABLE`，交付状态不变

#### Scenario: 显式保留

- **WHEN** 调用方指定保留 HDR
- **THEN** 输出 BT.2020/smpte2084/bt2020nc 标记与 10 位深度，不插入色调映射

### Requirement: 编码参数由调用方决定

系统 SHALL 接受 `codec`、`crf`、`preset` 与 HDR 策略，允许任意组合，不得因组合不常见而拒绝执行。默认值 SHALL 为 `codec=hevc`、`crf=24`、`preset=veryfast`、HDR 策略为色调映射；当 `codec=h264` 时 `crf` 缺省为 18。显式传入的 `crf` SHALL 原样使用，不做跨编码器换算。

#### Scenario: 默认参数

- **WHEN** 调用方不传编码参数
- **THEN** 以 `libx265`、`crf 24`、`veryfast` 编码，媒体计划记录实际生效值

#### Scenario: 显式参数穿透

- **WHEN** 调用方传入 `codec=h264`、`crf=23`、`preset=fast`
- **THEN** 以 `libx264`、`crf 23`、`fast` 编码，媒体计划与构建报告记录同一组值，不被内部默认值覆盖

#### Scenario: H.264 与 HDR 组合

- **WHEN** 调用方选择 `h264` 且结果为 HDR 标记
- **THEN** 继续编码，并给出 warning 级 `MEDIA_HDR_CODEC_UNSUPPORTED`，记录该组合的 HDR 渲染不在支持范围内

### Requirement: 编码器私有参数写入色彩标记

系统 SHALL 通过编码器私有参数（`-x264-params` / `-x265-params`）写入 `colorprim`、`transfer`、`colormatrix`、`range`，不得依赖 FFmpeg 的 `-color_trc` / `-color_primaries`。HEVC 产物 SHALL 带 `hvc1` 品牌标记。

#### Scenario: HEVC 产物标记

- **WHEN** 输出编码为 HEVC
- **THEN** FFprobe 读出预期的 `color_primaries`、`color_transfer`、`color_space` 与 `hvc1` tag；该检查只证明写入的标记与品牌，不推断任何浏览器或硬件的解码能力

### Requirement: 编码后校验色彩一致性

系统 SHALL 在编码后用 FFprobe 校验产物的 `codec_name`、三个色彩字段与位深是否与计划一致，不一致时以 `MEDIA_OUTPUT_INVALID` 失败并给出期望值与实测值，不得把未通过校验的产物登记为有效资产。

#### Scenario: 标记被丢弃

- **WHEN** 产物缺少色彩标记或位深与计划不符
- **THEN** 报 `MEDIA_OUTPUT_INVALID`，诊断包含字段名、实测值与期望值

### Requirement: 编码参数进入复用判定

系统 SHALL 在 `--overwrite` 复用判定中比较 `codec`、`crf`、`preset` 与 HDR 策略；任一不一致 SHALL 重新编码，不得复用旧媒体。

#### Scenario: 只改质量参数

- **WHEN** 源区间与流声明未变，但本次 `crf` 与旧计划不同
- **THEN** 重新编码而不复用旧背景视频
