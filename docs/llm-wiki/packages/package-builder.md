# `@bdmv2web/package-builder`

把一个已解析、已提取的菜单写成交付目录：`index.html`、`runtime/*.js`、`assets/*`、清单与报告。不做解析、不做判定。

## 入口

```ts
buildMenuPackage(input: MenuPackageInput): Promise<MenuPackageResult>
```

`MenuPackageResult` 只含 `diagnostics`（即写进 `manifest.json` 的那一份）。交付状态不进返回值：`status` 由调用方在打包前决定，而媒体编码警告只有打包后才知道，所以用返回值把它们交出去，由调用方并入 `reports.json`。

`MenuPackageInput` 关键字段：`outputDirectory`、`title`、`ir`、`scene`、`popupScenes`、`menuScenes`、`menuPlaylistIds`、`preMenuPlaylistIds`、`status`、`entryCounts`、`playerProfile`、`vmLimits`、`vmPrograms`、`vmEntries`、`externalTargets`、`bdmvPath`、`vmInitialProgramId`、`vmFirstPlayProgramId`、`graphics`、`pngLimits`、`pngLevel`（包内字幕画布的 deflate 档位，默认 6）、`soundEntries`、`soundBytes`、`menuLoopMedia`、`mediaEncoding`、`additionalMenuMedia`、`pgsTracks`、`pgsLimits`、`diagnostics`、`reuseMediaFromDirectory`、`onMediaProgress`、`runtimeVersion`。`pngLimits`、`pgsLimits`、`runtimeVersion` 为有默认值的可选项。

`mediaEncoding`（`MenuMediaEncoding`）是唯一暴露编码参数的入口：`codec`（`h264`/`hevc`）、`hdrMode`（`tonemap`/`preserve`）、`crf`、`preset`。Builder 只做透传，不解释语义——缺省值、crf 与编码器的对应关系都由 `media-export` 决定。

`status` 由调用方决定（CLI 用 `decideDelivery`）；库调用默认 `partial`。Builder 不根据自身产物提升状态。

## 产物

| 路径 | 必需 | 内容 |
| --- | --- | --- |
| `index.html` | 是 | 舞台 + `<video id="menu-background">` + `<audio id="menu-audio">` + 两个 Canvas + 启动/静音按钮 + 状态区 |
| `runtime/disc-data.js` | 是 | `globalThis.__BDMV_MENU_DATA__ = { ir, title, scene, popupScenes, menuScenes, menuPlaylistIds, menuPlaylistMarks, preMenuPlaylistIds, pgsTracks, vmPrograms, profile, limits, externalTargets, vmEntries, vmInitialProgramId, vmFirstPlayProgramId, inputConfig, sounds, media, menuMedia }` |
| `runtime/assets-data-NNN.js` | 是 | `globalThis.__BDMV_MENU_ASSETS__[i] = [{ id, dataUrl, byteLength }]`，PNG 以 data URL 嵌入 |
| `runtime/app.bundle.js` | 是 | `runtime-web/src/browser.ts` 的 esbuild IIFE 产物 |
| `runtime/style.css` | 是 | 全屏舞台、letterbox、状态提示、静音按钮样式 |
| `runtime/bdmv-config.js` | 有外部播放时 | `globalThis.__BDMV_BDMV_PATH__` |
| `README.md` | 是 | 状态、背景循环说明、静音/外部播放/校验命令 |
| `manifest.json` | 是 | 状态、入口计数、文件清单（路径/类型/是否必需/字节数）、诊断、profile、资产 |
| `asset-manifest.json` | 是 | 音效、媒体、PGS 轨道细节（不入 `manifest.files`） |
| `reports.json` | 是 | 顶层保存共享诊断；`compatibility` 保存交付状态、profile 和外部依赖（不入 `manifest.files`）。`validate` 写入当前检查与覆盖证据 |
| `external-targets.json` | 有外部播放时 | 播放列表/PlayItem/Mark → 源 M2TS 目标 |
| `media-plans/playlist-<id>-pi<n>-clip-<clipId>.json` | 有本地媒体时 | 每次 `exportMenuLoopMedia` 的计划 |
| `assets/audio/sound-N.wav` | 被引用时 | 由 `sound.bdmv` 采样区间转 WAV |
| `assets/media/playlist-<id>-pi<n>-clip-<clipId>/background.mp4`、`audio-*.m4a` | 有本地媒体时 | ffmpeg 产物 |

`manifest.files` 排序按路径 `localeCompare("en")`；`reports.json` 与 `asset-manifest.json` 被显式排除（它们是报告元数据，不是载荷）。

## 产物片段生成器

`buildMenuPackage` 内部用这些函数拼出单个产物，也可单独调用做局部改动：

| 函数 | 产出 / 作用 |
| --- | --- |
| `createReadme(title, backgroundLoops, externalPlayback, status)` | `README.md` 正文 |
| `createCompatibility(metadata, externalPlayback)` | `reports.json.compatibility` 对象 |
| `createAssetBatchScript(batch)` | 单个 `runtime/assets-data-NNN.js` 的内容 |
| `packagedMediaMetadata(media)` | `manifest`/`asset-manifest` 里的媒体元数据 |
| `runtimeAudioTrackMetadata(track)` | 单条音轨的 `streamNumber` 与 `psrStreamNumber` 映射 |

## 脚本与安全

`serializeSafeScriptData(value)`：`JSON.stringify` 后把 `<`、`>`、`&`、U+2028、U+2029 转成 `\uXXXX`。这样标题里的 `</script>` 只会作为数据出现，不会截断脚本。

`index.html` 脚本顺序固定：`runtime/bdmv-config.js`（可选）→ `runtime/disc-data.js` → `runtime/assets-data-*.js` → `runtime/app.bundle.js`，全部 `defer`。没有 `type="module"`。

## PNG 批次

`makePngBatches(assets, { maxAssetBytes = 1 MiB, maxBatchBytes = 4 MiB, maxTotalBytes = 64 MiB })`：

- 每个资产必须是 PNG（校验 8 字节签名），否则 `TypeError`。
- 单个资产超 `maxAssetBytes` 或 `maxBatchBytes` 直接失败；总量超限失败。
- 只在 `id` 层面保留引用；`dataUrl` 为 `data:image/png;base64,...`。

包内图形只允许 PNG；非 PNG 字节不会进入批次。

## 音效

`convertSounds(entries, sourceBytes, scene)`：

- 只支持 48 kHz、16-bit、单/双声道 PCM（`channelCode` 1/3、`sampleRateCode` 1、`bitsPerSampleCode` 1）。
- 采样区间必须落在 `sound.bdmv` 内且长度为 `channels * 2` 的整数倍，否则 `SOUND_RANGE_INVALID`。
- 输出 `assets/audio/sound-<index>.wav`（RIFF/WAVE，样本字节序转为小端）。
- 缺失条目 `SOUND_REFERENCE_MISSING`，格式不支持 `SOUND_FORMAT_UNSUPPORTED`。

## 媒体

- 两种输入都走 `menuMediaPaths()`：目录 `assets/media/playlist-<id>-pi<n>-clip-<clipId>/`，计划 `media-plans/<同一名字>.json`。
- `menuLoopMedia` → `exportMenuLoopMedia`，写 `background.mp4` 与音轨计划；`additionalMenuMedia` → 每个播放列表 PlayItem 一份，共用同一模板。目录名里的 `<id>` 是 `<id>.mpls` 的编号、`<clipId>` 是 `BDMV/STREAM/<clipId>.m2ts` 的编号，PlayItem 补零到两位。
- 等价引用（同一 Playlist/PlayItem/clip/区间/流）共用一次转码，后来的输入引用先前的目录，不再单开一份；被引用的一方没有编码动作，所以 Builder 为它补一个 `state: "end"` 的 `onMediaProgress` 事件（`reused: true`），使进度按计划里的 clip 数推进。
- `reuseMediaFromDirectory` 只在旧计划与本次输入完全匹配时复用，否则重编码（由 `media-export` 判定）。
- 编码参数由 `mediaEncoding` 透传给两次导出调用，Builder 不写死 `preset`/`crf`。
- 每个导出结果里的 `warnings`（HDR 色调映射缺失、H.264 + HDR 等）转成 `diagnostics` 条目，`severity: "warning"`，按 `code` 去重后写进 `manifest.json`。警告不改变 `status`，出包视为完成。

## 运行时打包

`buildMenuPackage` 末尾用 esbuild 直接读 `packages/runtime-web/src/browser.ts`：

```ts
alias: {
  "@bdmv2web/hdmv": ".../packages/hdmv/src/index.ts",
  "@bdmv2web/media-export/external-targets": ".../packages/media-export/src/external-targets.ts",
}
```

这是当前唯一的源码路径耦合：改 `runtime-web` 的入口文件名或这两个导入路径会同时影响 `package-builder` 的构建。

## 测试

`src/index.test.ts` 覆盖脚本转义、PNG 批次上限、音效转换、清单字段、profile 嵌入、媒体元数据。

## 改动入口

| 需求 | 位置 | 同步 |
| --- | --- | --- |
| 新增包内文件 | `files` 数组 + 实际写文件的分支 | `test-runner/src/package-audit.ts`（如需审计）、[features/offline-menu.md](../features/offline-menu.md) |
| 新增 `disc-data.js` 字段 | `createDataScript` 的调用参数 + `runtime-web` 的 `PackageData` | 两侧同时改，否则浏览器读不到 |
| 改 HTML 结构 | `createMenuIndexHtml` | `runtime-web/browser.ts` 的 `getElementById`、`style.css` |
| 改清单格式 | `manifest` 对象 | `test-runner` 的 `parseManifest` 与 `MANIFEST_*` 检查 |

不要在这里重新计算交付状态，也不要加内容哈希/指纹字段。
