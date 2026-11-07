# `@bdmv2web/runtime-web`

浏览器菜单运行时：把序列化场景渲染到 Canvas，处理键鼠/触摸输入，驱动 `HdmvVm` 的动作与事件，播放包内菜单媒体与音效。

打包时 `package-builder` 把 `src/browser.ts` 用 esbuild 打成 `runtime/app.bundle.js`（IIFE，ES2020）。包内脚本不是 ES module。

## 文件

| 文件 | 内容 |
| --- | --- |
| `src/index.ts` | `MenuController`、`MenuSoundPlayer`、`CanvasViewport`、`EventScheduler`、`drawMenu`、两个播放桥、输入绑定 |
| `src/browser.ts` | 浏览器入口：`boot()`、`createMenuVm`、`createStatusToast`、外链播放 |
| `src/igs-adapter.ts` | `adaptIgsScene`（IGS 场景 → 可序列化 `SerializedScene`）、`selectPopupScene` |
| `src/linear-playback.ts` | `LinearPlaybackBridge`：按显式时间线播放线性资产 |
| `src/media-clock.ts` | `MediaClockScheduler`、`StillFrameTimer`、`BackgroundLoopClock` |

## 场景数据

`SerializedScene`（写入 `runtime/disc-data.js` 的 `scene`/`popupScenes`/`menuScenes`）：

| 字段 | 说明 |
| --- | --- |
| `width` / `height` / `frameRateCode` | 场景尺寸与帧率码 |
| `pages[].buttons[]` | `id`、`bounds{x,y,width,height}`、`states.{normal,selected,activated}`（`assetId` + 动画对象区间 + `soundId`）、`neighbors`、`autoAction`、`commands` |
| `pages[].uoMask` | 用户操作掩码 |
| `pages[].effects.{enter,exit}` | 效果帧序列，`duration90k` 表示毫秒 = `duration90k / 90` |
| `objects` | 场景内动画对象表 |
| `popupScenes[]` | `uiModel === 1` 的弹出菜单组合，带 `clipId`/`pid` |

`adaptIgsScene(scene, assets, { allowMissingAssets })`：把对象/调色板引用解析成资产 ID，返回 `{ scene, diagnostics }`；缺失资产报 `IGS_UNRESOLVED_VISUAL_ASSET` / `IGS_UNRESOLVED_EFFECT_ASSET`，不生成透明占位。

## MenuController

```ts
new MenuController(scene: MenuScene, vm: RuntimeVmPort, hooks?: RuntimeHooks, schedulerOrConfig?)
```

`RuntimeVmPort` 只需 `handleEvent(event)`，`HdmvVm` 直接满足。

| 成员 | 作用 |
| --- | --- |
| `page` / `button` | 当前页与选中按钮 |
| `start()` | 启动：同步 PSR10/11、播放进入效果、执行 `autoAction` |
| `handle(kind)` | `up/down/left/right/activate/popup/topMenu/escape` |
| `hit(x, y)` / `selectFromPointer` / `activatePointer` | 指针命中、悬停选中、点击激活 |
| `setPage(index)` / `applySetButtonPage(packed)` | 页切换；`packed` 的高位标志与 page/button 字段按 libbluray 语义拆解 |
| `setButtonEnabled(id, enabled)` / `isDisplayed` | BOG/按钮有效性 |
| `visualState(button)` | normal/selected/activated + 动画对象解析 |
| `advanceWhileRunning(deltaMs)` | 推进效果与按钮动画帧 |
| `saveCheckpoint()` / `restoreCheckpoint()` | 页、选中、禁用集、BOG 选择、效果/动画进度、调度器状态 |
| `pause()` / `resume()` | 冻结调度器与动画 |

输入过滤：

- 每页 UO mask 不是规范十进制时记入 `invalidUoMaskPages`，该页输入全部阻断并报一次诊断；不按“全部允许”放行。
- `MenuInputConfig.escapeMapping`：`popup`（默认）/`topMenu`/`custom`/`none`。
- 键盘映射：方向键、`Enter`/`Space`、`Escape`、`T`（Top Menu）、`P`（Popup）。按住不重复触发，`blur` 清空按住集合。
- 指针：`CanvasViewport.toSource` 做 letterbox 逆变换；黑边点击返回 `null`，不命中按钮。

渲染：`drawMenu(context, scene, controller, viewport, cssWidth, cssHeight, dpr)` 只画菜单层（按钮三态、效果帧），背景是独立的 `<video id="menu-background">`。

## 输入绑定

包内运行时由 `browser.ts` 调用这两个安装函数，返回解除绑定的函数：

| 函数 | 绑定对象 | 作用 |
| --- | --- | --- |
| `installKeyboardInput(target, controller)` | `Window` | 方向键/回车/`Esc` → `handle(kind)`；`Esc` 的行为由 `MenuInputConfig.escapeMapping` 决定，默认 `"popup"` |
| `installCanvasPointerInput(canvas, viewport, controller, cssSize)` | `HTMLCanvasElement` | 鼠标/触摸位置换算成场景坐标 → 命中、悬停、点击 |

`DEFAULT_MENU_INPUT_CONFIG` 是 `{ escapeMapping: "popup" }` 的冻结默认值。

## 播放桥

`PlaybackBridge` 接口：`dispatch(action)`、`isCurrent(generation)`。

| 实现 | 用途 | 行为 |
| --- | --- | --- |
| `PreviewPlaybackBridge` | 没有包内媒体时 | 只回报不可用/结束事件，不伪造成播放成功 |
| `MenuLoopPlaybackBridge` | 包内 `background.mp4` + 音轨 | 播放/切列表/切音轨；`ended` → `MEDIA_ENDED`；`timeupdate` 每秒 → `TIME_UPDATED`（45 kHz）；循环背景不结束；缺资产 → `MEDIA_UNAVAILABLE` |
| `LinearPlaybackBridge` | 线性拼接资产 | 每个资产带自己的时间线映射，`PLAY_PLAYLIST_ITEM`/`MARK` 通过显式操作数表换算，不用文件名或 ID 算术 |

`MenuLoopPlaybackBridge` 会在外部播放请求时自动静音菜单音频；按键/点击恢复自动静音，手动静音保持不变。

## 时钟

| 类 | 作用 |
| --- | --- |
| `EventScheduler` | 默认调度器，按传入 `deltaMs` 推进（由 `requestAnimationFrame` 驱动） |
| `MediaClockScheduler` | 以 `media.currentTime` 为时间源；暂停即冻结；`setGeneration` 清空旧回调，`seeked()` 丢弃历史 |
| `StillFrameTimer` | 静止帧：`inactive/waiting/released/cancelled/stale`；页面切换使旧计时 `stale` |
| `BackgroundLoopClock` | 采样背景循环位置，供需要媒体时间的动画使用 |

## 浏览器启动（`boot`）

1. 读 `globalThis.__BDMV_MENU_DATA__`，校验存在 `ir`；`validateEmbeddedDiscIR` 按 schema 校验。
2. 遍历 `__BDMV_MENU_ASSETS__[]`，把 `data:image/png;base64` 解码为 `HTMLImageElement`；失败即报“Could not decode embedded PNG”。
3. `normalizeScene` 绑定资产；没有 `scene` → 明确错误，不黑屏。
4. `createMenuVm(data)`：用包内 `profile`、`limits`、`vmEntries` 构造 VM；`vmInitialProgramId` 有效则 `reset`。
5. 选择播放桥：有 `data.media` 且存在 `video`/`audio` 元素 → `MenuLoopPlaybackBridge`，否则 `PreviewPlaybackBridge`。
6. 创建主 `MenuController` 与弹出菜单 `MenuController`（`selectPopupScene` 按 clip/PID/时间匹配，匹配失败回 `MEDIA_UNAVAILABLE`）。
7. 绑定键盘与指针；`start-menu` 按钮用于首次手势（自动播放被拒时显示“Retry”）。
8. `start()` 后进入交互；错误写入 `#runtime-status` 与 `#runtime-diagnostics`，`role="alert"`。

`vmConsoleLogger` 把 trace 合并为 `console.info("[VM] ...")` 批次，跳过 `RESET` 行。

## 外部播放

`openExternalVideo(bdmvPath, streamPath, seekTime90k)`：

- macOS → `iina://open?url=<file url>&mpv_start=<seconds>`；章节位置缺失时报错，不打开无偏移的播放器。
- Windows → `potplayer://<file url>`。
- 其它平台 → 明确报“External playback is available on macOS and Windows.”

`runtime/bdmv-config.js` 里的 `__BDMV_BDMV_PATH__` 决定源 M2TS 的路径，改后刷新页面生效。

## 诊断码

`IGS_INVALID`、`IGS_UNRESOLVED`、`IGS_BUTTON_WITHOUT_BOG`、`IGS_BUTTON_MULTIPLE_BOGS`、`IGS_BUTTON_WITHOUT_HIT_GEOMETRY`、`IGS_INVALID_BOG_DEFAULT`、`IGS_UNRESOLVED_VISUAL_ASSET`、`IGS_UNRESOLVED_EFFECT_ASSET`、`IGS_UNSUPPORTED_ANIMATION`、`HDMV_*`（透传 VM）、`MEDIA_UNAVAILABLE`、`EXTERNAL_STREAM_MISSING`。

## 测试

`src/index.test.ts`（控制器/输入/效果/音效/检查点）、`browser.test.ts`（boot、弹窗、媒体策略、状态提示）、`igs-adapter.test.ts`、`media-clock.test.ts`、`linear-playback.test.ts`、`headless-menu-synthetic.test.ts`、`hdmv-navigation-corpus-dfs.test.ts`（5 个真实盘 case 的 DFS 实现回归 pin：状态数、覆盖边、unsupportedEdges 为空；索引条目数与静态 PLAY_PL 目标由 `docs/evidence/libbluray-1.5.0-navigation-baseline.json` 驱动）、`baja-studio-headless-navigation.test.ts`、`tamako-headless-navigation.test.ts`。弹出菜单适配与场景选取的跨包覆盖见 `apps/cli/src/synthetic-all-features.test.ts`。

真实盘导航的独立基线在 `apps/cli/src/libbluray-navigation-baseline.test.ts`：逐命令对照 libbluray `mobj_dump -d` 反汇编、`bd_info` index、`bd_list_titles -a` 标题结构，并逐边对照由 libbluray 反汇编独立派生的完整 CFG。DFS 统计本身是本项目探索器的回归 pin。

`browser.test.ts` 用最小 DOM 桩，不是真实浏览器；真实 `file://` 验收记录在 `docs/references/stages/M6-release-verification.md`。

## 改动入口

| 需求 | 位置 | 注意 |
| --- | --- | --- |
| 改交互/焦点规则 | `MenuController.handle`/`hit`/`changePage` | 同步 `openspec/specs/offline-menu-runtime/spec.md` |
| 改渲染 | `drawMenu`、`visualState`、`CanvasViewport.toCss` | DPI 变化时逻辑坐标不变 |
| 改媒体行为 | `MenuLoopPlaybackBridge` | 事件必须带匹配的 `generation`+`responseTo` |
| 改启动流程 | `browser.ts` `boot()` | 包内脚本顺序：`disc-data.js` → `assets-data-*.js` → `app.bundle.js` |
| 新增包内数据字段 | `PackageData` | 同时改 `package-builder` 写 `disc-data.js` 的分支 |

约束：运行时代码不得出现 `fetch`、`XMLHttpRequest`、`WebSocket`、`import`、`eval`。`validate --offline` 的 `auditScript` 会对整包做静态扫描并判 fail。
