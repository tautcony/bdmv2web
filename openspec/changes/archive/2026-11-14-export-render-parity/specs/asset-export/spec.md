# Spec Delta

## ADDED Requirements

### Requirement: PNG 输出开关

`export` SHALL 用布尔选项 `--render` 表示「同时写出 PNG」，SHALL NOT 再接受 `--decode`；传入 `--decode` 时的行为 SHALL 与其它未知选项一致（`CLI_UNKNOWN_OPTION`），且不存在因取值非法而产生的失败码。

#### Scenario: `--render` 写出 PNG
- **WHEN** `export` 以 `--render` 运行
- **THEN** 除 `.mnu`/`.sup` 外还写出 IGS 元素与 PGS 显示集 PNG，并在清单记录它们；`--png-level` 只影响这些文件

#### Scenario: 旧写法被拒绝
- **WHEN** 任意命令传入 `--decode png`
- **THEN** 以 `CLI_UNKNOWN_OPTION` 失败，不写任何产物

#### Scenario: 未启用时不写 PNG
- **WHEN** `export` 未传 `--render`
- **THEN** 不写 PNG，清单无 `igs-png`/`sup-png` 记录，「解码显示集」步骤标为跳过

### Requirement: render 与 export 的 PNG 产物一致

对同一输入，`render` SHALL 复用 `export --render` 的管线（同一 PMT/BDMV 发现、同一并发解码、同一命名、同一清单记录构造），仅 SHALL 省略 `.mnu`/`.sup` 容器。`render` 的 `assets-manifest.json` SHALL 等于 `export --render` 清单中 `igs-png`/`sup-png` 记录的顺序子集，且每条记录的 PNG 字节 SHALL 相同。

#### Scenario: 同一流文件
- **WHEN** 同一条 `.rsks`/`.m2ts` 文件分别用 `export --render` 与 `render` 导出到两个目录
- **THEN** 两者的 PNG 清单记录逐字段相等，PNG 逐字节相同，`render` 目录不含 `.sup`

#### Scenario: 同一 BDMV 盘
- **WHEN** 同一个 BDMV 分别用 `export --render --type all` 与 `render --type all` 导出
- **THEN** `render` 的清单等于 `export` 清单的 PNG 子集，`render` 目录不含 `assets/igs/`（`.mnu`）

#### Scenario: 选择范围一致
- **WHEN** `render` 以 BDMV 输入并传 `--m2ts`/`--pid`
- **THEN** 只输出所选 clip/PID 的 PNG，与 `export` 同名选项的选择结果一致

### Requirement: render 的流文件输入

`render` SHALL 接受单个 `.m2ts`/`.rsks` 常规文件，与 `export` 共用输入分类与 PMT 图形流发现。流输入下的失败语义 SHALL 为：无法作为 m2ts 解析或声明 PID 无完整显示集 → `EXPORT_INVALID_STREAM`；`--m2ts` 或未声明的 `--pid` → `CLI_RENDER_SELECTION`。

#### Scenario: 流文件渲染
- **WHEN** `render` 以 `.rsks` 文件运行
- **THEN** 按 PMT 声明的 PGS PID 渲染显示集 PNG，命名以文件 stem 代替 clipId

#### Scenario: 无效流不写产物
- **WHEN** `render` 的流输入不含 PAT/PMT
- **THEN** 以 `EXPORT_INVALID_STREAM` 失败，输出目录不产生事务产物

#### Scenario: 流文件拒绝 clip 选择
- **WHEN** `render` 的流输入配合 `--m2ts`
- **THEN** 以 `CLI_RENDER_SELECTION` 失败

### Requirement: render 进度报告

`render` SHALL 支持 `--progress` 与 `--no-progress`，SHALL 与 `export`、`build` 使用同一套步骤渲染与词表。BDMV 与流输入 SHALL 使用与 `export` 相同的步骤名与顺序；独立 `.mnu`/`.sup` 输入 SHALL 使用「读取图形资源 / 解码显示集 / 写清单并提交」三步。比例 SHALL 只在「解码显示集」上出现，分母为全部源的显示集总数。stdout SHALL 仍为单行 `{ stageStatus, output, assetCount }`。

#### Scenario: 管道下默认静默
- **WHEN** `render` 的 stderr 不是 TTY 且未指定 `--progress`
- **THEN** stderr 无输出，stdout 仍为单行 JSON

#### Scenario: 步骤与 export 同构
- **WHEN** `render` 以流文件运行并指定 `--progress`
- **THEN** 输出 `bdmv2web render` 头、四步（探测流表、提取图形流、解码显示集、写清单并提交）、比例行与 `Done in …` 汇总，格式与 `export` 相同

### Requirement: 清单记录形状统一

`igs-png` 记录 SHALL 由同一构造函数生成，SHALL 包含 `width`、`height`、`objectId`、`objectVersion`、`paletteId`、`paletteVersion`；`sup-png` 记录 SHALL 由同一构造函数生成，SHALL 包含 `displaySet`、`startSeconds`、`endSeconds`、`width`、`height`（`language`/`streamNumber` 在来源声明时出现）。

#### Scenario: 同一盘的清单形状一致
- **WHEN** 同一个 BDMV 分别用 `export --render` 与 `render` 导出
- **THEN** 两边同名 `igs-png` 记录的字段集合与取值相同（记录整体逐字段相等）
