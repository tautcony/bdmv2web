# Tasks

> 交付内容包括离线菜单、包内菜单背景媒体，以及通过 URL Protocol 请求系统播放器打开源 M2TS。

任务状态记录实现和验收证据。

验收口径：纯函数 URL/路径编码与参数构造、源目标安全约束、模拟浏览器交接事件、合成媒体编码与 FFprobe 元数据、静态媒体计划、事务回滚、离线包审计。外部播放器的实机打开、人工音画观察与跨浏览器解码记录不计入本 change 的验收。范围调整见 [scope-changes.md](../scope-changes.md)。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。各任务的实现与验收状态以勾选和证据记录为准。

## 1. 可达闭包与计划

- [x] 1.1 合并结构、MOBJ与按钮导航边计算保守闭包；验收：条件分支取并集，未知动态目标/探索超限不漏包或冒充完整。
- [x] 1.2 生成media-plan及预算估算；验收：入口/边来源、Clip/PID/IN-OUT/轨道/策略均可追踪，缺文件与高级特性在转码前可见。
- [x] 1.3 实现空间/maxOutputBytes前检与写中检查；验收：估算不足/写中超限安全abort并保留诊断。

## 2. 转码与时间表

- [x] 2.1 接入FFprobe/FFmpeg探测及参数数组spawn；验收：记录版本/参数，无shell拼接，缺工具/编码器和特殊路径负例正确。
- [x] 2.2 实现线性预合成、分支独立片段及菜单背景资产；验收：AVC/H.264 与 HEVC 源均按生效 `--codec` 编码为包内视频（默认 `hevc`，`--codec h264` 时为 `h264`），音频为 AAC，容器 faststart；循环条件和单次 PlayItem 播放模式明确，比例/帧率/质量参数明确，不引用原 M2TS。
- [ ] 2.3 运行 `packages/media-export/src/index.test.ts` 中的取消、超时、部分编码失败和成功退出但 FFprobe 输出无效用例；确认半成品不发布到媒体计划，失败时修复对应导出路径。持久转码缓存保持关闭；覆盖复用由 8.1/8.2 验收。
- [x] 2.4 实现MediaTimelineMap双向映射/半开边界/45k/epoch；验收：设计中225000→PI1源495000和线性2.5秒数值准确，重复Clip不碰撞。
- [x] 2.5 实现章节seek/loadedmetadata/seeked校准；验收：跨PlayItem和非零PTS seek误差不超过一帧，实际成功后才反馈。

## 3. 播放、轨道与PGS

- [x] 3.4 实现主音轨本地变体/逻辑时间恢复/PSR闭环；验收：暂停切轨、播放切轨、失败回退状态正确，不依赖audioTracks。
- [x] 3.6 为源 Playlist 中不适合单文件交接的边界及未支持声明保留影响报告；外部播放器是否支持无缝、角度、PiP、HDR、强制字幕或 TextST 不由网页运行时承诺。

## 4. 集成与证据

影片播放、章节和字幕由外部播放器处理。

## Completed evidence notes

- 3.4 explicitly maps zero-based package STN stream order to one-based PSR stream numbers in runtime data and asset metadata. Runtime tests exercise extracted language-menu commands through `MenuController` and `MenuLoopPlaybackBridge`, then verify local audio selection, page transition, pause/play behavior, logical-time restoration, failure rollback, and stale switch cancellation. The source fixtures remain unchanged.

## Remaining work

- 未勾选任务：2.3、5.1、5.2、5.5、6.2、6.3、6.4、7.1、7.3、8.2。
- 持久媒体资产缓存按用户决定保持关闭，不包含缓存键实现。
- Browser full-feature playback tasks 3.1–3.3, PGS rendering task 3.5 and tasks 4.1–4.2 were removed from this change's delivery scope. Existing library primitives remain code, not a browser playback product promise.


## 当前范围：默认关联播放器接入

影片动作使用前端 URL Protocol。

## 5. 单一产物与目标映射

- [ ] 5.1 运行 `apps/cli/tests/e2e/index.test.ts` 中的单一产物契约用例；确认 CLI、README、manifest、report 和 stdout 一致，旧模式参数被拒绝，并记录结果。
- [ ] 5.2 验收影片动作到实际 M2TS 的映射：使用结构、MovieObject 和按钮导航确定可达目标；保留 Playlist/PlayItem/Clip、IN/OUT、来源及分支。用多 PlayItem、重复 Clip、非零 IN/OUT、缺失源文件和未知目标覆盖映射与诊断；确认结果只描述交接的文件/范围，不声称单文件完成整个 Playlist。复用现有 `external-targets` 单测；仅补齐尚未覆盖的案例。
- [x] 5.4 默认在发现的 BDMV 同级生成 HTML 目录，`--out` 可指定不重叠的其他目标；为 BDMV 自身与父目录输入、路径冲突及既有目录添加验证。
- [ ] 5.5 验收现有可编辑 BDMV 路径配置：CLI 已写入相对/绝对路径，浏览器读取 `runtime/bdmv-config.js`；用模拟资源解析验证共同移动、单独移动、编辑配置和 reload 后的 M2TS 目标路径构造，不作为第三方程序启动验证。

## 6. 默认关联播放器接入

- [ ] 6.2 用户影片动作只触发声明目标的 URL Protocol 请求：按操作系统构造 IINA `iina://open?url=` 或 PotPlayer `potplayer://` 目标，正确编码中文、空格、`#`、`%` 路径，并把 mark 相对 STC 起点的 90 kHz 偏移换算为秒数参数。验收：纯函数断言目标字符串与编码结果；模拟浏览器事件断言 `requested` / `unavailable` / `unknown` 三类结果，不以第三方应用实际打开或完成播放为验收标准。
- [ ] 6.3 在包审计和浏览器消费边界校验 `streamPath` 与已声明 Clip 一致，拒绝绝对路径、目录上跳、反斜线、URL scheme、混淆编码及未声明 Clip，并保留稳定诊断和来源位置。生成器只从已解析 Clip ID 构造固定的 `STREAM/<clipId>.m2ts` 相对路径；不对该合成字符串增加 canonical/符号链接检查。浏览器不读取宿主文件系统、不检查源文件存在性或符号链接去向；源文件可用性由解析阶段记录并由外部播放器处理。
- [ ] 6.4 区分协议请求与实际播放：请求后只记录已构造并已发起的目标；无同步回执时按现有交接契约结束对应等待并恢复菜单操作，不产生 started / ended。验收：模拟无回执、重复回执与不可用目标三种路径后菜单仍可导航。

### Removed (scope change 2026-11-09)

- 6.1 原任务要求实机验证 macOS/IINA 与 Windows/PotPlayer 的 URL Protocol 打开。该编号不再作为待办任务；记录见 [scope-changes.md](../scope-changes.md)。

## 7. 集成与验证

- [ ] 7.1 验收现有离线包审计与发布报告：包内资源缺失和非法引用有稳定 `checkId`/`path`；已声明的外部影片流不计为包内资源缺失；外部源可用性、BDMV 配置和系统关联状态记为未验证。复用 `packages/test-runner` 与 CLI 现有审计用例，只补齐当前缺失的分类或报告断言。
- [ ] 7.3 在模拟 `file://` 页面中回归菜单导航、不可用提示和静音状态：覆盖背景视频、菜单音轨、按钮音效的手动静音与外部请求自动静音；页面按键/点击恢复自动静音，手动静音保持有效。将原 9.2 的资源解析与状态迁移验收并入本项；复用 `runtime-web` 现有浏览器测试，只补齐未断言的音源或状态。

### Removed (scope change 2026-11-09)

- 7.2 原任务要求断网、移动包、源有效/缺失时的人工菜单动作与观察结果记录。该编号不再作为待办任务；离线包迁移与路径解析的自动化验收见 `verify-offline-release` 4.2。


## 2026-11-03 implementation evidence

- 5.2/5.3: `extract` now emits `external-media-targets.json` from structural, MovieObject, and IGS button graphs. Known immediate playlist and HDMV title operands and later MovieObject continuation are represented; unresolved paths conservatively widen the set. A source target resolver retains each PlayItem occurrence, half-open 90 kHz bounds, and mark offsets; it reports missing or invalid targets and does not claim the system player will enforce ranges or continue automatically.
- Remaining: 5.2 在重复 Clip、非零 IN/OUT、缺源样例上的映射断言，以及交付包的离线审计；外部程序实际打开不在本轮验收范围。

- Reference: pinned libbluray 1.5.0 `src/libbluray/hdmv/hdmv_vm.c` `_play_at` and `src/libbluray/bluray.c` `_process_hdmv_vm_event`, PSR8 and clip interval handling; the system default player is not assumed to implement the same playlist timeline.

## 8. 覆盖现有菜单包

- [x] 8.1 `convert --overwrite` 事务性替换已存在菜单目录；匹配媒体计划时复制背景和音轨，跳过媒体转码。验证：`npm run build` 通过；对用户提供的 BDMV 输入执行真实覆盖成功，输出 `media-plan.json` 记录复用，资产路径和大小与覆盖前一致。
- [ ] 8.2 验证媒体计划不匹配/资产缺失时重新导出，以及提交失败时旧包恢复。

## 9. 菜单静音控制

- [x] 9.1 增加右下角静音切换，控制菜单背景视频、音轨和按钮音效；外部影片请求发起前自动静音，页面下一次按键或点击恢复该自动静音，手动静音不被恢复。验证：`runtime-web` 测试覆盖自动恢复与手动静音。
`file://` 静音与恢复验收见 7.3。

## 10. 菜单/内容 IGS 角色与菜单媒体范围

- [x] 10.1 按 `uiModel` 区分常驻菜单（0）与内容弹出菜单（1）；`menuPlaylistIds`/`menuScenes` 包含常驻菜单和 Top Menu 的选中构图，内容弹出场景保留在 `popupScenes`。
- [x] 10.2 对可达的常驻菜单 Playlist 按选中 PlayItem 运行单 Clip 时间线分析；still 菜单允许无音频并导出循环视频。Top Menu 之外的菜单媒体写入独立 `assets/media/playlist-<id>/` 目录和 `media-plans/playlist-<id>.json`。
- [x] 10.3 运行时按 `PLAY_PLAYLIST`、`PLAY_PLAYLIST_ITEM`、`PLAY_PLAYLIST_MARK` 选择菜单场景和本地媒体，支持空音轨；页面进入效果期间选中的 auto-action 在效果结束后执行。
- [x] 10.4 带 `uiModel=1` 弹出 IGS 的标题 Playlist 使用外部播放映射；`runtime-web` 测试确认 `PLAY_PLAYLIST 18` 生成 IINA 协议 URL 且不打开弹出场景，报告 `M5_POPUP_CONTENT_MEDIA_EXTERNAL`。
- [x] 10.5 验证：`media-export`、`package-builder`、`runtime-web`、`cli` 测试通过；Suzume 包保持菜单本地/正片外部；初音ミク与 Interstellar 的 `convert --overwrite` 均成功，`validate --offline` 通过。
- [x] 10.6 浏览器实测：Chrome 156 headless。初音ミク菜单显示 Project DIVA 页面与 1 秒循环背景；Interstellar 进入时跳过片头 Playlist 13 而不请求外部播放器，先播放光盘菜单片头，随后显示 PLAY/SCENE SELECTIONS/LANGUAGES，背景为 50 秒循环视频并带 9 条菜单音轨。
