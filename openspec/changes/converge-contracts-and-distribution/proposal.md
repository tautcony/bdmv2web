# Proposal

## Why

第 1 批让门禁与退出码回到事实，但 13 项评审里真正影响"产物可信度"的问题都在第 2 批：

- **同一契约有两套数值**：`core` 的 `DEFAULT_LIMITS` 是 `maxCallDepth 128 / maxQueueDepth 1024`，`hdmv` 的私有 `DEFAULTS` 是 `64 / 256`；`DEFAULT_PLAYER_PROFILE` 也有两份。数值型仿真契约一旦分叉，各包测试会各自为政。
- **证据链与实际能力不符**：旧报告记录的制品完整性信息并未由审计重新核对。
- **静态图与 VM 语义不一致**：`graph.ts` 仍把 `JUMP_TITLE` / `LINK_*` / `TERMINATE_PL` 当终止流，VM 在 MovieObject 上下文却继续执行。当前 `CALL_TITLE` 暂停后通过 `TITLE_SEARCH → selectTitle()` 恢复；剩余工作是核实失败路径和诊断，不再按旧假设强制改成桥端 `responseTo` continuation。
- **源位置在交付层丢失**：`createMenuDiscIR` 写入占位的 `source/structural` + offset 0，`vmPrograms` 改写为 `<MovieObject>`，IGS 结构诊断落到 `BDMV/STREAM/.m2ts`。这直接使"首分歧可定位""诊断可回到源文件"两条验收失效。
- **运行时剩余缺口**：无菜单媒体包仍不执行初始 `runTurn`/First Play；只有 normal 图像的可用按钮仍可能无法命中。背景 `ended` 回执和主音轨选择后的 PSR1 写回已在当前实现中存在，需保留回归验收但不再列为待实现。
- **发布布局不可移植**：`package-builder` 在构建期读 `../../runtime-web/src/browser.ts` 并把 `hdmv` alias 到 `.ts` 源码，按 `dist/` 发布即断。
- **性能热点无数据**：五处 O(n²)/重复系统调用（`buildGraph`、`PES.append`、`hex()` 比较、10ms 全树轮询、重复 `realpath`）目前只有静态判断，没有基准，无法决定优先级。

## What Changes

- **契约常量收敛（D3）**：`core` 成为 `Limits` 与 `PlayerProfile` 的唯一来源；`hdmv` 的私有默认值改为派生；`VmOptions` 接收 `limits?: Limits`，让 `--limits` 有落地路径；明确 `maxCallDepth` 当前语义并在基线注明。
- **证据链降级（D9=C）**：移除文件内容校验和关联字段，清单保留文件路径和长度；M6 对应的完整性任务取消勾选。
- **图与 VM 语义（D11）**：`JUMP_TITLE` 补后继边；`LINK_*` / `TERMINATE_PL` 按上下文判定；`CALL_TITLE` 建立可关联的等待与回执；被上下文忽略的指令必须留诊断。
- **源位置保真（D12）**：IR entry、trace 指令、IGS 结构诊断统一使用原始 `SourceRef`（相对 BDMV 根的 path + origin + 文件字节偏移），删除全部占位值。
- **运行时生命周期（D13）**：初始 VM 与媒体解耦；媒体桥补齐 `ended` / `error` / `abort` 回执；音轨选择写回 PSR1；命中几何与按钮可用性判定统一。
- **发布布局可构建（D7）**：`runtime-web` 产出预构建 browser entry，`package-builder` 只依赖产物；两包补 `files` 白名单。
- **性能基准先行（D5=B）**：先建立可复现基准并记录数据，只修有数据支撑的热点；无数据的保留并记录。

**当前交接边界**：浏览器使用操作系统 URL Protocol 请求打开映射的 M2TS。当前运行时没有本地 HTTP bridge，也不使用 `<img>` 请求影片；本 change 不新增本地服务。

## Capabilities

### New Capabilities

- `distribution-budget`：发布布局下的构建可复现性，以及大输入处理的可复现基准与预算。

### Modified Capabilities

- `disc-contracts`：`Limits` 唯一来源；`SourceRef` 保真（禁止占位值）。
- `hdmv-navigation`：`CALL_TITLE` 的等待/回执契约；导航边的上下文判定与被忽略指令的诊断。
- `offline-menu-runtime`：初始 VM 不依赖媒体；媒体桥生命周期回执；PSR1 音轨写回；命中几何一致。
- `interactive-graphics-extraction`：IGS 结构诊断携带原始 `SourceLocation`。
- `offline-delivery-assurance`：完整性校验由"承诺"降级为"显式未验证"，并限制证据绑定范围。

## Impact

`packages/core`、`packages/hdmv`、`packages/igs`、`packages/runtime-web`、`packages/package-builder`、`packages/test-runner`、`packages/bdmv-parser`、`packages/media-export`、`packages/bdmv-io`、`apps/cli`；`openspec/changes/verify-offline-release/tasks.md` 与 `specs/offline-delivery-assurance/spec.md`、`openspec/changes/IMPLEMENTATION_BASELINE.md` §4/§5、`docs/support/hdmv-support.md`、`docs/support/protocol-support.md`。

## Acceptance Boundary

完成条件分三层，缺一层即未完成：

1. **一致性**：`core` 的默认值被 `hdmv` 派生引用，仓库内不再存在第二份同名默认常量；`SourceRef` 在全链路上无占位值（`grep` 可验证）。
2. **行为**：`JUMP_TITLE` 后继可达、`CALL_TITLE` 的不可用能解除等待、无媒体包执行初始 VM、非循环背景结束能恢复 VM、PSR1 随选轨更新——每条都有失败前后可对比的测试。
3. **诚实**：产物、报告和 schema 不再声明未经审计的完整性信息；M6 对应任务未勾选；文档不再声称可检测内容篡改。

`distribution-budget` 的基准须在提交中给出机器/版本/样本与前后对比，否则视为未验证。

## 当前实现与归档状态（2026-11-06）

内容摘要逻辑已移除；媒体 `ended` 回执、PSR1 音轨写回、菜单 VM/sound 集成、HDMV 默认 Limits 收敛与 `convert --limits` 接线已实现；影片动作采用外部 URL Protocol 交接。无菜单媒体时初始 VM 仍受媒体字段条件限制，normal-only 按钮命中仍不完整。完整差异见 `design.md` 的“当前实现复核”。

主规格现状：`disc-contracts`、`hdmv-navigation`、`interactive-graphics-extraction` 已存在；`offline-menu-runtime` 与 `offline-delivery-assurance` 缺失。apply 的第一步按 `openspec status` 的 `existingOutputPaths` 做 delta 对照，把本 change 的 delta 并入对应上游 spec（见 `tasks.md` H.6）。`restore-build-gate-and-delivery-status` 只有 `ADDED` delta，可随时归档。

## Related

决策来源：[`docs/review-2026-11-04/index.md`](../../../docs/review-2026-11-04/index.md) 第 2 批（D3、D5、D6、D7、D9、D11、D12、D13）。第 1 批见 [`restore-build-gate-and-delivery-status`](../restore-build-gate-and-delivery-status/proposal.md)。

批次说明：评审文档的"第 3 批"已取消——D8 的 `test` 脚本统一提前到第 1 批（它决定后续所有计数基线），D7 与 D5 的剩余项并入本批（都需要第 1 批的产物布局作前提）。D4 的 `--limits` 真正接线条目（A.6）也在本批。

评审里标 `⚠需确认`、并在本 change 中按已记录决策推进的假设见 [`assumptions.md`](assumptions.md)。R2-1 已按 core 是公开单一契约来源的决策完成收敛。
