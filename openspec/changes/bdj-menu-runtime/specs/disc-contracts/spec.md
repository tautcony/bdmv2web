# Spec Delta

## MODIFIED Requirements

### Requirement: 导航类型与扩展

系统 SHALL 以 HDMV/BDJ 判别联合保留导航目标，并由 disc-level router 按 INDEX 目标类型选择对应执行后端。HDMV 目标 SHALL 进入 HDMV VM；BD-J 目标 SHALL 解析 BDJO application descriptor、`basePath` JAR 与 `initialClass`，并由本地 Java VM 执行 Xlet 字节码。未知或不兼容的 BD-J 应用 SHALL 保持 unsupported 并带来源诊断。

#### Scenario: First Play 或 Top Menu 指向 BD-J

- **WHEN** First Play 或 Top Menu target 为 BD-J 且 JAR、入口类、Java API 与运行时可用
- **THEN** 启动实际 Xlet 字节码并读取应用声明的本地资源，不伪造 MovieObject target

#### Scenario: BD-J 入口

- **WHEN** 消费包含 HDMV 和 BD-J 入口的契约样本
- **THEN** 保留 BDJO 标识和应用描述符；兼容的应用由 Java VM 执行，不兼容应用输出 `BDJ_APP_UNSUPPORTED`，不伪造 HDMV 目标

#### Scenario: 混合 title table

- **WHEN** title table 同时含 HDMV 和 BD-J target
- **THEN** 每次标题选择按目标类型交给相应执行后端；BD-J target 不进入 `HdmvVm.selectTitle()` 的 MovieObject 分支

#### Scenario: 非法联合

- **WHEN** 同一 navigation 对象混入 HDMV 和 BD-J 专属目标字段
- **THEN** schema 拒绝该对象并报告校验错误
