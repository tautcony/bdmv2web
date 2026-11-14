# Tasks

## 1. 输出选择

- [x] 1.1 `cli/assets.ts`：新增 `OutputType`、`OutputSelection`、`outputTypeOption`、`exportOutputs(type, assets)`、`pngOutputs`；`--type` 非法值统一报 `CLI_INVALID_ASSET_TYPE`。`--no-assets` 通过 `exportOutputs` 的第二参数表达，不再需要 `metadataOutputs`/`withoutAssets`。
- [x] 1.2 `shared/asset-export.ts`：`ExportRun` 改为 `GraphicsRun { command, selectionCode, outputs }`；两条管线改读 `outputs.metadata/containers/png`，SUP 轨道按 `needsSupTracks` 决定是否提取。
- [x] 1.3 `shared/asset-export.ts`：新增 `runGraphicsInput`，集中处理 `.mnu`/`.sup` 拒绝、流文件的 `--type hdmv` 拒绝、`metadata`/`hdmv` 配 `--render` 拒绝。

## 2. 元数据产物

- [x] 2.1 新增 `shared/metadata.ts`：`writeMetadataArtifacts` 写出 `hdmv/`、`igs/`、`sup/tracks.json` 与 `manifest.json`；`createHdmvSourceMap`、`createIgsSourceMap`、`mapIgsSource`、`mapIgsDiagnosticSource`、`serializeIgsScene`、`generatedFileRecord`、`safeDiagnosticMessage`、`referencedAssetIds` 迁入。
- [x] 2.2 删除 `commands/extract.ts` 与 `program.ts` 的注册：`extract` 由 `export --no-assets` 取代；`--all`、`CLI_EXTRACT_SELECTION`、`CLI_INVALID_EXTRACT_TYPE` 一并退役。
- [x] 2.3 `commands/export.ts`：`--type metadata` / `--type all` / `--no-assets` 生效，默认仍只写容器；`--no-assets` 配 `--render` 报 `CLI_EXPORT_SELECTION`。
- [x] 2.4 `commands/build.ts` 与 `commands/menu-planning.ts` 改从 `shared/metadata.ts` 导入被迁移的辅助函数。

## 3. 输入判定

- [x] 3.1 `shared/stream-input.ts`：`classifyStreamInput` → `classifyInput`，返回 `bdmv | stream | mnu | sup`，内容优先（IGS/PGS 段标签、偏移 0/4 的同步字节）、扩展名兜底。
- [x] 3.2 `commands/render.ts`：删除 `--mnu`/`--sup`，位置参数交给 `classifyInput`；按输入类型校验 `--type`/`--m2ts`/`--pid`/`--language`。
- [x] 3.3 `cli/program.ts`：`export` 的 `--type` 帮助改为 `all, metadata, hdmv, igs, or sup`，`--no-assets` 说明改为「不写容器与 PNG」；去掉 `extract` 命令、`render` 的 `--mnu`/`--sup`。

## 4. 覆盖

- [x] 4.1 `src/commands/extract.test.ts` → `src/shared/metadata.test.ts`（`git mv` + 仅改导入）。
- [x] 4.2 `src/shared/stream-input.test.ts`：覆盖 `.bin` 改名流、`.mnu`/`.sup` 段标签、内容优先于扩展名。
- [x] 4.3 `tests/integration/export-stream.test.ts`：覆盖 `.sup` 输入被 `export` 拒绝并指向 `render`、`--type metadata`（无 `assets-manifest.json`）、`--type all`（元数据 + 容器）、流文件的 `--type sup --no-assets`。
- [x] 4.4 `tests/integration/{cli-commands,source-cli-fixture}.test.ts`：`extract` 调用改为 `export --type … --no-assets`；`render --sup` 改为位置参数。

## 5. 文档

- [x] 5.1 `README.md`、`README.zh-CN.md`、`apps/cli/README.md`：命令表补 `<INPUT>` 定义、流输入、`.mnu`/`.sup` 输入、`--type metadata`，去掉 `--mnu`/`--sup`。
- [x] 5.2 `docs/guides/development.md`：删除 `extract` 行，重写 `export`/`render`（输出选择语义、输入判定、错误码），删除独立的 `--mnu`/`--sup` 行。
- [x] 5.3 `docs/llm-wiki/{features/cli-commands,packages/cli,diagnostics,troubleshooting,glossary,features/verification,features/igs-extraction,packages/{igs,test-runner}}.md`：删除 `extract` 章节与命令表行，同步模块职责、`--type` 语义与错误码。

## 6. 验证

- [x] 6.1 `apps/cli`：`npx tsc -p tsconfig.json --noEmit` 通过；`npx vitest run` 23 个文件、161 个测试通过。
- [x] 6.2 等价性：`export --no-assets` 与旧 `extract --all` 在同一合成盘上产物 `diff -r` 仅差 limitations 文案。
- [x] 6.3 手工核对（合成盘）：`export --no-assets` 写全部元数据段；`--type igs --no-assets` 只写 `igs/`；`--type metadata` 只写元数据；`--type all` 同时写容器与元数据；`--type hdmv` 只写 `hdmv/`；`extract` 报 `CLI_USAGE`；`--no-assets --render`、`--type metadata --render` 与 `.sup` 输入均按预期报错。
