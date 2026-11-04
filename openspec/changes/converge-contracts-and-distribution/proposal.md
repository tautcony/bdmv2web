# Proposal

## Why

第 1 批让门禁与退出码回到事实，但 13 项评审里真正影响"产物可信度"的问题都在第 2 批：

- **同一契约有两套数值**：`core` 的 `DEFAULT_LIMITS` 是 `maxCallDepth 128 / maxQueueDepth 1024`，`hdmv` 的私有 `DEFAULTS` 是 `64 / 256`；`DEFAULT_PLAYER_PROFILE` 也有两份。数值型仿真契约一旦分叉，各包测试会各自为政。
- **证据链名义存在**：`auditOutputPackage()` 恒返回 `payloadFingerprint: null`，`validate` 又用这个 null 覆盖构建值；浏览器证据的 mismatch 列表不比较 payload/媒体，artifact 的 `sha256` 记录后不复验。结果是"有字段、有测试、有 schema"，但字节篡改与换 bundle 都拦不住。
- **静态图与 VM 语义不一致**：`graph.ts` 把 `JUMP_TITLE` / `LINK_*` / `TERMINATE_PL` 当终止流，VM 在 MovieObject 上下文却继续执行；`CALL_TITLE` 不建立 continuation，桥的 `MEDIA_UNAVAILABLE` 被当作可丢弃事件。
- **源位置在交付层丢失**：`createMenuDiscIR` 写入占位的 `source/structural` + offset 0，`vmPrograms` 改写为 `<MovieObject>`，IGS 结构诊断落到 `BDMV/STREAM/.m2ts`。这直接使"首分歧可定位""诊断可回到源文件"两条验收失效。
- **运行时生命周期缺口**：无媒体包不执行初始 `runTurn`/First Play；非循环背景没有 `ended`/`error` 监听，VM 永久 suspended；菜单音轨选择不写回 PSR1，按钮程序读到 `0xff`。
- **发布布局不可移植**：`package-builder` 在构建期读 `../../runtime-web/src/browser.ts` 并把 `hdmv` alias 到 `.ts` 源码，按 `dist/` 发布即断。
- **性能热点无数据**：五处 O(n²)/重复系统调用（`buildGraph`、`PES.append`、`hex()` 比较、10ms 全树轮询、重复 `realpath`）目前只有静态判断，没有基准，无法决定优先级。

## What Changes

- **契约常量收敛（D3）**：`core` 成为 `Limits` 与 `PlayerProfile` 的唯一来源；`hdmv` 的私有默认值改为派生；`VmOptions` 接收 `limits?: Limits`，让 `--limits` 有落地路径；明确 `maxCallDepth` 当前语义并在基线注明。
- **证据链降级（D9=C）**：不实现字节级完整性校验，改为**删除虚假承诺**——移除 `payloadFingerprint` 字段与其派生逻辑、"字节篡改/换 bundle 会失效"的表述；M6 的 1.1 / 4.3 取消勾选；证据绑定范围写明为 profile / mode / matrix / environment。
- **图与 VM 语义（D11）**：`JUMP_TITLE` 补后继边；`LINK_*` / `TERMINATE_PL` 按上下文判定；`CALL_TITLE` 建立可关联的等待与回执；被上下文忽略的指令必须留诊断。
- **源位置保真（D12）**：IR entry、trace 指令、IGS 结构诊断统一使用原始 `SourceRef`（相对 BDMV 根的 path + origin + 文件字节偏移），删除全部占位值。
- **运行时生命周期（D13）**：初始 VM 与媒体解耦；媒体桥补齐 `ended` / `error` / `abort` 回执；音轨选择写回 PSR1；命中几何与按钮可用性判定统一。
- **发布布局可构建（D7）**：`runtime-web` 产出预构建 browser entry，`package-builder` 只依赖产物；两包补 `files` 白名单。
- **性能基准先行（D5=B）**：先建立可复现基准并记录数据，只修有数据支撑的热点；无数据的保留并记录。

**明确不做（D6 决策"先不修改"）**：本地桥的 GET/`<img>` 触发方式与 token 位置不变；审计规则对模板字面量 URL 的采集缺口继续保持 `BUNDLE_DYNAMIC_ACCESS` 的 `not-verified` 兜底。该缺口在 README / 报告里保留已知问题条目。

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

`packages/core`、`packages/hdmv`、`packages/igs`、`packages/runtime-web`、`packages/package-builder`、`packages/test-runner`、`packages/bdmv-parser`、`packages/media-export`、`packages/bdmv-io`、`apps/cli`；`openspec/changes/verify-offline-release/tasks.md` 与 `specs/offline-delivery-assurance/spec.md`、`openspec/changes/IMPLEMENTATION_BASELINE.md` §4/§5、`docs/hdmv-support.md`、`docs/protocol-support.md`、`docs/browser-matrix.md`。

## Acceptance Boundary

完成条件分三层，缺一层即未完成：

1. **一致性**：`core` 的默认值被 `hdmv` 派生引用，仓库内不再存在第二份同名默认常量；`SourceRef` 在全链路上无占位值（`grep` 可验证）。
2. **行为**：`JUMP_TITLE` 后继可达、`CALL_TITLE` 的不可用能解除等待、无媒体包执行初始 VM、非循环背景结束能恢复 VM、PSR1 随选轨更新——每条都有失败前后可对比的测试。
3. **诚实**：`payloadFingerprint` 从产物、报告、schema 中消失；M6 的 1.1 / 4.3 未勾选；文档不再声称可检测篡改。

`distribution-budget` 的基准须在提交中给出机器/版本/样本与前后对比，否则视为未验证。

## 归档前置（重要）

本 change 的 5 个能力 delta 全部是 `MODIFIED`，而 `openspec/specs/` 目前为空——这些能力只存在于**未归档**的 change 里。`openspec validate --strict` 通过，但 archive 会拒绝：

```text
target spec does not exist; only ADDED requirements are allowed for new specs
```

按 `openspec list` 的实际状态，两类处理不同：

| 能力 | 上游 change | 上游状态 | 处理 |
| --- | --- | --- | --- |
| `disc-contracts` | `establish-core-contracts` | ✓ Complete | 先归档上游，本 delta 生效 |
| `hdmv-navigation` | `execute-hdmv-navigation` | ✓ Complete | 先归档上游，本 delta 生效 |
| `interactive-graphics-extraction` | `extract-igs-scenes` | ✓ Complete | 先归档上游，本 delta 生效 |
| `offline-menu-runtime` | `build-offline-menu-runtime` | 13/16 | 上游仍在演化：把本 delta 内容直接并入上游 `spec.md`，本 change 的该目录在 apply 时删除，仅保留 tasks 跟踪 |
| `offline-delivery-assurance` | `verify-offline-release` | 14/17 | 同上 |

因此 apply 的第一步不是改代码，而是按上表处理规格归属（见 `tasks.md` H.6）。

`restore-build-gate-and-delivery-status` 只有 `ADDED` delta，不受此限制，可随时归档。

## Related

决策来源：[`docs/code-review.md`](../../../docs/code-review.md) 第 2 批（D3、D5、D6、D7、D9、D11、D12、D13）。第 1 批见 [`restore-build-gate-and-delivery-status`](../restore-build-gate-and-delivery-status/proposal.md)。

批次说明：评审文档的"第 3 批"已取消——D8 的 `test` 脚本统一提前到第 1 批（它决定后续所有计数基线），D7 与 D5 的剩余项并入本批（都需要第 1 批的产物布局作前提）。D4 的 `--limits` 真正接线条目（A.6）也在本批。

评审里标 `⚠需确认` 但本 change 已按某个假设推进的 7 项，见 [`assumptions.md`](assumptions.md)。其中 **R2-1（`maxCallDepth` 的 64/256 来历）** 只有决策者能确认，若与假设相反，A.1–A.4 需要改派生方向。
