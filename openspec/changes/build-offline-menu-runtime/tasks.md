# Tasks

前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation。接口可提前消费；完成集成验收前必须取得上游契约及相关验收。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。文中命令/文件是目标交付物，当前未实现。

## 1. Portable打包与启动

- [x] 1.1 实现classic IIFE ES2020 bundle及data→graphics→runtime加载顺序；验收：产物无module/import/fetch/XHR/eval/外部依赖。
- [x] 1.2 实现安全IR数据脚本/标题文本及分批PNG data资源；验收：</script>/HTML注入负例不执行，批次预算有界。
- [x] 1.3 接入M1 sound到本地WAV及资产manifest；验收：对应索引声音可播放，缺失/未知编码报告受影响按钮。
- [x] 1.4 实现Bootloader版本/引用/图形预解码、开始手势及稳定入口；验收：坏schema/加载失败可见错误，刷新不依赖localStorage。

## 2. 场景与输入

- [x] 2.1 实现Canvas分层/原坐标/裁剪/z-order/letterbox/DPR；验收：golden图层及不同DPI位置正确，黑边点击无命中。
- [x] 2.2 实现page/BOG/normal-selected-activated/默认选择/自动动作；验收：多页切换无悬空焦点，三态序列匹配scene。
- [x] 2.3 实现方向邻接、确认、pointer/触屏、Top Menu/Pop-up/Escape配置；验收：无几何猜邻接，禁用/UO mask在各通道一致。
- [x] 2.4 实现失焦清键与重复激活约束；验收：按住失焦再返回不持续移动/激活。
- [ ] 2.5 实现可注入时钟/动画/效果调度和作用域取消；验收：离页后旧完成事件不改变新页，暂停按逻辑时钟冻结。

> Completion gap for 2.5: `adaptIgsScene` and the browser scene normalizer now preserve composition/selection timeout values, `animationFrameRateCode`, button start/end object IDs and repeat flags, and raw enter/exit effect bytes/counts. Effect flag bits remain embedded in opaque bytes and are not interpreted. The injected logical scheduler supports page-scope cancellation and pause/resume, with focused lifecycle tests, but the effect parser has no interpreted timing/completion contract and there is no timing golden. The runtime therefore cannot schedule source-matched animations or page effects yet; keep this task unchecked until that contract and a timing golden are available.

## 3. VM集成与模式

- [ ] 3.1 以统一MenuController连接VM动作/事件和sound，不在DOM硬编码播放；验收：指定按键路径产生参考导航trace。
- [x] 3.2 实现PreviewPlaybackBridge unavailable反馈；验收：点击影片操作可见提示且结束VM等待，不伪造正常ended。
- [x] 3.3 实现NotAllowedError用户手势恢复及NotSupportedError分流；验收：只重试仍有效动作，不重放整段VM副作用。
- [x] 3.4 接入menu-only convert、目录/报告/README及strict退出；验收：始终partial，显式strict退出2，无外部和原碟引用。
  - 历史完成记录：对应旧的模式与状态规则；新产品边界须按下项重新验收。
- [ ] 3.4a 将既有 menu-only 产物迁移为统一 convert 产物；报告说明源 M2TS 外部依赖，strict 根据实际状态判定。旧实现不等于新验收已通过。

> Completion gap for 3.1: browser keyboard activation is covered end-to-end through `MenuController`, the HDMV VM action bridge, and packaged button sound using a synthetic M3 fixture. No independently generated reference navigation trace for this menu-input path is present, so the synthetic trace cannot satisfy the stated reference-trace acceptance; keep this task unchecked pending that evidence.

## 4. 浏览器验收

- [x] 4.1 建立直接file://断网/移动目录/中文空格路径冒烟；验收：脚本/图形/声音/菜单键均有记录，HTTP结果不代替。Chrome 离线实测记录见 [M6 验收证据](../../../docs/references/stages/M6-release-verification.md#v1-chrome-file-验收-2026-11-03)。
- [x] 4.2 提交M5可替换桥/调度接口与交互fixture；验收：缺矩阵项标未验证，M5能复用相同菜单序列。
