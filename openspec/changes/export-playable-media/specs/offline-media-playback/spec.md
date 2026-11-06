# Spec Delta

## Purpose

从离线菜单将实际 M2TS 交给操作系统的默认关联程序，并准确报告交接边界。

## ADDED Requirements

### Requirement: 覆盖已有菜单包

系统 SHALL 默认保留已存在的输出目录；仅在 `convert --overwrite` 时事务性替换整个菜单包。覆盖时，若旧媒体计划与新输入的 Playlist、Clip、时间边界、流声明及编码参数匹配，系统 SHALL 复用已有 H.264/AAC 资源而不重新转码；不匹配或资源缺失时重新生成。该匹配不对源 M2TS 内容作哈希或指纹验证。

#### Scenario: 覆盖并复用媒体

- **WHEN** 用户对已存在的输出目录运行 `convert --overwrite`，且旧媒体计划及所需文件与当前输入匹配
- **THEN** 新菜单包替换旧包，菜单/诊断/清单文件更新，背景视频和音轨从旧包复制，媒体计划记录本次复用，不运行媒体转码

#### Scenario: 覆盖但媒体计划不匹配

- **WHEN** 用户运行 `convert --overwrite`，但旧媒体计划不匹配或旧媒体文件缺失
- **THEN** 重新生成媒体后替换旧包；若生成失败，旧包仍保留

### Requirement: 保守映射影片文件

系统 SHALL 将可达影片动作映射到实际 M2TS，保留播放列表、PlayItem、源路径及时间范围；不可确定时保留诊断。

#### Scenario: 条件分支

- **WHEN** 按钮根据状态可能进入不同播放列表
- **THEN** 保留各候选目标及其来源，不以单次执行路径代表全部可能

#### Scenario: 多 PlayItem 或部分片段

- **WHEN** 播放列表包含多个 PlayItem、重复 Clip 或非零 IN/OUT
- **THEN** 说明实际交接的文件和范围限制，不声称打开单个文件等于完成整个播放列表

#### Scenario: 无法确定或文件缺失

- **WHEN** 无法确定对应文件或源 M2TS 不存在
- **THEN** 不猜测其他文件，显示具体诊断并使导航等待可恢复

### Requirement: 交给默认关联程序

系统 SHALL 在用户触发影片动作时，通过前端 URL Protocol 请求打开对应 M2TS。macOS SHALL 使用 IINA 的 `iina://open?url=` 协议，Windows SHALL 使用 PotPlayer 的 `potplayer://` 协议。系统不得要求本地服务、浏览器扩展或额外后台进程。

#### Scenario: 发起协议请求

- **WHEN** 已解析到影片 M2TS 且用户点击影片动作
- **THEN** 按操作系统生成对应的播放器协议 URL 并发起导航，状态只报告已发起请求

#### Scenario: 浏览器限制或无关联

- **WHEN** 浏览器限制直接打开、系统无关联程序或打开失败
- **THEN** 页面保留可操作菜单和目标文件路径

#### Scenario: 跳转到所选章节

- **WHEN** HDMV 请求播放 Playlist mark，且该 mark 已映射到目标 Clip 的 90 kHz 时间戳
- **THEN** 以 mark/PlayItem 时间减去匹配 `stc_id` 的 CLPI STC 起始时间，macOS/IINA 1.4.4+ URL 以 `mpv_start` 秒数传递 M2TS 内相对偏移；Windows/PotPlayer 打开目标 M2TS

#### Scenario: 特别收录页返回

- **WHEN** 当前 IGS 按钮的邻接关系唯一指向一个无图形但带命令的 auto-action 按钮，且用户按 Escape
- **THEN** 沿该光盘定义的导航边执行按钮命令，使菜单返回由 HDMV/IGS 脚本决定；没有唯一候选时使用配置的 Escape 映射

#### Scenario: 未知外部播放状态

- **WHEN** 交接机制不能获知播放进度或结束
- **THEN** 不伪造播放开始、结束或自动返回事件，菜单仍可恢复操作

### Requirement: 单一离线菜单产物

系统 SHALL 提供统一的 convert 产物，不使用产物模式字段；菜单资源自包含，影片显式依赖源 M2TS 和默认关联程序。影片 PGS 字幕由外部播放器处理，不嵌入菜单运行时。

#### Scenario: 移动菜单包

- **WHEN** 断网后移动产物并保留或重新关联源 M2TS
- **THEN** 菜单正常运行，影片交接使用有效的源路径；若源文件不可用则显示诊断

#### Scenario: 播放器职责

- **WHEN** 外部程序打开影片
- **THEN** 播放、章节、音轨、字幕及停止由该程序负责，网页不承诺对其控制、同步或结束回调

#### Scenario: 菜单音频静音

- **WHEN** 用户操作右下角静音按钮，或页面请求外部播放器打开影片
- **THEN** 按钮切换菜单音频静音状态；外部播放请求自动静音菜单背景视频、菜单音轨和按钮音效

#### Scenario: 自动静音的恢复

- **WHEN** 外部播放请求造成的自动静音处于开启状态，页面随后收到按键或点击
- **THEN** 菜单背景视频、菜单音轨和按钮音效恢复为非静音；用户通过静音按钮设置的手动静音不受页面输入影响

#### Scenario: 手动静音优先

- **WHEN** 用户先通过静音按钮手动静音，随后页面请求外部播放器或收到按键/点击
- **THEN** 菜单音频保持静音，直到用户再次操作静音按钮

### Requirement: 菜单场景与影片播放角色

系统 SHALL 按 IGS 场景的 uiModel 区分常驻菜单与内容弹出菜单。`uiModel=0` 的 IGS 场景作为菜单画面；`uiModel=1` 的场景只作为标题播放期间的弹出菜单，不得替换 Top Menu 场景。带 `uiModel=1` 场景的 Playlist 是影片播放，交给外部播放器，不进入包内媒体。系统 SHALL 为可本地表示的菜单 Playlist 生成独立媒体计划；无法本地表示的菜单 Playlist 保留已有背景和诊断。

#### Scenario: 弹出 IGS 不接管菜单

- **WHEN** 菜单按钮进入的 Playlist 带有 `uiModel=1` 的 IGS 子路径
- **THEN** 运行时不把该场景当作常驻菜单画面，保留外部影片映射并请求系统播放器打开对应 M2TS

#### Scenario: 多菜单 Playlist 本地媒体

- **WHEN** Top Menu 之外的菜单 Playlist 具有单 Clip、连续时间线和受支持的主视频/音频声明
- **THEN** 转换阶段为其生成独立目录下的 H.264/AAC 资产和独立媒体计划，运行时在 `PLAY_PLAYLIST` 时切换视频、音频与循环设置

#### Scenario: 返回 Top Menu

- **WHEN** HDMV 从带本地媒体的菜单 Playlist 返回 Top Menu
- **THEN** 运行时切回 Top Menu 的媒体和 IGS 场景，不保留原菜单 Playlist 的视频或音频

#### Scenario: 菜单媒体不可本地表示

- **WHEN** 可达菜单 Playlist 不能表示为包内单 Clip 时间线
- **THEN** 保留 Top Menu 背景，记录诊断，不把该菜单 Playlist 的影片当作包内媒体

#### Scenario: 影片播放期间的弹出控件

- **WHEN** 外部播放器打开带弹出 IGS 的标题 Playlist
- **THEN** 报告该弹出组合在外部播放器中不可用，不在网页中伪造其显示或返回状态

### Requirement: 受限本地引用

系统 SHALL 仅允许经验证的 BDMV STREAM 内实际 M2TS 作为外部影片目标，安全处理本地路径并与包内运行资源审计分开。

#### Scenario: 特殊路径

- **WHEN** 源路径包含中文、空格、# 或 %
- **THEN** 交接到正确文件，且不将路径当作 shell 代码执行

#### Scenario: 路径逃逸

- **WHEN** 目标通过遍历或符号链接指向授权源目录外
- **THEN** 拒绝交接并报告来源和原因

### Requirement: 菜单背景媒体生成

系统 SHALL 在需要动态菜单背景或菜单音轨时，保留转换阶段使用 FFmpeg 生成浏览器可播放的包内媒体，并使用 FFprobe 检查输出；该要求不适用于外部播放器打开的正片。

#### Scenario: 动态背景与菜单音轨

- **WHEN** index.bdmv 的 Top Menu 入口经 HDMV 执行选中菜单 Playlist，其背景由单 PlayItem、同一源 Clip 中连续且流声明一致的区间组成，或是明确的循环尾段，且视频编码为 AVC/H.264 或 HEVC
- **THEN** 按完整背景时间线导出 H.264 视频和 AAC 主音轨；仅在重复尾段或有效 loop mark 存在时设置循环，并在 FFprobe 校验后随菜单打包

#### Scenario: 转换或校验失败

- **WHEN** FFmpeg 失败或 FFprobe 验证输出失败
- **THEN** 报告菜单媒体生成失败，不把未验证或半成品登记为有效资产

### Requirement: 并排输出与可配置源路径

系统 SHALL 默认将 HTML 输出目录放在发现的 BDMV 目录旁，允许用户指定不重叠的其他输出路径，并生成可编辑配置，允许用户调整所指向的 BDMV 目录。

#### Scenario: 默认输出与输入形式

- **WHEN** 用户指定 BDMV 目录或其直接父目录进行转换
- **THEN** 在发现的 BDMV 目录同级生成默认 HTML 目录，配置默认指向同级 BDMV，且不修改源文件

#### Scenario: 目录共同移动

- **WHEN** HTML 目录与 BDMV 目录一起移动且保持并排
- **THEN** 相对于 HTML 目录解析的默认路径仍指向该 BDMV，无须修改配置

#### Scenario: 修改源目录配置

- **WHEN** 用户将配置改为其他相对或绝对本地 BDMV 路径并重新加载
- **THEN** 影片交接按更新后的路径解析，菜单和接入程序使用一致的路径；目标无效时显示可定位的诊断

#### Scenario: 输出到本地目录

- **WHEN** 用户指定与远端 BDMV 不重叠的本地输出目录
- **THEN** 在本地生成菜单及临时文件，配置指向发现的 BDMV 绝对路径，且不修改远端源文件

#### Scenario: 输出冲突

- **WHEN** 指定的输出目录与 BDMV 重叠，或者输出目录已存在
- **THEN** 明确拒绝并说明原因，不覆盖源目录或既有产物
