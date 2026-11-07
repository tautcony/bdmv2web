# Fix Checklist

修复进度唯一跟踪入口。状态约定：`[ ]` 未开始，`[~]` 部分完成，`[x]` 所有必需步骤完成且有验证证据。
行为基线：hdmv VM 行为类修复（P1-1、P2-1、P2-2、P2-3）必须以 `.reference-cache/libbluray-1.5.0/src/libbluray/hdmv/hdmv_vm.c`、`bluray.c`、`register.c` 为背书，修复说明中给出对应源码位置；非 VM 行为修复以代码证据与回归测试背书。

最后更新：2026-11-07（全部 P1/P2 修复完成，全仓 11 个 workspace 项目 514 项测试通过、11 个项目的类型检查干净）

## P1

### P1-1 MENU_INPUT 在播放列表等待期转移后被 MEDIA_ENDED 回退 `[x]`
- [x] libbluray 背书：`hdmv_vm.c` `_jump_object()` 在交互构图转移时置 `playing_object = NULL`，`_resume_from_play_pl()` 在无 playing_object 时直接返回不恢复；按钮程序经 `hdmv_vm_set_object()` 以 ig_object 运行
- [x] 修复 `packages/hdmv/src/vm.ts` MENU_INPUT 分支：转移成功后若 `hasPlaylistContinuation()` 则 `stopPlayingContinuation`，置 running 并 `runTurn()`
- [x] 回归测试 `index.test.ts` "menu input during a playlist wait transfers the object and drops the playlist wait"：转移 + PLAY_STOP + 迟到 MEDIA_ENDED 记 HDMV_IGNORED_EVENT
- [x] `packages/hdmv` vitest 89 通过（2026-11-07）

### P1-2 fallbackTarget 活数组引用吞掉 fallback 播放列表 `[x]`
- [x] 修复 `apps/cli/src/index.ts`：`preMenuPlaylistIds: [...preMenuPlaylistIds]` 快照，fallback playlist 自身不进入自己的 preMenuPlaylistIds
- [x] 决策（用户未选择，按最佳判断）：保留 19d323b 引入的 fallback 意图，fallback playlist 作为解析出的菜单面计入 `menuPlaylistIds`，运行时按菜单面处理；同步更新 spec（"弹出构图建模的 Top Menu" scenario）与 design.md
- [x] 回归测试 `apps/cli/src/index.test.ts` "treats a popup-model Top Menu playlist as the menu surface and keeps it out of preMenuPlaylistIds"
- [x] `apps/cli` vitest 37 通过（2026-11-07）

## P2

### P2-1 按钮命令 fault 销毁 playlist continuation `[x]`
- [x] libbluray 背书：`_vm_run()` 在 `_hdmv_step() < 0` 时仅清 `p->object`，`playing_object`/`suspended_object` 不受影响，playlist 结束后 `_resume_from_play_pl()` 恢复 MovieObject
- [x] 新增 `failButtonProgram()`：按钮程序 fault 只记诊断、保留 continuation 与 parked 状态，status 按 continuation 恢复为 suspended；executeButtonCommand/executeButtonProgram 的 5 处 fault 路径改用
- [x] 回归测试 "keeps the playlist continuation when a button command faults during a playlist wait"
- [x] `packages/hdmv` vitest 90 通过、`packages/runtime-web` 110 通过（2026-11-07）

### P2-2 TOP_MENU 重复 TITLE_SEARCH `[x]`
- [x] libbluray 背书：`bd_menu_call()` 在同一互斥锁内同步完成 `hdmv_vm_suspend_pl` + `_play_title(TOP_MENU)`，菜单调用与标题选择之间不存在用户输入交错窗口
- [x] 修复 TOP_MENU 分支：发出 TITLE_SEARCH 后置 `suspended + titleTransition`（与 JUMP_TITLE 相同），selectTitle 消费后解除；无表时 selectTitle 拒绝并释放到 idle
- [x] 更新 2 处固化旧契约的断言并新增回归测试（连续 TOP_MENU 只产生一个 TITLE_SEARCH）
- [x] `packages/hdmv` vitest 90 通过、`packages/runtime-web` 110 通过（2026-11-07）

### P2-3 unsupportedOperation 置 idle 造成状态不一致 `[x]`
- [x] libbluray 背书：`_hdmv_step()` 对 unsupported/无效目标记 CRIT 日志后继续（`p->pc += inc_pc`），不改状态机；一致性审计 VM-10 亦要求"不要伪装成 idle"
- [x] 修复 `unsupportedOperation`：只记诊断（instructionDiagnostic/diagnostics/diagnostic），不改 status、不清 pendingTitleCall/titleTransition，执行继续
- [x] 更新 3 处旧断言（control-flow.test.ts、index.test.ts）并新增回归测试（按钮程序中 CALL_TITLE 无表不破坏挂起等待）
- [x] `packages/hdmv` vitest 91 通过（2026-11-07）；hdmv-support.md 契约描述已同步

### P2-4 ICS continuation 拼接无 limits `[x]`
- [x] `packages/igs/src/igs.ts` continuation 分支按 `maxReassemblyBytes` 检查累计长度并抛 `LIMIT_EXCEEDED`
- [x] 回归测试 "rejects combined ICS reassembly that exceeds maxReassemblyBytes"（maxReassemblyBytes: 40 触发诊断、场景不提交）
- [x] `packages/igs` vitest 60 通过（2026-11-07）

### P2-5 PesAssembler.end() 返回值被丢弃 `[x]`
- [x] `packages/igs/src/extract.ts` 消费 `pes.end()` 产出的包（进 processPes 与字节统计）
- [x] 回归测试：transport 层 "commits an unbounded PES still pending at EOF" + extract 层 "commits a scene whose final PES is unbounded at EOF"（场景提交、无 IGS_UNCOMPLETED_DISPLAY_SET；TS 包填充尾按 residual 诊断响亮报告）
- [x] `packages/igs` vitest 60 通过（2026-11-07）

### P2-6 PGS 轨道缓存时间戳偏移 `[x]`
- [x] `extractReachablePgsTracks`/`uniquePgsReferences` 去重键加入 `sourceIn90k`；新增 `pgsTrackEntrySuffixes` 为同一 clip+pid 的多入口分配 `-entryN` 输出路径；`supTrackPath`/`supDisplaySetPath` 支持 entry 后缀
- [x] 回归测试 "extracts well-formed sup track records through the shared PGS extraction path"（bdmvkit-generated fixture，`extract --type sup` 全链路；该 fixture 每流仅单入口，多入口轨道语义无 fixture 覆盖，测试注释已声明）
- [x] `apps/cli` vitest 39 通过（2026-11-07）。限制：仓库无"同一 clip+pid 多入点"的真实盘 fixture，多入口路径后缀逻辑由类型检查与单入口端到端用例覆盖
- [x] 运行 `apps/cli` 测试

### P2-7 scenes.json 同版本移除 indices 字段 `[x]`
- [x] 决策：升级 scenes.json schemaVersion 至 "1.1"（载荷形状随版本变化；diagnostics.json/source-map.json 形状未变保持 1.0）
- [x] `apps/cli/src/index.ts` 写入 1.1 并在测试断言
- [x] `apps/cli` vitest 39 通过（2026-11-07）

### P2-8 effects 诊断与 manifest limitation 不一致 `[x]`
- [x] 确认 runtime 已实现 effects 呈现（igs-adapter adaptEffectSequence + MenuController activeEffect/effectFrame 渲染链路），png.ts 为 effect 对象渲染 PNG 资产
- [x] manifest limitation 更新为 "IGS effect sequences are rendered and presented; effect flag semantics beyond the synthetic fixtures remain unverified"（apps/cli extract manifest、package-builder manifest）
- [x] 同步 docs/support/igs-support.md 诊断清单（unsupported effects → unresolved effect assets）、docs/architecture 诊断列表（IGS_UNSUPPORTED_EFFECT → IGS_UNRESOLVED_EFFECT_ASSET）
- [x] `apps/cli` 39、`packages/package-builder` 11 通过（2026-11-07）

### P2-9 preMenuPlaylistIds 无端到端测试 `[x]`
- [x] `apps/cli/src/index.test.ts` "records playlists completed before the Top Menu surface as preMenuPlaylistIds"（logoUiModel=1 + preMenuChain fixture：preMenuPlaylistIds [1]、menuPlaylistIds 含 7）；P1-2 的 popup Top Menu 测试覆盖 fallback 面
- [x] `apps/cli` vitest 39 通过（2026-11-07）

### P2-10 menuMedia 无主 media 时 VM 进入 stopped `[x]`
- [x] `MenuLoopPlaybackBridge` 的 `media` 参数改为可选（activeMedia 可空，findMedia/startMenuBackground/findAudioTrack/selectAudioStream/applyAudioTrack 加守卫）；`browser.ts` bridge 选择与启动 VM 运行条件改为 `data.media || data.menuMedia?.length`
- [x] 回归测试 "plays packaged playlist media when the package has no primary menu media"（menuMedia-only 包播放打包媒体、无 unavailable）
- [x] `packages/runtime-web` vitest 114 通过、tsc 干净（2026-11-07）

### P2-11 PLAY_PLAYLIST_MARK 多场景选择 `[x]`
- [x] package-builder 输入新增 `menuPlaylistMarks`（playlistId → marks → playItemRef）并序列化进 disc-data；CLI 从 disc.playlists 计算并传入；`browser.ts` MARK 分支按映射选择场景
- [x] 回归测试 "selects the marked PlayItem scene for a PLAY_PLAYLIST_MARK request"（mark 1 → playItem 1 场景 → 外部播放 00043；未修时走 playItem 0）
- [x] `packages/runtime-web` 113→114 通过、`packages/package-builder` 11 通过、`apps/cli` 39 通过（2026-11-07）

### P2-12 启动期输入监听器泄漏 `[x]`
- [x] `browser.ts` start 处理器重装键盘/指针监听前调用现有 remover
- [x] 回归测试 "replaces startup input listeners without leaking duplicates when the first actions switch scenes"（启动期场景切换后 keydown/pointerdown 各 1 个；已做反转验证：注释 remover 后计数为 2，测试失败）
- [x] `packages/runtime-web` vitest 114 通过（2026-11-07）

### P2-13 manifest 清洗路径不一致 `[x]`
- [x] `package-builder` additionalMenuMedia 记录 sanitizedId，manifest 的 media-plan 路径与实际写入路径一致
- [x] `packages/package-builder` vitest 11 通过、tsc 干净（2026-11-07）。限制：仓库无含非法字符 playlist id 的盘面 fixture，特殊字符场景未做端到端测试
- [x] 运行 `packages/package-builder` 测试

### P2-14 恢复路径 autoplay 拒绝无重试 `[x]`
- [x] `startMedia` 恢复路径对 `NotAllowedError` 复用 `offerRetry`（与初始启动路径相同的手势重试），不发 MEDIA_ERROR
- [x] 回归测试 "offers the retry gesture when an autoplay block interrupts an already-started media resume"（恢复被拦截 → offerRetry、VM 保持 suspended、无 MEDIA_ERROR；retry 后 MEDIA_STARTED）
- [x] 第二轮补修：成功启动时重绑 `activePlaylistResponse`（恢复路径与初始启动重试路径各一处），非 loop 播放的自然结束仍上报 MEDIA_ENDED
- [x] 回归测试 "reports MEDIA_ENDED after an initial autoplay block is recovered through the retry gesture"（初始被拦截 → retry → ended → MEDIA_ENDED → VM idle）；恢复路径用例扩展同一断言。两者均做反转验证：去掉对应重绑即失败
- [x] `packages/runtime-web` vitest 115 通过（2026-11-07）

## INFO（不在本批次修复范围）

### INFO-1 limits 破坏性收紧 `N/A` —— 行为符合新契约，记录到发布说明
### INFO-2 golden json 自我比较 `N/A` —— 已独立复算与 libbluray 一致
### INFO-3 片头 playlist 合成 MEDIA_ENDED `[ ]` —— 待维护者确认忠实性取舍（openspec 已定义契约）
### INFO-4 ffmpeg onProgress 异常与 out_time_ms 兼容 `[ ]` —— 低优先级，后续批次
### INFO-5 igs-adapter 空循环死代码 `[ ]` —— 可随相邻改动清理
### INFO-6 工具类未提交改动 `N/A` —— 不在审查范围

## 第二轮复核结论（2026-11-07，维护者反馈核对）

- OpenSpec 未同步：属实。`openspec/specs/interactive-graphics-extraction/spec.md` 与 `openspec/changes/converge-contracts-and-distribution/specs/interactive-graphics-extraction/spec.md` 的"未支持效果"scenario 已改写为当前契约（UNRESOLVED_OBJECT/UNRESOLVED_PALETTE + 运行时 IGS_UNRESOLVED_EFFECT_ASSET）；igs-support.md 的"Unknown effects are preserved as raw bytes"过期句已同步。归档目录（changes/archive/）保留历史原文。
- fix-checklist 重复块：属实（P2-1/2/3 的 [x] 块误插在 ## P1 下、## P2 下残留 [ ] 旧块）。已删除陈旧块并把 [x] 块归位到 ## P2。
- 验证数字：属实。"8 个包/432 项"漏掉了 bdmv-io（6）、bdmv-parser（70）、test-fixtures（5）。全仓 11 个 workspace 项目、514 项测试全部通过；index.md 已更正。
- P2-6 用例名与覆盖不符：属实。该 fixture 每流仅单入口，原断言（clipId:pid 唯一）与多入口语义方向相反且无回归价值。用例改名为 "extracts well-formed sup track records through the shared PGS extraction path"，删除误导断言，注释声明多入口无 fixture 覆盖。
- P2-14 残余（重试成功后 MEDIA_ENDED 不再上报）：属实。第一次修复只覆盖恢复路径；第三轮复核用临时探针确认初始启动重试仍丢 MEDIA_ENDED（该路径更常见：首次播放前无手势必然被拦截），已补上初始分支的重绑。两条路径各有回归测试，均做反转验证（去掉对应重绑即失败），非 loop 播放的自然结束都能上报 MEDIA_ENDED。
- P1-1 残余（非 playlist continuation 的 MENU_INPUT 转移）：不存在该场景。`WAIT_BY_ACTION` 仅 PLAY_* 映射 "ended"，continuation 只由 `actionAndSuspend`/`replayParkedPlayback` 为 PLAY_* 创建，`hasPlaylistContinuation()` 覆盖全部 continuation 形态；CALL_TITLE/JUMP_TITLE 挂起由 `inputBlocked()` 在 MENU_INPUT 入口先行拒绝。留一条记录：未来新增非 "ended" 等待的挂起动作时，MENU_INPUT 分支需同步扩展。
- 弹出构图 scenario WHEN 措辞宽于代码：属实（措辞层面）。scenario 与 design.md 已改为与代码条件一致的表述（解析出的 Top Menu Playlist 选中构图无条件计入菜单面）。

## 差异化反证复盘（2026-11-07，修复完成后横向扫一遍）

- 分发/入口默认分支：P2-10 bridge 的 media 可空路径全部有守卫（findMedia/findAudioTrack/selectAudioStream/startMedia/startMenuBackground），menuMedia-only 包有端到端测试。
- 异步失败路径：P2-14 恢复路径 NotAllowedError 走 offerRetry 且不发 MEDIA_ERROR；P2-5 unbounded PES 的填充尾以 residual 诊断响亮报告而非静默。
- 半完成状态：P1-2 快照消除 fallback playlist 自吞窗口；P2-1/P2-3 保持 continuation 与 status 一致（fault/suspend 不再互相矛盾）；hdmv 新测试覆盖"fault → MEDIA_ENDED 恢复"与"unsupported → MEDIA_ENDED 恢复"序列。
- 先删后建窗口：无新增删除型逻辑；P2-13 仅统一路径引用。
- 监听器生命周期：P2-12 remove-before-install，已做反转验证（无修复时计数 2）。
- 协议字段与命名：P2-11 marks 映射 CLI→package→runtime 全链路有测试；P2-7 schemaVersion 升级消除同版本载荷形状变化。
- limits 框架：P2-4 补齐 ICS 拼接的限制检查，与其余解析路径的 LIMIT_EXCEEDED 防护一致。
- 未修的残留面：summary.md 残留疑点 1-6 与 INFO-3/4/5 保持原状，均记录在案。
