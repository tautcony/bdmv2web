# Design

## Context

依赖 M0–M5，对应架构 §9.5、§12–13、§15。共享状态表见 [实施基线](../IMPLEMENTATION_BASELINE.md)。OpenSpec validate 仅校验规划格式，产品 validate/compare 属于本 change，不能混为一项验收。

## Goals / Non-Goals

**Goals:** 独立包校验、完整度/strict 决策、trace/IG 对照、可复现发布证据。

**Non-Goals:** 替前置模块补业务实现、执行 BD-J、把参考工具作为输出运行依赖、外部播放器的实机打开与人工音画验收、跨浏览器解码能力记录。

## Decisions

### 1. validate 只依赖输出包

先读 manifest/schema，再核对资产存在、实体引用、命令支持、影片目标、所有运行文件 URL 和证据。缺报告也显式记录，不能相信包里已有 status。输出 checks[] 含 checkId/result(pass/fail/not-verified)/entityId/source/evidence。

manifest 可列出运行文件路径和长度作为清单信息。审计不计算文件内容摘要，也不用文件长度判定交付通过。

### 2. 离线和路径审计

HTML src/href/srcset、CSS url/@import、数据脚本/IR 资产、JS 静态资源入口分别解析，统一 URL 归一化及 realpath containment。拒绝 http/https、协议相对地址、未经授权的外部 file URL、编码后的目录逃逸、外部 symlink、远程嵌套资源。已声明且经过 BDMV STREAM 约束验证的源 M2TS 交接引用单独审计，不能用于加载菜单资源。不把说明文字中的参考网址误判为运行依赖。

仅允许生成器声明的 PNG/音频等 data MIME 与内容；禁止可执行 HTML/SVG 数据载荷和嵌套远程引用。JS 构建检查模块/import/eval/网络 API，并用模拟资源解析覆盖运行期入口；静态扫描不能证明任意 JS 永不联网，证据要同时覆盖构建来源与运行路径。报告指出具体文件/字段/归一化目标，不能只输出“发现外部地址”。

### 3. 完整度决策与覆盖分母

按共享表从 failed → partial → complete 判定。`complete` 表示无已知交付失败证据；未执行或不可观察的检查进入 `notVerified`，不改变状态。检查结果聚合优先级为 `fail > not-verified > pass`，空集合为 `not-verified`。strict 只改变接受策略/退出码，不改变能力事实。acknowledgement 仅可记录接受的降级，不能清除 unresolved/unsupported 或升级为 complete。外部影片目标请求的结果在浏览器中不可观测，记入 `notVerified`；纯 BD-J 无有效 HDMV 启动为 failed。

覆盖分别报告：声明/可达/未知入口数、可达指令编码及实例数、受支持/未支持/非法数、影片目标/已映射/缺失或未验证、测试路径/通过/失败/未验证。100% 必须同时有明确分母、无可达未知项、逐项证据；零分母记 N/A 并说明，不自动 100%。有限状态探索遇到动态输入时保留 unknown，该碟的完整度记为 unknown。

### 4. 参考对照

compare 输入序列文件含 fixtureId/sourceLabel、PlayerProfile、初始寄存器/稳定入口、确定性 seed、按逻辑时间排序的用户/媒体事件。适配 libbluray/BDedit 等可用参考输出，记录工具版本/调用方法；不为外部原盘样本生成内容指纹。参考资料缺席为 not-verified，不能用自身 trace 自证。

VM 比对 PC/寄存器 delta/栈/场景/播放动作，忽略墙钟、会话随机 ID 等非语义字段；差异报告首个分歧及双方源位置。使用同类工具对同一现有案例生成参考输出，记录工具版本及导出条件；IG 纯图层按相同分辨率/时间戳/颜色规则逐像素比较，要求不透明及透明 RGBA 规则一致；菜单背景视频另报质量，不把视频编码误差算 IG 错误。逐元素比较各按钮状态引用的 PNG 资源，整页合成截图不作为图像保真验收前提。

### 5. 矩阵与 A–I 证据

菜单直接从文件系统打开，包复制到中文/空格新路径后由自动化检查复跑；影片交接以协议目标构造和模拟交接事件验证，源 M2TS 可读性与外部程序执行记为未验证。

| 场景 | 验收主责与证据 |
| --- | --- |
| A 静态三态 | M2/M4；PNG、坐标与交互 trace |
| B 动态背景/音效 | M4/M5；循环、首次手势、音频状态的模拟事件断言 |
| C 多页/条件 | M3/M4；页/焦点/返回/寄存器 |
| D 多 PlayItem/影片目标 | M5；PlayItem 区间、构造的目标与请求结果类别；章节由外部播放器负责 |
| E Pop-up | M3/M4；仅验证已打包的菜单 popup；外部播放器中的正片不由网页叠加控制 |
| F 分片/调色板/动画 | M2/M4；IG 图像逐像素对照；动画和效果无时序 golden 时保持未验证 |
| G PSR/GPR/Call/Resume | M3；参考 golden trace，外部播放器状态不假定可回传 |
| H 混合 BD-J | M1/M6；入口保留、partial/strict 退出2 |
| I 破损/缺失/循环 | 各模块/M6；预算内终止与准确诊断 |

每份证据含 caseId/fixtureId/inputSequence/profile/generatedMedia/expected/actual/result/artifactPaths。视频证据取编码命令、ffprobe 元数据与可计算帧数值；音频证据取模拟事件后的状态迁移与静音标志。文件长度不作为发布验证条件，制品内容指纹不属于证据字段。

### 6. 发布与失败保留

validate 生成 compatibility.json/dependency-audit.json/asset-manifest.json 和人读摘要；compare 证据在 reports/evidence 下。发布清单要求声明范围内的场景有自动化证据、无功能阻断/未知支持、manifest 一致、运行包无开发依赖及说明完整。缺口按检查类别进入 `notVerified` 并列出下一步，不改变由失败证据决定的 `status`；不勾选不存在的通过。M6 没有重新定义此前能力范围的权力。

## Verification / Exit Criteria

决策表驱动测试覆盖 complete 候选、请求结果不可观测、混合/纯 BD-J、unknown opcode、缺媒体、acknowledged Error 与 `fail + not-verified` 混合。URL 负例含双重编码/反斜杠/协议相对/data 嵌套/symlink；合法中文/百分号与说明网址不过度拦截。A–I 对应自动化证据，无法取得参考时准确保留 `not-verified`。发布声明不包含外部程序的实机播放结果。

## Risks / Trade-offs

独立参考证据决定首版发布承诺；自动化和人工证据可混合，不能用缩减场景分母隐藏缺席。静态审计与断网测试互补，单项无法给出普遍证明。

## Migration Plan

对已有 M4/M5 产物可重新 validate，不需要原碟；不兼容 schema 明确拒绝，重新转换后重建证据。
