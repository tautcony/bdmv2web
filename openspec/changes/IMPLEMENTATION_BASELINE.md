# 七项 change 的实施基线

本文件固定跨 change 的交接约定，补充根目录架构文档。能力行为以各 change 的 `specs/*/spec.md` 为准，实现选择见 `design.md`，顺序见 [DEPENDENCIES.md](DEPENDENCIES.md)。全文描述拟实施契约，不代表已有代码或已通过产品验收。

按阶段使用的标准、工具文档、固定 revision 源码路径和获取方式见 [开发参考索引](../../docs/references/README.md)。

## 1. 模块所有权与交接物

| Change | 拥有模块 | 必须交给下游的产物 |
| --- | --- | --- |
| M0 core | core、bdmv-io、工作区、CLI 骨架、test-fixtures | Schema、精确时间、来源/诊断/事件契约、安全读写、合成样本构建器 |
| M1 structure | bdmv-parser、ir-builder 结构图、inspect/extract 结构阶段 | ParsedDisc、入口/播放列表/Clip/轨道/sound、原始命令、结构引用图 |
| M2 IGS | m2ts-demux、igs-decoder、场景归一化 | Display Set、MenuScene、PNG、对象/调色板映射、按钮原始命令 |
| M3 VM | navigation-hdmv、导航边分析 | 解码命令、执行器、操作码支持矩阵、NavigationGraph、trace |
| M4 runtime | runtime-web、package-builder、音效输出、convert 菜单管线 | classic bundle、portable 菜单包、交互桥、WAV、资产清单 |
| M5 media | 影片目标映射、系统播放器接入 | 可达 M2TS 映射、系统打开接入与外部依赖诊断 |
| M6 assurance | test-runner、validate/compare、发布汇总 | 离线审计、状态决策、golden 对照、浏览器证据 |

M1 只建立容器结构和明确声明的引用，不声称已得到完整控制流。M3 补 MovieObject 导航边；M2 交出按钮命令后，由同一个 M3 解码器补按钮边；M5 合并并计算媒体闭包。M3 单测使用合成按钮命令，不依赖 M2 完成，避免依赖环。sound 在 M1 解析、M4 转 WAV；影片字幕由系统关联的外部播放器负责。

## 2. 共享数据和事件

- 初始 `schemaVersion: "1.0"`；runtime 显式列出可接受版本。未知版本拒绝启动；不兼容字段或语义升主版本，可选扩展也要更新 schema 和消费者测试。
- `SourceRef` 至少含相对 BDMV 根的 `path`、`origin: primary|backup`、文件字节偏移（十进制字符串），以及可用的 entityId/packetOffset/pid/instructionIndex。偏移从文件起点 0 计；实际备份路径不得伪装成主路径。
- 原始数值 ID 保留，跨 Clip/页面的全局 ID 带父作用域。局部 buttonId 不能成为全碟唯一键；反汇编行号不能替代原始指令索引。
- `Time90k` 持久化为匹配 `^(0|[1-9][0-9]*)$` 的字符串，计算用 bigint；45k 原值乘 2 归一化，同时保留原值、单位、时间戳 epoch。时间差可有符号，但不是合法绝对 Time90k。
- `AssetReference` 至少含 id/kind/relativePath/mime/byteLength/sources。包内清单记录路径和长度，不计算内容校验和，也不承诺完整性。路径是解码后的包内相对 POSIX 路径，统一生成 URL，正确处理中文、空格、`#`、`%`。业务以资产 ID 关联，不用盘片文件名直接充当 DOM URL。
- 分阶段校验：ParsedDisc 可带 unresolved 引用；归一化菜单可带 unavailable 动作；运行包必须逐项声明可用性。partial 保留不可用实体，禁止用空 programs/menus 冒充解析成功。
- Diagnostic 必有 severity/code/message/sourcePath/offset/entityId/action/recoverable，另含 stage/affectedEntryIds；无位置取 null。acknowledged Error 仍保留原严重性和功能影响。

core 定义事件信封，VM 定义语义，浏览器与测试桥共用：

```ts
interface ActionEnvelope<T> {
  sessionId: string;
  generation: number;
  actionId: string;
  action: T;
}
interface EventEnvelope<T> {
  sessionId: string;
  generation: number;
  sequence: number;
  responseTo?: string;
  event: T;
}
```

异步成功/失败携带 responseTo；actionId 在会话内唯一。VM 持有明确等待条件，不能假定所有动作都在 MEDIA_ENDED 才恢复。单一调度器递增 sequence，时间更新可合并，导航/完成事件不可静默丢弃。

导航调度器在发出替换媒体、seek、轨道切换或复位动作**之前**分配新的 generation，VM 的等待记录与动作信封同时采用新值；媒体桥只接纳该值，不能再自行递增。用户侧 seek 也先变成导航请求，不绕过调度器。新操作的成功回信按新 generation 正常恢复，旧回信忽略并进入 trace。媒体代次变化不自动清空 GPR；PSR 和调用栈变化由指令语义决定。

## 3. CLI 与输出事务

| 命令 | 输出 | 缺省策略 |
| --- | --- | --- |
| inspect INPUT --format json --out FILE | 结构、入口、诊断、支持预测 | 不把预测写成最终完成度 |
| extract INPUT --out DIR | 结构/原始命令，M2 接入后含 IG/PNG | 明确已完成与未完成阶段，不生成播放器 |
| convert INPUT [--out DIR] | 统一离线菜单包，影片交给默认关联程序打开实际 M2TS | 默认在发现的 BDMV 目录同级生成 `BDMV-menu`；`--out` 可指定不重叠的其他目标；strict 开启 |
| validate DIR --offline [--strict] | 重算资源/依赖/支持/证据报告 | 不读原碟、不改媒体 |
| compare INPUT DIR --trace FILE | 指定输入序列的参考比较 | 开发命令，可用原碟和参考工具 |

`--strict/--no-strict` 显式覆盖默认值。inspect/extract 的命令执行结果与交付状态分开，不把结构成功称为完整交付。退出码：0 按策略完成（非 strict 可接受 partial，但摘要和报告必须显著标明）；1 为 failed/参数或 I/O 错误；2 为 strict 拒绝 partial。机器 JSON 的进度写 stderr。

菜单直接以 `file://` 打开；影片动作由前端按操作系统调用 URL Protocol：macOS/IINA 使用 `iina://open?url=`，Windows/PotPlayer 使用 `potplayer://`。`runtime/bdmv-config.js` 保存可编辑的 BDMV 路径，修改后重新加载菜单生效。输入只读；CLI 转换拒绝输入与输出/缓存重叠及 symlink 逃逸。源 BDMV STREAM 中的 M2TS 是影片交接的外部依赖；菜单运行资源保存在包内。默认拒绝已存在的输出目录；`--overwrite` 使用 staging/backup 事务替换菜单包，并在媒体计划匹配时复用背景视频和音轨。strict 模式拒绝 partial 交付。

## 4. 状态统一判定

compatibility.json 至少含 schemaVersion/toolVersion/runtimeVersion/mode/profile/status/diagnostics/coverage/browserEvidence。按下表从上到下判定，由 M6 实现汇总，各阶段提前遵守：

| 条件 | 状态 | strict |
| --- | --- | --- |
| 关键入口/解析损坏、不能启动、离线边界违规、必需包内资产缺失 | failed | 非零，不发布新正式包 |
| 可启动但有 BD-J、可达不支持能力、影片交接或可达性未证明、验证缺失/失败 | partial | 退出 2，可保留审阅包 |
| 统一产物在声明范围内资源/菜单/影片交接闭环，矩阵及对照证据通过，无阻断诊断 | complete | 退出 0 |

任意 fatal 或安全检查失败一律 failed；未认可的 error 至少阻止 complete。不可达损坏实体仍保留诊断，只有证明不影响任何入口/可达路径并记录非阻断理由，才可作为已认可的诊断。确认 Error、缩小分母、删除入口、关闭 strict 均不能提升完整度。无有效 HDMV 入口的纯 BD-J 碟片在首期为 failed。M5 的功能跑通不自动代表 M6 发布证明完成；缺浏览器或外部播放器交接证据为 partial。

## 5. 本轮固定的首期产品选择

以下是开发默认值；调整时同步规格、配置和验收，不在实现中静默改变。

| 决策 | 约定 | 锁定/验证任务 |
| --- | --- | --- |
| 工具链 | Node LTS、pnpm、TS、Vitest、classic IIFE ES2020 | M0 选择精确版本、lockfile、干净构建 |
| 浏览器 | V1 使用 Google Chrome，不限定操作系统 | M0 建表，M4/M5 冒烟，M6 记录 Chrome 完整版本并直接测试 `file://`；此项缺席即未验证。V1 不要求跨浏览器矩阵 |
| 媒体 | 菜单动态背景和音轨转换时使用 FFmpeg 生成本地 MP4/M4A 并用 FFprobe 检验；音效为 WAV。正片打开原始 M2TS，由默认关联程序播放 | 菜单运行时不依赖 FFmpeg；M5 验证交接，M6 记录源文件和外部程序依赖 |
| 质量 | 菜单图形与背景按实际资源及支持范围报告 | M2/M4 验证菜单视觉和音效 |
| 影片音轨 | 外部播放器负责 | 不承诺网页控制或状态同步 |
| 影片字幕 | 外部播放器负责 | 不承诺网页渲染、选择或状态同步 |
| 高级播放 | 单个 M2TS 的外部播放不等价于 Playlist 编排 | M1/M5 保留多 PlayItem、分支、时间范围及能力限制 |
| PlayerProfile | 语言/地区/输出能力显式配置，默认不依赖 localStorage | M0 schema；M3 锁定标准 PSR 映射，写入 trace/可达性分析 |
| 预算 | 菜单生成须预检输出并受有限内存/执行预算约束；正片不默认复制或转码 | M0 limits；M2/M3/M5 在分配/执行前检查 |

浏览器精确版本、协议 bit-field 不从示意图推定。它们分别是环境锁定和协议证据任务，必须在对应任务完成时提交，不留到发布前笼统“后续确认”。

PlayerProfile 初始产品默认值为 menuLanguage/audioLanguage/subtitleLanguage=`eng`、country=`US`、region=`A`、outputProfile=`portable`；这是可覆盖的播放器模拟配置，不推断用户所在地或碟片实际语言。CLI 以 `--player-profile FILE` 读取并合并，省略时采用默认值；PSR 数值编码和未指定系统字段初值由 M3 的已核验表确定，不能任意清零。该配置及分析时允许的用户可变状态须进入可达性边界说明。

Limits 的工程初值为：maxReadWindowBytes=8 MiB、maxSegmentBytes=16 MiB、maxReassemblyBytes=64 MiB（全部活动 PID 合计）、maxObjectPixels=16777216、maxInstructionsPerTurn=10000、maxQueueDepth=1024、maxCallDepth=128、maxExplorationStates=100000；maxOutputBytes 默认 null。`--limits FILE` 可覆盖，必须验证为合法正整数且不能禁用边界检查。上述为保护性工程预算，不声称是 Blu-ray 协议上限；合法输入超预算也应准确报告 limit exceeded，而非格式损坏。M0 提交配置与边界测试，M2/M3/M5 共同消费。

## 6. 证据与样本交接

每个格式/指令在 `docs/protocol-support.md` 登记：格式/版本或 opcode、字段/语义、可用规范章节或参考实现仓库与固定 revision/源码位置、fixture ID、预期结果、supported/unsupported/unverified。未验证不进入 supported；原始位和来源不代替正确语义。采用第三方代码时记录许可；参考工具不进入离线包。

fixture 统一在 packages/test-fixtures 登记构建器、字节来源、manifest、golden JSON/像素/trace、生成命令和许可。expected 来自已核验字段或独立参考，不由待测实现重新生成后直接作为基准。完整商业碟片不入库，本地参考素材按上游仓库和固定版本引用。

M0–M3 可先用合成样本开发；M2/M3 宣称保真和 M6 发布需要独立参考证据。M4 使用模拟媒体桥，M5 接入系统文件打开；没有外部播放回传时不得伪造播放或结束事件。
