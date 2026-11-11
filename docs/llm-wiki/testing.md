# 测试与夹具

## 运行方式

```sh
corepack pnpm test                      # 各包 vitest run（fail-fast 语义由各包决定）
corepack pnpm test:all                  # -r --no-bail，收集全部失败
corepack pnpm --filter @bdmv2web/igs test
corepack pnpm typecheck                 # 先 build，再对含测试的源码做 tsc --noEmit
bash scripts/ci.sh                      # install → generate:contracts → build → lint/typecheck/test:all 并行 lane
```

每个包的 `vitest.config.ts` 用 `include` 锁定测试文件，编译产物 `dist/**/*.test.js` 不会被加载。某包匹配不到测试文件时任务失败。

## 逐包入口

`corepack pnpm test` 跑全部包的测试，`corepack pnpm test:all` 加 `--no-bail`，单个包失败不阻断其余包。

| 包 | 命令 | 覆盖 |
| --- | --- | --- |
| `@bdmv2web/core` | `corepack pnpm --filter @bdmv2web/core test` | 契约、游标、时间 |
| `@bdmv2web/bdmv-io` | `corepack pnpm --filter @bdmv2web/bdmv-io test` | 目录发现、事务 |
| `@bdmv2web/bdmv-parser` | `corepack pnpm --filter @bdmv2web/bdmv-parser test` | 五种格式 + 主备 + 损坏分支 |
| `@bdmv2web/igs` | `corepack pnpm --filter @bdmv2web/igs test` | 传输、场景、真实样本、igstools 与 libbluray 元素级对照 |
| `@bdmv2web/hdmv` | `corepack pnpm --filter @bdmv2web/hdmv test` | 解码、寄存器、VM、图、循环、golden |
| `@bdmv2web/media-export` | `corepack pnpm --filter @bdmv2web/media-export test` | 注入 `runProcess`，不依赖本机 ffmpeg |
| `@bdmv2web/runtime-web` | `corepack pnpm --filter @bdmv2web/runtime-web test` | 控制器、boot、无头导航 |
| `@bdmv2web/package-builder` | `corepack pnpm --filter @bdmv2web/package-builder test` | 打包、转义、音效 |
| `@bdmv2web/test-fixtures` | `corepack pnpm --filter @bdmv2web/test-fixtures test` | 夹具自检 |
| `@bdmv2web/test-runner` | `corepack pnpm --filter @bdmv2web/test-runner test` | 审计、判定、报告 |
| `bdmv2web` | `corepack pnpm --filter bdmv2web test` | 参数契约、事务、stage/delivery、libbluray 导航基线 |

## 测试布局

| 层 | 位置 | 特点 |
| --- | --- | --- |
| 单元 | `packages/*/src/*.test.ts` | 与被测代码同目录 |
| 集成 | `packages/*/tests/integration/`、`apps/cli/tests/integration/` | 跨模块或跨包，读 `test-data` 夹具与基线 |
| 辅助 | `packages/*/tests/helpers/` | 仅供测试使用的夹具构造，不进 `dist` |
| 端到端 | `apps/cli/tests/e2e/index.test.ts` | spawn 构建后的 `dist/index.js`，检查完整菜单包 |
| 无头导航 | `runtime-web/tests/integration/*headless*.test.ts` | 用工作区样本跑 DFS/按钮路径 |
| 真实样本 | `igs/tests/integration/tamako-external-navigation.test.ts`、`runtime-web/tests/integration/tamako-*` | 数据缺失时跳过 |
| 一站式 | `apps/cli/tests/integration/synthetic-all-features.test.ts` | 全特性自写合成盘跨包集成 |
| 独立参考 | `packages/igs/tests/integration/igs-reference-element-summary.test.ts` | 重算 IGS 渲染并与 pinned igstools 参考 PNG 的逐元素像素值比对 |
| 独立参考 | `packages/igs/tests/integration/libbluray-igs-baseline.test.ts` | 对 9 个 clip 的 display set、ICS、页面/BOG/按钮/效果、256 项调色板与 RLE 对象与 libbluray 解码结果逐项比对 |
| 独立参考 | `apps/cli/tests/integration/libbluray-navigation-baseline.test.ts` | 对 4 个真实盘与 1 个合成盘的 index、逐命令反汇编、标题结构、完整 CFG 及 VM playlist 事件与 libbluray 基线比对 |
| 浏览器 | `runtime-web/src/browser.test.ts` | 最小 DOM 桩，不是真实浏览器 |

## 夹具与基线来源

| 来源 | 位置 | 性质 |
| --- | --- | --- |
| 手写字节构造器 | `packages/test-fixtures/src/bdmv.ts` | 项目自写，证明实现行为，不是协议证据 |
| 合成菜单向量 | `packages/test-fixtures/src/menu-runtime.ts` | 两按钮焦点/动作 |
| 全特性自写合成盘 | `test-data/fixtures/synthetic-all-features/` | `scripts/generate-synthetic-all-features.mjs` 按字段生成；libbluray 1.5.0 读回验证 |
| IG 包夹具 | `test-data/fixtures/hdmv-navigation/` | 由 `scripts/export-igs-packet-fixtures.mjs` 生成 |
| 外部 ICS 样本 | `test-data/fixtures/igs-parser/` | 带来源与 MIT 许可说明 |
| igstools 参考摘要 | `test-data/baselines/igs-reference-element-summary.json` | pinned igstools 参考 PNG 的元素级 RGBA 值；测试不读取 `.reference-cache` |
| libbluray IGS 基线 | `test-data/baselines/libbluray-1.5.0-igs-baseline.json` | 固定 revision `d75c88e` 的 `graphics_processor_decode_ts()` 输出，8 clip / 872 对象 |
| libbluray 导航基线 | `test-data/baselines/libbluray-1.5.0-navigation-baseline.json` | 固定 revision `d75c88e` 的 `bd_info`、`bd_list_titles -a`、`mobj_dump -d` 与 `bd_play()` 事件，4 盘 / 5225 命令 / 6224 CFG 边 |
| 工作区本地样本 | `test-data/bdmv/` | 仅本机存在，测试按需跳过 |

规则：新夹具 > 1 MiB 必须用脚本从 manifest 生成，不直接提交二进制；不在夹具/测试名/日志写真实标题、机器路径、`file://` URL。

## 独立基线与实现回归 pin

| 基线 | 产出工具 | 入库文件 | 消费测试 |
| --- | --- | --- | --- |
| 逐元素 RGBA | `SAPikachu/igstools` @ `34a13315` 的 `picture_to_png` | `test-data/baselines/igs-reference-element-summary.json` | `packages/igs/tests/integration/igs-reference-element-summary.test.ts` |
| IGS display set 与元素 | libbluray 1.5.0 `graphics_processor_decode_ts()` | `test-data/baselines/libbluray-1.5.0-igs-baseline.json` | `packages/igs/tests/integration/libbluray-igs-baseline.test.ts` |
| index / 反汇编 / 标题 / CFG / VM 事件 | libbluray 1.5.0 `bd_info`、`bd_list_titles -a`、`mobj_dump -d`、`bd_play()` | `test-data/baselines/libbluray-1.5.0-navigation-baseline.json` | `apps/cli/tests/integration/libbluray-navigation-baseline.test.ts` |

三份基线由固定 revision 的外部实现产出，测试只读入库 JSON 与夹具，运行时不需要本机 libbluray 或 igstools。libbluray IGS 基线与 igstools RGBA 基线的 object id 集合逐 clip 交叉核对。

基线 JSON 采用受限深度格式：外层两级展开，`cases` 的每一项占一行，更深的值保持单行紧凑。`scripts/generate-libbluray-baselines.py` 按同一格式写出，重新生成时只改动发生变化的 case 行。

`scripts/generate-libbluray-baselines.py` 与 `scripts/libbluray-igs-dump.c` 是本地证据生成工具，需要本机 libbluray 1.5.0、固定源码树和 clang；CI 不运行它们。`packages/runtime-web/tests/integration/hdmv-navigation-corpus-dfs.test.ts` 用本地 DFS explorer 与 libbluray 导航基线对照：index 条目数、静态 playlist 目标集合（`observedPlaylists ⊇ libblurayPlayTargets`）以及 explorer 的边记账不变量。

## 新增测试

1. 先确定层级：解析分支用 `test-fixtures` 构造最小 BDMV；VM 语义用 12 字节命令向量；运行时用 `menuInteractionFixture`。
2. 断言“支持的行为”，不要为了证明“不存在”而写测试；拒绝/安全/错误处理的负向断言要写清具体可观察结果。
3. 涉及协议字段时，同时更新 `docs/support/*.md` 的证据状态；只有项目测试不能把 `unverified` 改成 `supported`。
4. 改计数后同步基线表。

## 环境相关

| 场景 | 要求 |
| --- | --- |
| 媒体导出测试 | 注入假 `runProcess`，不需要 ffmpeg |
| `build` 实跑 | 需要 `ffmpeg`/`ffprobe`，且含 `libx264`、`aac` |
| 真实样本测试 | 需要 `test-data/bdmv/` 或打包夹具；缺失即跳过 |
| 导航语料 | 单例预算 120s，机器过载时先跑单包 |
| 大小写变体目录 | 大小写不敏感文件系统无法构造，测试会记录该限制 |

## 常见失败

| 现象 | 原因 |
| --- | --- |
| 只有 `typecheck` 红 | 测试文件类型错误；`build` 不编译测试 |
| `vitest` 报找不到测试 | 包的 `include` 与文件名不匹配 |
| 计数比基线多 | 有历史 `dist/*.test.js` 被加载，或新增用例未更新基线 |
| 媒体测试超时 | 默认 15s 在繁忙机器上偏紧；确认不是真实 ffmpeg 被调用 |
| 无头导航测试慢 | 语料遍历本身耗时，属预期 |
