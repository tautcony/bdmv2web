# Spec Delta

## ADDED Requirements

### Requirement: BDMV 资产导出
export SHALL 接受 BDMV 根目录或其父目录，导出可达 IGS 流为 `.mnu`、可达 PGS 轨道为 `.sup`，并按需解码 PNG；产物 SHALL 写入 `assets/igs/` 与 `assets/subtitles/` 并落盘 `assets-manifest.json`，stdout SHALL 输出单一 JSON 摘要。

#### Scenario: BDMV 输入导出
- **WHEN** export 以 BDMV 目录运行且 `--type all`
- **THEN** 输出包含可达 IGS 流的 `.mnu`、可达 PGS 轨道的 `.sup` 与 `assets-manifest.json`，产物路径与既有命名一致

### Requirement: 独立流文件输入
export SHALL 接受单个 `.m2ts` 或 `.rsks` 常规文件作为输入，从文件自身的 PAT/PMT 发现图形流；流模式下 `--m2ts` SHALL 以 `CLI_EXPORT_SELECTION` 拒绝。BDMV 输入的识别与错误路径 SHALL 保持不变。

#### Scenario: .rsks 输入导出 SUP
- **WHEN** export 以内容为 m2ts 流的 `.rsks` 文件运行且 `--type sup`
- **THEN** 按 PMT 声明的 PGS PID 导出 `.sup`，产物与清单落入输出目录，stdout 报告 `stageStatus` 与资产数

#### Scenario: 流模式拒绝 clip 选择
- **WHEN** export 以流文件运行且传入 `--m2ts`
- **THEN** 以 `CLI_EXPORT_SELECTION` 失败，不写任何产物

#### Scenario: 非 BDMV 目录保持既有路径
- **WHEN** export 以不含 BDMV 结构的目录或非流扩展名文件运行
- **THEN** 走既有 BDMV 输入错误路径，不进入流模式

#### Scenario: 流模式遵守 --type
- **WHEN** 流文件同时声明 PGS 与 IGS，export 以 `--type igs` 运行
- **THEN** 只写 `.mnu` 与 IGS 元素 PNG，不写 `.sup`（`--type sup` 反之）

### Requirement: PMT 图形流发现
流模式 SHALL 依据 PMT stream_type 发现 PGS（0x90）与 IGS（0x91）PID，SHALL 忽略保留 PID（< 0x20）上的声明。PMT 段未通过 CRC 校验时，发现 SHALL 继续按段内声明读取，并 SHALL 保留 PSI_CRC_INVALID 诊断；诊断进入 stage 判定（warning 不阻塞）。未声明图形流的文件 SHALL 以零资产完成输出并记录 warning 诊断；`--pid` 指定未声明的 PID 时 SHALL 以 `CLI_EXPORT_SELECTION` 失败。

#### Scenario: PMT 声明 PGS
- **WHEN** 流文件 PMT 声明 stream_type 0x90 的 PID 且该 PID 含完整显示集
- **THEN** 导出该 PID 的 `.sup` 并在清单记录 `language: "und"` 与发现序号 `streamNumber`

#### Scenario: PMT CRC 无效仍可发现
- **WHEN** 流文件的 PMT 段 CRC 校验失败但段内声明完整
- **THEN** 仍按声明发现图形 PID 并导出资产，诊断中保留 `PSI_CRC_INVALID`，stdout `stageStatus` 为 `partial`

#### Scenario: 无图形流
- **WHEN** 流文件 PMT 未声明 0x90/0x91 PID
- **THEN** 记录 warning 诊断并完成输出，`assets-manifest.json` 无 sup/mnu 资产，stdout `stageStatus` 非 failed

#### Scenario: 未声明的 --pid
- **WHEN** `--pid` 指定的 PID 不在 PMT 0x90/0x91 声明中
- **THEN** 以 `CLI_EXPORT_SELECTION` 失败，不写任何产物

### Requirement: SUP 时间轴保真
独立流导出的 `.sup` SHALL 保留源流 90kHz 时间戳；`sup-png` 记录的 `startSeconds`/`endSeconds` SHALL 以轨道首个显示集为 0。

#### Scenario: 时间戳保留
- **WHEN** 源流首个 PGS 显示集 PTS 大于 2 秒
- **THEN** 导出的 `.sup` 记录与源流相同的 90kHz PTS 值

#### Scenario: PNG 时间相对化
- **WHEN** `--render` 渲染独立流的显示集
- **THEN** `startSeconds` 以首个显示集为 0 递增

### Requirement: 无效流失败报告
流文件未收到完整 PAT 或任何 PMT 段（无法作为 m2ts 解析），或声明的 PGS PID 无完整显示集时，export SHALL 在提交任何产物前以 `EXPORT_INVALID_STREAM` 失败。

#### Scenario: 非流文件
- **WHEN** 输入文件不含 PAT 或未送达任何 PMT 段
- **THEN** 以 `EXPORT_INVALID_STREAM` 失败且输出目录不产生事务产物

#### Scenario: 声明 PID 无数据
- **WHEN** PMT 声明 0x90 PID 但该 PID 无完整显示集
- **THEN** 以 `EXPORT_INVALID_STREAM` 失败并给出定位到源文件的错误信息

### Requirement: 产物与清单形态
流模式产物命名 SHALL 以输入文件 stem 代替 clipId，`assets-manifest.json` schema SHALL 与 BDMV 模式一致；传输/PSI 诊断 SHALL 进入同一 stage 判定，error 级诊断 SHALL 降级为 `partial` 而不阻塞产物提交。

#### Scenario: 命名与清单
- **WHEN** 流文件 stem 为 `00005.SumiSora.sc` 且 PMT 声明 PID 0x1200
- **THEN** 产物为 `assets/subtitles/00005.SumiSora.sc-pid-1200.sup` 并出现在 `assets-manifest.json`

#### Scenario: 尾部杂讯降级
- **WHEN** 流文件在最后一个完整包之后附带非 m2ts 字节
- **THEN** 提取继续完成，传输诊断保留，stdout `stageStatus` 为 `partial` 且 exit code 为 0
