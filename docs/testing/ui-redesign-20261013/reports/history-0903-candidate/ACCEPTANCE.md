# 界面重设计 v1.1 本机实现验收

**当前结论：未通过。** 同一独立终审发现 I01 未保存录音的 owner 交接仍有 **1项P1**，I02–I11有**10项P2**；Root正在修订。下文416/34、双构建与beyeqowt HAP只绑定09:03冻结候选，均是本次整改前证据，不能绑定后续源码或称全量实施已验收。原生设备与正常文件选择器也尚未完成。

最新独立报告原文见[IMPLEMENTATION-INDEPENDENT-REVIEW.md](reports/same-reviewer-implementation/IMPLEMENTATION-INDEPENDENT-REVIEW.md)，SHA及复制时间见[证据复制清单](reports/FINAL-COPIED-EVIDENCE.json)。该报告优先于早先C01–C09作者辅助代码收尾；C09壳展示修闭不等于I01录音交接关闭。

I01原账号草稿改用新账号回调的路径已由key边界阻断，但保存失败Blob/录制片段仍只留在将被卸载的SpeakingRoom内，没有在外层交接到原owner恢复、下载/明确放弃界面。I02–I11分别为未保存模考选择跨题、口语Browser Back、历史媒体后续失败、查词执行查询/取消加载/私人计数/历史断点/词卡焦点、解析查词返回、toast主题与专注壳层。详尽触发条件和验收要求保留在原报告，不删失败记录。

对象为本机 `vocab-work/theme-redesign-20261012/site` 的 `feat/ui-redesign-v11` 分支，HEAD `12317b26b85a71888760b0cc18242d00a843ac74` 加本轮未提交实现。它保留 PR #42/#43/#45 的既有业务；不能以 GitHub `main` 或旧部署代替此工作树。本轮没有推送、合并、发布、部署、手机安装、真实学习数据整改或新增云题包上传。

## 实现结果

共享 React 界面已按审定 v1.1 集成：桌面侧栏与移动五栏、今日任务优先级、独立查词主视图与详情、练习、复习、进度、资料库、口语和完整模考使用一致的布局、字体、控件与状态。页面统计来自实际记录；查词结果不自动生成复习记录。旧词条 ID、首答/复练、模考原截止、已有备份入口、题型与账号边界保留。

四主题为“默认日间 / 默认夜间 / 空洞骑士 / 丝之歌”，持久 ID 仍为 `paper / crystal / hollow / silk`。新用户默认日间；已有用户配置不重置。主题通过只保存 `theme` 的现有操作更新，业务状态共用；body 语义 token 覆盖模考 early return 和 Portal。默认日/夜不带空洞骑士素材；两游戏主题仅在普通界面使用 48px 原创意象，专注学习中移除。原有素材库保留，素材目录校验不等于再分发授权。

搜索保留查询、分类、已展结果、原滚动与原控件焦点；Ctrl/Cmd+K 尊重 IME 与上层弹窗。练习失败重试保持同一 AttemptID、时间与用时，成功保存后才前进；退出确认与原生优先级保留。资料详情作为主视图，并在返回目录时等待父布局提交后恢复位置。录音保存、失败重试/下载/放弃及显式再次返回保留；播放 URL 和异步请求受 owner/生命周期约束。

模考桌面材料、题目、答题卡并列，移动流式展示；答题卡保存成功后下一帧定位当前题，普通上一/下一题保持材料内位置。提交后按持久原答显示只读结果；错误项、正确项和漏答有文字与语义色，未提交时不泄露答案。模考 FIFO、revision、原始截止与评分模型没有因界面改版改变。

跨账号读取中/不可读时，壳层昵称、复习徽标和主题使用安全展示投影；不会把旧 owner 的数据投影到新账号，也不会持久化空数据或迁移/清理用户存储。学习、词库、模考记录和私人云题包四种状态分别提示备份/同步；原生本机与 Web 账号同步仍有独立边界。

## 检查分层

| 层级 | 当前已核实 | 本报告不扩大到 |
|---|---|---|
| 行为/模型/受控组件测试 | 整改前候选全量 **416/416**，fail/cancelled/skipped/todo均0：[日志](logs/full-study-test-owner-final.log)。模考反馈22/22、owner展示2/2与该候选owner边界相关21/21均为相应范围，已包含在全量416中。 | ReactDOM 全部浏览器行为、真实 OS IME、文件选择器、设备麦克风。 |
| 构建后契约 | 整改前候选 **34/34**，fail/cancelled/skipped/todo均0：[日志](logs/mjs-tests-owner-final.log)。 | GitHub CI、公开部署、生产账号验证。 |
| 类型/内容/素材 | 整改前候选 `tsc --noEmit` exit0：[日志](logs/typecheck-owner-final.log)。前阶段内容检查为68听读题、5口语题型、22资料引用；素材4主题/12原图/19引用/19派生，相关数据/素材未在该候选末轮UI修订中改变。 | 全部内容质量、素材许可或全部链接可达。 |
| Web 与共享 mobile 构建 | 整改前候选两种构建 exit0：[Web日志](logs/web-build-owner-final.log)、[mobile日志](logs/mobile-build-owner-final.log)。mobile JS1322.97kB/gzip404.61kB，CSS373.40kB/gzip60.73kB；>500kB警告保留。 | 安装成功、ArkWeb 全部行为与性能验收。 |
| Chrome 实际界面 | 320/390/840/1440 等有限视口的首页、主题、查词、Part6、复习/进度/资料、口语初始、合成 RC/提交/原答结果已取证；详见截图索引。 | 全状态/全主题组合、200% 放大、真实麦克风、完整两小时考试。 |
| 独立代码审查 | 早先辅助代码C01–C09在各自源码/受控范围修闭；同一终审后发现I01 1P1及I02–I11 10P2，当前未通过。Root追加owner/nativeMode key重挂的作者回归21/21不覆盖未保存Blob交接，不能计I01关闭。 | 实际设备、未执行的浏览器流程，或新问题已经关闭。 |
| 独立视觉审查 | IV01–IV05在各自范围关闭；独立评审者亲见48张，53张索引的亲见文件48/48尺寸/字节/SHA一致，39张sample全亲见，5张未见均excluded；自身IV项没有未修P1/P2。明确整体仍未通过I01–I11。 | 尚未取证的页/状态、toast接线/专注壳落实与全平台一致性；48观察数不等于48张当前界面全通过。 |
| Harmony HAP | 整改前候选冻结后SDK实际编译 exit0，1,071资源逐字节/SHA一致；09:03:26 UTC重新枚举1,228限定构建输入新增/缺失/修改均空：[proof](reports/simulator-readiness/build-lantern-ui-v11-beyeqowt/final-freeze-proof.json)。 | 签名、安装、模拟器启动、原生 UI、真机升级保数据。 |

这些数字分属不同范围，不相加为“全部流程总数”。09:03候选的416与34直接核对落盘日志尾部；类型/双构建exit0来自Root实际执行结果。407/413与08:19HAP均属更早阶段；全部旧日志均不能绑定正在进行的I01–I11整改。

整改前候选 HAP 为 `D:\zzl\托业学习\vocab-work\ui-redesign-implementation-20261013\simulator-readiness\build-lantern-ui-v11-beyeqowt\lantern-ui-v11-unsigned-local-only.hap`，**44,282,830字节**，SHA-256 `1fa43622e1c740d76a943889de69b9778d5466dc0892f0be3be7765655cccb8a`。归档时再次读取实际HAP核对字节数/哈希；44MB包体保留在staging，不复制入Git文档。它不是I01–I11修复后的包，后续必须重新冻结核对。

构建身份为 `com.lantern.toeic`、`0.3.3 / 20009`、debug、SDK `26.0.0.105`、min/target API12，未签名。source manifest SHA-256 `9ab3644d25288c954f3c5f7e44ddddb1378af55b57163e1bf33b16f1ea80f5d9`。1,228是明确runtime/build-input集合，排除docs/tests/reports等参考说明；public随包的许可/署名仍保留，详见[SOURCE_SCOPE](reports/simulator-readiness/SOURCE_SCOPE.md)。不是把旧1,278减为1,228文件丢失，也不是整个仓库文档/测试冻结。

## 实际浏览器流程与数据范围

普通界面由 `http://127.0.0.1:41881/` 的实际 `StudyApp(nativeMode)` 渲染。该隔离 origin 起始无数据，QA 过程实际完成 4 道原创 Part6 首答、形成 1 次启动，没有提交打卡分钟或录音。图中的 4/1/0 与原设计示例值无关。真实搜索观察到英文 `reservation` 与中文“预约”各6条结果、`zzzz-no-word-qa`无结果状态、详情及返回保持；填入中文不等于真实系统输入法验收。

练习实际核验了详情进入不会误弹退出、Escape/浏览器返回产生退出确认、取消后保留状态、四题完成后打卡弹层仅关闭自身并保留详情/查询。Root旧390px Chrome真实流程为资料库底部“导出听读与口语记录”控件→CtrlK→来源返回/浏览器Back，恢复scrollY5342及原焦点；Root最新1440px真实流程为 B1–B2 最后一行→详情→目录，恢复scrollY3372、原行焦点与父级前导内容。第三类独立Root/Root+Resource受控probe另以模拟布局预设5342，不能与上述实际值混算。截图本身不证明scroll/focus，三类来源在[evidence-index](evidence-index.json)分别记录。资料详情新图为1440px桌面内容两列（左步骤/条件、右动作），错标390px版本与其字节相同，不作为手机底部证明。口语仅查看目录与信息题初始布局，未发起真实权限请求或录音。

模考使用独立 `http://127.0.0.1:41883/?examLibrary=1` 可见 QA 装载页。它调用实际 repository 的 `importBackup`，只接受预定 owner、包 ID/版本/指纹与两条合成记录；首次导入 1 包/2 记录成功。HMR 后旧备份与同 ID 已变更记录发生冲突时，真实接口正确拒绝；后续只读“查看已有 QA 模考记录”没有覆盖记录或绕过冲突。

fixture 为 `qa-ui-redesign-20261013@1` 的 200 道合成结构题，图像 32×24 PNG、音频 20 秒静音 WAV。它验证实际解析器、RC 材料/题号导航/保存、提交、七 Part 表和持久原答的 UI 边界，不证明真实听力完整、真实题包或连续前台耐久。原复测截止 `2026-10-13T09:04:02.945Z`（Chrome显示17:04:02）持续推进，没有重置。复测原147答案变更为 B 后仍为3条持久答案，实际提交为 1/200、197 未答；首答独立原 A 保留、2/200，解析只读。截图83:15用时来自合成恢复时间线，不是本轮实际考试耗时。

## 剩余具体阻塞

| 项目 | 实际状态与原因 | 后续所需 |
|---|---|---|
| 正常 JSON 文件选择器 / 恢复入口 | CUA 正常 file chooser 的 `setFiles` 失败：Chrome 扩展缺少“Allow access to file URLs”。未修改扩展权限或采用原生点击绕过；fixture seam不补算此项通过。 | 受支持文件访问能力到位后，用同一隔离 fixture重新走正常入口。 |
| 模拟器启动与新构建安装 | 本轮尚未启动/安装新构建；原三个实例停机，旧存储未清理。 | 先确认独占目标与保数据，再用受支持设备接口验收。 |
| ArkWeb 实际 UI | Native CUA disabled；现有 provider只提供 Chrome/IAB/MCP Apps，没有任意 ArkWeb/CDP attach；生产 ArkWeb debug 默认关闭。未开端口/HDC UI bridge绕过。 | 已支持的 ArkWeb 或原生 UI 控制能力；SDK构建继续独立归档。 |
| 真实麦克风、扬声器、前后台、原生 Back、Pura X Max 内外屏 | 本轮未执行，受控媒体/生命周期测试仅证明对应逻辑。 | 独立设备回归及原生返回/录音保存顺序取证。 |
| 外部资源链接 | 23 条检查均为网络 `TypeError`，当前限制不能判断 URL 失效；保留失败 JSON。 | 网络可用环境再查，不以此报告为坏链清单。 |
| 性能与无障碍完整验收 | 整改前候选mobile JS1322.97kB/gzip404.61kB、CSS373.40kB/gzip60.73kB，仍有>500kB分包提示；前阶段120条指定token对比检查与部分真实控件值独立记录。 | 首屏/低端设备性能、200%放大/文本间距及完整键盘/读屏验收。 |

本归档工作线没有发起 `require_escalated` 或待审批操作。父会话提及的 manager 审批 ID 没有可读状态接口，也未由本工作线发起；不能据此宣布“还卡审批”或“审批已解除”。当前可证的阻塞是工具能力/浏览器文件访问，不影响 Web、代码与构建证据归档。

## 证据与历史

- [截图范围与替代索引](SCREENSHOT-INDEX.md)，[逐文件尺寸与SHA](evidence-index.json)。截图留在正式 `screenshots/`，本稿不重复改写图片。
- [独立代码审查](reports/independent-code/IMPLEMENTATION-CODE-REVIEW.md)，[独立视觉审查](reports/independent-visual/IMPLEMENTATION-VISUAL-REVIEW.md)，[原样复制清单](reports/COPIED-EVIDENCE.json)。独立报告中的历史小节保持原文，最新追加结论优先。
- [最终日志及SDK证据复制清单](reports/FINAL-COPIED-EVIDENCE.json)、[Harmony构建报告](reports/simulator-readiness/BUILD_RESULT.md)、[包体完整性](reports/simulator-readiness/build-lantern-ui-v11-beyeqowt/hap-integrity.json)、[构建与设备能力边界](reports/simulator-readiness/DEBUGGER_SCOPE.md)。旧候选/失败日志仍在原staging，最新归档只绑定beyeqowt。
- 原设计 [v1.0 未通过报告](../../design/ui-redesign-20261013/reviews/FINAL-INDEPENDENT-REVIEW.md) 与 [v1.1 独立复验](../../design/ui-redesign-20261013/reviews/FINAL-INDEPENDENT-RECHECK-v1.1.md) 保留。
- 原工程作者阶段报告 [UI_REDESIGN_IMPLEMENTATION_20261013.md](../UI_REDESIGN_IMPLEMENTATION_20261013.md) 保留，不将当时未验证项抹去。
- 独立架构审查目录 `docs/reviews/2026-10-13-architecture/` 不被此归档覆盖；存储损坏快照/录音ID问题仅为原架构审查建议，没有借改版整改真实数据。

下一步由Root完成I01–I11整改并提供新证据，再由同一独立终审评审者复验，重新冻结测试/构建/HAP；其中toast与专注壳需新实际截图。IV01索引已经独立关闭，尚未支持的原生设备/正常文件选择器继续单列。已完成的候选Web、代码与构建证据保留，不因整改而把历史失败覆盖成成功。
