# Design

## Context

依赖 M0–M4，对应架构 §8、§11.3、§12、§15。M1 图仅是结构，M3/M2 提供命令边，M5 负责可达闭包。共同决策见 [实施基线](../IMPLEMENTATION_BASELINE.md)。

## Goals / Non-Goals

**Goals:** 可达媒体计划、FFmpeg/FFprobe、MP4/音轨变体/普通 PGS、双向时间映射、播放反馈与 standalone-full。

**Non-Goals:** 浏览器转码、原盘按需加载、默认 MSE/fetch、多角度/PiP/无缝分支/HDR 的无证据支持。未支持不等于可删引用。

## Decisions

### 1. Analyze 在转码前完成

合并全部入口、对象命令、按钮命令、播放列表/SubPath/轨道引用。静态闭包与 VM 有界探索结合；条件分支取并集。动态目标不确定时纳入可证明候选全集；无法有界确定则报告 unresolved，不能仅导出本次输入走到的路径。预算耗尽标 unknown。保留不可达声明供诊断，include-unreachable 不改变导航语义。

输出 media-plan.json：每个媒体需求的入口/边来源、PlayItem/Clip/PID/IN/OUT、轨道/变体、输出策略、预计体积/时长、限制及可达性状态。缺 STREAM、未知 codec、角度/辅助视频/无缝要求在转码前说明影响。检查磁盘及 maxOutputBytes；估算不是保证，写入中继续监测，超限安全 abort。

### 2. 转码策略与进程生命周期

对支持的线性单路径优先预合成 MP4，保留每个 PlayItem 映射；动态分支按可独立播放节点输出并记录切换，不承诺无缝。循环菜单背景生成有限本地媒体，由逻辑循环映射驱动，不无限复制输出。

仅转换阶段以参数数组 spawn FFprobe/FFmpeg，shell=false；启动前检查可执行程序/版本/编码器，记录版本及精确参数。默认 SDR H.264/AAC、+faststart、初始 CRF18，不放大，明确像素格式/帧率/比例。不能直接以 DTS/TrueHD/VC-1/M2TS 充当唯一播放资源。HDR 未有经验证 tone mapping 方案即 unsupported。

每个 job 写 staging，捕捉退出码/stderr/超时/取消/空间不足；成功后 ffprobe 检查流/时长/索引/解码，才登记资产。缓存键含源内容 hash、裁剪、轨道、profile、工具版本/参数；不复用半成品。源文件名由已验证文件表提供，不能拼进 shell。

### 3. MediaTimelineMap

每条映射至少含 playlistId/playItemId/clipId/variantId、sourceIn90k/sourceOut90k、playlistStart90k/playlistEnd90k、assetId、mediaStart90k/mediaEnd90k、timestampEpoch/sourceTimebase。区间为半开 [in,out)，最后结束为独立事件；同一 Clip 被多次引用保留独立映射行。45k→90k 乘2，PTS 回绕/discontinuity 不能简单拼加到同一域。

对无重采样速率变化的区间：

`playlistTime = playlistStart + (sourceTime - sourceIn)`

`mediaTime = mediaStart + (playlistTime - playlistStart)`

若转码造成边界偏移，用实际测量的修正项记录，不能只按总时长比例估算。运行时在区间内 bigint 相减后转 currentTime 秒；逆向用实际媒体时间定位映射行。seek 在 loadedmetadata 后设置时间，seeked 且目标可解码后提交领域事件/PSR，不提前声称成功。

验证样例：PI0 源 [900000,1080000)、播放列表 [0,180000)；PI1 源 [450000,720000)、播放列表 [180000,450000)。线性输出章节 225000 对应 2.5 秒、PI1、源 495000；边界 180000 属 PI1。误差单独记录；章节 seek 的最大误差以目标视频一帧为验收上限，不以 timeupdate 频率推算。

### 4. PlaybackBridge 与调度

PLAY_PLAYLIST/LinkPI/章节/STOP/STILL/RESUME 经同一动作队列；媒体控制器把 loaded/started/seeked/playitem/time/ended/error 转为领域事件，携 actionId/generation，不直接操作 VM PC。实际 PSR 更新由 VM 支持表控制。

主时钟是 video.currentTime + TimelineMap；暂停冻结媒体域动画，seek/回退重建当时 composition/页面/PG/按钮/效果，不重放已过去的导航副作用。仍帧区分有限/无限等待，有限 still 使用显式可暂停逻辑时钟。loop 维护循环次数与源时间映射，不能把播放结束误作正片结束。

替换 src、seek、轨道切换、复位前由导航调度器分配新 generation，VM 等待记录与媒体桥共同采用，桥不二次递增；取消旧监听/Promise/定时任务，晚到回信不改当前状态。MEDIA_ERROR/unavailable 解除对应等待并报告。Pop-up 叠在同一媒体上下文，不另开脱离 VM 的视频播放器。

### 5. 轨道及 PGS

为受支持主音轨输出可切换本地变体，记录逻辑轨道 ID/PID 到 asset 的映射。切换前保存逻辑播放时间/暂停状态，在目标变体 metadata/seek 成功后反馈并同步 PSR；失败回退或 fault 并报告，不先更新 UI 假装成功。不依赖 audioTracks 的跨浏览器支持。

M5 实施普通 PGS 解复用/对象与调色板解码及时间层，复用有证据的公共图像原语但不将 PG 当 IG。字幕 on/off/选择与 PSR 同步，seek 后重建，独立于 IG z-order。不 OCR 为 WebVTT。强制字幕、TextST、复杂混合效果及无缝音轨要求未验证时明确 partial；不能把被按钮可达的轨道随意排除。

### 6. 完整包集成

standalone-full 复用 M4 package-builder，填充媒体/字幕资产和 TimelineMap；所有播放引用包内闭合。缺少可选但有功能影响的能力为 partial；缺必需资产/包不可启动为 failed。功能通过后仍须 M6 实际浏览器证据才能 complete，不因 FFmpeg 返回 0 自动成功。

## Verification / Exit Criteria

两 PlayItem/重复 Clip/章节边界/非零 PTS/回绕/多音轨/PG/背景循环 fixture；独立验证上述映射数值、逐帧边界、seek 与暂停/返回/pop-up。错误编码器、取消/磁盘不足/坏缓存及源路径特殊字符有负例。file:// 从菜单到正片、章节、切轨、字幕、pop-up、结束返回闭环；旧回调不能污染新代次。提交 ffprobe、媒体质量及离线证据。

## Risks / Trade-offs

预合成和轨道变体会增加体积，用内容去重/计划估算缓解，不以漏打包降低体积。普通原生媒体切换不保证无缝，要求无缝的路径按支持缺口处理。

## Migration Plan

用 M4 的模拟桥回归先锁导航，再替换真实桥。输出仍用 schema 版本控制，不能暗改旧时间表解释。
