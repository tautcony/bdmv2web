# M6 — 包审计与发布验证参考

对应 change：[tasks.md](../../../openspec/changes/archive/2026-11-09-verify-offline-release/tasks.md) / [design.md](../../../openspec/changes/archive/2026-11-09-verify-offline-release/design.md)（已于 2026-11-09 归档，主规格见 [offline-delivery-assurance](../../../openspec/specs/offline-delivery-assurance/spec.md)）。

| 来源 | 任务 | 可用内容 | 使用边界 |
| --- | --- | --- | --- |
| `WHATWG-URL-FILE` / `MDN-FILE-CORS` | 1.2–1.3, 4.2 | M4 所列的 [file URL](https://url.spec.whatwg.org/#file-scheme)、[origin](https://html.spec.whatwg.org/multipage/origin.html#origin)、[file CORS 行为](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSRequestNotHttp)。 | 审计嵌套 HTML/CSS/JS/manifest URL、路径逃逸、symlink、原盘引用和外部请求；HTTP 冒烟测试不能替代双击本地包的证据。 |
| `JSON-SCHEMA-2020-12` | 1.1, 1.4 | 校验 manifest/compatibility/audit JSON 结构。 | 检查资产闭包和 status；不能只信包内 status 或 schema 校验通过。 |
| `FFMPEG-DOCS` | 1.1, 4.2 | 收集 ffprobe JSON（`-show_streams -show_format -of json`）及转换工具 build/version 证据。 | 包审计不依赖原碟或 FFmpeg；转换证据绑定工具版本、profile 和本工具生成的输出资产，不记录原盘哈希。 |
| `WPT` | 3.4 | [web-platform-tests](https://github.com/web-platform-tests/wpt) 上游标准回归用例。 | 社区网页测试不是 Blu-ray 或本应用的符合性证明；引入用例时锁定 commit/许可，且不能替代本应用的运行证据。 |
| `MDN-AUTOPLAY` / `MDN-MEDIA` | 4.2 | 浏览器播放策略、错误和 media Promise API。 | 播放策略与错误行为随平台而异，实现按 API 契约处理；缺少浏览器或场景证据时标记 not-verified。 |
| `LIBBLURAY-1.5.0`, `IGSTOOLS-2019`, `LIBHDMV-2026-03` | 3.1–3.3 | M1/M2/M3 固定版本的实现源码可用于交叉比较。 | 不同语言或仓库不代表来源独立；应检查算法/代码沿袭，使用另外建立的 expected 数据，并记录来源版本和许可。 |
| `BDA-BDMV-SPECS` / `BDA-PUBLIC-WHITEPAPERS` | 2.1–2.3 | 规范书访问状态和历史公开白皮书的背景来源，分别见 [`sources.json`](../sources.json)。 | 白皮书不作规范性依据；未取得授权书籍不是发布验证前置。按固定实现、独立 golden、真实环境验证及其具体缺口作结论。 |

## Compatibility and audit report fields

`compatibility.json` records status, checks, coverage, reasons and validation evidence. `dependency-audit.json` records status, external references and checks. Neither report records the producing tool name or version, or provides a separate structured diagnostics list with source path, byte offset and stage. Compatibility checks carry `checkId`, `result`, `message` and optional `path`, `entityId` and `evidence`.

The package manifest carries conversion diagnostics with severity, code and message. The package audit retains severity, code, acknowledgement and completion-blocking fields when it reads those diagnostics; it does not retain their message, source path, byte offset or stage. Release results therefore identify check failures and missing evidence, while tool-version provenance and source-located diagnostic detail remain unrecorded.

## Task 3.4 安全回归证据

以下 focused suites 均通过；这些 fixtures 覆盖输入边界和预算行为。

| 范围 | 命令 | 代表性用例 |
| --- | --- | --- |
| 输入路径与输出事务 | `pnpm --filter @bdmv2web/bdmv-io test` | Unicode/空格路径；`..` 与 symlink escape 拒绝；事务 abort 保留源、已存在目标不覆盖、成功时原子提交。 |
| 结构解析 | `pnpm --filter @bdmv2web/bdmv-parser test` | 三字节截断 magic；12 字节命令截断不补零；图循环只遍历一次；节点预算返回未访问 frontier；原盘 symlink 拒绝。 |
| IGS 传输与尺寸预算 | `pnpm --filter @bdmv2web/igs test` | 缺失首片/EOF、active ODS 聚合预算、有界 RLE 行溢出和像素预算。 |
| HDMV 执行预算 | `pnpm --filter @bdmv2web/hdmv test` | 同步跳转/按钮循环以 `VM_EXECUTION_LIMIT` 终止；预算耗尽的图保留 unknown frontier。 |
| 包审计、对照、证据与发布摘要 | `pnpm --filter @bdmv2web/test-runner test` | 双重编码逃逸、外部 symlink、远程嵌套 URL、未验证的动态入口、PNG/WAV 签名与 MIME、参考版本缺失时保留 not-verified、发布缺口汇总。 |

这些结果来源于仓库合成 fixtures 及已提供的本地 IGS 样本。

M6 complete 门槛以 [实施基线状态决策表](../../../openspec/changes/IMPLEMENTATION_BASELINE.md#4-状态统一判定)和 M6 tasks 为准，不由本索引降低。来源链接和属性在 [`sources.json`](../sources.json)。

<a id="v1-chrome-file-evidence"></a>
## Chrome `file://` 历史实测记录 — 2026-11-03

**结论：2026-11-03 在 macOS Chrome `file://` 下完成过一次手工运行。** 浏览器环境验收已移出当前交付门槛，本节只保留当时的观察记录，不构成发布条件，也不代表跨浏览器支持。

| 项目 | 结果 |
| --- | --- |
| 环境 | macOS 27.2，build 26B123；Google Chrome 156.0.8078.76；未测试其它浏览器或系统。 |
| 制品位置 | `/tmp/移动后 蓝光菜单 验收 2026-11-03-1430/index.html`；打开的是先复制、再移动后的生成包副本，没有连接原盘或本地开发服务器。路径含中文与空格。 |
| 网络 | Chrome DevTools 网络条件为 Offline；页面正常加载，`performance` 资源列表没有非 `file:`/`data:` URL。 |
| 页面/图像 | `file://` 页面显示 `Menu preview ready`；本地 IGS 图像解码并渲染，菜单页面导航与返回操作正常。 |
| 视频/音频 | 背景 MP4 与菜单 M4A 均从包内 `assets/media/` 加载；`readyState=4`、`paused=false`、媒体错误为空。 |
| Console | 未发现 error 或 warn；VM 以 `[bdmv2web:vm]` 输出结构化 trace，本次菜单启动记录在 Console 合并为 158 条。 |

这项验收只记录默认菜单音轨可从本地包播放，不覆盖语言切换行为。

### `CALL_TITLE` 后菜单返回复验

在同一 Chrome DevTools Offline 会话中，使用 `/tmp/tamako-vm-return-smoke.7NYj3t/index.html` 临时合成包，在 Special Features 页首个按钮的命令前插入 `CALL_TITLE`。键盘进入该页并确认后，状态栏显示 `CALL_TITLE resume context is not implemented without independent semantic evidence`；按左键触发该页 Back 按钮的自动动作后，截图确认画面返回首页，状态栏仍保留诊断。Console 显示 `[bdmv2web:vm]` trace（合并计数 171），无 error/warn；本地背景视频仍为 `readyState=4`、`paused=false`。此复验只改临时合成包，没有改原盘或 `test-data/**`。

## 外部 M2TS 替身接入检查 — 2026-11-03

- 用户提供 `STREAM/00006.m2ts` 作为正片替身，并确认其与 `00004.m2ts` 内容相同；`cmp` 逐字节比较一致。
- `extract` 生成的 `external-media-targets.json` 将 Playlist `00004` 和 `00042` 映射到存在的 `STREAM/00006.m2ts`；每个 Playlist 含一个 PlayItem，源 IN/OUT 分别为 `1048560` / `432669750`（90 kHz）。Mark 1 对应源时间 `17647642`；独立测试 `external-real-smoke.test.ts` 验证这两个 Playlist 和 Mark 映射。
- 盘片声明的片段时长约 4795.791 秒，替身文件的 ffprobe 时长约 109.234 秒。这是已知替身条件，不能用于验证原正片的时长、末尾或章节 seek；文件存在不代表内容和原碟片段一致。
- macOS 27.2 build 26B123 的默认关联为 IINA 1.4.4 (168)。通过系统 `open` 打开实际替身后，IINA 窗口显示 `00006.m2ts`，界面观察到画面及 `00:13 / 01:49` 播放进度。该观察验证操作系统文件关联及替身视频解码，不证明声音、章节或菜单按钮交接。
- 当前导航分析对这两个 Playlist 的路线为 `conservative-fallback`：相关标题和播放列表通过 GPR 动态确定。菜单到系统打开的统一桥尚未接入，因此没有执行端到端的菜单按钮 → 默认播放器路径；结果仍为 partial。

### 主菜单到系统播放器 — 后续实测

2026-11-03 在 macOS Chrome `file://` 中运行带本地桥的生成菜单：保留 First Play 在首个媒体请求之前的寄存器初始化、进入 Top Menu，激活主菜单影片按钮。VM 解析动态标题并请求 Playlist `00042`；桥请求系统打开 `STREAM/00006.m2ts`，IINA 窗口显示该路径和进行中的画面。测试中以临时菜单包和手工传入桥会话 URL 验证；原始替身不是正片。系统播放器的章节定位、实际正片、多 PlayItem 自动切换及桥的完整安全审计不在此通过范围内。
