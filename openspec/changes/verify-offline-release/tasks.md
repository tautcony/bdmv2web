# Tasks

前置依赖：establish-core-contracts、parse-bdmv-structure、extract-igs-scenes、execute-hdmv-navigation、build-offline-menu-runtime、export-playable-media。接口可提前消费；完成集成验收前必须取得上游契约及相关验收。

共同约定见 [实施基线](../IMPLEMENTATION_BASELINE.md)。每项勾选需同时提交实现、所列正反例及结果；未取得参考或环境证据不得勾选对应验收。依赖独立的 M6 原语已放在 `packages/test-runner/src`（包审计、离线 URL/data MIME 检查、完成度与 coverage 计算、VM/IG compare/report primitives）；payload 指纹沿用 M0 的 locale `en` 排序相对路径、NUL、SHA-256、LF 契约，字节长度另行校验。原语尚未接入 CLI，也未取得本 change 所列产品验收证据，因此对应任务保持未勾选。浏览器、跨阶段 M4/M5 制品和参考 golden 仍须按后续门槛完成。

## 1. 独立包检查

- [ ] 1.1 实现validate的schema/引用/manifest/大小/hash与payloadFingerprint重算；验收：无原碟/FFmpeg可验证，指纹缺失/格式错误/不匹配、启动文件`index.html`缺失或未列入manifest、字节篡改和缺必需资产均失败。
- [ ] 1.2 解析HTML/CSS/数据/JS资源入口并统一URL/realpath检查；验收：远程/协议相对/file原盘/编码逃逸/外symlink均定位，合法中文/百分号路径和说明链接不误报。
- [ ] 1.3 限制data MIME并检查嵌套依赖和bundle禁用入口；验收：HTML/SVG执行载荷与远程嵌套拒绝，已生成PNG data允许。
- [ ] 1.4 生成dependency-audit及checks[]；验收：每项有pass/fail/not-verified和具体字段/证据，不盲信旧status。

## 2. 完整度与覆盖

- [ ] 2.1 以共享决策表实现failed/partial/complete和strict退出码；验收：menu-only、混合/纯BD-J、unknown opcode、缺媒体、缺证据逐行测试。
- [ ] 2.2 实现acknowledged错误和降级记录；验收：不删除原严重性/影响，strict策略变化不提升能力状态。
- [ ] 2.3 实现入口/指令/媒体/测试的分母和未知计数；验收：零分母N/A、探索超限unknown，不能报虚假100%。

## 3. 差分与安全回归

- [ ] 3.1 定义compare输入序列/PlayerProfile/初始寄存器/seed和参考工具适配；验收：记录fixture ID或样本标签及工具版本，不生成原盘素材哈希，参考缺席not-verified。
- [ ] 3.2 实现VM语义trace首差异报告；验收：已知寄存器/栈/动作偏差可回到源指令，忽略非语义墙钟。
- [ ] 3.3 实现独立IG像素对照和视频质量分离；验收：调色板/alpha/时序偏差准确定位，视频编码噪声不混入IG判定。
- [ ] 3.4 汇总截断/超尺寸/路径/跳转环安全回归；验收：预算内终止，诊断准确且源/旧输出不变。

## 4. 浏览器与发布

- [ ] 4.1 锁定 V1 macOS Google Chrome 实际版本并执行断网 `file://`；验收：无后台/原碟，记录 macOS build、Chrome 完整版本、console/资源/有声结果，缺席不假通过。跨系统和其它浏览器不作为 V1 门槛。
- [ ] 4.2 完成A–J场景适用路径的双击/移动目录/中文空格/DPI/播放策略恢复证据；验收：每项expected/actual/result及制品hash可复查。
- [ ] 4.3 实现证据与payload/profile/mode/矩阵绑定和失效；验收：换bundle/媒体/profile不能复用旧截图过门槛。
- [ ] 4.4 生成最终compatibility/audit/manifest/发布摘要和README；验收：只有全部门槛满足可complete，失败/未验证列具体缺口，完整包无开发/参考工具依赖。
