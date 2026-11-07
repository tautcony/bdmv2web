# bdmv2web

将 Blu-ray BDMV 目录转换为可离线打开的浏览器菜单，并支持通过系统播放器播放原始 M2TS 视频。

## 功能

- 生成包含菜单导航、背景视频、音轨、按钮图形和音效的离线菜单包。
- 检查 BDMV 结构，导出 HDMV、IGS、SUP 数据与菜单资源。
- 通过播放器打开菜单关联的原始 M2TS 文件。
- 校验菜单包的离线依赖并生成兼容性报告。

## 环境要求

| 依赖 | 版本或要求 | 用途 |
| --- | --- | --- |
| Node.js | `>=22` | 运行命令 |
| Node.js | `24.18.0`（`.node-version`） | 从源码构建 |
| pnpm | `11.25.0`，通过 `corepack pnpm` 调用 | 安装依赖和运行脚本 |
| ffmpeg | 可从 `PATH` 调用，需含 `libx265`、`libx264`、`aac` | 编码菜单背景视频与音轨 |
| ffprobe | 可从 `PATH` 调用 | 读取菜单媒体信息 |

默认用 `libx265`（HEVC）编码背景视频，`crf` 24；需要 H.264 时加 `--codec h264`（`crf` 缺省 18）。源为 HDR 时默认做色调映射转成 SDR BT.709，该步骤需要 FFmpeg 带 `zscale`（libzimg）或 `libplacebo`；两者都缺时仍会出包，但保留 HDR 标签并在诊断里给 `MEDIA_HDR_TONEMAP_UNAVAILABLE` 警告（画面在 SDR 屏上会发灰）。

## 安装

从 npm 全局安装，安装后命令名为 `bdmv2web`：

```sh
npm install -g bdmv2web
bdmv2web --version
```

从源码构建：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm generate:contracts
corepack pnpm build
corepack pnpm bundle:cli
```

从源码构建后，`apps/cli/dist/index.js` 为可直接执行的命令入口。在仓库中开发时，使用 `corepack pnpm run cli:dev <命令> [参数]` 调用 CLI。

## 快速开始

将 BDMV 目录转换为离线菜单包：

```sh
corepack pnpm run cli:dev build /path/to/BDMV --out ./BDMV-menu
```

用浏览器打开 `BDMV-menu/index.html`。复制或移动菜单时，请保留整个输出目录。

校验生成的菜单包：

```sh
corepack pnpm run cli:dev validate ./BDMV-menu --offline
```

## 常用命令

`<BDMV>` 可指向 BDMV 目录，也可指向包含 `BDMV/` 的父目录。

| 命令 | 用途 | 常用选项 |
| --- | --- | --- |
| `inspect <BDMV>` | 查看光盘结构和诊断信息 | `--format table\|json`、`--out FILE`、`--strict` |
| `extract <BDMV> --out DIR` | 导出 HDMV、IGS、SUP 分析数据 | `--type hdmv\|igs\|sup` 或 `--all` |
| `list <BDMV>` | 列出可导出的 IGS 和 SUP 资源 | `--type all\|igs\|sup`、`--m2ts CLIP_ID`、`--pid PID`、`--format table\|json` |
| `export <BDMV> --out DIR` | 导出 `.mnu` 和 `.sup` 原始资源 | `--type all\|igs\|sup`、`--m2ts CLIP_ID`、`--pid PID`、`--decode png` |
| `render <输入>` | 从 BDMV、`.mnu` 或 `.sup` 生成 PNG | `--out DIR`、`--type all\|igs\|sup`、`--mnu FILE`、`--sup FILE`、`--language LANG` |
| `build <BDMV>` | 生成离线菜单包 | `--out DIR`、`--title NAME`、`--player-profile FILE`、`--codec hevc\|h264`、`--crf N`、`--preset NAME`、`--hdr tonemap\|preserve`、`--overwrite`、`--strict` |
| `validate <菜单包目录> --offline` | 校验菜单包并更新审计报告 | `--format json`、`--strict` |

`build` 默认输出到 `<BDMV 父目录>/BDMV-menu`。输出目录已存在时，使用 `--overwrite` 覆盖。影片 PGS 字幕通过 `export --type sup` 导出。

`--m2ts` 和 `--pid` 的值可通过 `list` 查询。`export --decode png` 在导出原始资源时同时输出 PNG。`render` 读取 BDMV、`.mnu` 或 `.sup` 输入。

`assets-manifest.json` 的 `sup-png` 条目记录 `displaySet`、`startSeconds`、`endSeconds`、`width` 和 `height`。`startSeconds` 是该显示集的起点、`endSeconds` 是下一条显示集的起点，单位秒（3 位小数），以轨道起点为 0；无法确定时写 `null`。全透明显示集不输出 PNG，不写入清单。

`convert` 等同于 `build`。`bdmv2web --help` 列出全部命令，`bdmv2web <命令> --help` 列出该命令的选项。

命令成功时退出码为 0，失败时为 1；使用 `--strict` 时，部分完成的结果退出码为 2。完整选项、输出文件和错误码见[开发指南](docs/guides/development.md)。

## 播放器档案

通过 `build --player-profile FILE` 设置菜单语言、音轨语言、字幕语言、地区和播放配置：

```json
{
  "menuLanguage": "jpn",
  "audioLanguage": "jpn",
  "subtitleLanguage": "eng",
  "country": "JP",
  "region": "A",
  "outputProfile": "portable",
  "videoProfiles": ["1080p"],
  "audioProfiles": ["stereo"]
}
```

| 字段 | 必填 | 取值 | 默认 |
| --- | --- | --- | --- |
| `menuLanguage` | 是 | 3 个 ASCII 字母（PSR18） | `eng` |
| `audioLanguage` | 是 | 3 个 ASCII 字母（PSR16） | `eng` |
| `subtitleLanguage` | 是 | 3 个 ASCII 字母（PSR17） | `eng` |
| `country` | 是 | 2 个 ASCII 字母（PSR19） | `US` |
| `region` | 是 | `A` / `B` / `C` | `A` |
| `outputProfile` | 是 | `portable` | `portable` |
| `videoProfiles` | 否 | 字符串数组 | `[]` |
| `audioProfiles` | 否 | 字符串数组 | `[]` |


## 开发

```sh
corepack pnpm build                              # 编译运行时代码
corepack pnpm run cli:dev inspect /path/to/BDMV  # 直接运行 CLI
corepack pnpm lint                               # ESLint 检查
corepack pnpm lint:fix                           # 应用 ESLint 自动修复
corepack pnpm typecheck                          # 类型检查
corepack pnpm test                               # 运行测试
corepack pnpm test:all                           # 运行全部测试并收集失败结果
bash scripts/ci.sh                               # 运行完整 CI 检查
```

运行单个包的测试：

```sh
corepack pnpm --filter @bdmv2web/igs test
```

拉取本地参考源码缓存：

```sh
python3 scripts/fetch-reference-cache.py
```

### 仓库结构

| 路径 | 职责 |
| --- | --- |
| `apps/cli` | 命令行入口 |
| `packages/core` | DiscIR schema、生成类型、播放器档案和基础工具 |
| `packages/bdmv-io` | 输入发现、文件读取、哈希和输出事务 |
| `packages/bdmv-parser` | BDMV 文件解析与引用图 |
| `packages/hdmv` | HDMV 指令、导航图和虚拟机 |
| `packages/igs` | 传输流重组、IGS 场景提取和 PNG 编码 |
| `packages/media-export` | 菜单媒体导出、时间线和外部播放目标 |
| `packages/runtime-web` | 浏览器菜单运行时 |
| `packages/package-builder` | 菜单包生成和指纹计算 |
| `packages/test-runner` | 菜单包校验、诊断和交付判定 |
| `packages/test-fixtures` | 测试夹具和字节构造器 |
| `test-data/` | 测试夹具、光盘数据和输出目录 |

## 文档
工具链、CLI 详情和构建流程见[开发指南](docs/guides/development.md)。

更多资料见[文档索引](docs/README.md)。

## 许可

[GNU GPL v3](LICENSE)。
