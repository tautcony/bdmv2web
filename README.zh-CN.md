# bdmv2web

[English](README.md) | 简体中文

[![npm 版本](https://img.shields.io/npm/v/bdmv2web)](https://www.npmjs.com/package/bdmv2web)
[![node](https://img.shields.io/node/v/bdmv2web)](https://nodejs.org)
[![许可](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)

检查 Blu-ray BDMV 光盘结构，并为 HDMV 和 BD-J 光盘生成离线菜单包。

`bdmv2web` 读取 Blu-ray BDMV 目录，输出包含菜单导航、媒体、图形和音效的菜单包。HDMV 菜单包可直接通过 `file://` 打开。BD-J 菜单包通过本地 `serve` 命令、Java 运行时和 loopback HTTP 地址运行。两种模式均可离线使用。

- 生成包含菜单导航、背景视频、音轨、按钮图形和音效的离线菜单包。
- 从打包的应用 JAR 运行 BD-J Xlet，并使用本地 Java 进程。
- 将 BD-J 可访问 Playlist 的视频和音轨打包为浏览器播放资产。`build --overwrite` 会复用匹配的媒体资产。
- 检查 BDMV 结构，导出 HDMV、IGS、SUP 数据与菜单资源。
- 将受支持的整文件正片播放交给系统播放器。
- 校验菜单包的离线依赖并生成兼容性报告。

## 目录

- [安装](#安装)
  - [依赖](#依赖)
  - [从 npm 安装](#从-npm-安装)
  - [从源码构建](#从源码构建)
- [使用](#使用)
  - [CLI](#cli)
  - [播放器档案](#播放器档案)
- [开发](#开发)
  - [仓库结构](#仓库结构)
- [文档](#文档)
- [维护者](#维护者)
- [参与贡献](#参与贡献)
- [许可](#许可)

## 安装

### 依赖

| 依赖 | 版本或要求 | 用途 |
| --- | --- | --- |
| Node.js | `>=22` | 运行命令 |
| Node.js | `24.18.0`（`.node-version`） | 从源码构建 |
| pnpm | `11.25.0`，通过 `corepack pnpm` 调用 | 安装依赖和运行脚本 |
| ffmpeg | 可从 `PATH` 调用，需含 `libx265`、`libx264`、`aac` | 编码菜单背景视频与音轨 |
| ffprobe | 可从 `PATH` 调用 | 读取菜单媒体信息 |
| Java 运行时 | Java 21 或兼容 `java.desktop`；仅 BD-J 包需要 | 通过 `serve` 运行打包的 BD-J Xlet |

默认用 `libx265`（HEVC）编码背景视频，`crf` 24；需要 H.264 时加 `--codec h264`（`crf` 缺省 18）。源为 HDR 时默认做色调映射转成 SDR BT.709，该步骤需要 FFmpeg 带 `zscale`（libzimg）；缺该滤镜时仍会出包，但保留 HDR 标签并在诊断里给 `MEDIA_HDR_TONEMAP_UNAVAILABLE` 警告（画面在 SDR 屏上会发灰）。

### 从 npm 安装

全局安装后命令名为 `bdmv2web`：

```sh
npm install -g bdmv2web
bdmv2web --version
```

### 从源码构建

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm generate:contracts
corepack pnpm build
corepack pnpm bundle:cli
```

从源码构建后，`apps/cli/dist/index.js` 为可直接执行的命令入口。在仓库中开发时，使用 `corepack pnpm run cli:dev <命令> [参数]` 调用 CLI。

## 使用

将 BDMV 目录转换为离线菜单包：

```sh
bdmv2web build /path/to/BDMV --out ./BDMV-menu
```

用浏览器打开 `BDMV-menu/index.html`。复制或移动菜单时，请保留整个输出目录。

校验生成的菜单包：

```sh
bdmv2web validate ./BDMV-menu --offline
```

### HDMV 与 BD-J 播放

直接打开 `BDMV-menu/index.html` 可运行 HDMV 菜单包。菜单媒体保存在输出包内。正片播放由配置的外部播放器适配器处理。

构建阶段会将 BD-J 可访问 Playlist 的 PlayItem 导出为 MP4 视频和 AAC 音频，并写入输出目录。等价媒体引用共用资产。使用 `--overwrite` 时，匹配媒体计划的资产会复用；源区间或编码设置变化时会重新导出。

使用本地 Java 运行时启动 BD-J 菜单包：

```sh
bdmv2web serve ./BDMV-menu [--port 4173] [--java <executable>]
```

打开 `serve` 打印的 loopback 地址。通过 `file://` 打开 BD-J 页面时，页面会显示启动命令。`--player system` 会打开受支持的整文件目标；系统播放器不支持有边界和多片段播放。外部播放器启动结果为 `requested`；菜单运行时不观察正片播放状态。

### CLI

`<BDMV>` 可指向 BDMV 目录，也可指向包含 `BDMV/` 的父目录。

| 命令 | 用途 | 常用选项 |
| --- | --- | --- |
| `inspect <BDMV>` | 查看光盘结构和诊断信息 | `--format table\|json`、`--out FILE`、`--strict` |
| `extract <BDMV> --out DIR` | 导出 HDMV、IGS、SUP 分析数据 | `--type hdmv\|igs\|sup` 或 `--all` |
| `list <BDMV>` | 列出可导出的 IGS 和 SUP 资源 | `--type all\|igs\|sup`、`--m2ts CLIP_ID`、`--pid PID`、`--png-level 0-9`、`--format table\|json` |
| `export <BDMV> --out DIR` | 导出 `.mnu` 和 `.sup` 原始资源 | `--type all\|igs\|sup`、`--m2ts CLIP_ID`、`--pid PID`、`--decode png`、`--png-level 0-9` |
| `render <输入>` | 从 BDMV、`.mnu` 或 `.sup` 生成 PNG | `--out DIR`、`--type all\|igs\|sup`、`--mnu FILE`、`--sup FILE`、`--language LANG`、`--png-level 0-9` |
| `build <BDMV>` | 生成离线菜单包 | `--out DIR`、`--title NAME`、`--player-profile FILE`、`--codec hevc\|h264`、`--crf N`、`--preset NAME`、`--hdr tonemap\|preserve`、`--png-level 0-9`、`--overwrite`、`--strict` |
| `validate <菜单包目录> --offline` | 校验菜单包并更新审计报告 | `--format json`、`--strict` |
| `serve <菜单包目录>` | 提供菜单包并运行 BD-J Java 会话 | `--port N`、`--java EXECUTABLE`、`--player system`、`--disc-id HEX` |

`build` 默认输出到 `<BDMV 父目录>/BDMV-menu`。输出目录已存在时，使用 `--overwrite` 覆盖。影片 PGS 字幕通过 `export --type sup` 导出。

`--m2ts` 和 `--pid` 的值可通过 `list` 查询。`export --decode png` 在导出原始资源时同时输出 PNG。`render` 读取 BDMV、`.mnu` 或 `.sup` 输入。

`assets-manifest.json` 的 `sup-png` 条目记录 `displaySet`、`startSeconds`、`endSeconds`、`width` 和 `height`。`startSeconds` 是该显示集的起点、`endSeconds` 是下一条显示集的起点，单位秒（3 位小数），以轨道起点为 0；无法确定时写 `null`。全透明显示集不输出 PNG，不写入清单。

`convert` 等同于 `build`。`bdmv2web --help` 列出全部命令，`bdmv2web <命令> --help` 列出该命令的选项。

命令成功时退出码为 0，失败时为 1；使用 `--strict` 时，部分完成的结果退出码为 2。完整选项、输出文件和错误码见[开发指南](docs/guides/development.md)。

### 播放器档案

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
corepack pnpm lint                               # ESLint 和 Java 检查
corepack pnpm lint:fix                           # 应用 ESLint 自动修复
corepack pnpm lint:java                          # 检查 BD-J 主机 Java 样式和 Java 8 编译
corepack pnpm typecheck                          # 类型检查
corepack pnpm test                               # 运行测试
corepack pnpm test:all                           # 运行全部测试并收集失败结果
bash scripts/ci.sh                               # 运行完整 CI 检查
```

`corepack pnpm lint:java` 需要 JDK 21 或更新版本；首次运行时会下载固定版本的 Checkstyle。

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

工具链、CLI 详情和构建流程见[开发指南](docs/guides/development.md)。BD-J 运行要求和已实现操作见[BD-J 支持指南](docs/support/bdj-support.md)。协议支持边界见[支持范围文档](docs/support/protocol-support.md)。

全部指南、支持矩阵与归档的设计和审查记录见[文档索引](docs/README.md)。

## 维护者

- TautCony（[@tautcony](https://github.com/tautcony)）

## 许可

[GPL-3.0-only](LICENSE)。Copyright (C) 2026 TautCony。
