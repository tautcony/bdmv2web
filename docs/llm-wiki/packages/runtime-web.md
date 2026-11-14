# `@bdmv2web/runtime-web`

浏览器菜单运行时：把序列化场景渲染到 Canvas，处理键鼠/触摸输入，驱动 `HdmvVm` 的动作与事件，播放包内菜单媒体与音效。

workspace build 期 `scripts/build-runtime-browser.mjs` 把 `src/browser.ts` 用 esbuild 打成 `dist/browser.bundle.js`（IIFE，ES2020）；打包时 `package-builder` 复制为 `runtime/app.bundle.js`。包内脚本不是 ES module。

## 文件

| 文件 | 内容 |
| --- | --- |
| `src/index.ts` | 从 `src/menu/menu-runtime.ts` 桶式导出 |
| `src/menu/menu-runtime.ts` | `MenuController`、`MenuSoundPlayer`、`CanvasViewport`、`EventScheduler`、`drawMenu`、输入绑定 |
| `src/browser.ts` | 浏览器入口：`boot()`、`createMenuVm`、`createStatusToast`、外链播放 |
| `src/menu-playback.ts` | 两个播放桥（菜单循环与外部媒体）的实现 |
| `src/igs-adapter.ts` | `adaptIgsScene`（IGS 场景 → 可序列化 `SerializedScene`）、`selectPopupScene` |
| `src/scene-normalizer.ts` | 场景归一化与 `menuSceneKey` |
| `src/linear-playback.ts` | `LinearPlaybackBridge`：按显式时间线播放线性资产 |
| `src/media-loop.ts` | 菜单循环媒体的视频元素控制 |
| `src/bdmv-url.ts` | 包内 URL/参数解析与时间格式化 |
| `src/bdj-runtime.ts` / `bdj-menu-media.ts` / `bdj-client-entry.ts` | BD-J 会话客户端、菜单媒体观察上报与 BD-J 启动入口 |
| `src/runtime-diagnostics.ts` / `runtime-status.ts` | 运行时诊断收集与状态提示 |

## 场景数据

`SerializedScene`（写入 `runtime/disc-data.js` 的 `scene`/`popupScenes`/`scenes`）：

`menuScenes` 只存 PlayItem → 场景的引用（`sceneId`），场景本体在 `data.scenes[sceneId]`。同一构图被多个 PlayItem 引用时运行时只解析一份；`sceneId` 查不到对应场景时该 PlayItem 视为未打包，菜单保持当前画面。`menuSceneKey(scene)`（`clipId:pid`）用于判断"已经在显示这个构图"。

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
- 指针：`CanvasViewport.toSource` 做 letterbox 逆变换；黑边点击返回 `null`，不命中按钮。`hit()` 只把 BOG 内存在选择态图形的可用按钮作为指针目标（libbluray 1.5.0 的鼠标选择规则），仅有常态图形的显示按钮不会因指针移动被选中或消失。

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

`MenuLoopPlaybackBridge` 会在外部播放请求时自动静音菜单音频；按键/点击恢复自动静音，手动静音保持不变。右下角图标显示静音开关状态；媒体尚未启动时，图标仍显示当前静音状态。

`PLAY_STOP` 一律关闭菜单播放列表（暂停背景视频与音轨），无论是 `_jump_object()`、`Call_Object` 这类转移还是 `TERMINATE_PL`（libbluray 由播放器在 `PLAY_STOP` 时关闭 playlist）。转移后紧接的 `PLAY_PLAYLIST*` 会让桥自行重新起播（`mediaStarted` 回调清除停止态）；没有后续播放时控件转为"恢复播放"，用户点击后从暂停位置继续。`JUMP_TITLE` / `CALL_TITLE` 不产生 `PLAY_STOP`，菜单媒体保持播放。

## 时钟

`EventScheduler` 按传入的 `deltaMs` 推进；浏览器使用 `requestAnimationFrame` 驱动。

## 浏览器启动（`boot`）

1. 读 `globalThis.__BDMV_MENU_DATA__`，校验存在 `ir`；`validateEmbeddedDiscIR` 检查对象身份（`schemaVersion` 与必需数组），完整校验已在打包阶段完成。
2. 遍历 `__BDMV_MENU_ASSETS__[]`，把 `data:image/png;base64` 解码为 `HTMLImageElement`；失败即报“Could not decode embedded PNG”。
3. `normalizeScene` 绑定 IGS 资产；没有 `scene` 但有 `bdjRuntime` 时，由 BD-J runtime 建立 Java scene；两者都没有时显示明确错误。
4. `createMenuVm(data)`：用包内 `profile`、`limits`、`vmEntries` 构造 VM；`vmInitialProgramId` 有效则 `reset`。
5. 选择播放桥：有 `data.media` 且存在 `video`/`audio` 元素 → `MenuLoopPlaybackBridge`，否则 `PreviewPlaybackBridge`。
6. 创建主 `MenuController` 与弹出菜单 `MenuController`（`selectPopupScene` 按 clip/PID/时间匹配，匹配失败回 `MEDIA_UNAVAILABLE`）。
7. 绑定键盘与指针；`start-menu` 按钮用于首次手势（自动播放被拒时显示“Retry”）。
8. `start()` 后进入交互；错误写入 `#runtime-status` 与 `#runtime-diagnostics`，`role="alert"`。

含 BD-J 的包通过本地服务启动 Java host 和 BDJO Xlet。`HScene` PNG 帧、键盘按下/释放、鼠标坐标、title、RegisterAccess 与 Xlet 生命周期事件通过回环会话 API 路由。会话在页面刷新后重新连接存活 Java 进程。实现状态和 2026-11-11 验证记录见 [BD-J 本地 Java 运行支持](../../support/bdj-support.md)。

BD-J 菜单媒体按 authored PlayItem 顺序播放。缺失媒体会显示带 BDJO、title、playlist、PlayItem 和 source 的 warning，然后立即跳到下一项。仅含缺失项的 playlist 发送一条 source-bearing completion event；它不发送 started、presented、position 或 mark 观察。

`vmConsoleLogger` 把 trace 合并为 `console.info("[VM] ...")` 批次，跳过 `RESET` 行。

## 外部播放

HDMV VM actions resolve through `external-targets.json`. `bdmv2web serve <package-directory> --player system` requests the operating system's default player for a whole-file target. Add `--player-executable <path>` to run a selected executable with the media path. Bounded and multi-item targets return `EXTERNAL_PLAYER_CAPABILITY_UNAVAILABLE` with their source. A process launch is reported as `requested`; external players own playback state.

## 诊断码

`IGS_INVALID`、`IGS_UNRESOLVED`、`IGS_BUTTON_WITHOUT_BOG`、`IGS_BUTTON_MULTIPLE_BOGS`、`IGS_BUTTON_WITHOUT_HIT_GEOMETRY`、`IGS_INVALID_BOG_DEFAULT`、`IGS_UNRESOLVED_VISUAL_ASSET`、`IGS_UNRESOLVED_EFFECT_ASSET`、`IGS_UNSUPPORTED_ANIMATION`、`HDMV_*`（透传 VM）、`MEDIA_UNAVAILABLE`、`EXTERNAL_STREAM_MISSING`。

## 测试

`src/index.test.ts`（控制器/输入/效果/音效/检查点）、`browser.test.ts`（boot、弹窗、媒体策略、状态提示）、`igs-adapter.test.ts`、`linear-playback.test.ts`、`bdj-menu-media.test.ts`、`bdmv-url.test.ts`、`tests/integration/headless-menu-synthetic.test.ts`、`tests/integration/hdmv-navigation-corpus-dfs.test.ts`（4 个真实盘与 1 个合成盘 case 的 DFS 实现回归 pin：状态数、覆盖边、unsupportedEdges 为空；索引条目数与静态 PLAY_PL 目标由 `test-data/baselines/libbluray-1.5.0-navigation-baseline.json` 驱动）、`tests/integration/tamako-headless-navigation.test.ts`、BD-J 集成 `tests/integration/bdj-host-api.test.ts`、`bdj-ixc.test.ts`、`bdj-lifecycle.test.ts`。弹出菜单适配与场景选取的跨包覆盖见 `apps/cli/tests/integration/synthetic-all-features.test.ts`。

真实盘导航的独立基线在 `apps/cli/tests/integration/libbluray-navigation-baseline.test.ts`：逐命令对照 libbluray `mobj_dump -d` 反汇编、`bd_info` index、`bd_list_titles -a` 标题结构，并逐边对照由 libbluray 反汇编独立派生的完整 CFG。DFS 统计本身是本项目探索器的回归 pin。

`browser.test.ts` 用最小 DOM 桩，不是真实浏览器；浏览器环境不在当前验收范围。

## 改动入口

| 需求 | 位置 | 注意 |
| --- | --- | --- |
| 改交互/焦点规则 | `MenuController.handle`/`hit`/`changePage` | 同步 `openspec/specs/offline-menu-runtime/spec.md` |
| 改渲染 | `drawMenu`、`visualState`、`CanvasViewport.toCss` | DPI 变化时逻辑坐标不变 |
| 改媒体行为 | `MenuLoopPlaybackBridge` | 事件必须带匹配的 `generation`+`responseTo` |
| 改启动流程 | `browser.ts` `boot()` | 包内脚本顺序：`disc-data.js` → `assets-data-*.js` → `app.bundle.js` |
| 新增包内数据字段 | `PackageData` | 同时改 `package-builder` 写 `disc-data.js` 的分支 |

约束：运行时代码不得出现 `fetch`、`XMLHttpRequest`、`WebSocket`、`import`、`eval`。`validate` 的 `auditScript` 会对整包做静态扫描并判 fail。
