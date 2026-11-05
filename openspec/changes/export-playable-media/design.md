# Design

## Context

M1 提供结构及 PlayItem 与 Clip 引用，M2/M3 提供菜单和导航。M5 将影片动作映射到实际 M2TS 并交给系统处理；不再创建浏览器中的完整影片播放器。共享约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。

## Decisions

### 单一产物

`convert INPUT --out DIR` 生成同一种离线菜单包，不再提供 menu-only / standalone-full 两种产品模式。菜单运行资产自包含；影片使用用户可访问的原始 M2TS，不转码、不默认复制大文件。报告和 README 必须说明影片对源文件及系统文件关联的依赖。包移动后菜单仍可运行，影片引用需仍有效或由用户重新关联；不能声称包在移走原碟后仍可播放影片。旧模式参数与旧包的迁移策略应明确实现并测试，不静默改变其含义。

### 输出位置和源路径配置

发现输入的 BDMV 目录后，默认将 HTML 输出目录与该 BDMV 目录并排。例如 `影片/BDMV/` 对应 `影片/BDMV-menu/`。用户可通过 `--out` 指定其他输出路径，包括本地目录；输出不得与源目录重叠。默认拒绝已存在的输出，只有显式传入 `--overwrite` 才替换现有菜单包。替换使用 staging/backup 事务，生成失败时保留原包。若旧包的媒体计划与本次 Playlist、Clip、时间范围、流声明和编码设置一致，复制并复用 H.264/AAC 文件；不匹配或文件缺失时重新转码。此复用比较计划元数据，不对源 M2TS 做内容指纹校验。非同级输出的可编辑配置默认使用发现的 BDMV 绝对路径。输入是 BDMV 自身还是其直接父目录，均以发现的 BDMV 为基准。

产物包含可编辑的独立配置文件，声明指向 BDMV 的路径；默认使用相对 HTML 输出目录的 `../BDMV`，以实际目录名生成。允许用户调整为相对路径或绝对本地路径；相对路径始终以 HTML 输出目录为基准，不以当前工作目录为基准。浏览器及可能需要的本地启动接入必须使用同一配置，并在重新加载后生效。浏览器 `file://` 限制下配置格式和加载方式应经验证，不能假设可 fetch 本地 JSON；README 须给出可编辑示例及重载方式。

目录整体移动时相对配置仍指向同级 BDMV；仅移动 HTML 时可修改配置重新定位。配置路径解析为用户指定的 BDMV 根后，仍只允许打开该根 `STREAM` 下已解析的 M2TS，不允许片段引用逃逸。配置错误或目标缺失时提示配置位置及问题；变更配置后相关路径及交接证据须重新验证，不得沿用旧证据。

### 影片映射

保守合并入口、对象及按钮导航边，保留 Playlist、PlayItem、Clip、源路径和 IN/OUT 等来源信息。条件分支取并集；动态目标无法确定时保留 unknown。播放动作只能打开已解析且实际存在的 M2TS，不靠文件排序猜测。对多个 PlayItem、重复 Clip、分支或非零 IN/OUT，单独打开某个文件不等同于播放整个 Playlist；展示实际交接范围和限制，无法确定目标时提供可见诊断，不声称等价播放。

### Top Menu 背景媒体识别

菜单 Playlist 由 `index.bdmv` 的 Top Menu 入口及 HDMV MovieObject 执行结果确定。转换时运行 First Play MovieObject 读取初始化状态，再通过 `selectTitle(0)` 进入 Top Menu；Top Menu MovieObject 发出的 `PLAY_PL` 指定菜单 Playlist。背景媒体按 Playlist 的 PlayItem 和 mark 生成：单片、同源 Clip 的连续区间作为完整时间线；重复尾段或有效 loop mark 设置循环。跨 Clip、时间间隙、流声明变化和多角度序列记录为媒体不可用。无循环背景播放完后保留末帧，并把 `MEDIA_ENDED` 交给 VM。AVC/H.264 与 HEVC 视频统一转成包内 H.264。

### 系统交接与能力边界

用户触发影片动作后，前端将已映射的 M2TS 转成 `file://` URL 并调用操作系统 URL Protocol。macOS 使用 `iina://open?url=<encoded-file-url>`；Windows 使用 `potplayer://<file-url>`。运行时按操作系统选择协议。`runtime/bdmv-config.js` 保存 BDMV 路径；移动菜单包或源目录后可修改配置并重新加载。播放动作发出协议请求后，VM 继续处理菜单导航；外部播放器负责影片播放。

`PLAY_PLAYLIST_MARK` 的 `time45k` 是所指 PlayItem 的 Clip 时间戳。系统将 mark/PlayItem 时间转换为 90 kHz，再减去 CLPI 中与 PlayItem `stc_id` 对应的 STC `presentation_start_time`，得到 M2TS 内相对跳转位置。IINA 1.4.4 或更新版本通过 `mpv_start` 接收秒数；Windows 上的 PotPlayer 打开目标 M2TS。页面记录协议请求，VM 随后恢复菜单导航；播放、暂停、章节、音轨、字幕与播放结束由外部播放器处理。

对 IGS 页面，Escape 优先沿当前焦点按钮的导航邻接关系执行唯一的隐藏 auto-action 按钮（若存在），使光盘脚本定义的返回命令可用；否则使用配置的 Escape 映射。

### 安全与资源

输入只读。路径以已解析的可信 BDMV 文件表为来源，验证目标存在、为预期 STREAM 下的 M2TS 且不通过路径穿越或符号链接逃逸；路径中中文、空格、`#`、`%` 均须正确处理。若需本地接入，使用参数数组或等效安全 API，不拼接 shell 命令。用户选定的源 M2TS 是显式允许的外部文件引用，与菜单资源的包内引用分开审计；不得把任意外部路径或网络依赖当成允许的影片引用。

菜单背景视频、菜单音轨、WAV 和 IGS 仍属于网页菜单资源；动态背景和菜单音轨继续在转换阶段使用 FFmpeg 生成 MP4/M4A 并用 FFprobe 检验，再随包交付，运行时不依赖 FFmpeg。其既有转换/播放流程保留，不因此引入网页正片转码或控制要求。系统关联程序与源 M2TS 是影片功能的运行前提，离线包审计须报告其可用性是否已验证，不将外部文件纳入生成资产哈希或当作包内资源。

## Verification / Exit Criteria

验证单 Clip 映射、多个 PlayItem/重复 Clip、未知目标、缺失文件、中文/空格/`#`/`%` 特殊路径和协议请求；核对实际打开的文件。macOS/IINA 与 Windows/PotPlayer 分别记录 Chrome、播放器版本、用户动作、观察结果和制品证据，并验证断网、菜单包移动和外部源可用状态。
