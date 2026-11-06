# Proposal

## Why

bdmvkit 生成了带 HDMV 导航、IGS 菜单、PGS 字幕和菜单循环点的完整 BDMV 盘，可作为真实一致的互操作输入。bdmv-web 当前对其中的随机播放、popup 场景与字幕播放存在明确缺口，循环点播放也缺少生成盘验证。

## What Changes

- 执行 HDMV `RND`，使随机与洗牌播放路径可运行并可复现测试。
- 从 IGS composition 保留 popup 属性，并将标题片段中的 popup 场景接入播放叠加与关闭行为。
- 从可达 M2TS 抽取并解析 PGS 字幕，将显示集、像素、轨道语言和源时间映射有界地写入当前媒体包，供后续播放集成使用。
- 验证运动菜单从 MPLS mark 循环时的起始时间与对应视频媒体时间映射。
- 固定 bdmvkit 源码 revision 与 LGPL-3.0-or-later 许可摘录到 `.reference-cache`，提供可重复的最小盘生成器和解析/运行时互操作 fixture。
- 将生成盘扩展为符合正常 authoring API 约束的多路径、多按钮、多音轨、多语言字幕案例，并以生成盘解析和资源抽取验证这些组合。
- 在 CLI 提供 IGS 图片与可达 PGS SUP 字幕的列举、按类型筛选和导出能力，输出只保留资源本身的基础信息。

## Capabilities

### New Capabilities
- `pgs-subtitle-playback`: 抽取、验证和序列化 Blu-ray PGS 字幕流及其来源映射。
- `menu-media-playback`: 按 HDMV 菜单 mark 精确循环运动背景并保留音轨时间对应。

### Modified Capabilities
- `hdmv-navigation`: `RND` 使用显式种子执行，并保持范围正确、重放可复现。
- `interactive-graphics-extraction`: 保留 popup composition 类型及来源片段关联，支持播放时叠加与关闭。

## Impact

涉及 `packages/hdmv` 的 VM 随机状态与 trace、`packages/igs` 的 ICS 模型和适配、`packages/media-export` 的 PGS 抽取/解析、`packages/package-builder` 的字幕数据与媒体清单、测试夹具和参考文档。PGS 解析结果暂不接入播放器；当前标题视频交给系统播放器的方式保持不变。参考源码固定为本地 bdmvkit revision `57890760c60b3c31dacc9db1112467d4510925aa`；参考缓存不进入发布包。测试案例由该 revision 生成，不复制其运行时实现到产品代码。
