# Codex 开发交接

## v0.3.3：个人题包库与旧题型，已部署并安装（2026-10-12）

[PR #43](https://github.com/godnight/lantern-toeic/pull/43) 的分支为 `feat/private-exam-library`，基线为 `feat/dictionary-expansion`；该基线包含 PR #42 词库扩展。接续先核对这两个 PR 的实时合并与检查状态，不能从旧 `main` 直接假定具备本版功能。GitHub 与 Sites 为独立历史，不直接混推。版本为 0.3.3 / 20009；本报告不把本机通过等同 GitHub CI 或 GitHub Release 已完成。

网页版已成功部署 v0.3.3，保持[原网址](https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site)及所有者私有访问。个人题包库使用当前 Sites 身份、D1 目录和 R2 文件；用户明确上传后，其他设备可按需下载。鸿蒙通过系统浏览器登录下载 JSON，再回 App 导入。作答与考试记录仍在本机，尚无百度网盘 API、原生账号认证或考试记录云同步。详见[个人题包库](EXAM_LIBRARY.md)与[导入格式](EXAM_IMPORT.md)。

下载盘点为 222 文件 / 3.86 GB，84 条考试音轨完整解码通过。本次已整理 10 套私人完整练习包、共 2000 题：Tomato 3 第 1–9 套，以及标准试卷 Test 1。均明确标记 2006 版旧题型，不依据下载目录认证为历届实考。Tomato 第 10 套因第 76 题答案存疑排除；标准 Test 2 缺第 3–6 题图片，未凑数。9 份旧候选云题包已按用户本轮授权移除并确认空库，10 份最终包已成功上传：Tomato 第 1–9 套均为 version 2，标准 Test 1 为 version 1。同一登录账号从线上云库下载 Tomato Test 1 到浏览器 IndexedDB 后显示已校验保存，36.9 MiB / 0 考试；另下载 JSON 的 38,725,158 字节与 SHA-256 均和原包一致。题文、答案、音轨、签名和用户备份不进入公开仓库或 HAP。

Tomato 最终题包为 version 2：完整音频时长改为向上取整，修复第一版部分声明略短而被开考门禁拒绝的问题。九套 1800 答案完成答案表双录；335 张题图及 9 条音频在新鲜 Chrome context 中解码/读取元数据，并通过应用真实时长门禁。标准卷 200 答案与解析首字母交叉核对无冲突，36 张题页及完整音轨已验明。答案双录、ASR 抽样与完整解码不等于逐题独立解题或两小时全程人耳试听。

验证分项为 301 项学习/模型/组件检查、34 项构建/发布契约、22 条模考浏览器流程、14 条查词浏览器流程、16 条新功能 Chromium 流程及修复后的 5 条浏览器回归；这些范围分别记录，不合并成一个“全流程测试总数”。类型、内容、四份迁移、真实 R2 SHA-256 探针、SDK 构建和资源核对另有证据。见[本版执行报告](testing/TEST_EXECUTION_v0.3.3.md)。

最终签名 HAP 已通过官方验签并覆盖安装到 Pura X Max。系统文件选择器实际导入 Tomato Test 1 version 2，第一阶段手机为 3 包 / 0 考试；原两套 Vol.4 题包内容逐字段不变，前后正常导出的完整备份已对照。新包图片解码和音频元数据预检通过，未播放音频、勾选人耳确认或代用户开考。一般学习记录以可见汇总与词典状态核对，不能扩大为所有学习记录逐条审计。未卸载、清数据或删除用户记录。该阶段手机本机库约 186.8/192 MiB，后续须按需取卷，不把全部云库同时塞入本机。

补充已知旧材料限制：本轮后续全解码发现原有 Vol.4 两包的 MP3 头部估时低估约 6.323326 秒，实际完整时长约 2758.8440816 秒，旧声明 2753 秒不足。两份声明 2759 秒的私人 version 2 修正版已完成：全部 78 张题图和 2 条音频在真实浏览器验证通过，媒体时长均为 2758.844082 秒，原轨与转码轨各 121,665,024 个 PCM 帧等长，原题、答案和题图保持不变。两份修正版已上传，最终私人云库列表核实共 12 份（新增 10 份及旧卷修正 2 份）：Vol.4 Test 1/2 与 Tomato 1–9 均为 version 2，标准 Test 1 为 version 1。随后按用户明确授权，通过 App 逐份移除未作答的 Vol.4 version 1 并导入两份 version 2。最终正常导出备份核对为 3 包 / 0 考试：Tomato 整个对象不变，Vol.4 仅版本号、音频字节和时长字段变化，题目、答案、题图及来源完全保留，整包与电脑已校验的 version 2 一致。两套在真机均完成全部题图解码及 45:59 音频元数据预检，未播放、勾选试听确认或开始考试。本机占用由 186.8 降至 130.7/192 MiB；手机已返回题包目录。下方历史中的 2752.521 秒是旧头部估计，不能继续当作完整解码准值。

以下保留阶段历史，当前接续以本节和本版执行报告为准；历史中的未安装、仅本机或旧数据库版本描述均须结合所属版本理解。

## v0.3.2 当前接续：词库与查词，网页已部署、PR 待合并（2026-10-11）

本轮源码将场景词从 240 扩为 807（新增 567），加 55 个题内表达，共 862 个学习条目；保留旧 ID、生词和复习数据。另按需读取 84,979 条通用英汉查词，支持收藏、词卡复习和记录备份，不能把全部查词条目标作托业词表。原创扩词与 CC BY-SA 4.0 的中文维基词典 / Kaikki 数据分别记录来源，见[词库说明](../content/VOCABULARY_SOURCES.md)及 `content/dictionary-metadata.json`；不得将第三方释义归为项目原创 CC BY 4.0。

鸿蒙 0.3.2 / 20008 已实际编译；两份 HAP 的 1,059 项资源核对及官方签名验证通过。1,015 段内置合成音频覆盖 807 个场景词、题内表达和原有练习，不覆盖整个查词库。例句跟读、新增词助记和逐词人耳发音验收仍未完成。用户手机此前已装 v0.3.1，本轮尚未安装 v0.3.2，不把构建、验签写成真机验收。

[PR #42](https://github.com/godnight/lantern-toeic/pull/42) 分支 `feat/dictionary-expansion` 已上传，尚未合并及创建 GitHub Release；接续先核对当前 PR 检查。Sites 已成功部署（部署 ID `appgdep_6acb85a079dc81918e6db9c6f4a385d9`），保持原所有者私有范围。不要重发旧标签或覆盖已发布附件。以下为历史记录，当前接续以本节为准。

## v0.3.1 已发布与当前接续（2026-10-11）

[PR #38](https://github.com/godnight/lantern-toeic/pull/38) 已合并；从最新 GitHub main 创建后续分支，发布标签 v0.3.1 为 `339671cdb6376f46d203872be832cb21726f227e`。最终 PR 头 `a9cac23fc3774d743f7f9eeec2bda23a15fdff8d` 的 Core/Harmony 及发布运行 `38125070814` 均成功，7 个公开附件实际下载核验通过。Sites 版本 10/source `369d1fe631a7af80139064cbc7467f4f8b53d14a`/deployment `appgdep_6acb48f7081081919c76e084c0373062` 已成功，保持所有者私有；GitHub 与 Sites 仍为独立提交历史。详见[发布核验](releases/v0.3.1-published.md)。

v0.3.1 / 20007 支持完整音轨声明与实际时长预检，旧包字节/指纹保持；IndexedDB 原地升至版本 2，旧 App 不能再打开升级后的模考库。229 项模型/学习、34 项发布契约及 26 条浏览器流程通过。专用内容模拟器从 0.3.0 覆盖升级的 B0/B1/B2 完整备份一致，仅证明 1 包/0 考试保留；不要扩大成旧活动考试或物理手机升级通过。

前期内容模拟器验收为 **HAU+T1 两包、0 考试**：HAU 官方练习（`official-practice`，听力默认 45 分钟）及 Vol.4 Test 1 私人扫描整理（`other`，原音 45:52.521、声明 45:53）。第二包 29 项独立浏览器检查及鸿蒙原生导入、39 图/音频预检、短播放、冷启和完整备份通过，原包不变；没有替用户开始陌生卷基线，也未勾选鸿蒙的人耳确认。边界及证据见[双题包验收](testing/REAL_EXAM_PACKS_v0.3.1_2026-10-11.md)。

Vol.4 Test 2 的独立 42 页/200 可见答案复核及 35 项实际浏览器检查已通过，私人题包 79,099,554 字节，SHA-256 `7864709588a9ad5c69c96b6004ef2d30900631692a8eccf967c737301a708dac`。T1+T2 两套出版整理包已在独立 Books 模拟器完成同库验收：各 39 图与 45:53/75:00 媒体预检、短播放/暂停、冷启均通过；实际完整备份 157,121,878 字节，SHA-256 `90d2c3764bbd6dafadb6391bcf6c131886b992829c451d2c9b2bc9e37076d605`，两次接收逐字节一致，原包 SHA 均保持，最终 2 包/0 考试。未勾选人耳确认或开始考试。

两套均为 `other` 分类，已私人交付核验；具体实考场次未经独立认证。公开原轨完整传输、末问句完整，其后约 1.39 秒低电平；保留短作答间隔限制，没有已证实缺题/缺词，不补静音或裁尾。两套 Vol.4 JSON 合计 157,121,768 字节，低于每个本机题库 192 MiB（201,326,592 字节）上限；加上 HAU 后为 232,816,814 字节，不能在同一题库同时导入三套。保留已有题库与备份，使用独立验收环境；不通过卸载或清数据腾空间。

已知显示问题：[Issue #40](https://github.com/godnight/lantern-toeic/issues/40) 记录页脚仍硬编码显示 v0.3.0；实际已安装模块元数据为 0.3.1 / 20007，计时功能验收不受此标签显示问题影响。v0.3.2 优先统一版本元数据并补构建验证；不覆盖已公开 v0.3.1 附件。

手机可以拔掉；本轮不操作物理机。私人签名 0.3.1 HAP 已完成官方验签和 490 资源核对，但尚未安装手机。前期内容模拟器保留 HAU+T1，独立 Books 模拟器保留 T1+T2，各为 2 包/0 考试；旧自动化实例另有合成 QA 历史；接续先核对显式实例和目标绑定，禁止清数据或混用。原件、题图、完整备份、签名及设备标识不上传 GitHub。Books 模拟器已通过官方命令正常停止，运行清单及监听确认退出，磁盘数据保留，旧实例未操作；接续先重新确认目标再启动。本次发布收尾仅改文档，不重发 HAP/Web/标签或 Site。

更新：2026-10-11。代码仓库：[godnight/lantern-toeic](https://github.com/godnight/lantern-toeic)。当前只维护Web/PWA和HarmonyOS；Android/iOS工程、专用工作流及Capacitor已删除，旧源码留在Git历史。

## 前期记录：首套完整官方练习题包（2026-10-11）

PR #33、#34均已合并，从最新main接续；本轮集成基线 `7407364bd373410d3cedbb423e770150779187c9`，树 `8de5ce459cab9a5ef85d5d173074dcc3a0455307` 与本机 `8b750702900577e77ff3c006cbcbf10d0da2da49` 一致。GitHub与本地仍是独立历史，不直接推送本地祖先。PR #34最终[Core](https://github.com/godnight/lantern-toeic/actions/runs/38120704905)及[main推送检查](https://github.com/godnight/lantern-toeic/actions/runs/38120839042)成功，201项学习/模型检查、22条浏览器及真实保护PDF转换有实际日志证据。

私人 `vocab-work/research-full-exams/hau-ets-complete-practice-test-20261011/packed-ets-hau-complete-practice-1-v1/exam.json` 已生成，75,695,046字节，SHA-256 `0fe0f70125d683a16e53a78d1e6c44df06d912a98b1b55c1d7fbb97001f2e551`。HAU同一官方下载记录提供ETS64页题本及四部分WAV，已按Part顺序连接为44:31.092 MP3。200答案经两次独立可见页面复核，103组/39页及媒体字节与真实模型校验通过；浏览器真实导入/预检9项、题面/跨页/放大11项检查通过；独立鸿蒙内容模拟器的实际导入、预检、播放、冷启和完整备份已通过，最终1包0考试，见[材料验收报告](testing/ETS_COMPLETE_PRACTICE_2026-10-11.md)。当前1套官方完整练习卷，不能称多套历届真题。详细来源、音轨顺序陷阱及答案重叠文本层见[材料核查](research/OFFICIAL_EXAMS_2026-10-11.md)。下文“完整可听0套”属于此前阶段。

手机可以拔掉，本轮不操作物理设备。既有LanternOffline7含两套合成包与未交卷QA记录，不得导入真实题包或清理数据；新内容验收使用LanternContent7，显式实例目录在D盘；实际运行完成后已释放锁，保留1套真实题包、0考试。每次接续先重新核对官方显式目录清单及目标绑定，不能沿用默认只列旧实例的清单或猜端口。原始材料、渲染、私人考试记录与设备信息不上传GitHub。工具/文档和私人材料不改App版本，不重发HAP/Web/Site。

## 前期接续：原生模考 runner 已通过独立短流程（2026-10-11）

PR #32、#33 已合并；#33合并提交为 `2c24bf058a0adc7b2fd1e20e2e54e8e8f41a72bf`。独立短流程与原截止续验均通过，最终文档提交 `6524deb0b772720c4aab37dddc2354fc261b98fe` 的[Core](https://github.com/godnight/lantern-toeic/actions/runs/38120468872)与[Harmony](https://github.com/godnight/lantern-toeic/actions/runs/38120468860)均成功；145项Python离线、198项学习检查及发布门禁29项Node/22项Python有分项证据。执行说明 `harmony/scripts/ui/MOCK.md`，报告 `docs/testing/HARMONY_MOCK_AUTOMATION_2026-10-11.md`。本轮只改工具/文档，不改release-manifest，不重发v0.3.0 HAP/Web/Site。

第90轮同次考试续验通过并实际退出0（`90-latest-backup-continuation`）：最新B1两次恢复、拒绝旧B0后全数据保持、四份比较、自然LC→RC→超时交卷及最终导出均验证。原听力截止12:58:34.646、整卷截止14:13:34.646（Asia/Shanghai）保持；最终文件SHA-256为 `c5a4739bb1665f1a70a1c51c9666d08274281f665939b8b316a7971362e636a5`。这是第89轮同一记录的诊断续验，不是新长模式独立全程通过。

第91–94轮失败与原证据保留；针对选择器过渡、屏外网格及导出后可信空Web完成先失败后修正。第95轮从独立CLI入口实际运行，15:04:06退出0、全部6项检查通过，证据 `95-independent-short-export-wait`。两包导入、预检、两答案冷启保存、四份真实备份及最新B1两次恢复均完成。独立复核确认原两条已交卷历史逐字段不变，仅新增ordinal 3，答案/保存时间/截止保持，恢复新增0套/0记录；B3为3,726,751字节，SHA-256 `7ed7fcedee4964e8932e64adb853a446a16427aaafb4e043f8ea415181de614e`。

截至第95轮结束，runner已经退出，页面停在模考目录；新的合成QA考试仍未交卷，B3记录其为听力阶段，原听力/整卷截止15:45:20.838/17:00:20.838（Asia/Shanghai），计时未暂停。先读私人 `vocab-work/simulator-acceptance-20261011/CONTINUE-real-deadline-observer.txt` 并实时核对进程/锁与记录，不清数据、改时钟或无视这条未交卷记录另开测试。无需为本轮工具收尾再等两小时。用户已获知手机可以拔掉，本轮不操作物理手机。两段证据不覆盖全新单命令长模式、连续两小时前台、完整真实听力或新版真机。

私人 `vocab-work/research-full-exams/iibc-2020-archive` 已取得 IIBC 2020 官方模考200题题本、200项答案和空白答题纸，103组题页映射已准备，仍缺匹配音频、未生成最终题包。Hachette公开CD2音频包已完整核验，CD1截断，尚无对应完整题本/答案，不能补IIBC缺口。完整可听导入包仍0套；继续由我们在线获取并核验题本/匹配音频/答案，不默认转回用户提供，也不使用静音凑包。来源及边界见[材料核查](research/OFFICIAL_EXAMS_2026-10-11.md)。

PDF兼容修正见PR #34（`fix/printable-protected-exam-pdfs`），已在PR #33合并后改以main为基线，本地集成29项packer回归通过。首版提交 `407e81e92303f0f0b2f4697344125af89e9267dc` 的[Core](https://github.com/godnight/lantern-toeic/actions/runs/38116263181)通过201项学习/模型检查、真实保护PDF转换和22条浏览器流程；最终合并基线的CI及合并状态以PR #34为准。已合并则从最新main接续，否则从该分支接续。改动为原7份工具/测试/说明文件，加3份交接状态文档。私人转换证据在 `vocab-work/pdf-printable-compatibility`；真实IIBC原件只核验元数据、0附件与封面渲染，不等于完整题包。Windows使用同版完整Poppler的ASCII工具目录，避免日文字形缺失。私人题本、答案、映射、原始布局和实际备份不加入Git。

## 前期模拟器受控验收（2026-10-11）

本人已明确同意并通过官方流程接受四份模拟器协议。既有 HarmonyOS 7 / API 26 镜像可用；CLI 原先使用了不匹配的 SDK 根目录，官方 Emulator.exe 的 `-imageRoot` 应指向包含 system-image 的用户 Huawei SDK 根目录，不能直接指向 system-image。不要再把协议确认或镜像下载列为当前阻塞。

专用实例 LanternOffline7 已覆盖安装 v0.3.0 / 20006；每次操作仍须重新核查实例及显式 HDC 目标，禁止因手机已连接就改动用户正在使用的物理机。词库 runner 两处遮挡/快照缺陷已修复，35项离线检查及最终真实 smoke 通过。先核对 `fix/harmony-ui-occlusion` 对应 PR 状态，合并后从最新 main 接续；GitHub 与 Sites 的提交历史独立，不直接互推本地提交。

模考受控 CLI 完成两套合成包导入、媒体预检、两答案冷启保存、原生下载与两次幂等恢复，四份实际备份经模型核验。图片放大、双向滚动、Back返回也通过。后续真实截止、最终备份及独立短流程结果见最上节和自动化报告；完整可听真题、连续前台/真实听力和新版真机仍另验。详见 `docs/testing/HARMONY_MOCK_QA_2026-10-11.md`。本轮仅测试工具和文档，不重发已有HAP/Web/标签，不重部署Site。

该前期阶段结束时模拟器停在成长足迹，原页合成模考保留2道答案，计时没有暂停或重置；已有学习页首答2题、录音0段的计数仍在，但未做全部旧数据逐字段迁移核验。接续勿卸载、清数据、修改系统时间或编辑应用私有数据库。本地证据位于 `vocab-work/simulator-acceptance-20261011`，不要将原始布局、设备信息或完整备份上传公开仓库。

## v0.3.0 发布与原页工具基线（2026-10-11）

新增本机原页打包工具在 `scripts/pack-exam-pages.cjs`，说明 `docs/EXAM_PAGE_PACKER.md`，PR #31 已合并。它兼容既有v0.3.0，不改App/题包格式，不要求重发HAP或Site。161项学习检查（含26项工具检查）、真实PDF转换及22条浏览器流程已在本机通过，详见 `docs/testing/EXAM_PAGE_PACKER_2026-10-11.md`；原版本228项机器检查/18流程仍是历史发布证据，勿把两轮数量简单相加。

Windows捆绑Poppler缺少pdfdetach，完整26.07.0工具已在私人vocab-work目录；CI自行安装poppler-utils。新浏览器链路只用原创控制材料，不能记为取得真实卷。私有Site未完成登录后的线上复验。用户睡觉期间不要求其重复登录、重签名或操作手机；模拟器协议已在后续明确授权后接受。

从 GitHub 当前 main 接续。PR #29 已合并，v0.3.0 标签/功能基线为 `88dd510fdbbf9edaef0370ff537f463142c9ca2c`，树 `60c436a7dcba3f0127cffb3e0fd175ec59ec1eba`；发布 run `38073334481` 成功，附件以实际发布 SHA256SUMS 为准。随后文档提交只记录发布结果，不覆盖已发布标签或附件。

Sites 版本 9 已部署对应功能，源提交 `2d342626cb23389021a10ba8b8b1b5c76b3568d2` 与上述功能基线同树；最新文档提交不要求重建未变化的网页。所有者私有权限未变。线上浏览器复验遇到连接超时，不能把部署成功写成手机已经打开。

整卷格式在 `docs/EXAM_IMPORT.md`，存储与计时设计在 RFC 0005；本机 228 项机器测试和 18 个浏览器流程通过，CI 也已运行浏览器门禁。新版本地签名 HAP 在私人交付目录，未安装到手机；旧真机录音/词库证据只适用于原验收范围。下一步在专用设备或本人明确交出且空闲的手机上验证完整卷/后台及真实听音，不卸载或清空学习数据；模拟器文件下载补充结果见最上节。

发布时私人交付只有60题官方原样PDF；其后已取得一套 IIBC 完整官方模考题本和答案，仍缺匹配音频，当前状态见最上节。真实硬件验收、完整可听材料、手机号与云同步的账户配置仍待推进。发布与后续事项见 `docs/releases/v0.3.0-published.md`。

## v0.1.0 发布历史（2026-10-11）

PR #28 已合并，GitHub main/tag v0.1.0 为 `859a39f18eb4c3d95445ff08e37b3226335bfc23`；7 个预发布附件已完整上传并核验。相同内容的 Sites 源提交 `f3fbac42dae8f7907b5377c1e44d5bafe645c823` 已部署成功，原所有者私有地址不变。GitHub 与 Sites 仍保留独立提交历史。

模考分支 `feat/full-listening-reading-mock` 曾从此基线开发 v0.3.0 / versionCode 20006，现已合并。个人题包不进入公开仓库，勿把旧 v0.1.0 的真机证据扩大到新功能。

Windows Sites 打包使用已安装 Codex Node 24.19.0 + Git Bash，当前进程设置 `TAR_OPTIONS=--force-local`。普通 Node 24.13.1 在 fs.cpSync 原生崩溃；插件 npm shim 仍有路径问题，直接 PowerShell npm.ps1 可安装锁定依赖。凭据仅经 helper stdin 传递。

## v0.1.0 准备阶段历史（2026-10-11）

PR #26 与 #27 已顺序合并，GitHub main 为 `70081a47059036d11e731cb2166975aab453fd5f`，内容树与本地真机修复基线一致。v0.1.0 测试发布准备中：报告见 `docs/testing/TEST_EXECUTION_v0.1.0.md`；发布计划见 `docs/RELEASE_PLAN.md`。当前默认范围是 12 月 20 日听读，口语后延。后续功能版从 v0.3.0 继续，避免覆盖历史 v0.2.x 标签。

Windows Web 构建现在由 Node 包装器直接启动锁定 Vinext，避免 PowerShell 把 Bash 转入缺少 Node 的 WSL；Linux CI 保留既有脚本。设备自动化在 `harmony/scripts/ui`，27 项离线测试通过，live 首跑待模拟器协议确认，不能写成端到端已通过。

## 最新真机接续（2026-10-11）

词库位于 [PR #27](https://github.com/godnight/lantern-toeic/pull/27)，以 PR #26 的 `test/harmony-offline-validation` 为基线；先核对合并状态。本人开发者 CLI 登录、AGC 设备登记、开发签名和 Pura X Max 安装已完成，不要重复要求这些前置。

真机离线冷启动、折叠/展开布局、词库、JSON 重复导入、内置发音、麦克风录音切后台保存及冷启动回听均有实际证据和用户听音确认。发现录音日期错误使用 UTC 切片，已按配置时区修复，自动化先失败后通过，并覆盖安装在同一录音上回归。见 [真机报告](testing/HARMONY_PHONE_QA_2026-10-11.md)。当前签名包 SHA-256 `64076cee2802ad2803496217909c65b22aa00791e2fe31f165d8e9a5ebc3487d`；签名材料仅在本机隔离 staging，不能覆盖到 Git。75 项学习/词库及 5 项 Web 产物检查通过。

原生仍为本机离线版；手机号登录、原生云同步、发行签名和商店发布未完成。真机拒绝麦克风、长时间后台/锁屏、大字体及其他机型未验。本轮未发布 Site；此前词库网页包上传超时，不能把源码提交当作线上更新。以下旧状态结合此节阅读。

## 最新词库分支（2026-09-19）

先核对 `feat/toeic-vocabulary` 的 PR；它建立在尚未合并的 PR #26 `test/harmony-offline-validation` 上。包含240场景词、55额外题内表达、双语搜索/生词/自测、独立词库JSON备份、网页D1同步与鸿蒙离线语音。详见 PROJECT_STATUS 和 RFC 0004。只检出旧main会丢失两个阶段改动。

新迁移 `drizzle/0002_parched_edwin_jarvis.sql` 仅新增 vocabulary_events。词库进度不属于 StudyData v2 / 原个人记录备份；不得塞进 Attempt、QuestionMark 或 /api/study。鸿蒙owner仍为null，不要声称手机号或原生云同步已经实现。`npm run test:study` 已加入20项词库测试，合计74项；完整相关自动化99项通过。

2026-09-19本地Sites插件目录在运行中消失，已搜原缓存未找到；生产构建改用已锁定安装的 `npx --no-install vinext build`（与原helper最终构建命令相同），正式Worker本地hydration通过。原始 `npx vite` 开发预览存在React重复加载问题，勿把dev错误或静态截图当成生产发布失败。发布沿用当前owner-private Site；原账号授权未扩大。最终部署结果和PR状态需检查本轮交付。

## 先选对分支

PR #18 平台收敛、#20 数据基础、#21 地图改版、#22 去地名、#24 离线 HAP/内置语音、#25 原生导出均已合并。2026-09-19 核实 GitHub main 为 `b8da1526e21f4369998fe58bae1ad6105962292f`。本轮设备回归修复在 [PR #26](https://github.com/godnight/lantern-toeic/pull/26)，分支 `test/harmony-offline-validation`；接续时核对实时 PR 状态：

- PR未合并：从PR分支接续，不能只检出main后重做或遗漏现有工作。
- PR已合并：拉取最新main，再创建任务分支。
- 不强推、不重写历史，不把聊天中的旧SHA当作永远不变的分支头。

PR #18 完成平台收敛和交接，手机号认证与 HAP 仍由独立任务跟进。最终提交与 CI 结果以 PR 页面为准，不再沿用“main 仍是 v0.2.3”的旧交接说明。

## 接续初始化

先读 `AGENTS.md`、本文件、`README.md`、`docs/PROJECT_STATUS.md`、`docs/TEAM.md`、`docs/rfcs/`。使用Node.js 22.13+，在仓库根目录运行：

```bash
bash scripts/codex-setup.sh
```

该脚本只安装根目录锁定依赖，执行类型、内容、素材及行为检查。`mobile/`保留鸿蒙共享网页入口，没有单独依赖安装。首次安装需访问锁文件对应的npm源；普通Linux构建另需GNU `timeout`。不需要生产凭据即可运行源码检查。新Codex环境的仓库访问和安装网络权限须在其运行环境中配置，不随克隆自动继承。

## 2026-09-19 历史状态快照

以下表格与其后的当轮工具链说明保留历史；当前版本、真机及部署状态以上面的2026-10-11接续为准。

| 项目 | 已完成 | 未完成或边界 |
|---|---|---|
| Web/PWA | 今日任务、练习解析、口语录音、复习、周复盘、资料书库及鸿蒙桌面指引 | 目前用ChatGPT托管身份，手机号认证未实现 |
| 在线版本 | 沿用既有私有 Site 地址及 custom/owner 权限；本轮未部署 | 以 Sites 实际部署记录为准，GitHub 合并不等于部署 |
| 题库与美术 | 68道原创听读题、5类口语、22条官方资料；3主题、8幅原创图、19个外部参考；Web系统朗读、鸿蒙153段内置合成音频 | 待真人审校；没有正式分数标定或AI口语评分 |
| HarmonyOS | Windows SDK 26 编译、HarmonyOS 7 模拟器安装运行、学习/复习/打卡、下载目录实际导出；195项资源、153段离线音频，详见本轮QA记录 | 原生仍本机存储；真机签名/安装、真实录音音质和折叠屏硬件验收未完成 |
| Android/iOS | 当前源码树已删除工程、工作流、配置和依赖 | 历史报告和旧Git提交只用于追溯 |
| 栏目地图 | 五栏独立地图、统一状态栏、缩略图导航、场景行程卡；320/390/1440px 浏览器检查 | 使用用户素材派生图，来源见 art/MAP_LAYOUT.md；真机另验 |
| 数据基础 | schemaVersion=2、标记/任务的离线日志与服务端同步、幂等 JSON 备份恢复、追加式 SQL 迁移 | 错因/任务编辑和备份恢复界面仍未提供；录音备份无音频文件 |
| 验证 | 79项：54学习行为＋14鸿蒙源码/工具链＋6包体校验器＋5Web产物；类型/内容/素材、Web构建、195资源核对、SDK26 HAP编译通过 | 7cf83ef Core/Harmony CI通过，后续以最新PR头为准；旧全量Lint未通过；真机需单独验收 |
| 手机号认证 | RFC记录候选架构、真实前置、用户与Codex分工；readiness缺项会阻止通过 | 中国大陆短信需额外短信服务；AGC配置、令牌后端、费用与设备验收尚未到位 |
| GitHub流程 | Core、Harmony共享资源、源码预发布工作流，Issue/PR模板、CODEOWNERS | main分支保护和依赖问题仍由既有Issue跟踪，不假定设置已启用 |

在线地址：[微光托业](https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site)。手机使用系统浏览器并登录有权限的同一 ChatGPT 账号。本轮只构建和测试，未发布新 Site。Sites 与 GitHub 保留各自提交历史，发布记录单独核对，GitHub 合并不等于线上更新。

## 工程地图与验证

| 路径 | 职责 |
|---|---|
| `app/study-app.tsx`、`app/learn/` | Web/鸿蒙共享学习界面 |
| `lib/`、`app/api/`、`drizzle/` | 学习模型、本机存储/同步、身份边界、API及SQL迁移 |
| `content/`、`art/`、`public/` | 原创题库、外链目录、素材及来源 |
| `mobile/src/`、`mobile/vite.config.ts` | 鸿蒙共享Vite静态入口，读取根目录依赖 |
| `harmony/`、`lib/native-host.ts` | 鸿蒙Stage工程和生命周期桥 |
| `tests/`、`.github/workflows/` | 行为回归、资源检查、构建与发布 |

按改动风险运行，不重复无关全量检查：

```bash
npm run typecheck
npm run validate:content
npm run validate:art
npm run test:study
npm run build
node --test tests/*.test.mjs
npm --prefix harmony run sync:web
npm --prefix harmony run check:web
npm --prefix harmony run check:auth
node harmony/scripts/check-toolchain.mjs --report-only
```

`check:auth`仅报告前置，不会发送短信；`require:auth`缺配置时返回2。AGC配置路径为 `harmony/AppScope/resources/rawfile/agconnect-services.json`，不提交Git。HAP还需DevEco/SDK/OHPM/HDC、签名及设备；共享网页检查不能代替这些验收。配置和区域要求见 [RFC 0002](rfcs/0002-phone-auth-and-online-data.md)。

Windows 用 Node 24.13.1 和根目录锁定依赖。WSL 的 CLT 5.1.0.840 / SDK 5.1.0.125 / OpenJDK 21 构建基线继续保留，`harmony/scripts/build-offline.sh` 自动在 ASCII 临时目录构建并核对包体，见 [编译记录](testing/HARMONY_OFFLINE_BUILD.md)。2026-09-19 另已安装 Windows Studio 26.0.0.821、SDK 26.0.0.105、CLI 1.3.0 并完成 Huawei CLI 本人授权，HarmonyOS 7 模拟器已运行。Windows 构建在隔离 ASCII staging 中移除旧 compileSdkVersion 字段，由 Studio 使用所带 SDK，最低/目标 API 12 保持不变；未改仓库 API 18 编译基线。不要再把缺 SDK/模拟器或未登录当作当前阻塞。仍需真实手机连接和签名授权。

## 哪些已在GitHub，哪些不会随Git迁移

| 信息 | 位置与接续方式 |
|---|---|
| 源码、原创素材、题库、外链目录、SQL迁移、测试、需求决策与当前待办 | 仓库内；阅读本文件、RFC、路线图和状态文档即可接续 |
| Issues、PR讨论、提交与CI日志 | GitHub在线记录；并非普通git clone中的文件 |
| 这次聊天 | 未上传完整聊天；与开发有关的决定、状态及阻碍已整理进文档 |
| commit-work skill | 已安装到当前Codex个人环境；新环境不会自动继承，核心提交规范已记录于CONTRIBUTING.md |
| 学习记录与录音 | 生产D1/R2或设备localStorage/IndexedDB；不在Git。现有JSON导出不包含录音文件，迁移前另做音频备份 |
| 账号连接、托管身份、短信密钥、签名、AGC配置 | 外部平台或安全环境；不在Git，也不应公开提交 |
| SDK、依赖、生成网页资源、HAP | SDK不进Git；按文档重建，已有未签名HAP及校验报告保存在本机构建输出目录 |

因此GitHub足够接管源码开发，但不等于线上数据、外部权限、个人skill或手机环境已经搬迁。代码仓库公开，不放真实手机号、验证码、私密录音或密钥。

保留 `.openai/hosting.json` 及D1/R2绑定。已有Sites与GitHub源仓库历史不同，不强推统一历史；部署必须通过有权限的Sites环境同步、构建和发布。没有部署权限的Codex仍可开发和提交PR，不能声称代码push就更新了线上服务。

## 提交规范与后续任务

遵守 `CONTRIBUTING.md`：查看工作树和仓库约定、最少逻辑提交、明确文件暂存、检查差异和密钥、执行相关验证、PR记录真实边界。个人skill来源与固定版本见该文件；没安装skill也必须遵守仓库规范。

后续优先级：

1. 用户最新优先级是离线版及完整测试闭环。[#1 鸿蒙HAP](https://github.com/godnight/lantern-toeic/issues/1)、[#2 签名与备份](https://github.com/godnight/lantern-toeic/issues/2)：先读 [本轮QA记录](testing/HARMONY_QA_2026-09-19.md)，不要重做已通过项或把模拟器等同真机。用户已完成华为登录/实名并告知使用鸿蒙7以上手机；剩余真机连接、匹配签名材料和硬件验收。CLI 自动签名可能替换同团队证书，先检查并复用匹配材料，不能盲跑证书重建。
2. [RFC 0002](rfcs/0002-phone-auth-and-online-data.md)：手机号及联网版独立跟进，先确定号码地区、供应商和HTTPS认证后端。用户负责本人账号/认证/计费，Codex负责SDK、短信接口、令牌验证、数据隔离和测试。既有Site权限是否改为公开入口须另确认，不能因手机号登录而直接公开学习数据。
3. [#8 数据模型](https://github.com/godnight/lantern-toeic/issues/8) 本轮实现，先读 [RFC 0003](rfcs/0003-study-data-v2.md) 及关联 PR；继续 [#9 错因界面](https://github.com/godnight/lantern-toeic/issues/9)、[#10 每日计划](https://github.com/godnight/lantern-toeic/issues/10)。[#3 同步](https://github.com/godnight/lantern-toeic/issues/3) 已关闭，真实跨设备同步、下载及 PWA 验收继续跟踪 [#17](https://github.com/godnight/lantern-toeic/issues/17)。
4. [#4 依赖](https://github.com/godnight/lantern-toeic/issues/4)、[#5 仓库保护](https://github.com/godnight/lantern-toeic/issues/5)、[#6 内容审校](https://github.com/godnight/lantern-toeic/issues/6)：沿用现有追踪，不重复建单。

## 可直接交给Codex的任务

> 接续 godnight/lantern-toeic。读取 AGENTS.md、本交接最上节、PROJECT_STATUS.md 和 TEAM.md；PR #38 已合并、v0.3.1 已发布，从最新 main 开始。只维护 HarmonyOS 和 Web/PWA。保留既有 QA 历史，不操作物理手机或清数据。已私人交付并完成 T1+T2 两套出版题集整理包的浏览器及鸿蒙同库验收，来源分类均为 other；独立 Books 模拟器冷启和 157 MB 完整备份通过，2 包/0 考试，人耳确认未勾选。HAU 官方练习及原 HAU+T1 题库另保留，192 MiB 总库上限不允许三套同库，不清数据。保留 Test2 约1.4秒末尾停顿与来源场次未认证限制；Issue #40 页脚旧版本号在 v0.3.2 修复。不要重复已完成项。用户首次陌生卷基线属于后续学习安排，不代答或编造记录。按 CONTRIBUTING.md 验证、提交和更新交接；文档/材料收尾不重发已有版本产物。

