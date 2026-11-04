# workspace-build-gate Specification

## Purpose

让构建、类型检查与测试三个入口各自有确定作用域，失败可归因，结果可复核。

## Requirements

### Requirement: 构建与类型检查作用域分离

系统 SHALL 让 `build` 只产出运行时代码、`typecheck` 覆盖含测试的全部源码；两者可独立失败，且任一失败不得掩盖另一方的真实结果。

#### Scenario: 测试代码类型错误

- **WHEN** 任一 `*.test.ts` 含类型错误
- **THEN** `typecheck` 失败并定位该文件，`build` 不因该错误失败

#### Scenario: 产物不含测试

- **WHEN** 从干净状态执行 `build` 并在 `dist/` 中按 `*.test.*` 查找
- **THEN** 匹配数为 0，`dist/` 中不存在 `*.test.js` 与 `*.test.d.ts`

#### Scenario: 干净构建可复现

- **WHEN** 删除全部 `dist/` 后按记录的 Node/pnpm 版本执行 `generate:contracts` 与 `build`
- **THEN** 全部包构建成功，`core` 同时产出 `index.js` 与 browser 产物

### Requirement: 测试入口作用域确定

系统 SHALL 由每个包的测试配置锁定测试文件范围，聚合执行与逐包执行必须等价；发现不到测试文件即为失败，不得视为通过。

#### Scenario: 聚合等于逐包

- **WHEN** 分别执行根聚合测试命令与逐包测试命令
- **THEN** 每个包的用例数与跳过数一致，聚合总数等于逐包之和

#### Scenario: 产物残留不影响结果

- **WHEN** `dist/` 中存在历史遗留的 `*.test.js`
- **THEN** 测试执行不加载这些产物，用例数不增加

#### Scenario: 无测试文件

- **WHEN** 某包测试配置未匹配到任何测试文件
- **THEN** 该包测试任务失败并报出包名，不输出"通过"

### Requirement: 门禁结果可复核

系统 SHALL 在仓库文档中记录逐包用例基线，任何计数变化必须显式更新基线并说明原因。

#### Scenario: 用例数变化

- **WHEN** 某包新增或删除用例导致计数与基线不同
- **THEN** 基线表被更新且差异在变更说明中出现，不作为"无影响"处理

#### Scenario: 基线可复现

- **WHEN** 审阅者按基线表逐包执行测试命令
- **THEN** 每项计数可复现，且与聚合执行结果一致
