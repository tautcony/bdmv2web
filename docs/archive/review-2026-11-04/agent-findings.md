# Sub Agent 候选发现与核验记录

> 日期: 2026-11-04
> 范围: `614b4fe..9b86daa`
> 方式: 3 个互不重叠的独立审查 agent（解析层 / CLI 状态链 / 运行时与产出），主 agent 逐条复核并复现

## 分派概览

| Agent | 范围 | 重点 |
| --- | --- | --- |
| A | `bdmv-parser`（parser/model/test）+ `.reference-cache/libbluray-1.5.0` | 新增 INDX/MPLS/CLPI 字段布局、位对齐、越界与"拒绝合法输入"风险 |
| B | `apps/cli` + `test-runner` + `package-builder` 的状态写入 | 阶段/交付状态、退出码、参数契约、report.json 与审计白名单 |
| C | `runtime-web` + `package-builder` 的 HTML/CSS + `test-fixtures` | profile 穿透、toast、全屏布局、测试有效性 |

主 agent 在 agent 运行期间独立完成：门禁复跑、CLI 失败路径实测（fatal/缺值/拼错参数）、`git status` 洁净性核对。2026-11-05 用户独立复扫补入 2 条（AF-33/34），主 agent 已按同一路径复现并记录实测输出。

## 候选发现与处置

| 编号 | 来源 | 候选结论 | 处置 | 说明 |
| --- | --- | --- | --- | --- |
| AF-01 | A | UHD 扩展解析失败升级为 index fatal | **采纳** → `P1-P1-1` | 主 agent 复读 `parser.ts:65-107,456`、`parser.test.ts:388-401`，确认 entries 变空且测例固化了该行为；与 `index_parse.c:284-289` 的忽略语义对照成立 |
| AF-02 | A | INDX AppInfo `end > section` 是参考实现没有的硬校验 | **采纳并合并** → `P1-P2-1` | 归入"比参考实现更严格"一类，与 AF-03 同源；无真实反例 |
| AF-03 | A | 扩展区上界用声明长度而非文件尾 | **采纳并合并** → `P1-P2-1` | 同上 |
| AF-04 | A | CLPI seq/TS 长度校验会丢弃可播 CLPI | **采纳** → `P1-P2-2` | 真实样本全部规范，标为"无样本的风险" |
| AF-05 | A | 0x24 只读部分属性位 | **采纳（降级）** → `P1-INFO-1` | 不影响已有字段取值，属信息缺失 + 注释误导 |
| AF-06 | A | 新增诊断路径 offset 落 0 | **采纳（降级）** → `P1-INFO-2` | 既有模式，但本轮新增分支扩大了面积 |
| AF-07 | A | 真实 UHD 的 0x24 未断言 | **采纳（降级）** → `P1-INFO-3` | 属测试缺口，非缺陷 |
| AF-08 | A | MPLS 0x24 要求 `attrLen>=5` 是本轮新增的更严格限制 | **驳回** | 与改动前 `skip(4)` 的等价要求一致（旧代码同样要求 4 个属性字节），不是本轮回归；且 `attrLen=4` 是否合法无法从本地白皮书确认 |
| AF-09 | A | INDX 扩展 entry 表 `count` 偏移可能差一字节 | **驳回** | 逐字节核对 `battle-royale-uhd`：`length u32` + `s32` + 24 bit padding + `count u8`，entry 从 +12 开始，实现正确 |
| AF-10 | A | `supportedVersions` 加 `0240` 有风险 | **驳回** | 与 `bdmv_parse_header` 的四个版本白名单完全一致，不误伤 3D |
| AF-11 | B | 阶段失败输出用 `status` 而非 `stageStatus` | **采纳（降级）** → `P2-INFO-2` | 实测确认输出为 `{"status":"failed"}`，但同一份 spec 的「缺少必需入口」场景明确要求 `status: "failed"`，属 spec 内部矛盾，不是实现单方面错误 |
| AF-12 | B | `convert` 交付状态恒 partial，三处结论源打架 | **采纳** → `P2-P2-3` | 复读 `index.ts:429-444` + `decisions.ts:100-113`；实测 tamako `status=partial`、reasons 首条 "No audit checks were supplied." |
| AF-13 | B | 未知/拼错选项静默忽略 | **采纳** → `P2-P2-2` | 实测 `--stric` exit 0、`--ou` 写到默认目录（已清理该次测试产生的目录） |
| AF-14 | B | `validate` 在解析 `--format` 前已写报告 | **采纳** → `P2-P2-1` | 复读 `index.ts:457,516-517,524`；实测 `validate --offline --format` exit 1 但三份报告已生成 |
| AF-15 | B | `--player-profile` 校验弱于 PSR 规则 | **采纳** → `P2-P2-4` | 对照 `registers.ts:45-49` 与 `index.ts:71-79`；失败在事务前，不产坏包 |
| AF-16 | B | 失败 report.json 与成功 schema 不一致 | **采纳** → `P2-P2-5` | 复读两处写入点 |
| AF-17 | B | convert 只对解析阶段做 fatal 门禁 | **采纳（降级）** → `P2-INFO-1` | 当前无 fatal 生产者，不可触发 |
| AF-18 | B | `inspect --allow-partial` 在 fatal 下 exit 0 违反 spec | **驳回（转文档项）** | `restore-.../tasks.md` 4.4 明确要求该行为，spec 缺例外条款；已在 `P2-INFO-2` 一并说明 |
| AF-19 | B | `report.json` 不被 `validate` 消费，可陈旧/被篡改 | **驳回（设计意图）** | `release-summary.ts` 明确"persisted status is never trusted"；"忽略"是刻意的，记为观察项而非缺陷 |
| AF-20 | B | `--out` 值以 `--` 开头被判缺值 | **驳回** | 属有意的旗标判定，`--out=--weird` 可用；写入 README 即可 |
| AF-21 | C | `disc-title` 死代码被测试固化 | **采纳（降级）** → `P3-INFO-1` | grep 确认 HTML 无该元素、`browser.ts:99` 仍写入、两处测试互相矛盾 |
| AF-22 | C | 需要用户行动的提示 4.5s 消失 | **采纳** → `P3-P2-1` | 对比改动前为常驻文本；发生在失败路径，价值最高的时刻 |
| AF-23 | C | `contain` 导致 video/canvas 各自 letterbox | **采纳** → `P3-P2-2` | 旧 CSS 的 `fill` + `aspect-ratio` 消除了该风险，换成 `contain` 后保证消失；仅在素材比例与 scene 不同时暴露 |
| AF-24 | C | `createMenuVm` 只判 object，未知键静默降级 | **采纳（降级）** → 并入 `P3-INFO-1` 的漏检复盘 | 无越界/注入风险，畸形值由 `RegisterFile` 抛错兜底 |
| AF-25 | C | 首帧未 resize | **采纳（降级）** → `P3-INFO-4` | pre-existing，被全屏布局放大 |
| AF-26 | C | `statusToast` 模块级单例可能绑定陈旧元素 | **驳回** | 静态 HTML + 顶层只 `boot()` 一次，生产不可达；测试用 `vi.resetModules()` |
| AF-27 | C | `role=alert` 被显式 `aria-live=polite` 覆盖 | **残留疑点** | ARIA 规范上成立，但影响仅限读屏播报优先级，未纳入 findings |
| AF-28 | C | canvas backing store 无上限（4K+DPR2 约 132MB） | **残留疑点** | 需要真实设备验证，暂不改 CSS |
| AF-29 | B | `extract` 先跑 IGS 提取再判 fatal | **采纳（降级）** → `P2-INFO-3` | 只白跑 I/O，不产错误结果 |
| AF-30 | B | `PLAYER_PROFILE_KEYS` / `stage` / `mode` / `reportedStatus` 死代码 | **采纳（降级）** → `P2-INFO-4` | 无 `noUnusedLocals`，编译不报 |
| AF-31 | C | 默认 profile 两处手抄、无 parity 测试 | **采纳（降级）** → `P3-INFO-2` | 已在 D3（第 2 批）登记，非本轮新增 |
| AF-32 | 主 agent | 默认 5s 超时导致负载下假失败 | **采纳** → `P4-P2-1` | 同一提交同一条命令，空载/负载结果不同；已两次复现。**2026-11-05 更正**：47s 用例在 `runtime-web` 且已显式 `120_000`，不在 `hdmv` |
| AF-33 | 用户复扫 | `dependency-audit.json` 落盘与 stdout/summary 不一致 | **采纳** → `P2-P2-6` | 构造只含 README+report.json 的失败包实测：磁盘 `checks: []`，stdout 为 `["DEPENDENCY_AUDIT_REQUIRED"]` |
| AF-34 | 用户复扫 | 失败包缺 manifest 时 mode 回落 `standalone-full` | **采纳** → `P2-P2-7` | 实测 decision / compatibility / release-summary / stdout 四处全为 `standalone-full`，`report.json` 是 `menu-only` |

## 双人核验记录

- `P1-P1-1`（P1）：主 agent 已复读 `parser.ts:65-107,456`、`choose()` 的 fatal 升级路径、`parser.test.ts:388-401`；独立 agent 提供 libbluray 对照（`index_parse.c:284-289`）。**证据更正**：`extdata_parse.c` 不在本地缓存，原记录的"该文件同样忽略返回值"无法核对，已从结论中移除，仅保留调用点不检查返回值这一事实。
- `P2-P2-3`（P2）：主 agent 复读 `decisions.ts` 全部条件与 CLI 调用点，并实测转换输出；原候选"字段语义违例"中的冲突部分因当前不可复现而降级为"潜在冲突"。
- `P2-P2-2` / `P2-P2-1`（P2）：均由主 agent 亲自执行命令复现，非仅凭 agent 描述；测试产生的 `test-data/bdmv/tamako-love-story-bd/BDMV-menu` 已删除，`git status` 恢复洁净。

## 统计

- 候选: 34（31 条来自 3 个独立 agent；1 条 AF-32 由主 agent 门禁实测补充；2 条 AF-33/34 由用户复扫补充）
- 形成 finding: 25（P1 1 / P2 12 / INFO 12）
- 合并: 2 条 AF 合并为 1 条 finding（AF-02、AF-03 → `P1-P2-1`）；AF-24 并入 `P3-INFO-1` 的漏检复盘，不单独成条
- 驳回 / 降级为观察项: 7（AF-08、09、10、18、19、20、26）
- 残留疑点（未纳入 findings）: 2（AF-27、AF-28）
- 口径校验: 34 − 1（合并）− 1（并入复盘）− 7（驳回）− 2（残留）= 23 条可追溯到 AF 行；另 2 条无 AF 行（`P3-INFO-3`、`P4-INFO-1`）= 25
- **上一版统计错误**：写作"候选 32（28 agent + 4 主 agent）"，但表中实际是 31 条 agent + 1 条主 agent；且 32 减 7 条驳回再减 2 条合并/并入后无法得到 23。已按表逐行重算。
