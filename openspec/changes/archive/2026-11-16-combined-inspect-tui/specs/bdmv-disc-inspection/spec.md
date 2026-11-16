## MODIFIED Requirements

### Requirement: 检查与提取
系统 SHALL 让 inspect/list 输出可追踪的结构、现有图形提取信息及诊断，并区分结构与图形阶段状态。单次 inspect/list 调用 SHALL 复用一次结构解析与一次 IGS 提取，不渲染 PNG；list SHALL 作为 inspect 的别名。TTY 默认使用分层交互查看器；JSON 和确定性文本模式保持可用。

#### Scenario: 合并 JSON
- **WHEN** inspect 或 list 使用 `--format json`
- **THEN** stdout 输出可解析 JSON，包含 schemaVersion、disc、graphics 和独立阶段状态，Map 数据以稳定记录形式序列化

#### Scenario: 混合入口

- **WHEN** 碟片含 HDMV 和 BD-J 标题
- **THEN** 分别保留类型/目标，BD-J 标 unsupported，不从统计分母删除

#### Scenario: 结构 JSON

- **WHEN** 运行 inspect --format json
- **THEN** stdout 可独立 JSON 解析，含 analysisStage=structural；日志到 stderr，不声称动态路径已全验证

#### Scenario: MPLS 与 M2TS 导航
- **WHEN** 用户浏览 MPLS、PlayItem 和 M2TS
- **THEN** MPLS 按文件名排序、PlayItem 按声明 index 排序，只按已解析的引用跳转；未知关联保留未知并显示可用来源
