# 文档索引

按用途查找项目文档。项目行为与阶段验收以 [OpenSpec 规格](../openspec/specs/) 和对应变更记录为准。

## 使用与开发

- [开发指南](guides/development.md)：工具链、CLI、测试和构建流程。
- [llm-wiki](llm-wiki/README.md)：面向 LLM/agent 的工程知识索引——任务路由、包/功能/诊断/排查文档与机器可读 `index.json`。
- [浏览器验收环境](guides/browser-matrix.md)：浏览器支持范围与已记录的验收环境。

## 能力与支持范围

- [协议支持矩阵](support/protocol-support.md)：BDMV 格式解析状态和证据。
- [HDMV 支持](support/hdmv-support.md)：指令、虚拟机行为和支持状态。
- [IGS 支持](support/igs-support.md)：场景提取、图像处理和已知边界。

## 历史归档

- [BDMV/HDMV 离线 Web 架构方案（2026-11-02）](archive/bdmv_hdmv_offline_web_architecture.md)：初版技术设计与组件关系，含未实现的设计名和早期包结构。当前能力以本页的支持矩阵和开发指南为准。

## 参考资料与证据

- [开发参考索引](references/README.md)：固定版本参考实现、规范入口、许可和阶段资料。
- [验证证据](evidence/)：提取与对照记录。

## 历史资料

- [2026-11-04 评审记录](review-2026-11-04/index.md)：评审结论、阶段记录与修复清单。
- [2026-11-06 HDMV VM 一致性审计](review-2026-11-06-hdmv-vm-conformance/index.md)：对照 libbluray/libhdmv 的逐指令核对、运行模型差异、复现记录与修复顺序。
- [2026-11-07 过度防御与辩解式内容审计](review-2026-11-07-over-defensive-audit/index.md)：源码死防御与吞错、测试验证表演、文档辩解残留的逐条清单与处理优先级。
- [归档文档](archive/README.md)：历史决策和已完成评审资料。
