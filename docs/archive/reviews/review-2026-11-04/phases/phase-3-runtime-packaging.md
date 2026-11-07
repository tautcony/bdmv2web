# Phase 3 审查报告: 浏览器运行时与菜单包产出

> 日期: 2026-11-04
> 文件数: 5（`runtime-web/src/browser.ts`、`browser.test.ts`、`package-builder/src/index.ts`、`index.test.ts`、`test-fixtures/src/bdmv.ts`）
> 发现: P0(0) / P1(0) / P2(2) / INFO(4)
> 导航: [返回 review index](../index.md) | [查看修复 checklist](../fix-checklist.md)

## 已审查文件

- `packages/runtime-web/src/browser.ts`（`createMenuVm`、`createStatusToast`、`showStatus`、`visibleError`、`boot`）
- `packages/runtime-web/src/browser.test.ts`（新增 67 行）
- `packages/package-builder/src/index.ts`（`createMenuIndexHtml`、`MENU_STYLE`、`buildMenuPackage` 的 manifest / `disc-data.js`）
- `packages/test-fixtures/src/bdmv.ts`（新增夹具）
- 相关: `packages/hdmv/src/vm.ts`（`VmOptions.profile`、`normalizeProfile`、`reset`）、`packages/hdmv/src/registers.ts`（PSR16–20）

## 已核实无问题的检查项

- **profile 链路完整**: CLI（`index.ts:349,362,429`）→ `buildMenuPackage` → `disc-data.js.profile` → `createMenuVm` → `HdmvVm(profile)`；`vm.reset(programId, profile = this.profile)`（`vm.ts:65`）保证 `vmInitialProgramId` 与 First Play 两次 reset 都不丢 profile。转换期与运行期拿到的是**同一个对象**，`serializeSafeScriptData` 只做转义，`normalizeProfile` 只在缺字段时补默认。
- **未提供 profile 时的默认值**: CLI 恒写完整 8 字段；库调用者不传时运行期回退 `hdmv` 默认，当前两份常量逐字段相同（eng/eng/eng/US/A/portable）。
- **`RegisterFile` 的裸默认值不会泄漏**: `HdmvVm` 构造时先 `normalizeProfile`（`vm.ts:56`），PSR20 不会残留 `RegisterFile` 的 Region B 默认值。
- **toast 类名与 CSS 匹配**: `is-visible` / `is-error` 与 `MENU_STYLE` 的 `#runtime-status.is-visible` / `.is-error` 对应；`persist` 不会被定时器清除；后续普通消息会 `toggle("is-error", false)` 复原。
- **指针命中未被布局破坏**: `CanvasViewport` 内部做 `min` 缩放 + 居中偏移，`installCanvasPointerInput` 用同一个 viewport 逆变换，且 install 时立即 `resize()`。
- **canonical ID 齐全性**: HTML 模板保留 `runtime-status`、`runtime-diagnostics`、`start-menu`、`menu-stage`、`menu-canvas`、`menu-background`、`menu-audio`，`boot()` 的必需元素校验仍会通过。
- **profile 不可注入脚本**: 值限定字母/枚举，且 `serializeSafeScriptData` 转义 `<>&`、U+2028/9。

## Findings

### P3-P2-1: [P2] 需要用户照做的提示会在 4.5s 后自动消失，且无法选中复制

- 位置: `packages/runtime-web/src/browser.ts:160`（"Open … manually, or launch start-menu.command"）、`:164-165`（系统播放器打开失败）、`:157`（外部播放不可用 `result.status === "unavailable"`）；CSS `packages/package-builder/src/index.ts:213`（`pointer-events:none`）
- 行号更正（2026-11-05）: 上一版把 `:145` 标成"外部播放不可用"，实际 `:145` 是 `SET_BUTTON_PAGE` 缺 packed 操作数的警告；`unavailable` 分支在 `:157`。
- 触发条件: 无 `#bridgePort/#bridgeToken` 时点击播放按钮；或本地桥请求失败
- 影响: 改造前这些是常驻文本，现在用户还在抄路径/找启动脚本时提示就淡出；`pointer-events:none` 导致无法选中复制路径。属于可用性回归，且发生在最需要指引的失败路径上。
- 置信度: 高
- 修复方向: 对"需要用户行动"的消息走 `persist: true` 或显著更长的超时；或允许该提示可选中。

### P3-P2-2: [P2] `object-fit: contain` 让 video 与 canvas 各自做 letterbox，素材比例不一致时按钮与背景错位

- 位置: `packages/package-builder/src/index.ts:209`（`#menu-background,#menu-canvas{object-fit:contain}`）；`packages/runtime-web/src/index.ts:54-60`（`CanvasViewport` 按 **scene** 比例 letterbox）
- 触发条件: 菜单 clip 的显示比例 ≠ IGS scene 宽高比（4:3 菜单 + 16:9 导出，或导出时换了分辨率）
- 影响: canvas 内部按 scene 比例居中缩放，video 按自身固有比例居中，两者黑边框不同 → 背景与按钮视觉错位，点击位置与看到的按钮不重合。
- 反例/保护路径: 改动前是 `object-fit:fill` + `#menu-stage` 强制 `aspect-ratio` 为 scene 比例，二者被拉成同一框，永不脱节；本次换 CSS 后该保证消失。若素材比例恒等于 scene 比例，实际无感。
- 置信度: 中
- 修复方向: 由 JS 用同一份 letterbox 结果设置 video 的尺寸/位移（推荐），或恢复 `fill` 并保留 scene 比例约束。

### P3-INFO-1: [INFO] `disc-title` 死代码被两处测试互相固化

- 位置: `packages/runtime-web/src/browser.ts:98-99`（仍写 `#disc-title`）、`browser.test.ts:60,141`（伪造该元素并断言写入）、`packages/package-builder/src/index.test.ts:172,196`（断言生成 HTML **不含** `h1`/`disc-title`）
- 事实: 生产 HTML 已无 `#disc-title`，`browser.ts:99` 是纯 no-op；`browser.test.ts:141` 仍在断言它，制造"覆盖了标题渲染"的假象；`package-builder` 的用例又把"不含 disc-title"写成契约。`createMenuIndexHtml` 注释写 "the header carries the title"，但模板里只有 `<title>`。
- 建议: 三处一起清理（删 heading 写回、删假 DOM 的 `disc-title` 与相关断言、修正注释为 "document title"）；若需要可见标题则加回带 `role="heading"` 的元素并同步更新断言。

### P3-INFO-2: [INFO] 默认 profile 仍有两份手抄

- 位置: `packages/hdmv/src/vm.ts:31-35` 与 `packages/core/src/index.ts:51-56`
- 事实: 逐字段相同，但无 parity 测试。不建议改成值导入（`core` 顶层会引入 ajv，进浏览器 bundle 会变大）；正确做法是加一条断言 `core.DEFAULT_PLAYER_PROFILE` 与 `new HdmvVm([])` 的 PSR16–20 一致的测试。该问题已登记在本轮 D3（第 2 批）。

### P3-INFO-3: [INFO] `manifest.profile` 与 `compatibility.profile` 双源，审计不校验

- 位置: `packages/package-builder/src/index.ts:145`（对象）vs `:59-68`（`profile:"portable"` 字符串）；`packages/test-runner/src/package-audit.ts:27-47`（`parseManifest` 丢弃未知字段，`DeliveryManifest` 无 `profile`）
- 建议: compatibility 记录同一 profile（或指纹），audit 校验 `manifest.profile` 形状并与 `disc-data.js` 比对。

### P3-INFO-4: [INFO] 首帧未 resize（既有问题，被全屏布局放大）

- 位置: `packages/runtime-web/src/browser.ts:190`（构造 `MenuController` 即触发一次 render）→ `:224`（首次 `viewport.resize`）
- 事实: 点 Start 之前 canvas backing store 仍是默认 300×150，`drawMenu` 以 scale=1 绘制后被 CSS 拉伸到整屏，用户会看到被放大裁切的按钮残片。改动前同样存在，但 stage 有 `max-width:1000px` 上限，本次全屏化放大了可见影响。
- 建议: controller 创建后立即 `viewport.resize` + `redraw()`，或用 `ResizeObserver`。

## 漏检复盘

- 默认分支 / 未知输入: 已查 `createMenuVm` 对 `profile` 的守卫（`null`/数组/字符串会被拦下）、`classList` 可选、`#runtime-status` 缺失时静默返回。**发现 INFO-1**（未知键与拼写错误仍静默降级，`videoProfiles:"abc"` 会被 `normalizeProfile` 展开成字符数组）。
- 异步失败 / 前提失效: 已查 toast 定时器清理、`image.onload/onerror` 与 `requestSequence` 的关系、`boot()` 只执行一次的前提下模块级单例是否安全（当前安全，`vi.resetModules()` 规避）。**未发现新问题**。
- 半完成状态 / 重建窗口: 不适用（纯前端渲染）。
- 渲染 / 导出 / 编码: 已查 XSS（`textContent` 写入、`escapeHtml` 用于 `<title>`、`serializeSafeScriptData`）、全屏布局下的坐标映射、canvas backing store 上限（4K+DPR2 约 132MB，无上限封顶）。**发现 P3-2、INFO-4**。
- 隐式协议: `profile` 在 manifest / disc-data / compatibility 三处的形状已比对（INFO-3）；`vmInitialProgramId` / `vmFirstPlayProgramId` 与 `vmPrograms` 的存在性校验仍在。

## 未覆盖区域

- 真实浏览器、真实碟片、移动端 `100dvh`/安全区、iOS 自动播放策略。
- `file://` 直接打开仍为未验证（manifest limitations 已注明）。
- 无 `media` 的包仍不执行 First Play（`browser.ts:200-208` 以存在 media 为前提），与 `converge-.../tasks.md` E.1 的已知未完成项一致；注意这会使**运行期初始执行路径**与转换期（CLI 无条件跑 First Play）不同，但 profile 本身仍一致。
- `capabilityValues` / `outputPreference` 经 CLI 不可达（`loadPlayerProfile` 会丢弃这两个键），只有手写 `disc-data.js` 才能触达。
