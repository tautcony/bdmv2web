# Spec Delta

## MODIFIED Requirements

### Requirement: 无服务器启动

系统 SHALL 为不含 BD-J 执行后端的包生成自包含 classic 脚本目录；IR、HDMV/IGS 图形及交互不依赖 fetch、模块脚本、网络、后台或原碟；初始化虚拟机与首播流程不得以"存在菜单媒体"为前提。含 BD-J 执行后端的包遵循新增的 BD-J 本地服务启动要求。

#### Scenario: 移动并断网

- **WHEN** 移动整个目录、移走原碟、断网后直接打开不含 BD-J 的 index.html
- **THEN** 受支持浏览器加载 IR/图形并进入开始界面，所有运行引用仍包内

#### Scenario: 安全嵌入

- **WHEN** 源标题或元数据含 </script> 与 HTML 片段
- **THEN** 作为数据/文字呈现，不执行脚本，不破坏脚本加载顺序

#### Scenario: 菜单图像使用 PNG

- **WHEN** 菜单或弹出菜单引用 IGS 图像并生成离线包
- **THEN** 图像对象先编码为 PNG，再以 `data:image/png;base64` 嵌入图形资源脚本；非 PNG 图像字节不得进入图形资源批次

#### Scenario: 版本不兼容

- **WHEN** Bootloader 装载未知 schema
- **THEN** 显示可定位错误，禁止初始化 VM 而非黑屏或猜测执行

#### Scenario: 无媒体包的初始化

- **WHEN** 不含 BD-J 的包内不含菜单背景媒体（无视频/音频轨道）
- **THEN** 仍执行初始 MovieObject 与 First Play 流程，trace 有对应动作；媒体相关动作按不可用处理，不跳过初始化

## ADDED Requirements

### Requirement: BD-J 本地服务启动

含 BD-J 执行后端的生成包 SHALL 通过 bdmv2web 本地服务启动。host API JAR、BDJO application JAR 和 authored 菜单资源 SHALL 从包内加载；本地 Java 执行应用，网页通过回环地址连接会话。包 manifest、README 和 CLI 输出 SHALL 明示启动命令、Java 运行要求和本地 URL。

#### Scenario: 本地 HTTP 上的 BD-J 包

- **WHEN** 用户移动完整 BD-J 包目录、移走原碟并断开外网后，通过 bdmv2web serve 启动并打开本地页面
- **THEN** 本地 Java 从包目录加载 Xlet 和资源，网页显示可操作菜单，运行资源从本地加载

#### Scenario: 直接 file URL 打开 BD-J 包

- **WHEN** 用户以 `file://` 打开含 BD-J Java runtime 的包
- **THEN** 页面显示 bdmv2web serve 启动命令、Java 运行要求和本地服务说明

#### Scenario: 静态包本地打开

- **WHEN** 用户直接打开不含 BD-J 后端的 HDMV/IGS 包
- **THEN** 页面按原 file:// 合同运行菜单图形和导航
