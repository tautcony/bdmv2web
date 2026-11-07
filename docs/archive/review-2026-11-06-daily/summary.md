# Summary：2026-11-06 提交批次审查

审查范围 `07b287b..19d323b`。返回 [index](index.md) · 修复进度见 [fix-checklist.md](fix-checklist.md)（P1×2、P2×14 已全部修复，2026-11-07；修复后全仓 11 个 workspace 项目 514 项测试通过、11 个项目类型检查干净）。

## Findings 总表

| ID | 严重度 | 位置 | 摘要 | 证据 | 置信度 |
| --- | --- | --- | --- | --- | --- |
| P1-1 | P1 | packages/hdmv/src/vm.ts:505 | 播放列表等待期 MENU_INPUT 转移被 MEDIA_ENDED 静默回退 | 探针实测 + 静态路径 | 高 |
| P1-2 | P1 | apps/cli/src/index.ts:645-647 | fallbackTarget 捕获活数组引用，fallback 播放列表自身被吞 | 静态路径 + 消费链核对 | 机制高 |
| P2-1 | P2 | packages/hdmv/src/vm.ts:305-307 | 播放等待期按钮命令 fault 销毁 continuation，MEDIA_ENDED 无法恢复 | 探针实测 | 高 |
| P2-2 | P2 | packages/hdmv/src/vm.ts:506-512 | TOP_MENU 无阻塞标志，重复按键产生多个 TITLE_SEARCH | 探针实测 | 高 |
| P2-3 | P2 | packages/hdmv/src/vm.ts:840-848 | unsupportedOperation 置 idle 后出现 waiting 非空但 status=idle | 静态推演 | 中 |
| P2-4 | P2 | packages/igs/src/igs.ts:126 | ICS continuation 拼接无 limits 约束（O(n²) + 无上限） | 探针实测 | 高 |
| P2-5 | P2 | packages/igs/src/transport.ts:283-296 | PesAssembler.end() 新完成包被唯一调用方丢弃 | 静态路径 | 高 |
| P2-6 | P2 | apps/cli/src/index.ts:244-249 | PGS 轨道缓存按 clipId:pid 共享，时间戳偏移取第一条引用 | 静态路径 | 机制高 |
| P2-7 | P2 | apps/cli/src/index.ts:519 | scenes.json 同 schemaVersion 下移除 indices 字段 | 静态 + grep | 中 |
| P2-8 | P2 | packages/igs/src/png.ts:6-49 | effects 诊断移除后与 manifest limitation 声明不一致 | 静态 diff | 中 |
| P2-9 | P2 | apps/cli/src/index.ts | preMenuPlaylistIds 全链路无 CLI 级测试 | grep 全仓 | 高 |
| P2-10 | P2 | packages/runtime-web/src/browser.ts:167-172 | 只有 menuMedia 无主 media 时 VM 进入 stopped | 静态路径 | 机制高 |
| P2-11 | P2 | packages/runtime-web/src/browser.ts:256-258 | PLAY_PLAYLIST_MARK 多 PlayItem 选择被忽略 | 静态 + 规格对照 | 中 |
| P2-12 | P2 | packages/runtime-web/src/browser.ts:428-429 | 启动期场景切换泄漏重复输入监听器 | 静态路径 | 中 |
| P2-13 | P2 | packages/package-builder/src/index.ts:141-149 | manifest 路径用原始 id、写入用清洗后 id | 静态路径 | 机制高 |
| P2-14 | P2 | packages/runtime-web/src/index.ts:798-807 | 恢复路径 autoplay 拒绝升级为 MEDIA_ERROR，无重试 | 静态 + 对照 | 中 |

## INFO 记录

- INFO-1 limits/ContractError 重构是破坏性收紧：未知键报错、包内坏 limits 使 createMenuVm 抛错（fail-fast）、maxCallDepth:0 变合法。发布说明需覆盖。
- INFO-2 golden json 14 行改动与实现同提交；已对照 pinned libbluray 1.5.0 源码独立复算（hdmv_vm.c:1087 BREAK = 对象结束），新期望与参考一致，断言未削弱。
- INFO-3 运行时为片头 playlist 合成 MEDIA_ENDED 是 openspec 定义的契约；属对未发生播放的合成状态上报，忠实性取舍待维护者确认。
- INFO-4 ffmpeg onProgress 回调异常会逸出成 uncaughtException；旧版 ffmpeg 只输出 out_time_ms 时无进度。
- INFO-5 igs-adapter.ts:174-176 空循环死代码。
- INFO-6 未提交工具类改动（.gitignore/AGENTS.md/.codex/llm-wiki）不在范围。

## 横向反证结果（已扫模式）

- 分发/命令入口：未知选项、多余参数、`--flag=` 空值均校验失败；exit code 语义一致。
- 异步链路：静音恢复 `setTimeout(0)` 武装时序、track 切换 switchSequence 双序列守卫、bridge 监听器单实例——均已排查未命中新问题。
- 状态写入：CLI staging transaction、media-export 失败统一 unlink、writeJsonFile link() 原子写；无先删后建窗口（除 P1-2 的半完成窗口）。
- 渲染/导出链路：`renderAssets:false` 诊断等价；PGS `extract --type sup` 的 sup 文件清理与 manifest 一致。
- 硬约束：当日 diff 未新增 SHA-256/指纹/文件大小校验；浏览器包无 Node-only 导入；file:// 离线路径未破坏；fixtures/测试/日志无真实盘标题、机器路径、file:// URL；提取与渲染可分离性保持。
- A/V track 确认：selectAudioStream 全链成功后才触发 hook，MEDIA_STARTED 在 play() resolve 后发送，满足 AGENTS.md 要求。

## 残留疑点（未升级为 finding）

1. recoverMenuAction 恢复 continuation 时不重建 actionQueue，恢复早于动作派发时动作可能回不到队列；可达性取决于 browser.ts 派发时序，静态审查未能确证。
2. executeButtonProgram CALL_OBJECT 后同调用内同步 runTurn 执行整个被调对象，与 libbluray 逐轮驱动的等价性未做逐指令对照。
3. ICS continuation 9 字节公共头假设、parseEffectSequence crop/forcedOn 位含义仅由合成 fixture 自洽验证；真实盘分片 ICS 覆盖未证实。
4. PGS 时间戳锚定 ±2s 容差对"clip 首包早于 PlayItem 入点"的盘未实测。
5. findTopMenuPlaylist 64 步上限对深层 VM 链是否充足，无法静态判定。
6. 效果期间 pendingAutoAction 在 changePage 覆盖 activeEffect 时静默丢弃；实际盘面是否出现未知。

## 已验证命令及结果

- `packages/igs` vitest：39 通过（审查单元运行）
- `apps/cli` tsc + vitest：35 通过（审查单元运行）
- `packages/runtime-web` vitest：110 通过（审查单元运行）
- `packages/media-export` vitest：55 通过；`packages/package-builder`：11 通过；`packages/test-runner`：48 通过；`packages/hdmv`：88 通过
- 探针复现（hdmv P1-1/P2-1/P2-2、igs P2-4）：临时 vitest 文件实测，复现后删除，套件保持通过
- 完整套件未由主审运行
