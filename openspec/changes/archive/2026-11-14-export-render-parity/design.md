# Design

## 一条管线，两个入口

```
commands/export.ts ─┐                      ┌─ containers: true  → 写 .mnu/.sup + PNG
                    ├→ shared/asset-export.ts
commands/render.ts ─┘                      └─ containers: false → 只写 PNG
```

`shared/asset-export.ts` 提供两个入口，参数都带 `ExportRun`：

```ts
export interface ExportRun {
  command: string;        // 进度头 "bdmv2web <command>"
  containers: boolean;    // 是否写 .mnu/.sup
  selectionCode: string;  // 选择失败用哪个契约码
}
export async function exportBdmvAssets(input, out, type, selection, run): Promise<void>
export async function exportStreamAssets(target, out, type, selection, run): Promise<void>
```

`containers` 影响三处，且只有三处：

1. IGS 流是否 `captureStreams`（`render` 不需要保留 `.mnu` 原始字节）；
2. 是否把 `.mnu`/`.sup` 写进 staging 并追加对应清单记录；
3. SUP 轨道抽取到哪：`true` 用 `transaction.stagingPath`，`false` 用 `mkdtemp` 的临时目录，`finally` 删除。

PNG 的路径、内容、清单记录与 `containers` 无关——所以两者天然一致，不靠两处同步维护。

## 产物一致性契约

对同一输入，令 `E = export --render` 的 `assets-manifest.json`，`R = render` 的清单：

- `R.assets` 等于 `E.assets` 中 `type ∈ {igs-png, sup-png}` 的顺序子集（逐字段相等，不排序）；
- 每个记录的 `path` 在两个输出目录下都存在，且字节相同；
- `render` 输出不含 `assets/igs/`、`assets/subtitles/*.sup`；
- stdout 仍是单行 `{ stageStatus, output, assetCount }`，`stageStatus` 由同一份诊断判定。

以上四条由 `apps/cli/tests/integration/render-parity.test.ts` 直接断言（BDMV 与合成 `.rsks` 各一条）。

## 保持不统一的部分

独立 `.sup` 没有 PID，`assets/subtitles/<stem>-display-00001.png` 无从改成 `-pid-XXXX-<lang>-` 形态；独立 `.mnu` 沿用 IGS 元素命名。`export` 不接受这两类输入，因此不存在「同一输入两种产物」。文档里明确写出这条边界。

## 错误码映射

| 情形 | export | render |
| --- | --- | --- |
| 流文件配合 `--m2ts` | `CLI_EXPORT_SELECTION` | `CLI_RENDER_SELECTION` |
| `--pid` 未在 PMT 声明 | `CLI_EXPORT_SELECTION` | `CLI_RENDER_SELECTION` |
| 无 PAT/PMT、声明 PID 无完整显示集 | `EXPORT_INVALID_STREAM` | 同左（流输入校验是一条共享路径） |
| 独立 `.mnu`/`.sup` 解析失败 | 不适用 | `RENDER_INVALID_MNU` / `RENDER_INVALID_SUP` |

`selectionCode` 是 `ExportRun` 的字段，因此每个命令保留自己的选择码拼写，其余码共享。

## `--decode png` → `--render`

`--decode` 只有 `png` 一个合法值，失败路径（`CLI_INVALID_DECODE`）只可能由拼错触发。改成布尔开关后：选项表少一列取值、错误码表少一行、`assetSelection()` 从 `optionValue("--decode") === "png"` 变成 `flagEnabled("--render")`。硬改名不做别名：`--decode` 现在走 `CLI_UNKNOWN_OPTION`，与其它未知选项同一出口。

## 并发目录创建的缺陷

`writeDisplaySetPngs` 原先：

```ts
if (!createdDirectories.has(directory)) { createdDirectories.add(directory); await mkdir(directory, { recursive: true }); }
await writeFile(target, ...);
```

第二个编码看到集合里已有目录就直接写，而第一个 `mkdir` 还在飞——`ENOENT`。`export` 因为先写 `.sup` 到 `assets/subtitles/` 掩盖了它；`render` 的 `containers: false` 让 `assets/subtitles/` 只由 PNG 写入器创建，第二条编码立刻踩中。改成按目录缓存同一个 promise：

```ts
let created = directories.get(directory);
if (created === undefined) { created = mkdir(directory, { recursive: true }); directories.set(directory, created); }
await created;
```

## 进度

步骤词表移到 `shared/steps.ts`（`BDMV_STEPS` / `STREAM_STEPS` / `FILE_STEPS`），两个命令都从 `commandProgress` 构造 `ProgressReporter`，只声明自己的 `command` 与头部字段。比例步骤仍是「解码显示集」，分母是全部源的显示集总数，跨轨道/跨文件单调。
