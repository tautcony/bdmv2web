# M6 — 离线发布验证参考

对应 change：[tasks.md](../../../openspec/changes/verify-offline-release/tasks.md) / [design.md](../../../openspec/changes/verify-offline-release/design.md)。

| 来源 | 任务 | 可用内容 | 使用边界 |
| --- | --- | --- | --- |
| `WHATWG-URL-FILE` / `MDN-FILE-CORS` | 1.2–1.3, 4.1–4.3 | M4 所列的 [file URL](https://url.spec.whatwg.org/#file-scheme)、[origin](https://html.spec.whatwg.org/multipage/origin.html#origin)、[file CORS 行为](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSRequestNotHttp)。 | 审计嵌套 HTML/CSS/JS/manifest URL、路径逃逸、symlink、原盘引用和外部请求；HTTP 冒烟测试不能替代双击本地包的证据。 |
| `JSON-SCHEMA-2020-12` | 1.1, 1.4 | 校验 manifest/compatibility/audit JSON 结构。 | 从包字节重算 hash、资产闭包和 status；不能只信包内 status 或 schema 校验通过。 |
| `FFMPEG-DOCS` | 1.1, 4.2 | 收集 ffprobe JSON（`-show_streams -show_format -of json`）及转换工具 build/version 证据。 | 离线审计不应依赖原碟或 FFmpeg；转换证据要绑定二进制、profile 和输入/输出 hash。 |
| `PLAYWRIGHT-DOCS` | 3.1–3.3, 4.1–4.3 | [浏览器自动化](https://playwright.dev/docs/browsers), [截图](https://playwright.dev/docs/screenshots), 用于重复执行应用导航断言和采集证据。 | WebKit 不等于 Safari，内置 Chromium 也不等于完整品牌版 Chrome 或 Edge。自动化仅作补充；仍须按要求实际运行 Windows Chrome/Edge/Firefox 和 macOS Chrome/Safari，并记录 OS、build、console 和声音。 |
| `WPT` | 3.4 | [web-platform-tests](https://github.com/web-platform-tests/wpt) 上游标准回归用例。 | 社区网页测试不是 Blu-ray 或本应用的符合性证明；引入用例时锁定 commit/许可，且不能替代目标浏览器矩阵。 |
| `MDN-AUTOPLAY` / `MDN-MEDIA` | 4.1–4.2 | 浏览器播放策略、错误和 media Promise API。 | 必须实际运行 Windows/macOS 浏览器；缺少环境时标记 not-verified。 |
| `LIBBLURAY-1.5.0`, `IGSTOOLS-2019`, `LIBHDMV-2026-03` | 3.1–3.3 | M1/M2/M3 固定版本的实现源码可用于交叉比较。 | 不同语言或仓库不代表来源独立；应检查算法/代码沿袭，使用另外建立的 expected 数据，并记录 hash 和许可。 |
| `BDA-BDMV-SPECS` | 2.1–2.3 | Blu-ray 授权规范的获取入口。 | 本轮未取得受限规范；应记录缺少的证据，不能宣称完整支持。 |

M6 complete 门槛以 [实施基线状态决策表](../../../openspec/changes/IMPLEMENTATION_BASELINE.md#4-状态统一判定)和 M6 tasks 为准，不由本索引降低。来源链接和属性在 [`sources.json`](../sources.json)。
