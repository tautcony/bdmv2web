# bdj-menu-runtime Specification

## Purpose

本工程在用户电脑上的 Java 进程执行 BDJO 指定的 Xlet 字节码，通过本地会话接口在网页呈现 authored 菜单和交互，并统一处理 BD-J/HDMV 导航、菜单媒体与系统播放器正片交接。

## ADDED Requirements

### Requirement: BDJO JAR 字节码执行

系统 SHALL 从 INDEX 的 BD-J target 解析对应 BDJO application table、`basePath` JAR 和 `initialClass`，并在本地 Java VM 中执行这些类的实际 class-file 字节码。运行时 SHALL 支持样本 JAR 的 class-file version 47.0 和通过 reachable-path inventory 确认的字节码、Java SE 类库与运行时 API。菜单业务 SHALL 来自 JAR 的 Java 执行，不得由 JavaScript 菜单替身代替。

#### Scenario: Spider-Man JAR 类加载

- **WHEN** First Play 或 Top Menu 解析到 BDJO `00001`
- **THEN** Java VM 从其 `basePath=00000` 加载 `BDMV/JAR/00000.jar`，解析并执行 `com.spe.radius.StandardMenuXlet` 与 `com.spe.radius.TitleBoundXlet` 的实际字节码

#### Scenario: 入口类或字节码不受支持

- **WHEN** JAR 的入口类无法加载、类格式不受支持或执行遇到未实现的字节码
- **THEN** 输出包含 INDEX、BDJO、JAR、类、方法和可取得的执行位置的诊断；未取得的位置明确标为 unknown；解除对应后端等待并保留可用的 HDMV 菜单导航

### Requirement: Xlet 生命周期与应用管理

系统 SHALL 根据 application descriptor 的 `controlCode` 和 `binding` 驱动 Xlet `initXlet`、`startXlet`、`pauseXlet`、`destroyXlet` 生命周期及 title-bound 事件。PRESENT application SHALL 初始化；AUTOSTART application SHALL 启动。disc-bound 和 title-bound 状态 SHALL 分别保留。Xlet context SHALL 暴露盘 ID、参数、属性、资源路径及应用事件。

#### Scenario: Standard Menu 和 Title Bound Xlet 共存

- **WHEN** BDJO 声明 StandardMenuXlet 为 PRESENT/disc-bound、TitleBoundXlet 为 AUTOSTART/disc-and-title-bound
- **THEN** runtime 初始化前者、启动后者，后者读取当前 PSR4 并通过本地 IXC Messenger 向 StandardMenuXlet 转发 title-start；离开 title 时转发匹配的 title-stop

#### Scenario: IXC 进程内消息

- **WHEN** Xlet 通过 `IxcRegistry` 查找或绑定同一 BD-J 应用上下文中的 Messenger
- **THEN** runtime 在本地 Java VM 内解析远程接口对象并投递调用，不建立网络连接

### Requirement: BD-J API host 与 Java 运行时桥

系统 SHALL 为 reachable-path inventory 中实际调用的 Java TV、Blu-ray、DVB、HAVi、JMF、IXC、AWT 和文件 API 提供明确定义的 host 实现。Host 方法 SHALL 映射到 disc runtime 的寄存器、标题路由、播放器、输入、图形和调度服务。每个实际调用的方法 SHALL 返回定义结果或生成带 class/method/source 的 unsupported 诊断；不得静默返回成功状态。

#### Scenario: HScene 绘制与用户输入

- **WHEN** Xlet 创建并显示 1920×1080 HScene，注册焦点、按键、图像、字体和计时器行为
- **THEN** 浏览器显示 Java 场景的绘制结果，将键盘/指针事件投递给 Xlet，并显示 Java repaint/计时器产生的有效更新帧

#### Scenario: Java API 调用不受支持

- **WHEN** 可达 Xlet 路径调用 host 未实现的方法或 native 操作
- **THEN** runtime 显示含 Java 类、方法签名、调用来源和 BD-J 路径的诊断，并保留独立可用的菜单和 HDMV 操作

### Requirement: Authored 菜单状态与动作

系统 SHALL 通过执行盘内 Xlet 读取其 authored 配置、项目数据、图形、字体、字符串、声音和计时器，并呈现该应用可达的菜单状态和动作。浏览器界面 SHALL 保留盘内提供的语言与菜单行为，不增加盘外翻译或导航规则。所有受支持动作 SHALL 由 Xlet 代码产生。

#### Scenario: Spider-Man 菜单资源

- **WHEN** StandardMenuXlet 从 `BDMV/JAR/03001` 读取项目和语言资源
- **THEN** HScene 显示 1920×1080 逻辑菜单，复用 authored composite、font、text、sound 与 timer 数据

#### Scenario: 样本所有可达菜单路径

- **WHEN** 用户从初始菜单依次操作盘内启用的菜单项和子菜单
- **THEN** 每个在 reachable-path inventory 中列出的界面、按键状态和操作均由实际 Xlet 字节码呈现并执行；不在范围的播放器/网络服务以明确状态返回

### Requirement: BD-J 与 HDMV 标题交接

系统 SHALL 将 BD-J title 请求按 `ParsedDisc.entries` 解析并交给目标后端。HDMV target SHALL 进入既有 HDMV title/MovieObject 路径；BD-J target SHALL 进入 BDJO Java VM。特殊 title `0` 和 `65535` SHALL 分别解析 Top Menu 和 First Play entry。交接 SHALL 保留动作 generation、来源与 GPR/PSR 状态。

#### Scenario: Gallery 和 Trivia 经 HDMV bridge

- **WHEN** Xlet 处理 `GALLERY_BDJO_TITLE=13` 或 `TRIVIA_BDJO_TITLE=14`
- **THEN** Java RegisterAccess/host 写入 GPR1000=13 或 14 并请求 title 10；INDEX title 10（IR ID `title:9`）进入 HDMV MovieObject 2，指令 2106/2107 将该值作为动态 GOTO PC 13/14

#### Scenario: HDMV Top Menu 返回 BD-J

- **WHEN** HDMV `TITLE_SEARCH title=0` 对应的 Top Menu entry 指向 BD-J
- **THEN** router 切换到目标 BDJO Java VM 并结束当前 HDMV title wait，不将 BDJO file number 交给 `HdmvVm.selectTitle()`

### Requirement: 本地碟片会话与重连

系统 SHALL 由本地服务维护 BD-J 会话的 title、BDJO、共享 GPR/PSR、HDMV 执行与等待状态以及动作关联信息。网页重连 SHALL 连接存活会话并取得当前有效图层。服务停止 SHALL 释放会话和 Java 进程。现有完整 checkpoint 的导出恢复语义 SHALL 保留。

#### Scenario: 页面刷新

- **WHEN** 用户刷新连接到存活 BD-J 会话的页面
- **THEN** 页面恢复当前菜单图层并继续向同一会话发送输入；共享寄存器与 Xlet 状态保持

#### Scenario: 本地服务退出

- **WHEN** 用户停止本地服务
- **THEN** Java 应用执行退出流程，子进程和未完成的接口请求得到清理

### Requirement: 菜单帧与输入传递

系统 SHALL 显示实际 Xlet 的离屏绘图结果，保持 authored 尺寸、透明度和图层顺序。输入 SHALL 按显示区域转换到逻辑坐标，并传递按下、释放及重复状态。失焦 SHALL 清除持有按键。菜单焦点和动作 SHALL 由 Java 应用处理。

#### Scenario: 缩放与黑边

- **WHEN** 菜单按比例显示并在四周产生黑边，用户点击菜单内容区域
- **THEN** Java 收到对应 authored 逻辑坐标；黑边点击不激活菜单

#### Scenario: 松键与失焦

- **WHEN** 用户释放按键或页面失去焦点
- **THEN** Java 接收到匹配释放状态，后续输入不继承遗留按键

#### Scenario: 重入 host 调用

- **WHEN** title 或输入回调在执行过程中同步调用寄存器或导航接口
- **THEN** 对应响应继续被接收并按关联请求返回，菜单事件继续执行

### Requirement: 菜单背景与声音

系统 SHALL 在构建阶段将 BDJO 可访问 Playlist 的 PlayItem 媒体转码到输出包目录，并由网页呈现这些包内菜单背景和声音。BDJ 与 HDMV 菜单媒体中的等价引用 SHALL 共用一次转码结果，即使其 Playlist ID 或 PlayItem ID 不同；输入文件、媒体区间、流映射或编码设置不同时 SHALL 分别处理。overwrite SHALL 在现有媒体计划与输入、范围及编码设置匹配时复用媒体资产。serve SHALL 只读取包内资产，不在运行期间转码。系统 SHALL 将实际观察到的开始、结束、错误和自动播放受限状态关联回菜单运行时。交互重试 SHALL 只恢复仍有效的受限媒体操作。

#### Scenario: 菜单声音结束

- **WHEN** 网页中的菜单声音实际播放结束
- **THEN** Java listener 收到关联该媒体请求的结束事件

#### Scenario: 自动播放受限

- **WHEN** 浏览器拒绝菜单媒体自动播放
- **THEN** 页面提供用户手势入口，继续处理菜单输入，并回报受限状态

#### Scenario: BD-J 菜单媒体构建与覆盖复用

- **WHEN** 构建 BD-J 菜单包，或以 overwrite 重建现有包
- **THEN** BDJO 可访问 Playlist 的 PlayItem 视频和音频作为 MP4/AAC 资产写入输出目录；overwrite 复用媒体计划匹配的资产，并为输入范围或编码设置已变化的资产重新转码；serve 从包内 manifest 读取对应资产路径

#### Scenario: BDJ 与 HDMV 媒体引用共用等价资产

- **WHEN** BDJ 或 HDMV 菜单包内的多个 Playlist 引用相同源文件、媒体区间、视频与音频流映射及编码设置
- **THEN** 构建只转码一次，并为每个 Playlist/PlayItem 保留各自的运行时地址与 manifest 记录

### Requirement: Playlist 权限与正片交接

系统 SHALL 按 accessiblePlaylists 检查应用媒体请求。menuCallMask 或 titleSearchMask 为 true 时 SHALL 拒绝对应用户操作；Xlet 自主 title 导航 SHALL 使用应用请求路径。正片请求 SHALL 保留 playlist、起播位置、全部后续 PlayItem 及 in/out 边界，并交给声明支持所需能力的系统播放器适配器。交接结果 SHALL 使用 requested、unavailable 或 error。

#### Scenario: 完整播放目标

- **WHEN** Xlet 请求包含多个 PlayItem 的正片 playlist
- **THEN** 适配器接收全部相关片段及时间边界；能力不足时回报明确 unavailable 和目标来源

#### Scenario: 不可访问 Playlist

- **WHEN** Xlet 请求不符合 BDJO accessiblePlaylists 的目标
- **THEN** 系统返回 BDJ_PLAYLIST_NOT_ACCESSIBLE 及来源，菜单输入继续可用

#### Scenario: 用户导航被遮罩

- **WHEN** 当前 BDJO 的 menuCallMask 或 titleSearchMask 为 true，用户发出对应导航操作
- **THEN** 系统返回带操作和 BDJO 来源的 masked/unavailable 结果，共享 title 状态保持

#### Scenario: Xlet 自主 title 导航

- **WHEN** Xlet 通过 TitleContext 请求有效 title，且当前 BDJO 的 titleSearchMask 为 true
- **THEN** 系统按 INDEX 路由应用请求并保留共享寄存器和来源

#### Scenario: 系统播放器打开请求

- **WHEN** 本地服务成功发出系统播放器打开请求
- **THEN** 记录 requested 和关联播放目标，Xlet 菜单继续接收输入

### Requirement: 播放状态观测边界

系统 SHALL 将交接记录与实际播放状态分别维护。JMF StartEvent、EndOfMediaEvent、播放时钟和实际音轨/字幕状态 SHALL 由关联的真实媒体回执更新。launch-only 播放器的正片状态 SHALL 标记为 unobserved；requested SHALL 作为交接状态保留。

#### Scenario: 仅有交接回执

- **WHEN** 系统播放器适配器只确认打开请求已发出
- **THEN** 正片状态为 unobserved，保留 requested 记录；Java 不产生由该回执推断的 StartEvent、EndOfMediaEvent 或 ControllerErrorEvent

#### Scenario: 不受支持的正片控制

- **WHEN** Xlet 请求适配器未声明支持的正片停止、定位、音轨或字幕操作
- **THEN** 返回带操作与来源的 unavailable 结果，菜单继续处理独立输入和导航

### Requirement: BD-J 本地服务启动

含 BD-J 后端的生成包 SHALL 通过 bdmv2web 本地服务启动，并明确声明兼容 Java 运行环境和包内 host/application JAR、菜单资源要求。页面和资源 SHALL 由回环地址提供，断开外网后继续运行。Java 可执行文件 SHALL 支持显式配置，启动机制 SHALL 覆盖 Windows、macOS 和 Linux。

#### Scenario: 本地离线运行

- **WHEN** 用户通过 bdmv2web serve 启动完整 BD-J 包并断开外网
- **THEN** 本地 Java 执行包内应用，网页连接本地会话并显示可操作菜单

#### Scenario: Java 不可用

- **WHEN** 指定的 Java 可执行文件不存在、版本不兼容或缺少需要的模块
- **THEN** 输出可定位的运行环境诊断和配置说明；服务关闭相关等待并保留可用页面

#### Scenario: 直接 file URL 打开

- **WHEN** 用户通过 file:// 打开 BD-J 包
- **THEN** 页面显示 bdmv2web serve 命令、本地服务和 Java 要求
