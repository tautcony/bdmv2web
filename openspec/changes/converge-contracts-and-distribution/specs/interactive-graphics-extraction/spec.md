# Spec Delta

## Purpose

定义 IGS 结构诊断的传输流来源和异常处理。

## MODIFIED Requirements

### Requirement: 异常与未知效果

系统 SHALL 检测非法 RLE、缺失对象、非法邻接、超尺寸/预算和未支持效果，不以透明占位伪造成功；每条结构诊断必须可定位到真实来源文件与包标识，不得输出拼接残缺的占位路径。

#### Scenario: RLE 越界

- **WHEN** run 超行宽或解码像素超过 width×height
- **THEN** 在越界写入前终止并定位对象/源偏移

#### Scenario: 超尺寸

- **WHEN** ODS 尺寸乘积超过 maxObjectPixels
- **THEN** 分配前拒绝，给出限制与实际值

#### Scenario: 效果引用不可解析

- **WHEN** 可达场景的进入/退出效果引用没有可渲染定义的对象或调色板
- **THEN** 提取输出 UNRESOLVED_OBJECT 或 UNRESOLVED_PALETTE 诊断并把场景标记为不完整，不宣称画面完整
- **THEN** 运行时对缺少渲染资产的效果对象输出 IGS_UNRESOLVED_EFFECT_ASSET，效果序列按已解码的 duration90k/paletteId/crop 数据呈现

#### Scenario: 结构诊断的来源

- **WHEN** 传输流层产生结构诊断（同步丢失、连续性错误、PES 不完整等）
- **THEN** 诊断携带真实来源：相对 BDMV 根的路径、origin、包偏移、pid 与 clip 标识；不出现 `STREAM/.m2ts` 这类缺少文件名的拼接结果

#### Scenario: 来源缺失时

- **WHEN** 诊断产生于尚无文件归属的中间阶段
- **THEN** 来源字段明确为空并保留阶段标识，不用占位字符串冒充定位信息
