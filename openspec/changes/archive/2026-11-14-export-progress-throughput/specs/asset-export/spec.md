# Spec Delta

## ADDED Requirements

### Requirement: 导出进度报告

`export` SHALL 支持 `--progress` 与 `--no-progress`，并 SHALL 使用与 `build` 相同的步骤渲染（`x/N` 计数、运行中标记、`[███░░░]` 进度条、每步耗时、结尾 `Done in`）。stdout 的 `{stageStatus, output, assetCount}` JSON 契约 SHALL 保持不变，进度 SHALL 只写 stderr。默认行为 SHALL 与 `build` 一致：交互式终端一条实时行，管道静默。

#### Scenario: 终端默认实时进度
- **WHEN** `export --render` 在 stderr 为 TTY 时运行
- **THEN** stderr 显示命令头（命令名、步骤数、`input`/`output`/`type`）、当前步骤的实时行（含比例步骤的进度条），以及每个已完成步骤的一行永久记录

#### Scenario: 管道默认静默
- **WHEN** `export` 的 stderr 不是 TTY 且未指定 `--progress`
- **THEN** stderr 不输出任何内容，stdout 仍为单行 JSON 摘要

#### Scenario: 管道下的明文进度
- **WHEN** stderr 不是 TTY 且指定 `--progress`
- **THEN** 每个步骤开始输出一行，比例步骤按 10% 增量输出 `NN%  <detail>` 行，不打 ANSI 控制序列

#### Scenario: `--no-progress` 静默
- **WHEN** `export --no-progress` 运行
- **THEN** stderr 不输出进度内容，即使 stderr 是 TTY

#### Scenario: 失败时先收尾再报错
- **WHEN** 某一步以 `stageStatus: "failed"` 结束
- **THEN** 进度实时行被关闭、该步记为失败并打印 `Failed in` 汇总，随后才输出既有的失败记录

### Requirement: 解码吞吐与产物一致性

显示集 PNG 的解压 SHALL 在 libuv 线程池上并行进行，并发度 SHALL 不小于 1 且不改变产物。解码 SHALL NOT 改变 PNG 字节、`assets-manifest.json` 的内容或记录顺序（每条 SUP 记录后紧跟其显示集 PNG 记录）。

#### Scenario: 与同步编码字节一致
- **WHEN** 同一显示集分别用同步与线程池编码路径渲染
- **THEN** 两次 `pngBytes` 完全相同，`startSeconds`/`endSeconds`/`visible` 也相同

#### Scenario: 多轨道共用一条进度
- **WHEN** 一次导出含多条 SUP 轨道且 `--render`
- **THEN** `Decode display sets` 的比例按全部轨道的显示集总数单调递增，结束时输出 PNG 总数
