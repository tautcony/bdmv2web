# Design

## Context

菜单背景导出把源 Clip 的指定视频 PID 编码成包内视频 + AAC，浏览器用 `<video>` 播放。当前命令（`packages/media-export/src/index.ts:305-310`）：

```
-vf scale=trunc(iw/2)*2:trunc(ih/2)*2 -c:v libx264 -preset veryfast -crf 18
-pix_fmt yuv420p -aspect <源 DAR> -fps_mode passthrough -movflags +faststart
```

UHD 菜单源为 HDR10：BT.2020 原色、PQ（SMPTE ST 2084）传输、10-bit。上述命令把 10-bit 像素按值截断到 `yuv420p`，保留 PQ 编码值，并写出不带色彩标记的 H.264。浏览器按 BT.709 解释未标记的 H.264，PQ 编码值被当作伽马编码值呈现，中低亮度整体抬升，画面呈低对比灰片；BT.2020 系数被当作 BT.709 系数，饱和度同时错误。

`crf`、`preset` 只存在于 `MenuLoopMediaOptions`（`index.ts:139-140`）：函数默认 `crf 18` / `preset medium`（`index.ts:192-194`），`package-builder` 固定传 `veryfast`（`packages/package-builder/src/index.ts:143,151-153`），CLI 没有对应参数。

## Decisions

### D1 默认策略：tone map 到 SDR BT.709

包在普通桌面浏览器中播放。默认把 HDR 源转换为 SDR BT.709：PQ/HLG → 线性光 → Hable tone map → BT.709 伽马与矩阵，输出 8-bit，并写入 BT.709 标记。

`hdrMode` 取值：

| 值 | 行为 | 输出 |
| --- | --- | --- |
| `tonemap`（默认） | HDR 源转换到 SDR BT.709 | 8-bit + bt709 三件套 |
| `preserve` | 保留 HDR，写 HDR 标记 | 10-bit + BT.2020/PQ |

SDR 源在两种策略下都只做矩阵归一化与标记写入，不做动态范围转换。

### D2 源色彩探测

`probeSource` 的 `-show_entries` 增加 `pix_fmt,color_range,color_space,color_transfer,color_primaries,bits_per_raw_sample`，并读取 `stream_side_data` 的 `side_data_type` 用于识别 Dolby Vision（Mastering display 与 Content light level 本次不参与判定：色调映射固定用 `npl=100`，不按片源 MaxCLL 改变参考白）。

分类函数 `classifyDynamicRange(stream)` 输出：

| 分类 | 判定 | 说明 |
| --- | --- | --- |
| `hdr10` | `color_transfer=smpte2084`，或 `color_primaries=bt2020` 且 10-bit | UHD 菜单主路径 |
| `hlg` | `color_transfer=arib-std-b67` | 同策略处理，tone map 参考白不同 |
| `dolby-vision` | 存在 DOVI configuration record side data | 按基础层（BL）当 HDR10 处理，记录 limitation |
| `sdr` | 其余，含 `color_primaries=bt709` | 保持原样，仅写标记 |
| `unknown` | 无任何色彩标记 | 检查 BDMV 层 `dynamicRangeType` 作为提示 |

BDMV 层信号（`Playlist`/`ClipInfo` 的 `dynamicRangeType`）已由解析层输出（`packages/bdmv-parser/src/model.ts:17`）。**实现决定不把它并入判定**：`readSourceColor` 只接收 ffprobe 的流字段，无标记的源归为 `unknown` 并按 SDR 编码。理由是该标记描述的是"流里是否含 HDR 内容"的声明，而色调映射链的选择取决于实际像素格式与传输函数；用声明去驱动滤镜链会在标记与像素不一致的盘上把 SDR 像素送进 PQ 反变换，产生比"直接当 SDR"更差的画面。缺失的源按 SDR 处理是保守且可解释的，代价是这类盘需要用户显式 `--hdr preserve`。

### D3 滤镜链、能力探测与降级

tone map 需要 zimg 提供的 `zscale`：ffmpeg 的 `colorspace` 滤镜不接受 `smpte2084` 作为 `itrc`/`trc`（实测报 `Undefined constant or missing '(' in 'smpte2084'`），只能做矩阵与伽马区间内的转换。

`ffmpeg -filters` 探测一次，按顺序选择：

1. `zscale` 可用：

```
-vf zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=<目标位深>,scale=trunc(iw/2)*2:trunc(ih/2)*2
```

2. `libplacebo` 可用：

```
-vf libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=<目标位深>,scale=trunc(iw/2)*2:trunc(ih/2)*2
```

3. 两者都不可用：不中断构建。按 `preserve` 编码（10-bit + BT.2020/PQ 标记），并写入：

   - 诊断 `MEDIA_HDR_TONEMAP_UNAVAILABLE`，严重级别 warning，消息列出缺失滤镜、当前 ffmpeg 能力以及对画面预期的影响
   - `media-plan.json` 的 `limitations` 增加一条说明当前包内 HDR 素材在 SDR 显示器上的呈现偏差
   - `color.filterChain` 记为 `hdr-passthrough-fallback`

降级路径不改变退出码。`buildMenuPackage` 把警告写进 `manifest.json` 的 `diagnostics`，并在返回值里交给调用方；CLI 把它合并进 `report.json` 的 `diagnostics`（`severity: "warning"`，不重新判定 `status`）。`build` 的 stdout 摘要仍只报诊断条数，不逐条打印——与包内其它 warning 的处理方式一致。

`tonemap` 的峰值取 `npl=100`（SDR 参考白 100 nit）；不使用源 Mastering display metadata 的 MaxCLL 覆盖，保持单一参考点，避免不同盘输出亮度不一致。

### D4 输出色彩标记必须经 `-x264-params` / `-x265-params`

实测 ffmpeg 9 的 `-color_trc` / `-color_primaries` 未写入 libx264 的 VUI：`-color_primaries bt709 -color_trc bt709 -colorspace bt709` 的输出为 `bt709 / unknown / unknown`。改用编码器参数后三项齐全：

```
-x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv
-x265-params log-level=error:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv
```

`preserve` 用 `colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:range=tv`。`-pix_fmt` 与 `-color_*` 保留，编码器参数为标记的写入路径。

### D5 编码器：默认 HEVC，H.264 可选，组合不设限制

编码器选择的改版背景（2026-11 核对的公开资料，不属于验收条件，也不作为浏览器兼容承诺）：

| 浏览器 | H.264 | HEVC |
| --- | --- | --- |
| Safari（macOS 11+/iOS 11+） | 支持 | 支持，含 HDR10（PQ）与 HLG |
| Chrome / Edge 107+ | 支持 | 需要硬件解码器；Windows 另需 HEVC Video Extensions |
| Firefox 134+（Win）/ 136+（macOS）/ 137+（Linux） | 支持 | 硬件解码可用；PQ/HLG 的 HDR 渲染不成立 |

默认 `codec=hevc`。缺少硬件解码或系统扩展的 Windows 浏览器无法播放包内菜单媒体，README 与 `docs/llm-wiki/features/media.md` 说明该取舍及 `--codec h264` 的回退用法。

参数组合不设限制，任意 `codec` × `hdrMode` 均执行：

| 组合 | 行为 |
| --- | --- |
| `hevc` + `tonemap` | 8-bit HEVC Main，SDR BT.709 |
| `hevc` + `preserve` | 10-bit HEVC Main10，BT.2020/PQ |
| `h264` + `tonemap` | 8-bit H.264 High，SDR BT.709 |
| `h264` + `preserve` | 10-bit H.264 High10，BT.2020/PQ；写 warning 诊断 `MEDIA_HDR_CODEC_UNSUPPORTED`，说明浏览器不按 HDR 渲染 H.264 |

HEVC 输出加 `-tag:v hvc1`（Safari 只认可该品牌）。`crf` 默认按编码器区分：`h264` 18、`hevc` 24；显式传入时按原值使用，不换算。`preset` 对两个编码器都使用 `-preset`，默认 `veryfast`。

预算估算维持配置码率假设；实际大小在编码后按 `maxAssetBytes` / `maxOutputBytes` 复核（现有逻辑）。

### D6 输出校验

编码后 ffprobe 输出流，按实际生效策略断言：

| 生效状态 | 期望 |
| --- | --- |
| SDR 输出 | `color_primaries=bt709`、`color_transfer=bt709`、`color_space=bt709`、`pix_fmt` 与位深一致 |
| HDR 输出 | `color_primaries=bt2020`、`color_transfer=smpte2084`、`color_space=bt2020nc`、10-bit |

不一致抛 `MEDIA_OUTPUT_INVALID`，诊断带期望值与实测值。校验使用标记断言，不做帧级像素比对。该错误表示编码结果与请求不符，不降级为警告。

### D7 计划字段与复用判定

`MediaPlan.encoding.video` 增加：

```jsonc
{
  "codec": "hevc",
  "pixelFormat": "yuv420p10le",
  "preset": "veryfast",
  "crf": 24,
  "color": {
    "policy": "tonemap",
    "source": { "primaries": "bt2020", "transfer": "smpte2084", "matrix": "bt2020nc", "range": "tv", "bitDepth": 10, "dynamicRange": "hdr10" },
    "output": { "primaries": "bt709", "transfer": "bt709", "matrix": "bt709", "range": "tv" },
    "filterChain": "zscale-tonemap"
  }
}
```

`matchesReusablePlan` 比较 `codec`、`preset`、`crf` 与 `color.policy`。任一项变化即重新编码，避免改参数后复用旧资产。

复用判定发生在任何 FFmpeg 调用之前（复用路径不探测源、不建工具），因此 `color.filterChain` 与 `source.dynamicRange` 无法参与比较——这两项要等探测后才知道。**已知缺口**：在缺 `zscale`/`libplacebo` 的机器上产出的 `hdr-passthrough-fallback` 资产，装好滤镜后仍会被 `--overwrite` 复用，需要删除输出目录后重建才能获得色调映射版本。保留该缺口是因为反向做法（把降级计划视为不可复用）会让常见环境（Homebrew ffmpeg 无 zimg）每次覆盖都重编 4K 菜单。`docs/llm-wiki/features/media.md` 的排查顺序记录了这条恢复路径。

`exportLinearMedia` 的计划字段同步，滤镜链由同一构造函数生成。

### D8 参数暴露

`MenuLoopMediaOptions` / `LinearMediaExportOptions` 已有 `crf` / `preset`，新增 `codec` 与 `hdrMode`。

`package-builder`：

```ts
export interface MenuPackageInput {
  // ...
  mediaEncoding?: { crf?: number; preset?: MediaPreset; codec?: "h264" | "hevc"; hdrMode?: "tonemap" | "preserve" };
}
```

删除 `packages/package-builder/src/index.ts:143` 与 `:151-158` 的硬编码 `preset: "veryfast"`，改为 `...input.mediaEncoding`。

CLI `convert`：

| 参数 | 取值 | 默认 |
| --- | --- | --- |
| `--crf <n>` | 0–51 整数 | `hevc` 24 / `h264` 18 |
| `--preset <name>` | `ultrafast` / `veryfast` / `fast` / `medium` | `veryfast` |
| `--codec <name>` | `h264` / `hevc` | `hevc` |
| `--hdr <mode>` | `tonemap` / `preserve` | `tonemap` |

非法取值在参数解析阶段以非零退出码失败，消息列出允许值。四个参数写入 `media-plan.json`，并出现在 `build` 的 stdout 摘要与 `report.json` 的媒体段落。`--crf` 缺省时按最终 `codec` 决定默认值，`--crf` 与 `--codec` 的先后顺序不影响结果。

### D9 文档

更新 `docs/llm-wiki/features/media.md`（编码参数表、HDR 策略、HEVC 播放前提）、`docs/llm-wiki/packages/media-export.md`（滤镜链、降级行为、能力要求）、README（ffmpeg 需要 `libx265`、`aac`；`--codec h264` 时还需要 `libx264`；tone map 需要 zimg 或 libplacebo）。

## Verification / Exit Criteria

1. 参数矩阵：`tonemap` / `preserve` × `h264` / `hevc` 四组的 ffmpeg 参数数组与 `pix_fmt` 断言通过；`-tag:v hvc1` 只出现在 HEVC。
2. 编码输出：合成 HDR10 与 SDR 样本经真实命令行编码后，`ffprobe` 的 `codec_name`、`profile`、`pix_fmt`、`color_primaries`、`color_transfer`、`color_space` 与计划一致；不一致报 `MEDIA_OUTPUT_INVALID`。
3. 滤镜链：具备 `zscale` / `libplacebo` 的构建分别验证链选择与返回状态；不具备时该项记 `not-verified`。
4. 复用判定：仅 `codec`、`crf`、`preset` 或色彩策略变化时判定为不可复用。
5. 不在验收范围内：真实 UHD 素材的人工目视比对、任何浏览器或硬件的播放与解码记录。

## Evidence

验证环境：macOS，Homebrew `ffmpeg 9.0.2`（configure 未含 libzimg、libplacebo）。

| 检查 | 结果 |
| --- | --- |
| `ffmpeg -filters \| grep zscale` | 无匹配；调用报 `No such filter: 'zscale'` |
| `colorspace=iall=bt2020:itrc=smpte2084:trc=linear` | `Undefined constant or missing '(' in 'smpte2084'` |
| 现状命令（HDR10 源 → `yuv420p`, crf 18） | 输出 8-bit、无色彩标记 |
| `-color_trc bt709` | 输出 `bt709 / unknown / unknown` |
| `-x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv` | 输出 `bt709 / bt709 / bt709` |
| `libx264 -pix_fmt yuv420p10le -x264-params colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc` | 输出 `bt2020nc / smpte2084 / bt2020` |
| `libx265 -tag:v hvc1 -x265-params colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc` | `hevc / Main 10 / yuv420p10le / smpte2084 / bt2020` |

合成素材：`smptebars` 生成 10-bit、标记 bt2020/smpte2084 的 1 秒 mp4，用于滤镜链与标记断言。

## Risks

- 默认编码为 HEVC：缺少硬件解码或 HEVC Video Extensions 的 Windows 浏览器无法播放菜单媒体，需要 `--codec h264` 重建。该风险由默认值选择承担，文档写明症状与回退方式。
- tone map 依赖构建：标准 Homebrew ffmpeg 不含 zimg，本地默认环境走 HDR 直通降级并给出 warning，画面在 SDR 显示器上仍偏灰。README 说明所需构建能力，不写具体安装命令。
- 4K tone map 为 CPU 密集环节，现有 `timeoutMs` 默认 20 分钟在低配机器上可能不足；本次不新增超时参数。
- Dolby Vision 双轨源只解基础层，动态元数据丢失；`HDR10+` 动态元数据同样丢弃。两者记录为 limitation。
- `h264` + `preserve` 产出 10-bit HDR，浏览器不会按 HDR 渲染，属于用户显式组合的结果，仅以 warning 提示。

## Alternatives Considered

- 仅修标记、保留 HDR 直通：SDR 显示器上仍偏灰，且 H.264 HDR 不被浏览器按 HDR 渲染。
- 仅做 BT.2020→BT.709 矩阵转换（`colorspace` 可用）：色相修正，PQ 伽马残留，画面仍偏灰。
- 同时产出 HEVC 与 H.264 并用 `<source>` 回退：可播放性最好，媒体体积翻倍，运行时加载逻辑需改动。不进入本次范围。
- tone map 不可用时硬失败：构建被环境依赖阻断，用户无法完成转换。本次改为 warning + HDR 直通。
