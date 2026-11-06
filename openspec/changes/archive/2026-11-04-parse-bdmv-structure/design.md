# Design

## Context

依赖 M0 的 Cursor、来源/诊断及 fixture。对应架构 §5、§7.1、§12，共同契约见 [实施基线](../IMPLEMENTATION_BASELINE.md)。本阶段建立 ParsedDisc 与结构图，动态控制流由 M3/M5 补齐。

## Goals / Non-Goals

**Goals:** 目录发现、index/MOBJ/MPLS/CLPI/sound、明确主备规则、完整声明与来源、inspect/extract 结构阶段。

**Non-Goals:** 执行指令/Java、TS/PES、位图或音效转码。BDJO 只检查存在与引用，不读取 JAR 语义。

## Decisions

### 1. 发现与 BACKUP

输入为 BDMV 或直接含 BDMV 的父目录，不递归猜测。大小写变体形成多个候选时报歧义，实际路径保留原大小写。

| 条件 | 行为 |
| --- | --- |
| 主文件格式/版本有效 | 使用主文件，不逐字段混入备份 |
| 主文件缺失/结构损坏，匹配备份有效 | 整文件回退，记录主错误及实际 backup 来源；已修复主错误作为非阻断回退诊断 |
| 主文件版本不支持 | unsupported，不用旧版备份掩盖未知语义 |
| 主备均无效 | 关键入口失败；其他保留 missing 节点及影响 |
| 主备均有效但不同 | 使用主文件，记录差异，不拼接内容 |

仅 index/MovieObject/PLAYLIST/CLIPINF 按匹配备份布局回退；不假定 STREAM/JAR/sound 存在备用。跨文件缺失引用不触发任意主文件替换。所有备份同样受路径安全检查。

### 2. 格式解析责任

解析器只消费 Cursor/ParseContext，输出保留原值的 DTO；ir-builder 解析引用。依次检查 magic/version/段起点/长度/count/记录边界。未知 extension 保留范围与标识，标记未支持，不当已验证字段。

| 格式 | 必须输出 | 消费方 |
| --- | --- | --- |
| index | First Play/Top Menu/Title 原始索引、类型、目标、访问属性 | 入口及 BD-J 报告 |
| MOBJ | 对象 ID/属性/记录数、每条 12 字节 raw 三字与绝对文件偏移 | M3 |
| MPLS | PlayItem/Clip、IN/OUT 原始 45k、连接/角度、Mark、STN、SubPath、UO mask | M2、M5 |
| CLPI | ProgramInfo、PID/编码/语言、CPI/EP 时间与 SPN | M2、M5 |
| sound | 索引、编码/采样率/声道/长度、原始样本范围 | M4 WAV 输出 |

支持版本和准确位域在 docs/support/protocol-support.md 逐项登记固定参考 revision、源码位置和字节 fixture，不从示意图补造数值。每种未知版本有负例。sound 可缺省，但后续按钮引用不存在声音构成功能缺口。

### 3. 图及异常引用

节点含 Entry/Title/MovieObject/Playlist/PlayItem/Clip/Stream/Sound；边含 from/to/kind/source/resolution。未解码命令边为 unresolved，不能直接判 unreachable；未引用声明也保留。M3 提供导航边，M5 才确定完整可达性。

Mark 核验 PlayItem 及 IN/OUT 范围；STREAM 缺失和 CLPI 缺失分开诊断。STN/CLPI PID 或编码冲突保留双方来源，供 M2 PMT 核验。多角度/SubPath 即使未实现播放也保留原始结构和支持标记。图遍历使用 visited，缺失目标显式 missing，错误能回到声明字段。

### 4. CLI 交付

inspect JSON 含 schema 版本、实际来源、entries/结构摘要/图/诊断/支持预测及 analysisStage: structural；不对外部 BDMV 输入树计算或输出哈希/指纹。声明数、成功数、未知数分开，BD-J 不从分母消失。stdout 不混进度。

extract 在 M1 交付 parsed-disc.json、raw 命令表/源映射和 manifest；M2 再追加图形。不把原 M2TS 复制为可交付播放器，不声称 complete。写入通过 M0 事务，不修改源文件；不为源目录计算完整性哈希。

## Verification / Exit Criteria

golden 样本含双 HDMV 入口、混合 BD-J、两 PlayItem/章节、STN/SubPath、多角度标记、CPI/sound；核对精确字段/来源。覆盖主备表、截断/大 count/未知版本/缺 Clip/非法 Mark；M2/M3 可直接消费同一个 ParsedDisc fixture。

## Risks / Trade-offs

保留 unresolved 避免漏媒体，但 inspect 不能作发布结论。整文件回退易追踪，仍须重新校验全图一致性。

## Migration Plan

无旧解析数据。先固定 DTO，再逐格式接入；M3 不改写 raw 指令来源。
