# 回归、迁移与回滚标准

本文件给后续整理设置可验证的出口，不表示本轮已经执行重构/迁移。每次只跑与变更相关的门禁，发生新失败或改变边界时再扩大。合成数据及隔离环境优先，真实用户数据不作默认测试夹具。

## 1. 回归矩阵

| 变更范围 | 必须保留的行为 | 最低证据与补充 |
|---|---|---|
| 学习壳/纯view | 首答/复练永久并存；统计按最早createdAt；题组不截断；保存失败不前进；实际学习分钟仅checkin；Back弹层顺序 | study-invariants、study-data-v2、repo-review-regressions +真实React/Chromium合成流程；重新排列UI时覆盖空数据/真实结构历史，不能仅源码字符串 |
| 学习存储/同步 | owner切换旧请求失效；独立op/ack无跨标签丢写；未知schema只读；坏主snapshot原字节保持；超时/401/409阻塞和人工重试 | F03探针转成回归；合成双owner/双标签、响应丢失/晚回、Quota/JSON损坏；隔离workerd/D1集成，实际身份helper另测试 |
| 录音/媒体 | 权限迟回/后台/退出不启动错误录音；Blob落盘后才完成；abort/error一定终结；同ID幂等与D1/R2一致；回听不能信任导入uploaded标志 | native-lifecycle/lesson-audio + F01/F02失败注入；真实IndexedDB complete/error/abort/quota；独立SDK/ArkWeb许可、后台、冷启回听。字节hash与元数据一致，失败Blob可重试/导出 |
| 词库/查词 | 稳定旧ID/场景义；精确/前缀排序；中文/副义/词形可查；加载失败场景词仍用；收藏/自评保存失败不跳卡；未知ID计数不丢 | vocabulary/dictionary/dictionary-ui +真实全库浏览器；目标设备首次加载/宽泛查询/峰值内存测量。无离线音频条目提示正确，许可/署名可达 |
| 模考视图/controller | 绝对听力/整卷截止继续；先预检与本人试听再开考；FIFO/revision隔离；存储确认后才显示已交卷/答案；后台/音频故障标中断 | exams/exam-ui/exam-legacy + full-exam/listening-duration真实浏览器；合成活动卷冷启/退出/保存失败/交卷竞态，不替用户开真实考试 |
| 导入/恢复/移除 | 字节/MIME/magic/hash/fingerprint/owner/版本全部校验；全验证前不写；容量或事务失败原状态不变；已有历史包不可移除；恢复不倒退deadline/revision | exam-storage-removal/packer/legacy + fake IndexedDB及真实浏览器大包；未来版本、错误hash、同ID异内容、旧B0/新B1和重复恢复；备份结果结构与字节对照 |
| 私人云题包 | R2流式hash、D1容量原子预约、取消/失败重试；晚回包/切owner不污染；下载文件完整校验后才导入；云删除不影响本机已作答历史 | exam-library-api/ui +持续受控云库浏览器流程 +隔离workerd/D1/R2实际路由；客户端manifest不当来源认证；不包含模考历史同步 |
| 主题/全页面UI | 四套自洽，默认日/夜无IP全资产覆盖；root/atlas/mock-shell/Portal一套语义；theme-only不覆写目标；pref/reduced-motion/后台/离屏暂停 | theme-persistence/atmosphere +nativeMode/Web真实浏览器（320/390/840/1440）；页面×弹层×状态×四主题矩阵；computed style、focus/键盘、对比度、触摸、折叠屏和ArkWeb实图 |
| SW/PWA | 私有HTML/API不进Cache Storage；已开页离线本机记事件；冷启动离线说明；旧SW/旧标签页更新不倒写 | 单独SW-enabled合成suite；现有浏览器serviceWorkers:block不覆盖。公开哈希词典缓存与私有数据分开 |
| 原生宿主/构建 | 可信本地路径与资源范围、外链系统浏览器、有限下载名/MIME、Back fail-closed、授权前后台/generation | native下载/ability/工具测试、共享音频/资源哈希、真实SDK编译、HAP资源校验、签名、指定隔离设备覆盖升级。资源CI不是HAP可安装证明 |

## 2. 迁移前置

只有后续明确提出schema/key/owner/ID变更时才需要迁移。本轮不迁移。前置必须包含：

- 为每个已发布Study/词库/模考版本建立合成带数据fixture，覆盖首答/复练、取消标记、任务checkin关联、不同账号、音频、现行/旧制包、活动和已提交考试。
- 确定schema与旧代码写入门禁、D1迁移账本、旧key可读期和存储版本。原生IDB已是v3，旧App不能直接打开；旧代码无法保留新字段时必须只读阻止写回。
- 给出明确备份覆盖范围并校验能恢复。学习JSON不含Blob；词卡JSON独立；模考完整JSON含包/媒体/历史。录音迁移必须另保留真实Blob/云对象hash和元数据，不能只备份uploaded=true。
- 迁移先在隔离副本执行，逐字段比较；不使用真实个人备份作为CI输入，不把私包、音频、设备标识或签名上传仓库。

## 3. 迁移后比较字段

| 领域 | 不变量 |
|---|---|
| Profile | name/目标/考期/时区/预算/weeklyTarget/onboarded/theme在明确映射外保持；非法日期历史不得静默改成不同日 |
| Attempt/Checkin | ID、qid、choice、correct、createdAt、seconds、mode事件并存；按最早事件派生统计；checkin date/minutes/load/note保持，资源任务预算不新增实际分钟 |
| Mutable实体 | revision、mutationId、updatedAt、cancelled语义、reason/note/checkinId保持；冲突胜者规则与旧模型相同 |
| VocabularyEvent | ID、wordId、type/grade、starred/revision、createdAt保持；旧学习ID/未知词条不丢，复习间隔语义不换算法 |
| Recording | owner范围、ID、createdAt、duration/mime与真实字节一致；上传时间不替代练习时间；备份导入uploaded状态重新确认 |
| Exam | 原题/答案/媒体/fingerprint、attempt ID/owner/ordinal/revision/answers/questionTimeMs、interruption、绝对LC/整卷截止及submitted状态保持；不倒退已保存进度 |
| 云库与存储 | owner隔离、对象key/state/hash/bytes、容量计数、版本/唯一约束正确；失败没有部分数据替换或不可管理孤儿 |

幂等恢复应第二次新增0记录/0包；同ID不同内容和过时活动备份应明确拒绝且原数据不变。Quota、网络中断、交易abort和应用关闭后应能再次进入可解释状态。SQL脚本是否支持重复执行由迁移账本决定，不以强行二次执行DDL作为幂等定义。

## 4. 停止与回滚

出现下列任一项，停止该迁移/发布并保留现场：owner串号；原ID/createdAt/答案或媒体hash变化；首答/分钟/考试deadline倒退或双计；坏原字节被覆写；失败变成功；旧版本绕过门禁写入；Portal/Back使未保存录音或考试丢失；无法正常导出可恢复备份。

纯视图/token/查询adapter整理应保持现有schema/key/ID，可恢复旧代码并重新验证数据不变量。新增旧主题alias应持续可读，服务端兼容先行，不能回滚到拒绝新枚举的旧API。

存储版本升级不能仅重装旧HAP；回滚需支持新存储的兼容构建，或在隔离副本中经验证向前修复/显式恢复。D1/R2跨服务不具备单事务，须有状态机或提交/清理方案；回滚不删除未确认用户对象，也不以卸载/清数据腾容量。

正式发布需重新确认具体源码树、Sites保存版本/部署状态、Web包、HAP资源与版本号、签名及指定设备验收；当前GitHub堆叠PR与Sites独立历史不直接混推。回滚版本、源树和兼容边界在该次发布记录中列出，本轮不发布或选择线上回滚。

## 5. 本轮实际验证

| 项目 | 本轮结果 | 证明范围 |
|---|---|---|
| `npm.cmd run test:study` | **335/335**通过，0 fail/skip | 当前明确列表的模型/hook/API/组件合成回归；Node v24.13.1，非CI重跑 |
| `tsc --noEmit --incremental false` | exit0 | 当前TS类型；未写增量缓存 |
| 内容结构 | 68原创题、5口语提示、22官方资源记录校验通过 | 不是教师审校/题目标定/许可认证；当前精选书库数量另为15，不混计 |
| 素材目录 | 4主题、12打包原创、19外部参考、19用户地图衍生校验通过 | 不是视觉、对比度或版权授权审查 |
| 合成可靠性探针 | 5组缺陷断言 + 1组abort-only断言成立；root实际复跑exit0 | TS路由+内存SQLite/R2、hook替身、合成IDB事件；无生产数据库/浏览器/设备写入 |
| 独立数据审查针对性测试 | 142/142模型数据；12/12原生相关合成回归通过 | 由独立审查执行，部分为335套件子集，不相加成“489项全流程” |
| 外链reachability脚本 | exit1，23项均TypeError | 本受限网络环境未得到HTTP结果，不能推断23链接失效。脚本生成ignored `reports/resource-links.json`，仅HTTP诊断，没有下载题文 |
| Git/本地/托管只读核实 | 源树/PR堆叠、Sites版本18 source=12317b2，部署succeeded | 不是本轮部署，不读取私人云题包/学习记录；元数据证据见索引 |

未运行：依赖安装、全量lint、Web/mobile/HAP构建、实时CI日志重验、实际身份网关/D1/R2写入、浏览器视觉/性能/SW、原生SDK/签名/设备操作、真实两小时模考或人耳全程试听。历史报告保留原范围；本轮不把它们当重复验收。
