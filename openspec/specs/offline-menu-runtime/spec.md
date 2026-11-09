# offline-menu-runtime Specification

## Purpose

生成 file:// 兼容的统一菜单交互包，并如实声明外部影片依赖：包内资源自足、引用保持在包内，影片动作只发起系统交接请求，运行时不假定能获知外部播放状态。

## Requirements

### Requirement: 无服务器启动

系统 SHALL 生成自包含 classic 脚本目录，IR/交互图形不依赖 fetch、模块脚本、网络、后台或原碟。

#### Scenario: 移动并断网

- **WHEN** 移动整个目录、移走原碟、断网后直接打开 index.html
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

### Requirement: 交互与视觉状态

系统 SHALL 根据页面/BOG/有效性/邻接/UO mask 呈现三态并经 MenuController/VM 处理输入，不用硬编码按钮业务；HDMV 导航和输入行为以固定版本 libbluray 1.5.0 为准。

#### Scenario: letterbox 点击

- **WHEN** 窗口缩放并有黑边，在有效按钮坐标点击
- **THEN** 逆变换后命中原始按钮并由 VM 执行，黑边点击不命中

#### Scenario: 无效或禁用按钮

- **WHEN** 指针/确认键指向禁用 BOG 按钮或 UO mask 禁止动作
- **THEN** 不激活，且不会绕过键盘与指针一致规则

#### Scenario: 页面切换

- **WHEN** 切换到没有原选中按钮的页面
- **THEN** 按新页默认规则选择或清空焦点，不保留悬空 buttonId

### Requirement: 动画与生命周期

系统 SHALL 按源坐标/层次/裁剪和调度时钟呈现动画/效果，支持 DPI 且不让失效回调污染当前页；IGS 动画帧与页面效果时序以固定版本 libbluray 1.5.0 为准。

#### Scenario: DPI 改变

- **WHEN** 相同场景在不同 DPR 下缩放
- **THEN** 逻辑按钮区域不变，Canvas backing store 随配置更新，像素位置一致

#### Scenario: 旧动画完成

- **WHEN** 离开页面后原动画完成回调到达
- **THEN** 旧任务被取消/忽略，不重新选择旧页按钮

#### Scenario: 浏览器失焦

- **WHEN** 按键按住时窗口失去焦点后返回
- **THEN** 清除遗留按键，不持续移动或重复激活

### Requirement: 音效与菜单动作

系统 SHALL 将 sound 索引转换为可本地播放 WAV，场景动作经统一 VM 桥执行并保留诊断。

#### Scenario: 声音引用

- **WHEN** 有效按钮触发已解析 sound 条目
- **THEN** 播放对应 WAV 且 trace 保留声音来源，不要求外部解码工具

#### Scenario: 声音缺失

- **WHEN** 按钮引用不存在或未支持编码的音效
- **THEN** 显示诊断及受影响按钮，不静默替换或声称音效保真

### Requirement: 影片交接的限制

系统 SHALL 在统一产物的 UI/README/报告说明源 M2TS 和系统默认程序依赖；缺失媒体动作回 unavailable 并结束等待。

#### Scenario: 影片交接不可用

- **WHEN** 用户激活影片动作而系统交接不可用
- **THEN** 显示 unavailable，VM 不挂死，状态按实际缺口判定

### Requirement: 播放策略恢复

系统 SHALL 提供首次用户手势入口并区分自动播放限制、编码不支持和资产错误。

#### Scenario: 自动播放拒绝

- **WHEN** play Promise 返回 NotAllowedError
- **THEN** 显示开始/重试按钮，手势后仅重试仍有效动作，不重执行全部按钮指令

#### Scenario: 编码拒绝

- **WHEN** play Promise 返回 NotSupportedError
- **THEN** 报告能力错误，不陷入无效的反复开始提示
