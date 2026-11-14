# `@bdmv2web/bdmv-parser`

把 BDMV 元数据文件解析成 `ParsedDisc`：入口、MovieObject、播放列表、Clip、sound、引用图、诊断。不解析 M2TS 负载，不执行命令。

## 文件

| 文件 | 内容 |
| --- | --- |
| `src/parsing/parser.ts` | 五个格式解析器、主备选择、版本门、`parseBdmv` 编排 |
| `src/parsing/source-location.ts` | `SourceLocation` 相对 BDMV 根的路径与偏移 |
| `src/model.ts` | `ParsedDisc` 及所有结构类型 |
| `src/graph/graph.ts` | `traverseGraph`：按引用边遍历，带节点预算 |
| `src/graph/graph-builder.ts` | 从解析结果装配引用图 |
| `src/index.ts` | 导出 `discoverBdmvRoot`、`parseBdmv`、`parseBdmvWithInputTable`、`traverseGraph` 与类型 |

## 公开接口

```ts
parseBdmv(inputPath: string, options?: { limits?: Limits }): Promise<ParsedDisc>
discoverBdmvRoot(inputPath: string): Promise<string>
traverseGraph(graph, roots: readonly string[], maxNodes?: number): GraphTraversal
```

`ParsedDisc` 关键字段：

| 字段 | 说明 |
| --- | --- |
| `analysisStage` | 固定 `"structural"` |
| `root` | 规范化的 BDMV 根 |
| `discInfo.appInfo` / `discInfo.uhd` | 可选；解析失败为 `null` + `warning` |
| `entries` | `id` 形如 `firstPlay:0`、`topMenu:0`、`title:N`；`kind` 与 `target` |
| `movieObjects` | `id`、`resumeIntention`、`menuCallMask`、`titleSearchMask`、`instructions[]`（`words` 三字 + `bytes` 24 hex + `source`） |
| `playlists` | `playItems`、`marks`、`subPaths`、`appInfo` |
| `clips` | `header`、`sequence`（ATC/STC）、`programs`、`cpi` |
| `sounds` | 通道/采样率/位深编码 + 采样字节区间 |
| `graph` | `nodes`（`entry/title/movieObject/playlist/playItem/subPath/clip/clipInfo/stream/sound/bdjo`，`state: present\|missing`）+ `edges`（`resolution: resolved\|missing\|unresolved`） |
| `declarations` | 各类计数；`unknown` 统计诊断码含 `UNSUPPORTED`/`UNKNOWN` 的条数 |
| `diagnostics` | `ParseDiagnostic[]` |
| `supportPrediction` | 固定 `{ status: "partial", supported: [], unsupported: [...], unverified: [...] }` |

## 解析流程（`parseBdmv`）

1. `discoverBdmvInput` 得到 `root` + 全量文件表。
2. 只读取元数据文件：`index.bdmv`、`MovieObject.bdmv`、`PLAYLIST/*.mpls`、`CLIPINF/*.clpi`、`AUXDATA/sound.bdmv`。STREAM 只登记不加载。
3. `index.bdmv` 用 `critical: true`：失败或版本不支持 → `fatal BDMV_REQUIRED_FILE_MISSING` / `BDMV_UNSUPPORTED_VERSION`。
4. `MovieObject.bdmv` 缺失或损坏 → `error BDMV_REQUIRED_FILE_MISSING`（非 fatal；`inspect` 仍输出结构）。
5. 逐个 MPLS / CLPI 解析，单文件失败只产生 `error` 诊断，其余继续。
6. `sound.bdmv` 可选：缺失 → `info BDMV_OPTIONAL_SOUND_MISSING`，读取时只读前 `min(maxReadWindowBytes, maxSegmentBytes)` 字节。
7. `buildGraph` 汇总节点与边；CLI/`media-export` 用 `traverseGraph` 从入口出发找可达集。
8. BD-J 入口保留并记录 `warning BDMV_BDJ_UNSUPPORTED`；该 parser 诊断表示结构解析阶段不执行 Java。`build` 收集 BDJO 描述符和应用文件，`serve` 通过本地 Java host 执行 Xlet，详情见[BD-J 本地 Java 运行支持](../../support/bdj-support.md)。

## 主备选择（`choose`）

| 情况 | 结果 |
| --- | --- |
| 主文件可解析 | 用主文件；与备份字节不同 → `info BDMV_BACKUP_DIFFERS` |
| 主文件缺失/损坏，备份有效 | 整文件用备份 → `warning BDMV_BACKUP_FALLBACK`，`source.origin = "backup"`，`path` 保留 `BACKUP/` |
| 主文件版本未知（critical） | 直接抛 `BDMV_UNSUPPORTED_VERSION`，**不**用旧备份兜底 |
| 主备均不可用且 critical | `fatal BDMV_REQUIRED_FILE_MISSING` |

不混用主备字段：一个文件整体来自一侧。跨文件引用仍各自独立校验。

## 版本门

`index.bdmv` / `MovieObject.bdmv` / `MPLS` / `CLPI` / `sound.bdmv` 只接受 `0100`、`0200`、`0240`、`0300`。`0240`（3D/MVC profile）在所有文件上共用同一门禁。其它版本报 `BDMV_UNSUPPORTED_VERSION`。

## 容错规则

- 只有主 index section（入口表）是 critical。
- AppInfo、3.1 UHD 扩展、CLPI 的可选 section 用独立 `Bits` 游标解析：失败 → `warning`，返回 `null`，导航继续。
- 声明长度只作一致性提示，边界以文件长度为准；不自洽 → `warning BDMV_DECLARED_LENGTH_MISMATCH`。
- 真正越界（计数、偏移、section 越过文件）→ `BDMV_INVALID_COUNT` / `BDMV_INVALID_SECTION`，有界失败。
- 未知 opcode 不在容器层丢弃，原始三字与偏移原样交给 `hdmv`。

## 诊断码

| 码 | 严重性 | 含义 |
| --- | --- | --- |
| `BDMV_REQUIRED_FILE_MISSING` | fatal/error | `index.bdmv` 缺失（fatal）；`MovieObject.bdmv` 缺失（error） |
| `BDMV_UNSUPPORTED_VERSION` | error | 版本不在门禁列表；critical 文件直接失败 |
| `BDMV_ROOT_AMBIGUOUS` / `BDMV_ROOT_NOT_FOUND` | error | 目录发现歧义/失败 |
| `BDMV_BACKUP_FALLBACK` / `BDMV_BACKUP_DIFFERS` | warning/info | 主备选择结果 |
| `BDMV_DECLARED_LENGTH_MISMATCH` | warning | 声明长度与文件边界不符，已按文件继续 |
| `BDMV_INVALID_SECTION` / `BDMV_INVALID_COUNT` / `BDMV_INVALID_RECORD` | error | 真实结构越界 |
| `BDMV_INVALID_MAGIC` / `BDMV_INVALID_TIME_RANGE` / `BDMV_INVALID_REFERENCE` | error | 文件头、时间区间、引用非法 |
| `BDMV_MISSING_STREAM` / `BDMV_MISSING_CLPI` / `BDMV_MISSING_BDJO` | error | 引用目标缺失 |
| `BDMV_STN_CLPI_PID_CONFLICT` / `BDMV_STN_CLPI_CODING_CONFLICT` | warning | STN 与 CLPI 声明冲突，双方保留 |
| `BDMV_BDJ_UNSUPPORTED` | warning | 结构解析保留 BD-J 入口；Java 执行由 `bdmv2web serve` 的本地 Java 服务负责 |
| `BDMV_OPTIONAL_SOUND_MISSING` | info | 没有 `sound.bdmv` |
| `BDMV_UNKNOWN_OBJECT_TYPE` | warning | 入口对象类型未知 |

## 引用图

- 节点 ID 形如 `playlist:00001`、`playItem:00001:0`、`clip:00005`、`stream:00005:0x1100`、`movieObject:1`。
- 边 `kind`：`entry`、`command`、`playItem`、`subPath`、`clipInfo`、`stream`、`sound` 等；`resolution` 表示是否已解析。
- `traverseGraph` 用显式栈，`maxNodes` 默认 10,000；超预算时 `complete: false`，`frontier` 只列未探索节点（已去重），不把未走路径判为不可达。

## 测试

| 文件 | 覆盖 |
| --- | --- |
| `src/parsing/parser.test.ts` | 五种格式的正例、版本门、主备回退/冲突、截断与计数越界、可选 UHD 元数据损坏、HEVC `0x24` 属性、Mark 越界、STN/CLPI PID 冲突、真实样本（工作区本地）断言 |

跨包一站式覆盖见 `apps/cli/tests/integration/synthetic-all-features.test.ts`（`test-data/fixtures/synthetic-all-features/`）。

夹具字节来源：`packages/test-fixtures/src/bdmv.ts`（项目自写字节构造器，不是独立协议证据）。

## 改动入口

| 需求 | 位置 |
| --- | --- |
| 解析新字段 | 对应 `parseIndex/parseMobj/parseMpls/parseClpi/parseSound`，同时改 `model.ts` 与下游消费者 |
| 新增诊断 | `diagnose(...)`，同步 [diagnostics.md](../diagnostics.md) |
| 新增引用边 | `buildGraph` |
| 放宽/收紧容错 | `optionalSection` 与 `choose` 的 `critical` 参数 |

改解析行为前先看 `docs/support/protocol-support.md`：每行的证据等级（`implementation-reference` / `project-test` / `unverified`）决定这次改动需要补什么证据，不能只加测试就宣称字段已核验。
