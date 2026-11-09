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
| `export-playable-media` | 7.3 | 模拟 DOM 与音频事件的菜单背景、音效、导航回归 |
| `export-playable-media` | 9.2 | 模拟 `file://` 资源解析、静音与恢复回归 |
| `fix-hdr-color-pipeline` | 7.5 | FFmpeg 滤镜链选择、返回状态、ffprobe 元数据与可计算帧数值 |
| `fix-hdr-color-pipeline` | 7.7 | SDR 编码输出的 BT.709 标记与帧级数值回归 |

### 新增任务

| Change | 任务 | 内容 |
| --- | --- | --- |
| `verify-offline-release` | X-AUDIT | 检查结果聚合优先级 `fail > not-verified > pass` |
| `verify-offline-release` | X-COMPARE | `compare` CLI 接线与独立参考对照 |

### 保留不变

菜单媒体编码与色彩策略、离线菜单运行时、影片目标映射、URL Protocol 请求能力、包审计、事务回滚、VM 回执与性能基准的功能范围。

### 本轮验收口径

计入验收：纯函数 URL/路径编码与参数构造、源目标安全约束、无服务离线资源引用检查、模拟浏览器事件与用户动作、合成媒体编码与 ffprobe 元数据、静态媒体计划、事务回滚、VM 回执、离线包审计。

不计入验收：特定桌面操作系统与第三方播放器组合的实机打开、关联与播放成功证明；HDR/UHD 素材的人工目视比对；HEVC 在浏览器与硬件解码环境下的播放记录。

### 计数说明

调整前活动 change 的未勾选任务为 56 项。其中 4 项按本记录移除，6 项替换或重写验收内容，另新增 2 项（X-AUDIT、X-COMPARE）。实际未完成数在 `tasks.md` 勾选前以文件内容为准，不使用算术推导。
