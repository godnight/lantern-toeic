# 实现截图证据索引

当前归档 53 张已有截图。尺寸/SHA-256 逐文件解析；精确哈希与 UTC 文件时间见 [evidence-index.json](evidence-index.json)。

图片像素与 CSS 视口分列：CUA 返回图片可能缩放、扣除滚动条，不能用图片尺寸推定字号或触控大小。CSS 高度“未留存”表示归档缺少独立实测值，不补猜测。所有截图均为本机 Chrome；一般界面来自 41881，合成模考来自隔离 41883。

`sample` 表示所述有限样本；`historical-limited` 仅保留明确旧行为；`excluded` 排除其错误标注或修订前状态；`fixture-seam-only` 仅记录装载/默认视口；`unclassified` 等待实际范围，不作为通过依据。

| 文件 | 图片像素 | 已核实 CSS 视口 | 范围与限制 | 状态 / 替代 |
|---|---|---|---|---|
| [checkin-silk-390.jpg](screenshots/checkin-silk-390.jpg) | 390×844 | 390×未留存 | 完成练习后的打卡表单；没有提交此打卡分钟。 | sample |
| [home-day-1440-final.jpg](screenshots/home-day-1440-final.jpg) | 1425×990 | 1440×1000 | 最终冻结后默认日间真实 StudyWorkspace 首页；scrollY0，4 次 Part6 首答/1 启动/0 已记分钟，原生本机模式；无 IP 素材。 | sample |
| [home-day-1440.jpg](screenshots/home-day-1440.jpg) | 1424×1231 | 1440×未留存 | 默认日间首页；初始 QA 数据为零。完整页面图片，仅证明布局与无 IP 素材策略。 | sample |
| [home-hollow-1440-viewport.jpg](screenshots/home-hollow-1440-viewport.jpg) | 1425×990 | 1440×1000 | 空洞骑士普通首页；48px 原创意象；图片由工具缩放。 | sample |
| [home-hollow-320-verified.jpg](screenshots/home-hollow-320-verified.jpg) | 305×804 | 320×844 | 空洞骑士首页；移动标题/主按钮/原创意象实际测量。 | sample |
| [home-night-1440-verified.jpg](screenshots/home-night-1440-verified.jpg) | 1425×990 | 1440×1000 | 默认夜间首页；QA 过程后 4 首答/1 启动/0 已记分钟；无 IP 素材。 | sample |
| [home-night-1440-viewport.jpg](screenshots/home-night-1440-viewport.jpg) | 1157×1000 | 未留存×未留存 | 旧取证尝试；图片 1157×1000，无法据此证明 1440 普通视口；排除尺寸/字号/控件验收。 | excluded → [home-night-1440-verified.jpg](screenshots/home-night-1440-verified.jpg) |
| [home-silk-320-verified.jpg](screenshots/home-silk-320-verified.jpg) | 305×804 | 320×844 | 早期丝之歌首页，原创意象可见；标题仍为修订前 26px，不代表最新 28px 标题验收。 | historical-limited → [home-hollow-320-verified.jpg](screenshots/home-hollow-320-verified.jpg) |
| [home-silk-320-viewport.jpg](screenshots/home-silk-320-viewport.jpg) | 1440×1000 | 1440×1000 | 文件名错误；超时旧捕获恢复到桌面视口，不能作为丝之歌 320px 证据。 | excluded → [home-silk-320-verified.jpg](screenshots/home-silk-320-verified.jpg) |
| [mock-answer-grid-fixture-day-320.jpg](screenshots/mock-answer-grid-fixture-day-320.jpg) | 305×804 | 320×844 | 真实展开的答题卡局部；5列，当前/已答/未答状态。 | sample |
| [mock-catalog-day-390.jpg](screenshots/mock-catalog-day-390.jpg) | 375×812 | 390×未留存 | 实际模考目录空态；普通应用组件，未装载 fixture。 | sample |
| [mock-catalog-with-fixture-day-1440.jpg](screenshots/mock-catalog-with-fixture-day-1440.jpg) | 1263×1247 | 1278×1262 | QA 模考目录与两条 fixture 记录；新页默认视口，不作为 1440 响应式证明。 | fixture-seam-only |
| [mock-first-saved-a-fixture-day-320-fixed.jpg](screenshots/mock-first-saved-a-fixture-day-320-fixed.jpg) | 305×804 | 320×844 | 原首答147 A checked、fieldset disabled；A 浅红错误面/危险色边框，D 中性正确面/成功色边框与勾，文字共同区分正确错误。 | sample |
| [mock-first-saved-a-fixture-day-320.jpg](screenshots/mock-first-saved-a-fixture-day-320.jpg) | 305×804 | 320×844 | 原首答147保存 A 的只读答案；与复测 B 独立；错误语义颜色修订前。 | excluded → [mock-first-saved-a-fixture-day-320-fixed.jpg](screenshots/mock-first-saved-a-fixture-day-320-fixed.jpg) |
| [mock-jump-focus-fixture-day-320.jpg](screenshots/mock-jump-focus-fixture-day-320.jpg) | 305×804 | 320×844 | 答题卡选147后，已保存 B 且聚焦对应题目 article；不代表普通上一/下一题滚动策略改变。 | sample |
| [mock-rc-multiple-fixture-day-1440-verified.jpg](screenshots/mock-rc-multiple-fixture-day-1440-verified.jpg) | 1425×990 | 1440×1000 | RC 第176题多篇材料局部；材料1末段与材料2开头；保留同材料内位置。 | sample |
| [mock-rc-multiple-fixture-day-320.jpg](screenshots/mock-rc-multiple-fixture-day-320.jpg) | 305×804 | 320×844 | 320px 多篇材料中段；流式单列；不是完整题组页头/题目。 | sample |
| [mock-rc-single-fixture-day-1440-verified.jpg](screenshots/mock-rc-single-fixture-day-1440-verified.jpg) | 1425×990 | 1440×1000 | RC 单篇真实组件三列：材料/题目/答题卡；已保存 3/200，原截止不重置。 | sample |
| [mock-rc-single-fixture-day-1440.jpg](screenshots/mock-rc-single-fixture-day-1440.jpg) | 1263×1247 | 1278×1262 | 早期 RC 单篇默认视口，文件名 1440 错标。 | excluded → [mock-rc-single-fixture-day-1440-verified.jpg](screenshots/mock-rc-single-fixture-day-1440-verified.jpg) |
| [mock-reading-header-fixture-day-320-verified.jpg](screenshots/mock-reading-header-fixture-day-320-verified.jpg) | 305×804 | 320×844 | RC 页头；3 已保存，原截止显示 17:04:02，截图时剩余 37:03；计时持续推进。 | sample |
| [mock-results-fixture-day-320.jpg](screenshots/mock-results-fixture-day-320.jpg) | 305×804 | 320×844 | 复测结果上段：正确 1/200、197 未答。83:15 来自合成恢复时间线，不是实际前台考试时长。 | sample |
| [mock-retake-saved-b-fixture-day-320.jpg](screenshots/mock-retake-saved-b-fixture-day-320.jpg) | 305×804 | 320×844 | 原复测147保存 B 的只读答案；错误项/解析仍为修订前中性 selected 配色。 | historical-limited → [mock-first-saved-a-fixture-day-320-fixed.jpg](screenshots/mock-first-saved-a-fixture-day-320-fixed.jpg) |
| [mock-seven-part-table-fixture-day-1440.jpg](screenshots/mock-seven-part-table-fixture-day-1440.jpg) | 1425×990 | 1440×1000 | 滚动取证位置错误，未完整展示七 Part 表；排除七行完整证明。 | excluded → [mock-seven-part-table-fixture-day-1440x1300.jpg](screenshots/mock-seven-part-table-fixture-day-1440x1300.jpg) |
| [mock-seven-part-table-fixture-day-1440x1300.jpg](screenshots/mock-seven-part-table-fixture-day-1440x1300.jpg) | 1425×1286 | 1440×1300 | 完整七 Part 结果表真实视口；table y476.6、h643，全部七行在截图内。 | sample |
| [mock-seven-part-table-fixture-day-320.jpg](screenshots/mock-seven-part-table-fixture-day-320.jpg) | 305×804 | 320×844 | 结果表表头与前几行局部；246px 容器内 334px 宽表格可横向滚动；不能代表七行全部可见。 | sample |
| [mock-submit-fixture-day-320.jpg](screenshots/mock-submit-fixture-day-320.jpg) | 320×844 | 320×844 | 提交确认；3 已答+197 未答=200；确认期间计时继续。 | sample |
| [mock-wrong-analysis-fixture-day-320-fixed.jpg](screenshots/mock-wrong-analysis-fixture-day-320-fixed.jpg) | 305×804 | 320×844 | 错误解析卡视口；危险色与“你的答案 A / 回答错误 / 正确答案 D”文字共同反馈。 | sample |
| [practice-exit-silk-390.jpg](screenshots/practice-exit-silk-390.jpg) | 390×844 | 390×未留存 | 练习退出确认弹层；取消保留练习/详情。 | sample |
| [practice-part6-silk-390.jpg](screenshots/practice-part6-silk-390.jpg) | 390×844 | 390×未留存 | 实际 Part6 材料末段及作答区域；不是题组从顶部的完整材料图。 | sample |
| [preferences-silk-320-fixed.jpg](screenshots/preferences-silk-320-fixed.jpg) | 320×844 | 320×844 | 丝之歌偏好弹层；修订后字段为实心卡面，输入字号 16px，关闭 44×44px。 | sample |
| [preferences-silk-320-verified.jpg](screenshots/preferences-silk-320-verified.jpg) | 320×844 | 320×844 | 字段实心卡面/边框修订前历史图，不能作为当前控件对比度证据。 | excluded → [preferences-silk-320-fixed.jpg](screenshots/preferences-silk-320-fixed.jpg) |
| [progress-day-390.jpg](screenshots/progress-day-390.jpg) | 375×812 | 390×未留存 | 进度页首段；真实隔离 QA 的 4 首答/1 启动/0 录音/0 已记分钟。 | sample |
| [qa-fixture-loader-1440.jpg](screenshots/qa-fixture-loader-1440.jpg) | 1278×1262 | 1278×1262 | 可见 QA 装载页；新页默认视口 1278×1262，文件名 1440 错标；仅证明隔离 seam/合成数据告知。 | fixture-seam-only |
| [resource-detail-day-390-fixed.jpg](screenshots/resource-detail-day-390-fixed.jpg) | 375×812 | 390×未留存 | 资料详情主视图顶部；步骤与访问说明上段；不代表底部全部来源/按钮验收。 | sample |
| [resource-detail-day-390.jpg](screenshots/resource-detail-day-390.jpg) | 375×812 | 390×未留存 | 文件标签错误，实际仍是目录首段；排除详情证明。 | excluded → [resource-detail-day-390-fixed.jpg](screenshots/resource-detail-day-390-fixed.jpg) |
| [resource-detail-lower-hollow-1440.jpg](screenshots/resource-detail-lower-hollow-1440.jpg) | 1440×1000 | 1440×1000 | B1–B2 被动语态资料详情桌面两列：左步骤/访问条件＋右动作，侧导航不计内容列；scrollY0。按步骤、免费访问/条款、打开材料/学完记一笔均可见；不证明手机底部。 | sample |
| [resource-detail-lower-hollow-390.jpg](screenshots/resource-detail-lower-hollow-390.jpg) | 1440×1000 | 1440×1000 | 错标手机文件；与 -1440.jpg 字节完全相同。真实为桌面内容两列，不作为 390px 底部证明。 | excluded → [resource-detail-lower-hollow-1440.jpg](screenshots/resource-detail-lower-hollow-1440.jpg) |
| [resources-day-390.jpg](screenshots/resources-day-390.jpg) | 375×812 | 390×未留存 | 资料库目录首段与分类；真实 15 个资源。 | sample |
| [review-day-390-fixed.jpg](screenshots/review-day-390-fixed.jpg) | 375×812 | 390×未留存 | 复习页首段；词卡/题目模块 24px 间隔，状态标签 13px；不是全部队列状态。 | sample |
| [review-day-390.jpg](screenshots/review-day-390.jpg) | 375×812 | 390×未留存 | 词卡/题目复习缺留白及 11px 状态修订前历史图。 | excluded → [review-day-390-fixed.jpg](screenshots/review-day-390-fixed.jpg) |
| [search-silk-390-detail.jpg](screenshots/search-silk-390-detail.jpg) | 390×844 | 390×未留存 | 单词详情；释义与关联练习入口；查询结果不自动形成复习记录。 | sample |
| [search-silk-390-empty.jpg](screenshots/search-silk-390-empty.jpg) | 375×812 | 390×未留存 | 无结果状态；测试查询为 zzzz-no-word-qa；不是网络失败状态。 | sample |
| [search-silk-390-initial.jpg](screenshots/search-silk-390-initial.jpg) | 375×812 | 390×未留存 | 查词初始页；独立搜索主视图。 | sample |
| [search-silk-390-results-fixed.jpg](screenshots/search-silk-390-results-fixed.jpg) | 375×812 | 390×未留存 | reservation 结果列表局部，scrollY≈277；精确/相关标签回到词头同一行右侧；未包含完整搜索页头。 | sample |
| [search-silk-390-results.jpg](screenshots/search-silk-390-results.jpg) | 375×812 | 390×未留存 | 结果标签换行修订前历史图。 | excluded → [search-silk-390-results-fixed.jpg](screenshots/search-silk-390-results-fixed.jpg) |
| [settings-silk-320-verified.jpg](screenshots/settings-silk-320-verified.jpg) | 305×804 | 320×844 | 320px 主题设置上段与首张主题卡；不能单图代表所有四主题完整组件状态。 | sample |
| [source-return-day-390.jpg](screenshots/source-return-day-390.jpg) | 375×812 | 390×未留存 | 从资料库底部查词后返回原位置的视图；这是页面底部导出入口，非资源详情。滚动值在流程记录/probe分别说明，不从图片推断。 | sample |
| [speaking-catalog-day-390.jpg](screenshots/speaking-catalog-day-390.jpg) | 375×812 | 390×未留存 | 口语题型目录上段；未包含全部五类，未启用麦克风。 | sample |
| [speaking-information-day-390.jpg](screenshots/speaking-information-day-390.jpg) | 390×844 | 390×未留存 | 口语信息题 45s 准备/15s 回答的初始主视图；未录音。 | sample |
| [speaking-information-day-840.jpg](screenshots/speaking-information-day-840.jpg) | 840×1000 | 840×1000 | 840px 口语信息题初始主视图；未录音/未验证折叠设备。 | sample |
| [themes-game-states-hollow-1440.jpg](screenshots/themes-game-states-hollow-1440.jpg) | 1425×990 | 1440×1000 | 主题页滚动 658.7px；空洞骑士与丝之歌两张完整组件状态预览。 | sample |
| [themes-night-1440-verified.jpg](screenshots/themes-night-1440-verified.jpg) | 1425×990 | 1440×1000 | 默认日间/夜间完整真实组件预览；游戏主题仅上段。 | sample |
| [training-day-390.jpg](screenshots/training-day-390.jpg) | 375×812 | 390×未留存 | 训练页目录；听读与口语入口。 | sample |

模考 fixture 为合成 200 题、32×24 PNG 与 20 秒静音 WAV，只有 UI/记录边界验证意义。普通 JSON 文件选择器仍因 Chrome 扩展缺少本地 file URL 权限被阻塞；可见 QA seam 成功不等于文件选择器成功。原始截止 2026-10-13T09:04:02.945Z 没有重置。

当前截图未覆盖真实录音失败恢复/录音历史、全部加载与错误态、真实 OS IME、200% 放大/文本间距、完整 45 分钟听力和 75 分钟阅读、原生返回全链路、折叠屏/系统文件选择器与覆盖安装保数据。相关受控测试或历史设备报告有独立范围，不由这些图片推断通过。
