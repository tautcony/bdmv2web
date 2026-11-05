# 开发参考索引

核验日期：2026-11-04。此索引为 M0–M6 开发提供固定 revision 的主要实现参考、补充背景来源、测试证据和可访问的规范入口。阶段任务对应关系见下方各阶段页面；可机器读取的来源记录在 [sources.json](sources.json)。

## 证据层级

1. **主行为依据：固定实现。** 对 BDMV/HDMV 优先以 VideoLAN libbluray 1.5.0（peeled commit `d75c88e54c893e5cbf4c61d356477655eb435769`，LGPL-2.1）作为当前行为参考。记录准确文件/位置与许可。实现冲突时记录双方 revision、差异和采用理由，不盲从任一来源。
2. **辅助背景：公开白皮书。** `.reference-cache/specs/SOURCE.md` 列出的历史 BDA 白皮书仅在其实际叙述范围内提供架构或格式背景；引用时记录标题、版本和印刷页码。白皮书不是规范正文，不定义或核验未覆盖的字段/指令，也不阻碍实现。
3. **项目测试与 golden。** 合成 fixture 只证明本项目实现的已声明行为。独立 golden 必须记录来源、版本/案例、生成或比较方法及边界；同源 fork 或移植代码不自动独立。
4. **结论边界。** `unverified` 表示实现、测试、交叉核对或路径覆盖仍有具体缺口；不得单因未取得授权 BDA 书籍而阻塞实现。

## 使用顺序

1. 先按 [实施依赖](../../openspec/changes/DEPENDENCIES.md) 进入对应阶段，再打开该阶段索引；每行列出对应的 `tasks.md` 编号，并可直达 change 的 `tasks.md` / `design.md`。
2. 格式/指令状态需记录固定实现来源/位置、许可、fixture、golden provenance 和验证范围。参考实现不等同规范；示例盘不构成覆盖证明。
3. 固定环境时记录实际 Node、pnpm、FFmpeg、ffprobe、浏览器完整版本；本索引中未锁定为项目依赖的工具不能凭文档版本推定验收已通过。
4. 参考素材只登记上游仓库地址和固定版本，不把商业盘内容复制进仓库。参考工具不进入离线发布包。

## 阶段入口

| 阶段 | 索引 | 主要范围 |
| --- | --- | --- |
| M0 | [核心契约](stages/M0-core-contracts.md) | Schema、工具链、精确时间、安全 IO、golden 构建与许可登记 |
| M1 | [BDMV 结构解析](stages/M1-bdmv-structure.md) | index/MOBJ/MPLS/CLPI/sound、引用图、BACKUP |
| M2 | [传输流与 IGS](stages/M2-igs-scenes.md) | M2TS/TS/PES、PID、IGS Display Set、场景和像素 |
| M3 | [HDMV 导航 VM](stages/M3-hdmv-navigation.md) | 12-byte 命令、PSR/GPR、控制流、trace |
| M4 | [离线菜单运行时](stages/M4-offline-menu.md) | `file://` 资源、安全打包、音效、输入与 autoplay |
| M5 | [媒体导出与播放](stages/M5-media-playback.md) | FFmpeg/ffprobe、时间线、轨道、PGS 和媒体事件 |
| M6 | [离线发布验证](stages/M6-release-verification.md) | 包审计、浏览器证据、独立对照与完整度判定 |

## 标准获取、版权与边界

- Blu-ray BDMV/HDMV/IGS/PGS 规格书由 Blu-ray Disc Association (BDA) 管理。BDA 的[格式规范 FAQ](https://blu-raydisc.info/format-spec/faq-info.php)说明规格书通过授权协议提供且不公开规格书正文；书目和访问状态见 [sources.json](sources.json)。BDA 历史公开白皮书已由 `.reference-cache/specs/SOURCE.md` 盘点，仅作实际覆盖范围内的背景，不作为规范性要求。已确认的官方公开 [Format Book Structure / All Books (2017)](https://blu-raydisc.info/docs/Spec_Info/AllBooksNovember2017.pdf) 是书目/版本图。
- MPEG-2 Systems 的一般 TS/PES 由 ITU-T H.222.0 / ISO/IEC 13818-1 定义。H.222.0 v10 (04/2025) 页面可访问，但匿名下载测试被重定向到 TIES 登录页；H.222.0 (10/2014) PDF 可匿名获取，是已被替代的历史版本。ITU 标准不规定 Blu-ray 私有化的 192-byte M2TS 外层包、IG/PG PID 选取和 BDMV 文件结构；这些行为以固定实现和明确标注的测试证据为主，白皮书只补充其覆盖背景。
- 仓库引用的开源代码仅作交叉核对。遵守其许可证；特别注意不同仓库/文件版本、算法来源、静态链接和分发条件。不同语言/仓库不自动意味着来源独立；SAPikachu/igstools README 指明 parser/decoder 来自 libav patches，其他实现也应检查代码和算法来源后，才可作为相互独立的证据。BDedit 是闭源工具，不是规范或可复用源码。

## 可复现获取

ITU 当前有效的 H.222.0 v10 (04/2025) [官方记录](https://www.itu.int/rec/T-REC-H.222.0-202504-I) 显示 PDF 条目，但本轮匿名 `curl` 获得的是要求 TIES 登录的 HTML 页面，没有取得规范 PDF。可登录 TIES 后通过该记录的 PDF 链接获取。匿名可复现的历史版获取命令如下；本轮下载得 PDF 3,127,517 bytes：

```sh
curl --fail --location --retry 3 \
  'https://www.itu.int/rec/dologin_pub.asp?id=T-REC-H.222.0-201410-S%21%21PDF-E&lang=e&type=items' \
  --output H.222.0-2014.pdf
file H.222.0-2014.pdf
```

官方入口：[ITU v10 记录](https://www.itu.int/rec/T-REC-H.222.0-202504-I)；[2014 历史版记录](https://www.itu.int/rec/dologin_pub.asp?id=T-REC-H.222.0-201410-S%21%21PDF-E&lang=e&type=items)。本轮目录确认 2014 文本 TS packet/PES 在 clause 2.4.3.2–2.4.3.7，PSI 在 2.4.4；clause 2.6 是 descriptors。v10 的具体 clause/文本尚未匿名下载核对，不能将旧版定位假装成 v10 的独立确认。libbluray 以 VideoLAN 上游 tag `1.5.0` 锁定源码（tag 对象 `d468a3ac8bf4d9c04739962c44d365debbea54a1`，解引用后的 commit 为 `d75c88e54c893e5cbf4c61d356477655eb435769`）：

```sh
git clone https://code.videolan.org/videolan/libbluray.git
cd libbluray
git checkout --detach d75c88e54c893e5cbf4c61d356477655eb435769
git rev-parse HEAD
```

SAPikachu/igstools 固定为已核验的 `34a133150ca8b52237284da4d47d93911bcd4954`；liminal-hq/libhdmv 固定为 `ec0e5b27d2852ca6b008719f66aa3324c0b43f28`。对应文件链接与许可见 [来源清单](sources.json)。

## 本地参考源码摘录

为便于按固定 revision 对照，本地 `.reference-cache/repositories/` 保存上游仓库的完整 checkout，不含商业素材或 Blu-ray/ITU 标准 PDF；根 `.gitignore` 将缓存排除在版本控制外。来源清单只记录仓库地址、固定 revision 和许可证信息，见 [cache-manifest.json](cache-manifest.json)。下载并检出固定版本：

```sh
python3 scripts/fetch-reference-cache.py
```

缓存来源包括 libbluray、igstools、libhdmv 和 bdmvkit 四个上游仓库。bdmvkit 固定在 commit `57890760c60b3c31dacc9db1112467d4510925aa`，源码与 `COPYING` / `COPYING.LESSER` 以 LGPL-3.0-or-later 授权，仅作为生成互操作测试盘的参考工具，不进入产品运行时。继续分发缓存前必须逐项审查许可证。H.222.0 的本地 PDF 不保留。

## 当前证据边界

- 当前没有受限 BDA Blu-ray 规范书。该访问限制本身不阻止按固定实现开发。libbluray/libhdmv/igstools 是实现参考；公开白皮书只作补充背景。
- 未解密/解析商业碟、未建立项目独立 golden、未验证像素/导航语义或 V1 Chrome 场景；任何源中的“支持”声明仅属该源自身范围。
- V1 的 `file://` 与媒体播放策略使用 Google Chrome 实测，验收不限定操作系统，也不要求跨浏览器矩阵。WHATWG/MDN 文档不能代替运行证据。
- FFmpeg 文档是滚动文档。M5 应选定可再分发构建并记录 `ffmpeg -version`、`ffprobe -version` 和 configure flags；按任务要求在转换输入数组中调用，不能用此索引暗中锁定转码工具版本。
