# v1.1 实际实现独立代码审查

日期：2026-10-13。对象：`vocab-work/theme-redesign-20261012/site`，分支 `feat/ui-redesign-v11`，HEAD `12317b26b85a71888760b0cc18242d00a843ac74` 加当前未提交改动。代码仍由集成负责人修改；以下是读取时观察，修复后需更新收尾记录。

本审查只读 AGENTS、README、PROJECT_STATUS、TEAM、CODEX_HANDOFF、IMPLEMENTATION-BASELINE、原 v1.1 独立终审复验、实际 TSX/CSS/model/hook 和相关测试。只在此独立目录写报告；未启动浏览器、服务器、构建、模拟器或设备，也未修改生产代码。没有把模拟 Hook/媒介适配器等同 ReactDOM、真实麦克风、原生文件下载或真实 IME 验收。

## 最新收尾 · 交卷反馈与账号壳投影 · 2026-10-13 08:50 UTC

**C01–C09均已在代码/受控证据范围关闭；IV05限定代码修订通过；本审查当前无未修P1/P2、无待审批。** 实际像素、Chrome、ArkWeb、下载及设备体验仍按Root与独立视觉证据验收，本报告不代领这些验收。

IV05来自独立视觉的实际错答截图：原交卷后选项仍沿用绿色selected。已只改QuestionBody的展示class、文字、图标与mock CSS；已保存错选用danger/danger-soft，正确选项用success及表面底色，漏答反馈用warning。正确答案和“你的答案 · 回答错误”文字可在非颜色情况下区分；radio checked仍仅对应已保存选择。未提交保留普通selected，full question传入时仍不能暴露答案/解析。未改saved attempt、FIFO、revision、计时或结果计算。

[完整模考回归](./ui-redesign-exam.test.cjs)现**22/22通过**（原18项+4项真实QuestionBody渲染），覆盖wrong/correct/unanswered及未提交full-question防泄露，并保留“已保存A + 暂选B仍显示A”的断言。详见 [EXAM-FEEDBACK-TEST-RESULTS.md](./EXAM-FEEDBACK-TEST-RESULTS.md)。Mock源SHA `6D936837D7EC09275AEF4433610BAE5EDB2712A65C0259F6F36B69AB3F3270D7`；最终CSS SHA `5F20D9F86A99BAFCADB724B1B69C727865FFBC940FECEC7F295F8C3065D7FA71`。

C09的实际hook探针证明Alice→Bob首个render时ready=true、recordsReadable=false但data仍Alice，Root原壳会显示Alice昵称、复习徽标1及silk。Bob未来schema读失败effect后变EMPTY/0；没有证据称失败后持久显示Alice。Root现将storedData只在ready且readable时投影，未读/不可读使用EMPTY_DATA；壳显示“正在读取记录”/“记录暂不可读”，不渲染旧复习徽标，profile/due/document theme派生也使用安全投影。这只影响UI展示，不清除、迁移或持久化EMPTY_DATA。

[账号壳探针结果](./probe-owner-shell-result.json)08:48:17通过；[自包含可集成回归](./ui-redesign-owner-shell.test.cjs)**2/2通过**，执行真实useStudy、Root、WorkspaceShell与Root主题effect：正常Alice原昵称/徽标1/silk保留，首切Bob/失败/loading均中性身份、无徽标、paper，零存储写入。详见 [OWNER-SHELL-TEST-RESULTS.md](./OWNER-SHELL-TEST-RESULTS.md)。Root SHA `60257409A413BB46DF38B14A814224360C81B2C299BAAE5DFCFA2351BB7190AC`。加载case是显式blocked旧data投影；首切case则由真实hook产生，区分已在夹具与报告中保留。

可由Root直接集成staging的两份测试文件；prepare/probe辅助留此目录。没有生产修改、服务器/设备/真实用户存储动作或发布。

## 上一轮收尾 · 模考答题卡跳题 · 2026-10-13 08:21 UTC

**C08已修，当前本代码审查无未修P1/P2。** Root实际Chrome发现RC答题卡选择保存成功后仍停在卡片位置；这属于Root运行发现，不代领本代理浏览器复现。

独立核对EX10的“返回当前题”和EX09的同组切题位置：Root将 `select(number,fromCard=false)` 的定位仅用于答题卡true入口，普通上一/下一保持位置。成功后rAF精确定位对应question number的`.mock-question`并focus；原session/attempt.id再次守卫，失败/卸载/同owner换记录时旧frame不能移动新视图。已有材料锚点只定位当前article里的材料；不改FIFO/revision/deadline/交卷快照。

[完整模考回归文件](./ui-redesign-exam.test.cjs)保留15项、增加3项，**18/18通过**。新项验证成功后paint才定位、失败保持完整attempt/期限/答案且不query/focus、同owner不同attempt同题号的旧frame在DOM查询前被挡及owner卸载后不作用。详见 [EXAM-FOCUS-TEST-RESULTS.md](./EXAM-FOCUS-TEST-RESULTS.md)。Root真实320卡格/定位/材料返回结果单独归档；这里仍是实际TSX/模型的受控repository+Hook/DOM+rAF。

MockExam核验SHA `844F8F50A1A32EA64201B64C31259D6D034C299AAF5FBB63E42C647CDCDDCFBD`；可集成同名测试SHA `10E12B92D3A2C854C21F2D8CA9E0025D83210ECD8A5BF8A7A70B96D7E4BC1926`。Root集成即可沿原test:study入口，组装辅助留staging；没有生产修改、设备/数据库操作或发布。

## 上一轮收尾 · 2026-10-13 07:58 UTC

**C01–C07均已在相应源码/受控范围修复，当前本代码审查无未修P1/P2。** 真实Chrome、像素与设备结论仍由Root及独立视觉记录；本报告不把新受控probe提升为全平台验收。

- C06：Root补focusIndex，按原tag/aria/text匹配集合的序号恢复重建控件。新版Root探针全部通过：三路返回、异步pop完成后5342恢复、第二同名控件重建焦点、CtrlK成功输入focus、IME不触发、modal拒绝focus穿透、scrollRestoration卸载恢复auto。证据：[probe-search-origin-result.json](./probe-search-origin-result.json)，Root SHA `93B168201089B7F905310B7A2B9980D320AA12A1E128D98D5B18BB0EB4AAC755`。
- C07：Resource列表scroll/focus改rAF，cleanup取消过期frame。真实Root+Resource受控探针通过隐藏stage/原BC详情/listening筛选、Native20让位、返回列表scroll5342/BC原行focus；另验证在恢复frame执行前转到progress并卸载Resource后不把新页77滚到旧页5342。证据：[probe-resource-stage-result.json](./probe-resource-stage-result.json)，Resource SHA `39324004D008520828F69BB39D0FCC81F9EDC90BC89D782BFE198247C91AF5E4`。

这两组probe执行真实TSX，但DOM重建、Hook、父子commit、rAF、history和布局高度夹取均是适配器；资源probe的1000/8000px只构造“父prelude隐藏→重新展开”的调度边界，不能作为实际界面高度或截图尺寸。早期来源返回probe未模拟Chrome UA自动scroll恢复，故它的07:27通过不能替代Root后续长页实测；新probe加入manual/异步pop/late reset/重建同名控件并保存新SHA。

Resource薄接口只传展示状态与交互阻挡，原15资源/ID/checkin.note关联没有变化；保持挂载用于保存来源filter/detail，hidden时让位而不新开存储。先前C06/C07失败与修复记录保留下文，不删改原发现。

## 上一轮补充 · 资源Root接口复核 · 2026-10-13

C06的focusIndex修复已通过独立新探针。最新Root SHA `93B168201089B7F905310B7A2B9980D320AA12A1E128D98D5B18BB0EB4AAC755`；[结果JSON](./probe-search-origin-result.json)记录07:52:44 UTC：长页scroll5342、第二同名控件重建焦点、CtrlK聚焦输入、IME期间不触发、modal拒绝查词仍保留焦点、manual scrollRestoration卸载恢复均通过（平台为受控适配器）。下文C06待修记录保留作历史，不代表最新状态。

新资源薄接口已复读：`onDetailChange`只通知父壳样式状态，不触碰Resource数据/ID；detail-active隐藏prelude/根heading/尾note；从resources查词时同位置保留ResourceLibrary挂载，section hidden；hidden时通过checkinOpen让Native20返回false，保留原filter/detail。独立实际Root+Resource TSX探针确认隐藏期间仍BC详情、返回仍同详情、listening筛选不变；没有checkin写入。

### C07 · P2 · 资料返回列表的滚动早于父页长内容恢复（待修）

新 `onDetailChange` effect将父Root的resourceFocus置false，而Resource `selectedId` effect同一批立即scrollTo原列表savedY。此时父Root尚未commit移除detail-active，prelude/尾note仍 `display:none`。浏览器可将5342夹至当前短页的scroll最大值；父Root随后显示长内容后不会自动再执行这段effect。

[probe-resource-stage.cjs](./probe-resource-stage.cjs) 读取真实Root+Resource TSX，通过通用Hook/refs+rAF/history适配器控制父子commit顺序，并按真实CSS隐藏标记模拟1000/8000px的layout夹取。隐藏/search/Native yield/原详情/筛选断言均通过，返回列表的实际受控值1000，预期5342。这不是实际Chrome尺寸记录；Root仍须长资料列表5342→详情→返回亲验。

最小修复：返回列表scroll/focus延到rAF，待父页prelude提交后执行，并在卸载/变更时取消过期恢复。仅UI调度，不改学习存储或资源目录。Resource核验SHA `3637A7DA267FC39770DBE33B1B6DF4007793747865D55635507A3B65D5C83D62`。

## 上一轮补充 · 长页回程与重建焦点 · 2026-10-13

Root实际Chrome记录长resources页5342回程被浏览器自动scroll恢复改为0。本代理复读新修：StudyApp挂载期间设置 `history.scrollRestoration='manual'`、卸载恢复之前值；consumed search pop完成后再次rAF恢复来源；Ctrl/Cmd+K成功打开才rAF聚焦输入，blocked返回false不穿透modal。方向正确，无学习数据写入。Chrome实测属于Root，本代理补受控源码探针。

新探针使用异步history导航队列、独立rAF队列及重建DOM控件，且在初次rAF后再施加一次平台/layout归零。当前源码能在pop后恢复scroll=5342，但发现以下一项P2仍需修复。

### C06 · P2 · 同名来源控件重建后焦点匹配到第一项（待修复）

`study-app.tsx` 的 `restoreSearchOrigin` 在旧DOM断开时按 `tagName/aria-label/textContent` 使用 `.find`。`exam-collection.tsx:27` 的每张资料卡均有同名“学完记一笔”button，以及“官方入口/PDF”a，未提供唯一aria-label。若用户在后面卡片Tab聚焦后Ctrl+K，来源重建后焦点会落到第一张同名卡。

独立真实Root TSX probe在SHA `4175A77F48370C5378FCB9CEE457CCB56CE16FDFB574DCE163EE7396047D9A23` 捕获：滚动5342通过，焦点actual=`resource-1-rebuilt`，expected=`resource-2-rebuilt`。只模拟DOM查询/焦点与React Hook，不宣称实际Chrome复现第二张卡；该失败不是读取页面文字主观推测。

最小修复：补稳定唯一指纹（例如既有resource标识/唯一aria/href）或保存同一标签匹配集合的原index，重建时选相同位置。只在UI内存保存，不改学习ID、数据目录或业务。`probe-search-origin.cjs`已包含同名第二控件回程、输入法composition不触发、CtrlK成功focus、modal阻挡focus和manual teardown断言；全部通过后更新结果JSON，当前旧JSON仍是07:27历史通过记录，不代表这次新探针已全通过。

## 上一轮代码结论 · StrictMode历史清理复核 · 2026-10-13 07:35 UTC

**C05已修复；当前本独立代码审查没有未修P1/P2。** Root实际Chrome发现新Practice history guard在StrictMode effect setup→cleanup→setup时会误开退出确认；这是Root的实际运行发现，本代理没有代领Chrome操作证据。

第一版持久token/active+0ms延迟清理已避免重复入口，但本代理独立测试再发现同类P2：StrictMode cleanup尚未执行计时器时再真正卸载，两个清理计时器都看到inactive且current state仍同token，连续请求2次异步Back，可能越过原详情。该失败由真实Practice TSX受控执行捕获（首次读取SHA `3A458DE5F6D06B3B0AA5CB0059A357E4EBAD097B39790CCBD541AC782395DFAD`），不是按源码字符串假定失败。

Root随后改为单一`lease.release`计时器：setup清旧计时器，cleanup同样清旧release，仅最终inactive release在仍拥有当前token时请求一次Back。复读 `practice.tsx:39–46` 确認此修复；当前Practice SHA `0951CCEA01A894C1A3581A0F26B4CC3EA7CE37CB6DE10546D31E6AC815BBA329`。

独立受控14/14通过，完整可集成文件：[ui-redesign-practice.test.cjs](./ui-redesign-practice.test.cjs)；[测试记录与限制](./PRACTICE-HISTORY-TEST-RESULTS.md)。保留原9项，新增5项覆盖单入口、不误开确认、立即final unmount只回退一次、图片/确认/未保存选择、失去token所有权不回退，以及实际Vocabulary→Practice→Native/Escape/Browser→原详情→列表查询保持。

测试执行真实TSX和模型，React effect重播、DOM部件、计时器、history遍历及Native dispatcher是受控适配器；`history.back`被排入独立导航队列，故能发现多个清理在导航完成前重复Back的缺陷。Escape验证词典capture不吞事件，再显式模拟Radix关闭回调；不宣称真实Radix/ReactDOM、ArkWeb、麦克风或设备验收。代码修复可以继续运行验收，Root仍亲验完整浏览器链。

## 上一轮代码结论 · 2026-10-13 07:27 UTC

**本文 C01–C04 的源码缺陷均已修复，当前审查范围没有未修 P1/P2。可继续完整运行验收，不能据此宣布生产/浏览器/模拟器/真机全部通过。** 下文保留初轮及中间缺口，按时间较新的结论读取。

Root已将两处词典 `overlayBlocked` 统一为queue/speaking/mockOpen/checkinOpen/settings/themeOpen/installOpen/recordingPlay合集。复读确认口语/模考优先级不变，Practice仍10、词典仍30；通过覆盖层暂停词典处理解决冲突，没有扩大原生协议或改学习存储。

独立实际Root TSX探针再次通过三路来源返回；还验证关联Practice打开时词典overlayBlocked=true，完成后收获Dialog打开时仍=true，Root Native回调关闭收获后留在search且overlayBlocked=false。该断言验证壳层props接线；探针中的Vocabulary/Practice是描述符，并未模拟两个子组件的完整dispatcher或Radix Escape事件。子组件源码已另行复读，真正完整往返须实际浏览器/设备验证。

最新结果见 [probe-search-origin-result.json](./probe-search-origin-result.json)，时间 `2026-10-13T07:27:18.909Z`。Root源码SHA `48DE6268022BFD3F261DF2F001C386615BA369963EF735C748A3BDDF47754FAC`；Practice SHA `2DA79899D54591C1F99CB6DB7CB741475EE5EDB5BF7A84DD961333526E19610D`；词典SHA仍 `13992C8B8F37B2F13BAA9B78D02EEB3630CFA4AEFE3662B669032430BF8D5099`。

此前tabs命中区与长材料字体候选也已复读：最终高优先级CSS将main/lesson tabs trigger设置44px，普通长材料改系统sans。它们的真实像素、文本间距/大字与焦点由视觉回归核验，本代码审查不重复发放视觉通过结论。

## 修复复核 · 2026-10-13 07:25 UTC

保留下文初轮发现原文，以下记录更近状态。C03、C04已完成源码/受控复核。C02的关联练习 Native/Escape/browser层已修，但同链路收获弹层还有一个范围缺口，已即时通知Root；无需重开设计或修改存储。

| 编号 | 当前独立结论 | 证据与边界 |
|---|---|---|
| C01 | 代码修复确认 | Native回调内部重复Hook移除；未亲测设备桥 |
| C02 | 练习层修复确认；收获弹层缺口待修 | Vocabulary overlayBlocked跳过Native/Escape/pop；Practice自行push一次owned history、capture返回先处理图片/退出确认，关闭时消费owned entry。词典对返回自己的token不恢复后台列表。仍有下述收获弹层缺口 |
| C03 | 受控三路返回与历史结构通过 | 实际StudyApp TSX执行，无浏览器/存储I/O。BrowserBack回resources/scroll420/focus1；屏内返回resources/420/focus2，下一次Back回today；Native回resources/640/focus3。来源ref、history消费和含nav的pop deps修正已核对。真实ReactDOM及浏览器自动scroll恢复仍待运行 |
| C04 | 语义token修复及精确色比通过 | alert全部改ui-danger；对card面板比日6.116、夜7.839、空洞8.196、丝8.561。没有将色对计算等同完整WCAG/实际叠层通过 |

独立受控证据：[probe-search-origin.cjs](./probe-search-origin.cjs)、[执行结果](./probe-search-origin-result.json)。Probe读取真实TSX并用通用Hook/history适配器执行回调，断言三路来源返回和后续Back；不复制 `openSearch/returnFromSearch` 实现，不接触真实记录。结果记录实际读取源码SHA和UTC时间。

### C02剩余同链路：练习完成后收获Dialog仍未计入词典overlayBlocked

07:25 UTC读取 `study-app.tsx:87–88` 的 `overlayBlocked={!!queue||!!speaking||mockOpen}`。从词条关联题完成Practice，再点“记录时间与收获”，`finish`将queue清空同时打开checkinOpen；词条详情仍挂载且overlayBlocked=false。Native30/capture Escape因此可能再次优先关闭后台词条，而不是壳0负责的当前收获Dialog。

最小修复：和ResourceLibrary的覆盖层合集保持一致，将checkinOpen（及settings/themeOpen/installOpen/recordingPlay）计入词典overlayBlocked。至少验“词条→练习完成→收获表单→Back/Escape取消→原词条详情”链，失败表单同样不能改动后台查询语境。此为C02返回门禁的完整覆盖，不新增业务功能。

07:25 UTC快照：study-app SHA `8BBB320BDA485D3FEDC213F28BF4F6E1D07AC15E5A086C52048A94F99144BA43`；vocabulary-library SHA `13992C8B8F37B2F13BAA9B78D02EEB3630CFA4AEFE3662B669032430BF8D5099`；vocabulary CSS SHA `23C16BC64609D3DB79537AE90DA1DA002D92C524B83CB856E47D8DBF93780809`。代码后续修改应以新的收尾记录为准。

## 初轮结论

尚不能宣布实现验收通过。录音、模考和主题的数据边界大体保留，已确认新壳层与词典有两项 P2 集成返回缺陷，词典错误态有一项 P2 对比度缺陷。发现的一项临时 P1 重复 Hook 集成块已由 Root 修正，独立重读确认移除。应修复本文 P2 后，再运行实际浏览器和原生验收。

## 发现与具体路径

### C01 · P1 · Native Back 回调内误插入顶层 Hook（已修正）

初读 `app/study-app.tsx:44–49`：`navigate/openSearch/useEffect/pageTitles` 整块位于 `registerNativeBack` 回调内，正常版本又在函数顶层重复。Native Back 执行时会在事件回调中调用 Hook，触发 Invalid hook call。该问题并非类型检查必然捕获的语法错误。

Root 接收发现后移除内部重复块。再次读取 `study-app.tsx:42–55`，回调仅包含返回决策，顶层效果仍在顶层。状态：**代码修复已独立确认**；还需真实 Native Back 或实际 dispatcher 集成测试验证不吞返回事件。

### C02 · P2 · 词条关联练习的返回优先级压过当前练习（待复核修复）

读取时位置：`app/learn/vocabulary-library.tsx:108,115–119,133`，`app/learn/practice.tsx:38–39`，`app/study-app.tsx:90–91,101`。

可复现路径：在手机或 840px 单列查词，打开带题目关联的词条；点击“在练习里认识它”的题目链接，打开 Practice；随后按 Native Back 或 Escape。词典组件仍挂载，`detailId && singleColumn` 成立。Native Back 30 先于 Practice 10 调用词典 `restoreList`；capture Escape 也会先改变后台词条详情。第一次返回没有处理当前练习的图片/退出确认，后台查询语境却已被改动。

最小修复：练习覆盖层存在时暂停词典的 Native Back / capture Escape / 内层 popstate，或确保当前练习返回级别优先而不破坏录音100、模考90、图片内部顺序。关闭练习后应恢复原词条和查询上下文。应增加从词条入口打开真实 Practice 的壳层集成回归；单独两组件测试均通过不足以覆盖此冲突。

### C03 · P2 · 查词返回来源页未恢复滚动与焦点（待复核修复）

读取时位置：`app/study-app.tsx` 的 `searchFrom/openSearch/navigate` 及 search `onBack`。`searchFrom` 仅保存栏目名；`navigate` 一律 `scrollTo({top:0})`。原生 search 返回只 `setNav(searchFrom)`，没有保存来源滚动。

可复现路径：从长资料页或进度页下半部打开查词，再点击“返回来源页”，源页面回顶端；原生返回也不能恢复原位置和触发控件焦点。这违反 DESIGN-SPEC:409、A06 的 `originPage/originScroll` 返回契约。词典内部已存 query/range/filter/limit/scroll，不能代替壳层来源快照。

最小修复：只在内存中保存来源栏目、滚动和触发控件，完成来源渲染后恢复；不写学习数据库。实际浏览器 Back、屏内返回、Native Back 分别验证，避免通过重复 pushState 造成反复回到 search 的历史栈。

### C04 · P2 · 词典错误文字使用未定义 token，暗色主题对比不足（待复核修复）

读取时位置：`app/learn/vocabulary-redesign.css:1` 的 `.vocab-alert` 及 `.vocab-alert b`：`var(--ui-error,#b64b43)`。实际主题定义的是 `--ui-danger`，没有 `--ui-error`；错误标题因此四主题均退回固定深红。

按当前不透明 CSS 色对、WCAG 相对亮度公式独立测算，15px 错误标题 `#b64b43` 对各面板：日间白 5.151:1，夜间 `#202724` 2.960:1，空洞 `#172332` 3.081:1，丝之歌 `#2b2025` 3.051:1。后三者低于普通文字4.5:1。可在词典加载/收藏/词卡保存失败状态看见；成功状态截图不能覆盖。

最小修复：使用既有 `--ui-danger`，并在四主题实际 computed style 检查错误标题和边界。Root 已接收发现，尚需重读新 CSS 与运行证据。

## 已核对的不变量

- 主题：`paper/crystal/hollow/silk` 持久 ID 保留，UI映射日/夜/空洞/丝之歌；只有新用户默认由 hollow 改 paper。`saveTheme` 仍读取最新可编辑快照、仅 enqueue theme；未用 DEFAULT_PROFILE 覆盖旧目标。`applyDocumentTheme` 在模考 early return 前且设置 html/body，Portal 继承全局语义 token。默认日/夜 motif 返回 null，游戏48px静态原创形状；最终 CSS 层叠仍须实际视觉验收。
- 存储范围：diff 的 lib 变化仅 DEFAULT_PROFILE.theme 和 useStudy 返回 recordsReadable。未发现 API、存储、迁移、deadline 算法或原 content ID 变更。原损坏快照/事务/同ID D1-R2 风险仍属既有架构工作线，不能在此宣布修复，也不应扩大本次UI改版。
- 学习读失败：recordsReadable 根据 ready、activeKey 与已有 readOnly guard 计算，非单凭 sync='blocked'；有本机有效记录但单条上传失败仍能学习。新测试覆盖这一区分，没有要求迁移或清空原存储。
- 查词：display query 与 committed searchQuery 分离，composition 不提前加载、提交；大词典按首个有效查询/未解析历史ID需求加载；原 merge/catalog IDs 保留。浏览不自动添加复习。收藏失败不乐观改变标记，词卡保存失败保留本张和反馈，成功后才增加索引。内部结果快照保存 query/searchQuery/mode/category/filter/limit/scroll/selectedId；1199px的JS与CSS单列断点一致。真实 IME 和软键盘未验。
- 词库文件异步导入：读完 file.text 后校验 ownerRef 与当前 activeStore.ready/error，再 restore；不是旧闭包直接写下一账号。
- 录音：停止时保存 stoppedAt，processing 等待最终 Blob；done 播放器在 pending/failed 保存时仍可回听，失败可下载同 objectURL，下载不会解锁再录/收获。重试保留原 Recording ID、发生时间与 Blob；saved 门禁、savingNow 并发锁、Native100和请求失效停track仍在。退出失败须明确放弃，成功后文案明确再次点击返回。真实 ArkWeb `a[download]`、权限、最终onstop、系统后台事件仍未测。
- 历史播放：Root 在 await recordingUrl 后校验 request、owner、nav、tab、alive，不匹配则 revoke 临时blob并拒绝；owner变化和卸载使请求失效。录音历史组件也有卸载/请求代数；当前对Dialog关闭与effect清理有重复 revoke但幂等，不是泄漏。
- 普通练习：失败重试采用同一个 pending Attempt（相同qid/choice），失败不出现解析、不增提交；改选重新建尝试，首次/复练由进入时首答集合决定。成功后才推进，Native10 先关图片/确认。不把完成自动变成时间打卡。
- 模考：MockExam 按 owner key重挂，ExamUiSession/FIFO/expectedRevision持有原记录；答案使用 durable current，computed timeout 未持久提交则锁定且不显示答案。提交只 repo.submit 原 attempt，未把 pendingAnswer 合并交卷。ExamPaper submitted 时忽略 pendingChoice，QuestionBody 正确答案有submitted防守。七Part、format、original package version、ordinal、original deadline均取原对象；R1提交快照要求在实际实现已满足源码条件。
- 模考媒体：仅一个 keyed ExamAudio 跨预检/开始阶段保留同父级；正式LC controls=false，无自由暂停/拖拽/倍速入口；恢复按已用时间对齐，原deadline不变。图片有独立Portal与内部返回。失败交卷和退出有重读/重试/明确应急路径；不以操作失败当安全保存。
- 资料：15条真实资源对象和原ID直接消费，访问条件、来源许可、步骤、实际分钟分离。打开外链不打卡；取消/failed addCheckin不增加次数，成功由原checkins props统计。当前页面被读失败门禁拦截而非显示空零；resource detail自身 recordsReady=false时不声称零历史。Study JSON仍导出，无虚构恢复/计划编辑UI。

## 需要实际集成验收而非扩大实现的项目

1. 从词条进入练习→取消退出→原详情→原长列表→原来源页的完整往返，覆盖 Native Back、Escape、Browser Back；原生桥和browser popstate不能用独立组件hook stub代替。
2. 四主题全页/Portal/模考 early return，320/390/840/1024/1440px；错误、pending、选中、disabled、200%文字与keyboard focus。精确色对计算不证明完整WCAG。
3. 录音应急下载实际文件；音频权限/停止/后台与错误重试；Web与模拟器与真实设备证据分别记录。
4. 合成题包/账号的交卷未保存B→漏答、已保存A再选未保存B→复盘A；原包/attempt/期限以及LC/RC恢复。已有真实TSX+模型受控测试证明源码路径，不证明真实私有题包媒体或设备计时。
5. 浏览器历史和原站返回的资源分类/详情/scroll保留：ResourceLibrary只注册Native20/屏内返回，未自行创建浏览器内层history；需在完整壳层运行中核对DESIGN-SPEC:617的返回层次。

## 原始记录与结论边界

原设计v1.0否决与v1.1允许实施报告未改；本文件是实际代码审查，不替代设计终审或独立视觉回归，不声明所有主题/设备/真实数据同步通过。Root有完整测试/构建任务，本审查仅阅读测试实现，没有把其运行结果归为本代理亲自测试。
