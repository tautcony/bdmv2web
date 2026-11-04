# Spec Delta

## Purpose

让 IGS 侧的结构诊断也携带真实的传输流来源，使"异常可定位到源文件"在分解层同样成立。

## MODIFIED Requirements

### Requirement: 异常与未知效果

系统 SHALL 检测非法 RLE、缺失对象、非法邻接、超尺寸/预算和未支持效果，不以透明占位伪造成功；每条结构诊断必须可定位到真实来源文件与包标识，不得输出拼接残缺的占位路径。

#### Scenario: RLE 越界

- **WHEN** run 超行宽或解码像素超过 width×height
- **THEN** 在越界写入前终止并定位对象/源偏移

#### Scenario: 超尺寸

- **WHEN** ODS 尺寸乘积超过 maxObjectPixels
- **THEN** 分配前拒绝，给出限制与实际值

#### Scenario: 未支持效果

- **WHEN** 可达场景声明未实现进入/退出效果
- **THEN** 输出 IGS_UNSUPPORTED_EFFECT 及受影响场景，不能宣称画面完整

#### Scenario: 结构诊断的来源

- **WHEN** 传输流层产生结构诊断（同步丢失、连续性错误、PES 不完整等）
- **THEN** 诊断携带真实来源：相对 BDMV 根的路径、origin、包偏移、pid 与 clip 标识；不出现 `STREAM/.m2ts` 这类缺少文件名的拼接结果

#### Scenario: 来源缺失时

- **WHEN** 诊断产生于尚无文件归属的中间阶段
- **THEN** 来源字段明确为空并保留阶段标识，不用占位字符串冒充定位信息
