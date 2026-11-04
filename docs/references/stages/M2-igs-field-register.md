# IGS 字段与版本依据

本登记对应 OpenSpec 任务 2.1。参考源码固定为 libbluray 1.5.0 peeled commit `d75c88e54c893e5cbf4c61d356477655eb435769`；入口见 [`ig_decode.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/ig_decode.c) 与 [`graphics_processor.c`](https://code.videolan.org/videolan/libbluray/-/blob/d75c88e54c893e5cbf4c61d356477655eb435769/src/libbluray/decoders/graphics_processor.c)。该实现用于字段对照，不作为规范符合性声明。另用固定版 igstools `34a133150ca8b52237284da4d47d93911bcd4954` 与 fixture 字节交叉检查；其代码来源与 libav 有关，不视作完全独立的规范 oracle。

| 结构 | 登记字段 | 项目表示 | 对照依据与测试样本 |
| --- | --- | --- | --- |
| ICS | 视频宽高、frame-rate code、composition number/state、sequence flags、数据长度、stream/UI model、可选超时、user timeout、page 数 | 解码并保留在 `IgsScene`；完整 sequence 才进入解析 | libbluray `ig_decode_interactive()` / `_decode_interactive_composition()`；外部 ICS 字节 `test-data/fixtures/igs-parser/ics-menu-disc14.bin`，Vitest `real IGS composition sample` |
| Page | page ID/version、UO mask、进入/退出效果原始字节、动画帧率码、默认选择/激活按钮、palette ID、BOG 列表 | 固定字段解码；效果保留原始字节并记录数量，效果语义不解释 | libbluray `_decode_page()`；同一真实 ICS 样本及合成效果测试 |
| BOG | 默认有效按钮 ID、成员按钮数量与 ID | 解码为 page 内 BOG 项；按 page-local 按钮作用域校验引用 | libbluray `_decode_bog()`；`packages/igs/test/extraction.test.ts` 多页、重复按钮 ID 与无效引用案例 |
| Button | ID、numeric-select value、auto-action、x/y、上下左右引用、normal/selected/activated object 范围、repeat 标志、selected/activated sound ID、命令数量与每条 12 字节命令 | 解码结构字段；命令原始字节和 ICS 内偏移保留；未在此层解释 VM 命令 | libbluray `_decode_button()`；真实 ICS 样本与 `real-igs.test.ts`；导航语义由 M3 覆盖 |
| PDS | palette ID/version；每项 entry ID、Y、Cr、Cb、alpha | 按 `ID/version` 保留；YCbCrA 到 PNG 的转换单独在 2.4 核验 | libbluray `graphics_processor.c::_decode_pds()`、`pg_decode.c` palette decoder；Battle Royale UHD Clip `00005` packet fixture 中 palette 0/version 0 entry 0 为 `(16,128,128,153)` |
| ODS | object ID/version、first/last fragment flags、声明数据长度、宽高、RLE 像素索引 | 按 `ID/version` 组片并解码尺寸与索引；片段缺失/损坏时不标完整 | libbluray `graphics_processor.c::_decode_ods()` 与 `pg_decode.c` object decoder；Battle Royale UHD Clip `00005` packet fixture 的 object 27/version 0 为 35×9，前 10 个索引为 2 |
| Display Set | PID、PTS/time domain、ICS/PDS/ODS 归属、END 边界 | 以完整 ICS sequence 与 END 形成 scene；资源版本按 PID/time domain 隔离 | libbluray `graphics_processor.c` 中 segment type `0x14` PDS、`0x15` ODS、`0x18` IG composition、`0x80` END；项目真实 packet fixture 测试覆盖闭合与来源映射 |

## 字段范围

上述字段均有固定源码入口和本地字节样本/测试。当前实现对效果窗口内容仅做边界遍历并保留原始字节；保留的 reserved 位、显示效果行为、动画逐帧时序以及尚无独立样本的值语义不视为已验证。样本观察值只用于字段映射断言，不用于推导未观测字段的规范含义。

版本键分别为 palette ID/version、object ID/version；它们在 IGS stream 的 PID 和 time domain 内解析。同一 ODS 在不同页面 palette 下的产物映射另由 Battle Royale UHD Clip `00005` 的多 palette 断言覆盖，详见 [M2 IGS 阶段记录](M2-igs-scenes.md)。
