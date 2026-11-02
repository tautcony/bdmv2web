# Spec Delta

## Purpose

从传输流恢复有时效与来源的菜单场景及无损图形。

## ADDED Requirements

### Requirement: 传输流重组

系统 SHALL 识别192B M2TS、TS/PSI/PES 并按 PID 有界重组，核验 IG PID，保存精确来源。

#### Scenario: 跨读取块和 PES

- **WHEN** 一个合法 IG segment 跨读取块、TS 与 PES 边界
- **THEN** 重组结果与不分块输入一致，保留 clip/pid/packet/pes/segment 来源

#### Scenario: 连续性错误

- **WHEN** payload 包丢失导致连续计数异常
- **THEN** 报告 TS_CONTINUITY_ERROR，使受影响待组装单元失效，不提交伪完整 Display Set

#### Scenario: 不同步包

- **WHEN** 输入不是受支持192B源包布局
- **THEN** 报告格式或 TS_SYNC_LOST，不盲按188B错位解码

### Requirement: 时间域与状态重置

系统 SHALL 保存原始 PTS、回绕 epoch 与归一化90k；区分回绕和显式不连续。

#### Scenario: PTS 回绕

- **WHEN** 同一连续流的 PTS 跨越33位边界
- **THEN** 归一化时间按正确 epoch 延续，原值可追踪

#### Scenario: discontinuity

- **WHEN** 流携显式不连续标记或重置
- **THEN** 按新时间域处理，不将所有变小时间强行当回绕

### Requirement: 分片与版本生命周期

系统 SHALL 按作用域及版本组装 ICS/PDS/ODS，只有格式完成条件与引用均满足后才提交场景。

#### Scenario: 对象版本更换

- **WHEN** 同 objectId 的新版本分片到达且旧 composition 仍引用旧版
- **THEN** 新旧版本不混拼，旧场景仍关联其正确资源

#### Scenario: EOF 缺片

- **WHEN** 文件结束时 ODS 未收齐或 Display Set 未完成
- **THEN** 报告 IGS_INVALID_SEGMENT/UNRESOLVED_OBJECT，不因 EOF 自动提交完整场景

### Requirement: 菜单场景与无损资源

系统 SHALL 输出页面、BOG、按钮区域/邻接/三态/命令/动画/效果与来源，并按已验证颜色规则生成无损 RGBA PNG。

#### Scenario: 双调色板

- **WHEN** 同一 ODS 先后配两个不同 PDS
- **THEN** 输出各自正确像素和 alpha，映射能定位对象与调色板版本

#### Scenario: 多页按钮交接

- **WHEN** 解析含两页、BOG 和按钮原始命令的 ICS
- **THEN** 保留原始局部 ID 及全局作用域、默认选择、邻接和12字节命令，M3/M4 可消费

#### Scenario: 透明命中区域

- **WHEN** 按钮图像透明区域位于已声明交互矩形内
- **THEN** scene 保留结构化区域，不按 alpha 缩减按钮命中区域

### Requirement: 异常与未知效果

系统 SHALL 检测非法 RLE、缺失对象、非法邻接、超尺寸/预算和未支持效果，不以透明占位伪造成功。

#### Scenario: RLE 越界

- **WHEN** run 超行宽或解码像素超过 width×height
- **THEN** 在越界写入前终止并定位对象/源偏移

#### Scenario: 超尺寸

- **WHEN** ODS 尺寸乘积超过 maxObjectPixels
- **THEN** 分配前拒绝，给出限制与实际值

#### Scenario: 未支持效果

- **WHEN** 可达场景声明未实现进入/退出效果
- **THEN** 输出 IGS_UNSUPPORTED_EFFECT 及受影响场景，不能宣称画面完整
