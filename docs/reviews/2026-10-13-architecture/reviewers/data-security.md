# 数据可靠性与安全独立评审意见

- 评审日期：2026-10-13。
- 评审者：data_security_review；另委派 native_boundary 对原生桥、麦克风、下载作只读子评审。
- 源码范围：`vocab-work/theme-redesign-20261012/site`，Sites 独立历史，`main`，HEAD `12317b26b85a71888760b0cc18242d00a843ac74`。以临时 `git -c safe.directory=...` 核对工作树，开始时无未提交输出；未修改该 checkout。
- 任务限制：仅源码、文档与合成测试；未读真实学习数据、私人题包、密钥、签名，未访问生产 D1/R2、浏览器用户存储或设备，未发布、推送、合并。
- 注意：任务中的 `hooks/use-study-data.ts` 在此基线不存在；实际学习入口为 `lib/use-study.ts`。以下路径与行号均相对此 site。
- 原生路径简称：`Index.ets` = `harmony/entry/src/main/ets/pages/Index.ets`；`NativeDownloads.ets` = `harmony/entry/src/main/ets/NativeDownloads.ets`。

## 给 UI 设计线的边界

1. **四条持久化链路必须分别表达。** StudyData v2（学习/打卡/录音元数据）使用 `lib/use-study.ts` 和 `/api/study`；词库事件 schema 1 使用 `lib/use-vocabulary.ts` 与 `/api/vocabulary`；模考使用 `lib/exam-storage.ts` 三表 IndexedDB；个人云题包使用 `/api/exam-library` 的 D1 目录和 R2 文件。`app/study-app.tsx:69` 的“已同步”仅来自 useStudy，不能扩成模考已云保存。
2. **HAP 的账号能力与 Web 不同。** `mobile/src/main.tsx:10` 固定 `owner={null} nativeMode`；模考本机 owner 是 `app/study-app.tsx:71` 的 `harmony-local-device`。Web 缺身份时模考拒绝匿名回退（`app/learn/mock-exam.tsx:25–30`）；原生打开系统浏览器取得题包，返回 App 导入（`app/learn/exam-library.tsx:41–43`）。题包下载不是学习/模考记录云同步。
3. **主题保留稳定存储 ID 与字段级写入。** `Theme = hollow | silk | paper | crystal`（`lib/study-model.ts:1`）；`StudyApp.changeTheme:61` 使用 `useStudy.saveTheme:145–149`；服务端 `theme` 操作原子 `json_set`（`app/api/study/route.ts:22–26`）。新视觉可替换展示标签/素材，但未经迁移不得改 ID，也不要用完整 saveProfile 实现配色切换。
4. **备份不能统一标成“所有内容已保留”。** 学习 JSON `audioIncluded:false`（`lib/study-backup.ts:17–19`），只含录音元数据；词库 JSON 只有事件；模考完整 JSON 含题包资产与考试历史（`lib/exam-storage.ts:166–177`），但不含口语录音 Blob。口语原始音频须单独下载；云题包只含题包。学习恢复把 imported.uploaded 清为 false（`:27–33`），真实当前账号的已确认副本才可保留。
5. **保存状态、错误与退出保护应跟随持久化结果。** 模考不以计算超时提前揭答案（`app/learn/mock-exam.tsx:149–152`），需持久化交卷；录音在本机写入失败时需要保留 Blob、允许下载/同 ID 重试，不能因超时自动显示“已保存”。
6. **原生文件导出有固定协议。** `harmony/entry/src/main/ets/NativeDownloads.ets:9–17` 固定文件名+MIME 白名单（学习、词库、模考 JSON、周复盘 Markdown、两种录音），`:102–110` 只收本地 origin Blob 与两种打包 ZIP。改导出名称/格式须同步原生合同与验证，否则原生会拒绝。
7. **媒体就绪不等于内容审校或人耳验收。** `lib/exam-model.ts:163–172` 为媒体白名单/头部检查；`app/learn/mock-exam.tsx:123–138` 顺序图片解码；`lib/exam-ui.ts:53–74` 为听力时长兼容门禁，仍不是完整听音/题目答案认证。

## 已有保护，整理时应保留

| 边界 | 实际证据 | 结论与限制 |
|---|---|---|
| 学习离线操作、账号切换 | `lib/use-study.ts:10–28,38,56,133–143` | 每操作独立 key；ack 后日志仍修复跨标签快照；代次/activeKey 防过期异步回写，pending 按 owner 过滤。不要直接删除 ack 日志来节省空间。 |
| 服务端判正确、用户数据隔离 | `app/api/study/route.ts:17–18,28–38` | GET 按 uid；POST 比对 X-Lantern-Owner；correct 用服务端题目重算；旧全局 ID 冲突显式422。不能把客户端成绩直接当可信分数。 |
| 可变标记/任务的取消与冲突 | `lib/study-model.ts:45–59`；`db/mutable-study.ts`；`docs/rfcs/0003-study-data-v2.md:15–29` | revision→取消→mutationId→规范内容，与 SQL 原子 upsert 一致；取消是持久 tombstone，不是移除数组元素。已有真实内存 SQLite 回归覆盖。 |
| 词库数据 | `lib/vocabulary-model.ts:19–48`；`lib/use-vocabulary.ts:15–25`；`app/api/vocabulary/route.ts:17` | 不可变事件、owner+eventId复合键、冲突内容拒绝、25条批次、25秒超时/取消。read失败阻写；原生 owner=null 保持本机。 |
| 模考数据 | `lib/exam-storage.ts:59–71,92–113,137–150,174–220,224–243` | IndexedDB完整事务/abort处理；题包同ID版本不同指纹拒绝；有考试历史的题包禁止移除；owner绑定、revision检查、原子恢复、旧代码版本门禁。未来整理不能回退到localStorage大JSON或临时内存。 |
| 模考计时与判分 | `lib/exam-model.ts:258–304,344–384`；`lib/exam-ui.ts:38–45` | 绝对截止、时钟高水位、不暂停重置；备份成绩重新派生；owner/题包指纹/格式绑定。题包参考分区间来自该套材料，不能混成官方分数。 |
| 云题包事务与下载 | `app/api/exam-library/route.ts:47–64,74–77`；`lib/exam-library.ts:29–50` | D1原子预留count+bytes、R2 SHA验证、失败补偿与可见保留项、删除tombstone；下载长度/SHA/UTF-8/整卷解析后导入。服务器不展开大JSON是明确选择，目录metadata由上传者声明。 |
| 私人响应与PWA缓存 | `lib/server-auth.ts:4`；`app/api/recordings/route.ts:8`；`app/api/exam-library/route.ts:29–30`；`public/sw.js:5–7` | API private,no-store；音频/题包nosniff；SW跳过api/auth/query，不缓存用户导航响应。静态缓存不可改成笼统缓存所有GET。 |
| 原生桥与权限 | `lib/native-host.ts:31–53`；`Index.ets:280–316`；`NativeDownloads.ets:42,80–94,102–137` | JS桥只提供前后台/Back；麦克风限制本地来源与前台代次，下载固定白名单、OS目录与随机文件名，删除只用自身job.path。未确认越权漏洞。 |

## 问题清单（独立建议）

### DSG-01 · P1 · 损坏学习快照静默降为空记录，后续写入覆写原字节

- **证据/符号：** `lib/use-study.ts` 的 `readSnapshot:13–16`，parse在JSON异常时直接返回null；`load:136–137` 因未抛异常认定已加载；`persist:34` 后续写入正常快照。
- **实测：** `data-security-probes.cjs` 的 MALFORMED_SNAPSHOT 用既有 hookHarness 执行实际 useStudy。合成截断快照加载后 ready=true、sync=local；新增打卡返回true并覆写原损坏字节，attempts=[]。没有触碰用户数据。
- **影响：** 原有仅在摘要中的远端记录/档案可能变为空；独立journal可挽救部分记录，但不能保证还原所有数据。无首次使用与损坏现有数据的区分。
- **建议：** 区分missing、malformed、future-schema；损坏快照进入只读/可导出原字节状态，保留原key或隔离副本，先审计修复后再写；不要自动删除或覆盖。复用词库“读失败阻写”的语义。
- **回归/回滚：** 无key的新安装仍初始化；损坏JSON/结构/required-schema保留原字节，普通操作返回未保存；健康journal仍可展示但不伪造完整恢复；未来schema继续阻写；回滚不删新隔离副本、不回写旧空快照。

### DSG-02 · P1（条件式）· 音频事务只发 abort 时保存 Promise 永不完成

- **证据/符号：** `putAudio`（`lib/use-study.ts:7–9`）只监听complete/error，没有abort；`addRecording:185–190`等待putAudio；`SpeakingRoom.persist`（`app/learn/speaking.tsx:14`）无法成功或失败收敛，`:30,38`一直显示正在保存、阻止退出且不提供失败态下载/重试。
- **实测：** 子评审实际TS转译后的putAudio注入内存IndexedDB abort-only，得到 `onabortHandler=undefined, promiseState=pending, dbCloseCalls=0, expectedFaultReproduced=true`。脚本 `native-audio-abort-probe.cjs`；没有真实ArkWeb或设备复现，发生率未验。
- **影响：** 原始Blob仍在内存，用户可能只能强退，存在丢失尚未持久化音频风险；没有声称真机已经丢音频。
- **建议：** transaction complete/error/abort统一一次性收敛与db关闭；保留原Blob与原ID，进入可下载/重试错误态。超时只是未知保存结果，必须查询/重试，不可伪确认完成。`getAudio`也应定义abort与数据库关闭行为。
- **回归/回滚：** abort-only、quota、readonly/generation切换、成功后迟到事件、重试同ID、后台双事件都不悬挂/不伪保存/不生成新ID；旧Blob key保持，不引入删除或重编码。回滚保留失败态和Blob出口。

### DSG-03 · P2 · 录音 API 的幂等与确认合同弱于学习/词库

- **证据/符号：** `/api/recordings.POST`（`app/api/recordings/route.ts:7`）先BUCKET.put(`recordings/${uid}/${meta.id}`)，再D1全局id主键onConflictDoNothing，未检查owned row/内容；`db/schema.ts:5`全局id；`lib/use-study.ts:95–97`收到200即uploaded=true。
- **实测：** 实际POST+内存SQLite+R2替身：(a) 同owner/id换Blob并把duration从2改9返回200，R2被替换而D1保留duration2；(b) 另一owner已占用id时返回200，当前owner的D1行数0，产生未被目录引用的owner-scoped对象。未证明跨owner读取泄露。
- **触发限制：** 当前正常录音使用随机UUID；普通UI未复现冲突。学习JSON恢复不含Blob，单独跨owner恢复会停在missing，不能声称它就会触发该POST路径。场景需可上传Blob的授权请求/异常重试复用冲突ID。
- **建议：** 明确录音不可变内容合同与idempotency fingerprint；owned行校验后才确认；不同payload同ID拒绝，重复相同请求幂等；D1/R2分布式写入用预留/完成/补偿语义避免孤儿与旧元数据新音频。主键迁移另评估，不自动改旧ID。
- **已有覆盖与空缺：** `tests/study-invariants.test.cjs:333–361`覆盖坏表单与练习发生时间；`:287–301`覆盖远端确认修复，但没有录音D1冲突、同ID不同Blob或失败补偿用例。
- **回归/回滚：** 同ID同payload不重复；异payload拒绝且原Blob+metadata保持；其他owner占用id不假确认；R2成功/D1失败与相反失败可审计；只有确认owned完整副本才uploaded=true。保留旧对象与映射，禁止清桶回滚。

### DSG-04 · P2 · Profile/Checkin 日期合同漂移，服务端接受备份不可恢复的数据

- **证据/符号：** `app/api/study/route.ts:14` profile.examDate使用regex+Date.parse非NaN；`:16`checkin.date仅regex；`lib/study-backup.ts:6,11`用严格`validStudyDate`（`lib/study-model.ts:26–28`日期round-trip）。
- **实测：** 实际API把`2026-02-31` profile/checkin保存为200；实际备份解析分别拒绝。架构评审者独立确认相同漂移。
- **影响/等级回应：** 能出现服务端已接受、备份不能恢复的档案/打卡。建议P2：正常date输入未证明生成非法日，当前导入也先严格校验；触发面主要是脚本/旧客户端/未来表单。可与P1同批提取共享合同，不能将单一探针扩大为用户已有坏记录。
- **建议：** profile/checkin schema进入共享纯模块，API和备份复用；请求大小按真实读取字节有界，不只信Content-Length（study:19；recordings:7）；历史非法值先只读盘点/报告再决定修复，不静默把2月31日改成3月3日。
- **回归/回滚：** 闰日/非法日/时区/未来时间一致验证，合法旧备份重复导入不变；旧schema fixtures与API契约同跑。迁移只增加限制，不覆写既有日期；保留原值与修复依据，撤回校验不删数据。

### DSG-05 · P2 · 首答 mode 的 read-then-insert 存在并发标签错误

- **证据/符号：** `app/api/study/route.ts:30–31`先查题历史再插mode，非原子。
- **实测：** 实际route + SQLite，对两次历史查询设合成并发闸门，两POST都200、同owner/qid有2条mode=first。
- **反证/等级限制：** `lib/study-model.ts:78`的firstAttempts按createdAt重新选qid首答；`StudyApp:40,55`首答统计用该函数。故不能说现有首答正确率被重复计数。影响是持久mode标签与真实首答语义不一致，以及未来消费者误用风险。
- **建议/标准：** 定义mode是否只是历史标签；若保留其权威含义需原子首答判定或canonical首次索引；所有统计继续从不可变事件推导，保留首答/复练ID。并发/逆序/离线上传回归；不要批量重写历史mode做整理，也不删“重复”尝试。

### DSG-06 · P2 · 本机日志与全量同步缺少增长预算/安全压缩协议

- **证据/符号：** `lib/use-study.ts:12,17–26,56,85`每次扫描操作日志，ack只新增不回收，persist也扫描/合并；`lib/vocabulary-model.ts:39–47`事件分片全扫描；`/api/study.GET:17`与`/api/vocabulary.GET:8`每次全量读。
- **判断：** 静态容量/复杂度风险，未证明当前用户已经达到瓶颈。学习localStorage包含summary+op+ack多份；词库最多100000事件是单次解析限制，不等于自动压缩或配额预算。录音Blob与模考则占IndexedDB，容量指标应分开。
- **建议/标准：** 先合成长期/多标签/离线负载测字节与时延，再定阈值；压缩须checkpoint+epoch/回放保护，确认所有标签能恢复且待同步与取消tombstone保留，不能删ack后丢跨标签修复能力。逐账号显示存储与处理状态。回滚保留旧日志直到确认迁移；失败仍可读旧key。

### DSG-07 · P2 · 原生导出 active job 未定义回调丢失后的恢复

- **证据/符号：** `NativeDownloads.ets:114,155`设active并启动；`:87–99,162–184`仅invalidate/fail/finish清除；下次`:108–110`永远显示已有导出。未见超时/显式取消。Index只在页面重载/容器消失invalidate。
- **判断：** 仅静态失败路径，未做ArkWeb回调丢失故障复现；不是确认设备缺陷。
- **测试盲区：** `tests/native-lifecycle.test.cjs:10–23,66–159`执行TS/TSX和React/浏览器替身；本子评审在tests/scripts/harmony scripts/workflows未找到执行上述两个ArkTS安全状态机负例的测试。既有SDK编译和设备正常导出证据不能代替这些负例。
- **建议/标准：** 可查询job状态或显式取消/重试，有界等待并核验真实落盘；清理只针对自身partial path，不能删除用户已有完整文件。测试picker取消/背景/迟到回调/重复finish/半写入/同名碰撞/引擎回调丢失；设备验证另验。回滚保持原白名单和已导出文件。

### DSG-08 · P2（发布前置）· 身份真实性依赖 Sites 网关合同，仓库单测不能证明部署隔离

- **证据/符号：** `lib/server-auth.ts:2`直接信`oai-authenticated-user-id`；`:3`safeMutation允许无Origin；`worker/index.ts:29–43`转发handler，无应用级签名/token验证。API另有owner比对、绑定查询、private响应。
- **结论：** 这是当前托管网关边界，不是已确认漏洞。仓库不能证明网关剥离外部伪造header、拒绝绕过或Worker直连私有；本评审也未探测线上入口。仅凭“header可传”不能声称当前私有站可越权。现有测试auth是替身。
- **建议/标准：** 把网关不可绕过与header可信作为明确部署契约，迁移到独立Worker/手机号公共入口前必须提供受控测试；原生身份仍保持关闭，真实provider/token验证、限流与公开访问决策单独评审。未经用户授权不公开Site。失败保持原私有网关、功能关停，不用伪验证码/前端owner冒充认证。

### DSG-09 · P3 · 原生指南状态与当前交接不一致

- **证据：** `docs/NATIVE.md:13`仍以2026-09-15未签名/安装验收未完作为当前描述；`harmony/README.md:7,65`类似；README与`docs/PROJECT_STATUS.md`最新v0.3.3及`docs/testing/HARMONY_PHONE_QA_2026-10-11.md:18,27`已有真机录音/冷启/覆盖安装证据。
- **建议：** 给历史段落加日期/范围并指向当前状态；不能把旧未完成状态覆盖现有证据，也不能把老版真机验收扩成当前所有原生安全场景已验。

## 渐进式整理建议与迁移门槛

1. **先封住保存与损坏读边界。** DSG-01/02先独立修复，暂不搬key/schema。产出可失败、可保留、可重试的StorageResult/错误合同，UI只显示已确认状态。DSG-03/04并入共享schema/录音协议小批次。
2. **建立四套独立 repository/service 合同。** 先抽纯验证与命名空间，保持StudyData2、词库1、模考备份1/IDB3不变；Study hook只编排同步和UI订阅。不要用统一泛型“数据同步器”抹去模考本机、语音Blob与云题包差别。
3. **再整理增长/协议与发布边界。** 长期合成负载取得容量/时延基线，审定checkpoint、游标和渐进恢复；原生下载增加可执行状态机，账号网关契约纳入受控部署检查。仅在后续用户批准执行时动生产实现。

每阶段共同门槛：只增加兼容迁移；旧fixture与备份两次恢复幂等；ID、createdAt、原首答、题包指纹、取消状态、截止时间不变；账号切换/迟到回调不读写前owner；quota/abort/网络未知结果不伪成功；合成故障测试+Web实际浏览器+匹配版本SDK/专用设备分别记录；私有数据迁移先原始备份与checksum，不向公开仓库归档；回滚保留旧存储/原对象映射，不能卸载清数据、清桶或自动删历史。

## 本轮验证与评审回应

- 本评审运行：`node --test tests/study-invariants.test.cjs tests/study-data-v2.test.cjs tests/vocabulary.test.cjs tests/exams.test.cjs tests/exam-library-api.test.cjs tests/exam-storage-removal.test.cjs tests/theme-persistence.test.cjs`，Node v24.13.1，**142/142通过**，0 fail/skip。真实TS模型/SQL与fake IndexedDB/React/R2使用合成材料；不是线上/设备验收。
- 原生子评审独立运行：`node --test tests/native-lifecycle.test.cjs tests/lesson-audio.test.cjs`，**12/12通过**；仅TS/TSX和合成浏览器/React环境，不执行ArkTS/SDK/设备。
- 新诊断：`node reviewers/data-security-probes.cjs`（可用`LANTERN_REVIEW_ROOT`指向site），5组缺口确认，退出0表示**缺口复现成功**，不是修复通过；输出`data-security-probes.log`。使用实际API、内存SQLite、R2替身、既有hookHarness。`native-audio-abort-probe.cjs`另确认abort-only悬挂。
- 回应父评审提醒：mode race不等于统计重复；上传确认hook不弥补POST假成功；“学习JSON无音频”不等于“模考完整备份无媒体”；跨owner学习JSON恢复单独不会触发录音POST冲突（无Blob）；网络题包下载不等于记录同步。
- 等级分歧：父评审询问日期合同是否P1；本独立意见为P2，理由是实际API可复现、普通UI触发尚未证明，推荐与P1共享合同修复同批进行。录音上传冲突也列P2接口完整性问题，而abort-only保存悬挂列P1条件式可靠性问题。正式归档可由集成负责人说明最终等级与理由，勿抹去触发限制。
- 剩余未验证：生产网关直连/header剥离、真实D1/R2故障与清理、跨设备学习同步、低内存96MiB导入/224MiB备份、长期localStorage增长、真实ArkWeb事务abort/下载回调丢失、当前版本两小时连续前台/真实完整听音、权限拒绝/长后台/锁屏/多机型。不能用本轮合成通过补齐历史设备空白。

本稿是独立评审意见与脱敏证据草稿，供集成负责人形成正式问题清单、结论与归档索引；没有执行建议中的生产改动。
