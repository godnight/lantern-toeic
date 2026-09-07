# LANTERN 可持续资源接入证据

核验日期：2026-09-07。资料包包含15个可打开的课程/官方资料页面、全七个听读Part、口语入口，以及原创中文学习步骤。全部来自内容发布者的第一方网站。没有复制第三方题目、正文、图片、PDF或音频。

`resources-v2.ts`提供`LearningResource`类型与`resources` / `learningResources`数组，包含父任务要求的全部字段。`minutes`是建议学习时长，不是媒体时长。`parts`只表示L&R Part 1–7；口语条目为空数组。通用英语对TOEIC技能的映射是本轮整理判断，不是发布者宣称的TOEIC课程或经验证的提分效果。

核验范围：读取了页面内容、原站功能说明和许可条款；未在交互浏览器中播放每个媒体文件，也未做逐音频人工试听。因此`mediaPlaybackVerified:false`。本轮元数据和学习步骤由AI整理，尚无真人教师校审，故`humanReviewed:false`；这不评价原发布者内部审稿流程。

## 15个直接可学入口

| ID | 技能与免费内容 | 原站 |
|---|---|---|
| `iibc-p1` | Part1；两张图片、官方音频、答案反馈 | [图片题](https://www.iibc-global.org/toeic/test/lr/about/format/sample01.html) |
| `iibc-p2` | Part2；四道问答、官方音频、答案反馈 | [问答题](https://www.iibc-global.org/toeic/test/lr/about/format/sample02.html) |
| `iibc-p3` | Part3；成组对话、官方音频、问题与答案反馈 | [对话题](https://www.iibc-global.org/toeic/test/lr/about/format/sample03.html) |
| `iibc-p4` | Part4；成组独白、官方音频、问题与答案反馈 | [独白题](https://www.iibc-global.org/toeic/test/lr/about/format/sample04.html) |
| `iibc-p5` | Part5；短句填空与答案反馈 | [短句填空](https://www.iibc-global.org/toeic/test/lr/about/format/sample05.html) |
| `iibc-p6` | Part6；邮件四题与答案反馈 | [篇章填空](https://www.iibc-global.org/toeic/test/lr/about/format/sample06.html) |
| `iibc-p7-single` | Part7；广告、文章的单篇题组与答案反馈 | [单篇阅读](https://www.iibc-global.org/toeic/test/lr/about/format/sample07_01.html) |
| `iibc-p7-multiple` | Part7；广告、购物车、邮件三篇关联五题 | [多篇阅读](https://www.iibc-global.org/toeic/test/lr/about/format/sample07_04.html) |
| `iibc-speaking` | Speaking；样题播放器。官方介绍明确有语音、参考回答及说明；播放器功能本轮未实播 | [口语样题](https://www.iibc-global.org/toeic/test/speaking/about/format/sampletest.html)、[功能与现行五类题型说明](https://www.iibc-global.org/english/toeic/test/speaking/about/format.html) |
| `ets-preparation` | 听读、口语写作的免费样题PDF和考生手册；同页收费课程不属免费内容 | [ETS备考中心](https://www.ets.org/toeic/test-takers/prepare.html) |
| `voa-budget-cuts` | 办公室话题，适配Part3/4技能；Conversation音频、逐字文字、视频、小测验 | [Budget Cuts](https://learningenglish.voanews.com/a/lets-learn-english-level-2-lesson1/3960391.html) |
| `voa-interview` | 面试对话，适配Part2/3及回应技能；音频、逐字文字、视频、小测验 | [The Interview](https://learningenglish.voanews.com/a/lets-learn-english-level-2-lesson-2/3960471.html) |
| `bc-new-team-member` | A1职场介绍，适配Part2/3；音频、Transcript、准备题、练习 | [Meeting a new team member](https://learnenglish.britishcouncil.org/free-resources/listening/a1/meeting-new-team-member) |
| `elllo-life-without-cars` | 原站标注B2自然对话，适配Part3/4理解；音频、Script、Quiz、Vocab | [Life Without Cars](https://elllo.org/english/1301/T1340-Jeremy-Car.htm) |
| `bc-passives` | B1–B2语法，适配Part5/6；解释和两轮互动练习 | [Passives](https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/passives) |

IIBC页面日文导航、英文试题；听力音频播放入口在原站。官方样题用于熟悉题型，数量有限。British Council与ELLLO可通过课程页继续选其他免费单元；VOA这两课也是系列课程的一部分。不要将它们算成本项目新增的模拟题数量。

## 许可与嵌入边界：保留能证明的范围

### ETS / IIBC：`link_only`

[IIBC官方听读格式页](https://www.iibc-global.org/english/toeic/test/lr/about/format.html)明确官方说明与样题版权归ETS，复制需要ETS许可。其短证据原句为：“may not be reproduced without the permission of ETS.” 官方公开免费练习并不等于开放题库。

[ETS当前许可申请页](https://www.ets.org/legal/permissions/how-to-request.html)要求先提交请求；明确不授予向公开或不安全网站复制材料的许可。认证学习平台可描述商业授权需求，这只是申请路径。LANTERN当前应只存标题、链接、自写说明及完成记录；不要抓题、转换音频、嵌入官方播放器、镜像PDF、放进Service Worker或PWA安装包。本轮没有取得额外许可。

### British Council：`link_only`

[Terms of use第10、14节](https://www.britishcouncil.org/terms)允许个人非商业使用并要求署名，但另站重刊、修改内容等需要事先书面批准。准确限制片段：“republish any British Council Content on another website”。第14节一般允许连到免费数字服务的文字链接，却限制复制进其他网站/产品及脱离课程上下文的内容直链。因此使用完整课程页面外链，不用音频URL热链或iframe来替代许可。

### ELLLO：`link_only`，课堂授权不能扩大成公开分发授权

[ELLLO官方FAQ](https://www.elllo.org/about/faq.htm)解释免费访问，不需账号或付费墙；说明教师可下载有下载入口的音频用于课堂或班级LMS。精确范围片段：“use it in their classrooms or on a class LMS like Moodle”。FAQ还列出无下载入口的音频申请方式及数量条件，视频不提供。该声明没有明确覆盖公开共享App中的批量重刊、改编、离线分发或播放器嵌入；本项目因此只链接原站课程页，不把它误标为Creative Commons资源。

### VOA：`redistributable`仅针对符合声明的独立制作资产

[VOA Terms of Use第1项](https://learningenglish.voanews.com/p/6021.html)称其独立制作的文字、音频与视频在公共领域，使用时应署名；同时明确其站点含仅获VOA节目使用许可的第三方素材，不能据此再分发。[Request Our Content](https://learningenglish.voanews.com/p/6861.html)也说明教育及商业再利用并要求注明来源，特别排除AP、Reuters、AFP等素材。两课有原站Conversation音频及逐字文字，适合作为下一步逐项审核的候选，不能一次将整站许可套给整页附件与图像。

`reuse:"redistributable"`描述这个有条件的来源政策；不代表本轮已核清所有资产。为避免字段被错误用于自动导入，两条均设`assetAudit:"required_before_import"`、`rehostApproved:false`、`integration:"external_link"`。准备导入时应为每份文字和音频分别保存原链接、作者/制作方、许可证据日期、第三方署名检查、修改说明、校审人及校审日期；只对白名单资产设置部署许可。可用署名：“Source: VOA Learning English — [具体课程页]；本项目练习题与中文说明为另行编写”。不要复制用户评论、通用页面素材、第三方照片或广告。

## 立即接入与持续扩展

1. 立即发布15个元数据卡片：以`target="_blank" rel="noopener noreferrer"`打开完整课程页，显示来源、题型、时长、是否有音频/原文和自写步骤。资源页无需抓取媒体。
2. 用户回到LANTERN后，按资源ID/标题、练习时长及自己的简短反思打卡。完成状态不冒充原站得分，也不把重复学习算作新试题。
3. 官方样题负责校准题型；VOA、British Council与ELLLO负责可重复选择的听读材料。复习时可轮换盲听、精听、听写、跟读和复述；后四项是学习活动，不属于新模考。
4. 下一批嵌入内容优先选择逐项核准的VOA独立制作文字/音频，并围绕素材新写可核验问题。未经真人校审保持AI辅助草稿标签。第三方原文与本项目原创问题分开记版权，不能统一盖一个代码许可证。
5. 分享的是LANTERN的代码、原创题与学习记录结构；所有`link_only`条目仍从原站学习。需要ETS或其他出版社内容时走具体授权路径，费用为零不自动改变许可范围。

## Team Cherry主题素材的相关官方证据

[Team Cherry FAQ](https://www.teamcherry.com.au/faq)分别说明游戏拥有者/媒体创作视频与直播，以及个人小批量原创同人商品的条件；后者明确不授权使用其游戏内或官方营销图像。原句片段：“we don’t give permission for anyone to use graphics from in the game or official marketing materials created by us”。

这里未找到一项覆盖TOEIC学习App中游戏角色、原画、图标、字体、配乐或精灵图分发的概括授权。“非商业”本身不足以把这些条目扩大到本项目。立即可做的主题方案是自制原创灯笼、洞穴、昆虫与探索世界的图形语言，保留原创名字和素材来源；具体借用游戏资产应另核准其适用授权。此处记录的是官方条款可见范围，不是对任何具体同人作品的法律判断。
