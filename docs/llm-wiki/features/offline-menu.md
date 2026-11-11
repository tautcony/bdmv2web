# 功能：离线菜单包

`build` 把解析和提取结果写成一个目录。静态 HDMV/IGS 包可从 `file://` 运行；含 BD-J 包使用 `bdmv2web serve <package-directory>` 和 Java 21 或兼容的 `java.desktop` 运行环境。服务管理本地 Java 进程和回环会话 API。

## 产物形态

```text
BDMV-menu/
├── index.html
├── README.md
├── manifest.json
├── asset-manifest.json
├── compatibility.json
├── external-targets.json          # 有外部播放目标
├── media-plan.json                # Top Menu 背景媒体
├── media-plans/playlist-00003.json
├── runtime/
│   ├── disc-data.js               # __BDMV_MENU_DATA__
│   ├── assets-data-000.js         # __BDMV_MENU_ASSETS__[0]
│   ├── assets-data-001.js
│   ├── app.bundle.js              # IIFE
│   ├── style.css
│   ├── bdmv-config.js             # __BDMV_BDMV_PATH__
│   └── bdj/                      # 含 BD-J 时：host JAR 与 session.json
├── assets/
│   ├── audio/sound-1.wav
│   ├── media/background.mp4
│   └── media/audio-1100-eng.m4a
├── bdj/BDMV/JAR/                 # 含 BD-J 时：应用 JAR 与 authored 文件
├── report.json                    # build 成功与失败路径都写
└── reports/                       # validate 之后
```

`runtime/bdj/session.json` stores Java application launch records and the HDMV session program, entries, profile, and limits. `runtime/bdj/bdj-host-api.jar` contains the native host. `bdj/BDMV/JAR/` contains packaged Java application JARs and authored files.

静态脚本顺序固定：`bdmv-config.js`（可选）→ `disc-data.js` → `assets-data-*.js` → `app.bundle.js`，全部 `defer`、全部 classic script。

## 场景选择

| 步骤 | 规则 | 失败码 |
| --- | --- | --- |
| 找 Top Menu 播放列表 | 转换期跑 VM：First Play → `selectTitle(0)` → 跟随播放列表/标题，找第一个引用 `uiModel === 0` IGS 场景的播放列表 | `MENU_PLAYLIST_NOT_RESOLVED` |
| 匹配场景 | 播放列表 PlayItem 的 IGS clip + PID 与提取场景比对 | 无匹配 `MENU_SCENE_NOT_FOUND`；多匹配 `MENU_SCENE_AMBIGUOUS` |
| 分类 | `uiModel === 0` → 菜单画面；`uiModel === 1` → 弹出菜单 | — |
| 额外菜单 | 可达且非 Top Menu 的 `uiModel === 0` 播放列表 → 额外导出本地媒体 | 诊断 `M5_PLAYLIST_MEDIA_EXPORTED` |
| 弹出菜单所在正片 | `uiModel === 1` 且属于正片播放列表 → 只保留场景，视频交给外部播放器 | 诊断 `M5_POPUP_CONTENT_MEDIA_EXTERNAL` |

失败时仍写 `README.md` 与 `report.json`（`status: "failed"`），提交目录并退出 1；不生成 `index.html`，避免把半成品当可运行包。

## `disc-data.js` 字段

| 字段 | 来源 | 运行时用途 |
| --- | --- | --- |
| `ir` | `createMenuDiscIR` | 契约校验 |
| `title` | `--title` 或目录名 | 文档标题 |
| `scene` | `adaptIgsScene(主场景)` | 主菜单 |
| `popupScenes` | 所有 `uiModel === 1` 场景 | 弹出菜单 |
| `menuScenes` | 其他常显菜单场景 + 所属播放列表 | 切换菜单 |
| `menuPlaylistIds` / `preMenuPlaylistIds` | 选择结果 | 播放列表 → 媒体映射 |
| `menuPlaylistMarks` | 菜单播放列表的 mark → PlayItem 映射 | `PLAY_PLAYLIST_MARK` 场景路由 |
| `vmPrograms` | `disc.movieObjects` | VM 程序 |
| `profile` / `limits` | CLI 参数 | PSR 初始化与预算 |
| `vmEntries` | `disc.entries` | 标题校验 |
| `vmInitialProgramId` / `vmFirstPlayProgramId` | Top Menu / First Play 入口 | 启动对象 |
| `sounds` | `assets/audio/sound-N.wav` 映射 | 按钮音效 |
| `media` / `menuMedia` | 导出的循环媒体 | 背景与音轨 |
| `externalTargets` | 外部播放目标 | 正片交接 |
| `pgsTracks` | PGS 显示集 | 字幕叠加 |
| `inputConfig` | `escapeMapping` | Esc 行为 |

## 浏览器启动

1. 校验 `__BDMV_MENU_DATA__.ir`，失败显示可定位错误，禁止初始化 VM。
2. 解码全部 `data:image/png` 资产；任一失败即中止。
3. 绑定场景资产；无场景 → 明确报错。
4. 构造 VM（`profile`、`limits`、`vmEntries`），`vmInitialProgramId` 有效则 `reset`。
5. 有媒体 → `MenuLoopPlaybackBridge`；否则 `PreviewPlaybackBridge`。
6. 绑定键盘/指针；主菜单与弹出菜单各一个 `MenuController`。
7. 首次手势按钮：自动播放被拒时显示 “Retry menu media”；编码不支持时只报一次能力错误，不循环重试。

## 交互

| 输入 | 行为 |
| --- | --- |
| 方向键 | 按 `neighbors` 移动焦点；无邻居时保持 |
| `Enter` / `Space` | 激活当前按钮：执行按钮命令、播放音效 |
| `Escape` | 按 `escapeMapping`：`popup`（默认）/`topMenu`/`custom`/`none` |
| `T` / `P` | Top Menu / Popup |
| 指针移动 | 命中按钮则选中；黑边不命中 |
| 指针按下 | 激活命中按钮 |

按钮三态由 `visualState` 决定：禁用 → normal；激活 → activated；选中 → selected；否则 normal。动画对象按 BOG 帧索引解析。

页面切换会取消旧页调度、清空激活态、按新页默认规则选焦点；旧动画完成回调因作用域取消而失效。

## 媒体

| 场景 | 行为 |
| --- | --- |
| Top Menu 背景 | `background.mp4` 循环；循环标志来自 `media-plan.json` |
| 额外菜单播放列表 | 切到对应 `menuMedia`，独立音轨 |
| `SET_STREAM` 主音频 | 切换 `<audio>` 的 source 到对应 `audio-*.m4a` |
| 正片播放 | 通过 `iina://` / `potplayer://` 交接到系统播放器；菜单侧不接管视频 |
| 媒体缺失 | `MEDIA_UNAVAILABLE` 结束等待，状态栏提示，不挂死 |

外部播放请求会自动静音菜单音频；下一次按键/点击恢复自动静音；手动静音保持。

## 音效

`package-builder` 只转换被按钮三态引用的 sound 条目，且只支持 48 kHz / 16-bit / 单双声道 PCM。缺失或不支持时写诊断，不静默替换。

## 边界

| 项 | 现状 |
| --- | --- |
| 浏览器 | 浏览器环境不在当前验收范围；产物按同目录静态文件、classic script 打包 |
| 弹出菜单覆盖正片 | 正片由外部播放器播放，无法叠加；包内只覆盖菜单画面 |
| 菜单素材与场景比例不一致 | 两者各自 `object-fit: contain`，比例不同时按钮与背景可能错位；见 [troubleshooting.md](../troubleshooting.md) |
| 音视频保真 | 菜单背景转 H.264/AAC；正片不做转码 |
| 交付状态 | 由 `test-runner` 的 `decideDelivery` 判定；缺证据只进 `notVerified`，见 [verification.md](verification.md) |

## 相关测试

`package-builder/src/index.test.ts`、`runtime-web/src/browser.test.ts`、`runtime-web/src/index.test.ts`、`runtime-web/tests/integration/headless-menu-synthetic.test.ts`。
