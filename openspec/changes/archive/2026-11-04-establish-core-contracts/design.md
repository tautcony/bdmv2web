# Design

## Context

当前无业务代码。M0 为所有 change 提供契约，对应架构 §3–4、§10、§12、§15、§17；共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。

## Goals / Non-Goals

**Goals:** 可重复 TS 工作区、可校验 IR、精确时间、来源/诊断、安全读取与事务输出、fixture 基础。

**Non-Goals:** 业务格式解析、VM、IG 绘制和转码。CLI 未接入的子命令返回明确未实现错误，不输出假数据。

## Decisions

### 1. 工作区与依赖方向

采用 pnpm workspace，包名 @bdmv-web/*。先建 core/bdmv-io/test-fixtures 和 apps/cli，下游随 change 增加。根脚本统一 build/typecheck/test；固定 Node/pnpm/TS/Vitest/bundle 工具版本与 lockfile。core 只用平台无关 TS/Uint8Array，不导入 Buffer、node:fs、DOM；Node I/O 在 bdmv-io，浏览器不得反向依赖转换器。选择单一 schema 来源生成/校验 TS 类型，避免两套结构漂移。

### 2. 契约及阶段校验

| 契约 | 最少内容/约束 |
| --- | --- |
| DiscIR | 版本、入口/程序/菜单/播放列表/媒体资产/诊断；顶层必填 |
| NavigationDescriptor | HDMV movieObjectId 或 BDJ bdjoId/status，判别联合 |
| SourceRef | 相对路径、实际 origin、无损偏移、原始局部 ID |
| AssetReference | ID/类型/路径/MIME/大小/SHA-256/来源列表 |
| MenuScene/PlaylistIR | 作用域 ID、原始/归一化时间及引用；M2/M5 细化须同步 schema |
| PlayerProfile/Limits | 语言/地区/输出能力、内存/执行/输出预算 |
| Diagnostic/Action/Event | 共享基线字段、相关 ID、generation；覆盖进程内事件与 JSON trace |

初始 schema 1.0。校验分语法、ID/引用和阶段能力三层；schema 通过不代表引用或功能通过。未知版本、重复 ID、混合导航字段和非法时间在业务执行前拒绝。提供最小有效 HDMV、混合 BD-J、非法版本、悬空引用交接样本。

### 3. 时间与序列化

提供 parseTime90k/serializeTime90k/from45k；拒绝负数、小数、指数、空白和前导零，覆盖 9007199254740993 反复 JSON 往返。core 不根据“时间变小”猜测回绕，M2 负责 epoch。绝对大时间先 bigint 相减，再在 M5 媒体边界转秒。文件偏移/大小同样无损序列化，转 DataView 索引前核验当前窗口。

### 4. Cursor 与 Limits

Cursor 管理 Uint8Array 窗口，offset/length 是窗口内安全整数，另带文件基偏移。u8/u16be/u32be/u64be/bytes/seek/subview 统一读前检查。subview(n) 成功推进父游标 n，子游标从 0 起且基偏移增加；失败不改变父游标。拒绝负数、非整数、offset+length 溢出及未经检查的 count×size，不补零。

Limits 至少有 maxReadWindowBytes/maxObjectPixels/maxSegmentBytes/maxReassemblyBytes/maxInstructionsPerTurn/maxQueueDepth/maxCallDepth/maxExplorationStates/maxOutputBytes。内存和执行项默认有限，M0 提交具体默认值与边界测试；maxOutputBytes 可为空。大文件按块访问，不能把整部正片读入内存。

### 5. 路径、指纹、输出事务

realpath 检查输入/输出/缓存无重叠，拒绝 symlink 逃逸。二进制资源引用只通过已验证文件表解析。提供 staging/commit/abort：已存在目标拒绝覆盖，同父目录构建，调用方校验后 rename；中断不损坏源与旧输出。

不为外部 BDMV 输入生成 sourceFingerprint，也不承诺原始文件完整性。生成的资产可按内容 hash 命名并保留多对一来源；payloadFingerprint 只覆盖本工具生成的运行文件及路径，不含引用该指纹的 reports，避免自引用。诊断 code/severity 可机器判定，无位置取 null，公开来源用相对路径。

## Verification / Exit Criteria

干净安装、build/typecheck/test 通过，core 浏览器构建无 Node 内建依赖。schema 正反例、时间大数、嵌套 subview、溢出、symlink、输入输出重叠及事务中断均有断言。提交开发命令、Limits 默认值、PlayerProfile schema、浏览器矩阵模板和最小消费方样本。

## Risks / Trade-offs

协议新增字段通过 fixture 驱动细化并同步版本，不用 any 绕过校验。内容指纹增加首次扫描成本，但保证缓存和证据可追踪。

## Migration Plan

无旧数据。下游以交接样本锁定接口，不兼容变更同步所有消费者。
