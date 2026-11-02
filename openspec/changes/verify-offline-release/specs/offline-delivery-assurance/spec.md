# Spec Delta

## Purpose

为离线 BDMV 转换和浏览器运行提供可验证的验证离线交付并判定发布状态能力，明确输入、输出、错误及对下游的可观察行为。

## ADDED Requirements

### Requirement: 资源与离线审计

系统 SHALL 验证资源存在、哈希、引用边界及网络依赖，并报告来源和失败项。

#### Scenario: 包中存在越界路径、远程 URL 或哈希不匹配

- **WHEN** 包中存在越界路径、远程 URL 或哈希不匹配
- **THEN** validate --offline 报告具体引用并拒绝 complete

### Requirement: 完成度与严格模式

系统 SHALL 区分 complete、partial 和 failed，并在 strict 模式下阻止存在未认可错误或关键功能缺失的结果标为成功。

#### Scenario: 混合 BD-J 入口或可达不支持操作

- **WHEN** 混合 BD-J 入口或可达不支持操作
- **THEN** 报告受影响入口与诊断；不可标为全碟 complete

### Requirement: 对照与浏览器证据

系统 SHALL 为指定路径保存 VM 状态、图形对照及离线浏览器版本的验收证据。

#### Scenario: 断网移动包后执行包含菜单和影片的路径

- **WHEN** 断网移动包后执行包含菜单和影片的路径
- **THEN** 记录按钮、寄存器、画面、播放状态及浏览器版本的结果；未通过或未验证的矩阵项不能声称通过

### Requirement: 安全失败

系统 SHALL 对损坏文件、无效引用、超限执行和不安全输出路径安全终止并给出可诊断错误。

#### Scenario: 输入包含跳转环或路径越界

- **WHEN** 输入包含跳转环或路径越界
- **THEN** 处理受限终止，报告错误且不覆盖源文件
