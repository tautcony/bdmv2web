# 诊断码参考

诊断码按前缀分组。查一个码时先确认它由哪一层产生，再看该层的状态规则：同一码在不同层的严重性可能不同。

快速定位：

```sh
rg '"CODE_NAME"' packages apps
```

## 契约与参数（`ContractError`）

| 码 | 典型严重性 | 含义 | 首查 |
| --- | --- | --- | --- |
| `PATH_OVERLAP` | error | 输入/输出/缓存目录重叠 | `assertDisjointRoots`；改用独立 `--out` |
| `PATH_ESCAPE` | error | 路径（含 symlink 解析后）逃出根目录 | `resolveInputFile`、manifest 路径校验 |
| `PATH_NOT_FILE` / `PATH_NOT_DIRECTORY` | error | 期望文件/目录但类型不符 | 输入路径 |
| `SYMLINK_REJECTED` | error | 输入树、BDMV 根、包内文件不接受 symlink | 换真实路径 |
| `FILE_NOT_REGISTERED` | error | 引用了不在已验证文件表中的路径 | `discoverBdmvInput` 的遍历结果 |
| `FILE_REFERENCE_AMBIGUOUS` | error | 虚拟 BDMV 路径命中多个已验证输入路径 | `extract` 的虚拟路径解析；输入目录重复
| `DUPLICATE_FILE_PATH` | error | 文件表出现重复相对路径 | 输入目录大小写变体 |
| `TARGET_EXISTS` | error | 输出目标已存在且未 `--overwrite`，或运行期间出现 | 换目录或加 `--overwrite` |
| `TARGET_NOT_DIRECTORY` | error | 覆盖目标不是目录 | 清理同名文件 |
| `TARGET_CHANGED` | error | 覆盖期间目标被替换 | 重跑，避免并发写同一目录 |
| `TRANSACTION_CLOSED` | error | 事务重复 commit/abort | 调用方控制流 |
| `LIMIT_EXCEEDED` / `INVALID_LIMIT` | error | 超过限流或限流值非法；IGS 层也以 `IgsError`/诊断记录 `LIMIT_EXCEEDED` | `--limits`、`DEFAULT_LIMITS` |
| `INVALID_LIMITS` | error | `--limits` 顶层值不是 JSON 对象 | `--limits` 文件内容 |
| `INVALID_LENGTH` / `INVALID_OFFSET` / `INVALID_WINDOW` / `INVALID_DIMENSIONS` / `INTEGER_OVERFLOW` | error | 长度/偏移/尺寸/乘积非法 | `BinaryCursor` 与调用方 |
| `TRUNCATED_INPUT` | error | 读取超出窗口或文件 | 文件截断、错误偏移 |
| `INVALID_TIME90K` | error | 时间不是规范十进制 | 序列化/反序列化点 |
| `UNKNOWN_SCHEMA_VERSION` | error | `schemaVersion` 不在支持列表 | 运行包装载处 |
| `SCHEMA_VALIDATION_FAILED` | error | DiscIR 不符合 schema | `parseDiscIR` 的 `path` |
| `DUPLICATE_ID` / `DANGLING_REFERENCE` | error | 全局 ID 重复 / 引用不存在 | 构造 DiscIR 的代码 |

## CLI

| 码 | 含义 | 首查 |
| --- | --- | --- |
| `CLI_USAGE` | 无命令、命令未知、位置参数过多 | `commandOptions` |
| `CLI_UNKNOWN_OPTION` | 命令不支持的选项 | 拼写；`convert --mode` 已移除 |
| `CLI_MISSING_VALUE` | 带值选项缺值 | 参数顺序 |
| `CLI_MISSING_INPUT` / `CLI_MISSING_OUTPUT` | 缺输入 / 缺 `--out` | 命令用法 |
| `CLI_INVALID_FORMAT` | `--format` 值不支持 | `validate` 只接受 `json` |
| `CLI_INVALID_PROFILE` | profile 字段长度/字符/取值非法 | `--player-profile` |
| `CLI_EXTRACT_SELECTION` / `CLI_INVALID_EXTRACT_TYPE` | `extract` 类型选择错误 | `--type` 与 `--all` |
| `CLI_INVALID_ASSET_TYPE` / `CLI_INVALID_M2TS` / `CLI_INVALID_PID` / `CLI_INVALID_DECODE` | 资产命令参数非法 | `list-assets`/`export-assets` |
| `CLI_OFFLINE_REQUIRED` | `validate` 缺 `--offline` | 命令用法 |
| `INVALID_LIMITS_FILE` | `--limits` 文件不是合法 JSON | 文件内容 |
| `INVALID_LIMIT` | limits 键未知或值非法 | 允许键与取值范围 |
| `E_NOT_IMPLEMENTED` | 命令已注册但未实现（`compare`），退出码 1 | 改走现有 `convert` + `validate` 组合 |
| `STAGE_FAILED` | 阶段失败时的兜底码：无 `fatal` 诊断时取首条诊断码，取不到才用它 | 同一次运行的完整诊断列表 |
| `E_IO` | 非 `ContractError` 的异常统一出口 | stderr 的 `message` |

## BDMV 结构

| 码 | 严重性 | 含义 | 首查 |
| --- | --- | --- | --- |
| `BDMV_REQUIRED_FILE_MISSING` | fatal（index）/ error（MovieObject） | 必需文件缺失或不可解析 | 输入目录是否完整 |
| `BDMV_UNSUPPORTED_VERSION` | error | 版本不在 `0100/0200/0240/0300` | 文件头版本；主文件不会用旧备份兜底 |
| `BDMV_ROOT_NOT_FOUND` / `BDMV_ROOT_AMBIGUOUS` | error | 目录发现失败/歧义 | 传入 BDMV 根或其父目录 |
| `BDMV_BACKUP_FALLBACK` | warning | 整文件来自 `BACKUP/` | 主文件损坏 |
| `BDMV_BACKUP_DIFFERS` | info | 主备内容不同，已用主文件 | 正常记录 |
| `BDMV_INVALID_SECTION` / `BDMV_INVALID_COUNT` / `BDMV_INVALID_RECORD` | error | section/计数/记录越过文件 | 文件截断或错位 |
| `BDMV_INVALID_MAGIC` | error | 文件头标识错误 | 同名错误文件 |
| `BDMV_INVALID_TIME_RANGE` | error | Mark/PlayItem 时间不在有效区间 | MPLS 时间声明 |
| `BDMV_INVALID_REFERENCE` | error | 引用不存在或非法 | 章节/Mark |
| `BDMV_MISSING_STREAM` / `BDMV_MISSING_CLPI` / `BDMV_MISSING_BDJO` | error | 引用的 STREAM/CLPI/BDJO 不存在 | `STREAM/`、`CLIPINF/`、`BDJO/` |
| `BDMV_STN_CLPI_PID_CONFLICT` / `BDMV_STN_CLPI_CODING_CONFLICT` | warning | STN 与 CLPI 声明冲突，双方保留 | 下游按哪个声明取轨道 |
| `BDMV_DECLARED_LENGTH_MISMATCH` | warning | 声明长度与实际不符，按文件边界继续 | 可忽略；确认不是截断 |
| `BDMV_BDJ_UNSUPPORTED` | warning | BD-J 入口保留但不可执行 | 混合碟片属预期 |
| `BDMV_OPTIONAL_SOUND_MISSING` | info | 没有 `sound.bdmv` | 无音效菜单 |
| `BDMV_PARSE_ERROR` | warning（可选文件）/ error（必需文件） | 解析异常且非 `ContractError` 时的兜底码 | 原始 `message`；可选文件失败会被记录后跳过 |
| `BDMV_UNKNOWN_OBJECT_TYPE` | warning | 入口对象类型未知 | index 入口表 |

## 传输流与 IGS

| 码 | 严重性 | 含义 | 首查 |
| --- | --- | --- | --- |
| `TS_SYNC_LOST` | error | 不是 192 字节源包布局 | 输入是否被重封装 |
| `TS_CONTINUITY_ERROR` | error | 连续计数异常，受影响的显示集/对象被丢弃 | 源流损坏 |
| `TS_DUPLICATE_PACKET` / `TS_TRANSPORT_ERROR` / `TS_TRUNCATED_PACKET` / `TS_INVALID_ADAPTATION_CONTROL` / `TS_INVALID_ADAPTATION_FIELD` | warning/error | 包级异常 | 同左 |
| `PSI_CRC_INVALID` / `PSI_INVALID_LENGTH` / `PSI_INVALID_POINTER` / `PSI_INVALIDATED` | warning/error | PAT/PMT 损坏 | PMT 是否可读 |
| `PES_INVALID_HEADER` / `PES_INVALID_TIMESTAMP` / `PES_TRUNCATED_EOF` / `PES_INVALIDATED` | warning/error | PES 头/时间戳/截断 | 该 PID 的包完整性 |
| `IGS_INVALID_SEGMENT` | error | 段长度或结构非法 | 段起始偏移 |
| `IGS_INCOMPLETE_OBJECT` / `IGS_UNCOMPLETED_DISPLAY_SET` / `IGS_ORPHAN_END` | warning | 对象/显示集未收齐 | EOF 截断或丢包 |
| `IGS_INVALID_RLE` / `IGS_RLE_OVERRUN` / `IGS_RLE_TRUNCATED` | error | RLE 越界/截断 | 对象尺寸与数据长度 |
| `IGS_INVALID_BUTTON_REFERENCE` | error | 按钮引用不存在（`0xffff`/`0xfffe` 除外） | ICS 按钮表 |
| `IGS_PID_CONFLICT` / `IGS_PID_UNRESOLVED` | error | PID 线索冲突/无法确定 | MPLS STN 与 CLPI |
| `IGS_STREAM_INVALIDATED` | warning | 传输损坏导致该流当前单元失效 | 同 `TS_CONTINUITY_ERROR` |
| `IGS_TIME_DOMAIN_RESET` | info | 显式时间域重置 | 正常 |
| `IGS_UNSUPPORTED_SEGMENT` | warning | 段类型未支持 | 保留原始字节 |
| `IGS_NO_DISPLAY_SETS` | warning | 该 clip 没有可用场景 | PID 选择是否正确 |
| `PTS_TIME_DOMAIN_RESET` | warning | PTS 倒退且不接近回绕，开始新的推断时间域 | 源流剪辑或拼接点 |
| `UNRESOLVED_OBJECT` | error | 页引用的对象没有可用定义；含 ODS 续段缺首片段 | ODS 是否收齐；`TS_CONTINUITY_ERROR` 是否同时出现 |
| `UNRESOLVED_PALETTE` | error | 页引用的调色板没有可用定义 | PDS 是否收齐 |

## HDMV 与 VM

| 码 | 含义 | 首查 |
| --- | --- | --- |
| `HDMV_UNKNOWN_OPCODE` / `HDMV_UNKNOWN_GROUP` | 编码不在支持表 | raw 与 `docs/support/hdmv-support.md` |
| `HDMV_UNVERIFIED_OPCODE` | 已解码但超出可执行子集，或标题导航缺标题表 / 指向 BD-J | 该操作的执行上下文；`CALL_TITLE`、`JUMP_TITLE` 最常触发 |
| `HDMV_USER_EVENT_FAULT` | 用户事件处理抛出的非 `RegisterFault` 异常兜底 | 事件 `responseTo` 指向的动作 |
| `HDMV_INVALID_INSTRUCTION` / `HDMV_INVALID_OPERAND_COUNT` / `HDMV_ILLEGAL_OPERAND_COUNT` | 指令结构非法 | 12 字节原始值 |
| `HDMV_ILLEGAL_OPERAND` / `HDMV_ILLEGAL_DESTINATION` / `HDMV_INVALID_REGISTER_ENCODING` / `INVALID_REGISTER_ACCESS` | 操作数/寄存器非法 | 该指令的寄存器字段 |
| `INVALID_REGISTER_VALUE` | 写入值不是 uint32（`RegisterFault`） | 寄存器写入点 |
| `HDMV_RESERVED_BITS_NONZERO` | 保留位非零，继续执行 | 通常可忽略 |
| `HDMV_INVALID_TARGET` / `HDMV_INVALID_PC` | 对象/标题/PC 越界 | 目标对象是否存在 |
| `HDMV_OPCODE_CONTEXT_SKIPPED` | 该上下文不允许此指令，跳过继续执行 | 上下文：MovieObject 还是 IG 按钮 |
| `HDMV_RESUME_WITHOUT_CALL` | 空栈 `RESUME`，继续执行 | 控制流是否符合预期 |
| `HDMV_TITLE_RESPONSE_MISMATCH` | 标题选择回信不匹配 | `selectTitle` 的调用方 |
| `HDMV_MEDIA_UNAVAILABLE` / `HDMV_MEDIA_ERROR` | 媒体不可用/出错，等待结束 | 播放桥 |
| `HDMV_EXECUTION_FAULT` | 执行器内部 fault | 前一条 trace |
| `HDMV_BUTTON_COMMAND_REQUIRES_PROGRAM` | 按钮命令需要程序上下文 | 调用方式 |
| `HDMV_UO_BLOCKED` | 用户操作被 UO mask 禁止 | 页 mask 与动作 |
| `HDMV_INPUT_WHILE_SUSPENDED` | 挂起期间收到输入的处理记录 | 是否应允许导航 |
| `HDMV_EVENT_NOT_READY` / `HDMV_EVENT_AFTER_TERMINAL` / `HDMV_DUPLICATE_EVENT` / `HDMV_IGNORED_EVENT` | 事件时机/重复/被忽略 | `generation` 与 `responseTo` |
| `HDMV_INVALID_CONTINUATION` | 挂起上下文不匹配 | 动作代次 |
| `VM_EXECUTION_LIMIT` | 单轮指令超预算 | `maxInstructionsPerTurn`；是否有同步死循环 |
| `VM_QUEUE_LIMIT` | 队列超限 | `maxQueueDepth` |
| `VM_CALL_DEPTH_LIMIT` | `maxCallDepth < 1` 时遇到 CALL | limits 配置 |
| `VM_LIMITS_OVERRIDDEN` | 运行期 limits 被覆盖，继续执行 | 配置来源 |
| `HDMV_RND_ZERO_RANGE` | `RND(0)`，返回 1 | 指令语义 |
| `HDMV_3D_SUBTITLE_ALIGNMENT_UNIMPLEMENTED` | 3D 字幕对齐未实现 | 2D 路径不受影响 |
| `MENU_ACTION_RECOVERED` | 菜单动作上下文已恢复；这是 trace 条目的 decoded 名，不是诊断码 | trace 记录 |

## 媒体与外部播放

| 码 | 含义 |
| --- | --- |
| `MEDIA_TOOL_UNAVAILABLE` / `MEDIA_ENCODER_UNAVAILABLE` / `MEDIA_TOOL_COMMAND_FAILED` | 缺 `ffmpeg`/`ffprobe`、缺 `libx264`/`aac`，或工具命令执行失败 |
| `MEDIA_PROCESS_FAILED` / `MEDIA_JOB_TIMEOUT` / `MEDIA_JOB_CANCELLED` | 进程失败/超时/取消 |
| `MEDIA_OUTPUT_INVALID` | 产物无法探测 |
| `MEDIA_ASSET_BUDGET_EXCEEDED` / `MEDIA_OUTPUT_BUDGET_EXCEEDED` | 估算超限，编码前终止 |
| `MEDIA_STREAM_FILE_MISSING` / `MEDIA_PLAYLIST_MISSING` / `MEDIA_CLIP_INFO_MISSING` / `MEDIA_STRUCTURE_MISSING` | 源结构缺失 |
| `MEDIA_VIDEO_PID_UNRESOLVED` / `MEDIA_PID_UNRESOLVED` / `MEDIA_VIDEO_TRACK_UNRESOLVED` / `MEDIA_AUDIO_STREAM_UNVERIFIED` | PID/轨道无法唯一确定 |
| `MEDIA_SUBPATH_UNSUPPORTED` / `MEDIA_ANGLE_UNSUPPORTED` / `MEDIA_SUBTITLE_UNSUPPORTED` / `MEDIA_PLAY_ITEM_PARTIAL` | 可达但未支持 |
| `MEDIA_REACHABILITY_INCOMPLETE` / `MEDIA_CLOSURE_BUDGET` / `MEDIA_NAVIGATION_INCOMPLETE` | 闭包/图不完整 |
| `MEDIA_LINEAR_FORMAT_MISMATCH` / `MEDIA_AUDIO_VARIANT_INCOMPLETE` / `MEDIA_AUDIO_VARIANT_MISSING` | 线性拼接不满足 |
| `EXTERNAL_PLAYLIST_UNKNOWN` / `EXTERNAL_PLAYITEM_UNKNOWN` / `EXTERNAL_MARK_UNKNOWN` / `EXTERNAL_PLAYLIST_INVALID` / `EXTERNAL_TIME_INVALID` / `EXTERNAL_TIME_BEFORE_STC` / `EXTERNAL_STREAM_MISSING` | 外部目标解析失败 |
| `MEDIA_ENDED` / `MEDIA_STARTED` / `MEDIA_SEEKED` / `MEDIA_ERROR` / `MEDIA_UNAVAILABLE` | 事件类型，出现在 trace；后两者同时是诊断码 |

### 只由库路径产生的媒体码

以下码来自 `computeMediaClosure`、`createMediaPlan`、`exportLinearMedia`。`convert` 与 `validate` 不调用这三个入口，因此不会在主链路输出中出现。码形如 `{ code, message, source }`，不带 `severity`。

| 码 | 来源 | 含义 |
| --- | --- | --- |
| `MEDIA_TARGET_UNRESOLVED` | `computeMediaClosure` | 闭包根不是播放列表节点 |
| `MEDIA_STRUCTURE_UNRESOLVED` | `computeMediaClosure` | 结构边解析状态不是 `resolved` |
| `MEDIA_NAVIGATION_TARGET_MISSING` | `computeMediaClosure` | 导航目标在导航图与结构图中都找不到 |
| `MEDIA_NAVIGATION_NODE_UNKNOWN` | `computeMediaClosure` | 导航节点状态未知 |
| `MEDIA_NAVIGATION_TARGET_UNKNOWN` | `computeMediaClosure` | 导航边未解析 |
| `MEDIA_PLAY_TARGET_UNKNOWN` | `computeMediaClosure` | 播放/标题导航边没有可证明的播放列表目标 |
| `MEDIA_CONDITIONAL_TARGET_UNKNOWN` | `computeMediaClosure` | 条件边没有已知去向 |
| `MEDIA_ENTRY_SET_UNKNOWN` | `computeMediaClosure` | 没有可用入口来建立媒体根 |
| `MEDIA_ENTRY_TARGET_UNKNOWN` | `computeMediaClosure` | 入口指向不可用的 MovieObject，或是 BD-J/未解析导航 |
| `MEDIA_CODING_TYPE_UNKNOWN` | `createMediaPlan` | PlayItem 含编码类型未知的流 |
| `MEDIA_TRACK_ROLE_UNCLASSIFIED` | `createMediaPlan` | 声明的轨道角色无法分类 |
| `MEDIA_INVALID_INTERVAL` | `createMediaPlan`、`exportLinearMedia` | PlayItem 的 IN/OUT 区间非正 |
| `MEDIA_TRACK_ROLE_UNKNOWN` | `exportLinearMedia` | 保留了角色未知的轨道 |
| `MEDIA_SOURCE_START_UNKNOWN` | `exportLinearMedia` | `ffprobe` 没有给出有限的 `start_time` |
| `MEDIA_VIDEO_STREAM_UNVERIFIED` | `exportLinearMedia` | `ffprobe` 未识别出带索引的视频 PID |
| `MEDIA_VIDEO_ASPECT_UNKNOWN` | `exportLinearMedia` | `ffprobe` 未给出可用的显示宽高比 |
| `MEDIA_AUDIO_VARIANT_UNKNOWN` | `exportLinearMedia` | 多音轨缺语言标注，音轨通道身份不唯一 |
| `MEDIA_CAPABILITY_SEAMLESS_UNSUPPORTED` / `MEDIA_CAPABILITY_SEAMLESS_UNKNOWN` 等 | `createMediaPlan` | 能力报告：码形如 `MEDIA_CAPABILITY_{CAPABILITY}_{STATUS}`，CAPABILITY ∈ seamless/angle/pip/hdr/forced-subtitle/textst，STATUS ∈ unsupported/unknown |

## 菜单、音效与打包

| 码 | 含义 | 首查 |
| --- | --- | --- |
| `MENU_PLAYLIST_NOT_RESOLVED` | 无法从入口解析 Top Menu 播放列表 | `findTopMenuPlaylist` 的 64 步链；入口是否为 HDMV |
| `MENU_SCENE_NOT_FOUND` | 播放列表的 clip/PID 没有对应场景 | `list-assets --type igs` |
| `MENU_SCENE_AMBIGUOUS` | 同一 clip/PID 多个场景 | 场景 `compositionNumber` 与来源偏移 |
| `M4_MENU_OBJECT_CONTEXT_MISSING` | 没有可用的 Top Menu/First Play MovieObject | 入口表与对象表 |
| `M4_ENTRY_NOT_PROJECTED` | 入口没有受支持的导航目标，已从包内菜单省略（warning） | 该入口的 `objectType` 与目标对象 |
| `M4_MEDIA_METADATA_NOT_PROJECTED` | 未导出菜单媒体，源视频流与播放元数据不在包内（warning） | 是否触发 `--export-media` |
| `M4_POPUP_RENDER_PARTIAL` | 弹出菜单只在包内菜单画面上叠加 | 正片由外部播放器播放 |
| `M5_MENU_LOOP_UNAVAILABLE` | 背景时间线无法表示为连续区间 | 播放列表 PlayItem 结构 |
| `M5_POPUP_CONTENT_MEDIA_EXTERNAL` | 弹出菜单所属正片交给外部播放器 | 预期 |
| `M5_PLAYLIST_MEDIA_EXPORTED` | 额外菜单播放列表已导出本地媒体（info） | 包大小 |
| `SOUND_REFERENCE_MISSING` / `SOUND_FORMAT_UNSUPPORTED` / `SOUND_RANGE_INVALID` / `SOUND_SOURCE_MISSING` | 音效缺失/格式不支持/区间非法/源缺失 | `sound.bdmv` 与按钮引用 |
| `IGS_BUTTON_WITHOUT_BOG` / `IGS_BUTTON_MULTIPLE_BOGS` / `IGS_BUTTON_WITHOUT_HIT_GEOMETRY` / `IGS_INVALID_BOG_DEFAULT` | 按钮/BOG 关系异常 | 序列化后的场景 |
| `IGS_UNRESOLVED_VISUAL_ASSET` / `IGS_UNRESOLVED_EFFECT_ASSET` | 序列化时资产缺失 | `adaptIgsScene` 的输入资产 |
| `IGS_UNSUPPORTED_ANIMATION` | 动画帧率/对象不支持 | 场景帧率码与对象表 |
| `IGS_INVALID` / `IGS_UNRESOLVED` | 场景数据非法/未解析 | 场景 JSON |

## 审计与交付

| 码 | 结果 | 含义 |
| --- | --- | --- |
| `PACKAGE_ROOT_MISSING` / `PACKAGE_ROOT_INVALID` | fail | 包目录不存在/不是目录 |
| `PACKAGE_DIRECTORY_UNREADABLE` | fail | 遍历包目录时读失败，审计提前结束 |
| `PACKAGE_ENTRY_MISSING` / `PACKAGE_ENTRY_OPTIONAL` / `PACKAGE_ENTRY_UNLISTED` | fail | `index.html` 缺失/可选/未登记 |
| `PACKAGE_UNLISTED_PAYLOAD` | fail | 运行时载荷未进 manifest |
| `PACKAGE_SYMLINK` / `PACKAGE_FILE_TYPE` / `PACKAGE_FILE_INVALID` | fail | 包内含 symlink/特殊文件 |
| `PACKAGE_PATH_INVALID` / `PACKAGE_PATH_ESCAPE` | fail | manifest 路径非法或逃逸 |
| `PACKAGE_MISSING_ASSET` / `PACKAGE_OPTIONAL_ASSET_MISSING` | fail / not-verified | 必需/可选资产缺失 |
| `PACKAGE_REQUIRED_ASSET_MISSING` | fail | 外部产生的包可能带此必需资产检查 id；本仓库审计写 `PACKAGE_MISSING_ASSET`，判定时两者同等对待 |
| `MANIFEST_MISSING` / `MANIFEST_UNREADABLE` / `MANIFEST_INVALID_JSON` / `MANIFEST_SCHEMA` | fail | 清单缺失或格式错误 |
| `MANIFEST_DUPLICATE_PATH` / `MANIFEST_PATH_RESERVED` | fail | 重复路径/占用报告路径 |
| `OFFLINE_URL_LOCAL` | pass | 运行时 URL 指向包内文件 |
| `OFFLINE_URL_MISSING` / `OFFLINE_URL_ESCAPE` / `OFFLINE_URL_SYMLINK` / `OFFLINE_URL_NOT_FILE` | fail | URL 目标缺失/逃逸/是 symlink/不是普通文件 |
| `OFFLINE_EXTERNAL_URL` / `OFFLINE_UNSAFE_URL` | fail | 外部 URL 或不安全协议 |
| `OFFLINE_STATIC_AUDIT` | pass/fail/not-verified | 静态离线审计汇总 |
| `ACTIVE_EMBED` | fail | 包内出现 `<iframe>`/`<object>`/`<embed>` |
| `BASE_URL_UNSUPPORTED` | fail | 包内出现 `<base>`，会改变 URL 解析基准 |
| `INLINE_EVENT_HANDLER` | fail | 出现内联 HTML 事件属性（`on*`） |
| `BUNDLE_MODULE_SCRIPT` / `BUNDLE_IMPORT` / `BUNDLE_EVAL` / `BUNDLE_NETWORK_API` | fail | 运行时不满足 classic 脚本约束 |
| `BUNDLE_DYNAMIC_ACCESS` / `BUNDLE_DYNAMIC_URL_SINK` | not-verified | 动态访问，需人工确认 |
| `RUNTIME_FILE_TOO_LARGE` / `RUNTIME_FILE_UNREADABLE` | not-verified / fail | 审计跳过或读失败 |
| `PLAYER_PROFILE_INVALID` / `PLAYER_PROFILE_MISMATCH` | fail | profile 非法或三处不一致 |
| `PLAYER_PROFILE_SYNC` | pass | manifest 与运行时 profile 一致 |
| `EXTERNAL_CONFIG` / `EXTERNAL_CONFIG_INVALID` | not-verified / fail | 外部播放配置需现场验证/非法 |
| `MANIFEST_STATUS_UNVERIFIED` | not-verified | manifest 记录状态与当前证据不一致 |
| `PACKAGE_AUDIT_REQUIRED` / `DEPENDENCY_AUDIT_REQUIRED` | not-verified | 没有提供审计/依赖检查 |
| `BROWSER_EVIDENCE_REQUIRED` / `BROWSER_EVIDENCE_BINDING` | not-verified/fail | 浏览器证据缺失或与包不匹配；裸 `BROWSER_EVIDENCE` 只由调用方作为检查 id 传入，本仓库源码不产生 |
| `REFERENCE_EVIDENCE_REQUIRED` | not-verified | 未提供独立对照证据；提供时调用方以 `REFERENCE_COMPARISON` 作为检查 id 传入 |
| `COVERAGE_INCOMPLETE` / `REQUIRED_EVIDENCE_INCOMPLETE` | not-verified | 覆盖率或所需证据不全 |
| `NO_AUDIT_CHECKS` | not-verified | 没有提供任何审计检查项 |
| `ENTRY_COUNTS_MISSING` | not-verified | 缺声明入口数或 HDMV 入口数，无法判断入口一致性 |
| `CAPABILITY_FACTS_INCOMPLETE` | not-verified | 缺必需资产/可达性/可达能力三类事实之一 |
| `RELEASE_REPORT_WRITE_FAILED` | fail | 写 `reports/release-summary.json` 失败 |

## 读诊断的三个原则

1. **先看严重性来源**：`fatal` 只在解析/交付硬失败出现；`error` 让阶段或交付变 `partial`；`warning`/`info` 不改变状态。
2. **再看 `recoverable` / `acknowledged`**：可恢复不等于无影响；已确认不等于状态提升。
3. **最后看位置**：`sourcePath` + `offset`（解析/IGS）或 `entityId`（IR）能定位到具体文件偏移与实体；没有位置的诊断通常来自配置或运行期。
