# Design

## Context

依赖 M0/M1；对应架构 §5.3、§6、§13。输入是只读 Clip 字节流及 MPLS/CLPI 轨道线索，输出供 M3 解码按钮命令、M4 绘制。共享契约见 [实施基线](../IMPLEMENTATION_BASELINE.md)。

## Goals / Non-Goals

**Goals:** M2TS/TS/PES、跨包 IG 分段、ICS/PDS/ODS、无损 RGBA/PNG、页面/BOG/按钮/动画/效果及来源。

**Non-Goals:** PGS 字幕、视频解码、VM 执行、OCR、浏览器输入；影片字幕由外部播放器负责，按钮命令交 M3。

## Decisions

### 1. 有界流式状态机

按以下层次分离，每层有 feed/end/reset 和预算，不把整个 M2TS/PES 无限制缓存在内存。

| 层 | 状态与输出 | 异常处理 |
| --- | --- | --- |
| M2TS | 192B 源包，偏移 4 的 0x47；跨读取块残余 | 不典型包格式报告，不盲按 188B 解码 |
| TS/PSI | header/adaptation/PUSI、PAT/PMT、逐 PID 连续性 | 正确区分无 payload、重复包与 discontinuity；破损 PSI 不当有效表 |
| PES | 每 PID 缓冲、边界/声明长度、PTS/DTS | 丢包使相关待组装单元失效；仅在验证的新边界恢复 |
| IG segment | 跨 PES 段头/长度/fragment | 非法长度、缺片、超预算终止该单元并诊断 |
| composition | ICS/PDS/ODS 版本缓存与 Display Set 完成 | 依格式完成条件提交；EOF 不等于完整提交 |

MPLS/CLPI/PMT 共同确认 IG PID，冲突显式诊断，不能把所有 PG PID 当 IG。丢连续包后不把两段残片拼成合法对象。允许分析模式恢复到下一个验证边界，但受影响路径保持缺口，strict 不 complete。

PTS 保存原始 33-bit 值、epoch、归一化 90k；用连续序列和 discontinuity 标记区分回绕/跳变，discontinuity 开新时间域而不是强制递增。来源保存 clipId/pid/packetOffset/pesOffset/segmentOffset/pts。

### 2. 对象、调色板、合成生命周期

ODS 按 Clip/PID/epoch/objectId/version 组装，检查首末片、声明尺寸和字节数；PDS 按版本保存，不能全局覆盖旧画面的 palette。ICS 引用只有在对应版本对象/调色板可解析、Display Set 完成且未超限时才提交场景。epoch 重置失效缓存按协议证据确定；不跨碟片/Clip 碰撞复用局部 ID。

RLE 支持透明 run、行结束、边界，禁止越行/越图、未终止行、像素数溢出。先核验 width×height 和分配预算再解码。YCbCrA 转换系数、范围、clamp/rounding 和 alpha 规则从已固定依据写入 protocol-support；用独立手算颜色/透明样本和参考帧验证，不以“看起来相似”通过。

渲染资产键包含对象版本、调色板版本及裁剪/帧信息；相同 ODS 配不同 PDS 可生成不同 PNG，相同最终像素可内容去重。保留 palette index/原始 RLE 与 PNG 的来源映射。

### 3. MenuScene 交接模型

| 实体 | 必须保留 |
| --- | --- |
| Composition | 作用域 ID、原始编号/版本、分辨率、时间域/有效区间、来源 |
| Page | pageId、默认/超时选择、UO mask、进入退出效果、有效期 |
| BOG | 组 ID、当前有效按钮及选择约束 |
| Button | 原始 ID、坐标/区域/z-order、邻接 ID、有效条件、自动动作、sound 引用 |
| VisualState | normal/selected/activated 的对象序列、帧区间、重复/裁剪/时序 |
| CommandSequence | raw 12-byte 记录、buttonId/record index/字节偏移，交同一 M3 解码器 |

邻接、BOG 与对象引用都校验；无邻居与非法邻居分开，不自行按几何位置补邻居。命中区域来自结构化按钮区域，不从 PNG alpha 推断。pop-up 及动态效果保留时间事件，不能压成一张截图。未知效果输出 IGS_UNSUPPORTED_EFFECT 与影响，不静默抹去。

### 4. extract 集成与错误

extract 增加 scenes.json、assets/graphics/*.png、源映射及诊断；复用 M1 结构输出和 M0 manifest。一个不可达损坏资源不自动令所有场景失败，但要保留且等待可达性判断；不可启动的关键图形绝不填透明占位冒充成功。IGS_INVALID_SEGMENT/UNRESOLVED_OBJECT、TS_SYNC_LOST/CONTINUITY_ERROR 均带 PID 和文件位置。

## Verification / Exit Criteria

逐层 fixture 覆盖读取块/TS/PES/segment 边界、adaptation-only、重复包、丢包、PTS 回绕/discontinuity、EOF 残片。场景 fixture 覆盖两页/BOG/邻接/自动动作、三态动画、同对象双 palette、透明/裁剪、版本更换。以同类工具处理同一现有测试案例并保存输出作为参考（包括可用的 Tamako Clip `00005`），逐一匹配按钮各状态所引用的图像对象、对象版本、调色板版本及动画帧，比较元素尺寸和 RGBA 像素；不以整页合成或按钮交互作为元素保真验收前提。记录工具版本、输入与导出方法、可比较范围及未支持项；参考结果不得由本项目生成。损坏 RLE/缺片/超尺寸不产生有效 scene。M4 可直接加载 scene fixture，M3 能消费其原始按钮命令。

## Risks / Trade-offs

缓存版本多会增加内存，以 Limits 和生命周期淘汰控制，不牺牲仍被引用的旧版本。没有规范/参考证据的效果标 unverified，不能靠截图猜语义。

## Migration Plan

无旧资产；先完成逐层 fixture，再接真实流和 extract。IR 新字段同步 M0 schema 与 M4 消费测试。
