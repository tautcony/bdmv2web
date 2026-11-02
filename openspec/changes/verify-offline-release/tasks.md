# Tasks

前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime、export-playable-media。可提前开发，但完成集成验收前必须满足上游验收。

## 1. 实施与验证

- [ ] 1.1 实现 validate 的 schema、资产 hash、URL 解析和目录边界审计，验证远程、缺失与越界负例。
- [ ] 1.2 实现 complete/partial/failed 和 strict 决策表，验证 BD-J、未知命令、缺失媒体及 menu-only。
- [ ] 1.3 构建协议截断、尺寸、路径与循环回归样本，验证安全终止和诊断。
- [ ] 1.4 建立 compare 的 VM trace 和 IG 画面参考流程，验证指定路径差异可定位。
- [ ] 1.5 锁定 Windows Chrome/Edge、macOS Chrome/Safari 与 Firefox 版本并记录断网 file://、移动目录、中文路径和播放结果。
- [ ] 1.6 建立场景 A–J 的验收证据及发布清单，验证无证据或失败项阻止 complete。
