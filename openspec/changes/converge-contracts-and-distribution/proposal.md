# Proposal

## Why

交付契约覆盖默认预算、导航语义、来源位置、运行时生命周期、发布布局和性能证据。各阶段使用一致的数据与可验证的行为。

## What Changes

- **契约常量收敛（D3）**：`core` 成为 `Limits` 与 `PlayerProfile` 的唯一来源；`hdmv` 的私有默认值改为派生；`VmOptions` 接收 `limits?: Limits`，让 `--limits` 有落地路径；明确 `maxCallDepth` 当前语义并在基线注明。
- **交付证据（D9=C）**：清单记录文件路径和长度；M6 记录实际执行的结构审计和未验证项。
- **图与 VM 语义（D11）**：`JUMP_TITLE` 补后继边；`LINK_*` / `TERMINATE_PL` 按上下文判定；`CALL_TITLE` 通过 `TITLE_SEARCH` 和 `selectTitle()` 恢复标题调用；被上下文忽略的指令必须留诊断。
- **源位置保真（D12）**：IR entry、trace 指令、IGS 结构诊断统一使用原始 `SourceRef`（相对 BDMV 根的 path + origin + 文件字节偏移），删除全部占位值。
- **运行时生命周期（D13）**：初始 VM 与媒体解耦；媒体桥提供 `ended` / `error` / `abort` 回执；音轨选择写回 PSR1；命中几何与按钮可用性判定统一。
- **发布布局可构建（D7）**：`runtime-web` 产出预构建 browser entry，`package-builder` 只依赖产物；两包补 `files` 白名单。
- **性能基准先行（D5=B）**：先建立可复现基准并记录数据，只修有数据支撑的热点；无数据的保留并记录。

**当前交接边界**：浏览器使用操作系统 URL Protocol 请求打开映射的 M2TS。

## Capabilities

### New Capabilities

- `distribution-budget`：发布布局下的构建可复现性，以及大输入处理的可复现基准与预算。

### Modified Capabilities

- `disc-contracts`：`Limits` 唯一来源；`SourceRef` 保真（禁止占位值）。
- `hdmv-navigation`：`CALL_TITLE` 的标题选择与恢复契约；导航边的上下文判定与被忽略指令的诊断。
- `offline-menu-runtime`：初始 VM 不依赖媒体；媒体桥生命周期回执；PSR1 音轨写回；命中几何一致。
- `interactive-graphics-extraction`：IGS 结构诊断携带原始 `SourceLocation`。
- `offline-delivery-assurance`：记录结构审计与未验证的文件完整性；该主规格由 `verify-offline-release` 以 ADDED 建立，收敛要求已并入其 delta，本 change 不持有该主规格的 delta。

## Impact

`packages/core`、`packages/hdmv`、`packages/igs`、`packages/runtime-web`、`packages/package-builder`、`packages/test-runner`、`packages/bdmv-parser`、`packages/media-export`、`packages/bdmv-io`、`apps/cli`；`openspec/specs/offline-delivery-assurance/spec.md`（由已归档的 `verify-offline-release` 建立）、`openspec/changes/IMPLEMENTATION_BASELINE.md` §4/§5、`docs/support/hdmv-support.md`、`docs/support/protocol-support.md`。

## Acceptance Boundary

完成条件分三层，缺一层即未完成：

1. **一致性**：`core` 的默认值被 `hdmv` 派生引用，仓库内不再存在第二份同名默认常量；`SourceRef` 在全链路上无占位值（`grep` 可验证）。
2. **行为**：`JUMP_TITLE` 后继可达、`CALL_TITLE` 的不可用能解除等待、无媒体包执行初始 VM、非循环背景结束能恢复 VM、PSR1 随选轨更新——每条都有失败前后可对比的测试。
3. **诚实**：产物、报告和 schema 不再声明未经审计的完整性信息；M6 对应任务未勾选；文档不再声称可检测内容篡改。

`distribution-budget` 的基准须在提交中给出机器/版本/样本与前后对比，否则视为未验证。

## 当前实现与归档状态（2026-11-06）

媒体 `ended` 回执、PSR1 音轨写回、菜单 VM/sound 集成、HDMV 默认 Limits 收敛与 `convert --limits` 接线已实现。影片动作采用外部 URL Protocol 交接。无菜单媒体时的初始 VM 和 normal-only 按钮命中仍待完成。验收状态见 `tasks.md`。

`disc-contracts`、`hdmv-navigation`、`interactive-graphics-extraction` 和 `offline-menu-runtime` 主规格由本 change 的 MODIFIED delta 更新。`offline-media-playback` 的播放与交接要求由 `export-playable-media` 追加。`offline-delivery-assurance` 的收敛要求由 `verify-offline-release` 维护。

## Related

决策与证据来源见 [2026-11-04 评审](../../../docs/archive/reviews/review-2026-11-04/index.md)。契约决策及待确认事项见 [assumptions.md](assumptions.md)。
