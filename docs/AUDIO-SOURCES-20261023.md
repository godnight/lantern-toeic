# 音频来源说明（2026-10-23）

本说明记录 2026-10-23 16:36（北京时间）核验的源码范围。早期文档中“原生端打包离线音频、网页使用系统 TTS”的描述属于历史版本；当前源码还包含 `public/audio/natural/` 下的预生成 MP3，供网页与 App 音频链使用。源码清单与实际部署、设备验收状态分别记录。

自然音频由本地模型合成，来源记录中的模型与音色如下：

| 模型 | 固定版本 | 本次记录中的音色 |
| --- | --- | --- |
| [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M/tree/f3ff3571791e39611d31c381e3a41a3af07b4987)，`kokoro-v1_0.pth` | `f3ff3571791e39611d31c381e3a41a3af07b4987` | `am_michael`、`af_heart`、`bm_george`、`bf_emma` |
| [Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice/tree/0c0e3051f131929182e2c023b9537f8b1c68adfe) | `0c0e3051f131929182e2c023b9537f8b1c68adfe` | `Aiden`、`Ryan`、`Serena` |

从 `content/natural-audio-catalog-v1.json` 可定位各 pack 的 `manifest.json`、`admission.json` 及其文件哈希。`public/audio/natural/<packId>/manifest.json` 的 clip 记录提供 MP3 的 `sha256`、`bytes`、文本哈希和来源信息；`provenance.segments` 保留分段模型、音色、生成或拼接记录。多音色拼接应按分段追溯。18 条历史分段记录保留了模型版本与音色 profile，但缺少完整 `modelIdentity`／`adapterSha256`；部分上游记录仍引用本地路径，不能仅凭该路径视为仓库内可取得的完整证据。pack 中历史候选状态字段保留其当时含义。

本次范围共 18 个现行 pack、8,830 个 MP3；另保留四个历史目录中的 3,388 个 MP3，其实际哈希和大小均与现行生成条目一致。这些历史重复文件用于保全源码输入，不增加产品有效条数。`public/audio/natural/` 合计 12,218 个 MP3，另有 36 个 JSON；12,254 是文件总数。后续新增 174 条交付及 r3 恢复批次尚未计入本说明，应按正式交付清单追加来源和哈希。

`mobile/offline-audio/` 另有 1,015 个历史 MP3，由 Windows System.Speech／Microsoft Zira Desktop（en-US）本地合成；其生成方式、原文与媒体哈希继续以该目录原有 `README.md` 和 `manifest.json` 为准。保留其历史说明与语音供应方权利声明；既有审计未找到该批次单独的公开再分发依据。本次核验范围未发现私人用户录音来源证据，也未读取私人录音。

朗读文本与音频生成来源分别记录：项目原创内容沿用 `LICENSE-CONTENT.md`；词典及词表沿用 `public/dictionaries/NOTICE.txt`、`THIRD-PARTY-CONTENT-NOTICE.md` 和 `docs/CONTENT_SOURCES.md` 中的归属说明。词典文字来源不表示上游提供了录音；本批生成音频也不应标为 ETS／VOA 官方录音。两个模型卡均声明 Apache-2.0；这项声明描述模型许可，生成音频与朗读文本仍需保留各自的来源和权利说明。既有 MIT、CC BY 及第三方 NOTICE 的范围保持原样。本说明补充来源事实，不作音质验收或权利保证。


后续准入补充（同日）：实际准入 pack 为 v040-natural-1d86187246c3，替代未准入候选 v040-natural-65600beab942；本批仍为 57 个完整词对、114 个 MP3，不含未配对的 considerate。114 个 MP3 字节与原 r3 已验记录相同，原始分段来源保留。Kokoro-82M 固定版本 f3ff3571791e39611d31c381e3a41a3af07b4987：am_michael 56 段、af_heart 25 段；Qwen3-TTS-12Hz-1.7B-CustomVoice 固定版本 0c0e3051f131929182e2c023b9537f8b1c68adfe：Ryan 32 段、Aiden 1 段。全部 114 段保留 adapter 身份。以新 pack 的 manifest/admission JSON 和实际准入回读 pin 追溯；新增 174 条听力交付仍单独追加。

本项准入后，源码中的自然音频共有19个现行分包，另保留上述四个历史目录；实点12,332个MP3和38个JSON。57是媒体已准入的来源词对数；实际词库新增53个可见正文，另4项保留原作者词卡正文和既有音频分派，不以内部来源计数冒充新增可见词卡。人工听音和最终设备验收分别记录。

4 张旧作者词卡的有限词头桥接补充（同日）：实际准入 pack `v040-natural-e795ecf83ba4`，仅复用 coach、heater、sauna、tray 四条既有孤立词头 MP3，共 24,864 字节，没有重新生成音频或补造例句。旧词卡 ID、原释义、空例句及老师来源词对保持；coach 的长途客车与教练义项不作整体等义合并。新 manifest/admission 保留 donor 原来源、精确 MP3/master/typed proof 和独立有限桥审查绑定，tray 的 Qwen Ryan 来源继续保留。实际源码 resolver/prepare 已逐卡命中这四个词头；这属于字节和分派验证，不代表本轮新增人工听音或设备播放验收。

此项后实点为 20 个现行分包、12,336 个 MP3、40 个 JSON（包含四个历史重复目录）。四条桥接文件不增加可见词卡数量；当前词库仍为 4,256 个可见正文。新增 174 条听力仍等待最终独立交付与准入后追加。

正式新增听力174条资源准入（同日）：三批 pack 为 `v040-natural-a72fe0737dd0`, `v040-natural-648f1817773e`, `v040-natural-aaae71ed7e36`，各58条，合计174个唯一MP3、16,453,032字节，覆盖新增150题、102组材料及457个源片段。保留本地Kokoro固定版本与原始音色/分段来源，未将历史ASR或生成身份冒充本轮新录制。完整媒体独立技术复核入口为 full174-delivery-r1，source-r3文字和42张原图的精确关系另行绑定；humanAccepted/accentValidated均仍为false。本项资源已按181文件清单事务读回，用户题库激活、最终构建和设备播放各按对应后续证据记录。

此项后源码实点为23个现行分包，保留四个历史重复目录；自然音频共12,510个MP3、46个JSON。
