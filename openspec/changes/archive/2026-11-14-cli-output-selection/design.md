# Design

## Context

图形相关的三条命令此前是两套实现：

- `commands/extract.ts` 自己解析盘、自己开事务、自己写 `manifest.json`，只产出 JSON。
- `shared/asset-export.ts` 的 `exportBdmvAssets`/`exportStreamAssets` 由 `export` 与 `render` 共用，`ExportRun.containers` 一个布尔区分两者。
- 输入判定只有 `classifyStreamInput`（扩展名 + `lstat`），`render` 额外按位置参数扩展名识别 `.mnu`/`.sup`，另有 `--mnu`/`--sup` 显式声明。

产物目录没有冲突：`extract` 写 `hdmv/`、`igs/`、`sup/tracks.json`、`manifest.json`，`export` 写 `assets/`、`assets-manifest.json`。这允许一次事务同时承载两侧。

## Goals / Non-Goals

- Goals：一个 `--type` 轴表达输出；`extract` 并入 `export`（命令本身删除）；输入类型由内容判定；`render` 去掉冗余的类型声明开关；文档与实现一致。
- Non-Goals：把 `render` 合并进 `export`（`render` 保留独立命令名与 `CLI_RENDER_SELECTION`）；改变已发布产物的文件名、清单形状或 PNG 字节；为 `list` 增加流输入；改动 `metadata` 产物的 JSON schema。

## Decisions

- **输出选择是三个独立集合**（`cli/assets.ts` 的 `OutputSelection`）：

  ```ts
  { metadata: { hdmv, igs, sup }, containers: { igs, sup }, png: { igs, sup } }
  ```

  单一 `--type` 无法同时表达「哪一族」和「哪种形态」，所以解析层把 `--type` 展开成这三组布尔，管线只读展开结果。`png` 仍受 `--render` 门控，`render` 命令固定传 `renderPng: true`。

- **`--type` 的展开规则只有一张表**（`exportOutputs`），`--no-assets` 决定资产侧开不开：

  | `--type` | 默认（资产侧开） | `--no-assets` |
  | --- | --- | --- |
  | 省略 | 容器（igs+sup） | 元数据（全段） |
  | `all` | 容器 + 元数据 | 元数据（全段） |
  | `metadata` | 元数据（全段） | 元数据（全段） |
  | `hdmv` | 仅 HDMV 元数据 | 仅 HDMV 元数据 |
  | `igs` / `sup` | 该族容器（+PNG） | 该段元数据 |

  `hdmv` 只有元数据形态（盘上没有「HDMV 资产」），所以它在两种形态下一致。命名容器族（或省略 `--type`）表示要资产；`--no-assets` 把资产侧归零，此时 `igs`/`sup` 转而指该段元数据——这两格正是原 `extract` 的行为，因此不再需要第二条命令。`--no-assets` 与 `--render` 冲突（没有可写的东西），报 `CLI_EXPORT_SELECTION`。

- **`extract` 不保留别名**：保留别名等于保留两条命令的文档面与错误码，而 `export --no-assets` 已经是完整的元数据形态；`--all` 也随之删除，`--type all` 是唯一的说法。已知代价是老脚本里的 `extract` 会变成 `CLI_USAGE`。

- **`all` 必须包含元数据**，否则名为 all 却不写全部产物；因此 `export` 的默认不再是 `all`，而是「容器」。这保持了 `export <disc> --out DIR` 的历史行为，同时让 `--type all` 名副其实。

- **元数据写出集中到 `shared/metadata.ts`**：`writeMetadataArtifacts` 接收 `stagingPath`、`sections`、`disc | null`、IGS 提取结果、SUP 轨道记录与 `sourceRoot`，一次写完 `hdmv/`、`igs/`、`sup/tracks.json` 与 `manifest.json`。`createHdmvSourceMap`/`createIgsSourceMap`/`mapIgsSource`/`serializeIgsScene`/`safeDiagnosticMessage`/`referencedAssetIds` 随之迁入（`build.ts` 与 `menu-planning.ts` 原本从 `commands/extract.ts` 导入它们）。原 `commands/extract.test.ts` 依规则移到 `src/shared/metadata.test.ts`，只改导入路径。

- **一次事务承载两类产物**：`exportBdmvAssets` 在同一个 `beginOutputTransaction` 内先写容器/PNG，再调 `writeMetadataArtifacts`。`assets-manifest.json` 只在存在资产侧时写出（`writesMnu || writesSup || files.length > 0`），`manifest.json` 只在存在元数据侧时写出，因此元数据形态、`render` 与 `export` 三者的产物集合互不污染，元数据形态的 stdout 也不带 `assetCount`。

- **SUP 轨道只在需要时提取**：`needsSupTracks = containers.sup || (renderPng && png.sup) || metadata.sup`。容器写入时轨道直接落在 staging；只渲染 PNG 或只写索引时落到临时目录，写完即删（与 `render` 既有做法一致），索引记录用 `lstat` 取字节数。

- **输入判定以内容为准**（`classifyInput`）：先读前 200 字节，依次判断 IGS 段标签（`ICS`/`PDS`/`ODS`）、PGS 段标签（`PG`）、传输流同步字节（偏移 0 或 4，且偏移 +188/+192 处再次命中），都无法判定时退回扩展名，仍无法判定则保持 BDMV 路径与既有错误。BDAV `.m2ts`/`.rsks` 的包以 4 字节 `TP_extra_header` 起头，同步字节在偏移 4，这是支持偏移 4 的原因。

- **`render` 只按输入类型校验选项**：`.mnu`/`.sup` 输入拒绝 `--type`、`--m2ts`；`.sup` 拒绝 `--pid`，`.mnu` 拒绝 `--language`；盘/流输入拒绝 `--language`。错误统一为 `CLI_RENDER_SELECTION`。`export` 收到 `.mnu`/`.sup` 时以 `CLI_EXPORT_SELECTION` 失败并指向 `render`。

- **错误码**：`CLI_INVALID_EXTRACT_TYPE` 与 `CLI_EXTRACT_SELECTION` 删除（类型值统一由 `CLI_INVALID_ASSET_TYPE` 校验，选择错误统一走 `CLI_EXPORT_SELECTION`）；`--analysis` 不作为长期选项存在，本变更直接把分析产物落到 `--type metadata` / `--no-assets`。

## Risks / Trade-offs

- 内容嗅探对极端文件可能误判（例如以 `PG` 开头的文本文件）。判定只在「已知图形段标签」上成立，且 `.txt` 之类文件既无标签也无传输同步字节，仍走 BDMV 路径；取舍是让改名文件可用，代价是这类构造文件会被当成容器格式。
- `export --type all` 现在会多写整套元数据。这是 `all` 的语义要求，属于对 `--type all` 使用者的行为变化，已在开发指南与 llm-wiki 中记录。
- `extract` 删除是破坏性变更：脚本需要改成 `export --no-assets`（整套元数据）或 `export --type igs|sup --no-assets`（单段）。报错是 `CLI_USAGE` 的未知命令，不带迁移提示。

## Migration Plan

单次交付。选项面删除 `--mnu`/`--sup`/`--all`，新增 `--type metadata` 与 `--no-assets`，删除 `extract` 命令。迁移映射：

| 旧 | 新 |
| --- | --- |
| `extract <in> --out DIR` / `extract --all` | `export <in> --out DIR --no-assets` |
| `extract <in> --type hdmv` | `export <in> --out DIR --type hdmv` |
| `extract <in> --type igs` / `sup` | `export <in> --out DIR --type igs --no-assets` |

`export` 不带 `--type` 的行为不变。

## Open Questions

None.
