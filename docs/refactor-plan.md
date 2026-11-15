# bdmv2web 架构整改实施任务书（简化确定版）

> 适用对象：Luna 6 等低推理档代码模型。**按本文件给定的目录、接口、步骤与测试实施，不重新设计架构。**
>
> 代码依据：用户上传的 `bdmv2web-master(1).zip` 中 `bdmv2web-master/` 源码。下述路径及函数名称已对照该版本源码核对；实际修改时按函数、符号定位，不按行号编辑。
>
> **执行起点就是当前仓库。没有独立的基线冻结步骤，不生成源码清单，不做代码版本同一性检查，不要求预先提交或备份。** 本文只规定目标行为和变更范围。正常开发与版本管理方式不在本方案内额外规定。

## 0. 实施边界

### 0.1 必须解决的九项工作

| 顺序 | 任务 | 要消除的问题 | 主要所有者 |
|---|---|---|---|
| T01 | 交付状态规则统一 | 纯 BD-J 被 HDMV 专用规则判为失败 | `test-runner` |
| T02 | CLI 结果出口统一 | 纯 BD-J 构建分支遗漏退出码设置 | `apps/cli` |
| T03 | 运行时资源索引归位 | BD-J 实际读取的索引在审计中被当作报告 | `package-builder`、`test-runner` |
| T04 | 播放目标契约归位 | `runtime-web` 不必要地依赖 `media-export` | `core`、`media-export` |
| T05 | RuntimeData 类型单源 | 生成器与浏览器分别持有运行时数据形状 | `core`、`runtime-web`、`package-builder` |
| T06 | 服务端导航状态归一 | local-jvm 下 VM 状态和动作分别发送 | `apps/cli/serve` |
| T07 | 浏览器导航状态归一 | 远端模式仍借用本地 VM 快照并修改本地寄存器 | `runtime-web` |
| T08 | BuildUseCase 编排收敛 | `build.ts` 的两条构建路径重复组装相同数据 | `apps/cli/application` |
| T09 | 媒体编码与组包分离 | 打包器同时执行媒体编码和静态包组装 | `media-export`、`package-builder`、`apps/cli` |

按 T01→T09 顺序完成。每个任务只做列出的变更；当前任务测试通过后进入下一项。**不用先做架构图、风险登记、环境摸底、提交记录、阻塞预测或额外的 CI 防退化工具。**

### 0.2 统一保持的现有行为

1. CLI 子命令和参数保持现状，包括 `build`、`serve`、`validate`、`--out`、`--overwrite`、`--menu-media`、`--resume`、`--reuse`、`--player-profile`、`--java` 等。
2. `file://` 启动的 HDMV 静态包不依赖本地服务；BD-J 继续通过 `bdmv2web serve` 和 Java 运行；混合入口继续支持。
3. `manifest.json`、`reports.json`、`asset-manifest.json`、`runtime/disc-data.js`、`runtime/app.bundle.js`、`runtime/bdj/session.json`、`media-plans/` 等产物路径不改名；包的现有 `schemaVersion: "1.0"` 不更改。
4. PSR/GPR、Playlist/PlayItem/Mark、IGS/PGS、媒体时间轴、复用和外部播放器 URL Protocol 的既有语义不改变。
5. 保留源码现有的路径安全、输入有效性、资源约束和输出事务实现。**本轮既不移除这些既有机制，也不新增与架构整改无关的预防性检查。**
6. 不重写 HDMV 虚拟机与 BDMV 解析算法，不因文件较大而机械拆分它们。

### 0.3 不做的工作

- 不增加文件摘要、版本指纹、工作区一致性、预执行快照等机制。
- 不增加独立的架构规则扫描器、依赖检查 CI、通用守卫框架或“先全面审计再修改”的前置流程。
- 不实现 SSE 事件持久化、重放缓存、请求去重缓存、generation/epoch 管理、全局异步任务框架；已有 HTTP/SSE 足以完成本轮状态归一。
- 不添加“只因未经真实 BD-J 验证就强制 `partial`”的规则。现有 D-2R 语义是：验证证据缺失进入 `notVerified`，不自动改变交付状态。
- 不额外引入 JSON Schema/Ajv 全量运行时校验器；T05 解决的是**类型及数据结构归属**，不新设一套输入防御层。

## 1. T01：移除纯 BD-J 的错误交付规则

**修改文件**：
- `packages/test-runner/src/decisions.ts`
- `packages/test-runner/src/index.test.ts`
- 如当前导出位置需要，`packages/test-runner/src/index.ts`

**实施步骤**：
1. 在 `decideDelivery()` 中删除 `onlyBdj` 的判定、`hardFailure` 对 `onlyBdj` 的引用，以及 `No valid HDMV entry is available for this release profile.` 理由。
2. `hardFailure` 保留为：`blockingChecks.length > 0 || failedDiagnostic || input.hasMissingRequiredAsset === true`。
3. 保留已有 `classifyDiagnostics()`、`notVerified`、`partialConditions`、`limitations` 的规则，不新增 `DeliveryProfile` 类型或其他交付状态推断器。
4. `exitCode` 保持 `status === "failed" ? 1 : 0`，只能由 `decideDelivery()` 计算。
5. 更新原来把 `declaredEntryCount:1, hdmvEntryCount:0` 判为 failed 的测试，而不是删除整个测试组。

**测试**：

| Case | 输入 | 预期 |
|---|---|---|
| D01 | 1 个 HDMV 入口，检查通过 | `complete/0` |
| D02 | 1 个 BD-J 入口、0 个 HDMV，检查通过 | `complete/0` |
| D03 | 1 个 BD-J、0 个 HDMV，存在非致命 error | `partial/0` |
| D04 | 纯 BD-J，`hasMissingRequiredAsset=true` | `failed/1` |
| D05 | HDMV，fatal diagnostic | `failed/1` |
| D06 | 已有 `not-verified` 检查，但无失败证据 | 保持现有 D-2R 判定 |

**结束标准**：不再把 HDMV 入口数量为 0 作为交付失败理由；原有其他判定语义不变。

## 2. T02：统一 CLI 构建结果输出

**修改文件**：
- `apps/cli/src/commands/build.ts`
- 新增 `apps/cli/src/commands/build-outcome.ts`
- 对应 CLI 构建测试

**接口**：

```ts
export interface BuildOutcome {
  status: "complete" | "partial" | "failed";
  exitCode: 0 | 1;
  output: string;
  launch?: string;
}

// 只输出，不计算状态
export function publishBuildOutcome(
  result: BuildOutcome,
  progress: ReturnType<typeof commandProgress>,
  details: ReadonlyArray<readonly [string, string]>,
): void;
```

`publishBuildOutcome()` 使用现有的 `progress.finish()`、stdout JSON 和 `process.exitCode`；函数实现留在 CLI 层，不放进 `package-builder`。

**实施步骤**：
1. 把纯 BD-J 分支中 `transaction.commit()` 后直接 `progress.finish()`、`process.stdout.write()`、`return` 的处理替换为 `publishBuildOutcome()`。
2. HDMV 分支正常完成后的同一套输出处理也改成调用该函数。传入的 `status/exitCode` 直接取 `decideDelivery()` 返回值。
3. 保持 `failMenuConversion()` 既有失败报告和事务行为，只把它最后设置输出/退出码的重复代码收敛到同一个出口。
4. 原 `reports.json` 与 `manifest.json` 继续使用相同的 `decision.status`。`packaged.diagnostics` 已有 warning 合并逻辑不改，不增加“状态变化时主动终止构建”的新分支。
5. `validate` 继续调用 `decideDelivery()`；如存在与旧纯 BD-J 失败假设直接绑定的测试，只更新该断言，不另写一套状态判定。

**测试**：纯 HDMV、纯 BD-J、混合入口分别断言 stdout `status`、manifest `status`、conversion report `status` 与退出码一致；构建失败仍按现有事务逻辑处理。特别检查纯 BD-J 不再出现报告成功但进程退出码沿用其他分支残留值的问题。

**结束标准**：正常构建的两条路径都通过 `publishBuildOutcome()` 退出，没有第二处手工拼接 stdout 和进程退出码。

## 3. T03：将 asset-manifest 作为 BD-J 运行时资源

**修改文件**：
- `packages/package-builder/src/build-menu-package.ts`
- `packages/test-runner/src/package-audit.ts`
- `packages/test-runner/src/package-audit.test.ts`
- `packages/package-builder/src/index.test.ts`

**依据**：`build-menu-package.ts` 生成 `asset-manifest.json`；`serve.ts` 在 `packagedMenuItems()` 读取它；`package-audit.ts` 的 `REPORT_FILES` 则将它排除在运行时清单之外。

**实施步骤**：
1. `build-menu-package.ts` 现有 `files` 数组中，在 `bdjRuntime` 为 `true` 时增加：
   ```ts
   { path: "asset-manifest.json", kind: "runtime-index", required: true }
   ```
2. 从文件预留排除逻辑中移除对 `asset-manifest.json` 的无条件过滤；`reports.json` 仍作为报告处理。
3. `package-audit.ts` 将 `asset-manifest.json` 对 `launchMode === "local-jvm"` 视为普通必需包内资源：必须存在、列入 `manifest.files`，且可用 JSON 解析。
4. 对既有 HDMV 包继续维持“该文件可不列入 manifest”的行为；不要要求 HDMV 旧包补充该清单。
5. 继续复用审计器已经实现的路径与文件存在性校验。该文件作为 JSON 数据索引处理，不作为 HTML/JS URL 引用扫描输入；不为索引单独新增嵌套资源扫描框架，也不遍历所有 BD-J 媒体项以猜测未来用途。

**测试**：新生成 local-jvm 包审计通过；删掉 index 审计失败；把 index 改为无效 JSON 审计失败；既有 HDMV 包不列该资源仍通过；`serve.ts` 对正常 index 的读取行为不变。

**结束标准**：local-jvm 的生成、消费、审计三方对 `asset-manifest.json` 的用途一致。

## 4. T04：将播放目标协议从 media-export 移到 core

**修改文件**：
- 新增 `packages/core/src/playback-targets.ts`
- `packages/core/package.json`、`packages/core/src/index.ts`（必要时增加导出）
- `packages/media-export/src/external-targets.ts`
- `packages/runtime-web/src/browser.ts`、`packages/runtime-web/src/bdmv-url.ts`
- `packages/runtime-web/package.json`
- `scripts/build-runtime-browser.mjs`
- 相关 `external-targets` 单测

**实施步骤**：
1. 把 `ExternalPlayItem`、`ExternalPlaylist`、`ExternalMediaTargets`、`ExternalPlayRequest`、`ExternalPlayTarget`、`EXTERNAL_UNKNOWN_CODES`、`isDeclaredExternalStreamPath()`、`resolveExternalPlayTarget()` 从 `media-export/src/external-targets.ts` 迁到 `core/src/playback-targets.ts`，函数逻辑不改。
2. 为消除反向依赖，在 core 同文件中定义 `PlaybackSourceLocation`，字段固定为：
   ```ts
   interface PlaybackSourceLocation {
     path: string;
     origin: "primary" | "backup";
     offset: string;
     instructionIndex?: number;
   }
   ```
   将 `MediaClosureRoute`、`MediaClosureUnknown` 的数据结构按 `media-export/src/closure.ts` 现有字段完整平移为 core 的 wire 类型；不从 core 引入 `bdmv-parser` 或 `media-export`。
3. `createExternalMediaTargets(disc, closure)` 留在 `media-export`，使用 core 的契约类型作为返回值。
4. `runtime-web` 两处引用改为 `@bdmv2web/core/playback-targets`；删除 runtime-web 对 media-export 的 package dependency。
5. 修改 browser bundle 脚本中针对旧 `media-export/external-targets` 路径的 alias，使其指向 core 新入口；不要保留第二份解析函数实现。
6. 迁移后的旧公开导出可以在 `media-export/src/external-targets.ts` 用 re-export 保留；只允许导出映射，不再复制类型或算法。

**测试**：原 `resolveExternalPlayTarget` 的 playlist、PlayItem、Mark、seek、无效时间范围测试均保持通过；runtime-web 能独立打包；`runtime-web/src` 不再 import `@bdmv2web/media-export`。

**结束标准**：运行时只依赖纯播放目标协议，不再依赖媒体转换模块。

## 5. T05：统一 RuntimeData 的 TypeScript 类型

**修改文件**：
- 新增 `packages/core/src/runtime-data.ts`
- `packages/package-builder/src/menu-package-input.ts`、`packages/package-builder/src/scripts.ts`、`packages/package-builder/src/build-menu-package.ts`
- `packages/runtime-web/src/browser.ts`、`packages/runtime-web/src/igs-adapter.ts`（必要的类型导出）
- 对应 TypeScript 类型测试

**具体设计**：
- 将 `igs-adapter.ts` 当前 `SerializedMenuState`、`SerializedMenuButton`、`SerializedMenuPage`、`SerializedScene` 的**纯数据字段结构**移入 `core/src/runtime-data.ts`；原位置改为 `export type { ... }`。
- `SerializedScene.source` 保持与当前 `IgsSource` 实际序列化字段一致，以 core 自身的同结构类型表示；不把 `igs` 引为 core 依赖。
- 在 core 中定义一份 `RuntimeDataV1<TVmProgram, TVmEntry, TExternalTargets, TMedia, TPgsTrack>`，字段覆盖当前 `browser.ts` 的 `PackageData` 以及 `bdj-runtime.ts` 的 `BdjPackageData` 的现有运行字段：`ir/title/scene/popupScenes/scenes/menuScenes/vmPrograms/vmEntries/profile/limits/externalTargets/media/menuMedia/sounds/inputConfig/bdjRuntime/bdjFiles/bdjHostApiPath/pgsTracks` 及现有导航辅助字段。**可选性与现有 `PackageData` 保持一致，不自造必填限制**。其中 `ir: DiscIR`、`scene: SerializedScene | null`、`profile?: PlayerProfile`、`limits?: Limits` 在 core 内直接定义；`vmPrograms?: TVmProgram[]`、`vmEntries?: TVmEntry[]`、`externalTargets?: TExternalTargets`、`media?: TMedia`、`menuMedia?: TMedia[]`、`pgsTracks?: TPgsTrack[]` 使用类型参数，避免 core 反向导入 hdmv、runtime-web、media-export。
- `PackageData` 改为 `type PackageData = RuntimeDataV1<VmProgram, NonNullable<VmOptions["entries"]>[number], ExternalMediaTargets, MenuLoopMediaPackage, unknown>`；`BdjPackageData` 改为从 `PackageData` 选取所需字段的 `Pick`/`Partial` 类型。`PackageData` 类型别名保留原对外导出名。
- `MenuPackageInput.scene/menuScenes[].scene/popupScenes[]` 中的 `unknown` 改为 `SerializedScene`（保持原允许的 `scene: null`）；`createDataScript()` 使用同一 DTO 类型。

**实施步骤**：
1. 迁移纯数据类型并更新 import；确保 `core` 不依赖 `igs/runtime-web/package-builder`。
2. 更新 `build-menu-package.ts` 的数据组装对象，使 TypeScript 能对其赋值为 `RuntimeDataV1`；不更改序列化字段名称或 JSON 内容。
3. `browser.ts` 使用从 core 导入的类型。保留现有 `validateEmbeddedDiscIR`、`normalizeScene` 以及 HTML data script 注入防护函数，不增加新的运行时整体校验入口。
4. 用类型测试确认 build 端输出字段可赋值、browser 端可消费、纯 BD-J `scene:null` 合法。

**结束标准**：RuntimeData 由 core 一处定义，生成端/消费端不再重复抄写相同字段；旧包格式保持不变。

## 6. T06：服务端一次发送权威 VM 状态与动作

**修改文件**：
- `apps/cli/src/commands/serve.ts`
- `packages/hdmv/src/virtual-machine/vm-types.ts`（只增加事件类型及必要导出）
- 新增 `apps/cli/src/shared/hdmv-session.ts`
- 服务端相关测试

**服务端事件数据结构（放在 `hdmv/src/virtual-machine/vm-types.ts`，从 HDMV 公共入口导出；core 不反向依赖 hdmv）**：

```ts
export interface HdmvUpdate {
  active: boolean;
  snapshot: VmSnapshot;
  actions: NavigationAction[];
  origin: "user" | "startup" | "system" | "authored";
}
```

其中 `VmSnapshot/NavigationAction` 继续采用现有 HDMV 类型；此事件只为现有 SSE 定义消息体，不建立新 RPC 框架。

**实施步骤**：
1. 把 `serve.ts` 内对 `hdmvVm` 的创建与使用收敛到 `HdmvSession`，提供 `snapshot()`、`selectTitle()`、`selectBdjTitle()`、`applyMenuContext()`、`handleEvent()`、`executeButtonProgram()` 和 `drainActions()`，各方法内部直接转发到现有 `HdmvVm`。
2. 保留现有 `/api/bdj/hdmv` 和 `/api/bdj/title` 请求 JSON 形状及响应码，不增加请求 ID、确认协议或额外 HTTP 端点。
3. 原来分别 `emit("hdmv-state")` 与 `emit("hdmv-actions")` 的位置，统一由一个函数 `emitHdmvUpdate(active, origin)` 获取当前 `snapshot()`、`drainActions()`，并发送 `emit("hdmv-update", ...)`。同一业务路径只调用一次 `drainActions()`；如果原 `navigation` 事件仍需动作数据，复用本次返回的 actions，不再次 drain。
4. Java 发起 TITLE_SEARCH、CLI `/api/bdj/title`、`/api/bdj/hdmv`、HDMV/BD-J 模式切换都调用该函数。**模式切换即使 `actions=[]` 也发更新**，以便浏览器获知唯一状态来源。
5. 在 `/api/bdj/events` 新连接初始化处，发送当前已存在的 `hdmv-update` 快照，初始化事件的 `actions` 固定为空数组。保留现有 session/frame/player 事件。
6. 原有 VM 对 `selectTitle`、寄存器、按钮命令和动作执行的算法不变。

**测试**：HDMV 标题切换发一次含 snapshot/actions 的事件；按钮请求产生权威快照与对应动作；BD-J 切换发 `active:false`；SSE 新连接获得当前状态；原事件的媒体与 Java 生命周期行为不变。

**结束标准**：HDMV 状态与动作由服务端同一事件发布，且 local-jvm 模式下 VM 只由服务端执行。

## 7. T07：浏览器改为本地/远端两种导航适配器

**修改文件**：
- 新增 `packages/runtime-web/src/navigation/local-host.ts`
- 新增 `packages/runtime-web/src/navigation/remote-host.ts`
- 新增 `packages/runtime-web/src/navigation/action-routing.ts`
- `packages/runtime-web/src/browser.ts`、`packages/runtime-web/src/bdj-runtime.ts`
- `packages/runtime-web/src/menu/menu-runtime.ts`（仅按钮返回值处理）
- 对应单测、浏览器测试

**职责**：

| 模块 | 应做的事 | 不应做的事 |
|---|---|---|
| `local-host.ts` | 包装当前 `HdmvVm`，提供原同步 `RuntimeVmPort` | HTTP/SSE |
| `remote-host.ts` | 向 `sendHdmv()` 发送现有 `context/event/button` 请求；保存 SSE 中的权威 snapshot | 创建 VM、写 PSR/GPR |
| `action-routing.ts` | 计算公共 Playlist/PlayItem/Mark 与场景定位结果 | 操作 DOM、执行播放器跳转 |
| `browser.ts` | 选择 host、处理画面和媒体副作用 | 重复执行 VM 状态决策 |

**同步按钮接口的最小调整**：当前 `RuntimeVmPort.executeButtonProgram()` 同步返回 `ButtonProgramResult`，而远端请求由异步 SSE 完成。仅扩展为：

```ts
export type MenuButtonExecution =
  | ButtonProgramResult
  | { kind: "pending" };

// RuntimeVmPort 内
executeButtonProgram?(
  commands: RawCommand[],
  context?: ButtonCommandContext,
): MenuButtonExecution;
```

`MenuController.handle("activate")` 遇到 `{kind:"pending"}` 时只保留当前按钮视觉状态，不立即调用 `dispatchActions()`；等 `hdmv-update` 到达时由浏览器执行服务端动作并更新 UI。本地返回结果仍走原代码。**不制作假 `ButtonProgramResult`，不额外设计 actionId、重放、超时重试或去重队列。**

**实施步骤**：
1. 将当前 `createMenuVm()` 的本地使用包入 `LocalNavigationHost`，保留纯 HDMV 的 `vm.reset()`、`snapshot()`、`drainActions()` 行为。
2. `RemoteNavigationHost` 仅用接收的 `HdmvUpdate.snapshot` 更新自己的快照。首次收到带 snapshot 的 `hdmv-update` 后才创建/启用远端 `MenuController`，因此不需要伪造初始寄存器。
3. `bdj-runtime.ts` 给 `BdjRuntimeCallbacks` 增加 `hdmvUpdate?: (update: HdmvUpdate)=>void`，监听 `hdmv-update`；请求端 `sendHdmv` 继续使用当前三类 JSON 消息。
4. `browser.ts` 的 `serverHdmvMode` 分支改为明确选择 `localHost` 或 `remoteHost`。对于 `data.bdjRuntime`，不要在客户端额外构造 `HdmvVm`，不要使用本地 `vm.snapshot()` 决定远端 UI，也不要直接调用 `vm.registers.systemWrite()`。
5. 收到远端 `hdmv-update`：先更新 host snapshot，再处理 `actions`，再更新菜单显示；`active:false` 时停用远端 HDMV 按钮控制器。
6. 把 `dispatchActions()` 和 `applyServerHdmvActions()` 里重复的 playlist/playItem/mark/scene 解析移到 `action-routing.ts`；保留本地播放桥接与远端 Java 操作各自的副作用实现。
7. 本地/远端标题切换分别调用对应 host：HDMV 纯离线模式由本地 VM 决定；local-jvm 模式由 `/api/bdj/title` 和服务端事件决定。

**测试**：

| Case | 断言 |
|---|---|
| N01 | HDMV 静态启动没有 HTTP/SSE，行为与原菜单一致 |
| N02 | BD-J 启动时浏览器不创建第二个 VM |
| N03 | 远端未收到快照前不执行 HDMV 按钮 |
| N04 | 按钮请求返回 pending，服务端事件到达才执行动作 |
| N05 | BD-J → HDMV → BD-J 状态以服务端事件为准 |
| N06 | `SET_STREAM` 不再由浏览器写本地 PSR |
| N07 | `PLAY_PLAYLIST_ITEM`、`PLAY_PLAYLIST_MARK` 保持正确媒体定位 |
| N08 | 同一用户点击在客户端只发送一次请求 |

**结束标准**：浏览器不再出现“远端转发命令 + 本地返回 VM 快照”的组合；本地 HDMV 的纯静态能力保持。

## 8. T08：把构建编排从 build 命令中移到应用层

**修改文件**：
- 新增 `apps/cli/src/application/build-use-case.ts`
- 新增 `apps/cli/src/application/build-plan.ts`
- `apps/cli/src/commands/build.ts`、必要的现有 `menu-planning.ts`
- 对应 CLI 与应用层测试

**固定职责**：

```
apps/cli/src/commands/build.ts             参数、进度、事务、stdout、退出码
apps/cli/src/application/build-use-case.ts  从 ParsedDisc 到打包输入的唯一编排
apps/cli/src/application/build-plan.ts      应用层 BuildPlan 类型
packages/package-builder                   按输入写出静态包（T09 后不编码）
```

**实施步骤**：
1. 将 `build.ts` 中提取后的重复领域运算移到 `planBuild()`，包含：BD-J 资源收集结果的引用、IGS 场景选择、菜单场景复用 Map、媒体闭包、外部播放目标、VM 程序、媒体输入数组与诊断集合。
2. `planBuild()` 返回一个 `BuildPlan`，字段直接采用现有 `MenuPackageInput` 已定义的数据结构；不新设无实际字段用途的通用框架。BuildPlan 的 profile 只用于决定 `hdmv/bdj/mixed` 的字段组合，**不参与 `decideDelivery()` 规则推断**。
3. 保留纯 HDMV 和包含 BD-J 两种必要的场景选择分支，但最终都调用同一个 `buildUseCase()` 返回最终 `MenuPackageInput`，而不是在分支中各写一份很长的 `buildMenuPackage({...})`。
4. `build.ts` 只负责现有参数读取、进度映射、`beginOutputTransaction/commit`、生成报告、`publishBuildOutcome`。`buildUseCase()` 不写 stdout、不设置 `process.exitCode`。
5. 保留原来的 `--resume`/`--reuse`、媒体范围 (`none/auto/all`)、多 PlayItem 场景复用与编码选项；调用链顺序不因重构改变。

**测试**：同输入相同场景/媒体规划；纯 HDMV、BD-J、mixed 的生成数据完整；999 PlayItem 共用场景的适配复用不丢失；`--menu-media` 不同行为不变；生成的关键文件路径不变；CLI 结果出口仍一致。

**结束标准**：`build.ts` 不再各自拼接两份 `MenuPackageInput`，领域编排只在应用层维护。

## 9. T09：将媒体导出从组包函数剥离

**修改文件**：
- 新增 `packages/media-export/src/menu-media-layout.ts`
- 新增 `packages/media-export/src/export-menu-media.ts`
- 新增 `apps/cli/src/application/export-menu-media.ts`（应用层薄编排）
- `apps/cli/src/application/build-use-case.ts`
- `packages/package-builder/src/menu-package-input.ts`
- `packages/package-builder/src/build-menu-package.ts`
- `packages/media-export/src/index.ts`、必要时 `packages/package-builder/src/index.ts` 与相关测试

**约定接口**：

```ts
export interface PreparedMenuMedia {
  primary?: {
    input: MenuLoopMediaInput;
    result: MenuLoopMediaResult;
    planPath: string;
  };
  additional: Array<{
    input: MenuLoopMediaInput;
    result: MenuLoopMediaResult;
    planPath: string;
  }>;
}

export async function assembleMenuPackage(
  input: MenuPackageInput & { preparedMedia: PreparedMenuMedia },
): Promise<MenuPackageResult>;
```

**实施步骤**：
1. 将 `menuMediaPaths()`、`priorMenuMediaPaths()` 的**原实现**搬到 `media-export/src/menu-media-layout.ts`，原 `package-builder` 出口仅 re-export，以保留现有导入路径。路径命名规则只有这一份。
2. 把现有 `sourceProbeCache`、`exportMenuLoopMedia()`、primary/additional 的编码循环和复用处理搬入 `media-export/src/export-menu-media.ts`，公开 `exportMenuMedia()` 返回 `PreparedMenuMedia`。该函数只负责媒体转换，不引用 `package-builder` 或 CLI。
3. `apps/cli/src/application/export-menu-media.ts` 调用 `@bdmv2web/media-export` 的 `exportMenuMedia()` 并映射现有进度回调；不复制编码算法。
4. `assembleMenuPackage()` 只消费 `PreparedMenuMedia`，完成资源写入、`runtime/disc-data.js`、`asset-manifest.json`、`manifest.json`、`reports.json` 和静态 bundle。核心组包函数不再调用 FFmpeg 或 `exportMenuLoopMedia()`。
5. 在 `buildUseCase()` 中固定调用顺序：`planBuild → exportMenuMedia → assembleMenuPackage → report`，现有媒体进度回调继续传递给 CLI。
6. 既有公开 `buildMenuPackage(input)` 如仍有调用者，保留为 package-builder 的薄包装，**从 media-export 导入同一个 `exportMenuMedia()`，随后调用 `assembleMenuPackage()`**。不得从 package-builder 导入 `apps/cli`，不得保留第二份编码循环。
7. 保持文件命名、媒体复用、`reuse/resume`、音轨、时间戳和媒体计划记录原样。不要以新层次为由改变转码参数。

**测试**：单个 PlayItem 只编码一次；共享媒体仍复用；`--menu-media none` 不执行编码；resume/reuse 沿用原有路径；纯组包测试传入 `PreparedMenuMedia` 不启动 FFmpeg；生成的 `asset-manifest`、`media-plans/`、`assets/media/` 路径与重构前相同。

**结束标准**：媒体编码决策由应用层调用媒体导出模块执行；组包逻辑不持有转码进程和策略。

## 10. 总体验收

执行仓库已经定义的命令（在项目要求的 Node/pnpm 环境下）：

```bash
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

**仅需验证与本次变更直接相关的九项成果**：

1. 纯 BD-J 不再被“无 HDMV 入口”规则直接判 failed；其他 failed/partial/complete 规则保持。
2. CLI stdout、报告、manifest 与退出码一致。
3. local-jvm 的 `asset-manifest.json` 被正确记录和审计；HDMV 旧包兼容。
4. `runtime-web` 不再依赖 `media-export` 的纯播放解析器。
5. RuntimeData 类型仅由 core 管理，生成格式不变。
6. 服务端一次事件携带远端 VM 权威 snapshot + actions。
7. 浏览器 local-jvm 不使用第二个 VM 快照、不写本地寄存器。
8. `build.ts` 不维护两套重复的业务组包参数。
9. `assembleMenuPackage()` 不负责执行转码。

测试未运行的项目只写 `未执行`，不补造输出。实际业务错误按正常编码任务修复；不要为可能发生但未观察到的情况附加新降级路径、额外断言或拦截层。

## 11. 给 Luna 6 的执行提示词

```text
请在当前 bdmv2web 仓库中实施附带文档《bdmv2web 架构整改实施任务书（简化确定版）》中的指定任务。

本轮任务编号：T01

严格使用文档列出的文件、接口、修改步骤与验收条件，不重新设计架构，不顺手扩展到下一项任务。不做基线冻结、文件摘要、风险预判、前置检查器或额外架构守卫。保留项目现有安全检查和构建事务行为，但不新增与目标无关的预防性处理。

执行顺序：修改相关测试 → 修改生产代码 → 运行该任务相关测试 → 运行项目 build/typecheck/lint/test。

完成后只报告：修改文件、实现变化、测试结果、剩余确实存在的阻碍。完成当前任务即停止。
```

后续按任务编号将提示词中的 `T01` 替换为 `T02` 至 `T09`。同一模型无需重新开展全局架构评估。

## 实施进度（2026-11-15）

> 按 T01 → T09 顺序实施。以下“验证”列出实际运行过的命令与结果。

| 任务 | 状态 | 主要改动 |
| --- | --- | --- |
| T01 | 完成 | `decideDelivery()` 的失败事实为 fail 检查、fatal 诊断与缺必需资产；纯 BD-J 测试按 `complete` 断言。 |
| T02 | 完成 | 新增 `commands/build-outcome.ts` 的 `publishBuildOutcome()`；HDMV、BD-J/mixed、失败路径统一出口；纯 BD-J 设置 `decision.exitCode`。 |
| T03 | 完成 | local-jvm 包的 `asset-manifest.json` 以 `kind: "runtime-index"` 列入 `manifest.files`；审计要求存在、列入、可解析 JSON；HDMV 包的 `manifest.files` 可省略该条目。 |
| T04 | 完成 | 播放目标协议迁入 `core/src/playback-targets.ts`；`media-export` 保留 re-export 与 `createExternalMediaTargets`；`runtime-web` 从 core 导入，media-export 为 devDependency。 |
| T05 | 完成 | 新增 `core/src/runtime-data.ts`（`RuntimeDataV1` 与 `Serialized*`）；`PackageData`/`BdjPackageData` 由 core 类型派生；`MenuPackageInput.scene` 等改为 `SerializedScene`。 |
| T06 | 完成 | 新增 `shared/hdmv-session.ts` 与 `HdmvUpdate`；`serve.ts` 统一 `emitHdmvUpdate()`，SSE 新连接发送当前快照；测试改断言 `hdmv-update`。 |
| T07 | 完成 | 新增 `navigation/local-host.ts`、`remote-host.ts`、`action-routing.ts`；`MenuButtonExecution` 支持 `{kind:"pending"}`；BD-J 页面通过 `RemoteNavigationHost` 获取状态与动作；`hdmvUpdate` 回调驱动远端菜单。 |
| T08 | 完成 | 新增 `application/build-plan.ts` 的 `planBuild()` 与 `application/build-use-case.ts`；`build.ts` 负责参数、进度、事务、报告与结果发布。 |
| T09 | 完成 | 新增 `media-export/src/menu-media-layout.ts`、`export-menu-media.ts`；`assembleMenuPackage()` 消费 `PreparedMenuMedia` 写出静态包；`buildMenuPackage()` 为兼容包装；CLI 固定 `planBuild → exportMenuMedia → assembleMenuPackage`。 |

### 验证

- `corepack pnpm build`：通过。
- `corepack pnpm typecheck`：通过（全部 workspace 包与 CLI）。
- `corepack pnpm lint`：通过（含 Java 122 个源文件）。
- `corepack pnpm test`：退出码 0；bench 测试 52 通过、1 跳过。相关包定向结果：core 24、test-runner 55、media-export 122（1 跳过）、package-builder 22、runtime-web 159、CLI 186。

### 未执行

- 未在真实 BD-J 盘或真实浏览器中做人工验收；本轮验证为合成/夹具盘上的自动测试。
- 未在 CI 中运行；以上结果来自本地工作区。
