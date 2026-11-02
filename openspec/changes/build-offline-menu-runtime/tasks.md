# Tasks

前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation。可提前开发，但完成集成验收前必须满足上游验收。

## 1. 实施与验证

- [ ] 1.1 生成 classic JS、转义后的数据脚本和本地资源目录，验证无模块加载、fetch 和越界引用。
- [ ] 1.2 实现 Canvas 场景、按钮动画和 letterbox/DPI 坐标变换，验证黄金画面与命中。
- [ ] 1.3 实现键盘、指针、触摸、菜单键和 UO mask 路由，验证有效按钮及焦点丢失。
- [ ] 1.4 接入 VM 动作、页面切换和 sound 资源，验证交互 trace 及音效。
- [ ] 1.5 实现 menu-only 转换和不可用提示，验证没有真实媒体时状态为 partial。
- [ ] 1.6 实现开始手势和播放拒绝恢复，验证 file:// 下离线启动及目录移动。
