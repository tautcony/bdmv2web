# Tasks

前置依赖：establish-core-contracts。接口可提前消费；完成集成验收前必须取得上游契约及相关验收。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。文中命令/文件是目标交付物，当前未实现。

## 1. 发现及协议基线

- [ ] 1.1 实现BDMV自身/直接父目录发现；验收：中文/空格、大小写候选、歧义和symlink负例符合规格。
- [ ] 1.2 按 design 的主备表实现整文件回退；验收：有效主、缺失主、损坏主、未知版本、双有效冲突、双无效逐行有测试及实际来源。
- [ ] 1.3 登记index/MOBJ/MPLS/CLPI/sound支持版本、字段依据与固定参考revision；验收：每种supported格式都有独立字节fixture，未知版本不误报支持。

## 2. 结构解析

- [ ] 2.1 实现index入口/标题/访问属性；验收：First Play/Top Menu/HDMV/BD-J各自目标及索引正确，混合入口不丢失。
- [ ] 2.2 实现MOBJ容器、对象属性、12字节raw命令与精确源偏移；验收：两记录golden一致，截断/异常count不补零。
- [ ] 2.3 实现MPLS PlayItem/IN-OUT/Mark/STN/UO mask；验收：两PlayItem章节及单位正确，非法Mark可定位。
- [ ] 2.4 保留SubPath/角度/连接属性及支持状态；验收：高级播放标记完整交给M5，不能在归一化中消失。
- [ ] 2.5 实现CLPI ProgramInfo/CPI/EP映射及PID/语言/编码；验收：时间与SPN黄金数据一致，段越界安全失败。
- [ ] 2.6 实现sound条目/编码/采样信息及有界样本范围；验收：多条声音和截断负例，未输出假WAV。

## 3. 图与CLI交接

- [ ] 3.1 建立类型化引用图、missing/unresolved与全部声明；验收：缺STREAM/CLPI/对象、PID冲突、循环和未解码命令边可追踪且遍历有界。
- [ ] 3.2 接入inspect JSON/文件输出与支持预测；验收：stdout可解析，计数不删BD-J，analysisStage=structural。
- [ ] 3.3 接入extract结构产物/raw源映射/manifest；验收：输出事务及源hash不变，未接IG阶段明确声明。
- [ ] 3.4 提供M2/M3消费ParsedDisc的集成fixture；验收：入口/轨道/raw命令来源一致，结构成功不宣称全路径已验证。
