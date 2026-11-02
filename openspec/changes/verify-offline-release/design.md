# Design

## Context

依赖 M0–M5，对应架构 §9.5、§12–13、§15。共享状态表见 [实施基线](../IMPLEMENTATION_BASELINE.md)。OpenSpec validate 仅校验规划格式，产品 validate/compare 属于本 change，不能混为一项验收。

## Goals / Non-Goals

**Goals:** 独立包校验、完整度/strict 决策、trace/IG 对照、V1 Chrome 证据、可复现发布证据。

**Non-Goals:** 替前置模块补业务实现、执行 BD-J、假设未验证浏览器通过、把参考工具作为输出运行依赖。

## Decisions

### 1. validate 只依赖输出包

先读 manifest/schema，再核对资产存在/大小/SHA-256、实体引用、命令支持、时间表、所有运行文件 URL 和证据。缺报告也显式记录，不能相信包里已有 status。输出 checks[] 含 checkId/result(pass/fail/not-verified)/entityId/source/evidence，报告保留输入包指纹。

payloadFingerprint 覆盖运行 HTML/JS/CSS/数据/图形/媒体及相对路径，不含 reports，避免兼容报告自引用。manifest 列出 payload；报告/证据另以 hash 和生成工具版本关联。资产改一字节、bundle 改动、模式/profile/矩阵变化都会使相关证据失效；不复用不同制品的截图。

### 2. 离线和路径审计

HTML src/href/srcset、CSS url/@import、数据脚本/IR 资产、JS 静态资源入口分别解析，统一 URL 归一化及 realpath containment。拒绝 http/https、协议相对地址、原盘 file URL、编码后的目录逃逸、外部 symlink、远程嵌套资源。不把说明文字中的参考网址误判为运行依赖。

仅允许生成器声明的 PNG/音频等 data MIME 与内容；禁止可执行 HTML/SVG 数据载荷和嵌套远程引用。JS 构建检查模块/import/eval/网络 API，并结合浏览器断网运行观察；静态扫描不能证明任意 JS 永不联网，证据要同时覆盖构建来源与运行路径。报告指出具体文件/字段/归一化目标，不能只输出“发现外部地址”。

### 3. 完整度决策与覆盖分母

按共享表从 failed → partial → complete 判定。strict 只改变接受策略/退出码，不改变能力事实。acknowledgement 仅可记录接受的降级，不能清除 unresolved/unsupported 或升级为 complete。menu-only 永远 partial；纯 BD-J 无有效 HDMV 启动为 failed。

覆盖分别报告：声明/可达/未知入口数、可达指令编码及实例数、受支持/未支持/非法数、媒体需求/已导出/缺失、测试路径/通过/失败/未验证。100% 必须同时有明确分母、无可达未知项、逐项证据；零分母记 N/A 并说明，不自动 100%。有限状态探索不能证明所有动态输入时，保留 unknown 并阻止全碟完整承诺。

### 4. 参考对照

compare 输入序列文件含 fixtureId/sourceLabel、PlayerProfile、初始寄存器/稳定入口、确定性 seed、按逻辑时间排序的用户/媒体事件。适配 libbluray/BDedit 等可用参考输出，记录工具版本/调用方法；不为外部原盘样本生成哈希。参考资料缺席为 not-verified，不能用自身 trace 自证。

VM 比对 PC/寄存器 delta/栈/场景/播放动作，忽略墙钟、会话随机 ID 等非语义字段；差异报告首个分歧及双方源位置。IG 纯图层按相同分辨率/时间戳/颜色规则逐像素比较，要求不透明及透明 RGBA 规则一致；视频转码另报质量，不把视频编码误差算 IG 错误。需要容差的浏览器合成截图单独记录容差及原因，不能替代 PNG 解码零差异标准。

### 5. 矩阵与 A–J 证据

V1 唯一必测环境为 macOS Google Chrome。M0 建立单行模板，M4/M5 记录冒烟，M6 锁定实际 macOS build、Chrome 完整版本及自动化工具版本；不在没有机器时编造通过。直接 `file://`、断网、无后台、移走原碟、复制到中文/空格新路径；人工双击测试也保存可复查记录，HTTP 冒烟不能替代。跨系统和其它浏览器的覆盖留给后续版本，不阻断 V1。

| 场景 | 验收主责与证据 |
| --- | --- |
| A 静态三态 | M2/M4；PNG、坐标与交互 trace |
| B 动态背景/音效 | M4/M5；循环、首次手势、音频实播 |
| C 多页/条件 | M3/M4；页/焦点/返回/寄存器 |
| D 多 PlayItem/章节 | M5；TimelineMap、seek 误差与结束反馈 |
| E Pop-up | M3/M5；视频上下文、UO mask、叠加画面 |
| F 分片/调色板/动画 | M2/M4；逐像素、版本、时序 |
| G PSR/GPR/Call/Resume | M3/M5；参考 golden trace/切轨 |
| H 混合 BD-J | M1/M6；入口保留、partial/strict 退出2 |
| I 破损/缺失/循环 | 各模块/M6；预算内终止与准确诊断 |
| J Chrome 环境/分辨率/路径 | M4–M6；Chrome 版本、DPI、移动包证据 |

每份证据含 caseId/fixtureId/inputSequence/profile/payloadFingerprint/browser OS版本/expected/actual/result/artifactPaths。视频、音效测试要记录实际可观察结果，不以 API 无异常代替有声播放。

### 6. 发布与失败保留

validate 生成 compatibility.json/dependency-audit.json/asset-manifest.json 和人读摘要；compare/Chrome 证据在 reports/evidence 下。发布清单要求 V1 Chrome 场景通过、无功能阻断/未知支持、manifest 一致、运行包无开发依赖及说明完整。任一项缺席为 partial 或 failed，并列出下一步，不勾选不存在的通过。M6 没有重新定义此前能力范围的权力。

## Verification / Exit Criteria

决策表驱动测试覆盖 complete 候选、menu-only、混合/纯 BD-J、unknown opcode、缺媒体、篡改资产、缺浏览器证据及 acknowledged Error。URL 负例含双重编码/反斜杠/协议相对/data 嵌套/symlink；合法中文/百分号与说明网址不过度拦截。A–J 对应实际证据，无法取得环境时准确保留未验证，不能宣布发布完成。

## Risks / Trade-offs

V1 Chrome/独立参考证据决定首版发布承诺；自动化和人工证据可混合，不能用缩减场景分母隐藏缺席。静态审计与断网测试互补，单项无法给出普遍证明。

## Migration Plan

对已有 M4/M5 产物可重新 validate，不需要原碟；不兼容 schema 明确拒绝，重新转换后重建证据。
