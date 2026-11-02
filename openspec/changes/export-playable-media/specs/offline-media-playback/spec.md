# Spec Delta

## Purpose

导出可达媒体并闭合时间、轨道、字幕与导航反馈。

## ADDED Requirements

### Requirement: 可达媒体导出

系统 SHALL 为 standalone-full 保守计算所有入口和按钮分支所需媒体，先生成计划，路径不确定不得缩小为单次运行路径。

#### Scenario: 条件分支并集

- **WHEN** 同一按钮依 GPR 可播放两个 Playlist
- **THEN** 两条可能路径均纳入媒体计划并保留来源

#### Scenario: 无法解析动态分支

- **WHEN** 候选目标或探索状态无法有界确定
- **THEN** 保留 unknown 和诊断，禁止完整承诺，不静默漏包

#### Scenario: 多 PlayItem

- **WHEN** 路径含多个 PlayItem 或重复 Clip
- **THEN** 生成本地可播放片段/合成文件及逐项映射，不引用原 M2TS

### Requirement: 转码与资源事务

系统 SHALL 只在转换阶段安全调用 FFprobe/FFmpeg，按明确 profile 输出并校验媒体，支持预算/取消/失败清理。

#### Scenario: 特殊源文件名

- **WHEN** 文件路径含空格及 shell 特殊字符
- **THEN** 以参数数组调用，不执行 shell 拼接，记录工具版本/参数

#### Scenario: 进程或磁盘失败

- **WHEN** FFmpeg 非零退出、取消或空间不足
- **THEN** 输出 MEDIA_EXPORT_FAILED，临时文件不登记为资产，不覆盖源/旧包

#### Scenario: 成功进程但坏输出

- **WHEN** FFmpeg 返回0而 ffprobe 检查失败
- **THEN** 仍判该 job 失败，不以退出码0当媒体可播放证据

### Requirement: 统一时间与反馈

系统 SHALL 显式双向映射源时间、Playlist 时间和输出时间，按半开区间归属 PlayItem，并在实际媒体成功后反馈。

#### Scenario: 跨项章节数值

- **WHEN** PI0播放[0,180000)，PI1源[450000,720000)且播放[180000,450000)，seek章节225000
- **THEN** 定位PI1源495000；线性输出为2.5秒，seek完成后才反馈成功，误差不超过目标视频一帧

#### Scenario: 边界归属

- **WHEN** 目标时间恰好为180000的 PlayItem 边界
- **THEN** 归属后一个 PlayItem，不重复触发前项结束副作用

#### Scenario: 45k和回绕

- **WHEN** 来源含45k IN/OUT及带epoch的PTS
- **THEN** 先精确归一化，再按映射定位，不把单位或不连续域混用

### Requirement: 媒体能力与不支持项

系统 SHALL 为支持的主音轨提供本地变体，为普通 PGS 提供位图层/选择/off；高级能力未验证时报告影响。

#### Scenario: 音轨切换

- **WHEN** 从一个受支持音轨切到另一个
- **THEN** 按逻辑时间/暂停状态恢复，实际切换成功后 PSR 与 UI 同步，不依赖 audioTracks

#### Scenario: PGS 开关与seek

- **WHEN** 选择普通 PGS 后暂停/seek/关闭字幕
- **THEN** 图形字幕随映射时间重建并按选择隐藏，IG 菜单层不受误清除，不 OCR

#### Scenario: 高级能力

- **WHEN** 可达分支要求无缝分支、强制字幕、TextST、角度或PiP等未支持能力
- **THEN** 列出路径和降级，不因关闭 strict 变成 complete

### Requirement: 动态交互同步

系统 SHALL 以媒体时间和映射重建菜单/动画/PG/still/pop-up，并通过相关动作/代次过滤旧异步回调。

#### Scenario: 媒体切换后旧回调

- **WHEN** seek或切换src后旧Promise/ended回调到达
- **THEN** 丢弃旧代次且trace可追踪，当前VM/场景不变化

#### Scenario: 暂停及回退

- **WHEN** 暂停后回退 seek 到旧 composition 有效时间
- **THEN** 重建对应图形/按钮/字幕，暂停媒体域动画，不重放历史导航副作用

#### Scenario: pop-up和结束返回

- **WHEN** 播放中打开/关闭pop-up并到达正常结束
- **THEN** 保持同一播放上下文，按VM规则处理结束/返回，不出现独立旁路播放器

### Requirement: 完整包集成

系统 SHALL 将所有计划中的必需资产和时间表写入包内，复用 M4 启动/输入桥并等待 M6 证据判定最终状态。

#### Scenario: 完整离线链路

- **WHEN** 从菜单播放正片、seek、切轨、字幕、pop-up并返回
- **THEN** 所有受支持步骤由包内资源完成，VM/PSR/时间一致

#### Scenario: 尚无浏览器证据

- **WHEN** 媒体和导航本地自测通过但必测矩阵缺席
- **THEN** 报告 partial/pending verification，不自动标 complete
