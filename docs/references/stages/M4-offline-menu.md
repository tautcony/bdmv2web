# M4 — 离线菜单运行时参考

对应 change：[tasks.md](../../../openspec/changes/build-offline-menu-runtime/tasks.md) / [design.md](../../../openspec/changes/build-offline-menu-runtime/design.md)。

| 来源 | 任务 | 可用内容 | 使用边界 |
| --- | --- | --- | --- |
| `WHATWG-URL-FILE` | 1.1, 4.1, 4.2 | [URL file scheme](https://url.spec.whatwg.org/#file-scheme) 解析；[HTML origin](https://html.spec.whatwg.org/multipage/origin.html#origin) origin 模型。 | 不承诺任意本地文件都可跨目录访问，仍须测试指定 OS 和浏览器。 |
| `MDN-FILE-CORS` | 1.1, 1.4, 3.4, 4.1 | [本地 file URL/CORS 指南](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSRequestNotHttp)。 | 这不是规范；将资源安全地内嵌在 data bundle 中，不能用 HTTP 冒烟测试代替 file:// 测试。 |
| `ESBUILD-API` | 1.1, 1.4, 4.1 | [IIFE 格式](https://esbuild.github.io/api/#format-iife)及打包选项。 | classic IIFE bundle bundle 不自动保证离线或安全；检查生成物并实际双击启动。 |
| `WHATWG-HTML-SCRIPT` | 1.2 | [Script 元素和 raw-text 语义](https://html.spec.whatwg.org/multipage/scripting.html#the-script-element)。 | `</script>` 仍需按 HTML script 上下文转义；外部 JSON schema 不能防注入。 |
| `MDN-CANVAS`, `MDN-DPR`, `MDN-POINTER` | 2.1–2.4 | [Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)、[devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)、[Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)。 | 需要实测 DPR、缩放和显示器变更；Pointer Events 不定义菜单邻接或 UO mask。 |
| `MDN-AUTOPLAY` | 3.3 | [autoplay](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/autoplay), [play() promise](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)。 | 浏览器策略决定能否播放；失败后应由有效用户手势恢复。文档不能代替实际声音测试。 |
| `JSON-SCHEMA-2020-12` | 1.2, 1.4 | M4 加载版本化 runtime IR 前校验 schema。 | schema 校验不能替代安全序列化和资源闭包检查。 |
| `LIBHDMV-2026-03` | 2.1–2.4 | [scene input](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/hdmv-scene/src/input.rs), [scene](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/hdmv-scene/src/scene.rs), [compositor](https://github.com/liminal-hq/libhdmv/blob/ec0e5b27d2852ca6b008719f66aa3324c0b43f28/crates/hdmv-render/src/compositor.rs). | Apache-2.0 Alpha 参考实现，仅供既有场景模型和输入抽象的背景对照。 |
| `LIBBLURAY-1.5.0` | 2.5, 3.1, 3.5 | 固定 commit：[`ig_decode.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/ig_decode.c), [`graphics_processor.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/graphics_processor.c), [`graphics_controller.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/graphics_controller.c), [`hdmv_vm.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/hdmv/hdmv_vm.c), [`navigation.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/bdnav/navigation.c). | 本 change 的行为参考；按此版本实现核对 IGS 时序与 HDMV 导航。该版本未实现 composition/selection timeout 自动触发，不把这项列入一致性声明。 |

完全离线与安全验证策略见 [`M6`](M6-release-verification.md)。完整源版本见 [`sources.json`](../sources.json)。
