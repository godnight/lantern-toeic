# 微光托业 · 界面重设计 v1.1

> **用户视觉验收未通过；合入与部署暂停。** 用户最新反馈：“我看了下你这版本的设计，完全没有空洞骑士的元素了。先别合入了”。当前本地源码、HAP、截图与评审均保留。此前独立评审通过仅适用于其限定技术审查范围，不能等同用户视觉认可。中性日间/夜间主题继续不带 IP；空洞骑士和丝之歌主题需要重新讨论明确角色、场景和世界观辨识度。本次只同步暂停与验收状态，不启动重新实现、渲染或新一轮评审。


## 当前实施状态（2026-10-13）

v1.1 经[同一独立复验](reviews/FINAL-INDEPENDENT-RECHECK-v1.1.md)进入本地实现；共享 React 生产界面、最后修订及最终自动检查已完成。当前 474/474 + 34/34、类型检查、两种 Web 构建通过，最新 HAP 已与当前输入核对并仅在自有 QA 模拟器升级、启动和冷启动。

[同一独立最后复验](reviews/IMPLEMENTATION-INDEPENDENT-FINAL-RECHECK.md)确认 I04/I08 关闭且 I01/P1 未回退；限定源码范围无遗留实现缺陷。原生真实交互/文件选择器等缺项见[实施验收](../../testing/ui-redesign-20261013/ACCEPTANCE.md)；未推送、发布、手机安装或修改真实学习数据。

下文是设计交付时的 v1.1 冻结快照，待复验叙述和原 MANIFEST.json 保留作历史。v1.0 未通过报告、v1.1 审定原文和旧图片不覆盖；冻结 manifest 不作为当前生产实现或设备验收证明。

2026-10-13。**作者修订与三视角内部复核完成，待同一外部独立评审者复验；尚未终审通过。** v1.0 原报告保持：[FINAL-INDEPENDENT-REVIEW.md](reviews/FINAL-INDEPENDENT-REVIEW.md)。本交付为隔离设计方案，不是生产实现、部署或设备验收。

## 优先审阅

1. [完整设计规格](DESIGN-SPEC.md)：导航 / 首页 / 查词及详情 / 练习 / 复习 / 进度 / 资料 / 四主题 / 状态 / 字体留白 / 动效 / 可访问性 / 性能 / 实现合同。
2. [F01–F13 逐项响应](reviews/V1.1-RESPONSE.md)：四项原阻塞全部有具体补稿，作者响应完成，外部确认尚待；没有自行关闭问题。
3. [v1.1 页面与状态覆盖](V1.1-COVERAGE.md)：口语五类与全阶段、模考现行/旧制与练习媒体、资源/偏好/三备份/安装/来源/录音历史。
4. [交互原型](prototype/index.html)：独立 HTML/CSS/JS，可切换主题 / 页面 / 状态；文件直接打开也可运行。所有数据及保存返回为明确标注的合成示例，没有真实存储和媒体操作。
5. [核验记录](QA-v1.1.md)与[截图索引](screenshots/v1.1/INDEX.md)：实际亲见范围、连续流程、截图模式与设备验收限制。

## 四项阻塞的当前状态

| 原阻塞 | v1.1 具体响应 | 状态 |
|---|---|---|
| F01 口语流程不完整 | 五类材料与时间；准备→录音→处理→保存→回听/自评→打卡，失败回听/重试/下载/明确放弃与退出守卫；长稿及图片 | 作者响应完成，待外部复验 |
| F02 模考与练习媒体遗漏 | 题包目录、现行/旧制预检、完整LC音频、图片放大、单/多材料RC、手机答题卡、交卷/期限/退出失败、七Part结果及原记录解析；普通精听/听写/长文 | 作者响应完成，待外部复验 |
| F03 游戏主题辨识弱 | 普通页与预览固定48px门拱骨白/斜针丝环钟线，320/390仍可见；日/夜无IP；四主题用真实选中/成功/失败组件 | 作者响应完成，待外部复验 |
| F04 资源和设置功能遗漏 | 三种现有真实资料来源详情/步骤/访问说明/打卡与统计；目标考期等实际偏好字段；三类备份、安装与来源、录音历史 | 作者响应完成，待外部复验 |

## 代表性视觉稿

| 稿面 | 桌面 | 手机 / 中间宽度 |
|---|---|---|
| 四主题首页 | [日](screenshots/v1.1/desktop-home-day.jpg) / [夜](screenshots/v1.1/desktop-home-night.jpg) / [空洞骑士](screenshots/v1.1/desktop-home-hollow.jpg) / [丝之歌](screenshots/v1.1/desktop-home-silk.jpg) | [日间](screenshots/v1.1/mobile-home-day.jpg) / [320空洞](screenshots/v1.1/game-320-hollow.jpg) / [320丝之歌](screenshots/v1.1/game-320-silk.jpg) |
| 查词结果 / 详情 | 原 v1.0 双列稿保留 | [390首屏](screenshots/v1.1/search-390-compact.jpg) / [空结果](screenshots/v1.1/search-empty.jpg) / [长词](screenshots/v1.1/search-long.jpg) / [840详情](screenshots/v1.1/search-detail-840.jpg) |
| 练习 / 复习 / 进度 | [练习](screenshots/v1.1/desktop-practice-day.jpg) / [进度](screenshots/v1.1/desktop-progress-day.jpg) | [词卡失败](screenshots/v1.1/mobile-card-save-error.jpg) / [长文](screenshots/v1.1/mobile-practice-long.jpg) / [听写](screenshots/v1.1/mobile-practice-dictation.jpg) |
| 口语 | [五类目录](screenshots/v1.1/desktop-speaking-directory.jpg) / [图片](screenshots/v1.1/desktop-speaking-picture.jpg) / [保存中](screenshots/v1.1/desktop-speaking-saving.jpg) | [失败恢复控件](screenshots/v1.1/mobile-speaking-save-error-recovery.jpg) / [放弃确认](screenshots/v1.1/mobile-speaking-discard.jpg) / [历史](screenshots/v1.1/mobile-speaking-history.jpg) |
| 模考 | [目录](screenshots/v1.1/desktop-exam-directory.jpg) / [三材料](screenshots/v1.1/desktop-exam-multireading.jpg) / [七Part结果](screenshots/v1.1/desktop-exam-seven-parts.jpg) | [LC](screenshots/v1.1/mobile-exam-listening.jpg) / [答题卡](screenshots/v1.1/mobile-exam-answer-card.jpg) / [交卷确认](screenshots/v1.1/mobile-exam-submit.jpg) / [退出失败](screenshots/v1.1/mobile-exam-exit-error.jpg) / [旧制预检](screenshots/v1.1/mobile-exam-legacy-precheck.jpg) |
| 资料 / 设置 | [资料库](screenshots/v1.1/desktop-library-day.jpg) / [三备份](screenshots/v1.1/desktop-backups.jpg) / [来源](screenshots/v1.1/desktop-about.jpg) | [偏好](screenshots/v1.1/mobile-preferences.jpg) / [BC详情](screenshots/v1.1/mobile-resource-bc-detail.jpg) / [打卡成功](screenshots/v1.1/mobile-resource-bc-saved.jpg) |
| 四主题真实状态预览 | 同一结构与业务状态 | [320完整画板](screenshots/v1.1/theme-preview-320-full.jpg) / [390完整画板](screenshots/v1.1/theme-preview-390-full.jpg) / [390真实首屏](screenshots/v1.1/theme-preview-390.jpg) |

完整画板使用手机宽度和扩展画板高度，不当作手机首屏。部分长页面截图是实际844px视口片段；索引区分，不用截图冒称实时录音、网络、持久化或设备通过。

## 评审、历史及落地边界

[视觉](reviews/visual-v11.md)、[学习/搜索](reviews/learning-v11.md)、[工程/可访问性](reviews/engineering-v11.md)独立记录不同意见与修订证据。[v1.0完整快照](versions/v1.0/README.md)和[draft](drafts/DESIGN-SPEC-v1.0.md)保留，原未通过意见没有被删改。默认日/夜完全移除固定IP素材；游戏主题自洽的原创形状只出现在普通壳与预览，学习题面安静。

主题切换只更新theme，不用默认profile覆盖目标。保持旧ID、首答/复练、原模考截止与题型、账号与原生本机边界。标记/计划编辑/学习JSON恢复UI并未交付，维持现有范围；损坏快照与录音ID一致性风险只记建议，本改版不迁移或清理用户数据。

浏览器、HarmonyOS 7 模拟器、Pura X Max真机验收分开。真实设备最终覆盖内外屏、录音、后台及升级保留，不把browser nativeMode算真机。用户已请求后续实现，同一独立复验通过后继续原授权，不再索取泛化批准；本阶段无上传、发布、推送、合并、安装或数据整改。

正式归档：`vocab-work/theme-redesign-20261012/site/docs/design/ui-redesign-20261013/`。来源Sites HEAD `12317b26b85a71888760b0cc18242d00a843ac74`，GitHub #45堆叠于#43/#42，不能假定另一个main包含全部。完整文件哈希见[MANIFEST.json](MANIFEST.json)。本地压缩包可供传递，但本阶段没有上传。
