# Tasks

对应决策：D1（P0 修复，CI 单独立项）、D2（构建/测试配置拆分）、D4（convert 单一形态）、D8（文档与仓库卫生）、D10（失败状态与退出码）。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现与所列验收命令的输出；不得只勾"已改代码"。决策与证据来源见 [`docs/code-review.md`](../../../docs/code-review.md)。

## 0. 基线记录

- [x] 0.1 在 `docs/development.md` 增加"测试基线"表，逐包记录用例数。参考值（清理 `dist` 后的源码口径，执行时需重测并覆盖）：core 14、bdmv-io 7、bdmv-parser 47、igs 54、hdmv 74、media-export 51+1 skipped、runtime-web 91、package-builder 18、test-fixtures 5、test-runner **41（5 个测试文件）**、cli 20。
  
  **test-runner 的计数必须按"清理 dist 后"的口径记录**：当前 `vitest run` 会同时匹配 `src/*.test.ts` 与 `dist/*.test.js`，同一用例被算两遍（实测 `2 failed | 8 passed (10) / 42 passed`）。删除 `dist` 测试产物并修好 1.1 后为 `5 passed (5) / 41 passed`。若基线表写成清理前的数字，后续所有比对都会偏移一倍。
  
  同理，`package-builder` 与 `runtime-web` 的 `vitest.config.ts` 没有 `include`，也存在同样的重复执行——这是 3.1 要补的配置。
  
  验收：表内每一项都能用 `corepack pnpm --filter <pkg> test` 复现，且 `pnpm test:all` 汇总等于逐包之和；写表时附测量日期与命令。**若重测值与上面的参考值不同，以重测为准并在此处注明差异原因**（例如 1.1 修复后新增了 `index.test.ts` 的 20 条用例）。
- [x] 0.2 记录本次门禁失败快照到 change 的验证记录（`openspec/changes/restore-build-gate-and-delivery-status/verification.md`，新建）：`-r build` 的 2 个失败包名与错误码、`-r typecheck` 的首个失败包、`test-runner` 的 `index.test.ts` 整文件 20 条用例未执行（该文件因语法错误无法收集，`Test Files 2 failed | 8 passed (10)` 中的 2 个失败即 `src/` 与 `dist/` 各一份）。验收：快照含命令原文与退出码，可用于事后对比。

## 1. 恢复门禁（D1）

- [x] 1.1 删除 `packages/test-runner/src/index.test.ts:109-118`。该段是第 88-107 行用例体的整段复制（第 107 行 `});` 已闭合前一个 `it`），且缺少 `it(` 包裹、末尾多一个 `});`。删除后文件结构恢复为 `it(...) { ... });` 序列。

  验收（两条都要，顺序不能反）：
  
  1. `rm -f packages/test-runner/dist/*.test.js packages/test-runner/dist/*.test.d.ts`
  2. `corepack pnpm --filter @bdmv2web/test-runner typecheck` → 通过
  3. `corepack pnpm --filter @bdmv2web/test-runner test` → `Test Files 5 passed (5)` / `Tests 41 passed (41)`，日志中无 `"await" can only be used inside an "async" function`
  
  说明：不清理 `dist` 时会看到 `Test Files 10` / `Tests 42`，因为 `src` 与 `dist` 各跑一遍——这不是修复失败，是产物污染（由 1.3 与 2.1 根治）。评审阶段的 `42 passed` 即由此产生，不可作为完成依据。
- [x] 1.2 补 `packages/runtime-web/src/igs-adapter.test.ts:14` 夹具的 `numericSelectValue`。取值按协议语义显式填写（该按钮 `id: 11`，故 `numericSelectValue: 11`），**不**把 `IgsButton.numericSelectValue` 改成可选、也不给类型默认值——它是 IG 流中的实际字段（`packages/igs/src/igs.ts:240`），可选化会掩盖解析缺失。验收：`corepack pnpm --filter @bdmv2web/runtime-web typecheck` 通过；`igs-adapter` 相关用例仍断言按钮 id/坐标/三态，未被削弱。
- [x] 1.3 清理并重建产物，确认无残留测试编译物。验收：`rm -rf packages/*/dist apps/*/dist && corepack pnpm build` 后 `find packages apps -path "*/dist/*" -name "*.test.*" | wc -l` 输出 `0`（清理前在当前 HEAD 上实测为 70；若数字不同，在验证记录里写明实际值，不要照抄 70）。
  
  注意：`tsc` 默认在报错时仍 emit，所以"build 失败但产物仍生成"是当前现象之一——这也是测试产物能进 `dist` 的机制。先删再建，不要只建不删。
- [x] 1.4 全量门禁。验收：`corepack pnpm generate:contracts && corepack pnpm build && corepack pnpm typecheck && corepack pnpm -r --no-bail test` 依次返回 0；`-r build` 无 `failed` 项（11 个 workspace 包均有 `build` 脚本，逐个确认都有 "Done" 或等效输出）。
- [x] 1.5 记录"门禁未接入 CI 流水线"的已知风险。验收：`docs/development.md` 增加一段，说明当前门禁靠人工执行 `scripts/ci.sh`，流水线（触发条件、缓存、凭据）属后续独立 change；本 change 不新建 `.github/` 或任何平台专属配置（D1=A）。
- [x] 1.6 落地平台无关门禁脚本 `scripts/ci.sh`（可执行）：依次执行 `pnpm install --frozen-lockfile` → `pnpm generate:contracts` → `pnpm -r build` → `pnpm -r typecheck` → `pnpm test:all`，任一步失败即 `exit 1`，每步打印命令与耗时。这是 D1=A 里"CI 单独立项"的承接物——脚本不是流水线，但保证平台确定后只需加一层薄 workflow。
  验收：`bash scripts/ci.sh` 在干净工作区退出 0；故意让某一步失败（如临时改坏一个类型）时脚本在对应步骤退出非 0 且后续步骤不执行；脚本头部注释写明"不跑 test-data 大文件完整性校验"。`git diff --stat` 中不出现 `.github/`。

## 2. 构建与类型检查作用域（D2）

- [x] 2.1 为 `packages/*` 与 `apps/cli` 逐个新增 `tsconfig.build.json`：`{ "extends": "./tsconfig.json", "exclude": ["**/*.test.ts", "**/*.test-d.ts"] }`。验收：11 个包均存在该文件，`node -e` 读取 `exclude` 逐包断言。
- [x] 2.2 各包 `build` 脚本改为 `tsc -p tsconfig.build.json`；`packages/core` 的第二段 `node ../../scripts/build-core-browser.mjs` 保留。验收：`corepack pnpm -r build` 全通过；`packages/core/dist/` 同时存在 `index.js` 与 `browser.js`。
- [x] 2.3 `typecheck` 保持 `tsc -p tsconfig.json --noEmit`（覆盖测试）。验收：在任一 `.test.ts` 中临时制造类型错误（如 `const x: number = ""`），`typecheck` 必须失败而 `build` 必须成功；验证后还原并确认两者恢复通过。该正反例需写入验证记录。
- [x] 2.4 保留 `packages/runtime-web/src/`（`package-builder` 仍直接引用 `runtime-web/src/browser.ts`，解耦属第 2 批 D7）。验收：`grep -rn "runtime-web/src/browser.ts" packages/package-builder/src/index.ts` 有命中，且 `corepack pnpm --filter @bdmv2web/package-builder build` 成功；在 change 内留一行注释说明该依赖将在 D7 移除。
- [x] 2.5 确认发布内容只含产物。验收：`cd packages/core && npm pack --dry-run` 的文件清单不含 `src/`、不含任何 `*.test.*`；对 `packages/test-runner`、`apps/cli` 执行同检查。

## 3. 测试入口统一（D8 · test 脚本）

- [x] 3.1 为 `packages/hdmv`、`packages/test-runner` 新增 `vitest.config.ts`（`test.include: ["src/**/*.test.ts"]`）；其余包保持现有 include，`packages/igs` 为 `["test/**/*.test.ts"]`、`media-export` 与 `runtime-web` 按现有 `src` 范围。验收：11 个包均有 `vitest.config.ts`，`include` 与各自测试所在目录一致（逐包 `ls` 对照）。
- [x] 3.2 各包 `test` 脚本统一为 `vitest run`（去掉 `src` 路径参数）。验收：`grep -h '"test"' packages/*/package.json apps/*/package.json` 的取值全为 `vitest run`。
- [x] 3.3 根 `package.json` 增加 `test:all": "pnpm -r --no-bail test"`，`test` 保持 `pnpm -r test`。验收：`corepack pnpm test:all` 输出覆盖 11 个包，无 `No test files found`，总数等于 0.1 基线表之和；单包失败时其余包仍执行（可临时植入一个失败用例验证后还原）。
- [x] 3.4 验证"聚合 = 逐包"：连续执行 `corepack pnpm test:all` 与逐包 `--filter` 各一次，比对用例数。验收：两次结果逐包一致（允许 skipped 计数相同），差异为零；若不一致，需在验证记录中说明原因并修正配置，不得只改基线表。

## 4. CLI 失败状态与退出码（D10）

- [x] 4.1 在 `packages/test-runner/src/decisions.ts` 抽出 `classifyDiagnostics(diagnostics)`，返回 `{ hasFatal, hasBlockingError, blocking: Diagnostic[] }`；`decideDelivery` 改为调用它，不再自行遍历 severity。验收：单测覆盖 `fatal` / `error` / `acknowledged error` / 空诊断四种输入；`decideDelivery` 现有行为（除 4.3 的 `mode` 变化外）不变。
- [x] 4.2 新增 `decideStageOutcome({ stage, diagnostics, strict })`，`StageStatus = "complete" | "partial" | "failed"`：`fatal → failed/1`；未认可 `error → partial`（strict 2，非 strict 0）；无阻断 → `complete/0`。与 `decideDelivery` 分开导出，交付状态不得复用 `StageStatus`。验收：四种输入的退出码单测；类型上 `StageStatus` 与 `DeliveryStatus` 不可互相赋值（双向编译期检查，两个方向各由一条 `@ts-expect-error` 锁定）。
- [x] 4.3 `apps/cli` 的 `inspect` / `extract` 在写输出前调用 `decideStageOutcome`：`failed` 时不 `commit()`、不生成正式包，stdout 输出 `{"status":"failed","code":...}` 并 `exit 1`。验收：复现命令 `mkdir -p /tmp/bdmv-empty/BDMV && corepack pnpm exec node apps/cli/dist/index.js extract /tmp/bdmv-empty/BDMV --out /tmp/bdmv-empty-out; echo "exit=$?"` → `exit=1`，且 `/tmp/bdmv-empty-out` 不存在（当前会生成含 `fatal` 诊断的包并退 0）。
- [x] 4.4 `inspect` 的默认行为与 4.3 一致（`fatal` 退 1），并新增 `--allow-partial`：显式允许时退 0 但必须在输出中保留 `stageStatus: "failed"`（只看视图，不改变事实）。验收：`inspect /tmp/bdmv-empty/BDMV` → 1；加 `--allow-partial` → 0 且 JSON 含 `stageStatus: "failed"`。
- [x] 4.5 `convert` 改走 `decideDelivery`：把 `disc.diagnostics` 与提取/打包诊断映射为 `DeliveryDecisionInput`（`diagnostics`、`hasMissingRequiredAsset`、`hasUnresolvedReachability`、`declaredEntryCount` / `hdmvEntryCount`），替换当前"没有 scene 就失败"的局部判断。验收：fatal 样本 → `failed` / `exit 1` 且不 commit；现有 `test-data` 样本 → `exit 0` 且产物结构不变；无 Top Menu 的样本仍 `failed`。
- [x] 4.6 strict 下 partial 仍产出审阅包，但 `report.json` 的 `status` 必须为 `partial` 且带 `blockingDiagnostics` 数组。验收：用含未认可 `error` 的样本执行 `convert --strict`，目录存在、`report.json` 有 `status: "partial"` 与至少一条 `blockingDiagnostics`、进程退 2。

## 5. `convert` 单一产物形态（D4）

- [x] 5.1 `--mode` 只接受 `menu-only`；`standalone-full` 返回 `CLI_UNSUPPORTED_MODE` 并 `exit 1`，且在创建任何输出目录/事务之前返回。验收：`corepack pnpm exec node apps/cli/dist/index.js convert <样本> --mode standalone-full --out /tmp/mode-reject` → 退 1，`/tmp/mode-reject` 不存在。
- [x] 5.2 默认值改 `menu-only`，删除 `strictDefault()` 中"非 menu-only 即 strict"的分支（`apps/cli/src/index.ts:26`）。验收：裸跑 `convert <样本> --out /tmp/menu-ok` → `exit 0`，产物 `manifest.json` 的 `mode` 为 `menu-only`（当前裸跑恒定退 2）。
- [x] 5.3 `decideDelivery` 删除 `partialConditions` 中的 `input.mode === "menu-only"`，`mode` 仅作记录字段。验收：无任何缺口的输入在 `mode: "menu-only"` 下返回 `complete` / 0；同步改写 `packages/test-runner/src/index.test.ts:182-183` 为"无缺口 complete、有缺口 partial"，并保留 strict 语义断言。
- [x] 5.4 `optionValue` 缺值统一报错：当旗标出现在末尾且无值时返回明确错误而非 `undefined`。验收：`inspect <样本> --out` → `exit 1` 且 stderr 含 `CLI_MISSING_VALUE`；`convert <样本> --mode` → `exit 1`。
- [x] 5.5 `--player-profile` 真正生效：读取文件 → 校验 → 传入打包/VM 配置，并写入产物的 profile 字段。验收：用两个不同 `menuLanguage` 的 profile 各生成一次，`manifest.json` 的 profile 不同；缺文件或非法 JSON → `exit 1`。
- [x] 5.6 `--limits` 在 D3 接线前显式未实现：解析成功即返回新增错误码 `CLI_NOT_IMPLEMENTED` / `exit 1`，不静默忽略。**不复用 `CLI_UNSUPPORTED_MODE`**（那是"模式不支持"的语义），**也不复用 `E_NOT_IMPLEMENTED`**（该码现由 `compare` 等整体未实现的命令使用，混用会让"命令不存在"与"参数未实现"无法区分）。
  验收：`convert <样本> --limits /tmp/limits.json` → 退 1 且 stderr 含 `CLI_NOT_IMPLEMENTED`；`grep -n "CLI_NOT_IMPLEMENTED" apps/cli/src/index.ts` 有命中且只出现在 `--limits` 分支；`convert <样本> --mode standalone-full` 仍报 `CLI_UNSUPPORTED_MODE`（两条路径的错误码不串）。第 2 批 A.6 完成后改为真正生效并补充验收。

## 6. 文档与仓库卫生（D8）

- [x] 6.1 `docs/development.md` 的 CLI 状态改为当前事实：`inspect` / `extract` / `convert` / `validate` 已实现，`compare` 未实现，`convert` 仅 `menu-only`。验收：文档中不再出现"五个命令都返回 `E_NOT_IMPLEMENTED`"一类表述；逐条与实际 CLI 行为对照通过。
- [x] 6.2 统一"V1 Chrome `file://`"的表述为"已完成 macOS Chrome 实测，证据未绑定制品指纹"，并在 `docs/browser-matrix.md`、`docs/references/stages/M6-release-verification.md`、`docs/development.md` 三处引用同一证据位置。**不修改**任何 tasks 勾选状态（属 D9）。验收：三处措辞一致且互相引用；`grep -rn "not-verified" docs/browser-matrix.md` 与阶段文档不再矛盾。
- [x] 6.3 `docs/igs-support.md:22` 的 Tamako 结论改为：包为 partial 的原因是 Clip 00043 缺失；0xfffe 语义已建立（activated 哨兵，见 `packages/igs/test/tamako-real-smoke.test.ts`）。验收：文档结论与测试断言（`complete: true`）不再互相否定。
- [x] 6.4 用 0.1 的基线表替换 `docs/references/stages/M6-release-verification.md:22-26` 的旧计数（42/40/56/51）。验收：文档计数与 `pnpm test:all` 实测一致，并注明测量日期与命令。
- [x] 6.5 `bdmv_hdmv_offline_web_architecture.md` 的旧包布局（`:145-168`）与旧 `DiscIR` 形状（`:530-538`）加"历史设计"标注，并补"设计名 → 实际包/字段"映射表（`m2ts-demux` → `@bdmv2web/igs`、`navigation-hdmv` → `@bdmv2web/hdmv`、`ir-builder` → CLI/parser 侧、`apps/studio` → 未实施）。验收：文档中任一旧名称都能在同一页找到对应实际位置或"未实施"标注。
- [x] 6.6 `.gitignore` 增加 `.DS_Store` 与 `**/.DS_Store`。验收：`touch packages/core/.DS_Store && git status --short` 无输出；删除临时文件。
- [x] 6.7 大二进制保持现状，但写入策略：新增 >1 MiB 的 fixture 必须由脚本按 manifest 生成，不入库。验收：`docs/development.md` 有该约定，并列出两个既存大文件路径与体积（11 MB / 8.7 MB）作为历史遗留。

## 7. 整体验收

- [x] 7.1 四步门禁全绿：`corepack pnpm generate:contracts && corepack pnpm build && corepack pnpm typecheck && corepack pnpm test:all`。验收：四条命令退出码均为 0；日志中无 `No test files found`。
- [x] 7.2 产物干净：`find packages apps -path "*/dist/*" -name "*.test.*" | wc -l` = 0；`find packages apps -path "*/dist/*" -name "*.test.d.ts"` 无输出。
- [x] 7.3 CLI 四条行为一次性复现（同一脚本内顺序执行）：

  ```sh
  mkdir -p /tmp/bdmv-empty/BDMV
  corepack pnpm exec node apps/cli/dist/index.js extract /tmp/bdmv-empty/BDMV --out /tmp/bdmv-empty-out; echo "extract=$?"
  corepack pnpm exec node apps/cli/dist/index.js convert <样本> --out /tmp/menu-ok; echo "convert=$?"
  corepack pnpm exec node apps/cli/dist/index.js convert <样本> --mode standalone-full --out /tmp/mode-reject; echo "mode=$?"
  corepack pnpm exec node apps/cli/dist/index.js inspect <样本> --out; echo "missing=$?"
  ```

  期望：`extract=1`（且目录未生成）、`convert=0`、`mode=1`（且目录未生成）、`missing=1`。
- [x] 7.4 文档一致性清单：0.1 基线表、6.1 CLI 状态、6.2 Chrome 表述、6.3 Tamako 结论、6.4 M6 计数、6.5 架构映射逐条对照通过，每条附证据链接。
- [x] 7.5 范围守界检查：`git diff --stat` 不包含 `.github/`、不包含 `payloadFingerprint` 相关字段改动、不包含性能改造、不包含 `vm.ts` 常量收敛。验收：如有超出，拆到第 2 批 change。
