# Spec Delta

## MODIFIED Requirements

### Requirement: 输出选择

`export` SHALL 用 `--type all|metadata|hdmv|igs|sup` 选择输出，`--type` SHALL NOT 表示输入类型。`igs`/`sup` SHALL 写对应 `.mnu`/`.sup` 容器（配合 `--render` 还写其 PNG），`hdmv` SHALL 写命令表与来源映射，`metadata` SHALL 写整套结构元数据（`manifest.json`、`hdmv/*.json`、`igs/*.json`、`sup/tracks.json`），`all` SHALL 写该命令能写出的全部产物。省略 `--type` 时 `export` SHALL 只写容器。非法值 SHALL 以 `CLI_INVALID_ASSET_TYPE` 失败。

`--no-assets` SHALL 关闭资产侧（不写容器、不写 PNG），保留元数据侧：与省略 `--type` 或 `--type all` 连用时 SHALL 写整套元数据，与 `--type igs|sup` 连用时 SHALL 只写该段元数据，与 `--type hdmv` 连用时行为不变。`--no-assets` 与 `--render` 连用 SHALL 以 `CLI_EXPORT_SELECTION` 失败。

#### Scenario: 导出元数据而不写资产
- **WHEN** `export <BDMV> --out DIR --type metadata`
- **THEN** 输出目录含 `manifest.json`、`hdmv/`、`igs/`、`sup/tracks.json`，不含 `assets/` 与 `assets-manifest.json`，stdout 无 `assetCount`

#### Scenario: --no-assets 写出整套元数据
- **WHEN** `export <BDMV> --out DIR --no-assets`
- **THEN** 输出目录含 `manifest.json`、`hdmv/*.json`、`igs/*.json`、`sup/tracks.json`，不含 `assets-manifest.json`

#### Scenario: --no-assets 收窄元数据段
- **WHEN** `export <BDMV> --out DIR --type igs --no-assets`
- **THEN** 输出目录只含 `igs/*.json` 与 `manifest.json`，不含 `hdmv/`、`sup/`、`assets/`

#### Scenario: all 同时写容器与元数据
- **WHEN** `export <BDMV> --out DIR --type all`
- **THEN** 输出目录同时含 `.mnu`/`.sup` 容器、`assets-manifest.json` 与元数据产物

#### Scenario: 默认值保持不变
- **WHEN** `export <BDMV> --out DIR`（不给 `--type`）
- **THEN** 只写 `.mnu`/`.sup` 容器与 `assets-manifest.json`，不写元数据

#### Scenario: 元数据形态不接受解码
- **WHEN** `export <BDMV> --out DIR --type metadata --render`，或 `export <BDMV> --out DIR --no-assets --render`
- **THEN** 以 `CLI_EXPORT_SELECTION` 失败，不写任何产物

### Requirement: 输入类型判定

`export` 与 `render` SHALL 按输入自身判定类型，SHALL NOT 要求用户声明输入类型。判定 SHALL 先看内容（IGS `ICS`/`PDS`/`ODS` 段标签、PGS `PG` 段标签、偏移 0 或 4 处的传输流同步字节且下一个包边界再次命中），无法判定时退回扩展名（`.m2ts`/`.rsks`、`.mnu`、`.sup`），仍无法判定时 SHALL 保持 BDMV 输入路径与既有错误。

#### Scenario: 改名流文件仍按流处理
- **WHEN** 内容是 m2ts 流的文件以 `.bin` 结尾
- **THEN** 按流文件导出，不进入 BDMV 解析路径

#### Scenario: 内容优先于扩展名
- **WHEN** 内容是 PGS 流的文件以 `.mnu` 结尾
- **THEN** 按 SUP 输入处理

#### Scenario: 独立容器输入被 export 拒绝
- **WHEN** `export <file>.sup --out DIR`
- **THEN** 以 `CLI_EXPORT_SELECTION` 失败，错误信息指向 `render`，且不创建输出目录

#### Scenario: 独立容器输入被 render 接受
- **WHEN** `render <file>.sup --out DIR`
- **THEN** 解码该 SUP 的显示集并写出 PNG 与 `assets-manifest.json`，无需 `--sup`

#### Scenario: 流文件没有 HDMV 命令表
- **WHEN** `export <stream>.rsks --out DIR --type hdmv`
- **THEN** 以 `CLI_EXPORT_SELECTION` 失败，说明流内没有 HDMV 命令表

### Requirement: extract 命令移除

`bdmv2web` SHALL NOT 注册 `extract` 命令。它作为 `export` 元数据形态的两种用法 SHALL 由 `export --no-assets`（整套元数据）与 `export --type igs|sup --no-assets`（单段元数据）承担。`CLI_EXTRACT_SELECTION` 与 `CLI_INVALID_EXTRACT_TYPE` SHALL 不再出现；`extract` 作为未知命令 SHALL 以 `CLI_USAGE` 失败。

#### Scenario: extract 不再是命令
- **WHEN** `bdmv2web extract <BDMV> --out DIR`
- **THEN** 以 `CLI_USAGE` 失败，提示未知命令，不写任何产物

#### Scenario: 产物等价
- **WHEN** 同一 BDMV 分别运行旧 `extract --all` 与 `export --no-assets`
- **THEN** 两个输出目录内容相同（`limitations` 文案随命令名调整）

### Requirement: render 按输入校验选项

`render` SHALL 删除 `--mnu`/`--sup`，只接受位置参数。`.mnu`/`.sup` 输入 SHALL 拒绝 `--type` 与 `--m2ts`，`.sup` SHALL 拒绝 `--pid`，`.mnu` SHALL 拒绝 `--language`；盘与流输入 SHALL 拒绝 `--language`。以上错配 SHALL 报 `CLI_RENDER_SELECTION`。`render` SHALL NOT 写 `.mnu`/`.sup` 容器，也 SHALL NOT 写元数据产物。

#### Scenario: 独立 MNU 不再需要开关
- **WHEN** `render <file>.mnu --out DIR`
- **THEN** 写出 IGS 元素 PNG 与 `assets-manifest.json`，不写 `.mnu` 容器

#### Scenario: 错配选项被拒绝
- **WHEN** `render <file>.sup --out DIR --type sup`
- **THEN** 以 `CLI_RENDER_SELECTION` 失败，不写任何产物
