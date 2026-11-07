# 共享契约

权威文件：`packages/core/schema/disc-ir.schema.json`（DiscIR）、`packages/core/src/index.ts`（校验与时间）、`packages/core/src/limits.ts`（限流）、`packages/core/src/defaults.ts`（播放器档案）。

## DiscIR

`DiscIR` 是交付侧的数据契约，不是解析器的内部模型。JSON Schema 是唯一源，`src/disc-ir.generated.ts` 由 `json2ts` 生成，禁止手改。

```ts
interface DiscIR {
  schemaVersion: "1.0";
  entries: Array<{ id: string; navigation: NavigationDescriptor; source: SourceRef }>;
  programs: Array<{ id: string; title: string }>;
  menus: Array<{ id: string }>;
  playlists: Array<{ id: string; programIds: string[]; menuIds: string[]; duration90k?: Time90K }>;
  mediaAssets: Array<{ id: string; kind: string; relativePath: string; mime: string; byteLength: string; sources: SourceRef[] }>;
  diagnostics: Diagnostic[];
}
```

导航是判别联合，混入两边的专有字段会被 schema 拒绝：

```ts
type NavigationDescriptor =
  | { type: "HDMV"; movieObjectId: number }
  | { type: "BDJ"; bdjoId: string; status: "unsupported" };
```

`parseDiscIR(value)` 做三层校验：

1. Ajv 2020 严格模式；`schemaVersion` 不匹配 → `UNKNOWN_SCHEMA_VERSION`；其它 → `SCHEMA_VALIDATION_FAILED`。
2. 全局 ID 唯一（`entries`/`programs`/`menus`/`playlists`/`mediaAssets` 共用一个命名空间）→ `DUPLICATE_ID`。
3. 引用完整性：`playlists[].programIds` 与 `playlists[].menuIds` 必须存在 → `DANGLING_REFERENCE`。

`runtime/disc-data.js` 里的 `ir` 在打包阶段由 `@bdmv2web/package-builder` 过 `parseDiscIR`；浏览器运行时只检查对象身份（`schemaVersion` 与必需数组），不重复 ID 与引用校验。

## SourceRef

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `path` | string | 相对 BDMV 根的 POSIX 路径，备份文件保留真实 `BACKUP/` 路径 |
| `origin` | `"primary" \| "backup"` | 整文件来源，不混用主备字段 |
| `byteOffset` | Time90k | 从文件起点 0 计的文件字节偏移 |
| `entityId` / `packetOffset` / `pid` / `instructionIndex` | 可选 | 可定位到对象、TS 包、PID、指令记录 |

偏移语义：CLPI/MPLS 的 45 kHz 时间不写入 `byteOffset`；`byteOffset` 只表示文件位置，时间字段一律保留原始单位并单独归一化。

## 时间：Time90k

| 规则 | 实现 |
| --- | --- |
| 持久化格式 | 规范十进制字符串，正则 `^(0|[1-9][0-9]*)$` |
| 计算 | `bigint`，不经 `number` |
| 45 kHz → 90 kHz | `from45k(value)` = `BigInt(value) * 2n` |
| 溢出/非法 | `INVALID_TIME90K`；负数、小数、指数、前导零都拒绝 |
| 90 kHz → 秒 | 只在展示层做，按微秒精度取最多 6 位小数、截断后去尾零（`format90kSeconds`） |

时间差可以是有符号整数，但它不是合法绝对 Time90k；需要差值时用 `bigint` 在局部计算。

## PlayerProfile

```ts
interface PlayerProfile {
  menuLanguage: string;      // 3 个 ASCII 字母 → PSR18
  audioLanguage: string;     // → PSR16
  subtitleLanguage: string;  // → PSR17
  country: string;           // 2 个 ASCII 字母 → PSR19
  region: "A" | "B" | "C";   // → PSR20，编码 1 / 2 / 4
  outputProfile: "portable";
  videoProfiles: string[];
  audioProfiles: string[];
}
```

默认值：`eng` / `eng` / `eng` / `US` / `A` / `portable`，能力列表为空（`DEFAULT_PLAYER_PROFILE`）。

- CLI 校验走 `profileWord`（大写国家码、小写语言码），非法值报 `CLI_INVALID_PROFILE`。
- `outputProfile` 只是产物标签，没有 PSR 映射；PSR21 用独立的 `outputPreference`。
- `videoProfiles`/`audioProfiles` 当前不推导能力位；需要覆盖能力时用 `PlayerProfile.capabilityValues`（只接受 PSR15、23–31、48–61）。
- 同一 profile 必须同时进入转换期 VM 和包内 VM（`runtime/disc-data.js` 的 `profile` 字段），否则 PSR 相关按钮行为在浏览器里不一致。

## Limits

`packages/core/src/limits.ts`。

| 字段 | 默认 | 消费者 |
| --- | ---: | --- |
| `maxReadWindowBytes` | 8 MiB | `readRegisteredFile`、`readFileChunks` 的单个窗口 |
| `maxSegmentBytes` | 16 MiB | 元数据文件解码前的单次读取上限 |
| `maxReassemblyBytes` | 64 MiB | IGS 重组聚合 |
| `maxObjectPixels` | 16,777,216 | ODS 尺寸检查（分配前） |
| `maxInstructionsPerTurn` | 10,000 | VM 单轮指令预算 |
| `maxQueueDepth` | 1,024 | VM 待处理事件/动作队列 |
| `maxCallDepth` | 128 | 当前是 CALL 开关：`< 1` 拒绝 `CALL_OBJECT`/`CALL_TITLE`，正数不限制嵌套深度 |
| `maxExplorationStates` | 100,000 | 导航图/媒体闭包探索上限 |
| `maxOutputBytes` | `null` | 媒体与包总大小上限，`null` 表示不限 |

`validateLimits(value)` 拒绝未知键（`INVALID_LIMIT`）；`maxCallDepth`/`maxQueueDepth` 允许 0，其余必须为正安全整数。分配前用 `allocateBoundedBytes` / `checkedObjectPixels` / `assertWithinLimit`；超限报 `LIMIT_EXCEEDED`，非法长度报 `INVALID_LENGTH`。

`convert --limits FILE` 把整个 `Limits` 对象传给转换期 VM 并嵌入包内 `disc-data.js` 的 `limits` 字段；包内 VM 只消费其中的 VM 相关三项。其它字段会被校验并保留在配置里，但不传给解析、IGS 提取与媒体导出。

## 诊断对象

不同阶段有各自的诊断类型，字段不完全相同。读取时按来源判断，不要假设统一 schema。

| 类型 | 位置 | 字段 |
| --- | --- | --- |
| `ParseDiagnostic` | `packages/bdmv-parser/src/model.ts` | `severity: info\|warning\|error\|fatal`、`code`、`message`、`sourcePath`、`offset`、`entityId`、`action`、`recoverable`、`stage: "structural"`、`affectedEntryIds` |
| `IgsDiagnostic` | `packages/igs/src/types.ts` | `severity: info\|warning\|error`、`code`、`message`、`source: IgsSource \| null`、`affectedSceneIds`、`details` |
| `VmDiagnostic` | `packages/hdmv/src/vm.ts` | `code`、`message`、`source: SourceLocation \| null` |
| `Diagnostic`（DiscIR） | `packages/core` | 含 `severity`/`code`/`message`/`sourcePath`/`offset`/`entityId`/`action`/`recoverable`/`stage`/`affectedEntryIds` |
| `DeliveryDiagnostic` | `packages/test-runner/src/decisions.ts` | `severity`、`code?`、`acknowledged?`、`blocksComplete?`、`message?`、`acknowledgement?` |

`acknowledgeDiagnostic` 只加标注，不提升状态；`classifyDiagnostics` 把 `error`/`fatal` 归为 blocking，`fatal` 单独标记。

## 事件信封

```ts
interface ActionEnvelope<T> { sessionId: string; generation: number; actionId: string; action: T }
interface EventEnvelope<T> { sessionId: string; generation: number; sequence: number; responseTo?: string; event: T }
```

规则：

- 动作在**发布前**分配新的 `generation`；VM 的等待记录与该动作使用同一代次，媒体桥不得自行递增。
- 回信必须同时匹配 `generation` 与 `responseTo`；旧代次、重复回信丢弃并写 trace。
- 等待条件按动作类型显式声明（`ended`、`seeked`、`started`、`still-completed`），不统一等 `ended`。

## 改契约的流程

1. 改 `packages/core/schema/disc-ir.schema.json`。
2. `corepack pnpm generate:contracts` 重新生成 `src/disc-ir.generated.ts`（幂等，产物应逐字节一致）。
3. `corepack pnpm build`，再改所有消费者：`createMenuDiscIR`（CLI）、`package-builder` 的 `parseDiscIR`、`runtime-web` 的 `validateEmbeddedDiscIR`。
4. 同步 `packages/core/src/contracts.test.ts` 与 `openspec/specs/disc-contracts/spec.md`。

版本规则：不兼容字段或语义变更升 `schemaVersion` 主版本，并在运行包装载处显式列出可接受版本；可选扩展也要更新 schema 与消费者测试。未知版本必须拒绝启动并给出可定位错误，不能猜兼容。

## 不要做的事

- 不在 `packages/core` 引入 Node 内建（浏览器产物会被构建脚本拒绝）。
- 不给包校验加 SHA-256 / 内容指纹 / 文件大小指纹；路径存在性与长度记录即可。
- 不把 `buttonId` 等局部 ID 当全碟唯一键；跨页/跨 clip 的全局 ID 必须带父作用域。
