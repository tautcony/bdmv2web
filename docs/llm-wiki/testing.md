# 测试与夹具

## 运行方式

```sh
corepack pnpm test                      # 各包 vitest run（fail-fast 语义由各包决定）
corepack pnpm test:all                  # -r --no-bail，收集全部失败
corepack pnpm --filter @bdmv2web/igs test
corepack pnpm typecheck                 # 先 build，再对含测试的源码做 tsc --noEmit
bash scripts/ci.sh                      # install → generate:contracts → build → typecheck → test:all
```

每个包的 `vitest.config.ts` 用 `include` 锁定测试文件，编译产物 `dist/**/*.test.js` 不会被加载（现在也不再产出）。某包匹配不到测试文件时任务失败，不报“通过”。

## 逐包基线（2026-11-07 实测）

用 Node `24.18.0` / pnpm `11.25.0` 对仅含入库夹具的副本跑 `bash scripts/ci.sh` 得到下表。42 个测试文件，合计 **528 passed、1 skipped**，跳过的是 `packages/igs/test/tamako-real-smoke.test.ts`（需要工作区本地 `test-data/bdmv/`）；同一工作区带该样本时为 529 passed、0 skipped。其中 9 例为 igstools 逐元素 RGBA 对照、10 例为 libbluray IGS 解码对照、5 例为 libbluray 导航与 CFG 对照。

| 包 | 用例 | 备注 |
| --- | ---: | --- |
| `@bdmv2web/core` | 14 | 契约、游标、时间 |
| `@bdmv2web/bdmv-io` | 6 | 目录发现、事务 |
| `@bdmv2web/bdmv-parser` | 66 | 五种格式 + 主备 + 损坏分支 |
| `@bdmv2web/igs` | 77 | 传输、场景、真实样本（数据缺失时跳过）、igstools 与 libbluray 元素级对照 |
| `@bdmv2web/hdmv` | 90 | 解码、寄存器、VM、图、循环、golden |
| `@bdmv2web/media-export` | 53 | 注入 `runProcess`，不依赖本机 ffmpeg |
| `@bdmv2web/runtime-web` | 112 | 控制器、boot、无头导航 |
| `@bdmv2web/package-builder` | 10 | 打包、转义、音效 |
| `@bdmv2web/test-fixtures` | 5 | 夹具自检 |
| `@bdmv2web/test-runner` | 48 | 审计、判定、报告 |
| `@bdmv2web/cli` | 48 | 参数契约、事务、stage/delivery、libbluray 导航基线 |

`docs/guides/development.md` 的 Test baseline 表在同一次测量中已同步为相同数值。计数变化要同时更新两处。

## 测试布局

| 层 | 位置 | 特点 |
| --- | --- | --- |
| 单元 | `packages/*/src/*.test.ts` | 与被测代码同目录；`igs` 用 `packages/igs/test/` |
| 集成 | `packages/igs/test/m1-m2-m3.integration.test.ts` | 解析 → 场景 → 命令来源 |
| 无头导航 | `runtime-web/src/*headless*.test.ts` | 用工作区样本跑 DFS/按钮路径 |
| 真实样本 | `igs/test/tamako-real-smoke.test.ts`、`runtime-web/src/tamako-*` | 数据缺失时跳过 |
| 一站式 | `apps/cli/src/synthetic-all-features.test.ts` | 全特性自写合成盘跨包集成 |
| 独立参考 | `packages/igs/test/igs-reference-element-summary.test.ts` | 重算 IGS 渲染并与 pinned igstools 参考 PNG 的逐元素像素值比对 |
| 独立参考 | `packages/igs/test/libbluray-igs-baseline.test.ts` | 对 8 个 clip 的 display set、ICS、页面/BOG/按钮/效果、256 项调色板与 RLE 对象与 libbluray 解码结果逐项比对 |
| 独立参考 | `apps/cli/src/libbluray-navigation-baseline.test.ts` | 对 4 个真实盘的 index、逐命令反汇编、标题结构、完整 CFG 及 VM playlist 事件与 libbluray 基线比对 |
| 浏览器 | `runtime-web/src/browser.test.ts` | 最小 DOM 桩，不是真实浏览器 |

## 夹具来源

| 来源 | 位置 | 性质 |
| --- | --- | --- |
| 手写字节构造器 | `packages/test-fixtures/src/bdmv.ts` | 项目自写，证明实现行为，不是协议证据 |
| 合成菜单向量 | `packages/test-fixtures/src/menu-runtime.ts` | 两按钮焦点/动作 |
| 全特性自写合成盘 | `test-data/fixtures/synthetic-all-features/` | `scripts/generate-synthetic-all-features.mjs` 按字段生成；libbluray 1.5.0 读回验证 |
| IG 包夹具 | `test-data/fixtures/hdmv-navigation/` | 由 `scripts/export-igs-packet-fixtures.mjs` 生成 |
| 外部 ICS 样本 | `test-data/fixtures/igs-parser/` | 带来源与 MIT 许可说明 |
| igstools 参考摘要 | `docs/evidence/igs-reference-element-summary.json` | pinned igstools 参考 PNG 的元素级 RGBA 值；测试不读取 `.reference-cache` |
| libbluray IGS 基线 | `docs/evidence/libbluray-1.5.0-igs-baseline.json` | 固定 revision `d75c88e` 的 `graphics_processor_decode_ts()` 输出，8 clip / 872 对象 |
| libbluray 导航基线 | `docs/evidence/libbluray-1.5.0-navigation-baseline.json` | 固定 revision `d75c88e` 的 `bd_info`、`bd_list_titles -a`、`mobj_dump -d` 与 `bd_play()` 事件，4 盘 / 5225 命令 / 6224 CFG 边 |
| 工作区本地样本 | `test-data/bdmv/` | 仅本机存在，测试按需跳过 |

规则：新夹具 > 1 MiB 必须用脚本从 manifest 生成，不直接提交二进制；不在夹具/测试名/日志写真实标题、机器路径、`file://` URL。

## 独立基线与实现回归 pin

| 基线 | 产出工具 | 入库文件 | 消费测试 |
| --- | --- | --- | --- |
| 逐元素 RGBA | `SAPikachu/igstools` @ `34a13315` 的 `picture_to_png` | `docs/evidence/igs-reference-element-summary.json` | `packages/igs/test/igs-reference-element-summary.test.ts` |
| IGS display set 与元素 | libbluray 1.5.0 `graphics_processor_decode_ts()` | `docs/evidence/libbluray-1.5.0-igs-baseline.json` | `packages/igs/test/libbluray-igs-baseline.test.ts` |
| index / 反汇编 / 标题 / CFG / VM 事件 | libbluray 1.5.0 `bd_info`、`bd_list_titles -a`、`mobj_dump -d`、`bd_play()` | `docs/evidence/libbluray-1.5.0-navigation-baseline.json` | `apps/cli/src/libbluray-navigation-baseline.test.ts` |

三份基线由固定 revision 的外部实现产出，测试只读入库 JSON 与夹具，运行时不需要本机 libbluray 或 igstools。libbluray IGS 基线与 igstools RGBA 基线的 object id 集合逐 clip 交叉核对。
`scripts/generate-libbluray-baselines.py` 与 `scripts/libbluray-igs-dump.c` 是本地证据生成工具，需要本机 libbluray 1.5.0、固定源码树和 clang；CI 不运行它们。`packages/runtime-web/src/hdmv-navigation-corpus-dfs.test.ts` 的 `regressionPins` 记录本项目 DFS 自身的统计，其中索引条目数与静态 playlist 目标由 libbluray 导航基线驱动。

## 新增测试

1. 先确定层级：解析分支用 `test-fixtures` 构造最小 BDMV；VM 语义用 12 字节命令向量；运行时用 `menuInteractionFixture`。
2. 断言“支持的行为”，不要为了证明“不存在”而写测试；拒绝/安全/错误处理的负向断言要写清具体可观察结果。
3. 涉及协议字段时，同时更新 `docs/support/*.md` 的证据状态；只有项目测试不能把 `unverified` 改成 `supported`。
4. 改计数后同步基线表。

## 环境相关

| 场景 | 要求 |
| --- | --- |
| 媒体导出测试 | 注入假 `runProcess`，不需要 ffmpeg |
| `convert` 实跑 | 需要 `ffmpeg`/`ffprobe`，且含 `libx264`、`aac` |
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
