# bdmv2web

解析 Blu-ray 光盘目录，生成可在浏览器中交互的菜单，并通过本地播放器打开原始视频流。

## 能力

- 解析 `index.bdmv`、`MovieObject.bdmv`、MPLS、CLPI 和 `sound.bdmv`，提取光盘结构与导航信息。
- 解析 M2TS 中的 IGS 菜单，提取按钮、图形、调色板和指令。
- 执行 HDMV 导航指令，支持寄存器、分支、比较、MovieObject 和播放列表调用。
- 导出菜单背景视频、音轨和按钮音效，生成可在 Chrome 中打开的菜单包。
- 通过 shell 启动器调用默认媒体播放器，播放菜单关联的原始 M2TS 文件。
- 导出结构数据、菜单图形与诊断信息，校验生成的菜单包。

## 环境配置

| 依赖 | 版本或要求 | 用途 |
| --- | --- | --- |
| Node.js | `>=24.18.0 <25`（自带 corepack） | 构建和运行命令 |
| pnpm | `11.25.0`，由 `corepack pnpm` 按 `packageManager` 取用；不要求全局安装 | 安装依赖和运行脚本 |
| ffmpeg / ffprobe | 可从 `PATH` 调用 | 导出菜单媒体 |

## 安装

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm generate:contracts
corepack pnpm build
```

包内脚本统一写 `corepack pnpm`：根脚本里的嵌套调用（如 `build` = `generate:contracts` + `-r build`）因此不依赖全局 `pnpm`，版本也由 `packageManager` 锁定。若已全局安装 pnpm，`pnpm install` 之类的等价写法仍可用。

命令行入口为 `apps/cli/dist/index.js`，包内 bin 名为 `bdmv2web`。

## 使用

输入为 BDMV 目录，或包含一个 `BDMV/` 子目录的父目录。目录需包含 `index.bdmv`、`MovieObject.bdmv`、`PLAYLIST/` 和 `CLIPINF/`；提取菜单场景还需要 `STREAM/*.m2ts`。输入内容需已解除 AACS/BD+，输入树不能包含符号链接。

### 解析结构

```sh
node apps/cli/dist/index.js inspect "/path/to/Disc/BDMV"
```

使用 `--out` 将结果写入尚不存在的文件：

```sh
node apps/cli/dist/index.js inspect "/path/to/Disc/BDMV" --out /tmp/disc.json
```

### 提取结构与菜单图形

```sh
node apps/cli/dist/index.js extract "/path/to/Disc/BDMV" --out "/path/to/extracted"
```

输出包括结构数据、场景、原始指令、来源映射、IGS 诊断、外部媒体目标和 PNG 图形。

### 生成菜单包

```sh
node apps/cli/dist/index.js convert "/path/to/Disc/BDMV" \
  --title "My Disc" \
  --out "/path/to/output/my-disc-menu"
```

省略 `--out` 时，输出到 `<BDMV 父目录>/BDMV-menu`。输出目录与输入目录不能互为父子目录。`--title` 默认为 BDMV 父目录名。

### 打开菜单包

在 Chrome 中打开生成的 `index.html`，即可使用菜单、背景视频和音效。

需要从菜单播放原始视频流时，运行 shell 启动器：

```sh
cd "/path/to/output/my-disc-menu"
./start-menu.sh
```

启动器需要 Node.js。它会启动本地回环桥并用 Google Chrome 打开菜单；菜单触发播放时，默认关联的媒体播放器会打开对应的 `STREAM/*.m2ts`。关闭终端窗口即可停止回环桥。若 Chrome 不在可搜索的位置，可通过 `BROWSER` 环境变量指定其可执行文件路径。

移动菜单包后，可修改 `bdmv-config.json` 中原始 BDMV 的绝对路径或相对包目录的路径，重启启动器后生效。

### 校验菜单包

```sh
node apps/cli/dist/index.js validate "/path/to/output/my-disc-menu" --offline
```

校验结果写入 `compatibility.json`、`dependency-audit.json` 和 `reports/release-summary.json`。使用 `--format json` 输出机器可读结果（该选项当前只接受 `json`）。校验不会改写 `manifest.json` 中的状态；两者不一致时会以 `MANIFEST_STATUS_UNVERIFIED` 记录差异。

## 命令行

| 命令 | 用途 | 常用选项 |
| --- | --- | --- |
| `inspect` | 解析并输出光盘结构和诊断 | `--out FILE`、`--allow-partial`、`--strict` |
| `extract` | 导出结构数据和菜单图形 | `--out DIR`（必填）、`--strict` |
| `list-assets` | 列举可达标题的 IGS 图片与 PGS SUP 字幕声明 | `--type all\|igs\|pgs` |
| `export-assets` | 导出 IGS PNG 图片和解析验证后的 SUP 字幕，并写入资源类型、导出路径和大小清单 | `--out DIR`（必填）、`--type all\|igs\|pgs` |
| `convert` | 生成菜单包 | `--out DIR`、`--title`、`--mode menu-only`、`--player-profile FILE`、`--strict` |
| `validate` | 校验菜单包 | `--offline`（必填）、`--format json`、`--strict` |

`inspect` 和 `extract` 使用 `stageStatus` 表示解析状态（成功和失败都用这个字段），`convert` 和 `validate` 使用 `status` 表示交付状态。状态为 `partial` 时默认退出码为 0，使用 `--strict` 时退出码为 2；失败时退出码为 1。`inspect --allow-partial` 在解析失败时也返回 0，报告仍保留 `failed` 状态。

`status` 只由失败证据决定：`complete` 表示"没有已知失败"，不等于"全部已验证"。没有执行检查、覆盖率未测量、浏览器证据缺失或过期都不会降低状态，而是列在 `report.json` 的 `notVerified` 与 `release-summary.json` 的 `gaps` 中；只有 `fail` 检查、`error`/`fatal` 诊断、缺失必需资产、未解析可达路径与可达但不支持的能力会降低状态。

拼错的选项不会被忽略：命令不支持的 `--*` 会以 `CLI_UNKNOWN_OPTION` 退出 1，多余的位置参数报 `CLI_USAGE`。

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

省略档案时使用默认值。语言码统一转小写、国家码统一转大写；长度不符或含非 ASCII 字符会以 `CLI_INVALID_PROFILE` 退出 1，而不会等到运行期才报错。档案会写入菜单包的 `manifest.json` 与 `runtime/disc-data.js`。

## 输出包结构

```text
my-disc-menu/
├── index.html                 # 菜单入口
├── runtime/                   # 浏览器运行时、光盘数据和菜单图形
├── assets/media/              # 菜单背景视频和音轨
├── assets/audio/              # 支持的按钮音效
├── bdmv-config.json           # 原始 BDMV 路径
├── external-targets.json      # 可外部播放的 playlist/clip
├── local-player-bridge.mjs    # 本地播放桥
├── start-menu.sh              # shell 启动器
├── manifest.json              # 文件清单和指纹
├── asset-manifest.json        # 音频和媒体资产元数据
├── media-plan.json            # 媒体导出计划
├── compatibility.json         # 兼容性声明
└── report.json                # 交付结论和诊断
```

## 开发

```sh
corepack pnpm build         # 编译运行时代码
corepack pnpm typecheck     # 类型检查，包括测试文件
corepack pnpm test          # 运行各包测试
corepack pnpm test:all      # 运行各包测试，不加 --bail
bash scripts/ci.sh          # 安装、生成契约、构建、类型检查和测试（内部同样走 corepack）
```

运行单个包的测试：

```sh
corepack pnpm --filter @bdmv2web/igs test
```

拉取本地参考源码缓存（需要网络和 Python 3）：

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
