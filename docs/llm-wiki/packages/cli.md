# apps/cli

命令编排层：解析参数、按顺序调用各包、控制事务与退出码。业务逻辑不在这里。

## 结构

| 位置 | 内容 |
| --- | --- |
| `src/index.ts` 顶部 | `commandOptions` 参数契约、`validateCommandLine`、`lookupOption`/`optionValue`、`strictDefault`、`inputPath`、`fail` |
| `loadPlayerProfile` / `loadLimits` | 在解析输入前校验 `--player-profile` / `--limits` |
| `inspect`、`extract`、`listAssets`、`exportAssets`、`convert`、`validate` | 六个已实现命令 |
| `main` | 分派；`compare` 未实现，返回 `E_NOT_IMPLEMENTED` |
| `main().catch` | 统一错误出口：`ContractError.code` 或 `E_IO`，按 `--format json` 决定 stderr 格式 |

## 参数契约

每个命令声明自己接受的 flag 与带值选项：

```ts
inspect:       flags: --strict --no-strict --allow-partial    values: --out --format
extract:       flags: --strict --no-strict --all              values: --out --format --type
convert:       flags: --strict --no-strict --overwrite        values: --out --player-profile --limits --title --format
validate:      flags: --strict --no-strict --offline          values: --format
compare:       flags: --strict --no-strict                    values: --format
list-assets:   flags: 无                                      values: --type --format --out --m2ts --pid --decode
export-assets: flags: 无                                      values: --type --out --format --m2ts --pid --decode
```

`validateCommandLine` 在任何命令执行前运行：

| 情况 | 码 |
| --- | --- |
| 未知选项（`--stric`、`--ou`、`convert --mode`） | `CLI_UNKNOWN_OPTION` |
| 多于一个位置参数 | `CLI_USAGE` |
| 带值选项后没有值（`inspect X --out`） | `CLI_MISSING_VALUE` |
| `--flag=` 空值 | 等同于裸 flag；需要值的选项报 `CLI_MISSING_VALUE` |

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
6. 不写 PNG、不写 SUP 文件；需要媒体文件用 `export-assets`。

### `list-assets`

- `--type all|igs|sup`，`--m2ts CLIP_ID`、`--pid PID`、`--decode png` 过滤/解码。
- 输出 M2TS clip、PID、IGS 图像对象属性、可达 SUP 轨道；`--out` 写完整 JSON。
- 非法值：`CLI_INVALID_ASSET_TYPE`、`CLI_INVALID_M2TS`、`CLI_INVALID_PID`、`CLI_INVALID_DECODE`。

### `export-assets`

- 写 igstools 兼容 `.mnu`（`assets/igs/<clip>-pid-<pid>.mnu`）与 `.sup`（`assets/subtitles/<clip>-pid-<pid>.sup`）。
- `--decode png` 额外写 IGS 元素与 PGS 显示集 PNG。
- 附 `assets-manifest.json`（类型、格式、路径、大小、字幕元数据）。

### `convert`

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

`src/index.test.ts`（39 例）：参数契约、profile 校验、limits 传播、事务与不落盘、stage/delivery 分离、`validate` 不写 manifest、`--format` 校验先于 IO、stderr 逐步进度。`src/bdmvkit-loop.test.ts`（1 例）覆盖 bdmvkit 夹具的循环导航。

## 改动入口

| 需求 | 位置 | 同步 |
| --- | --- | --- |
| 新增选项 | `commandOptions` + 对应命令的 `optionValue` 读取 | [features/cli-commands.md](../features/cli-commands.md)、`README.md` 命令表 |
| 新增命令 | `supported`、`commandOptions`、`main` 分派、实现函数 | `README.md`、`docs/guides/development.md` 的 CLI 状态表 |
| 改退出码 | `decideStageOutcome` / `decideDelivery` 的消费点 | `openspec/specs/cli-delivery-status/spec.md` |
| 改落盘文件 | 对应命令的写文件段 | [packages/package-builder.md](package-builder.md)、[features/verification.md](../features/verification.md) |

参数错误必须在解析输入、创建事务、读写报告之前失败；这条顺序是现有测试的断言点。
