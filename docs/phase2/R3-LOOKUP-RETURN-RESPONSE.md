# P2-r3 · 就地查词详情返回修复

r2独立QA的 `P2-TAP-03` 仍为FAIL；原报告、源输入、源码／Web／资源ZIP及HAP全部保留。新候选只修统一Lookup返回边界，不关闭QA记录，不改学习事实或媒体管线。

## 复现与根因

按QA步骤建立每日1新词／目标8／7学习日计划，认识document并确认已揭义，点例句document，等待精确词典结果加载，进入详情并显式加入今日复习。一次Escape后详情消失，Lookup仍为结果列表；开发固定r2输入的隔离浏览器同样复现。加入候选未生成review／Attempt／Checkin。

`VocabularyLibrary` 原有独立词库语义为详情→列表→来源：窄屏详情另写 `lanternVocabularyView` 历史项，Escape的capture监听先阻断事件并恢复列表，优先级30的NativeBack也走相同分支。详情历史继承外层Lookup token，BrowserBack因而先落回同一Lookup列表。合同§6要求整个就地Lookup只有一层关闭边界，这些内部返回不应抢占它。

## 最小修改

为词库组件增加显式 `navigationBoundary='library'|'lookup'`，默认 `library` 保留独立词库／全局查词原行为；仅例句和题目解析中的外层Lookup传 `lookup`。

- 外层仍是唯一Lookup历史项的所有者。嵌入详情不写第二个历史项，也不拦截／重建内部pop；BrowserBack由外层现有controller关闭一次。
- 嵌入列表和详情的Escape／NativeBack统一调用外层返回；原视图保持挂载，外层恢复原滚动和触发词焦点。关闭时不安排内部列表的后续聚焦帧。
- 外层Dialog的关闭自动聚焦显式交给原视图恢复。开发浏览器曾发现程序化NativeBack映射后Radix卸载聚焦将触发词覆盖为BODY，故在关闭自动聚焦回调取消默认行为、按保留的来源恢复焦点／滚动；不依赖一次提前的动画帧碰巧胜过卸载。
- 显式“返回结果”仍仅恢复查询、结果范围、Dialog内滚动及原结果焦点，Lookup保持打开；这不是系统返回或关闭动作。
- 合成输入期间的Escape与被遮罩底层词库仍不消费返回；详情聚焦保持，独立词库的词卡自测／详情历史保持。

版本码20012用于区分新可安装内容，版本名仍0.3.4。未改DB／备份schema、旧key／owner／ID、自评映射、候选保存、计数／Checkin、模考／截止或音频。

## 交独立复测

以外层 `DELIVERY-P2-r3.json` 的准确commit、源输入、Web／共享资源／同HAP为准。至少在两主题的列表和已加载详情中分别验证一次Escape、BrowserBack、指定模拟器系统Back；加入候选后关闭应回原卡，不重记事实，候选保留一次，原词序／已保存反馈／选择／滚动／触发词焦点保持。显式“返回结果”应仍在Lookup内，之后一次系统返回才关闭；连续开关和BrowserForward不得遗留幽灵详情或多消费原学习历史。

还应验证普通题提交后的解析点词、独立全局查词的默认两步返回及原生IME组成状态。开发Chrome的NativeBack注册器映射只证明共享JS返回链，不能代替ArkWeb系统Back。r2已通过的进度／升级／重复恢复按各自原版本证据保留，不能自动给新候选整版放行；本次不扩范围实施旧Study导入UI或新音频。

保留已通过的真实IME顺序：键盘可见时第一次系统返回只收键盘、Lookup仍在，键盘收起后再返回才关闭Lookup。本次没有修改鸿蒙宿主／键盘配置／Native桥或IME composition守卫；独立模拟器仍须按此先后顺序复测，不能用开发JS映射替代第一步。

独立复测通过前不push。没有合入、部署、手机安装或修改用户学习数据。
