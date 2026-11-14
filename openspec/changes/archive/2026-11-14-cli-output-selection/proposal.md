# Proposal

## Why

`extract` 与 `export` 描述的是同一批图形流的两种产物，但两者各自实现了「选哪些资产 / 写哪些产物」的语义，且输入类型要靠用户声明：

- **`--type` 有两套取值域**：`extract` 是 `hdmv|igs|sup` 且必须与 `--all` 二选一（`apps/cli/src/commands/extract.ts` 旧实现），`export`/`list`/`render` 是 `all|igs|sup` 且默认 `all`。同一选项名，用户要记两套规则。
- **输入类型靠用户声明**：`render` 的位置参数只按扩展名区分 `.mnu`/`.sup`，`--mnu`/`--sup` 与位置参数同义且互斥，同一信息要说两遍；`export` 完全不接受 `.mnu`/`.sup`，给了会掉进 BDMV 解析路径并报与输入无关的错误。
- **`--type` 混用两种语义**：对 `export`/`render` 是「资产族过滤」，对 `render --mnu/--sup` 又成了「输入类型」，帮助文本只能用 "for BDMV and stream input" 这种补偿说明。
- **两套管线各写一遍**：`extract` 自己解析盘、自己写事务、自己写 manifest，`export` 另有一套；分析产物与资产产物落在同一目录布局下却互不知情。
- **文档缺口**：`README.md`/`README.zh-CN.md`/`apps/cli/README.md` 的命令表仍只写 `<BDMV>` 输入，新增的 `.m2ts`/`.rsks` 流输入没有体现。

## What Changes

- **`--type` 只选输出，不再表示输入**：取值 `all | metadata | hdmv | igs | sup`。`igs`/`sup` 写对应容器（配合 `--render` 还写其 PNG），`hdmv` 写命令表与来源映射，`metadata` 写整套结构元数据，`all` 写全部。省略 `--type` 时 `export` 写容器，保持历史默认。
- **`extract` 命令删除**：它是 `export` 的元数据形态，不需要独立命令名。`export --no-assets` 写整套元数据（原 `extract` 无参形态），`export --type igs --no-assets` / `--type sup --no-assets` 只写该段（原 `extract --type igs|sup`）。产物逐字节不变（已用 `diff -r` 验证，仅 limitations 文案随命令名调整）。
- **`export` 获得元数据输出**：新增 `shared/metadata.ts` 承载产物写出，`export --type metadata`、`--type hdmv`、`--type all` 与 `--no-assets` 共用同一条 `runGraphicsInput`。
- **输入类型自动判定**：`shared/stream-input.ts` 的 `classifyStreamInput` 升级为 `classifyInput`，先按内容（TS 同步字节 0x47 @0/4、IGS `ICS`/`PDS`/`ODS`、PGS `PG`），再退回扩展名；识别 `bdmv | stream | mnu | sup`。
- **删除 `render --mnu/--sup`**：位置参数已能判定，两个开关只重复同一信息。错配组合改报 `CLI_RENDER_SELECTION`。
- **`export` 拒绝独立容器输入**：`.mnu`/`.sup` 没有可导出的盘或流，报 `CLI_EXPORT_SELECTION` 并指向 `render`。
- **对流文件用 `--type hdmv` 被拒绝**：流内没有 HDMV 命令表，报 `CLI_EXPORT_SELECTION`。
- **`CLI_INVALID_EXTRACT_TYPE` 与 `CLI_EXTRACT_SELECTION` 退役**：类型值统一由 `CLI_INVALID_ASSET_TYPE` 校验；`extract` 不再是命令，`bdmv2web extract` 落到 `CLI_USAGE` 的未知命令。
- **文档补齐**：中英文 README 与 npm 包 README 的命令表补上流输入与 `.mnu`/`.sup` 输入；开发指南与 llm-wiki 记录 `--type` 的输出语义。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `asset-export`：输入判定、输出选择、元数据产物，以及 `extract` 并入 `export` 后的命令面。

## Impact

- `apps/cli/src/cli/{assets,program}.ts`、`apps/cli/src/shared/{asset-export,metadata,stream-input}.ts`、`apps/cli/src/commands/{export,render}.ts`；`commands/extract.ts` 删除。
- 命令面与错误码：`extract` 删除（破坏性），`CLI_INVALID_EXTRACT_TYPE`、`CLI_EXTRACT_SELECTION`、`--all`、`--mnu`/`--sup` 删除；`--analysis` 从未发布，本变更内分析产物落到 `--type metadata` 与 `--no-assets`。
- 测试：`src/shared/metadata.test.ts`（由 `commands/extract.test.ts` 移入并改导入）、`src/shared/stream-input.test.ts`、`tests/integration/{export-stream,cli-commands}.test.ts`。
- 文档：`README.md`、`README.zh-CN.md`、`apps/cli/README.md`、`docs/guides/development.md`、`docs/llm-wiki/{features/cli-commands,packages/cli,diagnostics}.md`。
