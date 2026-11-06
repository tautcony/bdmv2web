# Tasks

当前 validate 已有包内 schema、引用、manifest、启动项及必需资产检查；external target 与系统播放器状态仍需按当前交接模型补齐验收。任务描述区分已存在实现和未验证证据。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列行为案例及结果；未取得参考或环境证据不得勾选对应验收。M6 原语位于 `packages/test-runner/src`；`validate --offline` 生成当前 `compatibility.json`、`dependency-audit.json` 和 `reports/release-summary.json`，缺失的浏览器、覆盖率或参考证据列为 actionable gap。浏览器、跨阶段 M4/M5 制品和参考 golden 仍须按后续门槛完成。

## 1. 独立包检查

- [ ] 1.1 回归现有 validate schema/引用/manifest/启动资产检查；实现已检查 `index.html` 存在且为必需 manifest 项，并检查必需文件缺失。验收仍需覆盖无原碟/FFmpeg运行、manifest 缺启动项及必需资产缺失。
- [x] 1.2 解析HTML/CSS/数据/JS资源入口并统一URL/realpath检查；验收：远程/协议相对/file原盘/编码逃逸/外symlink均定位，合法中文/百分号路径和说明链接不误报。
- [ ] 1.2a 补齐 external target 审计验收：确认包内 runtime 资源只允许包内引用，声明的影片目标只来自输入 BDMV 的 `STREAM/*.m2ts`；外部配置的实际路径和系统关联状态标为未验证，路径逃逸不得作为有效目标。
- [x] 1.3 限制data MIME并检查嵌套依赖和bundle禁用入口；验收：HTML/SVG执行载荷与远程嵌套拒绝，已生成PNG data允许。
- [x] 1.4 生成dependency-audit及checks[]；验收：每项有pass/fail/not-verified和具体字段/证据，不盲信旧status。

## 2. 完整度与覆盖

- [x] 2.1 以共享决策表实现failed/partial/complete和strict退出码；验收：menu-only、混合/纯BD-J、unknown opcode、缺媒体、缺证据逐行测试。
  - 历史完成记录：对应旧的模式与状态规则；新产品边界须按下项重新验收。
- [ ] 2.1a 按当前一种 convert 菜单产物（CLI/manifest/report 模式字段为 `menu-only`）更新共享决策表和 strict 退出码；覆盖外部系统交接不可用/未验证、混合/纯 BD-J、unknown opcode、缺源 M2TS 和缺证据。
- [x] 2.2 实现acknowledged错误和降级记录；验收：不删除原严重性/影响，strict策略变化不提升能力状态。
- [x] 2.3 实现入口/指令/媒体/测试的分母和未知计数；验收：零分母N/A、探索超限unknown，不能报虚假100%。

## 3. 差分与安全回归

- [x] 3.1 定义compare输入序列/PlayerProfile/初始寄存器/seed和参考工具适配；验收：记录fixture ID或样本标签及工具版本，不生成原盘素材哈希，参考缺席not-verified。
- [x] 3.2 实现VM语义trace首差异报告；验收：已知寄存器/栈/动作偏差可回到源指令，忽略非语义墙钟。
- [x] 3.3 实现独立IG像素对照和视频质量分离；验收：调色板/alpha/时序偏差准确定位，视频编码噪声不混入IG判定。
- [x] 3.4 汇总截断/超尺寸/路径/跳转环安全回归；验收：预算内终止，诊断准确且源/旧输出不变。

## 4. 浏览器与发布

- [x] 4.1 锁定 V1 Google Chrome 完整版本并执行断网 `file://`；验收：无后台/原盘，记录 Chrome 版本、console/资源/有声结果，缺席不假通过。验收不限定操作系统，也不要求跨浏览器矩阵。实测记录见 [M6 验收证据](../../../docs/references/stages/M6-release-verification.md#v1-chrome-file-验收-2026-11-03)。
- [ ] 4.2 按当前产品边界完成适用场景和系统默认播放器交接证据：菜单启动/导航/音效、直接 file://、移动目录、中文空格路径、DPI、源缺失、播放策略恢复与 URL Protocol 请求。外部播放器负责正片控制、章节和字幕；记录 expected/actual/result、Chrome 与播放器版本及操作系统。
- [ ] 4.3 对齐浏览器 evidence binding 和采集记录：按 profile/mode/生成媒体路径/矩阵/Chrome 环境判断适用性。当前 binding 还将生成媒体 byteLength 纳入变化比较；按仓库交付规则移除长度作为发布证据门槛，再按新边界采集和验证证据。
- [x] 4.4 生成最终compatibility/audit/manifest/发布摘要和README；验收：只有全部门槛满足可complete，失败/未验证列具体缺口，完整包无开发/参考工具依赖。
