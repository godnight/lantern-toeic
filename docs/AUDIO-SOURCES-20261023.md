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
