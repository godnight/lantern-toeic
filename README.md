# 当前接续：公开共学本地入口候选（2026-10-15）

隔离工作区`vocab-work/public-local-20261015/site`，分支`feat/public-local-20261015`，从冻结CT-r3 `30257b3a8acdf26258d4310a22ef480e8c9e4f6a`接续。版本0.3.6/20018；CT原工作区只读留小测。已接访客首配、按域保存/同步、账号与数据能力边界、来源/参与和备份说明，详见`docs/testing/PUBLIC-LOCAL-DEVELOPMENT.md`与外层`DELIVERY-PUBLIC-LOCAL-r3.json`。当前候选未独立QA、未发布；真实手机号/产品会话/迁移写入/云删除和公开权利仍有门槛，不称公开多用户完成。

补充：兼容v1/v2且禁写的救援reader/export构建尚未交，回滚就绪NOT_RUN；原生续播疑似问题待CT独立QA复核。

历史段落按原日期保留；旧“必须同一ChatGPT账号”仅适用旧私有站点同步，不是本地启动条件。没有改旧站访问权限、push、合入、部署或操作手机。

---

# Current local candidate — continuous training

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

