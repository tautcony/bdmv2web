# Tasks

> 当前交付路径为离线菜单、包内菜单背景媒体和通过 URL Protocol 请求系统播放器打开源 M2TS。浏览器内正片播放不属于本 change 的交付目标。

所有任务以当前仓库实现和下方明确列出的验证缺口为准。未接入的线性媒体 API 不等于产品路径已集成。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。文中命令/文件是目标交付物，当前未实现。

## 1. 可达闭包与计划

- [x] 1.1 合并结构、MOBJ与按钮导航边计算保守闭包；验收：条件分支取并集，未知动态目标/探索超限不漏包或冒充完整。
- [x] 1.2 生成media-plan及预算估算；验收：入口/边来源、Clip/PID/IN-OUT/轨道/策略均可追踪，缺文件与高级特性在转码前可见。
- [x] 1.3 实现空间/maxOutputBytes前检与写中检查；验收：估算不足/写中超限安全abort并保留诊断。

## 2. 转码与时间表

- [x] 2.1 接入FFprobe/FFmpeg探测及参数数组spawn；验收：记录版本/参数，无shell拼接，缺工具/编码器和特殊路径负例正确。
- [x] 2.2 实现线性预合成、分支独立片段及菜单背景资产；验收：AVC/H.264 与 HEVC 源均转成 H.264/AAC/faststart，循环条件和单次 PlayItem 播放模式明确，比例/帧率/质量参数明确，不引用原 M2TS。
- [ ] 2.3 完成媒体导出 job 的取消、超时、进程失败和输出探测验收；半成品不得进入 manifest，FFprobe 失败不得以退出码 0 判成功。持久转码缓存当前关闭；菜单覆盖时已有媒体计划匹配复用是独立的目录事务行为，不扩展为内容指纹或通用缓存 key。
- [x] 2.4 实现MediaTimelineMap双向映射/半开边界/45k/epoch；验收：设计中225000→PI1源495000和线性2.5秒数值准确，重复Clip不碰撞。
- [x] 2.5 实现章节seek/loadedmetadata/seeked校准；验收：跨PlayItem和非零PTS seek误差不超过一帧，实际成功后才反馈。

## 3. 播放、轨道与PGS

- [x] 3.4 实现主音轨本地变体/逻辑时间恢复/PSR闭环；验收：暂停切轨、播放切轨、失败回退状态正确，不依赖audioTracks。
- [x] 3.6 为源 Playlist 中不适合单文件交接的边界及未支持声明保留影响报告；外部播放器是否支持无缝、角度、PiP、HDR、强制字幕或 TextST 不由网页运行时承诺。

## 4. 集成与证据

浏览器内正片、章节控制、影片字幕渲染和播放中 popup 已移出当前产品范围，由外部播放器负责；相关原语不作为待交付功能。

## Completed evidence notes

- 3.4 explicitly maps zero-based package STN stream order to one-based PSR stream numbers in runtime data and asset metadata. Runtime tests exercise extracted language-menu commands through `MenuController` and `MenuLoopPlaybackBridge`, then verify local audio selection, page transition, pause/play behavior, logical-time restoration, failure rollback, and stale switch cancellation. The source fixtures remain unchanged.

## Remaining work

- 2.3 remains open. Persistent media-asset caching stays disabled by user decision; no cache-key implementation is included.
- Browser full-feature playback tasks 3.1–3.3, PGS rendering task 3.5 and tasks 4.1–4.2 were removed from this change's delivery scope. Existing library primitives remain code, not a browser playback product promise.


## 当前范围：默认关联播放器接入

影片动作使用前端 URL Protocol；Node 本地播放桥不属于当前实现。

## 5. 单一产物与目标映射

- [ ] 5.1 对齐统一菜单产物的 CLI/文档契约：convert 直接生成唯一菜单产物，不提供模式参数；manifest、report 与 stdout 不包含产物模式字段。CLI、README 和开发文档已更新，测试覆盖产物模式字段已移除以及旧参数被拒绝；待运行相关测试确认。
- [x] 5.4 默认在发现的 BDMV 同级生成 HTML 目录，`--out` 可指定不重叠的其他目标；为 BDMV 自身与父目录输入、路径冲突及既有目录添加验证。
- [ ] 5.5 验收现有可编辑 BDMV 路径配置：CLI 已写入相对/绝对路径，浏览器读取 `runtime/bdmv-config.js`；验证共同移动、单独移动、编辑配置和 reload 后的 M2TS 目标。
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
- Remaining: verify the delivered package and actual external handoff against available feature media, including repeated Clip, nonzero IN/OUT and missing source. Mapping code is already included by `convert`.

- Reference: pinned libbluray 1.5.0 `src/libbluray/hdmv/hdmv_vm.c` `_play_at` and `src/libbluray/bluray.c` `_process_hdmv_vm_event`, PSR8 and clip interval handling; the system default player is not assumed to implement the same playlist timeline.

## 8. 覆盖现有菜单包

- [x] 8.1 `convert --overwrite` 事务性替换已存在菜单目录；匹配媒体计划时复制背景和音轨，跳过媒体转码。验证：`npm run build` 通过；对用户提供的 BDMV 输入执行真实覆盖成功，输出 `media-plan.json` 记录复用，资产路径和大小与覆盖前一致。
- [ ] 8.2 验证媒体计划不匹配/资产缺失时重新导出，以及提交失败时旧包恢复。

## 9. 菜单静音控制

- [x] 9.1 增加右下角静音切换，控制菜单背景视频、音轨和按钮音效；外部影片请求发起前自动静音。验证：`npm run build` 通过。
- [ ] 9.2 在 Chrome `file://` 菜单中验证按钮状态、各音源静音和外部播放器请求时自动静音。
