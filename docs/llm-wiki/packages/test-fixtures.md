# `@bdmv2web/test-fixtures`

测试夹具包：手写的二进制构造器、最小 DiscIR golden、共享菜单交互向量。夹具只证明本项目实现的行为，不是独立协议证据。

## 文件

| 文件 | 内容 |
| --- | --- |
| `src/index.ts` | `minimalHdmvGolden`、`mixedBdjGolden`、`damagedUnknownVersion`、`damagedDanglingReference`、`loadGolden`、`buildCursorSample`、`simulatedBridge` |
| `src/bdmv.ts` | M1 字节构造器：`buildM1Index`、`buildM1MovieObject`、`buildM1Playlist*`、`buildM1ClipInfo*`、`buildM1Sound*`、`m1MovieObjectExpected` |
| `src/menu-runtime.ts` | `menuInteractionFixture`：两按钮场景 + 方向键/确认的期望动作 |
| `golden-manifest.json` | golden 与夹具的来源/用途登记 |

## 构造器用途

| 构造器 | 产出 |
| --- | --- |
| `buildM1Index({ version, first, top, hdmvTitle, bdjTitle, appInfo, uhd })` | `INDX` 文件：入口表、可选 AppInfo、可选 3.1 UHD 扩展 |
| `buildM1MovieObject(commands)` | `MOBJ`：每条 12 字节命令 |
| `buildM1EmptyPlaylist(version)` | 最小 MPLS |
| `buildM1PlaylistGolden()` | 两个 PlayItem + Mark 的 MPLS |
| `buildM1PlaylistWithAudioPid()` / `WithHevcVideo()` / `WithAppInfo()` | 特定声明组合 |
| `buildM1PlaylistWithSubPlayItem()` / `WithMultiClipSubPlayItem()` | SubPath / SubPlayItem |
| `buildM1ClipInfoProgramAndCpi()` / `WithHevcVideo()` / `WithSequence()` / `WithIgsCue()` | CLPI 的 ProgramInfo、CPI、SequenceInfo、IG 线索 |
| `buildM1EmptyClipInfo()` | 空 CLPI |
| `buildM1Sound()` / `buildM1SoundTwoRanges()` | `sound.bdmv` 采样表 |

所有构造器按字面字段值拼字节，不导入被测试的解析器。期望值（如 `m1MovieObjectExpected`）也是手写字面量。

## 使用约定

- 新用例优先用这些构造器组合出最小 BDMV 目录，再落到临时目录跑 `parseBdmv`。
- 需要更大样本时用 `scripts/package-hdmv-metadata-fixtures.mjs` 或 `scripts/export-igs-packet-fixtures.mjs` 从已有夹具生成归档，不直接提交 > 1 MiB 的新二进制。
- `test-data/fixtures/bdmvkit-generated/` 由 bdmvkit 生成，用于互操作；`test-data/fixtures/igs-parser/` 里外部来源的 ICS 样本必须保留来源与许可说明。
- 不在夹具、测试名或日志中写入真实碟片标题、机器路径或本地 `file://` URL。

## 改动入口

| 需求 | 位置 |
| --- | --- |
| 新增格式字段样本 | `src/bdmv.ts` 对应构造器，保持“字面值拼字节” |
| 新增交互向量 | `src/menu-runtime.ts` |
| 新增 golden | `src/index.ts` + `golden-manifest.json` 登记来源 |

同步：新增构造器后更新对应包的测试说明（[testing.md](../testing.md)）与 `docs/support/protocol-support.md` 的 fixture 列。
