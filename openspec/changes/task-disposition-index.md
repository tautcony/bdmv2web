# 原始未勾选任务逐项处置索引

基准：2026-11-09 审计时活动 change 的 **56 项未勾选任务**（`converge-contracts-and-distribution` 34、`export-playable-media` 14、`fix-hdr-color-pipeline` 4、`verify-offline-release` 4）。本文件逐项给出处置、执行步骤与当前 OpenSpec 状态，供后续勾选与评审对照。

范围调整的依据见 [scope-changes.md](./scope-changes.md)；本文件只做索引，不改变各 `tasks.md` 的勾选状态。

**读法**

| 处置 | 含义 |
| --- | --- |
| 保留 | 条目原文未改，仍按原验收执行 |
| 重写（描述） | 验收目标不变，改正与当前实现/规格矛盾的路径、字段、属性与状态措辞 |
| 重写（验收口径） | 验收方式从实机、人工观察改为可自动化判定的检查，记录于 `scope-changes.md` |
| 合并 | 内容并入指定任务；源编号不再单独作为待办，且不表示已验收 |
| 移出 | 目标退出本轮范围，编号不再作为待办，也不以 `[x]` 表示通过 |
| 新增 | 本轮新增任务，不计入原 56 项 |

## 1. `converge-contracts-and-distribution`（34 项）

| ID | 处置 | 步骤 | 现状 | 本轮 OpenSpec 变更 | 完成证据 |
| --- | --- | --- | --- | --- | --- |
| B.5 | 保留 | 12 | 未勾选 | — | 发布验证文档记录 compatibility 缺失的工具版本与诊断字段 |
| B.7 | 保留 | 12 | 未勾选 | — | 历史包 fixture 的正反向兼容测试 |
| C.1 | 保留 | 03 | 未勾选 | — | 两种上下文 × 四个 opcode 共 8 组判定 |
| C.2 | 重写（描述） | 03 | 未勾选 | `hdmv-navigation` delta 先声明 `origin` 属性 | 图同时含 jump 与 sequence 边；目标 entry 可达；原位置下一条不误判可达 |
| C.4 | 保留 | 04 | 未勾选 | — | 无等待、旧代次、重复回执丢弃 |
| C.7 | 保留 | 03 | 未勾选 | — | 全 opcode 对照表、来源与逐项回归 |
| D.1 | 重写（描述） | 02 | 未勾选 | `disc-contracts` delta、design 源位置表 | 位置改指 `build.ts`；entry 来源为 `index.bdmv`（含 backup）；required `SourceRef` 非 null，诊断可空并带 `stage` |
| D.2 | 重写（描述） | 02 | 未勾选 | 同上 | `vmPrograms` 保留 `path`/`offset`/`instructionIndex`；`byteOffset` 为有效十进制字符串 |
| D.3 | 重写（描述） | 02 | 未勾选 | `interactive-graphics-extraction` delta | `toIgsSource` 由调用方传入真实 `path`/`clipId`/`pid`/`origin`；不生成 `STREAM/.m2ts` 与 `pid: 0` |
| D.4 | 保留 | 02 | 未勾选 | `disc-contracts` delta 已含 | 相对 BDMV 根且不带 `BDMV/`；旧占位报 `SCHEMA_SOURCE_PLACEHOLDER` |
| D.5 | 保留 | 02、12 | 未勾选 | — | 两份 support 文档补路径约定与示例 |
| E.1 | 重写（描述） | 04 | 未勾选 | `offline-menu-runtime` delta | 去掉行号引用；无 `media`/`menuMedia` 的包仍执行初始 turns 且按钮可导航 |
| E.2 | 保留 | 04 | 未勾选 | — | ended/error/abort 对应待机与恢复 |
| E.3 | 保留 | 04 | 未勾选 | — | PSR1 更新与失败回滚 |
| E.4 | 保留 | 04 | 未勾选 | — | 仅 normal 视觉的启用按钮可被命中 |
| E.6 | 保留 | 04、12 | 未勾选 | — | runtime-web 全绿；headless 导航仍通过 |
| F.1 | 重写（描述） | 07 | 未勾选 | design §6 | 产物为 `dist/browser.bundle.js`，导出 `./browser-bundle` |
| F.2 | 重写（描述） | 07 | 未勾选 | design §6 | builder 只经 `browser-bundle` 读取，去掉 workspace 源码路径 |
| F.3 | 保留 | 07 | 未勾选 | — | 拦截读取 `**/src/*.ts` 的单测 |
| F.4 | 重写（描述） | 07 | 未勾选 | — | 只补 package-builder 白名单；runtime-web 仅复核 |
| F.5 | 保留 | 07、12 | 未勾选 | — | convert 产物结构不变，`validate --offline` 不退化 |
| G.1 | 保留 | 11 | 未勾选 | — | 五项 case 脚本可执行并写出 JSON |
| G.2 | 保留 | 11 | 未勾选 | — | 机器、版本与三轮结果入 `benchmark.md` |
| G.3 | 保留 | 11 | 未勾选 | — | 五项按数据归类 |
| G.4 | 保留 | 11 | 未勾选 | — | 仅超线性项修复且有前后对比 |
| G.5 | 保留 | 11 | 未勾选 | — | 轮询调用次数降 ≥90%，字节预算仍能中止 |
| G.6 | 保留 | 11 | 未勾选 | — | `canonicalDirectory` 调用 1000→1 |
| G.7 | 保留 | 11 | 未勾选 | — | 未优化项、原因与触发条件 |
| H.1 | 保留 | 12 | 未勾选 | — | grep 三连输出与口径逐字一致 |
| H.2 | 保留 | 12 | 未勾选 | — | build/typecheck/test:all 全绿 |
| H.3 | 保留 | 12 | 未勾选 | — | 两条端到端链路不退化 |
| H.4 | 重写（描述） | 00、12 | 未勾选 | — | 增查活动 OpenSpec 无实机播放、人工目视、跨浏览器解码条目 |
| H.5 | 保留 | 00、12 | 未勾选 | — | 无新后端、无浏览器内正片、无新 CI workflow |
| H.6 | 重写（描述） | 13 | 未勾选 | `proposal.md`、`design.md` 同步 | 四份主规格已存在；本 change 不持有 `offline-delivery-assurance` delta；顺序 M5→HDR→M6→CC |

## 2. `export-playable-media`（14 项）

| ID | 处置 | 步骤 | 现状 | 本轮 OpenSpec 变更 | 完成证据 |
| --- | --- | --- | --- | --- | --- |
| 2.3 | 保留 | 06 | 未勾选 | — | 取消、超时、进程失败、输出探测；半成品不入 manifest |
| 5.1 | 保留 | 06 | 未勾选 | — | 单包形态；manifest/report/stdout 无模式字段，旧参数被拒 |
| 5.2 | 保留 | 05 | 未勾选 | — | 可达动作映射到实际 M2TS，保留 PlayItem/Clip/IN-OUT/来源 |
| 5.3 | 保留 | 05 | 未勾选 | — | 多 PlayItem、重复 Clip、非零 IN/OUT、缺源 |
| 5.5 | 重写（描述） | 06 | 未勾选 | — | 模拟资源解析验证移动、改配置与 reload 后的目标构造，不作第三方启动验证 |
| 6.1 | 移出 | 00 | 已移出 | `scope-changes.md` | 不再要求 macOS/IINA 与 Windows/PotPlayer 实机打开 |
| 6.2 | 重写（验收口径） | 00、05 | 未勾选 | `offline-media-playback` delta | 纯函数断言目标字符串与编码；模拟事件断言 `requested`/`unavailable`/`unknown` |
| 6.3 | 重写（描述） | 05 | 未勾选 | `offline-media-playback` delta | 拒绝绝对路径、上跳、反斜线、scheme、混淆编码、未声明 Clip；生成期查符号链接，浏览器期不读宿主文件系统 |
| 6.4 | 重写（描述） | 05 | 未勾选 | `offline-media-playback` delta | 只记录已构造并发起的目标；无回执时结束等待且不产生 started/ended |
| 7.1 | 重写（描述） | 05、08 | 未勾选 | `offline-delivery-assurance`（M6）四类引用划分 | 每类有稳定 checkId 与 path；合法外部目标不计为缺失；不声称外部已执行 |
| 7.2 | 移出 | 00 | 已移出 | `scope-changes.md` | 不再要求人工菜单动作与观察记录；迁移与路径解析归 M6 4.2 |
| 7.3 | 重写（验收口径） | 04、12 | 未勾选 | — | 模拟 DOM 与音频事件覆盖按钮状态、音源静音、导航迁移；不要求人工音画 |
| 8.2 | 保留 | 06 | 未勾选 | — | 计划不匹配或资产缺失时重导出；提交失败恢复旧包 |
| 9.2 | 重写（验收口径） | 04、12 | 未勾选 | — | 模拟 `file://` 解析覆盖三种状态迁移；手动静音不被页面输入解除 |

## 3. `fix-hdr-color-pipeline`（4 项）

| ID | 处置 | 步骤 | 现状 | 本轮 OpenSpec 变更 | 完成证据 |
| --- | --- | --- | --- | --- | --- |
| 7.5 | 重写（验收口径） | 10 | 未勾选 | `offline-media-playback`（HDR）delta | 合成测试视频断言滤镜链选择、返回状态、ffprobe 元数据与帧数值；无该构建时记 `not-verified` |
| 7.6 | 移出 | 00 | 已移出 | `scope-changes.md` | 不再要求真实 UHD 菜单 Clip 的人工目视比对 |
| 7.7 | 重写（验收口径） | 10 | 未勾选 | `offline-media-playback`（HDR）delta | 合成 SDR 样本断言 BT.709 标记、未误用 HDR 链、帧数值在容差内 |
| 7.8 | 移出 | 00 | 已移出 | `scope-changes.md` | 不再要求 Safari/Chrome/Firefox 的 HEVC 播放记录 |

## 4. `verify-offline-release`（4 项）

| ID | 处置 | 步骤 | 现状 | 本轮 OpenSpec 变更 | 完成证据 |
| --- | --- | --- | --- | --- | --- |
| 1.1 | 保留 | 08 | 未勾选 | — | 无原碟与 FFmpeg 仍可审计；缺启动项与必需资产判失败 |
| 1.2a | 保留 | 05、08 | 未勾选 | — | external target 只来自 `STREAM/*.m2ts`；路径逃逸不作有效目标；配置与关联状态记未验证 |
| 2.1a | 重写（描述） | 01、08 | 未勾选 | `offline-delivery-assurance` delta | `complete` 只表示无已知失败证据；`not-verified` 不改状态且逐条列出；`fail` 优先 |
| 4.2 | 重写（验收口径） | 00、08、12 | 未勾选 | `offline-delivery-assurance` delta | 启动引用、目录迁移、配置修改、URL 编码、协议请求模拟、无回执恢复、静音恢复；屏蔽源码路径与 FFmpeg |

## 5. 新增任务（不计入 56 项）

| ID | 来源决策 | 步骤 | 现状 | 本轮 OpenSpec 变更 | 完成证据 |
| --- | --- | --- | --- | --- | --- |
| X-AUDIT | D-03 | 01 | 未勾选 | `offline-delivery-assurance` 聚合场景 | 两种顺序、多项混合、空检查、重复检查、strict 两档；含"放回 fail 则测试失败"负例 |
| X-COMPARE | D-08 | 09 | 未勾选 | `offline-delivery-assurance` 比较场景 | 退出码 0/1/2；三组 fixture 断言报告 JSON 与最早差异 |

## 6. 计数核对

| 处置 | CC | M5 | HDR | M6 | 合计 |
| --- | --- | --- | --- | --- | --- |
| 保留 | 24 | 5 | 0 | 2 | 31 |
| 重写（描述） | 10 | 4 | 0 | 1 | 15 |
| 重写（验收口径） | 0 | 3 | 2 | 1 | 6 |
| 移出 | 0 | 2 | 2 | 0 | 4 |
| 原始小计 | 34 | 14 | 4 | 4 | 56 |
| 新增 | 0 | 0 | 0 | 2 | 2 |

| Change | 原始未勾选 | 移出 | 新增 | 当前 `tasks.md` 未勾选 |
| --- | --- | --- | --- | --- |
| `converge-contracts-and-distribution` | 34 | 0 | 0 | 34 |
| `export-playable-media` | 14 | 2 | 0 | 12 |
| `fix-hdr-color-pipeline` | 4 | 2 | 0 | 2 |
| `verify-offline-release` | 4 | 0 | 2 | 6 |
| 合计 | 56 | 4 | 2 | 54 |

当前未勾选数按各 `tasks.md` 的 `- [ ]` 行计数，与上表一致。`54` 是文件实际状态，不是 `56 - 4 + 2` 的算术推论。

## 6a. `export-playable-media` 后续验收收敛（2026-11-09）

原始处置表保留 2026-11-09 审计时的 14 项状态。本轮对照实现和测试后，当前 `tasks.md` 的未勾选项为 10 项；没有因编辑清单而勾选任务。

| 当前任务 | 更新 |
| --- | --- |
| 2.3、5.1、7.1 | 运行现有用例并记录结果；按缺失结果修复实现或补充断言 |
| 5.2 | 吸收原 5.3 的映射边界样例；原 5.3 不再作为独立任务 |
| 6.3 | 包审计和浏览器消费边界校验目标结构；生成器从已解析 Clip ID 构造固定相对路径 |
| 7.3 | 吸收原 9.2 的 `file://` 资源解析和静音状态迁移；原 9.2 不再作为独立任务 |

当前未勾选：2.3、5.1、5.2、5.5、6.2、6.3、6.4、7.1、7.3、8.2。调整记录见 [scope-changes.md](./scope-changes.md)。

## 6b. `converge-contracts-and-distribution` 后续验收合并（2026-11-09）

历史处置表保留 2026-11-09 审计时的 34 项未勾选状态。本轮合并验收项，没有把未执行的验证标为完成。

| 当前任务 | 更新 |
| --- | --- |
| F.1–F.2 | 合为一次隔离安装验收，覆盖 bundle 发布产物和 package-builder 消费路径；实现代码已存在，验证待运行 |
| F.3 | 并入 F.1–F.2；移除拦截源码读取的实现细节测试 |
| E.6 | 并入 H.2 全量验证 |
| F.5 | 并入 H.3 端到端链路 |
| H.5 | 并入 H.4 文档与范围核对 |
| G.2、G.4、G.5、G.7 | 移除固定波动比例、提速倍数、轮询间隔和提交粒度；保留实测、前后对照、检测延迟及未优化项记录 |

当前 `converge-contracts-and-distribution/tasks.md` 有 29 项未勾选。原 34 项中 5 个任务槽位经合并收敛；没有任务因本次编辑而标记完成。调整记录见 [scope-changes.md](./scope-changes.md)。

## 7. 未计入本索引的条目

- 本轮同批修正但原已勾选的条目：`export-playable-media` 2.2（编码措辞改为按生效 `--codec` 编码）、`export-playable-media` 5.4/5.5 之外的历史证据段、`verify-offline-release` 4.4（按 D-01/D-02 修正验收文字）。
- 已移出但不在 56 项内的旧任务：`export-playable-media` 3.1–3.3、3.5、4.1–4.2，`converge-contracts-and-distribution` I.1、B.4、E.5。
- 实施步骤与依赖门槛见 [DEPENDENCIES.md](./DEPENDENCIES.md)，统一状态判定见 [IMPLEMENTATION_BASELINE.md](./IMPLEMENTATION_BASELINE.md)。
