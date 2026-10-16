# CT-r20：单次采集观测候选（2026-10-16）

独立目录 `vocab-work/ct-recording-generation-20261016/site`，分支 `diagnostic/ct-recording-generation-20261016`；基于冻结 r19 `49b5b962a1ae95f4513656982f6631b8af3fb4f2`，递增为 `0.3.5/20035`。本轮仅添加有界、脱敏的采集事件/块数/字节/墙钟日志，保存、编码选择、250ms切片、原始块顺序与录音数据结构保持原样；没有接入生成状态分类提案。精确冻结身份、构建与实际结果见外层最终交接；以下历史段落不可当作r20结果。

用户已明确同意一次约6秒电脑麦克风验证，可能录到周围声音；仅15551模拟器本地应用及私有诊断留存、不上传。当前文档冻结前尚未开始采集，不预写成功。不得因失败重录覆盖；旧ID `5309251d-d210-4e37-b42f-23da68c7e061` 和189B原件保留，新样本使用独立ID并单列有意新增。

旧原件为可解码WebM/Opus；两帧5760样本合计0.12秒且PTS重叠在0，不能视为连续0.12秒或解释为6秒真实媒体。r19实际回放仍零时长，整体 `FAIL_PENDING_REPAIR`；本轮新样本和纯回归均不能代替旧缺陷关闭或独立QA、用户视觉批准、发布授权。采集墙钟、逐块大小与解码/播放时长必须分别报告。诊断日志最多128条，activeTracks仅JS快照；另查OS AudioPolicy释放。

详见 [采集观测范围](testing/CT-R20-CAPTURE-DIAGNOSTICS.md)。未push、合入、上传、部署或操作手机；本地开发提交/模拟器覆盖升级仅用于本轮已授权验证。

以下记录按各自历史日期与版本保留。

---

# CT-r15：显式播放重建媒体元素，本地交接待独立 QA（2026-10-15）

`CT-20261015-r15-ba90c9bc3f45` /0.3.5/20030，独立树 `vocab-work/ct-explicit-player-20261015/site`、分支 `fix/ct-explicit-player-20261015`。1371 个运行时输入 SHA256 `ba90c9bc3f45bd5077606eedc3ad270c0c1706828e76ca650d3aa4844939b675`；HAP 46,516,804 B，SHA256 `58cef7d206d7505de6b43fb504aa6bae887b105970909711e8f5af3413a3b16e`。构建后未再修改运行时。

每次用户显式 Continue/Replay 封存旧确认点、失效旧请求并释放旧节点，再各创建一个实际 audio 元素和原控制器；父训练会话/草稿保留。原打包 URL、音频字节/manifest、Range 宿主、原控制器与确认阈值未变，未接 Blob/AVPlayer、静音预播或自动重试。与冻结 r14 相比只改 Practice、原生递增版本号并新增生命周期包装器，1368 项原输入逐字节一致。

开发限定原生核心验证完成：1×/0.85× 各三轮非零点暂停后新 controller 续播，实际暂停分别87.437/65.149/65.108秒与65.057/65.045/65.086秒；同率各轮保留相同进程。Home/保存返回停止、手动恢复、两率新 PID 首次直接非零 Continue、0.7×/1.15×续播、单次原生0.900396秒短尾及 Replay 另留原证据。通过确认门禁的非零续播均先真实 paused seeked，再以原选择速率播放和连续推进确认，结合匹配 UID 系统流；不据此宣称人耳/PCM验收或最终根因唯一确定。

**整体验收仍未完成。** 麦克风准备取消首轮立即检查时为STOPPED state3但条目计数1，原始断言失败保留；随后安全Home才观察到count0，取消独立资源回收门禁为INCOMPLETE，不重试洗成成功。未新录音、未复验既有录音回放、未做原生跨材料source切换、真人可听性或手机验收；交独立QA继续。未出现有效MediaError2/错误确认/保存点污染的媒体复现，不触发Blob对照。另保留短尾旧preparation player4缺begin日志的AMBER，新tail player5确认链完整。最终正常导出/账本审计、设备空闲、源包与提交身份见外层 `DELIVERY-CT-r15.json` 和新工程交接。

797 CJS/宿主、36契约、类型/Web/SDK及真实Chrome单次4项通过，仅覆盖各自范围。首次组件12/13抓到切源playing标志未复位，冻结前修复后原13项全通过；首次全量23项因旧测试导入映射失败，补测试映射后原23项及全量797通过，全部首次日志保留。旧r14/r13/r11、救援r1、CT-r3/public-local及其失败与工件保留。未push、合入、上传、部署、Release或操作手机；开发检查不等于用户批准。

以下保留历史版本记录，按其各自日期与候选理解。

---

# CT-r14：原生失败候选，等待根因与替代路线协调（2026-10-15）

`CT-20261015-r14-50737e67a3e7` /0.3.5/20029；独立树 `vocab-work/ct-sustain-guard-20261015/site`，分支 `fix/ct-sustain-guard-20261015`。源输入1370项SHA256 `50737e67a3e76e59a7e65140028cec4a51c0b5357e8a3ad4e650a02f65aff1c9`，HAP SHA256 `5b5af95f59aa1af30eac9c8cd7b043a47e47ff37fd6ac15d25c35c0b8724b1f7`；构建后未修改运行时。776 CJS/宿主、34契约、类型/Web/SDK及真实Chrome11项通过，不能替代原生结果。

**原生媒体实际 FAIL，不能交作修复完成或发布。** 保留13组限定持续播放观察、2组失败，未重试洗掉结果。旧元素在9.969054秒暂停定位14ms报MediaError2；正常重入的新元素在同保存点成功；其后保持1×不切速，暂停52.028秒再定位15.170487，19ms重现同错，均在play前、未收到seeked、旧点保留。故“切速必需”已证伪；可复现范围是暂停后复用媒体元素/资源生命周期路径，宿主传输与ArkWeb资源状态的最终归因仍未证实。Range尾段206数学与本地字节正确，不称无Range或不能paused-seek。详见 [原生失败诊断](docs/testing/CT-R14-NATIVE-FAILURE-READONLY.md)、[替代路线](docs/testing/CT-R14-MEDIA-ALTERNATIVES-READONLY.md) 及外层原证据。

口语原生弹窗完整、内部滚动及一次6秒录放路径有限通过；无新Checkin或分钟。SpeakingRoom无可编辑输入，IME未验证。原数据与新增录音分别审计，设备归位以外层新DEVICE-HANDOFF为准。完整字节校验Blob或原生媒体仅为待协调诊断路线，尚未实现/证明修复；不继续靠放宽事件等待或容差修改。独立救援r1原件与只读边界保留，其原生文件导入/原字节回导子项通过，复制DB及实际回滚仍NOT_RUN。r11/CT-r3原FAIL、public-local及所有历史工件保留；未push、合入、上传、部署、Release或操作手机。

以下为保留的历史版本记录，按其各自日期与候选理解。

---

# 历史离线候选：CT-r13 暂停准备与诊断（2026-10-15）

`CT-20261015-r13-1d60121e4a86` /0.3.5/20028，独立树 `vocab-work/ct-paused-prepare-20261015/site`。基于r12保留口语布局，新增暂停auto/load、真实seeked后播放、持续窗口及受控诊断。类型、Web、实际SDK与聚焦验证通过，真实Chrome三轮及失败均保留，详见专属testing文档。

**r13已发现持续确认门禁的静态缺陷，不能交QA为修复完成。** 几次推进后停住、随后重复timeupdate仍可能满足旧累计窗口；下一独立r14修订，r13源码/工件全部保留。尚未安装r13；收到15551正式交接后已正常UI新导出三域，workflow/vocab与QA末版逐字节一致、Study只导出时间不同，保留122命令/rev103/13.554秒。独立救援bundle已单独安装验证中，不覆盖学习包。原生媒体、布局与录放仍待新修订，未push/合入/上传/部署/发布。

以下记录按各自历史版本理解。

---

# 当前修订：CT-r12 口语弹窗与可视窗口（2026-10-15）

独立于r11冻结件的新树 `vocab-work/ct-speaking-repair-20261015/site` / `fix/ct-speaking-layout-20261015`，身份 `CT-20261015-r12-dbaa84e640e9` /0.3.5/20027。新修订移除口语/未保存弹窗继承的居中位移与zoom类，由专属inset定位和visualViewport管理可见边界、键盘缩小及内部滚动。739源码/宿主、34契约、类型/Web/SDK通过；实际SDK压缩CSS的9项DOM回归通过，r11负向对照能检出原裁切。详见 `docs/testing/CT-SPEAKING-REPAIR-DEVELOPMENT.md` 和外层交付清单。

**尚未操作或安装到15551：QA当前独占r11。** ArkWeb/真实键盘/录放待协调原生窗口。r12音频与r11相同；dot新增QA非零已保存点恢复失败仍开放，完整证据待收，不以开发正向数据关闭或掩盖。独立救援reader/export在另一树制作，不混入学习包。原r11源码、工件和证据保持，未push/合入/上传/部署/动真机。以下为早期记录，按版本理解。

---

 Current local candidate — continuous training

`CT-20261015-r3-388f17aaa010`, version `0.3.5/20015`, branch `feat/continuous-training-20261015`. Development checks/builds passed; awaiting independent QA. This does not update the deployed Site, create phone authentication or authorize publication. See [candidate validation](docs/testing/CONTINUOUS-TRAINING-DEVELOPMENT.md) and [v0.3.5 notes](docs/releases/v0.3.5.md). Session v2 cannot be safely rolled back to old r3; use a compatible reader/export build. Original accepted P2-r3 and all earlier theme/Demo records are preserved.

Earlier records below retain their historical scope and dates.

---

# LANTERN · 微光托业

## 当前接续：r3 查词详情返回候选（2026-10-14）

r2独立QA确认进度窄屏及指定原生裁切修复、两条非空升级和重复恢复保留；详情中一次Escape只退列表仍阻断。本轮冻结 `P2-20261014-r3-f5ab766451ef` / `0.3.4/20012`，统一嵌入Lookup历史／返回并处理关闭后焦点，保留独立词库内部返回；真实IME第一次系统Back仅收键盘的宿主分支未改。准确源码／Web／HAP及开发验证见外层 `DELIVERY-P2-r3.json`，等待独立复测，未push。见 [r3修复回应](docs/phase2/R3-LOOKUP-RETURN-RESPONSE.md)。六项产品导航数量已按架构／QA记录解释为合理整合；资料不等于随心听看频道。

### 以下为r2交付时记录（详情返回未放行）

## 当前接续：r2 修复候选（2026-10-14）

r1 独立 QA 不放行（进度页窄屏及原生底栏裁切）；旧产物与证据保留。已冻结 `P2-20261014-r2-e208cb589d98` / `0.3.4 / 20011`，修复响应式布局并补回批准稿的单词首卡、品牌和计划日历；准确开发验证／Web／HAP 身份以当前工程交接为准，等待独立复测，未 push。见 [r2 修复回应](docs/phase2/R2-REPAIR-RESPONSE.md)。六项业务导航与演示稿四项结构的整合差异仍交 dot／设计确认，未验项不自动变为通过。

### 以下为 r1 交付时记录（其后独立 QA 不放行）

## 当前接续：第二阶段本地开发候选（2026-10-14）

两主题与当前小骑士图标的视觉及本阶段实现已获用户批准，以下 V1 视觉暂停和旧版本发布描述按历史保留。当前独立分支 `feat/phase2-learning-20261014` 已完成计划／点词／继续练习和一次记账的实现，候选 `P2-20261014-r1-2c3061fdf74b` / `0.3.4 / 20010` 开发检查通过，正交独立 QA；未 push、合入、部署或安装手机。准确源码、HAP、资源、范围与运行步骤见 [第二阶段实现交接](docs/phase2/IMPLEMENTATION-HANDOFF.md)。新工作流只在本机，旧学习事实与数据边界保留。

### 以下为原有版本记录

> **用户视觉验收未通过；合入与部署暂停。** 用户最新反馈：“我看了下你这版本的设计，完全没有空洞骑士的元素了。先别合入了”。当前本地源码、HAP、截图与评审均保留。此前独立评审通过仅适用于其限定技术审查范围，不能等同用户视觉认可。中性日间/夜间主题继续不带 IP；空洞骑士和丝之歌主题需要重新讨论明确角色、场景和世界观辨识度。本次只同步暂停与验收状态，不启动重新实现、渲染或新一轮评审。


## 本地界面重设计验收（2026-10-13）

按 v1.1 审定方案完成共享 React 界面集成，覆盖首页、导航、查词结果与详情、练习、复习、进度、资料库和模考。四主题为默认日间、默认夜间、空洞骑士和丝之歌；默认日/夜不使用游戏素材，原主题 ID、学习记录、账号边界和主要功能保留。

当前是 `feat/ui-redesign-v11` / HEAD `12317b26b85a71888760b0cc18242d00a843ac74` 上的本地未提交候选。最终源码 474/474 学习测试、34/34 构建契约测试、类型检查与 Web/mobile 构建通过。最新 unsigned HAP 已核对 1,071 资源与 1,229 构建输入，并仅升级到自有隔离模拟器 `LanternUIQA4d5098e7`；启动、冷启动和 bundle 身份验证通过。

[同一独立最后复验](docs/design/ui-redesign-20261013/reviews/IMPLEMENTATION-INDEPENDENT-FINAL-RECHECK.md)确认 I04/I08 关闭且 I01/P1 保护未回退，限定源码与受控回归范围无遗留实现缺陷。原生 UI 自动化接口缺失，真实麦克风/系统 Back/后台、正常文件选择器、IME、200%/读屏及 Pura X Max 实机尚未验收。原生日志仍有两项路径被掩码的子资源 404，不能报告全部资源加载成功。

详见[验收与证据边界](docs/testing/ui-redesign-20261013/ACCEPTANCE.md)、[真实界面截图](docs/testing/ui-redesign-20261013/SCREENSHOT-INDEX.md)和[实现修订](docs/design/ui-redesign-20261013/reviews/IMPLEMENTATION-RESPONSE-I01-I11.md)。未推送、合并、发布、上传、安装手机或修改真实学习数据；下面旧版本叙述保留为发布历史。

把每天的一小步，变成可复习、可积累、可分享的学习资源。

[个人GitHub仓库](https://github.com/godnight/lantern-toeic) · [网页试用](https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site)（当前仅所有者可访问）

微光是面向 TOEIC 听读与口语的学习教练。目标、考试日期、每日时间与时区均可配置。预设为听读 >650、口语 ≥130、2026-12-20 听读考试、每日25分钟、每周启动4天；这只是首位学习者的可编辑起点。

## 当前考试与版本安排

用户确认 2026-12-20 只参加听读，口语考后再准备；暂沿用听读 650+，先以每周约 8–10 小时和首次完整基线调整计划。见 [发布与学习计划](docs/RELEASE_PLAN.md) 和 [本次 v0.1.0 测试报告](docs/testing/TEST_EXECUTION_v0.1.0.md)。用户指定本次测试名为 v0.1.0，保留历史 v0.2.x，后续功能版从 v0.3.0 开始；版本名变化不回退源码，鸿蒙升级号递增。

## v0.3.3 个人题包库

网页新增按账号隔离的私人题包上传和下载；鸿蒙可在系统浏览器登录下载 JSON 后导入 App 离线作答。支持明确标注的 2006 版旧题型和现行题型分别判分。考试记录仍保存在作答设备，已有记录的题包不会被清理。详见 [个人题包库](docs/EXAM_LIBRARY.md) 与 [版本测试](docs/testing/TEST_EXECUTION_v0.3.3.md)。下方 v0.3.2 构建阶段为历史：该版后来已覆盖安装并验收词库、查词与原有题包。

v0.3.3 / 20009 已部署并覆盖安装至 Pura X Max。私人云库已核实 12 份：本次新增 10 套旧制练习（2000 题），另有原两套 Vol.4 的时长修正版；题目及音频不打入公共源码或 HAP。最新源码为 [PR #43](https://github.com/godnight/lantern-toeic/pull/43) 的 `feat/private-exam-library`，基于尚未合并的 PR #42 词库分支，不能直接从旧 `main` 接续。设备最终题包和发布状态见[项目状态](docs/PROJECT_STATUS.md)。

## 当前已经实现

- **今日旅程**：按时间预算和已记录的薄弱 Part 选择小组练习，保留一题起步的5分钟最低版。
- **完整练习循环**：68道原创听读题，覆盖7个Part；提交后显示答案依据、中文解析、词汇、逐句回听与听写。
- **口语专项**：现行5类练习，准备与作答计时、麦克风录音、回放、参考表达和自评清单。
- **完整听读模考**：个人完整 200 题 JSON 题包导入、音频/图像预检、完整音轨听力计时与75分钟阅读、断点恢复、首次/复测与 Part 分析；未声明时长的旧题包默认45分钟。题包可以额外保存至私人云库，模考记录仅本机保存，见 [导入说明](docs/EXAM_IMPORT.md)。电脑可用[本地 PDF 原页打包工具](docs/EXAM_PAGE_PACKER.md)整理已有材料；没有预装官方整卷，也不做 OCR。当前私人云库包含 Vol.4 两套修正版和本轮新增10套旧制练习，每套200题；来源与验证边界见[本版测试](docs/testing/TEST_EXECUTION_v0.3.3.md)。本机题包库合计上限192 MiB，须按需下载，不能把整套云库同时导入。
- **托业场景词库与查词**：v0.3.2 源码包含原有 240 个及新增 567 个场景词，共 807 个；另有 55 个题内表达，合计 862 个学习条目。保留旧词条 ID 和复习记录，支持生词收藏、词卡复习及独立 JSON 备份；另按需加载 84,979 条通用英汉查词数据，不能将其全部算作托业词汇。来源与许可见[词库说明](content/VOCABULARY_SOURCES.md)。
- **复习与记录**：首答和复练分别保存；错题与到期题优先；按1/3/7/14/30天逐步安排复习，立即重复不会抬高间隔等级。
- **成长足迹**：真实学习时间、近7天启动、各Part首次正确率、卡点手记、可导出的周复盘。
- **学习书库**：15个官方/免费英语材料入口，按技能筛选、5–15分钟步骤和材料打卡；原创学习包与个人记录独立导出。
- **角色主题**：蓝湖小骑士、白花黄蜂女、雪山黄蜂女、水晶山峰小骑士；桌面场景横幅与手机完整构图，五栏分别使用蓝湖、水晶山峰、原有泪城、雪山、白花场景，恢复原导航及任务卡。深蓝、绯红、晨光和晶紫只切界面配色，场景按栏目保留。可选轻动效在答题、离屏、后台及系统减弱动态时暂停。用户提供的 AI 同人插画独立标注来源，不属于官方游戏素材，见[素材说明](art/README.md)。

## 运行形态

v0.3.3 / 20009 已完成真实鸿蒙 SDK 构建、每份 HAP 的 1,059 项资源核对、私人包官方验签和 Pura X Max 覆盖安装；源码已上传 PR #43，尚未合并或发布该版 GitHub Release。内置 1,015 段合成语音覆盖场景词、题内表达和已有练习，不覆盖整个通用词典；例句跟读及新增词助记尚未完成。

此前 v0.3.1 已预发布，7个公开附件均实际下载校验，Sites版本10部署成功，见[发布核验](docs/releases/v0.3.1-published.md)。专用 HarmonyOS 7 / API 26 模拟器完成覆盖升级、完整题包导入与大文件备份验证。合成题包的独立短流程、原始截止续验及失败修复回归见[自动化报告](docs/testing/HARMONY_MOCK_AUTOMATION_2026-10-11.md)。手机后来已依次升级至 v0.3.2、v0.3.3，当前验收见本版报告；连续两小时前台、完整人耳听力及全新单命令长模式仍未验。

| 形态 | 当前能力 | 边界 |
|---|---|---|
| 网页 / 鸿蒙PWA | 私有网站身份、D1学习记录、R2录音、本机离线队列、恢复联网同步；内置鸿蒙添加桌面指引 | 首次打开需要网络；当前使用同一ChatGPT账号同步；手机号登录尚待真实认证服务；麦克风与系统朗读需设备支持 |
| HarmonyOS原生工程 | ArkTS / ArkUI / ArkWeb共享React界面；SDK构建、开发签名、Pura X Max 安装，离线词库/备份及录音重启回听已验证 | 调试签名和单台真机验证；正式发行、其他机型、原生账号同步和手机号登录尚未完成 |

鸿蒙原生接入位于 `harmony/`，使用ArkTS / ArkUI / ArkWeb复用共享网页资源，目标HarmonyOS 5及更新版本；它是唯一主动维护的原生目标。已完成 SDK 编译、开发签名及 Pura X Max / HarmonyOS 7 的离线词库、折叠外屏和真实录音验证，详见 [真机报告及边界](docs/testing/HARMONY_PHONE_QA_2026-10-11.md)、[编译记录](docs/testing/HARMONY_OFFLINE_BUILD.md) 与 [平台范围RFC](docs/rfcs/0001-harmony-only-platform.md)。

鸿蒙系统浏览器可以将网页版添加到桌面。Web/PWA目前沿用站点的ChatGPT身份；手机号入口只有在真实短信供应商和服务端令牌校验完成后才会开放。原生工程不嵌入网页身份头、Cookie或服务密钥，当前记录仅保存在本机，并在安装说明中提供安全的在线同步版入口。

## 开发

Node.js 22.13+。保留仓库已有的Vinext、Vite、Sites插件与绑定方式。

```bash
bash scripts/codex-setup.sh
npm run build
```

初始化只安装根目录依赖并执行核心检查；`mobile/`保留鸿蒙共享网页入口，没有独立运行依赖。Android/iOS工程、专用工作流和Capacitor已删除，旧源码可从Git历史追溯。Codex接续分支和环境设置见 [Codex交接说明](docs/CODEX_HANDOFF.md)。Web入口为 `app/page.tsx`，共享产品界面为 `app/study-app.tsx`。原生构建见 [原生工程说明](docs/NATIVE.md)。Windows 与 Linux 可执行 `npm run build`；Linux 的限时构建需 GNU `timeout`；生产身份与D1/R2接入仍需要对应运行平台。

## 内容与质量边界

首批内容由AI辅助原创起草，完成答案/图文一致性检查；尚未经真人教师校审或题目统计标定。系统朗读不是官方或真人音频。起步包不是200题完整模拟，练习正确率不换算为正式分数，当前口语反馈不包含AI自动评分。

官方内容只存外链。后续版权资源取得许可后再接入，并与开放题库隔离。参见 [内容来源与审核规则](docs/CONTENT_SOURCES.md)。

## 长期维护

- [独立美术库](art/README.md)：[空洞骑士](art/themes/hollow-knight/README.md)、[丝之歌](art/themes/silksong/README.md)；原作参考与应用素材分别管理。

- [产品路线图与业界参考](docs/PRODUCT_ROADMAP.md)
- [项目维护手册](docs/MAINTENANCE.md)
- [官方真题与样题资料集合](content/exams/README.md)
- [本轮项目审查](docs/reviews/2026-09-08.md)
- [固定团队与协作](docs/TEAM.md)
- [项目状态与后续任务](docs/PROJECT_STATUS.md)
- [架构与数据](docs/ARCHITECTURE.md)
- [贡献规则](CONTRIBUTING.md)

代码采用MIT；本项目自有原创练习文本采用CC BY 4.0，详见 `LICENSE-CONTENT.md`。第三方依赖、商标及外部材料保留各自权利。项目为独立学习工具，与ETS、IIBC或Team Cherry无官方关联。

## 跨端质量验证

[测试设计（40个历史场景）](docs/testing/TEST_DESIGN.md) · [v0.2.4执行报告](docs/testing/TEST_EXECUTION_v0.2.4.md)。结果按源码、浏览器、编译和真机分层；Core CI包含构建后HTML/UI检查。

