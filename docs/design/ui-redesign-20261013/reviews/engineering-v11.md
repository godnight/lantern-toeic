# v1.1 补稿：工程、保存与数据边界审查

日期：2026-10-13。独立审查角色：工程 / 可访问性。当前结论：**正式归档的 `FINAL-INDEPENDENT-REVIEW.md` 仍为“暂不通过独立终审”；本文件只核实 v1.1 补稿契约，不取代同一独立终审者的复验。**

已读归档终审记录与 `docs/reviews/2026-10-13-architecture/UI_ALIGNMENT.md`，重新只读核对主题完整快照 `vocab-work/theme-redesign-20261012/site` 的口语、模考、学习 store、词库、资料、备份、偏好和 Native Back 源码。没有改生产、真实学习数据或原型，没有操控共享浏览器 / 服务器。

## 1. 设计缺页与生产验收分开

F01 的口语 Blob 完成 / 保存失败 / 回听 / 下载 / 退出、F02 的媒体长材料与交卷保存闭环、F04 的材料详情 / 打卡 / 偏好 / 各备份入口，都属于**设计定稿前必须补齐可审阅画面与动作**。一段“沿用现有能力”不足以决定这些界面的版式、状态和关闭顺序。

真实麦克风、Blob 下载到鸿蒙系统、自然两小时截止、中文 IME、设备 Back、读屏和低端性能属于实施后的验收。本轮无需为关闭设计缺页而调用真实麦克风、等待两小时或操作手机。原型必须明确只模拟状态，不能反过来宣称这些生产行为已验。

F03 的游戏身份表达由独立视觉评审负责；本工程审查保持题面 / 输入 / 释义 / 录音主体安静与数据边界，不以未做真实设备测试阻塞其设计定稿。

## 2. 口语 Blob：已有能力与补稿门禁

依据 `app/learn/speaking.tsx:10–38` 和 `lib/use-study.ts:184–194`。

| 状态 / 动作 | 源码事实 | v1.1 画面与控制契约 |
|---|---|---|
| 录音前 / 申请权限 | ready；getUserMedia；准备和录音用截止时间而非仅递减UI数字 | 准备、权限等待、拒绝、不支持分别可辨；没有录音 / AI 分数可伪造 |
| 停止录音 | onstop先组Blob、检查size、创建objectURL、phase=done，再await persist | 停止→整理→保存有明确阶段；不能直接关闭录音页等待后台“想象保存” |
| 保存中 | audio controls已使用objectURL；busy/saved尚未成功 | **可以回听**。保存尚未确认时不可显示已持久保存 / 已云同步。返回留页并提示保存中 |
| 保存失败 | last.current保留meta+Blob、setSaveError；audio仍可用；提供persist重试及`download` Blob链接 | **回听、重试、下载保留**均可见；不能写“保存成功后才可回放/导出”。不以存储错误封死Blob保留路径 |
| 再录 / 记录收获 | 两按钮均disabled=!saved | 保存失败 / 保存中仍不能直接再录覆盖当前clip。下载完成也不会按现有实现自动解锁再录；若想改变此规则，需明确另立取舍，不能悄悄扩能力 |
| 返回 / Native Back | requestClose：录音中先stop并留页；整理中留页；prep/权限等待先取消；done未saved且未saveError留页；失败后明确确认放弃才onClose | 给“继续保留 / 重试 / 下载 / 明确放弃并退出”的失败路径；不把未保存Blob永久锁在页面，也不由generic导航直接卸载 |
| 保存时间 | meta.createdAt=new Date(started.current)，duration由stop-start计算；上传时间另记 | 保留练习开始的真实时间。不能在重试 / 下载 / 同步时更新为新的发生时间 |
| 自评 / 参考表达 | guide的self数组是本轮UI state，参考表达 / SpeechPlayer已有；没有AI自动评分 | 自评清单与参考表达可呈现；不要宣称AI分、历史已同步自评评分或存储中不存在的评分实体 |
| 完成时间 | onFinish将(duration+prepSeconds)估算分钟交给现有打卡 | “记录收获”进入现有分钟 / 负荷 / 手记；不自动把录音时长加进周分钟 |
| 历史回听 | RecordingList→recordingUrl：先取本机Blob，有owner且uploaded才回退私有录音API；否则真实错误 | 画历史列表及播放器，发生时间和文件引用保持；当前历史UI没有删除 / 独立下载入口，不顺势新增 |

生产`addRecording`先`putAudio`等IDB事务完成，再存录音元数据；账号generation / key变更会拒绝完成。它不等于保存到云端成功。Web“本机已保存，等待同步”和Native“这台设备”必须分开。

**F01设计关闭所需**：五类目录（朗读、图片描述、回答问题、根据资料回答、表达观点）可达；至少带图 / 长资料任务；准备→录音→整理/保存→回听/自评/参考→再录/打卡；失败Blob保留与受控退出在桌面 / 手机稿均可审阅。无需真麦克风验收。

## 3. 模考提交、退出与原截止

依据 `app/learn/mock-exam.tsx:73–95,173–233,267–275,313–353`、`lib/exam-ui.ts:9–48`、`lib/exam-storage.ts:53–70,137–166`、`lib/exam-model.ts:258–306,347–384`。

1. **持久化门禁。** 答案、选题、tick、background、submit通过`ExamUiSession`同一FIFO；每次使用当前expectedRevision。Repository的transaction等待oncomplete才返回。UI只有持久结果`apply(row)`后才能标保存 / 结果，不能以handler开始或模型计算完毕显示“已交卷”。
2. **手动交卷只在RC。** 听力阶段不能手动跳过LC交卷。RC才显示“提交整卷”；确认说明`200 - answered`题未保存，漏答按错，提交后不能修改；同ID提交失败仍保留考试页，重读 / 重试并继续原计时。
3. **漏答与临时选择。** 原生产UI显示的是saved.attempt.answers，未保存总数包括尚无持久答案的题；当前没有独立持久“待保存选择”模型。v1.1可以用临时UI fixture解释“空白53 + 本题已选待写入1 = 未保存54、已保存146”，但必须标其为呈现状态，不声称原存储已经有额外队列 / 持久草稿。实施时如保留失败点击，只是界面transient choice，成功后才进入answers。
4. **退出失败有应急选择。** 默认leave先关闭图片 / confirmSubmit，再尝试markInterrupted；保存中留页；失败默认留页并exitFailure。**源码另有明确“中断标记未保存，仍退出（计时继续）”入口**（273–274），因此不能把保留门禁误画成永久绝对禁退。应急退出须明确未完成保存风险，仍不延后截止。
5. **原截止不可重建。** createAttempt首次建立startedAt、listeningDeadline=start+有效LC、readingDeadline=start+LC+75分钟；remainingMs与advance使用max(now,lastObservedAt)，后台、关闭、重启不暂停，回拨不增加剩余时间。读到旧attempt须沿原ID/version/fingerprint/ordinal/format/截止恢复，不能重新startAttempt冒充继续。
6. **截止提交。** advance先按时间切LC→RC，再到readingDeadline置submitted(timeout)；Repository.act先advance，截止后点击不计入新答案。若持久化失败，画“时间已到，正在保存交卷 / 重试读取”，结果与答案仍被门禁挡住，不显示虚构成绩。保存成功后结果保留原submittedAt截止。
7. **格式与材料。** 原包format、getListeningDurationMs、imagesReady、音频实际时长和本人heard确认保留。旧制2006标签不是摆设；现行/旧制Part题量、声明LC时长和75分钟RC要从各包显示。题图可放大双向滚动，扫描文字无自动OCR/读屏文本转换能力；交卷前不泄露答案。
8. **七Part结果与原题解析。** 结果只能来自已持久提交记录；原题包版本 / 记录ID / 首次或复測 / Part七行可见。查看原题解析不把考试错题写成普通新题首答，不改考试身份。

**F02设计关闭所需**：目录→现行/旧制预检→完整LC音轨/题图与长、多材料RC→手机答题卡→RC交卷确认/提交中/失败/截止→七Part结果→原题解析。退出失败时原timer可见；至少一种逐句回听 / 听写展开。例题可原创合成，不接私人题本，不要求自然两小时实机测试。

## 4. 资料打卡、偏好与三类备份

依据 `app/learn/resource-library.tsx:10–30`、`app/study-app.tsx:102,108–112`、`lib/study-backup.ts:6–33`、`app/learn/vocabulary-library.tsx:51,75`、`lib/exam-storage.ts:168–220`。

### 4.1 材料学习闭环

- 一份材料包含provider、预计分钟、description、音频 / 文本 / Part标签、原steps、accessNote、外站url、学完记一笔、已学次数 / 分钟。打开外站与打卡是两个动作，打开不自动产生学习事件。
- 主壳onRecord(r)将建议分钟、resource.id/title传给既有打卡。提交整数1–240分钟、负荷轻/刚好/重、手记；note沿用`[资源:<resource.id>] <title>\n<note>`并截到1000。不要迁移到未交付的ResourceTask编辑UI。
- `addCheckin`返回true后关闭打卡 / 显示成功并回原材料；失败留输入。资料visits依`checkins.note.includes('[资源:'+id+']')`统计次数、sum(minutes)。不要先更新已学次数再等待真实保存。

### 4.2 偏好编辑

实际已有称呼、听读目标、口语目标、考期、每日分钟、每周启动、时区七项；主题为独立操作。当前前端选择每日5/15/25/45/60、每周3/4/5/6/7、上海/东京/洛杉矶/伦敦/UTC。模型/API允许dailyMinutes5–120、weeklyTarget1–7、lrGoal10–990、speakingGoal0–200、有效时区与空考期；不能因新表单默认值覆盖已有合法其他值。

原设置保存使用现有draft，name.trim并onboarded=true；only-theme继续原子主题字段。v1.1必须画完整表单 / 校验 / 保存中或失败 / 取消返回，不能只留“编辑预算”提示。页面文案不需要展示内部方法名；文档用真实`addCheckin`而不是不存在的saveCheckin。

### 4.3 三类备份明确分区

| 备份 | 真实内容 / 能力 | 不能冒充 |
|---|---|---|
| 听读与口语学习JSON | `createStudyBackup`含schemaVersion2 / profile / attempts / checkins / recording元信息 / questionMarks / resourceTasks；`audioIncluded:false`。当前StudyApp只有导出入口；恢复hook存在但未形成已交付UI | 不能称完整录音文件备份、不能新增学习JSON恢复UI、不能用存在的model字段表示已有计划/错因编辑UI |
| 词库记录JSON | `kind:lantern-vocabulary`、schemaVersion1、events（mark/review）；现有导出 / 合并导入≤20,000,000字节，原ID和记录保留；不包含整个词典包 | 不混进听读Attempt、不同账号事件或通用词典资产；不能恢复为覆盖/清空生词 |
| 完整模考JSON | `kind:lantern-exam-backup`、schemaVersion1、ownerId、packages（含assets）、attempts；现有导出 / 同owner幂等合并恢复，限224 MiB；所有验证后transaction写入 | 不上传考试成绩至云，不跨owner回退，不覆盖同ID不同题包fingerprint或不同attempt状态；读取失败不当空库 |

已有recordings历史回放、安装指引、主题素材来源仍有可达的代表模板或明确保留策略。原型“下载Blob”可按演示按钮说明，但真实系统下载由实施验收验证。

**F04设计关闭所需**：一个完整材料详情/展开、打开→学完打卡→保存失败/成功→回原材料与累计事实；完整偏好编辑；三类备份页面 / 状态与范围、录音历史回听、安装/来源说明位置索引。无需逐条重画15个材料，也不新增云认证或恢复能力。

## 5. 精确存储 key / DB 索引（仅源码索引，未读取真实值）

| 域 | 实际key / DB | 保留要求 |
|---|---|---|
| StudyData | localStorage主key `lantern-v1-` + `(owner || 'device')`；后缀`:profile`、`:op:<operationId>`、`:ack:<operationId>`、`:recording:<recordingId>`、`:sync:<kind>:<id>`、`:required-schema` | owner原分区、immutable op/ack和required-schema门禁不改名。首答 / 复练 / checkin / recording元信息ID不重建 |
| VocabularyEvent | owner===null时`lantern-vocab-v1:device:`；否则`lantern-vocab-v1:owner:`+encodeURIComponent(owner)+`:`；chunk后缀createId() | 分区读取所有chunk再merge；old wordId、dictId、revision、mark取消与review间隔保留；不因主题或显示词头重建 |
| 录音Blob | IndexedDB `lantern-audio` **version1**；store`audio`，Blob key=`studyKey + ':' + recordingId` | Blob key与Study recording元信息对应；JSON元信息不等于文件。不得用device与owner互相fallback；读取失败不伪称无录音 |
| 完整模考 | IndexedDB `lantern-private-exams-v1` **version3**；stores`packages/catalog/attempts`；`key = exam.id + '@' + exam.version` | packages/catalog keyPath=`['ownerId','key']`；attempts=`['ownerId','id']`；各有非unique`owner` index。DB版本不可误退至历史v1/v2 |
| 模考record范围 | Web=当前owner；Harmony入口=`harmony-local-device`；无合法owner拒绝打开，不能退回临时存储 | 与普通Study/词库的device命名不同，是现有事实。不能统一owner字符串导致题包/考试看似丢失 |
| 公私资源 | 私人云题包/录音用服务端托管身份；原创题库与普通dictionary静态包不含个人成绩 | 默认主题资源只影响外观；不迁移账号、Blob、题包或题目ID，不重置云与本机区分 |

表内没有列出真实owner或记录值，没有访问实际数据库 / 浏览器数据。精确源位置：`use-study.ts:7–32,143–194`、`vocabulary-model.ts:37–50`、`exam-storage.ts:19–20,53–73,231–242`、`study-app.tsx:71`。

## 6. Native Back 的精确层级

`lib/native-host.ts`注册同步boolean handler，按priority降序，任一返回true消费；异常安全消费；后台不可执行Back。onAppState(false)通知各listener并停止系统朗读 / 暂停audio/video，不向HAP注入任意native操作或身份。

| 层 | priority | 实际先做什么 |
|---|---:|---|
| SpeakingRoom | 100 | 调requestClose；stop→整理/保存→失败保留/明确放弃；不能genericclose卸载 |
| MockExam | 90 | leave先关imagePreview，再关confirmSubmit，再保存interrupted；busy / failure留页；显式应急退出沿现有入口 |
| ThemeLibrary素材图片 | 50 | 只在preview时关图片。**模考题图关闭属于90的leave内部先处理，并不是另外注册50** |
| VocabularyLibrary | 30 | 先关详情，再关session卡；否则false让壳处理 |
| StudyApp壳 | 默认0 | 模考/口语交由各自处理；然后历史回放/打卡/主题/设置/安装/普通queue/非首页逐层处理 |

浏览器Back、屏内Back和NativeBack在新外壳共用相同产品退出门禁；不要只藏可见侧栏，却留Ctrl/Cmd+K、评审之外的快捷键或history直接绕出词卡/录音/模考。临时示意原型没有实现真实native protocol，必须显式标注。

## 7. v1.1 模块审查状态

模块契约对象：`speaking-v11.js`、`exam-v11.js`、`resources-v11.js`。已独立读取三个模块源码及配套CSS，三个 `node --check` 均退出0（仅语法，不运行真实媒体/存储/浏览器）。此阶段仍待根代理整合 / 新截图；未以文件存在宣布F01/F02/F04终审关闭。

### 7.1 Speaking 模块源码复核

五类任务及真实prep/answer时长已进入可达目录，带图、长文与日程材料有专门阅读面；保存中可回听、失败播放器/重试/下载/明确放弃齐全。requestClose在recording先整理/保存、prep先取消、saving留页、failure明确确认；Ctrl/Cmd+K和全局data-page捕获进入guard，避免generic跳页。再录 / 打卡仍以savedStates为门禁，下载不解锁；自评是本轮Set而非新增AI评分或Recording字段。

工程指出的口语打卡max600与现有240冲突、历史朗读45秒却播放器28秒两项，作者已修为max240与按selectedHistory的45/28秒；复读源码确认。播放器写明静音演示、下载说明不生成文件，符合阶段边界。新桌面 / 手机失败和退出代表图仍须亲见后才判断F01画面是否完整。

### 7.2 Resources 模块源码复核

材料步骤 / 访问条件 / 原站与打卡分离、完整七项偏好、三种备份、安装 / 来源 / 历史回放已加入。导出 / 合并 / 恢复均显式是fixture，不触发真实文件选择或存储；没有新增学习JSON恢复、历史录音删除 / 下载或原生云认证。

工程指出的resource-return取消无handler、默认0次首次打卡硬跳3次、空格称呼customValidity不清除三项，已复读确认修订：取消返回origin并恢复scroll；materialStats只加本次1次/实际分钟；name输入清自定义错误。合成checkin保留`[资源:voa-budget-cuts]`、title、换行note并slice1000，仅内存暴露为lastCheckinFixture。进入真实实现后，必须用addCheckin成功返回代替fixture立即成功。

### 7.3 Exam 模块首轮发现与待复读

已有LC音轨/题图、长/多材料、手机答题卡、RC交卷确认、保存失败/截止、退出保存失败应急路径、旧制预检和七Part结果；真实结果成功门禁与原题身份说明方向正确，播放/计时/IDB均未运行。

已向作者与根代理具体报告五项仍需修的演示契约：

1. 提交→submitting只有disabled等待，无从普通作答连续进入result的路径；exit-saving同样需演示成功后的返回。可加明确的“模拟保存成功/失败”或短fixture回调，不需真实接口，但不能仍只靠评审page选择器。
2. 旧制材料/题号仍硬用现行147–150、148、176–180；旧制Part7从153开始，多材料区域181起。当前说明“旧制Part7为171–200”亦不精确。根据format动态派生，不能只改标签。
3. 旧制声明42:30但原截止仍用当前45:00示例的09:45/11:00及26:50；若共用09:00开始应为09:42:30/10:57:30，固定剩余也要与相同elapsed对应。固定fixture不等于可以内部自相矛盾。
4. 点击C/D待保存后提示、交卷/退出说明仍硬写B；应显示examChoice，且未保存数量与clear答案一致。临时fixture选择不能标已持久化。
5. LC选项/清除也统一进入save-error，而原listening判定未包含save-error，导致失败场景切到RC多材料和RC截止。须保留失败前的phase/material上下文；不因保存失败提前进入阅读。题图选项也不可固定为C而忽略当前临时选择。

另建议模态重绘后焦点移入首个可用控件、关闭返回原submit-open / exit / image稳定action；生产用既有Dialog而不搬手写trap。

这些都是补稿内容 / 连续呈现问题，不是要求新增存储模型、真实计时或设备测试。等作者修订后追加复读，不将此首轮发现当作当前已关闭。

### 7.4 F01 / F04 新画面的独立亲见复核

根代理整合后，本工程评审通过`view_image`直接查看 `screenshots/v1.1/` 下8张新图：

- `mobile-speaking-save-error-recovery.jpg`（390×844滚动局部）：同一视口可见本次录音播放器、未保存风险、重试保存、下载保留、放弃并离开。失败保留能力确实出现在画面，已消除旧稿“保存成功后才可回放/导出”的错误门禁。
- `mobile-speaking-discard.jpg`：明确临时音频风险与留在这里 / 重试 / 下载 / 确认放弃四动作，失败不被永久锁退。
- `desktop-speaking-directory.jpg`：5类真实任务、各自时长、历史回听与单题专项边界；不是只有一个朗读入口。
- `desktop-speaking-saving.jpg`：长朗读材料、保存中可回听、自评 / 参考入口、再录 / 记录收获停用；没有把保存中误显示已保存。
- `desktop-resource-detail.jpg`：三个学习步骤、访问条件 / 外站使用、打开原站与学完记一笔、原材料记录位置齐备。
- `mobile-resource-checkin.jpg`：实际1–240分钟、负荷、可选手记、返回材料及取消，不自动把打开计为学习。
- `desktop-preferences.jpg`：称呼、听读 / 口语目标、日期、每日 / 每周预算、时区完整表单；与主题分离。
- `mobile-backups.jpg`：学习记录不含音频、词卡事件独立、模考媒体/答案/考试完整备份分别有入口；明确不新增学习JSON恢复。

**F01/F04的工程所审设计缺页现在已有可审阅画面回应。** 仍由同一独立终审者判断是否满足其全部关闭条件。以上图片不证明浏览器互动或Blob /文件/网络真实成功；手机长截图固定底栏横穿中部不能直接当运行遮挡，实际滚动 / 键盘 / 末端操作留待实现验收或作者独立UI取样。

### 7.5 Exam 修订中复读（未作为最终冻结结论）

已复读12:28、46,879字节版本，前述问题已大部落实：添加明确评审模拟submit / exit成功失败动作；旧制题组153–157 / Q154、181–185 / Q183；clocks按format计算固定LC/RC；examPhotoChoice与listening-save-error保持LC失败的材料和截止；模态入口focus与关闭返回stable action具备。

继续向作者指出最后上下文收尾：reading-single选项失败仍应保留单篇而不是换multi；错误标题要跟实际题号；单篇“延迟时几点通知”选项A为before8:30，原review统一B / Room204解释须按kind修为一致。待作者最终冻结及根代理新模考图后再复核。这里没有要求真实计时或新增模型。

### 7.6 最终模块源码冻结复读

独立复读 `exam-v11.js` 12:32:03 / 48,718字节版本并再次`node --check`退出0（该检查只读文件、不运行媒体或真实存储）。已落实：

- submitting / exit-saving有明确隔离的评审模拟成功 / 失败控制，作答→提交→成功结果与退出返回形成连续演示；结果仍只在模拟“保存成功”路径出现，失败没有假成绩。
- 旧制题组、题号、LC/RC固定原截止按format派生，旧制42:30与09:42:30/10:57:30对应；不把45:00现行deadline套旧制。
- examPhotoChoice / listening-save-error保留LC材料与计时；clear失败不提前转RC；readingKind保留单篇Q148 / 旧Q154或多材料Q178 / 旧Q183；保存 / 清除 / 未保存数量使用当前临时选择。
- 只读单篇正确答案A和8:30前通知依据、多材料正确B和Room204依据分别呈现；正确 / 错误标签按当前选择计算。不是把所有原题解析强套同一答案。
- 模态初始焦点、关闭返回稳定action、LC / RC退出原阶段和原deadline、explicit应急退出具备；Ctrl/Cmd+K不会绕出专注考试。

**本轮F02模块源码契约已没有新增的工程P1缺口；可供新图审阅与同一独立终审者复验。** 我尚未亲见根代理最终冻结后的模考截图，因此不把源码结论扩写为所有F02画面已验。作者报告的50状态VM事件检查是作者证据，不冒称为本评审的真实计时 / 浏览器复测。

模块只读快照SHA-256：

| 文件 | SHA-256 |
|---|---|
| speaking-v11.js | `BDE2105640A49B5A73BA37B79F4AA2D8BC64CD1435BCAC83E32B4F6990E58B2F` |
| exam-v11.js | `33800109F5FD966DD559C4DF17D63F309D7390B5FE1B3DB0969FD086016569E5` |
| resources-v11.js | `6C93E9CEE1645599B38CF1409EC6A21000191CF7F3AC6E5701FF0BCC39750DB9` |

以上快照后的继续修订须以最新文件复读；本文件不阻止作者补稿，也不修改独立终审原结论。

补充终读：随后源码快照 `2922268F4ADA7E80AE16B7216038E0718864E45B7566B5FAA12AA782544F1015` 又将旧制多材料限制为2篇、现行为3篇。独立对照`exam-model.ts:211`确认旧制Part7必须153–180单篇、181–200双篇，与当前模块format布局一致。已请作者把旧制解析中残留的“材料3”引用删为仅邮件已有Room204依据；这是文案自洽收尾，不是模型或接口扩张。

### 7.7 可交同一独立终审者复验的结论

工程实际核实了保留能力 / key与DB / 退出及交卷门禁，并与作者修订模块对照；F01/F04亲见8张新稿，F02模块主要工程问题已修。仍保持原独立终审“暂不通过”的历史与当前状态，根代理将冻结版本、更新图和逐项响应送回同一评审者。

本工程审查未新设“真实设备测试必须先做”的设计前置；也不以静音播放器、模拟交卷或作者VM检查冒充真实Blob、音轨、deadline或数据持久化验收。真实实现后按这些契约做行为 / 设备验证。本轮只写审查文档及读取源码 / 图片 / 文件hash，未改生产、原型、真实数据库、部署或设备。

### 7.8 最终 F02 六张画面的独立亲见复核

最终模考图就绪后，本工程评审直接用`view_image`查看 `screenshots/v1.1/` 下6张（不是根代理浏览器操作的转述）：

| 文件 | 亲见的具体设计内容 |
|---|---|
| `mobile-exam-listening.jpg` | 原题包A/v1、LC阶段、原截止09:45、剩余26:50；完整轨45:00 / 已用18:10；不自由拖动/倍速或暂停考试；题图和放大入口；未选题与已保存其他13题；LC答题卡只Part1–4 |
| `desktop-exam-multireading.jpg` | 176–180题组三份材料，材料跳转入口；Q178题面 / 选项与已选B待保存；答题卡146/200及RC提交整卷；原截止11:00、剩余32:36；阅读面无游戏装饰 |
| `mobile-exam-submit.jpg` | 确认交卷包含146已保存、54未保存=53未选+1已选待写；说明本题B未保存、原截止不变、交卷后不可修改；返回检查和仍按已保存答案交卷两个选择 |
| `mobile-exam-exit-error.jpg` | 中断标记未保存，不显示退出成功；保留已存答案；32:36/11:00原timer；留在考试、重新读取重试、明确未保存仍退出的应急动作 |
| `desktop-exam-legacy-precheck.jpg` | 2006旧题型、format、v2、题量10/30/30/30/40/12/48；声明2,550,000ms=42:30、实测示例匹配、RC75:00；程序预检与人耳确认分开，开考前不计时；旧制不作为现行基线 |
| `desktop-exam-seven-parts.jpg` | 原题包A/v1、首次/主动交卷、本机记录ID；LC62/100、RC57/100、漏答54；全部7Part的正确/总量/漏答/率/驻留时间；原题解析、完整备份和回目录入口；不预测正式分数 |

所看fixture数学一致：45:00−18:10=26:50；146+54=200，53+1=54；119正确+27错误+54漏答=200；7Part正确合计119（LC62/RC57）、漏答合计54；驻留用时合计01:27:24，与结果页示例总时长一致。这里核对的是演示样例，未验证实际判分或已保存146题。

**F02现在已有可审阅关键画面，所看六图未发现新增工程P1。** 配合模块对照，F01/F02/F04从旧稿缺页改为具体画面 / 动作回应；是否满足全部独立终审关闭条件仍交同一终审者，不在本工程文件将“暂不通过”改为通过。

截图风险与有限收尾：

- 长截图证明材料与操作的排列，不能证明701–1023断点、真实滚动中题面 / 答题卡可达、焦点顺序、读屏、200%文字或末端按钮不遮挡。未亲见的timeout / 旧制结果 / 精听听写其他新图仍不冒称全部亲查。真实数据与设备验收依后续清单，不作为本轮设计先决测试。
- 旧制预检尚未开考便显示“复测第1次”，可在开考前表达为“将记录为复测”或“下一次记录身份”，避免误读已有正在计时的attempt；当前没有据此宣判数据被创建。
- 最后源码文案仍应核对：旧制双篇review不可引用不存在的“材料3”。当前工程已请作者 / 根代理条件化为原邮件的Room204依据；无需因此新增模型、媒体或整页画面。
- 根代理另做的是隔离browser fixture互动；本评审没有操控共享browser，不能把其结果写成自己的真实音轨、deadline、IDB、Blob或NativeBack测试。

独立终审意见、作者补稿与本工程证据均保持原始结论；根代理最终送回同一独立评审者复验。真实实现后的行为/设备验收单独记录，不拿“设备未测试”阻塞完整设计补稿，也不拿fixture成功冒充生产通过。
