# llm-wiki · bdmv2web 工程知识与索引

本目录是给 LLM/agent 使用的工程知识层：说明功能范围、定位实现、实施变更、排查故障。
行为权威来源是 `openspec/specs/`、`openspec/changes/` 和代码；本目录负责回答“该看哪里、先改哪里”。

基线：commit `21c580a`（2026-11-07）。行号会漂移，定位以「文件路径 + 符号名」为准；源码符号可用 `rg` 直接搜。

## 一句话

把 Blu-ray BDMV 目录解析成结构化 IR 与 IGS 菜单场景，执行 HDMV 导航指令，导出可在 `file://` 离线打开的统一菜单包，并通过系统 URL Protocol 打开原始 M2TS。

## 五分钟心智模型

```text
BDMV 目录
  │ bdmv-parser   index.bdmv / MovieObject.bdmv / PLAYLIST/*.mpls / CLIPINF/*.clpi / AUXDATA/sound.bdmv
  ▼
ParsedDisc（结构 + 原始 12 字节命令 + 引用图 + 诊断）
  ├─ hdmv         解码命令、GPR/PSR、VM、导航图、静态循环
  └─ igs          M2TS → 192B TS → PSI/PES → IGS Display Set → 场景/页/BOG/按钮/PNG
        │
        ├─ media-export   导航闭包 → 媒体计划 → ffmpeg 导出 mp4/m4a、PGS、外部播放目标
        └─ runtime-web    IgsScene → 可序列化 MenuScene；MenuController + HdmvVm 处理输入
                │
                └─ package-builder   自包含目录 index.html + runtime/*.js + assets/
                          │
                          └─ test-runner  离线审计 + 交付判定 + 报告
```

三段边界固定：

- **转换阶段**跑在 Node.js，允许读盘、调用 `ffmpeg`/`ffprobe`。
- **交付物**只有静态文件，`file://` 直接打开，无网络请求、无后台服务、无 ES module。
- **校验阶段**只读包内文件，重算审计与状态，不修改 `manifest.status`。

## 任务路由

| 要做的事 | 先读 | 主要代码 |
| --- | --- | --- |
| 跑通构建与测试 | [testing.md](testing.md) | `package.json`、`scripts/ci.sh` |
| 加一个 CLI 选项或命令 | [features/cli-commands.md](features/cli-commands.md)、[packages/cli.md](packages/cli.md) | `apps/cli/src/cli/program.ts` 的 `.option(...)` + `apps/cli/src/commands/<命令>.ts` |
| 修 BDMV 结构解析 | [packages/bdmv-parser.md](packages/bdmv-parser.md) | `packages/bdmv-parser/src/parser.ts` |
| 修 IGS 场景/图像 | [features/igs-extraction.md](features/igs-extraction.md)、[packages/igs.md](packages/igs.md) | `packages/igs/src/{transport,igs,extract,png}.ts` |
| 修导航指令或 VM 行为 | [features/navigation.md](features/navigation.md)、[packages/hdmv.md](packages/hdmv.md) | `packages/hdmv/src/{decode,registers,vm,graph}.ts` |
| 修菜单交互/渲染 | [features/offline-menu.md](features/offline-menu.md)、[packages/runtime-web.md](packages/runtime-web.md) | `packages/runtime-web/src/index.ts`、`browser.ts` |
| 修菜单包结构/打包 | [packages/package-builder.md](packages/package-builder.md) | `packages/package-builder/src/index.ts` |
| 修媒体导出/ffmpeg 参数 | [features/media.md](features/media.md)、[packages/media-export.md](packages/media-export.md) | `packages/media-export/src/index.ts` |
| 修交付判定/审计报告 | [features/verification.md](features/verification.md)、[packages/test-runner.md](packages/test-runner.md) | `packages/test-runner/src/{decisions,package-audit,release-summary}.ts` |
| 查一个诊断码含义 | [diagnostics.md](diagnostics.md) | `rg "CODE_NAME" packages apps` |
| 按症状排查 | [troubleshooting.md](troubleshooting.md) | 症状 → 检查项 → 文件锚点 |
| 改数据契约 | [contracts.md](contracts.md) | `packages/core/schema/disc-ir.schema.json` |

## 目录

| 文件 | 内容 |
| --- | --- |
| [architecture.md](architecture.md) | 流水线、包依赖、数据与产物边界、一次 `build` 的完整时序 |
| [contracts.md](contracts.md) | DiscIR、Time90k、SourceRef、PlayerProfile、Limits、诊断与事件信封、契约改动流程 |
| [packages/foundation.md](packages/foundation.md) | `core` + `bdmv-io`：契约、限流、输入发现、事务输出 |
| [packages/bdmv-parser.md](packages/bdmv-parser.md) | `bdmv-parser`：文件解析、主备回退、引用图、ParsedDisc |
| [packages/hdmv.md](packages/hdmv.md) | `hdmv`：解码、寄存器、VM、导航图、静态循环 |
| [packages/igs.md](packages/igs.md) | `igs`：传输流重组、IGS 段、场景、PNG |
| [packages/media-export.md](packages/media-export.md) | `media-export`：媒体闭包、计划、循环导出、PGS、外部目标 |
| [packages/runtime-web.md](packages/runtime-web.md) | `runtime-web`：MenuController、播放桥、时钟、序列化、boot |
| [packages/package-builder.md](packages/package-builder.md) | `package-builder`：包内文件、脚本嵌入、音效、manifest |
| [packages/test-runner.md](packages/test-runner.md) | `test-runner`：包审计、状态判定、证据、报告 |
| [packages/test-fixtures.md](packages/test-fixtures.md) | `test-fixtures`：字节构造器与合成夹具 |
| [packages/cli.md](packages/cli.md) | `apps/cli`：参数契约、命令实现、错误处理 |
| [features/cli-commands.md](features/cli-commands.md) | 7 个命令的输入、产物、退出码、失败码 |
| [features/navigation.md](features/navigation.md) | HDMV 执行模型、事件/generation、UO、导航图与媒体闭包 |
| [features/igs-extraction.md](features/igs-extraction.md) | 从 M2TS 到场景与 PNG 的完整链路 |
| [features/offline-menu.md](features/offline-menu.md) | `build` 管线、包结构、浏览器启动与交互 |
| [features/media.md](features/media.md) | 媒体闭包、计划、循环导出、线性变体、PGS、外部播放器 |
| [features/verification.md](features/verification.md) | 审计、交付状态规则、`build` 与 `validate` 的关系 |
| [diagnostics.md](diagnostics.md) | 诊断码分组、含义、产生位置、首查方向 |
| [troubleshooting.md](troubleshooting.md) | 症状驱动的排查路径与命令 |
| [testing.md](testing.md) | 测试布局、夹具来源、逐包基线、新增测试做法 |
| [glossary.md](glossary.md) | BDMV/HDMV/IGS/PGS 术语与仓库内命名 |
| [index.json](index.json) | 机器可读索引：文档、覆盖主题、关键文件、关键词 |

## 阅读建议

- 第一次接触：本文件 → [architecture.md](architecture.md) → 对应 feature 文档。
- 改代码前：对应 `packages/*.md` 的「公开接口」与「改动入口」两节，再看 `openspec/specs/` 的验收场景。
- 排查故障：先 [troubleshooting.md](troubleshooting.md) 定位症状，再用 [diagnostics.md](diagnostics.md) 解读诊断码。

## 维护约定

改动下列内容时同步更新本目录，保持索引可用：

| 改动 | 需要更新 |
| --- | --- |
| 新增/重命名诊断码 | [diagnostics.md](diagnostics.md)、[index.json](index.json) 关键词 |
| 新增 CLI 命令或选项 | [features/cli-commands.md](features/cli-commands.md)、[packages/cli.md](packages/cli.md) |
| 修改包内产物结构 | [packages/package-builder.md](packages/package-builder.md)、[features/offline-menu.md](features/offline-menu.md) |
| 修改 DiscIR/时间/限流契约 | [contracts.md](contracts.md) |
| 新增包或重划职责 | [architecture.md](architecture.md)、`packages/` 新增文档、[index.json](index.json) |
| 新增测试或调整基线 | [testing.md](testing.md)（逐包计数必须与 `docs/guides/development.md` 一致） |

## 与其他文档的关系

| 文档 | 定位 |
| --- | --- |
| `README.md` | 用户视角的能力、安装、命令用法 |
| `docs/guides/development.md` | 工具链、CLI 状态、测试基线、构建门禁 |
| `docs/support/*.md` | 协议/HDMV/IGS 的支持边界与证据等级 |
| `docs/references/` | 固定 revision 的参考实现与阶段资料 |
| `openspec/specs/` | 已合并的行为规格（验收场景） |
| `openspec/changes/` | 进行中或已归档的变更 |
| `docs/review-2026-11-06-hdmv-vm-conformance/` | VM 与 libbluray 的逐指令一致性记录 |
| 本目录 | 导航与索引层：不重复规格正文，只指向位置与结论 |

发现本目录与代码不一致时，先以代码和 `openspec/specs/` 为准完成判断，再修本目录；不要按本目录的错误描述改代码。
