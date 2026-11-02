# Design

## Context

依赖 M0/M1，对应架构 §7、§10–11、§13。M2 的按钮命令通过同一解码器后续接入，M3 自身不依赖 M2 完成。共享信封见 [实施基线](../IMPLEMENTATION_BASELINE.md)。

## Goals / Non-Goals

**Goals:** 12-byte 解码/反汇编、寄存器、条件/对象/标题/播放导航、可挂起 VM、图分析、支持矩阵及可重复 trace。

**Non-Goals:** DOM、视频和图像执行、猜测未知 opcode、用页面路由代替指令、BD-J。

## Decisions

### 1. 解码和覆盖表

decoder 输入 raw 三个 uint32 与 SourceRef，输出 opcode/group/operand/raw/source。指令来源为 MOBJ 或按钮，不分叉执行器。保留立即数标记、GPR/PSR 类型、非法组合、保留位；未知不丢字节。

提交 docs/hdmv-support.md：精确编码/助记符、操作数、寄存器权限、PC/栈变化、发出的 Action、等待条件、参考 revision/位置、fixture、supported 状态。首期逐类覆盖 Branch/Compare/Set、Jump/Call/Resume、PlayPL/PlayPLatPI/LinkPI、SetStream/SetButtonPage/PopupOff/Still 及会影响路径的其它命令；这是核验清单，不把类别名称当全部已支持指令。未知可达编码阻止完整，不允许 no-op 后继续称成功。

### 2. VM 状态与寄存器

状态至少为 idle/running/suspended/stopped/faulted；快照含 PC（对象/命令索引）、当前入口/标题、GPR/PSR、调用/Resume 上下文、播放上下文、待完成动作、预算计数及确定性随机源状态（若实现随机命令）。

RegisterFile 统一无符号 32-bit 读写。数量、初始化、PSR 字段/访问权限、算术溢出/除零/移位、Compare 控制下一条的规则、Call/Resume 保存范围均从已固定参考逐项落表及测试，不用 JS signed bitwise 或普通函数栈推定。只读 PSR 的系统更新和程序写入通过不同入口。PlayerProfile 的语言/地区/输出能力到 PSR 映射和默认值必须在本 change 锁定，写入 trace。

Jump、Call、Resume、Link 的栈语义各自实现，不能统一成 push/pop。比较只影响规定的下一条执行，不把整个后续块当 if。越界 PC/寄存器或非法目标 fault，不能截断索引后继续。

### 3. Action/Event 挂起与恢复

执行器一轮同步执行，遇需外部完成的指令保存 continuation 和等待条件后返回 Action。菜单立即动作也通过单队列提交，避免 DOM 回调重入 VM。

| 输入/状态 | 处理 |
| --- | --- |
| PLAY_PLAYLIST/章节/seek 请求 | 挂起到支持表规定的 started/seeked/ended 条件，不统一等待 ended |
| 匹配 generation/responseTo 的成功事件 | 更新规定 PSR/播放状态，至多恢复一次 |
| 重复/旧回信 | trace 标 ignored，不改寄存器/PC |
| MEDIA_ERROR 或 unavailable | 记录失败、结束对应等待；按语义 fault/可诊断停止，不保持永久 suspended |
| TOP_MENU/POPUP/RETURN | 检查 UO mask、保存/恢复上下文，按已核验路径处理 |
| 复位 | 清待处理动作并增长 generation，从稳定入口和 PlayerProfile 重新初始化 |

使用模拟桥测试后由 M4/M5 接入。新播放/seek/切轨的 generation 在发动作前由导航调度器分配，并同步更新等待记录；媒体桥不能自行递增而导致本次合法回信被当旧事件。MEDIA_STARTED/PLAYITEM_CHANGED/TIME_UPDATED/MEDIA_ENDED/MEDIA_ERROR、场景完成与 still 完成作为不同事件，不把原生 DOM 事件直接当领域事件。UO mask 同时作用于键盘和指针发出的用户操作，不屏蔽必要系统反馈。

### 4. 有界执行和 trace

每轮指令预算、调用深度、队列深度和探索状态数分别限制，超限输出 VM_EXECUTION_LIMIT 与最后快照。合法菜单循环等待用户输入不算无穷同步循环；不得因 yield 重新获得无限总探索预算。

trace 每条含 session/sequence/generation、源 PC/raw/decoded、输入/Action/Event、寄存器 delta、栈和播放/场景变化、诊断。快照可重放；不把墙钟时间、绝对路径当比对条件。随机/计时输入显式注入，避免黄金测试漂移。

### 5. 导航分析交接

NavigationGraph 节点含对象/命令位置/播放目标，边含条件与来源。静态可确定边直接展开；依赖寄存器的目标保留候选或 unresolved，M5 保守闭包，禁止把一次运行未进入的分支删掉。按钮 raw 序列可作为额外程序批量加入同一分析器。分析预算耗尽标 unknown，不等于 unreachable。

## Verification / Exit Criteria

每个 supported 编码有正例、边界/非法操作数、参考语义依据；控制流 golden 包含 Compare 下一条、Jump/Call/Resume、播放后恢复和返回。模拟桥覆盖乱序/重复/失败/unavailable/旧 generation、超预算；同一 profile/输入产生相同 trace。提交覆盖分母与 unresolved 边，M4 可消费 VM 接口，M5 可消费图。

## Risks / Trade-offs

协议表未完成会阻碍声称全指令支持，但不妨碍逐项开发；缺口必须成为可见的 unsupported，而不是宽泛成功。动作信封增加字段，换取异步恢复可定位与可测试。

## Migration Plan

无旧 VM。先纯函数解码/寄存器，再单步执行、模拟桥、图分析，最后集成浏览器。
