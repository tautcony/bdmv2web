# Design

## Context

依赖 M0–M3，对应架构 §6.3、§9、§11。共同契约见 [实施基线](../IMPLEMENTATION_BASELINE.md)。M4 交付统一产物的菜单运行时；M5 将影片动作交给系统默认程序，菜单调试不依赖影片接入。

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

SceneController 持有 composition/page/BOG/selected/activated/popup/动画状态；默认选择、超时选择、自动动作按已核验场景规则执行。三态序列及进入退出效果由状态/时间驱动；无可用按钮时清空 selection，不保留前页悬空 buttonId。未知效果保留诊断。

### 3. 输入与 VM 动作闭环

Arrow 对应显式邻接，Enter/Space 只激活有效选择；pointermove/click 与触屏遵守页面、BOG、UO mask。激活经统一 MenuController → VM raw 命令，不能在 HTML onClick 写 play。邻接缺省不按几何位置猜。菜单键明确展示 Top Menu/Pop-up，Escape 作为可配置映射；失焦清遗留按键，禁用状态不发命令。重叠按钮按来源层次/规则选取，歧义不得靠 DOM 顺序解决。

M4 的 PreviewPlaybackBridge 对未打包播放动作回送带 actionId 的 unavailable，结束 VM 对应等待并提示，不假发 MEDIA_ENDED。菜单页切换、按钮状态、sound 仍是真实 VM 动作。M5 替换桥，不改指令语义。

### 4. 时间与异步生命周期

M4 提供 EventScheduler 接口和可注入逻辑时钟：静态预览动画按逻辑时间，暂停/页面更换取消旧任务；M5 接入外部文件交接，不依赖影片播放时钟。所有回调携 generation，页面/媒体变更只取消对应作用域任务。异步资源加载错误不重入 VM。动画结束与页面效果完成进入同一序列队列。

### 5. 开始手势及模式声明

play Promise 捕捉 NotAllowedError，显示可重试开始按钮，用户手势后只重试仍有效动作，不再次执行整条按钮指令序列。NotSupportedError/资源错误为能力或资产失败，不能伪装成自动播放限制。

统一包的 UI、README 和报告说明影片依赖实际 M2TS 与系统关联程序；未接入或不可用时反馈 unavailable，状态按实际缺口判定。菜单资源离线且包内自包含；影片源文件可在包外。缺真实动态背景时不得宣称视频保真。

## Verification / Exit Criteria

scene fixture 验证多页/BOG/三态/自动动作/方向邻接/UO mask、letterbox/DPR/黑边命中、失焦和触屏。script 注入样本含 `</script>`、中文/空格/百分号路径，启动不执行源字符串。断网 file:// 启动、整目录移动、音效、拒绝播放恢复和 unavailable 后 VM 不挂死；PNG 图层截图与 golden 对比。目标矩阵无证据项目记录未验证，不声称通过。

## Risks / Trade-offs

嵌入 PNG 增加体积但可减少 file:// Canvas 策略差异；仍须实际矩阵验证。不能靠本机 HTTP 开发服务器的成功代替直接打开验收。

## Migration Plan

无旧播放器。先用合成场景和模拟桥，再接 M1/M2/M3 的真实 IR；M5 通过同一桥/调度接口增加媒体能力。
