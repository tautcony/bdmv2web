# Tasks

前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime。可提前开发，但完成集成验收前必须满足上游验收。

## 1. 实施与验证

- [ ] 1.1 实现保守可达性分析及未知分支处理，验证不会遗漏可能播放的资源。
- [ ] 1.2 接入 FFprobe/FFmpeg 转码及失败诊断，验证参数数组、临时输出和 H.264/AAC 本地播放。
- [ ] 1.3 建立 PlayItem、源时间、输出偏移与章节映射，验证 45 kHz 转换、回绕及 seek。
- [ ] 1.4 实现播放桥、结束、still、pop-up 与 generation token，验证暂停、seek 和过期回调。
- [ ] 1.5 实现已声明的轨道变体和图形字幕路径，验证切换与 PSR 同步；未支持项给出诊断。
- [ ] 1.6 接入 standalone-full 打包和媒体缺失判定，验证多 PlayItem 菜单到影片返回的离线链路。
