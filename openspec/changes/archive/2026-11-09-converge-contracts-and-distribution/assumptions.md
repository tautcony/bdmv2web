# 契约决策与待确认事项

| 编号 | 契约或待确认事项 | 关联任务 | 状态 |
| --- | --- | --- | --- |
| R2-1 | HDMV 默认预算从 core 的 `DEFAULT_LIMITS` 派生：`maxCallDepth` 为 128，`maxQueueDepth` 为 1024。 | A.1–A.4 | 已实施 |
| R2-2 | `CALL_TITLE` 发出 `TITLE_SEARCH`，浏览器调用 `selectTitle()`；目标不可用或出错时解除等待并记录诊断。 | C.3、C.4 | 标题选择路径已实现；桥端事件检查待验收 |
| R2-3 | `SourceRef.path` 使用相对 BDMV 根的 POSIX 路径，例如 `PLAYLIST/00001.mpls`。 | D.4、D.5 | 待确认 |
| R2-4 | 非循环背景结束返回 `MEDIA_ENDED`，VM 从等待恢复。 | E.2 | 待回归验收 |
| R2-5 | `@bdmv2web/package-builder` 随 CLI 安装，消费已发布的构建产物。 | F.1–F.4 | 待确认 |
| R2-6 | 影片通过系统 URL Protocol 交给外部播放器。 | 不在本 change 实现 | 已确认 |
| R2-7 | DiscIR、清单和报告使用路径及长度记录资产。 | B.1 | 已实施 |
