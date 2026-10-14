# 证据问题清单与处置顺序

基线与执行边界见 [README](README.md)。P1：实际数据可靠性缺口，或改变相关边界前必须完成的门禁；P2：下一轮渐进整理；P3：有消费者清单后再清理。没有本轮证据支持P0故障、账号数据泄露或大规模重写。这里的建议均未实施。

## 已复现的可靠性/契约问题

| ID / 优先级 | 结论与可达条件 | 路径/符号与证据 | 建议与验收 |
|---|---|---|---|
| F01 / P2；录音云存储变化前必修 | 录音上传的D1/R2幂等契约不完整。同owner同ID上传不同音频返回200，R2新字节而D1旧duration；不同owner复用已占用ID可返回200但该owner无D1行。第二种是持有Blob的授权POST边界路径，普通UI随机UUID碰撞未复现；学习JSON恢复因无Blob也不单独触发它 | `app/api/recordings/route.ts:7`先R2.put后D1 onConflictDoNothing；`db/schema.ts:5`recordings.id全局主键；`lib/use-study.ts:95–97`200即uploaded=true。实际TS路由+内存SQLite/R2替身，探针 RECORDING_MUTABLE_BLOB/FALSE_ACK均成立 | 冲突先验与owner作用域；同ID相同内容可幂等，不同内容409；R2/D1提交协议应避免半完成和孤儿；仅在验证owned行/匹配字节后ack。测试D1失败、R2失败、同ID同/异owner、丢响应后重试和元数据字节一致性。测试审查建议P1，数据审查建议P2；集成采P2并保留变更前门禁，理由见评审记录 |
| F02 / P1 | `putAudio`只有complete/error处理，无transaction abort终态；注入仅abort事件后Promise悬挂、db未close。可能使口语保存状态无法结束 | `lib/use-study.ts:8`；`speaking.tsx:21–24,32`保存/退出等待；`evidence/native-audio-abort-probe.cjs`输出pending、onabort undefined、dbCloseCalls=0 | tx complete/error/abort只结算一次并关闭；记录本机持久化成功后才形成完成状态；失败留可重试Blob。需真实IndexedDB abort/quota和ArkWeb复验。本轮仅合成事件模型，未证明实际设备稳定发生 |
| F03 / P1 | 损坏的**主学习快照JSON**被读取成null/空StudyData；用户下一次新增打卡会覆写原损坏字节，失去后续恢复机会 | `lib/use-study.ts:14–16`readSnapshot吞parse错误；`:34`persist覆写同key；MALFORMED_SNAPSHOT合成hook探针。已有`study-invariants.test.cjs:220–223`保护的是辅助profile/recording键，未覆盖主快照 | 损坏读取进入只读/隔离状态，保留原字节并明确导出/恢复动作，不自动空初始化；坏主快照、坏op、未来版本、存储失败、refresh/跨标签均测试，确保错误后原字节和其他分区保持 |
| F04 / P2 | API接受`2026-02-31`的profile.examDate/checkin.date，严格备份解析拒绝，导致可保存但不可恢复。正常date输入控件未证实生成此值 | `api/study/route.ts:14,16`regex/Date.parse；`study-backup.ts:6,11`validStudyDate；`study-model.ts:26–28`round-trip；DATE_CONTRACT实际TS API+SQLite探针返回200且backup reject | 提取共享Profile/Checkin/Theme契约；测试闰日、非法月日、空考试日、时区、旧主题ID。先定义非法历史记录隔离/修复策略，不能直接新增严格验证让既有数据无路可恢复。初提P1后经讨论采用P2，见评审记录 |
| F05 / P2 | 并发同owner同qid首答均查询空历史，可写入两条mode=first。**当前统计没有证实错误**，firstAttempts仍按createdAt/qid重新选择 | `api/study/route.ts:30–31`查询与insert分离；`study-model.ts:78`；FIRST_RACE探针两first行 | 将首答“标签”契约与派生统计分开；后续原子分配或派生返回，保留全部不可变事件；并发/离线乱序/重试测试，不倒写createdAt或删除一条记录 |

复现脚本在 [evidence](evidence/README.md)。Node退出0表示缺陷断言被复现，不表示生产行为正确；既有335项回归全通过也不能否定这些未覆盖路径。

## 架构与UI边界

| ID / 优先级 | 影响与证据 | 整理建议/门槛 |
|---|---|---|
| F06 / P1，四主题实现前 | 当前Theme是配色+固定IP栏目图，新无IP日/夜无法仅换颜色兑现；旧root、html主题、atlas映射有不完整/差值。`study-app.tsx:53,64,71,74–84,110`；`globals.css:35–43,109,305–313`；`art/themes.json:6,75,144,213` | 一份根级完整语义token+theme素材policy；明确旧hollow/silk/paper/crystal映射；模考/Portal全状态四主题矩阵。已存在root基础token，不能写成模考完全无主题。主题改版不改学习schema |
| F07 / P2 | StudyApp集中导航、弹层Back、计划/统计、内容、主题/SW/安装事件、打卡及设置；MockExamOwner集中会话、媒体、导入和视图。跨责任修改易碰保存/时间/退出语义，判断不是文件大小。`study-app.tsx:39–70,95–110`；`mock-exam.tsx:73–264,267–358,393–544` | 先纯视图抽取，再controller；保留原回调、生命周期、FIFO、expected revision、绝对截止和durableSubmitted。不要换全局状态库或一次改所有文件 |
| F08 / P2，结构化资料UI前需定契约 | QuestionMark/ResourceTask/学习restoreBackup已接模型/API/hook，主界面未消费；资源关联仍隐藏在可编辑note子串。`use-study.ts:154–193`；`study-app.tsx:36,108`；`resource-library.tsx:18`；`exam-collection.tsx:19` | 旧note读取adapter与稳定checkinId并存；checkin才计实际分钟，task只预算；旧note不自动生成新的任务/历史。错因/任务编辑、学习恢复UI明确分阶段，不宣称已完成 |
| F09 / P2 | 词典首次全文件15,636,030字节读取/SHA/JSON校验与84,979词索引在主线程；宽泛查询全量filter/sort后才呈现24项。`vocabulary-library.tsx:32–35,45–48,72–73`；`load-dictionary.ts:11–18`；`dictionary-model.ts:38–45` | 先测目标设备首次加载/中英文宽泛词/输入延迟/峰值内存，再抽LookupService考虑Worker/索引/分页；useDeferredValue不把算法移出线程。未实测卡顿/OOM，不声称已发生 |
| F10 / P2 | SpeechPlayer位于Practice功能，词典和口语横向依赖它；多套同步/备份缺共同能力说明。`vocabulary-library.tsx:17`、`speaking.tsx:8`→`practice.tsx:12–30`；`useStudy:35–132`、`useVocabulary:12–26`独立机制 | 原样抽共享媒体adapter；共享owner/transport错误与能力显示，保留领域store与不同复习算法。不得因重复间隔数组统一词卡与答题事件 |
| F11 / P3 | 旧身份辅助与素材/导出接口需消费者清单。`app/chatgpt-auth.ts:getChatGPTUser`未见当前page/API消费者；`sync-web.mjs:38–40`强制旧图；`NativeDownloads.ets:9–24,102–110`固定JSON/音频文件名和v0.2.3 ZIP允许项 | 清理前核对框架/用户旧包；导出文件名/MIME是宿主合同；无SPA fallback的`Index.ets:14–28,238–265`不得贸然加新URL路由。先标注兼容用途，后单独移除 |

## 测试、发布与文档风险

| ID / 优先级 | 已有保护与剩余盲区 | 证据与下一步 |
|---|---|---|
| F12 / P1，身份/存储边界修改前 | API单测有真实SQLite/R2故障/并发，然而替换真实server-auth；部分替身Origin策略与实际函数不同。无本轮泄露证据 | `server-auth.ts:2–4`；`exam-library-api.test.cjs:37–39`；`study-data-v2.test.cjs:101`；`theme-persistence.test.cjs:151–154`。给真实helper直接契约测试，再做隔离workerd/D1/R2与受支持网关双owner集成 |
| F13 / P1，迁移前 | 已有空SQLite迁移、种一条profile后升级、IndexedDB v1→v3原行保留/旧页版本门禁；仍缺完整旧D1数据集、真实迁移账本和中断恢复 | `core.yml:72–82`；`study-data-v2.test.cjs:27–33`；`exams.test.cjs:365–379`。按发布schema建立合成带数据fixture并比较全部领域，不否定已有迁移测试 |
| F14 / P1，原生宿主改动前；其余P2 | 常规Harmony CI只共享资源/工具，SDK在source-release另跑。Core/发布/npm test范围不同；历史16条云库浏览器流程未成为持续CI脚本；现浏览器阻止SW | `harmony-web.yml:27–39`；`source-release.yml:54–62,93–97`；`core.yml:54–55`；`full-exam.cjs:194,283–412`；`theme-browser.cjs:173,177–187`；`dictionary.cjs:11,33`。分域验证矩阵、受控云库浏览器/SW suite、原生改动SDK门禁；不把resource检查升级成HAP验收 |
| F15 / P2/P3 | VM/手写hook替身、profile schema、CSS覆盖跨迭代重复；lint未纳入当前CI，未本轮运行故不宣称失败 | `study-invariants.test.cjs:10–18`；`repo-review-regressions.test.cjs:11–34`；`dictionary-ui.test.cjs:7–27`；`globals.css:145,272–276,369,454–461,670`；`codex-setup.sh:21–25`。逐组提取小型测试助手、共用纯校验，保留断言；局部新变更规则先行，避免全库格式重写 |
| F16 / P2，本轮给替代入口 | 旧架构把模考写作计划、未列vocabulary_events/exam_library；NATIVE/Harmony README早期“未安装”不能替代v0.3.3验收。marks/tasks/学习恢复UI待办仍有效 | `ARCHITECTURE.md:11,15,25,31`；`NATIVE.md:13`；`harmony/README.md:7`；`CODEX_HANDOFF.md:222,229` vs `PROJECT_STATUS.md:19–33`。本目录提供冻结现状/分类/索引，保留旧验收时间；后续独立小改重写旧入口，而非继续累加“最新”段落 |
| F17 / P2 | 学习与词库本机journal全量扫描，学习ack新增后不回收，Web GET全量返回；没有增长预算/安全压缩合同。未测到当前容量超限或卡顿 | `use-study.ts:12,17–26,56,85`；`vocabulary-model.ts:39–47`；`api/study/route.ts:17`；`api/vocabulary/route.ts:8`。先测历史量与配额、定义checkpoint/ack留存及多标签/未上传保护，再做压缩；不得仅按年龄删作答/首答/未确认op |
| F18 / P2，原生导出改动前 | NativeDownloads active job在回调彻底丢失时缺超时/取消恢复，后续导出可能持续被拒；本轮只读失败路径推断，未见设备实际卡死 | `NativeDownloads.ets:87–99,108–114,155,162–184`。设计有界watchdog/显式取消和任务generation，保留已下载文件、清临时job；合成回调缺失/晚回与真实设备导出中断再验。不能以重装/清数据作为恢复方式 |

建议先处理F02/F03及相关行为回归，再将F01/F04的录音与校验契约收敛纳入近期小版本。UI方案可继续在隔离原型中推进，相关实现须先明确F06/F08/F11的边界；测试门禁随所改领域执行。详细阶段和停止条件见 [TARGET_AND_PLAN](TARGET_AND_PLAN.md) 与 [VALIDATION_AND_ROLLBACK](VALIDATION_AND_ROLLBACK.md)。
