# Design

## Context

共同契约见 [实施基线](../IMPLEMENTATION_BASELINE.md)。当前运行时已交付一个离线菜单产物；菜单资源随包提供，影片动作使用源 M2TS 与系统 URL Protocol 交接。本文记录现有运行时和仍未完成的菜单视觉行为，不规划浏览器内正片播放器。

## Goals / Non-Goals

**Goals:** classic bundle、安全 IR/图形嵌入、Canvas/输入/音效、VM 交互桥、portable 菜单包、可诊断启动。

**Non-Goals:** 真实影片转码、PG 字幕、Service Worker、fetch 本地 JSON、模块脚本、原生/WASM 运行依赖、完整播放声明。

## Decisions

### 1. 包生成与启动顺序

生成 index.html、runtime/disc-data.js、assets-data-*.js、app.bundle.js、assets/graphics、assets/audio、reports 和 README。脚本按数据/图集/runtime 顺序 defer；IIFE ES2020，无 import/export/dynamic import、eval、fetch/XHR、CDN。IR 用安全 JSON 写入传统数据脚本，转义 `<`、`</script>` 及脚本敏感字符；标题用 textContent，不拼接源 HTML。

portable 将交互 PNG 按受限批次 data URL 写入数据脚本，预解码后才开放输入；限制单批/总内存，超限诊断，不创建无限大单脚本。原 PNG 可保留用于溯源。音效从 M1 sound 合规解码/转换为 WAV，相对路径加载；缺失声条目报告受影响按钮，不静默替换。compact 不在首期交付。

Bootloader 顺序：数据/schema 校验 → 资产预解码 → 初始化 PlayerProfile/VM/场景 → 显示开始手势 → 执行 First Play。First Play 缺省/无效时仅能使用明确有效的配置入口，不能按文件排序猜。首屏/加载失败可见诊断，不停在黑屏。刷新重新开始，不依赖 localStorage。

### 2. 画面与命中

Video 底层、IG Canvas、输入层分离。Canvas 使用源分辨率坐标，视口等比缩放并 letterbox；pointer 用相同矩阵逆变换，黑边无命中。DPR 只改变 backing store，不改变按钮位置。依原始 z-order/裁剪合成，不从 DOM 文字/图片 alpha 推断区域。

SceneController 持有 composition/page/BOG/selected/activated/popup/动画状态；默认选择与自动动作按已核验场景规则执行。三态对象帧及进入/退出效果按保留的 IGS 字段和 90kHz 时序推进；无可用按钮时清空 selection，不保留前页悬空 buttonId。libbluray 1.5.0 未实现 composition/selection timeout 自动触发，因此运行时不把这些字段当作已对齐的超时行为。

### 3. 输入与 VM 动作闭环

Arrow 对应显式邻接，Enter/Space 只激活有效选择；pointermove/click 与触屏遵守页面、BOG、UO mask。激活经统一 MenuController → VM raw 命令，不能在 HTML onClick 写 play。邻接缺省不按几何位置猜。菜单键明确展示 Top Menu/Pop-up，Escape 作为可配置映射；失焦清遗留按键，禁用状态不发命令。重叠按钮按来源层次/规则选取，歧义不得靠 DOM 顺序解决。

PreviewPlaybackBridge 对无法由菜单包处理的动作回送带 actionId 的 unavailable，结束对应 VM 等待并提示，不假发 MEDIA_ENDED。影片动作在浏览器入口由外部播放器交接路径处理；菜单页切换、按钮状态和 sound 仍通过 VM/菜单控制器执行。

### 4. 时间、导航与参考行为

IGS 动画帧、页面进入/退出效果、HDMV 导航与输入行为以 VideoLAN libbluray 1.5.0 为准，固定实现来源见 [`M2 IGS 参考`](../../../docs/references/stages/M2-igs-scenes.md) 和 [`M3 HDMV 参考`](../../../docs/references/stages/M3-hdmv-navigation.md)。运行时以可注入 EventScheduler 推进保留的 IGS 帧/效果字段，并支持作用域取消和暂停恢复。与该参考一致即通过，不要求另建独立 timing golden 或第二套参考 trace。libbluray 未实现的 composition/selection timeout 自动触发不列入一致性声明。

### 5. 开始手势及产物状态

play Promise 捕捉 NotAllowedError，显示可重试开始按钮，用户手势后只重试仍有效动作，不再次执行整条按钮指令序列。NotSupportedError/资源错误为能力或资产失败，不能伪装成自动播放限制。

统一包的 UI、README 和报告说明影片依赖实际 M2TS 与系统关联程序；交接请求不可用时反馈 unavailable，状态按实际缺口判定。菜单资源离线且包内自包含；影片源文件可在包外。manifest/report 保留 `menu-only` 状态字段，不作为用户可选的产物模式。

## Verification / Exit Criteria

使用固定版本 libbluray 1.5.0 作为 IGS 动画/效果及 HDMV 导航行为依据，记录源文件位置、输入场景、操作序列和实现测试结果；实现与该版本行为一致即通过。统一产物验收同时核对生成包的 manifest/report/README、外部 M2TS 目标、BDMV 路径配置，以及默认和 strict 下的状态/退出结果是否符合项目审计决策。浏览器 file://、画面、音效及目标环境证据以 M6 历史记录为准，本次未重跑的项目不作新验证声明。

## Risks / Trade-offs

嵌入 PNG 增加体积但可减少 file:// Canvas 策略差异；仍须实际矩阵验证。不能靠本机 HTTP 开发服务器的成功代替直接打开验收。

## Migration Plan

当前菜单包使用合成 fixture 与解析得到的真实 IGS/HDMV 数据；影片通过 URL Protocol 请求外部播放器。浏览器内正片播放不属于此 change。
