# 独立终审复验 · v1.1

日期：2026-10-13。对象：PC-20230610ZTOE，`docs/design/ui-redesign-20261013/` 作者 v1.1 修订。与原 `FINAL-INDEPENDENT-REVIEW.md` 同一独立终审任务复验；两名只读辅助评审继续分别核对架构与学习视角。本文件新增归档，原 v1.0 否决记录原样保留。

## 决定：允许进入实现

**原 F01–F04 的 P1 设计阻塞已解决，v1.1 设计可进入实现。** 口语失败恢复、模考交卷与媒体/长材料、窄屏游戏身份、资料/设置/备份等不再只是页面清单或一句“沿用”。实际画面与控制器已有足够具体的布局、动作及保存边界，可指导生产适配。

不是无条件的“所有问题完全关闭”：F02 留下一项模考复盘 fixture 的 P2 一致性修正（R1，见下文），以及有限的文案/证据收尾。**这些不再阻止启动实现，须在对应模块实现验收前关闭；不需重开整套设计或扩大本轮范围。** 本次接受的是设计与实现依据，不是生产、全 WCAG、真实计时、媒体、设备或数据安全验收，也不授权上传、发布、安装或迁移数据。

## 实际复验范围

读取 `V1.1-COVERAGE.md`、`reviews/V1.1-RESPONSE.md`、`QA-v1.1.md`、`screenshots/v1.1/INDEX.md`，核对正式规格新增加的样例规则、口语、模考、资料、偏好/备份与精确 key/ID/Back 契约，以及原型基础脚本和 `revision-v11.js/css`、`speaking-v11.js/css`、`exam-v11.js/css`、`resources-v11.js/css` 的相关流程。继续使用原架构对齐要求，不扩大存储或认证范围。

主评审直接使用图像工具查看下列 **36 张 v1.1 稿**；辅助评审另有各自的亲见取样，不把重叠数量相加、不声称79张均逐像素验收：

- 游戏/主题：`game-320-hollow.jpg`、`game-320-silk.jpg`、`game-390-silk.jpg`、`theme-preview-320-full.jpg`、`theme-preview-390.jpg`。
- 搜索/词卡：`search-390-compact.jpg`、`search-empty.jpg`、`search-detail-840.jpg`、`search-long.jpg`、`mobile-card-save-error.jpg`。
- 口语：`desktop-speaking-directory.jpg`、`desktop-speaking-save-error.jpg`、`desktop-speaking-self.jpg`、`mobile-speaking-save-error-recovery.jpg`、`mobile-speaking-discard.jpg`、`mobile-speaking-long.jpg`。
- 考试/练习：`desktop-exam-listening.jpg`、`desktop-exam-multireading.jpg`、`desktop-exam-legacy-result.jpg`、`mobile-exam-reading.jpg`、`mobile-exam-answer-card.jpg`、`mobile-exam-submit.jpg`、`mobile-exam-exit-error.jpg`、`mobile-practice-long.jpg`、`desktop-practice-intensive.jpg`。
- 资料/设置：`mobile-preferences.jpg`、`mobile-backups.jpg`、`mobile-resource-bc-detail.jpg`、`mobile-resource-bc-saved.jpg`、`mobile-resource-checkin.jpg`、`desktop-recordings.jpg`、`desktop-about.jpg`、`desktop-install.jpg`。
- 基础主栏：`desktop-practice-day.jpg`、`desktop-home-day.jpg`、`desktop-progress-day.jpg`。

辅助评审补看口语保存中/图题/历史、到时保存失败、旧制预检、三来源材料与完整320/390主题板等。本次流程判断来自亲见状态画面和控制器逐步追踪；**没有独立操作浏览器、真实IME/软键盘、麦克风、文件下载/恢复、媒体、计时、存储或实机。** `QA-v1.1.md` 所记连续浏览器交互属于作者亲验，与本评审证据区分。上一轮浏览器本地协议受限后未做绕过。

## 原 F01–F13 逐项判定

| 原项 | 独立复验结论 | 直接依据与关闭边界 |
|---|---|---|
| F01 口语闭环/Blob失败恢复 | **原P1关闭** | 五类目录有不同实际准备/作答标签；桌面失败与手机恢复稿均可回听、重试、下载、明确放弃。成功稿有自评/参考/再录/收获；仅再录与收获受saved门禁。`speaking-v11.js:86–116,136–175` 分开整理、Blob可用、保存与失败，返回/历史走requestClose。真实Blob及背景/Native行为留实现验收；R2为非阻塞文案收尾 |
| F02 模考交卷/媒体/长材料 | **原覆盖性P1关闭；R1残余P2未关闭** | 亲见完整LC轨/图、桌面多材料与手机长材料、答题卡/交卷、漏答与待保存计数、退出失败原计时、旧制七Part结果；常规精听/听写与长文有具体稿。`exam-v11.js:96,102–106,119–144,198–210` 已有连续交卷→失败/成功→结果→原解析控制。旧制、版本、原截止与身份保留。R1不能被称为F02全项无缺陷 |
| F03 游戏主题辨识 | **原P1关闭** | 320px普通页仍有清楚的对称门拱/骨白面具，与斜针/丝环/钟形的不同轮廓；无需靠主题名称即可区分，390同样可辨。纹样固定48px、笔画2.3、opacity1；输入/题面/释义/录音不加入装饰。默认日夜仍无游戏形态。接受此次克制身份表达，不再要求增加大场景或换布局 |
| F04 资料/偏好/备份/安装来源/录音 | **原P1关闭** | BC手机稿有来源、三步、8分钟建议、打开与记录分动作；表单及成功态保持所选材料。VOA/BC/IIBC通过各自ID共享模板，取消/失败/统计边界明确。偏好全字段、三类备份、来源/安装与录音读取错误有具体布局；`resources-v11.js`保留所选资源、note前缀及返回上下文。无须每条资料单独画页；文件/账号/真实保存另验 |
| F05 无结果查询矛盾 | **设计项关闭** | `search-empty.jpg` 输入与标题同为appelp；`revision-v11.js:25`在渲染前设query，未残留schedule。不宣称整库搜索已测 |
| F06 62分钟/启动统计 | **设计项关闭** | 首页四个勾含今日7分钟，进度62分钟/4启动，柱值12/0/18/0/0/25/7自洽；首次另fixture。未改真实started口径 |
| F07 已提交计数/词卡待反馈 | **设计项关闭** | 词卡错误明确“待保存：记住了”、2/8、同反馈重试及改选范围；源码成功解析改3道，保存失败仍2。亲见精听解析3道已提交。真实失败不前进/复习间隔留实现验收 |
| F08 首页词卡副文 | **设计项关闭** | 回忆词义→揭示释义→明确自测，CTA“开始词卡自测”与8词队列一致 |
| F09 搜索/练习密度 | **设计项关闭** | 无工具条390搜索的第一条约293px，可在一屏比较四条；辅助取样320亦成立。主评审亲见320/390游戏主题练习视口，完整模考在范围选择后、七Part之前。正文/操作仍可读，未靠缩字。错误截图标签另列R3 |
| F10 主题预览/必要字号 | **设计项关闭** | 320/390完整板与源码为同词卡标题/正文/schedule选中/主操作/成功失败与重试，明确“组件状态示例”；必要tag/match/状态字13px。日间预览不继承夜间。完整对比度/焦点/大字不在本次关闭范围 |
| F11 词卡快捷键绕出 | **原源码遗漏关闭** | `revision-v11.js:60` capture拦词卡Ctrl/Cmd+K，基础bubble导航不能继续；口语/模考保护也有模块capture。作者QA记词卡不跳转，本评审未冒称键盘亲验。生产全部入口统一guard仍须验 |
| F12 中宽详情断点 | **原断点差异关闭** | `revision-v11.js:61`统一≤1023滚顶；840稿隐藏查询工具并有返回结果。原缺陷已修，完整visibleCount/category/filter/超过24条长列表的回返快照仍属于实现验收，不因作者短schedule测试当作全量通过 |
| F13 长词/内部方法名 | **原设计项关闭** | internationalization与国际化释义/收藏对象一致，缺音标则不造；正式规格`:194`已写addCheckin仅内部使用。个别其他内部说明移出产品流列R4，不重新升级原项 |

## 有限的非阻塞承接项

### R1 · 模考解析必须读取交卷保存快照，不能把待保存选择当原作答

该问题为原F02的残余P2，已按同一连续fixture路径复核，不是孤立截图或生产数据故障：

1. `exam-v11.js:13–19` 初始化 `examChoice='B'`、`readingSaved=false`、`readingPending=true`、`storedReadingChoice=''`。
2. `:102,198–199` 显示146已保存，54未保存（53未选+当前B待保存1）；选择按已保存答案交卷，不执行`:195`的save-answer。
3. `:207,135–139` 模拟交卷成功后，结果仍119正确、54漏答，符合“按已保存答案”。
4. `:205,141–144,81–82` 进入原解析，却用仍在内存的examChoice B，并显示“回答正确/正确答案B”。这与该题漏答矛盾。

**最小修正**：交卷成功时冻结本次已保存答案快照；原解析读取快照而非待保存选择。未保存B应显示“本次未作答/未保存，正确答案B”；已保存A后改选未保存B，解析应保留原A。补三条作者fixture QA：未保存B直接交卷、已保存B交卷、已保存A后未保存B交卷。题包/考试ID/原截止不变，不需要新后端或真实用户记录。由模考实现负责人在复盘模块验收前关闭；修稿可单项补证，无需再做全量设计终审。

### R2 · 口语保存后返回意图的文案一致

`speaking-v11.js:103` 退出保存态说完成后返回目录，但`:142`只进saved，`requestReturn`尚未消费；安全gate成立，用户需再次点返回。明确写“保存后再次点击返回”，或保存成功后完成原退出意图即可。不得为省一次点击而跳过失败Blob保护。非阻塞，由口语实现负责人承接。

### R3 · 截图标签与手机答题卡证据收尾

`mobile-exam-answer-card.jpg`实际片段仅显示材料上部，未拍到卡；卡和交卷入口在长材料/当前题下方，源码路径存在，且完整`mobile-exam-reading.jpg`已显示其位置。补一次滚动到展开答题卡的实际手机视口取样即可，不新增“必须顶端快捷入口”的设计门槛。

`INDEX.md`中部分180/169/218/287px宽且844px高的所谓`viewportFallback`文件，实际是整页缩小呈现；不能作为390×844可见首屏/字号依据。将其准确标为缩小整页审阅图，或换为实际视口截屏。此次F09判断使用的是320/390搜索与游戏主题练习的实际片段，未依赖这些缩小图。由归档负责人修标签，不阻止实现。

### R4 · 内部说明归入评审文档

录音历史等稿里仍有`RecordingList`/`recordingUrl`与“本轮不新增”等实现/评审说明。实现产品页面保留用户需要的范围与错误解释，把方法名、模型名和评审过程文字留在内部文档；不需要再逐页重画。由各页面实现者在文案检查中关闭。

## 视觉判断与数据契约

接受本轮整体方向：主任务/次队列保持清楚，搜索头部密度明显改善；长材料流式阅读与桌面并列题目有明确关系；失败恢复有独立状态与下一步；资源步骤、打开和打卡重新进入学习闭环，简洁不再靠删去现有动作。主题预览有实际内容与错误/成功示例。游戏主题用可辨的不同形态维持身份，题面依然安静；这已达到原F03门槛，后续不必扩大艺术量。

架构书面边界更明确：规格12.1列学习/词库owner或device keys、录音Blob key、模考DB v3和复合owner索引；四主题仍只使用paper/crystal/hollow/silk持久值，day/night只为tokens，theme-only不覆盖其他profile。学习JSON不含录音Blob，词库events独立，完整模考备份/恢复与云题包分开；192MiB本机题库与224MiB备份限制分开。发生时间、wordId、recordingId、原题包版本/fingerprint、ExamAttempt身份/ordinal/revision/截止均保持。

12.2对Back细分更准确：录音100；模考90内部先关题图/确认再退出；50用于ThemeLibrary素材；词典30；壳0。读取失败不得空写回，IndexedDB abort/R2-D1同ID风险仍由原架构线处理。设计通过不表示那些风险已修，也不准在UI改版中擅自迁移/清理真实存储。

## 实现验收与阶段边界

允许按v1.1开始实现，不要求用户重复授权。对应负责人以既有A01–A16承接：真实Chinese IME/软键盘与ArkWeb折叠；Browser/Native/屏内返回及完整查询快照；录音permission/Blob失败下载/背景保存；LC实际播放恢复、RC原截止/串行保存/交卷快照；owner切换/theme-only竞态、旧数据/备份；Portal与提前返回根tokens；键盘/读屏/200%/文本间距/实际对比；整库查询/低端性能。按源码、浏览器、模拟器、真机分别报告，不将静态fixture当生产行为。

本次没有剩余P1设计阻塞。R1–R4是有限承接项；其中R1须修正具体语义，不能被“演示数据”一句话忽略，但无需再阻断公共组件、导航与页面实现。未新增新的审查范围或要求穷举79张/所有主题×所有状态。作者可追加各项最小修订与证据，再由实现验收核对。

## 快照与归档

本次取样时核心SHA-256如下，旧否决记录哈希仍保持不变：

| 文件 | SHA-256 |
|---|---|
| reviews/FINAL-INDEPENDENT-REVIEW.md（原v1.0） | `5CCDB0CF99755FDC9F6591AC2C2B6B1E4EE550BB5EAB94616C4D5508C015AD16` |
| DESIGN-SPEC.md | `600C9913F648D809CFF941A37B85A1738709F79965FB1D6CC7DDD80EAFDF1203` |
| prototype/design.js | `81917F378D022DFF3C4750CE42A142C7397C83B226CB25ED57FC9F328EA32F98` |
| prototype/revision-v11.js | `FDB3F28D6D413F8D07D26C508AE3930C2ABC1B0B0765500FA43E721D4D5A6972` |
| prototype/speaking-v11.js | `BDE2105640A49B5A73BA37B79F4AA2D8BC64CD1435BCAC83E32B4F6990E58B2F` |
| prototype/exam-v11.js | `7A37564717B3536180C1F3FA432DA49D450F2F3A822242839C61BE9FFA95D094` |
| prototype/resources-v11.js | `85C0748E1055D379258DDBC7A638563FB8023CBFD0BF3B275856E120DE8479BF` |

本任务只新增本复验文件；不修改作者设计/原型、生产实现、原评审或架构文件，不上传、提交、推送、发布或操作手机。
