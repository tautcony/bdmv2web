# Phase 3：runtime-web、media-export、package-builder、test-runner（07b287b..19d323b）

返回 [index](../index.md) · checklist 见 [../fix-checklist.md](../fix-checklist.md)

审查范围：packages/runtime-web/src（index.ts、browser.ts、igs-adapter.ts、linear-playback.ts）、packages/media-export/src、packages/package-builder/src、packages/test-runner/src。覆盖 19d323b。相关包测试全部通过（runtime-web 110、media-export 55、package-builder 11、test-runner 48）。

## Findings

### P2-10 有 menuMedia 但无主 media 时，包内菜单媒体完全不可用且 VM 被置为 stopped
- 位置：`packages/runtime-web/src/browser.ts:167-172`（bridge 选择）与 `browser.ts:253-287`（菜单 Playlist 分支）
- 触发：包数据只有 `menuMedia`（additionalMenuMedia 导出的其他菜单 Playlist 媒体）而没有 `media`（Top Menu 无可导出视频，如纯 still 菜单无视频流时 `menuLoopMediaInput` 返回 null），`playbackBridge` 是 `PreviewPlaybackBridge`。
- 影响：菜单 Playlist 分支把 `PLAY_PLAYLIST*` 派发给 PreviewPlaybackBridge，后者报 "Playback unavailable" 并向 VM 发 `MEDIA_UNAVAILABLE`，VM 进入 unavailable/stopped——即使该 Playlist 的媒体已打包（`assets/media/playlist-<id>/`）。多菜单 Playlist 媒体功能在"主菜单无媒体、子菜单有媒体"的包上自相矛盾。
- 修复方向：bridge 选择改为 `data.media || data.menuMedia?.length` 时构造 `MenuLoopPlaybackBridge`（其 `media` 主项可容缺），或菜单分支对无主 media 直接用 MenuLoop bridge 派发。
- 证据：静态路径；机制置信度高，实际盘面触发概率中等。

### P2-11 PLAY_PLAYLIST_MARK 的多 PlayItem 场景选择被忽略
- 位置：`browser.ts:256-258`
- 触发：菜单 Playlist 含多个带 IGS 场景的 still PlayItem，VM 用 `PLAY_PLAYLIST_MARK`（而非 `PLAY_PLAYLIST_ITEM`）选择。规格 `openspec/changes/export-playable-media/specs/offline-media-playback/spec.md:141` 明确由两者选择并按 `playItem` 切换。
- 影响：`requestedPlayItem` 对 MARK 恒为 0（只有 ITEM 读取 `payload.playItem`），找不到匹配场景时回落 `menuScenesForPlaylist[0]`——多场景 Playlist 显示错误 PlayItem 的菜单画面。包数据未携带菜单 Playlist 的 marks→playItemRef 映射（转换阶段在 CLI 内做了映射但未序列化进包）。
- 修复方向：disc-data.js 打包 marks 映射，或转换阶段把 MARK→playItem 折叠成显式记录随包携带。
- 证据：静态 + 规格对照；置信度中。

### P2-12 启动期场景切换泄漏重复的键盘/指针输入监听器
- 位置：`browser.ts:277-280`（场景切换分支内先 remove 再 install，正确）与 `browser.ts:428-429`（start 点击末尾覆盖 remover 前未调用旧的）
- 触发：start 点击处理器内（`browser.ts:393` 设 `inputStarted=true`）的 `dispatchActions()` 同步触发场景切换分支（转换结果与运行时 VM 实际路径分叉、或初始 auto-action 触发跨场景 PLAY_PLAYLIST）。
- 影响：428/429 覆盖 remover 而不移除分支中刚装的监听器；`installKeyboardInput`（index.ts:1067-1077）与 `installCanvasPointerInput` 无去重，双份监听 → 每次按键 `controller.handle` 执行两次（方向键一次跳两格）、指针 activate 双触发。正常盘面（转换目标 = 运行时首场景）不触发，属潜伏缺陷。
- 修复方向：428/429 前调用现有 remover，或引入"当前已安装"标记。
- 证据：静态路径；置信度中。

### P2-13 additionalMenuMedia 的 manifest 路径用原始 playlistId、实际写入用清洗后 id
- 位置：`packages/package-builder/src/index.ts:141-149`（`playlistId.replace(/[^0-9A-Za-z._-]/g, "_")` 后构造路径）与 `index.ts:170`（`media-plans/playlist-${result.plan.playlistId}.json` 用 `makePlan` 里的原始 id）
- 触发：playlist id 含 `[0-9A-Za-z._-]` 以外字符（parseDiscIR schema 仅 `id: string`）；或两个不同 id 清洗后同名碰撞。
- 影响：manifest.files 指向不存在路径（stat 抛错、构建响亮失败，无静默损坏）；碰撞时第二个 Playlist 的 `ensureAbsent`/`wx` 报错。失败方向安全，错误信息指向错误路径。
- 修复方向：manifest 行使用清洗后 id，或解析期拒绝非法字符。证据：静态路径；机制置信度高、触发概率低。

### P2-14 startMedia 恢复路径把 autoplay 拒绝直接升级为 MEDIA_ERROR，无重试
- 位置：`packages/runtime-web/src/index.ts:798-807`
- 触发：`started === true` 的恢复路径（外部播放器返回、页面恢复）`video.play()`/`audio.play()` 抛 `NotAllowedError`。
- 影响：报告 "Menu media could not resume" 并发 `MEDIA_ERROR`（VM → stopped/error），不走初始启动路径的 `offerRetry` 手势重试通道（index.ts:826-834）。一次瞬时 autoplay 拦截即可终止整个菜单 VM，用户无恢复入口。
- 修复方向：恢复路径对 `NotAllowedError` 复用 `offerRetry`，或返回 false 而不发 MEDIA_ERROR。
- 证据：静态 + 初始路径对照；置信度中（真实浏览器返回场景未实测）。

### INFO-3 运行时为从未播放的片头 Playlist 合成 MEDIA_ENDED
- 位置：`browser.ts:289-294`（preMenuPlaylistIds 分支）
- 触发：VM 请求被转换阶段标记为片头（logo/警告）的 Playlist。
- 影响：片头内容被整体跳过，VM 收到 `MEDIA_ENDED` 立即前进。openspec design/spec 明确定义的契约（"运行时在 VM 中完成这些 Playlist，不交给外部播放器"）且有测试断言；按 AGENTS.md"不得在未确认实际播放状态时报告播放状态"的标准，这是对未发生播放的合成状态上报，忠实性取舍应由维护者确认。
- 证据：静态 + 规格/测试对照；置信度高（行为即代码）。

### INFO-4 ffmpeg 进度回调在 stderr data 处理器内同步执行
- 位置：`packages/media-export/src/index.ts:578-598`
- (a) `options.onProgress` 抛异常从 EventEmitter data 监听器逸出成 uncaughtException，CLI 崩溃；(b) 只解析 `out_time_us`，旧版 ffmpeg 只输出 `out_time_ms` 时静默无进度。均不破坏导出正确性。
- 修复方向：回调包 try/catch 转诊断；可选回退解析 `out_time_ms`。

### INFO-5 igs-adapter 遗留空循环死代码
- `packages/runtime-web/src/igs-adapter.ts:174-176`（删除 IGS_UNSUPPORTED_EFFECT 诊断后循环体为空）。

### INFO-6 test-runner 移除 mode 元数据未削弱证据判定
- MANIFEST_SCHEMA 不再因缺 mode 判 fail，但 mode 从不参与状态判定；stale 证据检测仍绑定 profile/generatedMedia/matrix/environment，`requiredEvidenceComplete` 逻辑未变。旧包 manifest 多余 `mode` 字段被忽略，向后兼容。

## 已排查未命中的高风险点

- 静音恢复竞态（7a61977）：`setMenuMuted(true)` 自动路径用 `setTimeout(0)` 延迟武装 window 捕获监听，避免吞掉引发 handoff 的输入事件；`isMuteControl` 保护静音按钮自身点击；`manualMuted` 优先级正确（手动静音在 handoff 后保持、手动取消静音后再次 handoff 仍武装自动恢复）；`pagehide` 解除武装。新测试断言验证真实事件序列。
- A/V track 变更确认：`selectAudioStream` 在 metadata、seek、ready、`audio.play()` 全部成功后才更新 `selectedAudioStream`/`confirmedPrimaryAudioStream` 并触发 `hooks.audioTrackChanged`（index.ts:931-936）；失败回滚 PSR1；`MEDIA_STARTED` 在 `play()` resolve 后发送；stale 切换由 `switchSequence`/`mediaSequence` 双序列守卫拦截。
- bridge 事件监听器：`MenuLoopPlaybackBridge` 每次 boot 单实例，"ended"/"timeupdate" 各注册一次；`waitAudioMetadata`/`waitAudioEvent` 有 cleanup；场景切换复用同一 bridge。
- media-export 先删后建窗口：资产与 plan 登记 `created`/`copied` 列表，失败统一 unlink（index.ts:365-368、453-456）；SUP 写入前完成解析校验；CLI 侧 beginOutputTransaction staging+commit。
- 硬约束：未新增 SHA-256/指纹/文件大小校验；无 Node-only 导入；未引入网络/server 依赖；测试源码无真实盘标题。

## 残留疑点

1. `extractPgsTrack` 时间戳锚定启发式（media-export index.ts:40-47）：首 PES PTS 与 `timestampOffset90k` 差 ≤2s 时锚定到首 DTS，否则保持区间起点；pgs.test.ts 已对参考 SUP 逐点比对通过，但对全部盘面成立的约定未独立确认。首 PES PTS 早于区间起点时 `(pts - offset) & 0xffffffff` 回绕为大值，排到时间线末尾（对过滤无害，与旧 ffmpeg 路径等价）。
2. 效果期间 `runAutomaticAction` 只置 `pendingAutoAction=true`（index.ts:579）；效果结束前 `changePage`（VM 下发 SET_BUTTON_PAGE）会用新参数覆盖 activeEffect，旧 pending 自动动作静默丢弃。输入在效果期被 `handle()` 屏蔽，但 VM 动作仍可到达，实际盘面是否出现未知。
3. MENU_CALL 响应职责转移（c2c045a 从 browser.ts 移除 `MEDIA_STARTED`/`MEDIA_UNAVAILABLE` 上报）依赖同提交 hdmv vm.ts 重构；runtime-web 测试全绿，VM 侧未做元素级复核（phase-1 已覆盖其主体）。
4. 恢复路径 `audio.src.endsWith(track.path)` 前缀碰撞（index.ts:925）可误判当前音轨：为既有代码，非本次引入。

## 漏检复盘

bridge 监听重复注册（单实例，未命中）；switchMedia 与 in-flight selectAudioStream 交叉污染（守卫拦截，未命中）；同值 src 不触发 loadedmetadata（HTML 规范保证 load 重跑，未命中）；reuseMenuLoopMedia 的 plan 与资产不一致（全量匹配，未命中）；构建产物残留（staging 覆盖，未命中）；45kHz/90kHz 时间单位错配（一致，未命中）；TIME_UPDATED 无 activePlaylistResponse 时的上报语义（仅更新 presentationTime，未命中）。未深审区域：hdmv/vm.ts（phase-1 覆盖）、apps/cli preMenu 遍历细节（phase-2 覆盖）、igs ICS 分片重组（phase-2 覆盖）。
