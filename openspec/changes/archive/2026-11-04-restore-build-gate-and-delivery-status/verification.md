# Verification record

本文件记录本 change 各任务的实测证据。每次记录都写明命令原文、退出码与关键输出，便于事后对比。测量环境：Node `24.18.0`、pnpm `11.25.0`、TypeScript `5.9.3`、Vitest `4.0.8`（与 `docs/guides/development.md` 的 pinned toolchain 一致）。

## 门禁失败快照（任务 0.2，修复前）

采集于 `master@614b4fe`，`dist/` 已存在的脏状态下：

### 1) `corepack pnpm -r --no-bail build` → exit 1

失败包 2 个：

| 包 | 位置 | 错误码 |
| --- | --- | --- |
| `@bdmv2web/test-runner` | `src/index.test.ts(165,1)`、`(165,2)` | `TS1128: Declaration or statement expected.` |
| `@bdmv2web/runtime-web` | `src/igs-adapter.test.ts(14,17)` | `TS2741: Property 'numericSelectValue' is missing ... but required in type 'IgsButton'.` |

（`pnpm -r build` 不带 `--no-bail` 时会在 test-runner 处停止，只能看到 1 个失败包；用 `--no-bail` 才能看全。）

### 2) `corepack pnpm -r --no-bail typecheck` → exit 1

首个失败包为 `@bdmv2web/test-runner`（同上 `TS1128`），第二个为 `@bdmv2web/runtime-web`（同上 `TS2741`）。

### 3) `corepack pnpm --filter @bdmv2web/test-runner test` → exit 1

```
FAIL  src/index.test.ts [ src/index.test.ts ]
packages/test-runner/src/index.test.ts:109:20: ERROR: "await" can only be used inside an "async" function
 Test Files  1 failed | 4 passed (5)
      Tests  21 passed (21)
```

`src/index.test.ts` 因语法错误整文件无法收集，该文件 20 条用例全部未执行（41 = 21 已执行 + 20 未执行）。

**与 `tasks.md` 0.2 参考值的差异（以实测为准）**：任务里写的 `Test Files 2 failed | 8 passed (10)` / `42 passed` 是在 `test` 脚本为 `vitest run`（无路径参数）时测得的——那种写法会同时匹配 `src/*.test.ts` 与 `dist/*.test.js`，同一用例被算两遍。当前仓库的 `test` 脚本是 `vitest run src`，只收集 `src`，故实测为 `1 failed | 4 passed (5)`。清理并重建 `dist` 后（任务 1.3）该差异消失，两者不再互相干扰。

## 阶段一：恢复门禁（任务 1.1、1.2）

### 1.1 `packages/test-runner/src/index.test.ts`

删除第 109–118 行的重复块后：

```
$ corepack pnpm --filter @bdmv2web/test-runner typecheck
（无输出，退出 0）

$ corepack pnpm --filter @bdmv2web/test-runner test
 Test Files  5 passed (5)
      Tests  41 passed (41)
```

日志中不再出现 `"await" can only be used inside an "async" function`。

### 1.2 `packages/runtime-web/src/igs-adapter.test.ts`

补 `numericSelectValue: 11` 后 typecheck 仍失败，暴露同一夹具的第二个缺口：

```
src/igs-adapter.test.ts(8,9): error TS2741: Property 'frameRateCode' is missing in type ... but required in type 'IgsScene'.
```

这是同一类「夹具未跟随 `IgsScene` 契约」的问题（TS 在嵌套字面量报错时会抑制外层缺失属性诊断，所以修复前只看到 `numericSelectValue` 一条）。按同样口径补齐：`frameRateCode: 1`，取值依据 `packages/igs/src/igs.ts:212`（ICS 视频描述符高 4 位）与 `packages/igs/test/real-igs.test.ts:22` 对 1920×1080 的断言。**没有**放宽 `IgsScene` 类型。

```
$ corepack pnpm --filter @bdmv2web/runtime-web typecheck
（无输出，退出 0）

$ corepack pnpm --filter @bdmv2web/runtime-web test
 Test Files  9 passed (9)
      Tests  91 passed (91)
```

`igs-adapter` 用例仍断言按钮 id/坐标/三态，未被削弱。

## 阶段二：作用域与测试入口（任务 1.3、2.1–2.5、3.1–3.4）

### 1.3 清理并重建产物

清理前实测（`find packages apps -path "*/dist/*" -name "*.test.*" | wc -l`）= `70`。

```
$ rm -rf packages/*/dist apps/*/dist && corepack pnpm build
build_exit=0
$ find packages apps -path "*/dist/*" -name "*.test.*" | wc -l
0
$ ls packages/core/dist | grep -E "^(index|browser)\.js$"
browser.js
index.js
```

### 2.1 / 2.2 `tsconfig.build.json`

11 个包（10 个 `packages/*` + `apps/cli`）逐个用 `node -e` 读取断言：`extends === "./tsconfig.json"`、`exclude` 含 `**/*.test.ts` 与 `**/*.test-d.ts` → `11 / 11`。`build` 脚本改为 `tsc -p tsconfig.build.json`，`packages/core` 保留第二步 `node ../../scripts/build-core-browser.mjs`；`corepack pnpm -r build` 全通过，`packages/core/dist/` 同时有 `index.js` 与 `browser.js`。

### 2.3 test 里的类型错误

在 `packages/runtime-web/src/igs-adapter.test.ts` 末尾临时加入 `const __typecheck_probe: number = "";`：

```
$ corepack pnpm --filter @bdmv2web/runtime-web typecheck
src/igs-adapter.test.ts(121,7): error TS2322: Type 'string' is not assignable to type 'number'.
Exit status 2
$ corepack pnpm --filter @bdmv2web/runtime-web build
$ tsc -p tsconfig.build.json     # 退出 0
```

删除探针后两者恢复通过（`typecheck` 无输出、`build` 退出 0）。

### 2.4 `runtime-web/src` 的保留

`grep -rn "runtime-web/src/browser.ts" packages/package-builder/src/index.ts` 命中第 129 行；已在同一处留注释说明该源码路径耦合将在第 2 批 D7 移除。`corepack pnpm --filter @bdmv2web/package-builder build` 通过。

### 2.5 发布内容

`npm pack --dry-run` 中匹配 `src/|*.test.*` 的行数：`core` = 0、`test-runner` = 0、`apps/cli` = 0。为此给 `@bdmv2web/test-runner` 与 `@bdmv2web/cli` 补了 `"files": ["dist"]`（此前会把 `src/` 与 `*.test.ts` 一起发布）。

### 3.1 / 3.2 测试入口

- 11 个包均有 `vitest.config.ts`，`include` 与测试目录一致：`packages/igs` 为 `["test/**/*.test.ts"]`，其余 10 个为 `["src/**/*.test.ts"]`（`hdmv`、`test-runner` 为新增；`runtime-web`、`package-builder` 补上了缺失的 `include`）。
- `grep -h '"test"' packages/*/package.json apps/cli/package.json` 的 11 个取值全为 `vitest run`。

### 3.3 / 3.4 聚合 = 逐包

`corepack pnpm test:all`（退出 0）与逐包 `--filter` 各跑一次，逐包一致：

| 包 | 聚合 | 逐包 |
| --- | ---: | ---: |
| core | 14 | 14 |
| bdmv-io | 7 | 7 |
| bdmv-parser | 47 | 47 |
| igs | 54 | 54 |
| hdmv | 74 | 74 |
| media-export | 51 passed + 1 skipped | 51 passed + 1 skipped |
| runtime-web | 91 | 91 |
| package-builder | 9 | 9 |
| test-fixtures | 5 | 5 |
| test-runner | 50 | 50 |
| cli | 25 | 25 |

合计 427 passed + 1 skipped，日志中无 `No test files found`。

**与 0.1 参考值的差异**：`package-builder` 参考值 18 = 2×9，是 `dist` 与 `src` 同时被收集时的重复计数；重测值 9 为源码口径。`test-runner` 41→50、`cli` 20→25 是本 change 新增用例（`classifyDiagnostics`/`decideStageOutcome`/`mode` 断言、阶段与参数契约、`--player-profile`）。

**计数说明**：上表与合计 427 是本节测量时（复评修复前）的数字，保留为当时的实测记录。复评修复新增 5 条用例后，当前口径为 runtime-web 92、package-builder 10、cli 28，合计 **432 passed + 1 skipped**，以「评审修复（独立复评第 2 轮）」一节和 `docs/guides/development.md` 基线表为准。

**`--no-bail` 的实际语义**：在某叶子包（`apps/cli`）植入失败用例时，其余 10 个包全部执行；在 `packages/core` 植入失败时，pnpm 按拓扑顺序跳过依赖它的包（只跑了 core 与 test-runner）。这是 pnpm 的依赖顺序保护，不是 `--no-bail` 失效；`docs/guides/development.md` 的基线表与聚合命令不受影响。

## 阶段三：CLI 阶段状态与退出码（任务 4.1–4.6）

### 4.1 / 4.2 分类与阶段判定

`classifyDiagnostics` 把 `fatal`/`error` 归为阻断项并单列 `hasFatal`；`decideDelivery` 改为调用它，不再自行遍历 severity，行为除 5.3 的 mode 变化外不变。`decideStageOutcome` 独立导出：

| 输入 | 状态 | 退出码 |
| --- | --- | --- |
| `fatal` | `failed` | 1（strict 也是 1） |
| `error` | `partial` | 0 / strict 2 |
| 已认可 `error` | `partial` | 0（不因认可而升级为 complete） |
| 无诊断 | `complete` | 0 |

`StageStatus` 与 `DeliveryStatus` 各自带一个编译期品牌（`unique symbol` 幻影属性），品牌只在类型层，运行时值仍是普通字符串。`packages/test-runner/src/index.test.ts` 对两个方向各放一条 `@ts-expect-error`，`pnpm typecheck` 通过即证明两条指令都被真实类型错误消耗（若某方向合法，TS 会报 unused `@ts-expect-error`），因此「两者不可互相赋值」按任务原文成立。

品牌没有扩散到公开 JSON：`DeliveryDecision.status` / `ReleaseSummary.release.status` 只是承载品牌类型，`JSON.stringify` 输出仍是 `"complete" | "partial" | "failed"` 字符串；构造点收敛在 `decisions.ts` 的 `deliveryStatus()` 一个函数里。

### 4.3 `extract` 与 fatal

```
$ mkdir -p /tmp/bdmv-empty/BDMV
$ node apps/cli/dist/index.js extract /tmp/bdmv-empty/BDMV --out /tmp/bdmv-empty-out
{"status":"failed","code":"BDMV_REQUIRED_FILE_MISSING","diagnostics":[...]}
extract_exit=1
$ ls -d /tmp/bdmv-empty-out
（不存在）
```

`extract` 现在先跑 IGS 提取、再判定阶段结果，`failed` 时不 `beginOutputTransaction`。成功路径的 manifest 与 stdout 字段由 `status` 改为 `stageStatus`（交付结论只留在 `convert`/`validate` 的 `status`），对应 CLI 测试同步更新。

### 4.4 `inspect` 默认与 `--allow-partial`

```
$ node apps/cli/dist/index.js inspect /tmp/bdmv-empty/BDMV            → exit 1，stdout {"status":"failed","code":"BDMV_REQUIRED_FILE_MISSING",...}
$ node apps/cli/dist/index.js inspect /tmp/bdmv-empty/BDMV --allow-partial → exit 0，JSON.stageStatus = "failed"
```

### 4.5 `convert` 改走 `decideDelivery`

- fatal 输入：`convert /tmp/bdmv-empty/BDMV --out /tmp/fatal-out` → `{"status":"failed","code":"BDMV_REQUIRED_FILE_MISSING"}`、exit 1、`/tmp/fatal-out` 未创建。
- 现有样本 `test-data/bdmv/tamako-love-story-bd`：`convert … --out /tmp/menu-ok` → exit 0，产物结构不变（`manifest.json` / `compatibility.json` / `runtime/*` 齐备）。
- 无 Top Menu 的样本仍 `failed`（既有用例 `MENU_SCENE_NOT_FOUND` / `MENU_PLAYLIST_NOT_RESOLVED` / `MENU_SCENE_AMBIGUOUS` 全部保持通过）。

`report.json` 现在在成功路径也会写出（`status`、`mode`、`reasons`、`diagnostics`、`blockingDiagnostics`）。审计侧同步把 `report.json` 归入报告文件，否则它会被当成未列入 manifest 的载荷而让 `validate` 失败。

### 4.6 strict 下的审阅包

```
$ node apps/cli/dist/index.js convert "test-data/bdmv/tamako-love-story-bd" --strict --out /tmp/menu-strict
{"status":"partial","mode":"menu-only","output":"/private/tmp/menu-strict"}
strict_exit=2
$ report.json: status=partial、mode=menu-only、blockingDiagnostics=37（首条 {"severity":"error","code":"BDMV_MISSING_STREAM",...}）
```

目录存在、`status: "partial"`、至少一条 `blockingDiagnostics`、进程退 2 —— 四项全部满足。

## 阶段四：单一产物形态与参数契约（任务 5.1–5.6）

| 任务 | 命令 | 实测 |
| --- | --- | --- |
| 5.1 | `convert … --mode standalone-full --out /tmp/mode-reject` | exit 1、stderr `CLI_UNSUPPORTED_MODE`、`/tmp/mode-reject` 未创建 |
| 5.2 | `convert "test-data/bdmv/tamako-love-story-bd" --out /tmp/menu-ok` | exit 0、stdout `status=partial mode=menu-only`、`manifest.mode=menu-only` |
| 5.3 | `decideDelivery` | 删除 `mode === "menu-only"` 条件；`mode` 只作记录字段；`index.test.ts` 与 `release-summary.test.ts` 改为「无缺口 complete / 有缺口 partial」 |
| 5.4 | `inspect … --out`、`convert … --mode` | 两条均 exit 1、stderr `CLI_MISSING_VALUE`、stdout 为空 |
| 5.5 | 两份不同 `menuLanguage` 的 profile | `manifest.profile.menuLanguage` 分别为 `eng` / `jpn`；profile 文件缺失或非法 JSON → exit 1、`CLI_INVALID_PROFILE`、不建输出目录 |
| 5.6 | `convert … --limits /tmp/limits.json` | exit 1、stderr 含 `CLI_NOT_IMPLEMENTED`，不含 `CLI_UNSUPPORTED_MODE` |

`--player-profile` 的接线：读取 → 校验（六个字符串字段 + `region ∈ {A,B,C}` + `outputProfile === "portable"` + 两个字符串数组）→ 传入 `HdmvVm` 的 `profile` 与 `buildMenuPackage`，并写入产物 `manifest.json` 的 `profile` 字段。`--mode`、`--limits`、profile 三项检查都在 `parseBdmv` 与 `beginOutputTransaction` 之前完成。

## 阶段五：文档与仓库卫生（任务 6.1–6.7、0.1、1.5、1.6）

- **0.1** `docs/guides/development.md` 新增「Test baseline」表（11 行 + 合计 427/1 skipped），带测量日期、per-package 命令与参考值差异说明。
- **6.1** 新增「CLI status」表：`inspect`/`extract`/`convert`/`validate` 已实现、`compare` 未实现、`convert` 仅 `menu-only`；不再有「五个命令都返回 `E_NOT_IMPLEMENTED`」的表述。
- **6.2** 三处统一为「已完成 macOS Chrome `file://` 实测，证据未绑定制品指纹」，并都指向 `M6-release-verification.md#v1-chrome-file-evidence`；`docs/guides/browser-matrix.md` 不再出现 `not-verified`。未改动任何 tasks 勾选状态。
- **6.3** `docs/support/igs-support.md` 的 Tamako 结论改为：包 partial 的原因是 Clip 00043 缺失；`0xffff`/`0xfffe` 已确立为「无选择 / 激活当前选择」哨兵，因此场景保持 `complete: true` 且不产生 `IGS_INVALID_BUTTON_REFERENCE`，与 `packages/igs/test/tamako-real-smoke.test.ts` 的断言一致。
- **6.4** M6 的计数替换为 7/47/54/74/50，并注明测量日期、命令与旧计数失效原因。
- **6.5** 架构文档的旧包布局与旧 `DiscIR` 形状都加了「历史设计」标注，并补「设计名 → 实际位置」映射表（`apps/studio` 标注未实施）。
- **6.6** `.gitignore` 增加 `.DS_Store` 与 `**/.DS_Store`；`touch packages/core/.DS_Store` 后 `git status --short` 无相关条目。
- **6.7** `docs/guides/development.md` 记录大二进制策略与两个既存大文件（11.0 MB / 8.5 MB，实测 `git ls-tree` 口径）。
- **1.5** `docs/guides/development.md` 的「Build gate」小节记录：门禁目前靠人工执行 `scripts/ci.sh`，流水线属后续独立 change，仓库不含 `.github/`。
- **1.6** `scripts/ci.sh`（可执行）依次执行 `install --frozen-lockfile` → `generate:contracts` → `-r build` → `-r typecheck` → `test:all`，逐步打印命令与耗时，失败即停。干净工作区 `bash scripts/ci.sh` → exit 0（install 3s / contracts 2s / build 18s / typecheck 24s / test 113s）；在 `packages/bdmv-io/src/index.ts` 植入类型错误后 → `build` 步骤 exit 2，脚本在 `Gate failed at: pnpm -r build` 处结束，后续步骤未执行。

## 整体验收（任务 7.1–7.5）

- **7.1** `corepack pnpm generate:contracts && corepack pnpm build && corepack pnpm typecheck && corepack pnpm test:all` → 退出码 0，日志无 `No test files found`，无 `Failed`。
- **7.2** `find packages apps -path "*/dist/*" -name "*.test.*" | wc -l` = 0；`-name "*.test.d.ts"` 亦为 0。
- **7.3** 四条行为同一轮复现：`extract=1`（且 `/tmp/bdmv-empty-out` 不存在）、`convert=0`（`/tmp/menu-ok` 生成）、`mode=1`（`/tmp/mode-reject` 不存在）、`missing=1`。
- **7.4** 文档一致性：0.1 基线表、6.1 CLI 状态、6.2 Chrome 表述、6.3 Tamako 结论、6.4 M6 计数、6.5 架构映射逐条对照通过，证据见上。
- **7.5** `git diff --stat` 共 29 个已跟踪文件改动 + 15 个新增文件，不含 `.github/`、不含性能改造、不含 `vm.ts` 常量收敛。

## 评审修复（独立复评第 2 轮）

上一版实现通过了门禁，但复评指出四个契约缺口与一处验收口径问题，均已修复并补测：

- **[P1] `--player-profile` 未进入交付包的浏览器 VM**。`packages/package-builder/src/index.ts` 把 profile 写入 `runtime/disc-data.js` 的 `PackageData`（此前只落 `manifest.json`）；`packages/runtime-web/src/browser.ts` 新增并导出 `createMenuVm(data, onTrace)`，把 `data.profile` 作为 `VmOptions.profile` 传给 `HdmvVm`，`boot()` 改用它。实测：`node apps/cli/dist/index.js convert test-data/bdmv/tamako-love-story-bd --player-profile /tmp/profile-jpn.json --out /tmp/menu-profile` → exit 0，`disc-data.js` 含 `"profile":{"menuLanguage":"jpn",…,"country":"JP","region":"A"}`，`manifest.profile` 一致。测试覆盖到 PSR 而非清单字段：`runtime-web` 断言 PSR16/17/18/19/20 解码为 `fre/ger/jpn/JP/1`，并断言无 profile 时回落到 VM 自身默认 `eng/eng/US/1`（这正是原缺口造成的差异）；`package-builder` 断言 `disc-data.js` 与 `manifest.json` 同时携带 profile；`cli` 端到端断言 `disc-data.js` 含 `"profile":{"menuLanguage":"jpn"`。
- **[P2] `--title` 缺值遗留 staging 目录**。`convert` 现在在解析输入、创建事务之前一次性解析全部选项（`--mode`/`--limits`/`--player-profile`/`--out`/`--title`），并把事务开启后的所有语句收进同一个 `try/catch`，任何失败都走 `abort()`（`commit()` 后 `abort()` 因 `closed` 标记为空操作）。实测 `convert /tmp/argcheck/BDMV --out /tmp/argcheck/out --title` → `CLI_MISSING_VALUE`、exit 1、`/tmp/argcheck` 下无 `.staging-` 目录；`cli` 测试用合成盘复现同一命令并断言无残留。
- **[P2] `--flag=` 空值未按缺值拒绝**。`lookupOption` 把内联空值（`--out=`）视为无值，`optionValue` 因此统一抛 `CLI_MISSING_VALUE`。实测 `inspect … --out=` 不再把碟片 JSON 写到 stdout，`convert … --mode=` 不再落到 `CLI_UNSUPPORTED_MODE`。
- **[P2] `--limits` 绕过缺值检查**。改为先 `optionValue("--limits")`（裸写即 `CLI_MISSING_VALUE`），仅在确有值时抛 `CLI_NOT_IMPLEMENTED`。实测 `convert … --limits` → `CLI_MISSING_VALUE`。
- **参数校验顺序**同样被 `cli` 测试锁定：空盘 `convert … --out` 报 `CLI_MISSING_VALUE` 而非 `BDMV_REQUIRED_FILE_MISSING`，证明选项值在解析输入之前校验。

### 4.2 双向不可赋值（已按原验收条件实现）

评审指出原实现只做到单向，且不应在保留原验收条件的情况下按 41/41 归档。本轮改为**真正实现双向**，而不是调整验收口径：

- `packages/test-runner/src/types.ts` 给 `DeliveryStatus` 加编译期品牌位（`unique symbol` 幻影属性），品牌只在类型层，运行时仍是普通字符串，`validate` 与 `report.json` 的 JSON 输出不受影响。
- `decisions.ts` 新增唯一的窄化点 `deliveryStatus()`，`decideDelivery` 的返回值经它构造；`StageStatus` 保留自己的品牌，两者品牌不同，因此两个方向都不成立。
- `index.test.ts`「keeps delivery status and stage status mutually unassignable」对两个方向各放一条 `@ts-expect-error`。`pnpm typecheck` 通过即证明两条指令都被真实类型错误消耗（否则 TS 会报 unused `@ts-expect-error`），也就是双向拦截确实生效。
- `tasks.md:56` 的验收口径已恢复为「双向不可赋值」，不再需要记录「已知偏差 + 批准」。

### 本轮门禁与计数

- `generate:contracts → build → typecheck → test:all` 四步退出码 0；`find packages apps -path "*/dist/*" -name "*.test.*" | wc -l` = 0。
- 逐包用例：core 14、bdmv-io 7、bdmv-parser 47、igs 54、hdmv 74、media-export 51+1 skipped、runtime-web 92、package-builder 10、test-fixtures 5、test-runner 50、cli 28，合计 **432 passed + 1 skipped**（较上一版 +5：runtime-web +1、package-builder +1、cli +3）。`docs/guides/development.md` 基线表已同步。

## 记录口径说明

- 所有命令在 Node `24.18.0` / pnpm `11.25.0` 下执行。本机 shell 默认 `node` 为 v22（`node -v` = 22.22.2），而 `engines` 要求 `>=24.18.0 <25`，故门禁命令统一把 `~/.nvm/versions/node/v24.18.0/bin` 放到 PATH 前面。
- 该环境下 `pnpm` 未安装为独立可执行文件（只有 `corepack pnpm` 可用），而根 `package.json` 的脚本内部会调用 `pnpm`，因此用一个临时的 `pnpm → corepack pnpm` shim 目录满足脚本内部调用。这是环境差异，不涉及仓库改动。


