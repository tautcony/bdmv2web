# apps/cli

命令编排层：解析参数、按顺序调用各包、控制事务与退出码。业务逻辑不在这里。

## 目录结构

```text
src/
  index.ts              入口：main、CommanderError → 契约码、统一 catch
  progress.ts           stderr 进度渲染
  cli/
    program.ts          commander 命令与选项声明、dispatch、COMMANDER_CODES
    context.ts          当前命令的解析结果：optionValue/flagEnabled/optionState/strictDefault/inputPath
    errors.ts           fail、outputFormat
    output.ts           printTable、writeJsonFile
    profile.ts          loadPlayerProfile、loadLimits
    stages.ts           stageFailure、firstBlockingCode、deliveryDiagnostics
    assets.ts           AssetRecord、--type/--m2ts/--pid/--decode 解析、资产路径命名
  commands/
    inspect.ts extract.ts list.ts export.ts render.ts build.ts validate.ts compare.ts
  shared/
    media.ts            buildMediaClosure、buildExternalTargets
    pgs.ts              reachablePgsReferences、extractReachablePgsTracks
```

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 只做入口：`main` 调 `buildProgram`，把 `CommanderError` 映射成契约码，最后统一输出错误。 |
| `cli/program.ts` | 一个命令一个 `program.command(...)`，含位置参数与选项；`dispatch` 把解析结果交给对应实现。 |
| `cli/context.ts` | `dispatch` 保存解析结果，命令体用 `optionValue("--out")` 等读取；`optionState` 用于 `--progress/--no-progress` 这种三态 flag。 |
| `commands/*` | 每个命令一个文件，只做“参数语义校验 → 调包 → 事务 → 输出”。 |
| `shared/*` | 跨命令复用的纯逻辑（媒体闭包、可达 PGS 轨道），不依赖解析上下文。 |

## 参数解析

解析、帮助与分派交给 `commander`；本包只声明契约，不手写扫描。每个命令一个 `program.command(<动词>)`，位置参数统一为可选 `[input]`：

```ts
inspect   [input]  --out --format --allow-partial --strict/--no-strict
extract   [input]  --out --type --all --format --strict/--no-strict
build     [input]  --out --title --player-profile --limits --overwrite --progress/--no-progress --strict/--no-strict
validate  [input]  --offline --format --strict/--no-strict
compare   [input]  --format --strict/--no-strict
list      [input]  --type --m2ts --pid --decode --out --format
export    [input]  --out --type --m2ts --pid --decode --format
render    [input]  --out --mnu --sup --language --type --m2ts --pid --format
```

`convert` 是 `build` 的别名。带值选项统一用 `nonEmpty` 解析器，`--out=` 这类空值在解析阶段失败。

`optionValue("--out")` 之类只读 `dispatch` 保存的解析结果（`--player-profile` 对应 `playerProfile`），不做字符串扫描。

| 情况 | 码 |
| --- | --- |
| 未知选项（`--stric`、`--ou`） | `CLI_UNKNOWN_OPTION`，`commander` 附拼写建议 |
| 多于一个位置参数 | `CLI_USAGE` |
| 带值选项后没有值（`inspect X --out`） | `CLI_MISSING_VALUE` |
| `--out=` 空值 | `CLI_INVALID_ARGUMENT` |
| 未知命令 | `CLI_USAGE`；`--help` 打印帮助后退出 0 |

`--strict`/`--no-strict` 只改变“可接受的 partial 是否被拒绝”，不改变诊断事实。默认非 strict。

## 命令实现要点

### `inspect`

1. `parseBdmv` → `decideStageOutcome`。
2. 失败且没有 `--allow-partial` → `stageFailure`，stdout 输出 `{ stageStatus: "failed", code, blockingDiagnostics }`，退出 1，不写文件。
3. 有 `--out`：先 `assertDisjointRoots`，再 `writeJsonFile`（临时文件 + `link` + `unlink`，目标已存在会失败）。
4. `--format json` 时把完整 JSON 写 stdout；否则打印摘要表。
5. `--allow-partial` 强制退出 0，报告里仍是 `stageStatus: "failed"`。

### `extract`

1. 必须有 `--out`，且 `--all` 与 `--type` 二选一（否则 `CLI_EXTRACT_SELECTION`；非法类型 `CLI_INVALID_EXTRACT_TYPE`）。
2. 先解析；有 `fatal` 直接失败，不扫描 STREAM。
3. `--type igs|sup` 时先 `extractIgsScenes(..., { renderAssets: false })`，再 `decideStageOutcome`；`failed` 不建事务。
4. `beginOutputTransaction` 后按类型写：
   - `hdmv/commands.json`（全部 12 字节命令 + 来源）、`hdmv/parsed-disc.json`；`--all` 另写 `hdmv/external-media-targets.json`。
   - `igs/scenes.json`、`igs/diagnostics.json`、`igs/source-map.json`。
   - `sup/tracks.json`（只记轨道索引与显示集数量，`.sup` 文件写完即删）。
5. `manifest.json` 记录 `stageStatus`、`selectedTypes`、文件清单、limitations。
6. 不写 PNG、不写 SUP 文件；需要媒体文件用 `export`。

### `list`

- `--type all|igs|sup`，`--m2ts CLIP_ID`、`--pid PID`、`--decode png` 过滤/解码。
- 输出 M2TS clip、PID、IGS 图像对象属性、可达 SUP 轨道；`--out` 写完整 JSON。
- 非法值：`CLI_INVALID_ASSET_TYPE`、`CLI_INVALID_M2TS`、`CLI_INVALID_PID`、`CLI_INVALID_DECODE`。

### `export`

- 写 igstools 兼容 `.mnu`（`assets/igs/<clip>-pid-<pid>.mnu`）与 `.sup`（`assets/subtitles/<clip>-pid-<pid>.sup`）。
- `--decode png` 额外写 IGS 元素与 PGS 显示集 PNG；全透明显示集不写文件、不写清单。
- 附 `assets-manifest.json`（类型、格式、路径、大小、字幕元数据）。`sup-png` 记录 `displaySet`、`startSeconds`、`endSeconds`、`width`、`height`；秒值以轨道起点为 0。

### `render`

- 输入为 BDMV、位置参数 `.mnu`/`.sup`，或 `--mnu`/`--sup`；后两种不需要 BDMV。
- BDMV 输入复用 `extractIgsScenes` 与可达 PGS 抽取；独立 SUP 直接 `parsePgsSup`；独立 MNU 使用 `parseIgsMnu`。
- 只写 PNG 与 `assets-manifest.json`，不写 `.mnu`/`.sup`。

### `build`

见 [features/offline-menu.md](../features/offline-menu.md)。参数处理顺序固定：`--limits` → `--player-profile` → 解析输入 → 计算输出。

### `validate`

1. 必须 `--offline`（否则 `CLI_OFFLINE_REQUIRED`）；`--format` 只接受 `json`（否则 `CLI_INVALID_FORMAT`，且在读写之前失败）。
2. `auditOutputPackage` → 读 `manifest.json` / 旧 `compatibility.json` → `createReleaseSummary`。
3. `manifest.status` 与当前判定不一致时，追加 `MANIFEST_STATUS_UNVERIFIED`（`not-verified`），**不改写** manifest。
4. 可写时依次写 `dependency-audit.json`、`compatibility.json`、`reports/release-summary.json`，三份都来自同一份 summary；任一写失败即产生 `RELEASE_REPORT_WRITE_FAILED` 检查项。
5. 退出码取 `releaseSummary.release.exitCode`。

## 错误出口

`main().catch` 把任何异常转成：

```json
{ "code": "CLI_MISSING_VALUE", "message": "...", "path": "/" }
```

`--format json` 时写 JSON 到 stderr，否则写 `CODE: message`。退出码 1。

`ContractError` 之外的异常统一 `E_IO`。

## 退出码

| 场景 | 码 |
| --- | --- |
| 成功，`complete` | 0 |
| `partial` 且非 strict | 0 |
| `partial` 且 `--strict` | 2 |
| `failed` / 参数错误 / `fatal` | 1 |

`inspect --allow-partial` 例外：始终 0。`compare` 始终 1。

## 测试

`src/index.test.ts`（31 例）：profile 校验、limits 传播、事务与不落盘、stage/delivery 分离、`validate` 不写 manifest、`--format` 校验先于 IO、stderr 逐步进度、资产与 PNG 导出。参数解析本身由 `commander` 覆盖，测试不再重复断言未知选项、缺值与多余位置参数。`src/synthetic-all-features.test.ts`（8 例）在 `test-data/fixtures/synthetic-all-features/` 上覆盖解析、HDMV 解码与 VM、IGS 多页与弹出菜单、双语言 PGS、循环点、按钮音效与一站式交接。

## 改动入口

| 需求 | 位置 | 同步 |
| --- | --- | --- |
| 新增选项 | `buildProgram` 里对应命令的 `.option(...)` + 实现中的 `optionValue` 读取 | [features/cli-commands.md](../features/cli-commands.md)、`README.md` 命令表 |
| 新增命令 | `buildProgram` 的 `.command(...)` + `dispatch` 的 handler | `README.md`、`docs/guides/development.md` 的 CLI 状态表 |
| 改退出码 | `decideStageOutcome` / `decideDelivery` 的消费点 | `openspec/specs/cli-delivery-status/spec.md` |
| 改落盘文件 | 对应命令的写文件段 | [packages/package-builder.md](package-builder.md)、[features/verification.md](../features/verification.md) |

参数错误必须在解析输入、创建事务、读写报告之前失败；这条顺序是现有测试的断言点。
