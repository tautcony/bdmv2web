# Tasks

前置依赖：establish-core-contracts、parse-bdmv-structure。接口可提前消费；完成集成验收前必须取得上游契约及相关验收。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。完成状态以勾选及对应验证记录为准。

## 1. 传输与时间域

- [x] 1.1 实现分块192B源包识别与残余处理；验收：每种读取块分割结果一致，非192B格式/失同步可诊断。
- [x] 1.2 实现TS header/adaptation/PUSI、PAT/PMT和逐PID连续性；验收：adaptation-only/重复包/丢包/discontinuity分别处理，不拼接破损payload。
- [x] 1.3 实现每PID有界PES及PTS/DTS重组；验收：跨包/跨块、33位回绕和新时间域黄金值正确，来源偏移完整。
- [x] 1.4 交叉核验MPLS/CLPI/PMT的IG PID；验收：冲突报告双方来源，PG不误识别为IG。

## 2. IG和图像

- [ ] 2.1 登记ICS/PDS/ODS/Display Set字段与版本依据；验收：支持项有固定参考revision与独立字节样本，未核验项不标supported。
- [x] 2.2 实现跨PES段/分片和epoch/version缓存；验收：缺首末片/EOF/超预算不提交完整场景，新旧对象版本不混拼。
- [x] 2.3 实现有界RLE；验收：透明run/行结束黄金像素正确，越行/超图/异常尺寸在写入前拒绝。
- [ ] 2.4 固定并实现YCbCrA转换/rounding/alpha及PNG输出；验收：独立色块/透明样本逐像素一致，同ODS双PDS有各自正确资产映射。

## 3. 场景与交接

- [x] 3.1 归一化composition/page/BOG/button邻接/区域/三态/自动动作；验收：双页fixture的作用域ID、默认按钮、非法引用诊断正确。
- [x] 3.2 保留动画/裁剪/窗口/进入退出效果/时间及pop-up属性；验收：时效黄金一致，未知效果有影响范围，不静默扁平化。
- [x] 3.3 保存按钮raw命令与sound引用并交M3同一decoder；验收：每条12字节源偏移正确，M4不需猜业务。
- [x] 3.4 接入extract的scene/PNG/manifest/源映射；验收：M4可消费，破损对象不填透明占位，源不变。
- [x] 3.5 使用同类工具处理当前测试案例（包括已有 Tamako Clip `00005` 和适用的合成 fixture），保存参考输出并与本项目同场景结果对比；逐一覆盖工具可处理的图像对象及按钮各状态所引用的对象，匹配对象版本、调色板版本、透明度和动画帧，记录 fixture、工具/版本、输入及导出方法、时间/颜色规则、差异与无法比较项。参考缺失或工具无法处理的场景标记未验证；不为外部原盘素材生成哈希。

## 场景验收拆分

按静态页、按钮/BOG 作用域、对象版本与双 PDS、动画时间/未知效果、损坏或缺失资源、Tamako Clip `00005` 真实观察逐项记录的 expected/actual/result 与独立参考缺口，见 [M2 场景验收拆分](../../../docs/references/stages/M2-igs-scenes.md#menuscene-场景验收拆分)。该记录细化验收场景，不提升尚未验证的支持状态。
