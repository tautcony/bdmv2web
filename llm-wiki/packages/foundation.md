# packages/foundation：`core` + `bdmv-io`

两个包都不做业务解析，只提供其他包依赖的底座。改这里先确认影响面：所有包都会受影响。

## `@bdmv2web/core`

| 文件 | 内容 |
| --- | --- |
| `schema/disc-ir.schema.json` | DiscIR 唯一源 |
| `src/disc-ir.generated.ts` | `json2ts` 生成，禁止手改 |
| `src/index.ts` | `DiscIR` 类型、`parseDiscIR`、Time90k、`Limits` 工具、`ActionEnvelope`/`EventEnvelope`、`PlayerProfile` |
| `src/limits.ts` | `DEFAULT_LIMITS`、`validateLimits` |
| `src/defaults.ts` | `DEFAULT_PLAYER_PROFILE` |
| `src/binary-cursor.ts` | `BinaryCursor`：有界读取 `u8/u16be/u32be/u64be/bytes/seek/subview` |
| `src/contract-error.ts` | `ContractError(code, path, message)` |
| `src/browser.ts` | 浏览器入口，仅重导出无 Node 依赖的部分 |

### 公开接口

```ts
parseDiscIR(input: unknown): DiscIR
parseTime90k(value: string): bigint
serializeTime90k(value: bigint): Time90k
parseOffset(value: string): bigint
serializeOffset(value: bigint): string
from45k(value: string): Time90k
assertWithinLimit(value: number | bigint, key: keyof Limits, limits?): void
allocateBoundedBytes(size, key, limits?): Uint8Array
checkedObjectPixels(width, height, limits?): number
validateStage<T>(value: T, stage: "parsed" | "normalized" | "runtime"): T
validateLimits(value: unknown): Limits
class BinaryCursor
```

`BinaryCursor` 的所有读取都先 `checkLength`，越界报 `TRUNCATED_INPUT`；`seek` 不越界但报 `INVALID_OFFSET`；`subview` 保留绝对偏移，子游标诊断可还原到父文件偏移。

### 约束

- 不引入 Node 内建。`scripts/build-core-browser.mjs` 会扫描 esbuild metafile，出现 `node:`/`fs`/`path`/`crypto` 直接失败。
- 不做内容哈希/指纹校验。
- `validateStage(..., "runtime")` 里对 `BDJ` 只保留、不报错；能力声明由消费者负责。

### 改动入口

- 新字段：改 schema → `pnpm generate:contracts` → 修所有构造 `DiscIR` 的地方（CLI `createMenuDiscIR`、`package-builder`、`runtime-web` 的 `validateEmbeddedDiscIR`）。
- 新限流项：`Limits` 接口 + `DEFAULT_LIMITS` + `README.md`/`docs/guides/development.md` 的表格 + 使用点的 `assertWithinLimit`。

## `@bdmv2web/bdmv-io`

| 能力 | 符号 | 关键行为 |
| --- | --- | --- |
| 目录发现 | `discoverBdmvInput(inputPath)` | 接受 BDMV 根或其直接父目录；父目录下大小写变体多于一个 → `BDMV_ROOT_AMBIGUOUS`；没有 → `BDMV_ROOT_NOT_FOUND`；符号链接 → `SYMLINK_REJECTED` |
| 子目录选择 | `selectBdmvChild(entries, inputPath)` | 只按名字（大小写不敏感）比较，不按排序猜 |
| 文件表 | `buildInputFileTable(root, relativePaths)` | 只接受规范相对 POSIX 路径；重复路径 → `DUPLICATE_FILE_PATH`；越界 → `PATH_ESCAPE` |
| 按表读 | `readRegisteredFile(table, relativePath, maxBytes, prefixOnly?)` | 未登记 → `FILE_NOT_REGISTERED`；`prefixOnly` 只读前 `maxBytes`（`sound.bdmv` 用） |
| 小文件读 | `resolveInputFile(root, relativePath)` | 绝对路径、`..` 逃逸、symlink 逃逸都拒绝 |
| 流式读 | `readFileChunks(path, limits, chunkSize)` | `chunkSize > maxReadWindowBytes` → `LIMIT_EXCEEDED` |
| 根隔离 | `assertDisjointRoots(input, output, cache?)` | 输入/输出/缓存两两重叠 → `PATH_OVERLAP` |
| 事务输出 | `beginOutputTransaction(target, { overwrite? })` | staging 目录 `.<name>.staging-*`；`commit()` 原子改名；`abort()` 删 staging |
| 大小检查 | `checkedFileSize(path, maxBytes)` | 超限 → `LIMIT_EXCEEDED` |
| 字节上限 | `assertByteLimit(value, maxBytes, path?)` | 纯数值比较，不读盘；`maxBytes` 非法 → `INVALID_LIMIT`，`value` 非安全非负整数 → `INVALID_LENGTH`，超限 → `LIMIT_EXCEEDED` |
| 绝对化 | `canonicalDirectory(path)` | `realpath` 语义，用于根隔离与输入发现 |
| 引用解析 | `resolveFileReference(table, relativePath)` | 虚拟路径 → 已验证文件表中的真实路径；未登记 → `FILE_NOT_REGISTERED` |

### 事务语义

- 目标已存在且未传 `overwrite` → `TARGET_EXISTS`，staging 不创建。
- `overwrite` 目标必须是目录，不能是文件或 symlink → `TARGET_NOT_DIRECTORY`。
- `commit()` 前重新 `lstat` 目标：新目标凭空出现 → `TARGET_EXISTS`；被替换（`dev`/`ino` 变化）→ `TARGET_CHANGED`。
- 覆盖时先把旧目录改名到 `.backup-<uuid>`，再改名 staging；改名失败会回滚旧目录。
- `commit()`/`abort()` 都只能调用一次，重复调用报 `TRANSACTION_CLOSED`。

### 常见故障

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `BDMV_ROOT_NOT_FOUND` | 输入既不是 `BDMV` 也不是含 `BDMV/` 的目录 | 传 BDMV 根或其直接父目录 |
| `SYMLINK_REJECTED` | 输入树或 `BDMV` 根是符号链接 | 用真实路径；工具不接受 symlink 输入 |
| `PATH_OVERLAP` | `--out` 落在输入目录内或反之 | 换输出目录；默认 `<父目录>/BDMV-menu` 合法 |
| `TARGET_EXISTS` | 输出目录已存在 | 加 `--overwrite`，或换 `--out` |
| `TRANSACTION_CLOSED` | 同一事务重复提交/中止 | 检查调用方是否在 catch 里又 abort 了一次 |

### 改动入口

- 新增输入文件类型：在 `discoverBdmvInput` 的目录遍历里已经全量登记，无需改；只需在消费方用 `readRegisteredFile` 读。
- 改事务行为：`beginOutputTransaction`，同步 `packages/bdmv-io/src/index.test.ts` 与 `openspec/specs/disc-contracts/spec.md` 的「只读输入与事务输出」场景。
