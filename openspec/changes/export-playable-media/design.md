# Design

## Context

当前产品将菜单动作映射到实际 M2TS，并通过系统 URL Protocol 请求外部播放器。浏览器内完整正片播放器不是交付目标。共享约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。

## Decisions

### 单一产物

`convert INPUT --out DIR` 当前只生成一种离线菜单包，不提供模式参数。CLI JSON 输出、manifest 和 report 不包含产物模式字段。菜单运行资产自包含；影片使用用户可访问的原始 M2TS，不转码、不默认复制大文件。报告和 README 必须说明影片对源文件及系统文件关联的依赖。包移动后菜单仍可运行，影片引用需仍有效或由用户重新关联。

### 输出位置和源路径配置

发现输入的 BDMV 目录后，默认将 HTML 输出目录与该 BDMV 目录并排。例如 `影片/BDMV/` 对应 `影片/BDMV-menu/`。用户可通过 `--out` 指定其他输出路径，包括本地目录；输出不得与源目录重叠。默认拒绝已存在的输出，只有显式传入 `--overwrite` 才替换现有菜单包。替换使用 staging/backup 事务，生成失败时保留原包。若旧包的媒体计划与本次 Playlist、Clip、时间范围、流声明和编码设置一致，复制并复用 H.264/AAC 文件；不匹配或文件缺失时重新转码。此复用比较计划元数据，不对源 M2TS 做内容指纹校验。非同级输出的可编辑配置默认使用发现的 BDMV 绝对路径。输入是 BDMV 自身还是其直接父目录，均以发现的 BDMV 为基准。

产物包含可编辑的 `runtime/bdmv-config.js`；CLI 当前按输出位置写入相对或绝对 BDMV 路径，浏览器从该配置读取并在重新加载后生效。相对路径以 HTML 输出目录为基准。仍需完成共同移动、单独移动、配置编辑与 reload 的验收记录。

目录整体移动时相对配置仍指向同级 BDMV；仅移动 HTML 时可修改配置重新定位。配置路径解析为用户指定的 BDMV 根后，仍只允许打开该根 `STREAM` 下已解析的 M2TS，不允许片段引用逃逸。配置错误或目标缺失时提示配置位置及问题；变更配置后相关路径及交接证据须重新验证，不得沿用旧证据。

### 影片映射

保守合并入口、对象及按钮导航边，保留 Playlist、PlayItem、Clip、源路径和 IN/OUT 等来源信息。条件分支取并集；动态目标无法确定时保留 unknown。播放动作只能打开已解析且实际存在的 M2TS，不靠文件排序猜测。对多个 PlayItem、重复 Clip、分支或非零 IN/OUT，单独打开某个文件不等同于播放整个 Playlist；展示实际交接范围和限制，无法确定目标时提供可见诊断，不声称等价播放。

### Top Menu 背景媒体识别

菜单 Playlist 由 `index.bdmv` 的 Top Menu 入口及 HDMV MovieObject 执行结果确定。转换时运行 First Play MovieObject 读取初始化状态，再通过 `selectTitle(0)` 进入 Top Menu；Top Menu MovieObject 发出的 `PLAY_PL` 指定菜单 Playlist。背景媒体按 Playlist 的 PlayItem 和 mark 生成：单片、同源 Clip 的连续区间作为完整时间线；重复尾段或有效 loop mark 设置循环。跨 Clip、时间间隙、流声明变化和多角度序列记录为媒体不可用。无循环背景播放完后保留末帧，并把 `MEDIA_ENDED` 交给 VM。AVC/H.264 与 HEVC 视频统一转成包内 H.264。

### 菜单场景与影片角色

IGS `uiModel` 决定场景角色。`uiModel=0` 的场景是常驻菜单画面，进入 `menuScenes` 和 `menuPlaylistIds`。`uiModel=1` 的场景是标题播放期间的弹出菜单，只进入 `popupScenes`，不替换 Top Menu 画面。带弹出 IGS 的 Playlist 是影片播放，交给外部播放器，不进入包内媒体；该类 Playlist 不因带有 IGS 子路径而成为菜单 Playlist。解析出的 Top Menu Playlist 的选中构图始终作为菜单面进入 `menuScenes` 和 `menuPlaylistIds`（常规盘面该构图是 `uiModel=0`；转换链上没有任何 `uiModel=0` 场景时它是 `uiModel=1`）；其 `PLAY_PLAYLIST` 按菜单面处理，不进入 `preMenuPlaylistIds`。

转换阶段对每个可达的菜单 Playlist 检查单 Clip 连续时间线。Top Menu 使用 `assets/media/`；其他可本地表示的菜单 Playlist 使用 `assets/media/playlist-<id>/` 和独立 `media-plans/playlist-<id>.json`。Top Menu 解析按实际 VM 转换前进：片头或警告的 `PLAY_PLAYLIST` 通过 `MEDIA_ENDED` 继续，`TITLE_SEARCH` 继续跟随，直到第一个带 `uiModel=0` 场景的 `PLAY_PLAYLIST`、`PLAY_PLAYLIST_ITEM` 或 `PLAY_PLAYLIST_MARK`。转换阶段把经过的片头 Playlist 记录到 `preMenuPlaylistIds`；运行时在 VM 中完成这些 Playlist，不交给外部播放器。菜单场景按 Playlist 与选中 PlayItem 记录，运行时按 `playItem` 切换。

IGS 提取支持分片 ICS：start 段带 12 字节头与总长度，continuation/end 段带 9 字节公共头；提取器拼接 payload 后重写 sequence flags 和总长度，再按 END 提交场景。still 菜单 PlayItem 可导出无音频的循环视频；运行时的菜单媒体桥允许空音轨。

运行时按 `PLAY_PLAYLIST`、`PLAY_PLAYLIST_ITEM` 或 `PLAY_PLAYLIST_MARK` 选择菜单媒体并切换视频、音频和循环设置；无法本地表示的菜单 Playlist 保留当前菜单背景并记录诊断。

### 系统交接与能力边界

用户触发影片动作后，前端按映射将 M2TS 转成 `file://` URL 并调用操作系统 URL Protocol。运行时按当前实现选择 IINA 或 PotPlayer 协议。播放动作只报告协议请求，不伪造开始/结束状态；VM 对应等待可恢复，菜单继续可操作。真实播放器打开和目标路径行为仍需环境验证。

`PLAY_PLAYLIST_MARK` 的 `time45k` 是所指 PlayItem 的 Clip 时间戳。系统将 mark/PlayItem 时间转换为 90 kHz，再减去 CLPI 中与 PlayItem `stc_id` 对应的 STC `presentation_start_time`，得到 M2TS 内相对跳转位置。IINA 1.4.4 或更新版本通过 `mpv_start` 接收秒数；Windows 上的 PotPlayer 打开目标 M2TS。页面记录协议请求，VM 随后恢复菜单导航；播放、暂停、章节、音轨、字幕与播放结束由外部播放器处理。

对 IGS 页面，Escape 优先沿当前焦点按钮的导航邻接关系执行唯一的隐藏 auto-action 按钮（若存在），使光盘脚本定义的返回命令可用；否则使用配置的 Escape 映射。

### 安全与资源

输入只读。路径以已解析的可信 BDMV 文件表为来源，验证目标存在、为预期 STREAM 下的 M2TS 且不通过路径穿越或符号链接逃逸；路径中中文、空格、`#`、`%` 均须正确处理。若需本地接入，使用参数数组或等效安全 API，不拼接 shell 命令。用户选定的源 M2TS 是显式允许的外部文件引用，与菜单资源的包内引用分开审计；不得把任意外部路径或网络依赖当成允许的影片引用。

菜单背景视频、菜单音轨、WAV 和 IGS 属于网页菜单资源；需要动态菜单媒体时，转换阶段使用 FFmpeg/FFprobe 生成并检查包内 MP4/M4A。正片 M2TS 不转码、不纳入包。系统关联程序与源 M2TS 是影片功能的外部运行前提，离线审计单独报告其验证状态；不对外部源或包内容计算内容指纹。

## Verification / Exit Criteria

验证单 Clip 映射、多个 PlayItem/重复 Clip、未知目标、缺失文件、中文/空格/`#`/`%` 特殊路径和协议请求；核对实际打开的文件。记录所用浏览器、操作系统、默认关联程序、版本、用户动作和观察结果；支持环境分别验证。断网、菜单包移动和外部源可用状态仍待实测。
