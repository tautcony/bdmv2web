# Phase 1：hdmv 与 core 包（07b287b..19d323b）

返回 [index](../index.md) · checklist 见 [../fix-checklist.md](../fix-checklist.md)

审查范围：`git diff 07b287b..19d323b` 中 packages/hdmv、packages/core 的指定文件。已对照 docs/review-2026-11-06-hdmv-vm-conformance 第 0/9 节去重。所有结论经当前源码 + `.reference-cache/libbluray-1.5.0` 参考源码核对，3 条关键路径用临时 vitest 探针实测复现（探针已删除，套件 88 项通过）。

## Findings

### P1-1 MENU_INPUT 在播放列表等待期转移对象后，MEDIA_ENDED 会静默撤销该转移
- 位置：`packages/hdmv/src/vm.ts:502-505`（MENU_INPUT 分支 `tryTransfer`）；覆盖点 `vm.ts:469` 一带（`this.programId = pending.nextProgramId`）
- 触发：VM 挂起在 `PLAY_*` continuation 上时 `handleEvent({type:"MENU_INPUT", payload:{objectId:N}})`。旧行为拒绝（`HDMV_INPUT_WHILE_SUSPENDED`，原测试用例已被删除替换）；新代码接受输入并 `tryTransfer`，既不停止 continuation 也不改 status。
- 实测：转移后 `programId=1`、status 仍 `suspended`；随后匹配的 `MEDIA_ENDED` 到达时 `handleEvent` 无条件把 `programId/pc` 重置回 `pending.nextProgramId/nextPc`，新对象被丢弃。对比 JUMP_OBJECT 路径（vm.ts:567）同场景先 `stopPlayingContinuation`。
- runtime-web 当前不派发带 objectId 的 MENU_INPUT（按钮激活走 `executeButtonProgram`，packages/runtime-web/src/index.ts:428），浏览器主流程暂不触发；`HdmvVm` 是公共 API，CLI 导航图与嵌入式宿主可直接命中。
- 修复方向：按 libbluray 挂起语义处理（修复时需先读 `hdmv_vm.c` 确认用户输入在挂起期的行为基线）。
- 证据：测试复现（探针）+ 静态路径；置信度高。

### P2-1 播放列表等待期间的按钮命令 fault 会销毁 continuation
- 位置：`vm.ts:305-307`（executeButtonProgram catch → `fail`）、`vm.ts:240-242`、`vm.ts:943-948`（`fail` 清空 continuation/suspendedPlaylistContinuation/playback，status 转 `faulted`）
- 触发：播放等待期间执行的按钮命令抛 RegisterFault（实测 `BITSET GPR0,#32` → `HDMV_ILLEGAL_OPERAND`；同类 `VM_QUEUE_LIMIT`、`VM_CALL_DEPTH_LIMIT`）。旧代码此场景拒绝按钮命令，continuation 不可能被破坏；新代码放开后形成新暴露面。
- 实测：单个 faulting 命令后 VM `faulted`、`waiting=null`，后续 `MEDIA_ENDED` 被拒（faulted 终态），MovieObject 恢复永久丢失。libbluray 中 IG 命令 fault 只释放当前对象，不动 playing/suspended 对象（`hdmv_vm.c` `_hdmv_step < 0` 仅清当前 object）。
- 浏览器路径有兜底（runtime-web `beginMenuAction`/`recoverMenuAction` 从 checkpoint 恢复）；直接使用 VM API 的调用方没有恢复，VM 卡死 faulted。
- 证据：测试复现（探针）；置信度高。

### P2-2 TOP_MENU 路径不设阻塞标志，重复按键产生多个 TITLE_SEARCH
- 位置：`vm.ts:506-512`（TOP_MENU 分支）、`vm.ts:779-796`（`suspendPlayingForMenuCall` 不触碰 `titleTransition/pendingTitleCall`）
- 实测：连续两次 TOP_MENU 产生两个 `TITLE_SEARCH title=0`。与 JUMP_TITLE 路径（vm.ts:609-610 设置 `suspended + titleTransition`，`inputBlocked()` 拒绝后续输入）不对称。期间 MENU_INPUT/按钮程序可改变 `programId`；随后浏览器对每个 TITLE_SEARCH 都调用 `selectTitle(0)`（browser.ts:245-247），`selectTitle` 无条件覆盖 `programId`（vm.ts:385），造成顶层菜单重启和按钮程序转移丢失。第二个 TITLE_SEARCH 也无去重。
- 证据：测试复现（探针）+ 静态路径；置信度高。

### P2-3 `unsupportedOperation` 在按钮程序中途置 idle，留下 waiting 非空但 status=idle 的不一致窗口
- 位置：`vm.ts:840-848`（无条件 `status="idle"`）；`vm.ts:313-315`（executeButtonProgram 恢复条件要求 `status === "running"`）
- 触发：播放等待期间按钮程序执行 `CALL_TITLE` 且 VM 无 title 表（`HDMV_UNVERIFIED_OPCODE` → `unsupportedOperation`）；continuation 未被触碰但 status 从 running 变 idle。
- 影响：executeButtonProgram 恢复分支不把状态还原为 `suspended`，快照显示 `status="idle"` 且 `waiting` 指向仍在等待的 PLAY 动作——宿主据"VM 空闲"得出错误结论。后续 MEDIA_ENDED 仍可恢复，属状态展示/判读缺陷。
- 证据：静态路径（结合 CALL_TITLE 无表用例推演）；置信度中。

### INFO-1 limits 重构破坏性收紧
- `packages/core/src/limits.ts:24-38`（未知键 `INVALID_LIMIT` 抛错、允许 `maxCallDepth/maxQueueDepth=0`）；`vm.ts:74-79`（构造器 `validateLimits` 抛 ContractError）；`browser.ts:16` 未捕获。
- 影响：(1) CLI `--limits` 文件多余/拼写错误键从忽略变为整个命令报错（contracts.test.ts 新增防拼写断言，方向正确，对既有 limits 文件是行为变化）。(2) 嵌入包内坏 limits 使 `createMenuVm` 抛错、页面启动失败（fail-fast，可见错误）。(3) `maxCallDepth:0` 变合法且等于关闭 CALL（VM-22 文档已声明）。
- 置信度高。无错误行为本身，发布说明应覆盖。

### INFO-2 golden json 改动与实现同提交，经独立核对与参考一致
- `packages/hdmv/src/fixtures/libbluray-1.5.0-source-derived-reference-golden.json`（BREAK trace status `stopped→running`、终态 `stopped→idle`）。
- 独立核对：hdmv_vm.c:1087（`INSN_BREAK: p->pc = 1 << 17`）与 `_vm_run` 终止条件（hdmv_vm.c:1420-1433，`pc >= num_cmds → HDMV_EVENT_END`）——BREAK 产生对象结束事件而非 VM 终态，trace 记录时 status 尚为 running。golden 新期望与参考一致；断言数量未减少、字段未放宽。bdmvkit-rnd.test.ts 删除的 `not.toBe("HDMV_UNVERIFIED_OPCODE")` 经探针验证当前实现下仍成立（fixture 产生零诊断），属无效断言清理。

## 残留疑点

1. `recoverMenuAction` 恢复 continuation 时不重建 actionQueue（vm.ts:184-185 的 `retained` 过滤）；恢复早于 PLAY 动作派发时动作可能回不到队列，`drainActions()` 永远取不到而 VM 挂起等待其完成事件。可达性取决于 browser.ts `dispatchActions` 的 `pendingActions` 时序，静态审查未确证。
2. `executeButtonProgram` 在 CALL_OBJECT 后同调用内同步 `runTurn` 执行整个被调对象（vm.ts:315）。libbluray 逐轮驱动；语义等价性未做逐指令对照，现有测试只覆盖 happy path。
3. VM-08 自认"部分修复"（status 仍复用 `suspended`），P2-3 是其残留面；播放等待 + 标题跳转 + 菜单检查点三态叠加的完整状态矩阵未穷举。

## 漏检复盘

- 算术指令写 PSR 目标：新 `write()`（vm.ts:879-884）拒绝非 GPR 目标，对照 libbluray `_store_reg`（hdmv_vm.c:188-196）确认一致，且旧实现直接抛 RegisterFault，新行为更接近参考。
- decode.ts 保留位掩码改动（`0x0030f8e0→0x0030f0e0`）：逐位核算确认修正了误把分支选项 bit19、比较选项 bit11 当保留位的旧掩码，与 libbluray 容忍方向一致。
- PSR5-8 写入时序、挂起/恢复主链（IG CALL_OBJECT park → RESUME 重发、TERMINATE_PL 恢复、checkpoint 完整性）、重复 MEDIA_ENDED 去重、trace 观察者异常吞掉、VM 调试日志上下文——均排查未命中。
- 工作区改动（后落盘为 19d323b）不涉及 hdmv/core。
