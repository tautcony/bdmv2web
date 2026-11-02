# Tasks

前置依赖：establish-core-contracts。可提前开发，但完成集成验收前必须满足上游验收。

## 1. 实施与验证

- [ ] 1.1 实现目录发现和明确的 BACKUP 回退规则，验证主文件缺失、损坏与路径变体。
- [ ] 1.2 解析 index 和 MovieObject 并保留原始命令及偏移，验证混合入口和截断样本。
- [ ] 1.3 解析 MPLS、CLPI 与 sound，验证 PlayItem、Mark、STN、SubPath 和 Clip 引用。
- [ ] 1.4 建立引用图与缺失引用诊断，验证可达和不可达实体均可追踪。
- [ ] 1.5 实现 inspect 和 extract 命令及 JSON 输出，验证对合成碟片的结果和只读源目录。
