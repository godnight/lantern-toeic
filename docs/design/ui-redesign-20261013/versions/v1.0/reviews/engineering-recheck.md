# 微光托业重设计：工程 / 无障碍修订复核

日期：2026-10-13。承接 `engineering-round2.md` 的发现记录。审查方式：重新读取当前 `prototype/design.css` / `design.js` / `DESIGN-SPEC.md`，用 `view_image` 检视更新图片；不操控共享 browser / server。

**结论：第二轮主要 P1 代表稿问题已收敛，可以将当前设计交付父会话追加独立评审。** 这一结论是设计阶段复核，不是批准发布、生产可访问性符合性声明或真实数据 / 设备验收。正式实施仍须接入现有保存、账号、返回和媒体控制器，不能把独立 HTML 的 fixture handler 直接当业务实现。

## 本轮独立检查证据

审查时文件快照：`design.js` 57,296 字节（11:42:37），`design.css` 31,155 字节（11:39:33）；时间为本机显示时间，后续改动以最新文件为准。

实际查看更新图：

- `screenshots/four-theme-home.jpg`：四卡结构一致，游戏纹样缩为标题边缘小图，标题不再竖排，默认日 / 夜无游戏元素；失败底色也与主操作区分。
- `screenshots/desktop-exam-silk.jpg`：所有尺寸的专注模式隐藏侧栏 / 顶栏，只保留会话退出与作答，避免全局导航直接绕过保存保护的呈现。
- `screenshots/mobile-search-long-night.jpg`：查词详情没有查询工具条 / 底栏；长词可断行，长中文释义和来源完整纵向阅读，返回结果入口明确。
- `screenshots/mobile-exit-modal.jpg`：退出说明分清已提交答案、未提交选项 / 题组位置、完组时间打卡；继续作答焦点样式可见。

## 已关闭的第二轮问题

| 原问题 | 当前复核结果 |
|---|---|
| 专注桌面侧栏 / 设置可直跳 | `.focus-mode .sidebar,.focus-mode .topbar{display:none}` 为全局规则，`.app` 改单列；最新模考截图无全局导航。真正保存控制器仍待生产接入 |
| 四主题比较 SVG 占屏 | motif 固定48×48 px且不收缩，比较标题不换竖排；最新图符合四主题同布局意图 |
| loading 清空 query | `searchContent` 仅 initial / input / empty / related 指定示例值，loading 使用当前 query；静态状态不再将加载当清空 |
| off 开关用 divider作状态 | 56×44 px 外命中区；视觉轨道 surface2、thumb muted、control border；关闭态识别对比改善，见下面数值 |
| 移动 icon / arrow过窄 | 新规则给 topbar iconbtn和task arrow `min-width:44px;min-height:44px`；min-width覆盖较早40px width，不把视觉图标当命中区 |
| 主题语义不统一 | 原型 themegrid现有role=group及“选择界面主题”名称，主题卡aria-pressed；可作为按压按钮组。规格中的radio文案尚需同步为同一决定 |
| 收藏无状态 / 移除不可达 | add按钮通过当前状态补aria-pressed；加入后出现“移出生词本”，动作不删除旧学习记录。仍是演示Set，不证明真实持久化 |
| 结果摘要无状态 | result-label补role=status、aria-live=polite；既定empty / loading / error分别有status / alert，输入composition处理仍保留 |
| 关闭modal / 选题 / 主题 / 结果返回失焦 | 后置handler按稳定data-action / data-option / data-word恢复焦点；Escape加requestAnimationFrame恢复退出触发处。源码存在恢复策略；独立浏览器/辅助技术体验未测 |
| 解析→查词丢来源 | searchOrigin保留page/state/scroll，屏内return-origin恢复原页状态；与query / detail返回形成不同层级。尚无真实history popstate / Native Back控制器 |

## 关闭态开关的数学复核

新off thumb / track是`muted / surface2`，依据当前实际token，四主题分别 **4.947 / 6.263 / 6.557 / 6.374 : 1**；control / surface2分别 **3.228 / 3.532 / 3.844 / 3.890 : 1**。与旧divider方案的thumb/track约1.3–1.7相比，现有状态线索达到既定3:1门槛。计算范围是这些不透明颜色组合，不是整页或全部状态已通过。

阈值依据 [W3C SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。44 px命中区是项目建议；[WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) 的AA最低目标与间距例外另判，不应混写。

## 剩余轻量呈现收尾

1. `DESIGN-SPEC.md` 7.3在本次读取时仍写“radio语义”，须同步为原型已选用的pressed按钮组；不要在实施时凭个人判断再改变模式。
2. 手机settingrow / theme-card仍有11–12 px辅助说明。预算、来源、保存边界等正式必要信息按既定13–14 px统一；评审工具条和品牌细字不必与正式正文等同。
3. 自动输入过滤到零结果的动态分支仍应添加polite status；不要只给评审下拉菜单选出的empty fixture添加语义。范围按钮容器可加group及label，避免generic div的aria-label不可识别。
4. 正式词条标题、IPA、英文例句保留`lang="en"`；原型词头目前无语言属性。源应用已有部分lang标记，重设计不可丢掉。
5. 桌面列滚动在原型仍为整页内容布局。规格如继续要求列表 / 详情独立滚动，实施时必须明确列高、焦点可见与两列position恢复；若选择整页滚动，应同步规格。它是UI取舍，不是新增后台接口。

这些不要求给演示原型接入真实网络或存储，也不改变本轮范围。采用生产组件后应在实际树中重新核对，避免多轮HTML字符串补丁残留到产品。

## 正式实施仍需要的控制器适配

- **查询与返回状态**：owner-scoped query / mode / category / filter / limit / selectedWord / position / origin状态，真实浏览器history与Native Back；通过详情、关联练习、设置回返时保持语境，账号切换清除旧上下文。原型replaceState / 屏内返回不是完整路由实现。
- **字典与收藏**：15.6 MB真实字典按需加载、SHA/count校验、模型精确 / 前缀 / 词内 / 次义 / 词形 / 多词AND排序；24条批次显示；保留生词取消、到期筛选、旧ID和独立备份。真实mark/review返回成功后才更新计数 / 跳卡。
- **学习退出**：普通首答 / 复练与时间打卡分别保存；模考沿现有FIFO / revision / interrupted保存且失败留页、截止不变；录音保存 / 权限 / 后台生命周期沿原控制器。隐藏导航只是防误操作的布局，不取代代码guard。
- **主题**：paper / crystal / hollow / silk持久化ID与day / night样式别名适配；theme-only原子更新，保留目标、时区和已关闭动效，不重挂当前学习会话或重建大字典索引。
- **可访问与跨端**：正式Dialog / RadioGroup / Select焦点管理、modal背景隔离、结果status、错误关联、正确/错误文字、文字放大、320px重排；真实ArkWeb软键盘、中文IME、折叠布局、屏幕阅读和原生Back另验。

无新的后端schema或认证扩张需求。所有演示计时、成功、同步和收藏只用于审阅；题包 / 学习数据 / 账号隔离仍沿用已核实生产能力。

## 证据边界

根代理报告已通过Cua手测“中文日程→详情→返回（query仍日程、焦点原结果）”“解析→查词→返回解析”“取消退出→焦点退出按钮”。这是根代理的交互报告；我本轮独立核实的是源代码与上述4张截图，没有重复操控共享browser，不能将其写成我的设备实测。

本轮未调用API、学习存储或麦克风，未操作真机、网络、部署、Git推送/合并，也未停止任何任务。只写本独立复核文件。正式实施和父会话终审仍待后续阶段。
