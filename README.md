# bdmv2web

解析 Blu-ray 光盘目录，生成可在浏览器中交互的菜单，并通过系统播放器打开原始视频流。

## 能力

- 解析 `index.bdmv`、`MovieObject.bdmv`、MPLS、CLPI 和 `sound.bdmv`，提取光盘结构与导航信息。
- 解析 M2TS 中的 IGS 菜单，提取按钮、图形、调色板和指令。
- 执行 HDMV 导航指令，支持寄存器、分支、比较、MovieObject 和播放列表调用。
- 导出菜单背景视频、音轨和按钮音效，生成可在 Chrome 中打开的菜单包。
- 通过操作系统 URL Protocol 调用 IINA 或 PotPlayer，打开菜单关联的原始 M2TS 文件。
- 导出结构数据、菜单图形与诊断信息，校验生成的菜单包。

## 环境配置

| 依赖 | 版本或要求 | 用途 |
| --- | --- | --- |
| Node.js | `>=24.18.0` | 构建和运行命令 |
| pnpm | `>=11.25.0` | 安装依赖和运行脚本 |
| ffmpeg | 可从 `PATH` 调用 | 编码菜单背景视频与音轨 |
| ffprobe | 可从 `PATH` 调用 | 读取菜单媒体信息 |

## 安装

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm generate:contracts
corepack pnpm build
```

包内脚本统一写 `corepack pnpm`：根脚本里的嵌套调用（如 `build` = `generate:contracts` + `-r build`）因此不依赖全局 `pnpm`，版本也由 `packageManager` 锁定。

命令行入口为 `apps/cli/dist/index.js`，包内 bin 名为 `bdmv2web`。

## 使用

输入为 BDMV 目录或包含 `BDMV/` 的父目录。

| 命令 | 主要选项 | 产物 |
| --- | --- | --- |
| `inspect <BDMV>` | `--format table\|json`、`--out FILE`、`--allow-partial`、`--strict` | stdout 默认显示结构摘要表；`--out` 始终写完整 JSON；`--format json` 将完整 JSON 写到 stdout |
| `extract <BDMV> --out DIR` | 必须指定 `--type hdmv\|igs\|sup` 或 `--all`；`--strict` | 按类型写协议分析 JSON 及 `manifest.json`。HDMV 命令和结构、IGS 场景/来源映射、SUP 轨道索引分目录保存；不输出 PNG 或 SUP 文件 |
| `list-assets <BDMV>` | `--type all\|igs\|sup`、`--m2ts CLIP_ID`、`--pid PID`、`--decode png`、`--format table\|json`、`--out FILE` | stdout 默认显示资源汇总和明细，包括 M2TS clip、PID、IGS 图像对象属性及 SUP 轨道；`--out` 写完整 JSON |
| `export-assets <BDMV> --out DIR` | `--type all\|igs\|sup`、`--m2ts CLIP_ID`、`--pid PID`、`--decode png` | 导出所选 PID 的 igstools 兼容 `.mnu` 和/或已验证的 `.sup`；指定 `--decode png` 时另外输出图像 PNG；附 `assets-manifest.json` |
| `convert <BDMV>` | `--out DIR`、`--title NAME`、`--player-profile FILE`、`--overwrite`、`--strict` | 菜单包：`index.html`、`runtime/`、`assets/`、`manifest.json`、`asset-manifest.json`、`media-plan.json`、`external-targets.json`、`compatibility.json`、`report.json`。默认目录为 `<BDMV 父目录>/BDMV-menu`；影片 PGS 需单独导出 |
| `validate <菜单包目录> --offline` | `--format json`、`--strict` | 更新 `compatibility.json`、`dependency-audit.json`、`reports/release-summary.json` |
| `compare <输入>` | `--mode`、`--strict`、`--format json` | 未实现，返回 `E_NOT_IMPLEMENTED` |

`partial` 默认退出码为 0，`--strict` 时为 2；失败为 1。`inspect --allow-partial` 强制返回 0。`convert` 生成统一离线菜单包；输出目录已存在时需加 `--overwrite`。`--limits` 尚未实现。

`extract` 面向协议分析，保留场景、命令、轨道及来源信息；`export-assets` 按 M2TS clip 和 PID 导出 IGS `.mnu` 与 SUP 文件，`--decode png` 可额外生成 PNG。`--m2ts` 和 `--pid` 使用 `list-assets` 表格或 JSON 中的 clip 与 PID 值。

## 播放器档案

使用 `convert --player-profile FILE` 指定菜单语言、音轨语言、字幕语言、地区和播放配置。例如：

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

省略档案时使用默认值。长度不符或含非 ASCII 字符会以 `CLI_INVALID_PROFILE` 退出 1。相关信息记录于 `manifest.json` 与 `runtime/disc-data.js`。

## 开发

```sh
corepack pnpm build         # 编译运行时代码
corepack pnpm typecheck     # 类型检查，包括测试文件
corepack pnpm test          # 运行各包测试
corepack pnpm test:all      # 运行各包测试，不加 --bail
bash scripts/ci.sh          # 安装、生成契约、构建、类型检查和测试
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

| 文档 | 内容 |
| --- | --- |
| [docs/development.md](docs/development.md) | 工具链、契约、CLI 和测试 |
| [docs/protocol-support.md](docs/protocol-support.md) | 结构解析范围 |
| [docs/hdmv-support.md](docs/hdmv-support.md) | HDMV 指令与虚拟机支持 |
| [docs/igs-support.md](docs/igs-support.md) | IGS 提取与色域处理 |
| [docs/browser-matrix.md](docs/browser-matrix.md) | 浏览器验收环境 |
| [docs/references/README.md](docs/references/README.md) | 参考实现与许可 |
| [openspec/specs/](openspec/specs/) | 项目规格 |
| [docs/bdmv_hdmv_offline_web_architecture.md](docs/bdmv_hdmv_offline_web_architecture.md) | 技术设计记录 |

## 许可

[GNU GPL v3](LICENSE)。
