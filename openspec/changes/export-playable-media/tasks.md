# Tasks

前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime。接口可提前消费；完成集成验收前必须取得上游契约及相关验收。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。文中命令/文件是目标交付物，当前未实现。

## 1. 可达闭包与计划

- [ ] 1.1 合并结构、MOBJ与按钮导航边计算保守闭包；验收：条件分支取并集，未知动态目标/探索超限不漏包或冒充完整。
- [ ] 1.2 生成media-plan及预算估算；验收：入口/边来源、Clip/PID/IN-OUT/轨道/策略均可追踪，缺文件与高级特性在转码前可见。
- [ ] 1.3 实现空间/maxOutputBytes前检与写中检查；验收：估算不足/写中超限安全abort并保留诊断。

## 2. 转码与时间表

- [ ] 2.1 接入FFprobe/FFmpeg探测及参数数组spawn；验收：记录版本/参数，无shell拼接，缺工具/编码器和特殊路径负例正确。
- [ ] 2.2 实现线性预合成、分支独立片段及背景循环资产；验收：H.264/AAC/faststart/比例/帧率/质量参数明确，不引用原M2TS。
- [ ] 2.3 实现job取消/超时/进程失败/缓存key及输出探测；验收：半成品不入manifest，坏缓存不复用，ffprobe失败不以退出0判成功。
- [ ] 2.4 实现MediaTimelineMap双向映射/半开边界/45k/epoch；验收：设计中225000→PI1源495000和线性2.5秒数值准确，重复Clip不碰撞。
- [ ] 2.5 实现章节seek/loadedmetadata/seeked校准；验收：跨PlayItem和非零PTS seek误差不超过一帧，实际成功后才反馈。

## 3. 播放、轨道与PGS

- [ ] 3.1 替换M4预览桥，连接播放/停止/PlayItem/结束/错误/返回；验收：相同菜单输入导航行为不变，媒体错误解除等待。
- [ ] 3.2 实现currentTime主时钟、pause/seek重建、有限/无限still与背景循环；验收：暂停冻结，回退不重放历史导航副作用。
- [ ] 3.3 实现pop-up在当前播放上下文叠加及generation取消；验收：换媒体/seek后旧Promise/ended/定时器不能污染当前状态。
- [ ] 3.4 实现主音轨本地变体/逻辑时间恢复/PSR闭环；验收：暂停切轨、播放切轨、失败回退状态正确，不依赖audioTracks。
- [ ] 3.5 实现普通PGS分段/对象/palette/位图及时间层；验收：独立像素golden、选择/off/seek/PSR闭环，PG不当IG或OCR文本。
- [ ] 3.6 为无缝/角度/PiP/HDR/强制字幕/TextST等未支持项建立影响报告；验收：可达缺口保留partial，不能关闭strict升级。

## 4. 集成与证据

- [ ] 4.1 接入standalone-full打包、资产闭包和状态；验收：缺必需资产failed，功能或验证缺口partial，资源全部包内。
- [ ] 4.2 执行菜单→正片→章节→切轨/字幕→pop-up→结束返回file://链路；验收：ffprobe/时间/trace/截图证据齐全，浏览器缺席不称complete。
