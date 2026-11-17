# 第二阶段：免费／本地音频可行性与小样方案

版本：AUDIO-P2-v1.0；核查日期：2026-10-14 UTC。责任：微光-小开的音频事实协作；技术取舍与音轨索引由微光-小架定案，dot 统筹，小测负责试听与验收。

状态：**方案已交付；未安装依赖、未下载模型、未生成或试听音频，未替换现有音轨。** 本文件是第二阶段音频范围交付，不表示新自然音源已实现或通过。

## 1. 本轮范围与接续依据

按最新委派，第二阶段整体实现已批准，但音频范围限定为“先免费／本地可行性及小样方案”。本轮只写本文件，不改 App、Demo、学习数据、音频清单、依赖锁文件或其他文档；不调用付费服务、不创建密钥、不接入 App 付费解锁、不全量生成、不操作手机、不 push/merge/deploy。

已读取新 checkout 的 [AGENTS](../../AGENTS.md)、README、PROJECT_STATUS、TEAM、CODEX_HANDOFF 的接续规则。上游本机上下文为 `D:\zzl\托业学习\项目组\engineering\PHASE2-CONTRACT-QUESTIONS-20261014.md` 和 `D:\zzl\托业学习\项目组\architecture\PHASE2-MINIMAL-CONTRACT-20261014.md`（不随本仓库自动发布）。旧 README/交接中的 V1 暂停状态保留为历史；本次以新委派及最小合同的 A005 音频边界为准。AGENTS 中安装/构建的通用初始化步骤不在本次只读与单文档范围执行。

“免费／本地”指可在开发电脑本地生成的候选，不产生云端按字符 API 账单；仍有安装、下载、算力、电力、校对和许可核对成本。本轮不使用托管推理站、云端免费试用额度或付费候选作为实施前提。

## 2. 当前可用事实与本机检查

| 项目 | 本轮观察 | 能下的结论与限制 |
| --- | --- | --- |
| 已有 SAPI 路线 | [生成脚本](../../mobile/scripts/generate-audio.ps1) 使用 System.Speech / Windows SAPI，Zira、Rate=0、Volume=100；[现有清单](../../mobile/offline-audio/manifest.json) 声明不使用网络服务 | 已有项目生成链路和成品；本轮没有执行脚本、重新加载语音引擎或听音，不能把历史可用写成本轮重新合成通过 |
| Windows 英语声音 | 只读注册表的两组 SAPI voice tokens 均见 Microsoft Zira Desktop（en-US / 409）；另见中文 Huihui | 确认 Zira 注册存在；没有发现本轮所查 token 路径中的第二款英语声音。不能将调 pitch/rate 称为不同真人或不同口音 |
| 现有包内音频 | 清单为 1,015 段，声明合计 18,749,095 字节、2,245.64 秒；编码 MP3、mono、22,050 Hz、64 kbps | 这些是清单汇总，含词音等，不是 1,015 段会话；没有逐文件重哈希、解码或试听。当前约 18.75 MB、37 分 25.64 秒不能推算新增脚本总量 |
| 现有播放边界 | [lesson-audio](../../lib/lesson-audio.ts) 只由 native 入口登记，按完整文本找一个 MP3；Web 保留系统 TTS | 不改此映射或播放器。本轮没有为 Web 接入新本地模型；现有回放不依赖 Python 模型在 HAP 内运行 |
| 受检 Python | `C:\Program Files\Python311\python.exe`，3.11.9、64 bit | 仅检查这一解释器，不代表所有虚拟环境 |
| Python 包 | 用 `python -B` 和 `importlib.util.find_spec` 检查：kokoro、misaki、torch、onnxruntime、piper、soundfile、transformers、huggingface_hub、numpy 均未检出 | **受检环境未安装／不可发现**，不是已具备开源语音生成环境。未 import 这些包、未启动模型 |
| 模型文件 | 本轮未下载任何模型；默认 HF 缓存 `models--hexgrad--Kokoro-82M` 和 checkout 的 `models` 目录不存在 | **未下载（本轮）／指定常见位置未发现**。未遍历全盘，不能断言机器其他位置完全无模型；Piper 任意自定义目录未核实 |
| 命令与硬件 | 当前 PATH 未发现 espeak-ng/piper/ffmpeg/ffprobe 命令；未测 CPU 性能、RAM 峰值、GPU/驱动、音频设备 | 不代表机器完全没有这些工具。后续须显式指定已验证工具路径；不在本轮安装或据经验填运行速度/最低内存 |

SAPI 的本地技术可用性不是对微软声音输出全部再分发用途的许可结论。本轮只保留已有路线，不新增获取声音、不扩大授权陈述。浏览器系统声音也随设备而变，不能把“系统 TTS”标作真人、新自然音源或统一考试音色。

## 3. 免费本地候选：Kokoro-82M

| 核查面 | 官方证据与工程含义 |
| --- | --- |
| 模型与代码许可 | 发布者 [Kokoro-82M model card](https://huggingface.co/hexgrad/Kokoro-82M) 明确标 Apache-2.0 并描述 Apache 许可权重；官方 [推理库 LICENSE](https://github.com/hexgrad/kokoro/blob/main/LICENSE) 也是 Apache-2.0。两者分别核对，未以第三方封装的许可替代原模型许可 |
| 运行依赖 | 官方 [pyproject](https://github.com/hexgrad/kokoro/blob/main/pyproject.toml) 当前为库 0.9.4、Python >=3.10 且 <3.14，依赖 torch、misaki[en]、transformers、numpy、huggingface_hub 等；写 WAV 的示例还用 soundfile。Windows espeak-ng 安装及英语未知词 fallback 见 [官方 README](https://github.com/hexgrad/kokoro)。本机 Python 版本在该范围，但包及外部工具不齐 |
| CPU／GPU与下载 | 官方 [pipeline 源码](https://github.com/hexgrad/kokoro/blob/main/kokoro/pipeline.py) 有 CPU 路径，CUDA 可选；没有据此承诺本机实时速度或最低 RAM。初始化模型及按 voice 名加载可触发 Hugging Face 下载，不能在本轮以“只试初始化”绕过下载限制；后续先固定本地文件与版本 |
| 口音与角色 | [官方 VOICES](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) 分美式、英式，有男女预置声；可列 `af_heart` / `am_michael`（美式）、`bf_emma` / `bm_george`（英式）为待试听候选。声名或作者评分不是项目验收；该表未提供明确澳洲/加拿大英语候选，不能许诺四口音覆盖 |
| 对话限制 | 此路线按回合选择固定 voice，再在开发侧编排；没有本轮证据证明原生整段多角色对话连贯性已满足。不能把平均两个 voice 的混声当两个角色。官方声音说明提醒极短台词可能较弱、很长台词可能赶读；Part2短问答与Part3轮换须重点听 |
| 文件与包体 | 官方 [文件目录](https://huggingface.co/hexgrad/Kokoro-82M/tree/main) 当前列模型权重约327 MB；这是开发侧模型文件，不是成品音频大小，也不是 HAP 预算。官方示例输出24 kHz WAV。权重/voices/运行时均不放入本期 HAP |

后续若选择该候选，固定发布版本/commit、模型及 voice 文件 SHA-256、原 LICENSE/NOTICE 和来源记录；脚本使用权单独核对。Apache-2.0 不是对任意题文、声音身份或输出独创性的担保。发行前核实际分发内容的许可义务，不将项目全部音频统一标成代码 MIT；本轮尚未下载核对实际分发文件。

## 4. 免费本地候选：Piper（运行时与每个声音分开）

当前维护源采用 [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl)，不沿旧项目名称推定 MIT。[setup.py](https://github.com/OHF-Voice/piper1-gpl/blob/main/setup.py) 声明 GPL-3.0-or-later、Python >=3.9，基础依赖 onnxruntime >=1,<2、pathvalidate >=3,<4；内嵌 espeak-ng 做音素化。[voice.py](https://github.com/OHF-Voice/piper1-gpl/blob/main/src/piper/voice.py) 默认 CPUExecutionProvider，CUDA 可选。本机未装运行时，吞吐/内存未实测；“本地/快”不等于本机已经可运行。

[官方 Voices 说明](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md) 要求分别读取每款 MODEL_CARD，部分声音有受限许可；生成需要配套 `.onnx` 和 `.onnx.json`。**运行时 GPL、声音仓库顶层 MIT 标签、某个数据集许可，三者不能相互替代。** 本期不把 Piper 引擎或权重分发到 HAP；若将来分发运行时，须单独落实相应 GPL 义务，不能因只讨论本地生成就宣称无许可条件。

| 核查声音 | 已读卡片/配置及许可线索 | 本方案处置 |
| --- | --- | --- |
| `en_US-ljspeech-medium` | [MODEL_CARD](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/MODEL_CARD) 在 Dataset 项标 public domain；[配置](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json) 为1 speaker、22,050 Hz。[数据发布者](https://keithito.com/LJ-Speech-Dataset/) 明确美国公共领域，其他地区未给同等确定结论 | 可优先进入后续许可复核的候选；本轮未取得独立完整的权重/输出使用承诺，不能写成全球权利已清；单声不能独自完成角色区分 |
| `en_US-lessac-medium` | [MODEL_CARD](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/lessac/medium/MODEL_CARD) 链接 [Blizzard 2013 Research Licence](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html)，其许可限定研究并排除商业用途；[配置](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json) 为1 speaker、22,050 Hz | 不列为已获本项目打包发行许可的声音；数据许可限制不能直接外推全部合成输出结论，实际模型/输出范围未明确前不推进 |
| `en_GB-alan-medium` | [MODEL_CARD](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/alan/medium/MODEL_CARD) 指向 Mycroft apope_low 且由 Lessac medium 微调；上游 [LICENSE](https://github.com/MycroftAI/mimic3-voices/blob/master/voices/en_UK/apope_low/LICENSE) 为 All Rights Reserved；[配置](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json) 为1 speaker、22,050 Hz | 不列为已清权发行候选。其上游 README 与 Piper locale 还有口音描述差异，不能仅凭 en_GB 认定实际英式口音，更不能以其补齐正式对话 |

官方 Voices 说明目前给英语 en_GB/en_US，未提供明确 en_AU/en_CA 的候选证据；这不是对全部模型的穷尽证明。多回合需固定不同声音逐段编排，拼接韵律未验；在第二款角色声音的许可和实际声音未确认前，不称 Piper 已有可用的双人/三人组合。

## 5. 本期建议及停止边界

1. **保留已用 SAPI/Zira 与包内成品作为现状对照**，不全量重生、不承诺它满足自然真人对话。系统声音与包内音源标签保持真实，不新增付费锁、订阅入口或“解锁自然音源”文案。
2. **Kokoro 是后续本地小样的优先可行性候选**，理由为已核的模型 Apache-2.0、CPU 路径及美/英多预置 voice；这只是下一步顺序建议，不是已选定产品音色或通过自然度。当前环境需要另行明确安装/模型获取任务，不能现在执行。
3. **Piper 保留备选核查**，先处理具体 voice 权利；当前已查 Lessac/Alan 不作为已清权交付组合。LJSpeech 单声候选不能代替多角色组合。不要为凑四口音从第三方集合盲取权重。
4. **澳/加口音保留缺口**。本期能完成免费本地方案交付，但不能据此宣称所有考试目标已满足；后续若免费本地候选无法覆盖，由 dot 与小架确认缩小范围或另定来源，不自动回到付费 API。

停止对应样例的条件：输入或声音权利无法核实、发音/数字错漏、角色串声、台词缺失/截断、未知词被跳过、音轨与答案不一致、无法在指定离线设备播放。保留旧音轨，不以重装/清数据/更改题目答案来掩盖音源问题；其他已批准工程工作可以继续。

## 6. 同脚本12样例：后续小样任务的最小规格

本轮只定样例槽位，**没有新建脚本、选取私人题包、运行生成或试听**。后续由课程/内容角色提供一批自有或有明确使用权、答案已核的原文；同一槽在每个获准候选使用同一文本和角色表，保留原文/旁白/说话人分层，避免模型把姓名标签念入台词。

| 槽位 | 数量 | 重点观察 |
| --- | --- | --- |
| Part1 短描述 | 2 | 连读、动作/位置词、句尾完整；不在无图情况下冒称图文一致性已验 |
| Part2 问答 | 3 | 极短台词、否定/疑问、时间数字、自然响应；重点暴露短句模型弱点 |
| Part3 对话 | 3 | 两个双人、一个三人；每一角色固定 voice、自然轮换/间隔、同一人前后声色一致；缺足够合法声音时标 BLOCKED，不以换 pitch 凑人 |
| Part4 独白 | 2 | 公告/电话留言、日期/金额/地名/专名、长句赶读与漏词 |
| 单词与短句 | 2 | 词音与例句、词尾、同词在句中发音；不因能合成某词而扩大内置词典覆盖声明 |

每个候选最多12槽，预计8–12分钟成品仅作为小样上限安排，实际时长随脚本统计；不是官方题量比例或完整考试。美/英先分配到有证据的声音；澳/加另列未覆盖，不通过提示词或 locale 改名伪装口音。SAPI对照只使用现有明确文本/音轨或后续单独准许的小样，不把本轮变成新生成任务。

执行前确认三道门：①脚本/模型/voice的具体许可与预定个人离线/嵌入用途；②隔离开发环境、依赖和模型版本、磁盘预算及工具路径；③小架音轨标识/句级边界交接和小测评分表。后续再获得安装/下载/小样生成任务时，才实施相应动作；模型初始化可能联网，下载与生成分开登记。

试听须实际进行并留记录：逐字/数字/专名无错漏、台词与答案可定位、正常语速、角色可辨且一致、停顿/重音/语调、目标口音、无爆音/截尾/突兀拼接；同时比较源 WAV 和计划编码，并在指定模拟器验证解码/Back/前后台/离线。模拟器音频可播放不代替人耳自然度，模拟器也不是真机结论。小测与用户或指定听者评定，不以模型作者评分、网页样音、波形、ASR或成功返回文件替代通过。

记录每个样例的源脚本版本与权利、模型/voice版本/hash、角色表、参数、生成轮次、实际耗时/峰值资源（以后实测）、源文件与导出hash/字节/时长、审核人/问题/决定。正常语速1×是主样；逐句与慢速为明确练习辅助，不用统一降速掩盖不自然，不编造官方统一WPM门槛。任何未听项保持 NOT_RUN；小样通过也不自动批准全量。

## 7. HAP 离线体积与交给小架的接口边界

本期路线限定为：**开发电脑预生成并审核 → 仅成品音频及必要来源/索引随指定 HAP 离线播放**。不把 torch/ONNX Runtime/Piper/Kokoro/模型权重打包到端侧，不增加联网生成、付费 API 或用户声音克隆功能。模型下载体积与音频成品体积分别记账。

以下是恒定码率的工程估算，不是实际打包结果；MB为十进制，未含容器/索引/重复片段：

| 成品编码 | 10分钟 | 1小时 | 用途 |
| --- | --- | --- | --- |
| 64 kbps | 4.8 MB | 28.8 MB | 对照现有压缩预算，听后才定是否够用 |
| 96 kbps | 7.2 MB | 43.2 MB | 待比较的成品编码 |
| 128 kbps | 9.6 MB | 57.6 MB | 待比较的成品编码 |
| 24 kHz / 16-bit / mono PCM | 28.8 MB | 172.8 MB | Kokoro示例规格的源WAV量级；不能当压缩交付大小 |

小样8–12分钟每候选，64 kbps约3.84–5.76 MB，96 kbps约5.76–8.64 MB；若保留多个候选仅作为开发试听附件，不能全部自动放入HAP。24 kHz转22.05 kHz不称无损。最终按实际成品字节、重复去重规则、HAP资源清单和目标解码核对，新增总时长未盘点前不报全量包体承诺。

现有索引是完整文本→一个MP3。新候选涉及同文多声音/口音/版本及回合/句级边界，**交小架确定音轨身份与兼容合同**；本文件不另造schema/主键或总体架构，不改题目ID/答案/题包fingerprint，不改变旧音频Blob key。待合同和实际小样通过再由小开按单独任务接入，保留原音轨可回退；不由音频方案创建新学习事实或调整学习进度。

## 8. 交付结论与未完成项

- **已完成**：官方代码/模型卡/具体voice许可线索核查；现有SAPI与音频清单只读检查；指定Python的find_spec和常见缓存位置检查；免费本地候选、小样门槛及包体计算。本轮只新增本文件。
- **当前可用**：既有SAPI/Zira路线与项目包内音频证据；声音token存在。它们不是本轮新生成/试听通过。
- **受检环境未安装**：Kokoro/Piper及所查依赖；外部工具当前PATH未发现。**本轮未下载**：所有模型与voice；指定Kokoro默认缓存未发现，其他位置未穷尽。
- **未核实／NOT_RUN**：本机开源模型实跑、精确硬件资源/速度、模型实际下载文件hash、澳/加候选、多角色自然衔接、人耳自然度/考试贴合、目标端新成品解码、具体权利最终清单与全量体积。
- **下一步交接**：小架接音轨合同/候选取舍，小测接12槽试听标准，dot安排具体安装/下载/小样任务。付费供应、App付费解锁、全量生成、替换和发布均不属于本音频交付。方案未完成项不阻塞其他已批准的第二阶段实现。

外部事实以文中官方源的本轮可访问版本为准；后续获取实际文件时须固定版本并重新核对，不能把可变main页面当下载验签或永久权利保证。本文件验证仅为文档与链接结构检查，不是产品测试或试听验收。
