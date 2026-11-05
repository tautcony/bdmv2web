# Tasks

> 当前交付包括离线菜单、菜单背景媒体和通过 URL Protocol 打开源 M2TS。下方按章节记录实现状态和验证证据。

前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime。接口可提前消费；完成集成验收前必须取得上游契约及相关验收。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。文中命令/文件是目标交付物，当前未实现。

## 1. 可达闭包与计划

- [x] 1.1 合并结构、MOBJ与按钮导航边计算保守闭包；验收：条件分支取并集，未知动态目标/探索超限不漏包或冒充完整。
- [x] 1.2 生成media-plan及预算估算；验收：入口/边来源、Clip/PID/IN-OUT/轨道/策略均可追踪，缺文件与高级特性在转码前可见。
- [x] 1.3 实现空间/maxOutputBytes前检与写中检查；验收：估算不足/写中超限安全abort并保留诊断。

## 2. 转码与时间表

- [x] 2.1 接入FFprobe/FFmpeg探测及参数数组spawn；验收：记录版本/参数，无shell拼接，缺工具/编码器和特殊路径负例正确。
- [x] 2.2 实现线性预合成、分支独立片段及菜单背景资产；验收：AVC/H.264 与 HEVC 源均转成 H.264/AAC/faststart，循环条件和单次 PlayItem 播放模式明确，比例/帧率/质量参数明确，不引用原 M2TS。
- [ ] 2.3 实现job取消/超时/进程失败/缓存key及输出探测；验收：半成品不入manifest，坏缓存不复用，ffprobe失败不以退出0判成功。
- [x] 2.4 实现MediaTimelineMap双向映射/半开边界/45k/epoch；验收：设计中225000→PI1源495000和线性2.5秒数值准确，重复Clip不碰撞。
- [x] 2.5 实现章节seek/loadedmetadata/seeked校准；验收：跨PlayItem和非零PTS seek误差不超过一帧，实际成功后才反馈。

## 3. 播放、轨道与PGS

- [ ] 3.1 替换M4预览桥，连接播放/停止/PlayItem/结束/错误/返回；验收：相同菜单输入导航行为不变，媒体错误解除等待。
- [ ] 3.2 实现currentTime主时钟、pause/seek重建、有限/无限still与背景循环；验收：暂停冻结，回退不重放历史导航副作用。
- [ ] 3.3 实现pop-up在当前播放上下文叠加及generation取消；验收：换媒体/seek后旧Promise/ended/定时器不能污染当前状态。
- [x] 3.4 实现主音轨本地变体/逻辑时间恢复/PSR闭环；验收：暂停切轨、播放切轨、失败回退状态正确，不依赖audioTracks。
- [ ] 3.5 实现普通PGS分段/对象/palette/位图及时间层；验收：独立像素golden、选择/off/seek/PSR闭环，PG不当IG或OCR文本。
- [x] 3.6 为无缝/角度/PiP/HDR/强制字幕/TextST等未支持项建立影响报告；验收：可达缺口保留partial，不能关闭strict升级。

## 4. 集成与证据

- [ ] 4.1 接入standalone-full打包、资产闭包和状态；验收：缺必需资产failed，功能或验证缺口partial，资源全部包内。
- [ ] 4.2 执行菜单→正片→章节→切轨/字幕→pop-up→结束返回file://链路；验收：ffprobe/时间/trace/截图证据齐全，浏览器缺席不称complete。

## Completed evidence notes

- 3.4 explicitly maps zero-based package STN stream order to one-based PSR stream numbers in runtime data and asset metadata. Runtime tests exercise extracted language-menu commands through `MenuController` and `MenuLoopPlaybackBridge`, then verify local audio selection, page transition, pause/play behavior, logical-time restoration, failure rollback, and stale switch cancellation. The source fixtures remain unchanged.

## Remaining work

- 2.3 remains open. Persistent media-asset caching stays disabled by user decision; no cache-key implementation is included.
- 3.1 has an isolated/exported `LinearPlaybackBridge` draft with generation, seek, end, error, stop and playlist-target tests. The browser/package path does not construct this bridge for `standalone-full`, so replacement/integration acceptance remains open.
- 3.2 has `MediaClockScheduler`, still timer and background-loop clock primitives with focused unit tests. Media pause/seek/ended handlers and a pure scene rebuild hook are not integrated.
- 3.3 keeps an active linear media element across a `MENU_CALL` and cancels stale wait listeners/timers on replacement. The VM/browser pop-up path is not integrated as an actual overlay, so this task remains open.
- 3.5 has SUP segment, palette, object-fragment, PCS crop, RLE bitmap and 90 kHz timeline primitives. Tests use synthetic bytes only; independent pixel golden, player rendering, subtitle PSR closure and real seek evidence are missing.
- 4.1/4.2 require the standalone-full package path and user-connected Google Chrome `file://` run. V1 is Chrome-only; acceptance does not require a cross-browser matrix or specify an operating system.


## 当前范围：默认关联播放器接入

影片动作使用前端 URL Protocol；Node 本地播放桥不属于当前实现。

## 5. 单一产物与目标映射

- [ ] 5.1 将 `convert INPUT --out DIR` 接入统一菜单产物；移除产品模式分支，明确旧 `--mode` 参数及旧包的迁移和诊断，并更新 CLI、manifest、README 与状态测试。
- [x] 5.4 默认在发现的 BDMV 同级生成 HTML 目录，`--out` 可指定不重叠的其他目标；为 BDMV 自身与父目录输入、路径冲突及既有目录添加验证。
- [ ] 5.5 生成可编辑 BDMV 路径配置，默认相对 HTML 目录指向同级 BDMV；支持相对和绝对路径、重新加载、菜单与本地接入一致消费，验证共同移动和单独迁移后的重新配置。
- [ ] 5.2 复用结构和导航信息映射可达影片动作至实际 M2TS；保留 Playlist/PlayItem/Clip、IN/OUT、来源和分支，未知目标不猜测。
- [ ] 5.3 验证多 PlayItem、重复 Clip、非零 IN/OUT 与缺失源文件；展示实际打开范围，不承诺完整 Playlist 语义。

## 6. 默认关联播放器接入

- [ ] 6.1 在 Google Chrome 的直接 `file://` 环境实测 macOS/IINA 与 Windows/PotPlayer URL Protocol；实现只使用前端协议导航，不启动本地服务或扩展。
- [ ] 6.2 由用户动作请求对应 URL Protocol 打开实际 M2TS；将 Playlist mark 的 90 kHz 时间戳以 `mpv_start` 秒数传给 IINA；验证中文、空格、#、% 路径、IINA 跳转、PotPlayer 跳转能力、未注册协议、用户取消及启动失败。
- [ ] 6.3 保证目标仅由已声明 BDMV STREAM 中的 Clip 映射生成，并正确编码路径；该纯前端方案不访问文件系统验证源文件/符号链接状态。
- [ ] 6.4 区分协议请求与实际播放；无播放状态回传时不伪造 started/ended，解除 VM 等待并保持菜单可操作。

## 7. 集成与验证

- [ ] 7.1 更新包审计及发布报告：显式区分包内菜单资源和允许的源 M2TS，报告外部源/系统关联的验证状态。
- [ ] 7.2 实测断网、移动包、源有效/缺失及真实菜单动作；记录 Chrome 版本、默认关联程序、实际打开文件和观察结果。
- [ ] 7.3 回归菜单背景、音效、导航及不可用提示；不要求浏览器实现正片、字幕、章节、外部播放器返回或同步。


## 2026-11-03 implementation evidence

- 5.2/5.3: `extract` now emits `external-media-targets.json` from structural, MovieObject, and IGS button graphs. Known immediate playlist and HDMV title operands and later MovieObject continuation are represented; unresolved paths conservatively widen the set. A source target resolver retains each PlayItem occurrence, half-open 90 kHz bounds, and mark offsets; it reports missing or invalid targets and does not claim the system player will enforce ranges or continue automatically.
- Remaining: integrate the mapping with unified menu conversion and URL Protocol handoff, then verify actual opening and source-time mapping with an available feature stream. Tasks 5.2 and 5.3 remain open.

- Reference: pinned libbluray 1.5.0 `src/libbluray/hdmv/hdmv_vm.c` `_play_at` and `src/libbluray/bluray.c` `_process_hdmv_vm_event`, PSR8 and clip interval handling; the system default player is not assumed to implement the same playlist timeline.

## 8. 覆盖现有菜单包

- [x] 8.1 `convert --overwrite` 事务性替换已存在菜单目录；匹配媒体计划时复制背景和音轨，跳过媒体转码。验证：`npm run build` 通过；对用户提供的 BDMV 输入执行真实覆盖成功，输出 `media-plan.json` 记录复用，资产路径和大小与覆盖前一致。
- [ ] 8.2 验证媒体计划不匹配/资产缺失时重新导出，以及提交失败时旧包恢复。

## 9. 菜单静音控制

- [x] 9.1 增加右下角静音切换，控制菜单背景视频、音轨和按钮音效；外部影片请求发起前自动静音。验证：`npm run build` 通过。
- [ ] 9.2 在 Chrome `file://` 菜单中验证按钮状态、各音源静音和外部播放器请求时自动静音。
