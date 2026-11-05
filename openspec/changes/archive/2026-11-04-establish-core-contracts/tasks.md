# Tasks

前置依赖：无。接口可提前消费；完成集成验收前必须取得上游契约及相关验收。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。文中命令/文件是目标交付物，当前未实现。

## 1. 工作区与契约

- [x] 1.1 建立 pnpm workspace、CLI 骨架、Node/browser 分离导出及固定工具链/lockfile；验收：干净安装后 build/typecheck/test 可复现，core 浏览器产物无 Node 内建依赖。
- [x] 1.2 定义 DiscIR/NavigationDescriptor/SourceRef/AssetReference/Diagnostic 单一来源 schema 与 TS 类型；验收：最小HDMV/混合BD-J正例通过，混合类型/重复ID/悬空引用/未知版本负例可定位。
- [x] 1.3 实现时间与偏移无损序列化及45k转换；验收：9007199254740993反复JSON往返相等，负数/指数/浮点/前导零拒绝。
- [x] 1.4 定义 Action/Event 信封、PlayerProfile/Limits 和阶段校验接口；验收：相关ID/代次可序列化，下游模拟桥消费同一契约。

## 2. 安全I/O与基础设施

- [x] 2.1 实现 BinaryCursor 全部读法及 subview 推进语义；验收：大小端、嵌套源偏移、截断、负数、非整数、加乘溢出，失败游标不变。
- [x] 2.2 实现流式读取与有限内存预算配置；验收：超过窗口/对象/分片限制在分配前拒绝，长输入无需全量驻内存；提交默认值表。
- [x] 2.3 实现 realpath/文件表/输入输出缓存隔离；验收：..、外部symlink、输出包含输入或在输入内均拒绝，中文/空格路径合法。
- [x] 2.4 实现 staging/commit/abort 和目标存在拒绝；验收：中断/校验失败不覆盖旧包，抽样源文件字节不变。
- [x] 2.5 实现生成资产 ID 与来源映射规则；验收：资产 ID 与 fixture 中的生成资源对应，外部 BDMV 输入不自动复制到输出包。

## 3. 交接与文档

- [x] 3.1 统一CLI退出码、strict缺省和stdout/stderr；验收：未实现命令明确失败，不生成假成功文件。
- [x] 3.2 建立二进制构建器、golden manifest及许可/来源登记；验收：下游可加载最小IR、混合入口和损坏fixture。
- [x] 3.3 提交 docs/development.md、protocol-support模板及浏览器矩阵模板；验收：记录精确工具版本、PlayerProfile字段和测试命令，缺环境明确未验证。
