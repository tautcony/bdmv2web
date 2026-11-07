# 架构

## 三段边界

| 阶段 | 运行环境 | 允许 | 禁止 |
| --- | --- | --- | --- |
| 转换 | Node.js ≥ 24.18.0 且 < 25 | 读源盘、`ffmpeg`/`ffprobe`、写输出事务 | 把解密/DRM 当能力 |
| 交付 | 浏览器 `file://` | 同目录静态文件、Canvas、`HTMLMediaElement`、键鼠/触摸 | 网络、后台、ES module、`fetch`、动态 `import` |
| 校验 | Node.js | 只读包目录、重算报告 | 改写 `manifest.status`、读原盘 |

`packages/core` 同时服务两端：Node 侧用 `dist/index.js`，浏览器侧用 `dist/browser.js`（ES2020 IIFE，构建脚本拒绝 Node 内建）。

## 包依赖

| 包 | 依赖（workspace） | 角色 |
| --- | --- | --- |
| `@bdmv2web/core` | —（运行时仅 `ajv`） | DiscIR schema/类型、Time90k、Limits、PlayerProfile、诊断与事件信封 |
| `@bdmv2web/bdmv-io` | core | 输入发现、按表读文件、限流读流、输出事务、路径隔离 |
| `@bdmv2web/bdmv-parser` | core, bdmv-io | BDMV 元数据解析、主备回退、结构引用图 |
| `@bdmv2web/hdmv` | core, bdmv-parser | 指令解码、寄存器、VM、导航图、静态循环 |
| `@bdmv2web/igs` | core, bdmv-io, bdmv-parser | M2TS/TS/PES 重组、IGS 段与场景、PNG |
| `@bdmv2web/media-export` | bdmv-parser, hdmv, igs | 媒体闭包、媒体计划、ffmpeg 导出、PGS、外部目标 |
| `@bdmv2web/package-builder` | core, hdmv, media-export（+ `esbuild`） | 菜单包文件、脚本嵌入、音效、manifest |
| `@bdmv2web/runtime-web` | bdmv-parser, hdmv, igs, media-export | 浏览器菜单运行时；被 package-builder 打成 IIFE |
| `@bdmv2web/test-runner` | — | 包审计、状态判定、覆盖率、浏览器证据、报告 |
| `@bdmv2web/test-fixtures` | core | 合成 BDMV 字节构造器与运行时夹具 |
| `@bdmv2web/cli` | 以上全部 | 命令编排与退出码 |

依赖方向单向：`core ← io ← parser ← {hdmv, igs} ← media-export ← {package-builder, runtime-web} ← cli`。`test-runner` 不依赖业务包，只消费 JSON/文件事实。

## 数据形态

| 形态 | 生产者 | 消费者 | 关键字段 |
| --- | --- | --- | --- |
| `ParsedDisc` | `bdmv-parser` | `hdmv`、`igs`、`media-export`、CLI | `entries`、`movieObjects`、`playlists`、`clips`、`sounds`、`graph`、`declarations`、`diagnostics` |
| `IgsExtraction` | `igs` | CLI、`media-export`、`runtime-web` | `scenes`、`assets`、`diagnostics`、`status`、`streams` |
| `DiscIR` | CLI（`createMenuDiscIR`） | `package-builder`、浏览器 | `schemaVersion`、`entries`、`programs`、`menus`、`playlists`、`mediaAssets`、`diagnostics` |
| `MenuScene` / `SerializedScene` | `runtime-web`（`adaptIgsScene`） | `package-builder` → `runtime/disc-data.js` | 顶层 `pages`；`buttons`/`objects`/`effects` 嵌在 page 内 |
| `MediaClosure` / `MediaPlan` | `media-export` | CLI、`package-builder` | 可达 `playlistIds`/`clipIds`、未知项、预算估算 |
| 菜单包 | `package-builder` | 浏览器、`test-runner` | `index.html`、`runtime/*`、`assets/*`、`manifest.json` |
| 交付报告 | `test-runner` + CLI | 人、CI | `report.json`、`compatibility.json`、`dependency-audit.json`、`reports/release-summary.json` |

`ParsedDisc.analysisStage` 固定为 `structural`：结构解析成功不代表控制流已验证。`supportPrediction.status` 固定为 `partial`。

## 一次 `convert` 的时序

入口：`apps/cli/src/index.ts` → `async function convert()`。

1. **参数先于输入**：`loadLimits(--limits)`、`loadPlayerProfile(--player-profile)` 在任何解析与输出事务之前完成校验。
2. `parseBdmv(input)` → `ParsedDisc`；`classifyDiagnostics` 出现 `fatal` 立即失败，不创建 staging。
3. 计算输出目录（默认 `<BDMV 父目录>/BDMV-menu`）与标题（默认 `<BDMV 父目录名>`），`assertDisjointRoots` 拒绝输入/输出重叠。
4. `extractIgsScenes(disc)` 提取场景与 PNG（`renderAssets` 默认开启）。
5. `findTopMenuPlaylist` 从 HDMV 入口解析 Top Menu 播放列表；`menuLoopMediaInput` 计算背景循环区间与音轨。
6. `beginOutputTransaction` 建 staging；后续任一步失败都 `abort`，不提交半成品。
7. 场景选择：`findMenuScene` 按播放列表的 clip/PID 匹配场景。无场景 → `MENU_SCENE_NOT_FOUND`；多义 → `MENU_SCENE_AMBIGUOUS`；无 Top Menu 播放列表 → `MENU_PLAYLIST_NOT_RESOLVED`。失败仍写 `README.md` + `report.json` 并提交，退出码 1。
8. `adaptIgsScene` 序列化主导航场景；`uiModel === 0` 的场景作为菜单画面，`uiModel === 1` 作为弹出菜单；可达的其他菜单播放列表额外导出本地媒体。
9. `buildMediaClosure` + `createExternalMediaTargets` 生成可达播放列表与外部播放目标。
10. 收集：MovieObject 程序、入口表、音效字节、被引用 PNG、诊断。
11. `decideDelivery` 先算状态（`checks: []`，只由诊断与事实决定），`buildMenuPackage` 按该状态写包，避免包自己造结论。
12. `buildMenuPackage` 写文件、导出媒体、`esbuild` 打包 `runtime-web/src/browser.ts` 为 `runtime/app.bundle.js`、写 `manifest.json`。
13. 写 `report.json`，`commit()`，stdout 输出 `{ status, output }`；`status !== complete` 时退出码按 `0/1/2` 规则。

## 产物与仓库目录

| 路径 | 内容 |
| --- | --- |
| `test-data/bdmv/` | 工作区本地真实样本（不入库保密内容，路径含真实目录名） |
| `test-data/fixtures/` | 合成/打包夹具：`bdmvkit-generated/`、`hdmv-navigation/`、`igs-parser/` |
| `test-data/output/` | 手工验收产出的菜单包与资产，不参与自动测试 |
| `.reference-cache/` | 固定 revision 的上游参考源码（libbluray / libhdmv / igstools / bdmvkit），被 `.gitignore` 排除 |
| `docs/evidence/` | IGS 逐元素对照记录 |
| `docs/references/stages/` | M0–M6 阶段索引与证据 |

## 谁拥有什么状态

| 状态 | 唯一来源 | 说明 |
| --- | --- | --- |
| 结构解析结论 | `ParsedDisc.diagnostics` + `decideStageOutcome` | `stageStatus`，不是交付 `status` |
| 交付结论 | `decideDelivery` | 只由失败证据降低；缺证据记为 `notVerified` |
| 包内声明状态 | `manifest.status` | 由调用方传入；`validate` 不回写 |
| VM 状态 | `HdmvVm.snapshot()` | `idle/running/suspended/stopped/faulted` + `generation` |
| 浏览器菜单状态 | `MenuController` | 页、选中/激活按钮、禁用集、BOG 选择、动画/效果进度；可 `saveCheckpoint` |

跨层规则：下层不猜测上层结论。`package-builder` 默认 `partial`，真实状态由 CLI 传入；`runtime-web` 不为缺失资产伪造画面，只报诊断。
