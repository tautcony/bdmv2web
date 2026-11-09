# 活动 change 的范围变更记录

本文件记录活动 change 的目标与验收范围调整。任务 ID 对应各 change 的 `tasks.md`；被移除的编号不再作为待办任务，也不以 `[x]` 表示已验收。

## 2026-11-09 验收范围调整

### 移除的验收项

| Change | 任务 | 原验收内容 | 现处置 |
| --- | --- | --- | --- |
| `export-playable-media` | 6.1 | macOS/IINA 与 Windows/PotPlayer 实机 URL Protocol 打开验证 | Removed |
| `export-playable-media` | 7.2 | 断网、移动包、源有效/缺失时的人工菜单动作观察记录 | Removed |
| `fix-hdr-color-pipeline` | 7.6 | 真实 UHD 菜单 Clip 的人工目视比对 | Removed |
| `fix-hdr-color-pipeline` | 7.8 | HEVC 产物的跨浏览器播放记录 | Removed |

### 替换与重写的验收项

| Change | 任务 | 现验收内容 |
| --- | --- | --- |
| `verify-offline-release` | 4.2 | 离线包迁移、路径解析、URL 编码、协议请求模拟、事件恢复的自动化测试；编号不变 |
| `export-playable-media` | 6.2 | 纯函数与模拟浏览器事件：路径编码、时间偏移、`requested`/`unavailable`/`unknown` 结果 |
| `export-playable-media` | 7.3 | 模拟 `file://` 页面中的菜单背景、音效、导航、静音与恢复回归；吸收 9.2 |
| `export-playable-media` | 9.2 | 静音和资源解析验收并入 7.3，不重复建立测试任务 |
| `fix-hdr-color-pipeline` | 7.5 | FFmpeg 滤镜链选择（仅 `zscale` 单链）、返回状态、ffprobe 元数据与可计算帧数值 |
| `fix-hdr-color-pipeline` | 7.7 | SDR 编码输出的 BT.709 标记与帧级数值回归 |

### 新增任务

| Change | 任务 | 内容 |
| --- | --- | --- |
| `verify-offline-release` | X-AUDIT | 检查结果聚合优先级 `fail > not-verified > pass` |
| `verify-offline-release` | X-COMPARE | `compare` CLI 接线与独立参考对照 |

### 保留不变

菜单媒体编码与色彩策略、离线菜单运行时、影片目标映射、URL Protocol 请求能力、包审计、事务回滚、VM 回执与性能基准的功能范围。

## 2026-11-09 任务验收收敛

| Change | 任务 | 调整 |
| --- | --- | --- |
| `export-playable-media` | 2.3、5.1、7.1 | 运行现有验收并记录结果；按缺失结果修复实现或补充断言 |
| `export-playable-media` | 5.2、5.3 | 合并为 5.2；同一映射验收覆盖多 PlayItem、重复 Clip、非零 IN/OUT、缺失源和未知目标 |
| `export-playable-media` | 6.3 | 包审计与浏览器消费边界校验外部目标；生成器从已解析 Clip ID 构造固定相对路径 |
| `export-playable-media` | 7.3、9.2 | 合并为 7.3；在模拟 `file://` 页面覆盖音源静音、自动恢复、手动静音与导航 |

验收边界涵盖离线菜单运行、外部目标映射、协议请求和菜单音频状态；外部播放器启动结果与外部源可用性记为不可观测。

## 2026-11-09 `converge-contracts-and-distribution` 验收合并

| 原任务 | 当前归属 | 调整 |
| --- | --- | --- |
| E.6 | H.2 | runtime-web 与 headless 导航回归由全量验证一次覆盖 |
| F.3 | F.1–F.2 | 删除源码读取拦截测试；隔离安装构建直接验证发布包不依赖 workspace `src/` |
| F.5 | H.3 | convert 产物与离线校验回归并入端到端链路 |
| H.5 | H.4 | 系统播放器交接、无浏览器内正片及无额外 CI 的范围核对并入文档与范围核对 |

F.1–F.2 改为验收已存在的 bundle 导出与 builder 消费实现。隔离安装验收仍未执行，不以代码存在标记任务完成。

性能验收保留基准与数据支撑要求。G.2 不设统一波动百分比；G.4 不强制实现方式、固定提速倍数或提交粒度；G.5 依测量选择轮询间隔并记录检测延迟；G.7 只要求记录未优化项的测量结论和适用触发条件。

### 本轮验收口径

计入验收：纯函数 URL/路径编码与参数构造、源目标安全约束、无服务离线资源引用检查、模拟浏览器事件与用户动作、合成媒体编码与 ffprobe 元数据、静态媒体计划、事务回滚、VM 回执、离线包审计。

不计入验收：特定桌面操作系统与第三方播放器组合的实机打开、关联与播放成功证明；HDR/UHD 素材的人工目视比对；HEVC 在浏览器与硬件解码环境下的播放记录。

### 计数说明

调整前活动 change 的未勾选任务为 56 项。其中 4 项按本记录移除，6 项替换或重写验收内容，另新增 2 项（X-AUDIT、X-COMPARE）。实际未完成数在 `tasks.md` 勾选前以文件内容为准，不使用算术推导。

逐项处置与当前状态见 [task-disposition-index.md](./task-disposition-index.md)。

## 2026-11-09 色调映射链收敛

`fix-hdr-color-pipeline` 原本实现 `zscale`（libzimg）与 `libplacebo` 两条色调映射链。`libplacebo` 分支在本项目可获得的 FFmpeg 构建上都不可执行，因此不再作为能力保留：

| 项 | 处置 |
| --- | --- |
| `planVideoColor` 的 `hasLibplacebo` 选项与 `libplacebo-tonemap` 链 | 删除；`ColorFilterChain` 只保留 `zscale-tonemap` / `hdr-passthrough-fallback` / `passthrough` |
| `ffmpeg -filters` 探测 | 只探测 `zscale` |
| 降级路径 | 不变：缺 `zscale` 时按 `preserve` 编码并给 `MEDIA_HDR_TONEMAP_UNAVAILABLE` warning |
| 验收 | 7.5 只验证 `zscale` 链；原先“第二条链未验证”的缺口随实现删除而消失 |

理由：只保留一条能在本项目环境内真实验证的 HDR 能力链，避免出现“文档不提、代码留着、又无执行证据”的分支。需求表述同步改为“使用 `zscale`（libzimg）链；不可用时降级”，已写入主规格 `openspec/specs/offline-media-playback/spec.md`（`fix-hdr-color-pipeline` 于 2026-11-09 归档）。

## 2026-11-09 历史包 fixture 验收移出

| Change | 任务 | 处置 | 内容 |
| --- | --- | --- | --- |
| `converge-contracts-and-distribution` | B.7 | Removed | 移除历史菜单包 fixture、读取该 fixture 的审计用例和独立兼容性验收要求 |
