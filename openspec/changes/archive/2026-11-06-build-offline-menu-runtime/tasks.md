# Tasks

当前基线：core、parser、IGS、HDMV 与菜单运行时均已存在。这里只保留实现尚未覆盖或验收证据仍缺少的项目。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。文中命令/文件是目标交付物，当前未实现。

## 1. Portable打包与启动

- [x] 1.1 实现classic IIFE ES2020 bundle及data→graphics→runtime加载顺序；验收：产物无module/import/fetch/XHR/eval/外部依赖。
- [x] 1.2 实现安全IR数据脚本/标题文本及分批PNG Base64资源；验收：</script>/HTML注入负例不执行，图形批次仅接收PNG签名字节且预算有界。
- [x] 1.3 接入M1 sound到本地WAV及资产manifest；验收：对应索引声音可播放，缺失/未知编码报告受影响按钮。
- [x] 1.4 实现Bootloader版本/引用/图形预解码、开始手势及稳定入口；验收：坏schema/加载失败可见错误，刷新不依赖localStorage。

## 2. 场景与输入

- [x] 2.1 实现Canvas分层/原坐标/裁剪/z-order/letterbox/DPR；验收：golden图层及不同DPI位置正确，黑边点击无命中。
- [x] 2.2 实现page/BOG/normal-selected-activated/默认选择/自动动作；验收：多页切换无悬空焦点，三态序列匹配scene。
- [x] 2.3 实现方向邻接、确认、pointer/触屏、Top Menu/Pop-up/Escape配置；验收：无几何猜邻接，禁用/UO mask在各通道一致。
- [x] 2.4 实现失焦清键与重复激活约束；验收：按住失焦再返回不持续移动/激活。
## 3. VM集成与统一产物

- [x] 3.2 实现PreviewPlaybackBridge unavailable反馈；验收：点击影片操作可见提示且结束VM等待，不伪造正常ended。
- [x] 3.3 实现NotAllowedError用户手势恢复及NotSupportedError分流；验收：只重试仍有效动作，不重放整段VM副作用。
- [x] 3.4 接入统一菜单包 convert、manifest/report/README 与 strict 退出；验收：默认和 strict 共用菜单包契约，状态反映实际导出与外部影片依赖，严格结果由包审计决策产生。
- [x] 3.5 基于固定版本 libbluray 1.5.0 完成菜单运行时一致性与产物集成验收，合并原 2.5、3.1、3.4a：IGS 动画帧/页面效果时序、HDMV 导航动作/状态及 MenuController 输入路径均以 libbluray 为行为准则；实现与其一致即通过，不另要求独立 timing golden 或第二套参考 trace。对应依据：`ig_decode.c` 的 24 位 duration、palette 与效果对象解析；`graphics_controller.c` 的 page in/out 选择、`SET_BUTTON_PAGE` effects flag、90kHz 时间推进、按钮对象帧间隔和 repeat/hold；`hdmv_vm.c`/`navigation.c` 的 VM 与导航状态。输入场景和序列由合成 IGS 帧/效果测试、真实光盘 First Play/Top Menu/可见按钮回放及控制器交互测试覆盖。libbluray 未实现 composition/selection timeout 自动触发，本实现不据此宣称该行为已对齐。
  - 产物验收：CLI convert 默认/strict、输出结构、manifest/report/README、外部 M2TS 目标、BDMV 路径配置与 strict 结果由 `apps/cli/src/index.test.ts` 覆盖；改动后重新构建 CLI 并通过完整 CLI 测试。运行时证据：IGS 包 56 tests、runtime-web 包 99 tests、CLI 包 36 tests；对应包 typecheck 通过。OpenSpec validate 与 `git diff --check` 通过。真实浏览器本轮未重跑，历史 file:// 记录继续以 M6 为准。

## 4. 浏览器验收

- [x] 4.1 建立直接file://断网/移动目录/中文空格路径冒烟；验收：脚本/图形/声音/菜单键均有记录，HTTP结果不代替。Chrome 离线实测记录见 [M6 验收证据](../../../docs/references/stages/M6-release-verification.md#v1-chrome-file-验收-2026-11-03)。
- [x] 4.2 提交M5可替换桥/调度接口与交互fixture；验收：缺矩阵项标未验证，M5能复用相同菜单序列。
