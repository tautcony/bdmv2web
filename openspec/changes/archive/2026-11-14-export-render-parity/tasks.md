# Tasks

## 1. 共享管线

- [x] 1.1 `apps/cli/src/shared/asset-export.ts`：BDMV 与流两条流程从 `commands/export.ts` 迁出，参数化为 `ExportRun { command, containers, selectionCode }`。
- [x] 1.2 `apps/cli/src/shared/steps.ts`：`BDMV_STEPS` / `STREAM_STEPS` / `FILE_STEPS` 词表，两个命令共用。
- [x] 1.3 `apps/cli/src/shared/pgs.ts`：`pgsTrackPngPlan`（统一 `sup-png` 记录形状）、`trackProgress`、`runDecodeStep`、`DecodeTarget`。
- [x] 1.4 `apps/cli/src/cli/assets.ts`：`igsElementRecord` 统一 `igs-png` 记录；`AssetSelection` 与 `renderPng` 字段。
- [x] 1.5 `apps/cli/src/commands/export.ts`：只剩输入分类与 `EXPORT_RUN` 分发。
- [x] 1.6 `apps/cli/src/shared/stream-input.ts`：`classifyExportInput` → `classifyStreamInput`，`StreamTarget` 外置给两个命令复用。

## 2. render 复用管线

- [x] 2.1 `apps/cli/src/commands/render.ts`：BDMV 与流输入直接调用 `exportBdmvAssets` / `exportStreamAssets`（`RENDER_RUN.containers = false`）。
- [x] 2.2 独立 `.mnu`/`.sup` 保留为 `render` 独有入口，SUP 改走 `parsePgsSup` + `writeDisplaySetPngs`（异步并发、`FILE_STEPS` 三步进度），命名不变。
- [x] 2.3 `--m2ts` 在 BDMV 输入上真正参与过滤（此前被静默忽略）。
- [x] 2.4 `apps/cli/src/cli/program.ts`：`render` 增加 `--progress` / `--no-progress`，输入描述补流文件。

## 3. `--render` 改名

- [x] 3.1 `program.ts`：`--decode <format>` → `--render`（布尔）。
- [x] 3.2 `assets.ts`：`assetSelection()` 用 `flagEnabled("--render")`；删除 `CLI_INVALID_DECODE`。
- [x] 3.3 测试与文档内所有 `--decode png` 引用改写；`list` 的未知选项用例改测 `--render`。

## 4. 并发目录创建缺陷

- [x] 4.1 `writeDisplaySetPngs` 按目录缓存 `mkdir` promise，避免第二个编码抢在第一个 `mkdir` 之前写文件。

## 5. 验证

- [x] 5.1 新增 `apps/cli/tests/integration/render-parity.test.ts`（6 例）：流文件（PGS 与 IGS 各一）、BDMV 的清单+PNG 逐字节一致、`render` 不写容器、`--m2ts` 过滤、进度步骤与 stdout 契约、无效流/选择错误码。
- [x] 5.2 `apps/cli` 全量：23 文件 / 156 用例通过。
- [x] 5.3 真实数据（`test-data/fixtures/sup/Hyouka_01/00000.SumiSora.sc.rsks`，55 MB）：`export --render` → 800 资产（1 `.sup` + 799 PNG），`render` → 799 资产；两者清单的 `sup-png` 子集逐字段相等，799 张 PNG 逐字节相同，`render` 输出无 `.sup`。
- [x] 5.4 改名等价性：`export --render` 的产物与改动前 `--decode png` 的产物 `diff -r` 无输出（流）；BDMV 夹具除清单外逐字节相同（`igs-png` 追加元素身份字段）。
- [x] 5.5 伪终端进度：`bdmv2web render · 4 steps` + `Probe stream tables` / `Extract graphics streams` / `Decode display sets`（带 `[███]` 与 `n/216 display sets`）/ `Write manifest and commit` + `Done in …`，与 `export` 逐行同构。
- [x] 5.6 `pnpm --filter bdmv2web typecheck` 与改动文件 eslint 干净。

## 证据（实际运行，2026-11-14）

环境：macOS，Node 24.18.0，`npx tsx --tsconfig apps/cli/tsconfig.dev.json apps/cli/src/index.ts`。

| 场景 | 结果 |
| --- | --- |
| `export 00000.SumiSora.sc.rsks --out A --render` | `{"stageStatus":"partial","assetCount":800}`，8.3 s 墙钟（含 2 s tsx 启动） |
| `render 00000.SumiSora.sc.rsks --out B` | `{"stageStatus":"partial","assetCount":799}`，8.6 s 墙钟 |
| A/B 清单对比 | `B == A.filter(type == sup-png)`，逐字段相等 |
| A/B PNG 对比 | 799 张，`filecmp` 差异 0 |
| `diff -r <改动前 --decode png 输出> A` | 无输出 |
| BDMV 夹具 `--type all --render` | 15 资产；除清单外与改动前 `diff -r` 无输出；`igs-png` 记录新增 6 个元素字段 |
| `render --sup <55 MB sup> --language jpn` | 3 步进度、`1/1199 … 1080/1199 display sets` 10% 逐行进阶，产物仍为 `<stem>-display-00001.png` |
| IGS 流 `--type igs` | `export --render` 输出 `[igs, igs-png]`，`render` 输出同一 `igs-png` 记录，PNG 字节相同 |

## 文档

- [x] `docs/llm-wiki/features/cli-commands.md`：`export` 选项表、进度段、产物段、流模式段、`render` 段落、错误码表、小抄。
- [x] `docs/llm-wiki/packages/cli.md`：命令选项清单、`export`/`render` 小节、模块职责。
- [x] `docs/llm-wiki/diagnostics.md`：删除 `CLI_INVALID_DECODE`。
- [x] `docs/llm-wiki/packages/media-export.md`、`docs/llm-wiki/features/media.md`：参数名与输入类型。
- [x] `docs/guides/development.md`：`export`/`render` 用法行。
- [x] `README.md`、`README.zh-CN.md`、`apps/cli/README.md`：参数与输入说明。
