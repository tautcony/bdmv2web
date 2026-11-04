# Tasks

前置依赖：establish-core-contracts、parse-bdmv-structure。接口可提前消费；完成集成验收前必须取得上游契约及相关验收。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；记录固定实现 revision、精确源文件/位置、许可、测试/golden provenance，并在使用白皮书时记录标题、版本、印刷页码。实现冲突要记录双方证据和采用理由。缺少独立 golden 的行为保持 unverified/open。公开白皮书用于补充背景。

## 1. 支持矩阵与解码

- [x] 1.1 建立docs/hdmv-support.md逐编码/操作数/PC栈/Action等待条件矩阵；验收：每个supported项有固定参考revision及fixture，未知不作no-op。
- [x] 1.2 实现统一12字节decoder与反汇编；验收：MOBJ/按钮相同raw同语义，立即数/寄存器/保留位/非法组合负例保留来源。
- [x] 1.3 锁定PlayerProfile默认值与 pinned libbluray 对应的 PSR 字段映射；验收：语言/地区/输出能力重置一致并写入trace，映射和默认值均有来源与测试，不能任意清零所有PSR。

## 2. 执行语义

- [x] 2.1 实现GPR/PSR数量、uint32读写权限及系统更新入口；验收：边界索引/只读PSR/符号位/溢出符合参考。
- [x] 2.2 实现Compare下一条控制、算术和位运算；验收：逐条黄金含真/假、溢出/除零/移位等已支持语义。
- [ ] 2.3 实现PC、Jump/Call/Resume/Link与对象/标题导航；验收：栈和Resume保存范围逐步匹配参考，非法目标fault。
- [x] 2.4 实现PlayPL/PlayPLatPI/LinkPI/SetStream/SetButtonPage/PopupOff/Still及其它已声明系统指令；验收：每个支持项与Action/等待条件一一对应。

## 3. 异步调度与分析

- [x] 3.1 实现idle/running/suspended/stopped/faulted与continuation；验收：动作发出前统一分配新generation，模拟桥started/seeked/ended按各自等待条件恢复，合法新回信至多一次且旧回信拒绝。
- [x] 3.2 处理错误/unavailable/重复/乱序/过期generation；验收：不挂死、不重执行旧命令，当前PC/寄存器不被污染。
- [x] 3.3 接入菜单用户事件与UO mask；验收：键盘/指针同规则，必要媒体系统事件不被屏蔽。
- [x] 3.4 实现每轮指令/调用深度/队列/探索预算；验收：同步循环超限诊断VM_EXECUTION_LIMIT，等待输入的合法循环可继续。
- [x] 3.5 输出含条件/来源的NavigationGraph并可追加按钮程序；验收：动态目标unknown、预算耗尽不判unreachable，M5可消费。

## 4. Trace与交接

- [x] 4.1 实现状态快照、寄存器delta、Action/Event与源指令trace；验收：相同profile/seed/输入语义结果一致。
- [ ] 4.2 建立独立参考golden的Compare/Call/Resume/媒体恢复路径；验收：首分歧可定位，提交支持编码分母和未验证项。
- [x] 4.3 以模拟桥向M4交付执行器、向M5交付图；验收：无DOM/视频依赖，按钮原始序列与对象同一执行器。
- [x] 4.4 建立HDMV多案例执行路径DFS覆盖；验收：从ParsedDisc entries实际运行HdmvVm，循环状态去重并受探索预算限制；所有已访问静态边均归类为实际执行、媒体不可用、unsupported或unresolved，报告覆盖/未解析边与预算状态；不能把BD-J、动态目标、缺少媒体或未执行条件分支算作完整覆盖，也不替代独立参考golden任务4.2。
- [x] 4.5 提供离线MOBJ VM流程可视化器；验收：只读取BDMV结构并复用NavigationGraph，输出以 fenced `mermaid` block 包裹图表的 `.md`，呈现入口、MovieObject指令、条件/跳转/调用/返回上下文、媒体等待与unknown/unresolved目标；动态目标显式标unknown，静态潜在环路以红色class标注并列出涉及的MOBJ/PC，不要求M2TS。

## Current evidence gaps

- 2.3 implements object jump/call/resume and validates known title targets when M1 entries are supplied. `CALL_TITLE` resolves MovieObject-context HDMV entries and restores the caller and saved PSRs according to the pinned libbluray reference; IG-button calls during playlist playback retain their continuation. The focused VM tests are project-authored and are not independent golden evidence. BD-J execution remains unsupported, and independent call/title/resume traces remain open; keep this task open.
- 4.2 has deterministic semantic traces and supported/unknown instruction accounting, but no independent golden paths for Compare/Call/Resume/media restoration. Record expected-data provenance and lineage before treating a comparison as independent. Do not treat synthetic VM fixtures or same-lineage implementation ports as independent evidence.
