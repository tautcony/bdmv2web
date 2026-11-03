# M6 — 离线发布验证参考

对应 change：[tasks.md](../../../openspec/changes/verify-offline-release/tasks.md) / [design.md](../../../openspec/changes/verify-offline-release/design.md)。

| 来源 | 任务 | 可用内容 | 使用边界 |
| --- | --- | --- | --- |
| `WHATWG-URL-FILE` / `MDN-FILE-CORS` | 1.2–1.3, 4.1–4.3 | M4 所列的 [file URL](https://url.spec.whatwg.org/#file-scheme)、[origin](https://html.spec.whatwg.org/multipage/origin.html#origin)、[file CORS 行为](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSRequestNotHttp)。 | 审计嵌套 HTML/CSS/JS/manifest URL、路径逃逸、symlink、原盘引用和外部请求；HTTP 冒烟测试不能替代双击本地包的证据。 |
| `JSON-SCHEMA-2020-12` | 1.1, 1.4 | 校验 manifest/compatibility/audit JSON 结构。 | 从包字节重算 hash、资产闭包和 status；不能只信包内 status 或 schema 校验通过。 |
| `FFMPEG-DOCS` | 1.1, 4.2 | 收集 ffprobe JSON（`-show_streams -show_format -of json`）及转换工具 build/version 证据。 | 离线审计不应依赖原碟或 FFmpeg；转换证据绑定工具版本、profile 和本工具生成的输出资产，不记录原盘哈希。 |
| `PLAYWRIGHT-DOCS` | 3.1–3.3, 4.1–4.3 | [浏览器自动化](https://playwright.dev/docs/browsers), [截图](https://playwright.dev/docs/screenshots), 用于重复执行应用导航断言和采集证据。 | V1 门槛要求实际 macOS Google Chrome 直接打开 `file://`；Playwright 内置 Chromium 不能代替品牌版 Chrome。记录 OS/build、Chrome 完整版本、console 和声音。其它系统/浏览器留给后续版本。 |
| `WPT` | 3.4 | [web-platform-tests](https://github.com/web-platform-tests/wpt) 上游标准回归用例。 | 社区网页测试不是 Blu-ray 或本应用的符合性证明；引入用例时锁定 commit/许可，且不能替代目标浏览器矩阵。 |
| `MDN-AUTOPLAY` / `MDN-MEDIA` | 4.1–4.2 | 浏览器播放策略、错误和 media Promise API。 | 必须在 V1 macOS Google Chrome 环境实际运行；缺少环境或场景证据时标记 not-verified。 |
| `LIBBLURAY-1.5.0`, `IGSTOOLS-2019`, `LIBHDMV-2026-03` | 3.1–3.3 | M1/M2/M3 固定版本的实现源码可用于交叉比较。 | 不同语言或仓库不代表来源独立；应检查算法/代码沿袭，使用另外建立的 expected 数据，并记录来源版本和许可。 |
| `BDA-BDMV-SPECS` | 2.1–2.3 | Blu-ray 授权规范的获取入口。 | 本轮未取得受限规范；应记录缺少的证据，不能宣称完整支持。 |

## Task 3.4 安全回归证据

以下 focused suites 均通过；这些 fixtures 覆盖输入边界和预算行为，不证明受限 Blu-ray 规范字段的完整符合性。

| 范围 | 命令 | 结果 | 代表性用例 |
| --- | --- | --- | --- |
| 输入路径与输出事务 | `pnpm --filter @bdmv-web/bdmv-io test` | 7/7 | Unicode/空格路径；`..` 与 symlink escape 拒绝；事务 abort 保留源、已存在目标不覆盖、成功时原子提交。 |
| 结构解析 | `pnpm --filter @bdmv-web/bdmv-parser test` | 42/42 | 三字节截断 magic；12 字节命令截断不补零；图循环只遍历一次；节点预算返回未访问 frontier；原盘 symlink 拒绝。 |
| IGS 传输与尺寸预算 | `pnpm --filter @bdmv-web/igs test` | 40/40 | 缺失首片/EOF、active ODS 聚合预算、有界 RLE 行溢出和像素预算。 |
| HDMV 执行预算 | `pnpm --filter @bdmv-web/hdmv test` | 56/56 | 同步跳转/按钮循环以 `VM_EXECUTION_LIMIT` 终止；预算耗尽的图保留 unknown frontier。 |
| 离线审计、对照、证据与发布摘要 | `pnpm --filter @bdmv-web/test-runner test` | 51/51 | 双重编码逃逸、外部 symlink、远程嵌套 URL、未验证的动态入口、PNG/WAV 签名与 MIME、参考版本缺失时保留 not-verified、浏览器绑定失效、发布缺口汇总。 |

这些结果来源于仓库合成 fixtures 及已提供的本地 IGS 样本；未对外部原盘媒体生成指纹或完整性记录。

M6 complete 门槛以 [实施基线状态决策表](../../../openspec/changes/IMPLEMENTATION_BASELINE.md#4-状态统一判定)和 M6 tasks 为准，不由本索引降低。来源链接和属性在 [`sources.json`](../sources.json)。

## V1 Chrome file:// 验收 — 2026-11-03

| 项目 | 结果 |
| --- | --- |
| 环境 | macOS 27.2，build 26B123；Google Chrome 156.0.8078.76；未测试其它浏览器或系统。 |
| 制品位置 | `/tmp/移动后 蓝光菜单 验收 2026-11-03-1430/index.html`；打开的是先复制、再移动后的生成包副本，没有连接原盘或本地开发服务器。路径含中文与空格。 |
| 网络 | Chrome DevTools 网络条件为 Offline；页面正常加载，`performance` 资源列表没有非 `file:`/`data:` URL。 |
| 页面/图像 | `file://` 页面显示 `Menu preview ready`；本地 IGS 图像解码并渲染，菜单页面导航与返回操作正常。 |
| 视频/音频 | 背景 MP4 与菜单 M4A 均从包内 `assets/media/` 加载；`readyState=4`、`paused=false`、媒体错误为空。 |
| Console | 未发现 error 或 warn；VM 以 `[bdmv-web:vm]` 输出结构化 trace，本次菜单启动记录在 Console 合并为 158 条。 |

这项验收只记录默认菜单音轨可从本地包播放，不覆盖语言切换行为。验收未为原盘文件或派生媒体生成哈希。

### `CALL_TITLE` 后菜单返回复验

在同一 Chrome DevTools Offline 会话中，使用 `/tmp/tamako-vm-return-smoke.7NYj3t/index.html` 临时合成包，在 Special Features 页首个按钮的命令前插入 `CALL_TITLE`。键盘进入该页并确认后，状态栏显示 `CALL_TITLE resume context is not implemented without independent semantic evidence`；按左键触发该页 Back 按钮的自动动作后，截图确认画面返回首页，状态栏仍保留诊断。Console 显示 `[bdmv-web:vm]` trace（合并计数 171），无 error/warn；本地背景视频仍为 `readyState=4`、`paused=false`。此复验只改临时合成包，没有改原盘或 `test-data/**`。
