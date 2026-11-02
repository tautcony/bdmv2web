# Tasks

前置依赖：establish-core-contracts、parse-bdmv-structure。接口可提前消费；完成集成验收前必须取得上游契约及相关验收。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。仍未勾选的语义任务保留为待完成项；没有规范或独立 golden 的指令继续标为 unverified。

## 1. 支持矩阵与解码

- [x] 1.1 建立docs/hdmv-support.md逐编码/操作数/PC栈/Action等待条件矩阵；验收：每个supported项有固定参考revision及fixture，未知不作no-op。
- [x] 1.2 实现统一12字节decoder与反汇编；验收：MOBJ/按钮相同raw同语义，立即数/寄存器/保留位/非法组合负例保留来源。
- [ ] 1.3 锁定PlayerProfile默认值与标准PSR字段映射；验收：语言/地区/输出能力重置一致并写入trace，不能任意清零所有PSR。

## 2. 执行语义

- [ ] 2.1 实现GPR/PSR数量、uint32读写权限及系统更新入口；验收：边界索引/只读PSR/符号位/溢出符合参考。
- [ ] 2.2 实现Compare下一条控制、算术和位运算；验收：逐条黄金含真/假、溢出/除零/移位等已支持语义。
- [ ] 2.3 实现PC、Jump/Call/Resume/Link与对象/标题导航；验收：栈和Resume保存范围逐步匹配参考，非法目标fault。
- [ ] 2.4 实现PlayPL/PlayPLatPI/LinkPI/SetStream/SetButtonPage/PopupOff/Still及其它已声明系统指令；验收：每个支持项与Action/等待条件一一对应。

## 3. 异步调度与分析

- [x] 3.1 实现idle/running/suspended/stopped/faulted与continuation；验收：动作发出前统一分配新generation，模拟桥started/seeked/ended按各自等待条件恢复，合法新回信至多一次且旧回信拒绝。
- [x] 3.2 处理错误/unavailable/重复/乱序/过期generation；验收：不挂死、不重执行旧命令，当前PC/寄存器不被污染。
- [ ] 3.3 接入菜单用户事件与UO mask；验收：键盘/指针同规则，必要媒体系统事件不被屏蔽。
- [x] 3.4 实现每轮指令/调用深度/队列/探索预算；验收：同步循环超限诊断VM_EXECUTION_LIMIT，等待输入的合法循环可继续。
- [x] 3.5 输出含条件/来源的NavigationGraph并可追加按钮程序；验收：动态目标unknown、预算耗尽不判unreachable，M5可消费。

## 4. Trace与交接

- [x] 4.1 实现状态快照、寄存器delta、Action/Event与源指令trace；验收：相同profile/seed/输入语义结果一致。
- [ ] 4.2 建立独立参考golden的Compare/Call/Resume/媒体恢复路径；验收：首分歧可定位，提交支持编码分母和未验证项。
- [x] 4.3 以模拟桥向M4交付执行器、向M5交付图；验收：无DOM/视频依赖，按钮原始序列与对象同一执行器。
