# 本地 JVM BD-J 菜单运行时

## Why

BD-J 菜单由 BDJO 选中的盘内 JAR 和 authored 资源驱动。本工程执行实际 Xlet 字节码，呈现菜单、处理输入和碟片导航，并将正片播放请求交给系统播放器。

BD-J 运行环境采用用户电脑上的 Java 后台。网页通过本地服务接口显示 Java 绘制的菜单、呈现菜单背景和声音，并回传用户输入。运行包支持断开外网后使用。

## What Changes

- `bdmv2web serve <package-directory>` 在回环地址提供页面、资源和会话接口，管理本地 Java 子进程。Java 可执行文件通过 `--java` 指定，默认使用本机 Java。
- Java host 执行 BDJO 选中的 JAR，管理 Xlet 生命周期、Java TV/DVB/HAVi/JMF API、本地 IXC 和菜单对象；AWT/HAVi 场景离屏绘制后发送给网页。
- 本地服务持有 BD-J 会话的共享 GPR/PSR、HDMV VM、title router 和动作关联状态。页面刷新重新连接存活会话。
- 网页显示菜单图层，呈现包内菜单背景和声音，将键盘和指针输入发送到当前会话，并回报实际观察到的菜单媒体状态。
- 正片请求解析为完整碟片播放目标。播放器适配器声明 playlist、片段边界和定位能力；普通系统打开采用其已声明能力。交接结果使用 requested/unavailable/error，实际播放状态由可观察回执更新。
- 生成包包含 host JAR、盘内 JAR、菜单资源和服务端会话数据，明确记录本地服务和 Java 要求。HDMV/IGS 静态包继续支持现有 file:// 启动。
- 诊断保留 INDEX、BDJO、JAR、应用、Java 类/方法及可取得的执行位置。真实盘菜单路径、跨平台启动和独立图形对照分别记录证据。

## Capabilities

### New Capabilities

- `bdj-menu-runtime`: 本地 Java 字节码执行、Xlet 生命周期、BD-J API、菜单绘制与输入、服务会话、菜单媒体和正片交接。

### Modified Capabilities

- `disc-contracts`: 保留 BDJO 应用描述并将 BD-J 入口交给本地 Java 执行后端。
- `hdmv-navigation`: BD-J 会话内由本地服务统一路由 title，并维护共享寄存器和动作代次。
- `offline-menu-runtime`: 声明 BD-J 包的本地服务与 Java 启动合同，保留静态包 file:// 能力。

## Impact

涉及 CLI serve/build、Java host、runtime-web 菜单客户端、共享 disc session、package-builder 模板与清单、package audit 和当前支持文档。Java 使用包含 java.desktop 的常规运行环境。Node API 与类型放在使用 Node 的 CLI 服务层。BDJO 和媒体结构继续由现有 parser 提供。

正片结束回调、正片音轨/字幕状态和自动返回菜单取决于播放器适配器的实际能力。进程重启后的 BD-J 完整恢复需要完整 JVM 应用状态证据；现有 checkpoint 合同保留。
