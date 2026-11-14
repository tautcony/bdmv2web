# Proposal

## Why

`render` 与 `export --decode png` 一直是两套实现，同一份图形资源给出两个结果：

- 命名与清单形态不同：`render` 给 `igs-png` 记 `width`/`height`/`objectId`/`paletteId`，`export` 只记路径与大小；同一张盘的 `assets-manifest.json` 因此有两种形状。
- 能力不一致：独立 `.m2ts`/`.rsks` 只有 `export` 能吃，`render` 会把它当 BDMV 目录；`render` 的 `--m2ts` 在文档里写着「仅 BDMV」，实际被静默忽略。
- 长程任务没有反馈：`render` 逐帧同步 deflate、没有进度行，而 `export` 已经走线程池并发 + `build` 同款进度条。
- `--decode <format>` 是带值选项，却只有一个合法值 `png`；用取值表达布尔意图，多一层 `CLI_INVALID_DECODE` 失败路径。

## What Changes

- **`--decode png` 改名为 `--render`**（布尔开关）。旧写法不再被接受：`--decode` 现在报 `CLI_UNKNOWN_OPTION`，`CLI_INVALID_DECODE` 从错误码表移除。
- **单一管线**：新增 `apps/cli/src/shared/asset-export.ts`，BDMV 与流两条流程参数化为 `ExportRun { command, containers, selectionCode }`。`export` 是 `containers: true`，`render` 是 `containers: false`，差别只剩「是否写 `.mnu`/`.sup`」。
- **`render` 与 `export --render` 产物一致**：同一输入下 PNG 字节、包内路径、清单记录、记录顺序完全相同；`render` 的清单等于 `export --render` 清单中 `igs-png`/`sup-png` 的顺序子集。
- **`render` 接受流文件**：`.m2ts`/`.rsks` 与 `export` 用同一个分类器（`classifyStreamInput`）与同一套 PMT 发现；无效流仍是 `EXPORT_INVALID_STREAM`，选择错误报 `CLI_RENDER_SELECTION`。
- **`render` 补进度**：`--progress`/`--no-progress`，步骤名与行格式取自共享词表 `shared/steps.ts`，与 `export`、`build` 一致。
- **`render --m2ts` 真正生效**：BDMV 输入按 clip 过滤，与 `export` 同一套 `selectedClip`/`selectedPid`。
- **`igs-png` 清单记录统一**：两个命令都写元素身份（`width`、`height`、`objectId`、`objectVersion`、`paletteId`、`paletteVersion`），由 `assets.ts` 的 `igsElementRecord` 生成。对 `export` 是追加字段。
- **修一个并发缺陷**：`writeDisplaySetPngs` 原先用 `Set` 记录已建目录，第二个编码可能在第一个 `mkdir` 完成前就写文件（`ENOENT`）。改为共享同一个 `mkdir` promise。该缺陷此前被 `export` 的 `.sup` 先建目录掩盖，`render` 不写容器后立即暴露。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `asset-export`: PNG 输出开关改名 `--render`；`render` 与 `export --render` 共用一条管线并保证产物一致；`render` 增加流文件输入与进度报告。

## Impact

`apps/cli`：`commands/export.ts`（薄分发）、`commands/render.ts`（重写）、`shared/asset-export.ts`（新）、`shared/steps.ts`（新）、`shared/pgs.ts`、`shared/stream-input.ts`、`cli/assets.ts`、`cli/program.ts`；测试 `tests/integration/render-parity.test.ts`（新）与既有用例。文档同步 `docs/llm-wiki/features/cli-commands.md`、`docs/llm-wiki/packages/cli.md`、`docs/llm-wiki/diagnostics.md`、`docs/llm-wiki/packages/media-export.md`、`docs/llm-wiki/features/media.md`、`docs/guides/development.md`、`README.md`、`README.zh-CN.md`、`apps/cli/README.md`。不改变 PNG 字节、`assets-manifest.json` schema、package-builder 与 runtime 行为；`render` 的独立 `.mnu`/`.sup` 命名保持不变。
