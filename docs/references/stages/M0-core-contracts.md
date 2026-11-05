# M0 — 核心契约参考

对应 change：[tasks.md](../../../openspec/changes/establish-core-contracts/tasks.md) / [design.md](../../../openspec/changes/establish-core-contracts/design.md)。

| 来源 | 任务 | 可用内容与定位 | 使用边界 |
| --- | --- | --- | --- |
| [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) | 1.2, 3.2 | 官方规范、meta-schema、core 与 validation 章节；适合 IR/manifest 版本化数据结构约束。来源 `JSON-SCHEMA-2020-12`。 | Schema 校验器不会自动实现跨字段语义、整数精度或领域不变量；`Time90k` 应按基线以 decimal string 保存、bigint 计算。 |
| [MDN BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt), [DataView](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView) | 1.3, 2.1 | BigInt 精确整型运算/JSON 边界；DataView 显式端序整数读法。 | BigInt 默认不能 JSON stringify；DataView 不定义项目 Cursor 对截断/溢出时游标事务语义。来源 `MDN-BIGINT`, `MDN-DATAVIEW`。 |
| [Node.js API](https://nodejs.org/api/) | 2.2–2.5 | 官方 `fs`, `path`, `child_process` 文档用于只读读取、realpath 与 FFmpeg spawn。 | 页面随 Node 版本更新；记录锁定 Node 版本，按 win/macOS/Linux 路径语义验证。来源 `NODE-API`。 |
| [Node.js 发布状态](https://nodejs.org/en/about/previous-releases) / [pnpm 安装](https://pnpm.io/installation) / [Vitest 配置](https://vitest.dev/config/) | 1.1, 3.3 | 官方工具链入口。选受支持 Node LTS、精确 pnpm 版本和 lockfile；Vitest 用于仓库测试配置。 | 页面滚动；不替项目锁版本。Vitest 不是协议正确性证据。来源 `NODE-RELEASES`, `PNPM-INSTALL`, `VITEST-CONFIG`。 |
| [JSON Schema license](https://github.com/json-schema-org/json-schema-spec/blob/main/LICENSE) | 1.2 | 官方规范仓库许可说明。 | 不把完整外部标准内容复制进实现文档。来源 `JSON-SCHEMA-LICENSE`。 |

参考实现可选用 libbluray 的 bitstream/file helpers 作解析器健壮性对照（`LIBBLURAY-1.5.0`，LGPL-2.1-or-later），不能把其 API schema 当作本项目 IR。另见 [来源机器清单](../sources.json)。
