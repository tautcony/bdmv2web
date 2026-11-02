# 开发参考索引

核验日期：2026-11-02。此索引为 M0–M6 开发提供可访问的一手规范入口、官方工具文档和可复核的参考实现。它不替代 Blu-ray 规范，也不表示本项目已实现或验证任何功能。阶段任务对应关系见下方各阶段页面；可机器读取的来源记录在 [sources.json](sources.json)。

## 使用顺序

1. 先按 [实施依赖](../../openspec/changes/DEPENDENCIES.md) 进入对应阶段，再打开该阶段索引；每行列出对应的 `tasks.md` 编号，并可直达 change 的 `tasks.md` / `design.md`。
2. 格式/指令只有在实现者记录规范/参考位置、固定 revision、fixture 和单独建立的预期后，才可在 M0 tasks 3.3 规划的 `docs/protocol-support.md` 中标记 supported。参考实现不等同规范，示例盘也不构成覆盖证明。
3. 固定环境时记录实际 Node、pnpm、FFmpeg、ffprobe、浏览器完整版本；本索引中未锁定为项目依赖的工具不能凭文档版本推定验收已通过。
4. 参考素材只登记来源、hash 和许可，不把商业盘内容复制进仓库。参考工具不进入离线发布包。

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

- Blu-ray BDMV/HDMV/IGS/PGS 规范由 Blu-ray Disc Association (BDA) 管理。BDA 的[格式规范 FAQ](https://blu-raydisc.info/format-spec/faq-info.php)说明书籍通过授权协议提供，且网站不公开协议文本/协议正文；应走[官方授权与申请入口](https://blu-raydisc.info/)，联系 Licensing Office（agent@blu-raydisc.info）。不要从非官方镜像下载或提交规范全文。FAQ 提到技术白皮书目录，但旧目录网址现返回 404；本轮没有核实到具体可下载的官方技术白皮书 PDF。已确认的官方公开 [Format Book Structure / All Books (2017)](https://blu-raydisc.info/docs/Spec_Info/AllBooksNovember2017.pdf) 只是格式书版本图，不含规范正文。
- MPEG-2 Systems 的一般 TS/PES 由 ITU-T H.222.0 / ISO/IEC 13818-1 定义。H.222.0 v10 (04/2025) 页面可访问，但匿名下载测试被重定向到 TIES 登录页；H.222.0 (10/2014) PDF 可匿名获取，是已被替代的历史版本。ITU 标准不规定 Blu-ray 私有化的 192-byte M2TS 外层包、IG/PG PID 选取和 BDMV 文件结构，这些仍需 BDA 规范/实现对照。
- 仓库引用的开源代码仅作交叉核对。遵守其许可证；特别注意不同仓库/文件版本、算法来源、静态链接和分发条件。不同语言/仓库不自动意味着来源独立；SAPikachu/igstools README 指明 parser/decoder 来自 libav patches，其他实现也应检查代码和算法来源后，才可作为相互独立的证据。BDedit 是闭源工具，不是规范或可复用源码。

## 可复现获取

ITU 当前有效的 H.222.0 v10 (04/2025) [官方记录](https://www.itu.int/rec/T-REC-H.222.0-202504-I) 显示 PDF 条目，但本轮匿名 `curl` 获得的是要求 TIES 登录的 HTML 页面，没有取得规范 PDF。可登录 TIES 后通过该记录的 PDF 链接获取，保存本地实际 SHA-256 和访问日期。匿名可复现的历史版获取命令如下；本轮下载得 PDF 3,127,517 bytes，SHA-256 `6167a8b567ba3094854a7d3e4d8d64657bee19bb6622f3283e956623971e108a`：

```sh
curl --fail --location --retry 3 \
  'https://www.itu.int/rec/dologin_pub.asp?id=T-REC-H.222.0-201410-S%21%21PDF-E&lang=e&type=items' \
  --output H.222.0-2014.pdf
file H.222.0-2014.pdf
shasum -a 256 H.222.0-2014.pdf
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

为便于按固定 revision 对照，本地 `.reference-cache/` 只存少量开源文件和对应许可证文本，不含商业素材或 Blu-ray/ITU 标准 PDF；根 `.gitignore` 将它排除在版本控制外。所选文件、原始 URL、revision、byteLength 和 SHA-256 在 [cache-manifest.json](cache-manifest.json) 中。重建/校验缓存：

```sh
python3 scripts/fetch-reference-cache.py
```

缓存来源分别为 `.reference-cache/libbluray-1.5.0/`、`.reference-cache/igstools-2019/` 和 `.reference-cache/libhdmv-2026-03/`。该缓存是第三方代码副本，继续分发前必须逐项审查许可；source urls 指向原仓库固定 commit。H.222.0 的本地 PDF 不保留，匿名下载和核验摘要只作为获取记录。

## 本轮明确未验证

- 未取得受限 BDA Blu-ray 规范书；libbluray、libhdmv、igstools、BDedit 及公共白皮书均不能代替它。
- 未解密/解析商业碟、未建立项目独立 golden、未验证像素/导航语义或真实浏览器矩阵；任何源中的“支持”声明仅属该源自身范围。
- `file://` 跨浏览器行为和媒体播放策略需按项目定义的实际 OS/浏览器矩阵执行；WHATWG/MDN 文档不能代替运行证据。
- FFmpeg 文档是滚动文档。M5 应选定可再分发构建并记录 binary hash、`ffmpeg -version`、`ffprobe -version` 和 configure flags；按任务要求在转换输入数组中调用，不能用此索引暗中锁定转码工具版本。
