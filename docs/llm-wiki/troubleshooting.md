# 排查手册

按症状组织。每条给：判断依据 → 命令/文件 → 常见真因。诊断码含义见 [diagnostics.md](diagnostics.md)。

## 0. 先确认环境与基线

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm generate:contracts
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
```

- `build` 只编译运行时代码；`typecheck` 覆盖含测试的全部源码。两者可以独立失败：`*.test.ts` 的类型错误只会让 `typecheck` 红。
- 测试超时先确认机器没有过载；`cli`、`media-export`、`runtime-web` 的单例预算 15s，导航语料用例单独 120s。
- 需要真实样本的测试在数据缺失时会跳过，不用把“跳过”当失败。

## 1. `inspect` / `extract` 失败

| 症状 | 判断 | 处理 |
| --- | --- | --- |
| `fatal BDMV_REQUIRED_FILE_MISSING` | `index.bdmv` 缺失或不可解析 | 确认输入是完整 BDMV；看 `--format json` 的 `diagnostics[].sourcePath` |
| `BDMV_UNSUPPORTED_VERSION` | 版本不在 `0100/0200/0240/0300` | 主文件版本不会被旧备份掩盖；确认盘片版本 |
| `BDMV_ROOT_NOT_FOUND` / `BDMV_ROOT_AMBIGUOUS` | 传了错误的层级或存在大小写变体 | 传 `BDMV` 根或其直接父目录 |
| `stageStatus: partial`，退出 0 | 有 `error` 无 `fatal` | 看 `diagnostics` 里第一条 `error` |
| `extract` 没有产物 | 有 `fatal`，事务未创建 | 先解决 fatal；该命令不在失败时留 staging |
| `extract --type igs` 没有 PNG | 该命令不生成 PNG | 用 `render --type igs` |
| `sup/tracks.json` 为空 | 没有可达 PGS 轨道 | `list --type sup` 确认 PID/语言 |
| `render` 没有 PNG | SUP 只有全透明显示集，或 MNU 没有页面引用的图形 | 检查清单 `assetCount`；SUP 是否只有清屏显示集 |

## 2. `build` 失败

| 码 | 判断 | 处理 |
| --- | --- | --- |
| `MENU_PLAYLIST_NOT_RESOLVED` | 入口不是 HDMV，或 First Play → Top Menu 链在 64 步内没走到引用菜单场景的播放列表 | 用 `inspect --format json` 看 `entries` 与 `movieObjects`；确认 Top Menu 是 HDMV |
| `MENU_SCENE_NOT_FOUND` | 播放列表的 IGS clip/PID 与提取场景不匹配 | `list --type igs` 对比 clip/PID；`extract --type igs` 看 `scenes[].clipId/pid` |
| `MENU_SCENE_AMBIGUOUS` | 同一 clip/PID 多个场景 | 看报错里的 `compositionNumber` 与 `segmentFileOffset`，确认哪一个是菜单 |
| `M4_MENU_OBJECT_CONTEXT_MISSING` | 没有可用的 Top Menu/First Play Object | 入口表是否只有 BD-J；对象表是否为空 |
| `M5_MENU_LOOP_UNAVAILABLE` | 菜单页面所需的背景 PlayItem 没有导出 | 检查该 PlayItem 的角度、视频流和媒体计划 |
| `TARGET_EXISTS` | 输出目录已存在 | 换 `--out` 或加 `--overwrite` |
| `PATH_OVERLAP` | 输出在输入内或反之 | 换独立目录 |
| `MEDIA_TOOL_UNAVAILABLE` | `ffmpeg`/`ffprobe` 不在 `PATH` | 安装并确认 `ffmpeg -version` |
| `MEDIA_ENCODER_UNAVAILABLE` | ffmpeg 没带 `libx264` 或 `aac` | 换带这两个编码器的构建 |
| 卡在 `[ffmpeg] ... %` | 编码长视频 | 等；`build` 的超时是 20 分钟/任务 |

失败包仍会留下 `README.md` + `report.json`（`status: "failed"`），没有 `index.html`。不要把它当可运行包分发。

## 3. 包能生成但浏览器打不开

| 现象 | 先查 | 真因 |
| --- | --- | --- |
| 页面标题正常、状态区 “Menu preview could not start.” | `#runtime-diagnostics` 的文本 | 嵌入数据非法、PNG 解码失败、缺场景 |
| 黑屏无提示 | `runtime/disc-data.js` 是否存在、`__BDMV_MENU_DATA__` 是否有 `scene` | 包不完整或脚本顺序被改 |
| 控制台 `Failed to load resource` | `manifest.json` 的文件清单与实际磁盘 | 资产没打包或路径大小写不符 |
| `file://` 下什么都不加载 | `index.html` 是否引用了 `type="module"` 或网络资源 | 交付物必须是 classic script |

相关代码：`packages/runtime-web/src/browser.ts` 的 `boot()`；错误会写到 `#runtime-status`（`role="alert"`）与 `#runtime-diagnostics`。

## 4. 菜单能显示但交互异常

| 现象 | 检查 | 代码 |
| --- | --- | --- |
| 方向键不动 | 当前按钮 `neighbors` 是否指向自身；页是否只有一个 BOG | `MenuController.handle` |
| `Enter` 无反应 | 按钮是否 `enabled`；当前页 UO mask 是否禁止；按钮命令是否为空 | `handle` → `activate`；`HDMV_UO_BLOCKED` |
| 点击位置偏移 | 场景比例与视频比例是否相同；两者各自 `object-fit: contain` | `CanvasViewport.toSource` |
| 黑边点击也命中 | 同上；`toSource` 应返回 `null` | `CanvasViewport` |
| 切页后焦点悬空 | 新页是否有可用按钮 | `selectPageDefault`、`IGS_INVALID_BOG_DEFAULT` |
| 动画不结束 | `duration90k` 是否为 0 或极大；调度器是否被暂停 | `advanceWhileRunning`、`beginPageEffects` |
| 切页后旧动画又触发 | 作用域是否被取消 | `changePage` 的 `cancelScope` |

## 5. 没有声音

| 检查 | 说明 |
| --- | --- |
| `assets/audio/sound-N.wav` 是否存在 | 只有被按钮三态引用的条目才会转换 |
| `disc-data.js` 的 `sounds` 映射 | 索引 → 路径 |
| `SOUND_FORMAT_UNSUPPORTED` | 只支持 48 kHz / 16-bit / 单双声道 PCM |
| 自动播放被拒 | 状态区会出现开始/重试按钮；点击后再播放 |
| 外部播放请求后静音 | 这是自动行为；下一次按键/点击恢复 |

## 6. 弹出菜单不出现

| 检查 | 说明 |
| --- | --- |
| `disc-data.js` 是否有 `popupScenes` | `uiModel === 1` 的场景才会被收集 |
| 当前播放列表是否有 `menuMedia` | `POPUP_MENU` 只对包内菜单媒体生效 |
| `selectPopupScene` 的匹配 | 需要 clip/PID 一致；歧义或缺失回 `MEDIA_UNAVAILABLE` |
| 正片播放中 | 正片交给外部播放器，包内无法叠加，见 `M5_POPUP_CONTENT_MEDIA_EXTERNAL` |

## 7. 正片播放交接失败

| 现象 | 检查 |
| --- | --- |
| 点击后无反应 | `external-targets.json` 是否有该播放列表/PlayItem/Mark |
| 外部播放器未启动 | `bdmv2web serve` 的 `--player` / `--player-executable` 设置；播放器进程是否可启动 |
| system adapter 报 capability unavailable | 目标包含有界播放或多片段；诊断的 source 指向播放列表/PlayItem/Mark |
| 路径错误 | `runtime/bdmv-config.js` 的 `__BDMV_BDMV_PATH__`；相对路径基于 `index.html` |
| `EXTERNAL_STREAM_MISSING` | 源 `STREAM/*.m2ts` 被移动或重命名 |

## 8. `validate` 报错

| 检查项 | 含义 | 处理 |
| --- | --- | --- |
| `OFFLINE_URL_MISSING` | 运行时引用的文件不在包里 | 重新 `build`；检查 `disc-data.js` / `asset-manifest.json` |
| `OFFLINE_URL_ESCAPE` / `OFFLINE_URL_SYMLINK` | URL 解析到包外或 symlink | 不要用绝对路径/软链打包 |
| `BUNDLE_NETWORK_API` / `BUNDLE_IMPORT` | 运行时代码含网络 API 或 module 语法 | 改 `runtime-web`，不要放宽审计 |
| `BUNDLE_DYNAMIC_ACCESS` | `not-verified` | 人工确认该动态访问不会取到 `fetch` 等 |
| `MANIFEST_STATUS_UNVERIFIED` | `manifest.status` 与当前证据不一致 | 以 `decision.status` 为准；manifest 不会被改写 |
| `MANIFEST_PATH_RESERVED` | manifest 列了报告文件 | 检查 `package-builder` 的 `files` |
| `PLAYER_PROFILE_MISMATCH` | manifest / compatibility / 运行时 profile 不一致 | 检查 `build --player-profile` 与打包分支 |

## 9. VM 行为不对

| 症状 | 检查 |
| --- | --- |
| 停在某个 PC 不动 | trace 最后一条是否有动作等待；`MEDIA_*` 回信是否匹配 `generation`/`responseTo` |
| 指令没生效 | 该指令是否在 `HDMV_OPCODE_CONTEXT_SKIPPED`（上下文不允许） |
| 循环卡死 | `VM_EXECUTION_LIMIT`；用 `--limits` 提高预算前先确认不是逻辑死循环 |
| 对比参考实现不一致 | `docs/review-2026-11-06-hdmv-vm-conformance/index.md`；`reference-golden.test.ts` 报首个差异检查点 |
| 想看清整条路径 | `corepack pnpm build && node scripts/visualize-hdmv-vm-flow.mjs <BDMV> /tmp/flow.md` |

浏览器里 VM trace 以 `console.info("[VM] ...")` 批量输出，包含步数、命令、动作、事件、诊断与状态。

## 10. 定位技巧

| 目标 | 方法 |
| --- | --- |
| 看完整结构 | `inspect <BDMV> --format json --out /tmp/disc.json` |
| 看场景来源 | `extract --type igs` 的 `igs/source-map.json`：场景/页/按钮/对象/调色板 → 文件偏移 |
| 看命令来源 | `extract --type hdmv` 的 `hdmv/commands.json`（object + instructionIndex + offset） |
| 看媒体决策 | `media-plan.json` / `media-plans/*.json` 的 `playlistId`、区间、轨道、编码参数 |
| 看交付原因 | `report.json` 的 `reasons` / `notVerified`；`reports/release-summary.json` 的 `gaps` |
| 复现解析差异 | 用 `packages/test-fixtures/src/bdmv.ts` 构造最小样本，不依赖真实碟片 |
