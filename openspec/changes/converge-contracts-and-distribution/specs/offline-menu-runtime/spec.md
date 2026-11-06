# Spec Delta

## Purpose

补齐运行时生命周期的三处缺口：初始 VM 不依赖媒体、媒体桥能结束等待、音轨选择与命中几何与 VM 事实一致。

## MODIFIED Requirements

### Requirement: 无服务器启动

系统 SHALL 生成自包含 classic 脚本目录，IR/交互图形不依赖 fetch、模块脚本、网络、后台或原碟；初始化虚拟机与首播流程不得以"存在菜单媒体"为前提。

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

#### Scenario: 无媒体包的初始化

- **WHEN** 包内不含菜单背景媒体（无视频/音频轨道）
- **THEN** 仍执行初始 MovieObject 与 First Play 流程，trace 有对应动作；媒体相关动作按不可用处理，不跳过初始化

### Requirement: 动画与生命周期

系统 SHALL 按源坐标/层次/裁剪和调度时钟呈现动画/效果，支持 DPI 且不让失效回调污染当前页；菜单背景媒体的播放生命周期必须产生可关联的回执，不得让等待方永久挂起。

#### Scenario: DPI 改变

- **WHEN** 相同场景在不同 DPR 下缩放
- **THEN** 逻辑按钮区域不变，Canvas backing store 随配置更新，像素位置一致

#### Scenario: 旧动画完成

- **WHEN** 离开页面后原动画完成回调到达
- **THEN** 旧任务被取消/忽略，不重新选择旧页按钮

#### Scenario: 浏览器失焦

- **WHEN** 按键按住时窗口失去焦点后返回
- **THEN** 清除遗留按键，不持续移动或重复激活

#### Scenario: 非循环背景结束

- **WHEN** 非循环菜单背景播放到末尾
- **THEN** 桥按 responseTo 回结束事件，VM 从等待恢复；画面是否停留在末帧不改变"已结束"这一事实

#### Scenario: 播放出错或被中断

- **WHEN** 背景媒体解码失败或播放被中断
- **THEN** 桥回错误/中断回执，等待方恢复并记录原因，不停在 suspended

### Requirement: 音效与菜单动作

系统 SHALL 将 sound 索引转换为可本地播放 WAV，场景动作经统一 VM 桥执行并保留诊断；菜单音轨选择必须反映到系统寄存器，使按钮程序读到真实值。

#### Scenario: 声音引用

- **WHEN** 有效按钮触发已解析 sound 条目
- **THEN** 播放对应 WAV 且 trace 保留声音来源，不要求外部解码工具

#### Scenario: 声音缺失

- **WHEN** 按钮引用不存在或未支持编码的音效
- **THEN** 显示诊断及受影响按钮，不静默替换或声称音效保真

#### Scenario: 音轨选择写回

- **WHEN** 用户或默认策略选定主音轨
- **THEN** 系统寄存器中的音轨号更新为所选流号，按钮程序比较该寄存器时得到真实值而非初始占位值

### Requirement: 交互与视觉状态

系统 SHALL 根据页面/BOG/有效性/邻接/UO mask 呈现三态并经 MenuController/VM 处理输入，不用硬编码按钮业务；可命中区域必须与"按钮是否可用"的判定一致。

#### Scenario: letterbox 点击

- **WHEN** 窗口缩放并有黑边，在有效按钮坐标点击
- **THEN** 逆变换后命中原始按钮并由 VM 执行，黑边点击不命中

#### Scenario: 无效或禁用按钮

- **WHEN** 指针/确认键指向禁用 BOG 按钮或 UO mask 禁止动作
- **THEN** 不激活，且不会绕过键盘与指针一致规则

#### Scenario: 页面切换

- **WHEN** 切换到没有原选中按钮的页面
- **THEN** 按新页默认规则选择或清空焦点，不保留悬空 buttonId

#### Scenario: 仅有常态图形的按钮

- **WHEN** 某按钮只声明常态图形却被判定为可用
- **THEN** 指针落在常态图形区域内可命中并激活，不出现"可聚焦但点不到"
