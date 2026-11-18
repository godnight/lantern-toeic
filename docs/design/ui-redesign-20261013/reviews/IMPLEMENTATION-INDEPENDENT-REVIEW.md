# UI 实现独立只读评审

日期：2026-10-13。工作区：PC-20230610ZTOE，`D:\zzl\托业学习\vocab-work\theme-redesign-20261012\site`。基准：审定 v1.1 设计及 `FINAL-INDEPENDENT-RECHECK-v1.1.md`，特别是 R1 交卷快照与 R2 录音退出。评审由同一独立终审任务及三名只读辅助评审完成；不是作者模拟器检查。

## 首要结论

**最后复核仍有一个 P1：owner 切换会静默卸载未保存录音，不能标记全量实施验收通过。** 作者在 `08:55:55 UTC` 增加 owner/nativeMode keyed Workspace，已经阻断旧草稿与录音改用新账号回调的路径；该修正立即卸载 SpeakingRoom，却没有在外层保留唯一未保存 Blob，也没有经过下载/明确放弃保护。下文 I01 保留原发现，并记录本轮修正及残余，最终状态以后续复核为准。

其余发现为 P2：模考未保存选择跨题覆盖、口语 Browser Back/历史媒体失败、查词状态与历史恢复、解析受控查词路径，以及主题 toast/专注壳层的落实细节。作者仍在修复，可继续集成；此报告评审的是下述快照，不把中间态称作最终版。没有声称实际用户已串号、已丢数据或真实设备已复现。

## 版本、时间与方法

- Git HEAD：`12317b26b85a71888760b0cc18242d00a843ac74`，本机分支 `feat/ui-redesign-v11`。生产代码改动尚未提交，HEAD 本身不是本轮实现内容的完整指纹。
- 主任务开始读取约 `08:45:03 UTC`；首轮主快照复核为 `08:55:49 UTC`。作者期间修改了 `study-app.tsx` 与 `mock-exam.css`，已重读相关实现。归档期间发现 `08:55:55 UTC` 新 owner key 修正，已在 `09:01:56–09:02:15 UTC` 再核对其与 SpeakingRoom；I01 原串号路径部分关闭，仍有录音交接残余。其余主要文件哈希首尾不变。
- 遵循 `AGENTS.md` 及既有项目接续要求；读取实施基线、当前设计、实施测试报告、真实 TSX/TS/CSS、相关新增测试源码及 Git 只读差异。Git 查询采用本命令 `-c safe.directory=<精确目录>` 与 `GIT_OPTIONAL_LOCKS=0`，未写全局配置或刷新索引。
- **未运行任何测试/构建、服务、浏览器、模拟器、实机或生产接口；未读写真实用户记录。** 本评审是静态控制流/状态/层叠与合同检查。所有建议的回归场景均为后续验收条件，不冒称本任务已执行。

## I01 / P1 · owner 边界：旧写入路径已修，未保存录音交接仍阻塞

### 首轮发现（08:55:49 快照；新 owner key 已阻断此写入路径）

证据：`app/page.tsx:4` 渲染 StudyApp 没有 owner key，服务端 refresh 更新 owner 时客户端实例可复用。`app/study-app.tsx:38` 保留 queue/speaking/checkin/draft 等本地状态；`:44` 的 owner effect 仅关闭历史录音播放器；`:103–104` 的 Practice/SpeakingRoom key 只有题目串/任务ID，不含会话创建 owner。`:105–106` 提交打卡/偏好也没有草稿来源账号校验。

两个可复核触发路径：

1. A 打开偏好，`:71` 将 A 的 profile 复制到 draft；同实例 owner 更新为 B；旧设置 Dialog 与 draft 仍在，`:106` 的保存已使用 B 的新 saveProfile，可能把 A 的目标/考期/主题等整份写入 B。
2. A 录音保存失败，SpeakingRoom 的 `last(meta,Blob)` 留存；owner 更新为 B；`:104` 向未重挂的 Room 提供 B 的 addRecording；`speaking.tsx:144` 的重试把 A 的临时录音提交给 B。常规练习旧 choice 与打卡同样可以沿新回调提交。

`lib/use-study.ts:185–190` 保护的是被调用闭包的当前 key/generation，能拒绝旧闭包的迟到响应，但本场景已经改用 B 的新回调，无法辨认 UI 内容创建于 A。`recordsReadable`/EMPTY_DATA 投影防止显示旧 storedData，却不清理组件内部草稿。原生 owner 固定 null 时不触发；本项针对 Web owner prop/account 更新。

**最小修正**：绑定每个会话/草稿的创建 owner，持久提交与迟到回调校验该 owner；变化时冻结旧意图，清练习队列、偏好/打卡、来源快照与历史租约。录音先停止并保留未保存 Blob 的下载/明确放弃，再结束旧会话；不要仅加 owner key 导致未保存音频静默释放。无需改 DB、key 或备份协议。

关闭证据：受控 A→B 覆盖设置/打卡/练习/失败录音重试；B 的 profile/记录/音频均不包含 A 的旧意图，未保存音频仍可保留或明确放弃；晚到旧响应无效。信心高，来源为直接控制流；未操作实际账号。

### 作者修正后复核（09:01:56–09:02:15 UTC；当前 P1 残余）

`app/study-app.tsx:31–34` 新增默认入口包装，`:32` 返回 `<StudyWorkspace key={JSON.stringify([nativeMode,owner])} .../>`。这是有效的账号 UI 隔离：owner 变化会丢弃旧偏好/打卡/练习草稿和子会话，原 A 内容改用 B 回调的路径已关闭。未将该旧路径继续计为未修阻塞；这里只确认源码变化，未做账号运行验收。

但 `speaking.tsx:62` 的 `last` 仍是 Room 内唯一临时 `(meta, Blob)`；`:65` cleanup 在 React 重挂时撤销 objectURL、释放麦克风，录制中还将 `recorder.onstop=null` 后停止。Workspace 外没有恢复会话或 Blob 交接。该卸载不经过 `:126–132` 退出保护，也不经过 `:179–181` 下载/明确放弃；`beforeunload` 不因 React 子树重挂触发。

确定触发条件：A 录音完成但 IndexedDB 保存失败，Room 处于 done/saved=false/saveError，仍能回听及应急下载 → owner 更新为 B → keyed Workspace 被替换。尚未持久化的 Blob 与恢复 UI 一起释放；B 不能错误重存，A 也失去原下载或明确放弃窗口。录制中的已录片段还有 onstop 被移除后的整理缺口。此前已成功持久化的录音不受本项影响；未声称实际用户已经丢失文件。

**最小修正**：在 owner key 边界外保留归属原 owner 的临时录音恢复会话；身份变化时停止并整理录音、冻结持久写入，保留回听/下载/明确放弃，处理完才释放旧 Blob。不得借新账号重新保存旧音频。无需改变 DB、key、ID 或 API。受控检查至少覆盖保存失败 Blob 和录制中 A→B，证明 B 不接收 A 内容且 A 音频仍可下载/明确放弃。

源码复核双方一致：StudyApp SHA `C601AE9CE05085221B510CE2C8343346716E3F9AF9731443435F752554AF0D45`，修改时间 `08:55:55.3252844 UTC`；SpeakingRoom SHA `316AA913196CAC5BB61E8ED47B1ED8A7FAD021F517FB0FAF1040AFE9CE97C133`，修改时间 `05:32:23.9589298 UTC`。信心高；控制流静态复核，未运行录音或账户切换。

后文 StudyApp 行号引用为首轮快照；新包装使原主体整体后移 3 行，相关 P2 逻辑未变（例如 popstate 现为85、历史audio现为112、WorkspaceShell现为89）。

## P2：真实实现缺口与最小修正

### I02 · 模考跨题操作会覆盖未保存选择

`app/learn/mock-exam.tsx:52` 仅有单个 pendingAnswer；`:231–246` 的 select/answer 允许切到另一题后覆盖并清掉它；`:401` 的换题主要禁 busy/截止。

路径：Q101选B落盘失败 → 下一题 → Q102选A保存成功，Q101的临时B被新 pending 覆盖后清空，用户未明确取消它。**已持久答案不因此丢失**，但失败选择恢复承诺没有覆盖跨题动作。

最小：存在待处理失败选择时，先重试或明确取消再换题；或按题号保存 pending map。补跨题失败检查。读取到的模考新增测试覆盖R1/失败提交等，未覆盖此路径；本任务没有执行测试。

### I03 · 口语 Browser Back 未走录音 guard

`study-app.tsx:82` 的 popstate 遇 speaking 直接 return；`speaking.tsx:126–139` 有屏内、Escape、Native100及 beforeunload，却没有同文档历史层。Browser Back 会消耗 workspace 历史但没有调用停止/整理/保存/明确放弃，和屏内/Native 返回不一致。beforeunload只管离开文档，不能替代同文档popstate。

最小：建立受控历史层，Back 经 requestClose，取消/等待时保持历史一致；直接离开文档仍保留已有卸载保护。验收准备/录音/整理/保存失败四态的三种返回；未测试真实浏览器。

### I04 · 历史云录音的后续媒体失败不进入恢复 UI

`use-study.ts:192` 本机Blob缺失且uploaded时返回云 URL；`study-app.tsx:94` 取得URL即认为 onPlay 成功；`:109` 的audio没有onError。云404、离线或解码失败发生在URL返回之后，`speaking.tsx:53` 的inline错误/重读不会出现，用户只有原生播放器失败状态。

最小：播放器连接媒体加载错误与重读状态，保留录音元数据；区分本机读取异常与已确认云副本读取失败。新 speaking 测试仅模拟 onPlay 拒绝，不能覆盖返回URL后的媒体失败。真实网络/媒体另验。

### I05 · 查词无结果混用了 IME 草稿与已执行查询

`vocabulary-library.tsx:80–89` 结果由deferredQuery产生，`:127,143` 组合期仅更新query草稿，`:162` 零结果标题却引用query。已有零结果后开始中文组合输入，会把尚未执行的组合文字称作“未找到”；延迟更新也会把新词配旧零结果。

最小：零结果文案绑定实际执行的查询；组合/更新期显示保留旧结果或待更新，不把新草稿定为无结果。Enter组合态保护本身已存在。本项是状态逻辑判断，不是实体IME测试结果。

### I06 · 词典需求取消后的 loading 与私人计数不准确

`vocabulary-library.tsx:62–68` 读取时清空/换场景使需求取消，仅alive=false，dictionaryLoading不复位。若有未解析历史词条，`:148` 可持续显示正在读取并隐藏重试，直到另一个查询再次触发加载。

另`:58,147,167` 私人store尚未ready或读取error时仍用空events显示“生词0·到期0”。虽然同时有读取/错误提示，零值仍不是已核实的私人记录状态。

最小：取消需求复位或接收有效缓存结果；loading/error/ready各自收口。私人计数显示读取中/不可读，公共查询继续可用；不以空值写回。补取消加载及私人读取失败场景。

### I07 · 查词历史遍历与断点变化未完整同步详情

`vocabulary-library.tsx:109` 对同token历史项一律return。手机详情→Back到列表→Forward到旧详情项不会恢复详情；再打开详情后可能累积同token历史项，后续Back被忽略。`:71–72,122` 桌面打开详情后缩窄只切singleColumn，没有补内部历史层，Browser Back不能按全屏详情顺序消费。

最小：历史项保存view/selectedId，popstate恢复对应视图；断点转全屏时同步历史。保留原query/filter/category/visibleCount/scroll/origin，不重建学习记录。完整快照字段已写入组件，但不是所有历史路径均成立。

### I08 · 词卡返回未保存列表启动控件焦点

`vocabulary-library.tsx:123` 从列表启动词卡时saveContext(detailId)，detailId可为null；`:114` 只在selectedId存在时恢复原结果行，键盘返回没有启动按钮焦点目标。

最小：快照保存启动控件稳定ID/引用，返回先恢复条数/位置再焦点。属于可访问性收口，未操作实际键盘/读屏。

### I09 · 解析→查题内词→返回解析的已审定路径尚未交付

`practice.tsx:54` 的词汇区只有释义/例句，无受控查词回调；`study-app.tsx:80` 只要queue存在便一律禁止openSearch，已提交解析也不能进入。设计4.2承诺的题后相关词完整返回链未落实。

最小：仅已提交解析阶段提供受控入口，保留当前题/答案/解析/滚动，详情返回原解析；未提交仍守退出/查词限制。不能通过卸载Practice实现，否则丢内存上下文。未要求新增搜索算法。

### I10 · Toast 的四主题接线仍跟随系统主题

`components/ui/sonner.tsx:18–23` 从next-themes读取theme并默认system；StudyApp只调用applyDocumentTheme，`:109` Toaster启用richColors，未传手选主题的light/dark。当前RootLayout没有ThemeProvider接线。

安装库 `node_modules/sonner/dist/styles.css:467–522,536–579` 的rich状态使用自身success/error等色对，而wrapper只给normal-bg/text/border。系统日间+手选夜间/游戏主题时，rich错误/成功toast仍按系统颜色，不能据body tokens宣称所有反馈均四主题覆盖。

最小：Toaster显式接当前UI colorScheme，并按语义tokens补rich状态变量（或统一不用richColors）；检查手动四主题与系统相反组合。此为静态接线缺口，不是本评审已亲见的颜色/对比故障。

### I11 · 普通练习/口语专注壳层未按设计隐藏

`study-app.tsx:86` WorkspaceShell focused只含词库专注/搜索，不含queue/speaking；`:103–104` 采用Portal Dialog，后方全局壳层继续渲染。`workspace-redesign.css:34`/`redesign.css:14` 的隐藏规则依赖workspace-focused，无对应queue/speaking条件。

Radix模态会限制背景交互，openSearch/navigate也有guard，**未据此发现能点击侧栏绕过保存的漏洞**。但审定方案的所有宽度专注隐藏全局导航尚未落实。

最小：会话开启时统一专注壳状态，仍使用真实受控返回与Dialog焦点保护；现场检查手机/桌面背景、最后一段与操作条。属于设计落实收尾，不擅自要求改业务模型。

## 已落实的源码合同

- 四主题枚举仍paper/crystal/hollow/silk，day/night仅视觉别名。`applyDocumentTheme`写html/body且effect在模考early return前；Web与mobile都导入统一redesign。Portal和模考具备根tokens继承路径，旧!important有明确覆盖。静态方向成立，computed style与动态所有状态仍待作者运行验收。
- 默认日夜ThemeMotif返回null，工作空间不再使用旧atlas场景/图片导航；游戏48px原创形态保持，小主题预览为真实内容/状态示例。源代码未把主题装饰插入题面/释义/录音主体。不能把本项等同实际四主题全页像素通过。
- R1已经落实到真实模考：仅持久submitted/result就绪才揭示答案，复盘读saved.attempt.answers；pending不会进入原作答。`mock-exam.tsx:157,353,357,399,418–420`是关键依据。
- 模考原ID、owner、版本/fingerprint、LC/RC原截止、FIFO/CAS与同范围备份合同保留，model/ui/storage未被此UI差异迁移。正常退出先保存，失败留页；应急退出有明确风险，不假暂停计时。
- 录音先得真实Blob可回听，保存失败保留回听/下载/同ID重试；再录/收获仅saved后开放；createdAt是录音开始，未用重试时间替代。保存后再次返回的R2文案已明确。
- 15条资源仍按原对象/来源/步骤/ID，外站打开与打卡分动作，父级保存成功才更新统计；三类备份分域，没有把学习JSON元数据当音频文件或新增假恢复。词库/模考owner门禁本身有实现；作者新增Workspace key后父级旧草稿隔离成立，I01残余集中在未保存音频的安全交接。
- 移动五栏、查词直接入口、安全区、词库专注隐藏与44px主要操作的CSS接线已有；实体IME/软键盘/折叠、Native和屏幕阅读未由本次验证。

## 测试记录的实际边界

读取的 `docs/testing/UI_REDESIGN_IMPLEMENTATION_20261013.md` 修改时间为 `05:38:46 UTC`，是中间工程证据：14条受控合同通过、原核心初次68/69（旧口语window.confirm harness待适配）。它明确区分React/UI/Native/时钟/I/O替身与真实运行。本评审没有重跑，也不将这些旧结果映射为08:47后全部源码已验收。

当前新增search/speaking/exam/practice/hook/resources测试和package接线存在，部分确实读取真实TSX，但仅有测试源码不能证明当前运行通过。模考测试含R1、保存失败、原截止、owner晚到、图片返回等；口语历史测试只覆盖onPlay拒绝，缺媒体错误。I01 owner隔离与未保存录音交接、I02跨题失败和上述历史/组合路径应补有效行为断言，不删除既有回归以换取通过。

未取得本次模拟器/真机最终结果，未操作作者正在检查的设备。后续至少分别记录：当前完整类型/构建/测试运行，浏览器真实DOM/Portal/键盘/历史，Harmony模拟器真实壳与存储，物理机录音/IME/折叠/媒体/后台。原型79张及v1.1设计通过不能替代此实施证据。

## 首尾快照与作者期间变化

首轮主复核 `2026-10-13 08:55:49 UTC` 的关键文件如下（UTC修改时间；完整SHA-256）。StudyApp此项已被上文 `08:55:55` 包装修正及最新哈希替代，保留此表用于追溯原发现：

| 文件 | 修改时间UTC | SHA-256 |
|---|---|---|
| app/study-app.tsx | 08:47:22.3885805 | `60257409A413BB46DF38B14A814224360C81B2C299BAAE5DFCFA2351BB7190AC` |
| app/learn/vocabulary-library.tsx | 07:30:29.4417630 | `D710ECF9D1F841A0D8641DC626C128139975D91E2C46A95B3B266B2B80D808A0` |
| app/learn/speaking.tsx | 05:32:23.9589298 | `316AA913196CAC5BB61E8ED47B1ED8A7FAD021F517FB0FAF1040AFE9CE97C133` |
| app/learn/mock-exam.tsx | 08:44:53.0167543 | `6D936837D7EC09275AEF4433610BAE5EDB2712A65C0259F6F36B69AB3F3270D7` |
| app/learn/mock-exam.css | 08:49:08.0159758 | `5F20D9F86A99BAFCADB724B1B69C727865FFBC940FECEC7F295F8C3065D7FA71` |
| app/learn/practice.tsx | 07:34:33.1172680 | `0951CCEA01A894C1A3581A0F26B4CC3EA7CE37CB6DE10546D31E6AC815BBA329` |
| app/learn/resource-library.tsx | 07:56:10.0168140 | `39324004D008520828F69BB39D0FCC81F9EDC90BC89D782BFE198247C91AF5E4` |
| lib/use-study.ts | 05:34:05.3436836 | `9677C7F25CCAEE91F1861799740AAB5DB9DADD7960F59F148A5889140400E161` |
| lib/ui-theme.ts | 08:15:29.9219500 | `83FCBE6B53BF084F18DBA68A4047ED92A20257033EC0FBAEDC7515DE9C10BF4A` |
| app/learn/ui-theme.css | 05:23:53.5166250 | `8A225F358BA23E8C621EE962A0C6FDB0703D0B2CD4E5D9332B58A401C4956030` |

开始StudyApp为07:50:12 / `93B168201089B7F905310B7A2B9980D320AA12A1E128D98D5B18BB0EB4AAC755`；模考CSS为08:45:00 / `11156EA8666AF4B9058BB3C322F71B37635B4ADDD7DE29993631CB80823EA367`。期间StudyApp与CSS变化已补读，未用旧行假定作者没修；首轮I01在该表快照存在，最后已明确关闭原写入路径、保留未保存录音残余。作者继续修改后，按对应文件与触发单项复核即可，无需重做设计终审。

本任务只新增这份独立报告；未改生产、设计、原型、测试、Git配置或旧评审，没有切分支、上传、提交、推送、发布或运行设备操作。
