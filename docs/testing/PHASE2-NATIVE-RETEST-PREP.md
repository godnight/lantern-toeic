# P2-r2 原生复测准备：非空旧事实、IME 与本地音频

日期：2026-10-14 UTC；作者：微光-小开协作。**仅准备，未操作设备、安装包、导入导出或播放音频。** 本轮只新增此文件，不修改运行输入、夹具或小测证据。r2 包尚由 root 准备，须以其新交付清单为准；不沿用 r1 身份给 r2 放行。

输入：[最新 QA 结果](../../../../../项目组/QA-RESULT-P2-r1-20261014.md)、[有限原生报告](../../../../../项目组/QA-EVIDENCE-P2-r1-20261014/native/QA-NATIVE-P2-r1-RESULT.md)、[r1 交接](../phase2/IMPLEMENTATION-HANDOFF.md)、[合成夹具说明](../../examples/phase2/README.md)，以及本轮实际源码。r1 的进度页仍为 FAIL；非空旧记录升级、软键盘显示及真实音频均未通过。本准备不改写这些结论。

## 1. 先区分两种 seed

| 路线 | 能建立什么 | 当前限制 |
|---|---|---|
| **推荐：r1 真实 UI 建立合成旧事实，再 install-r 到 r2** | 旧 Study journal 的真实 Attempt 首答／复练、Checkin；旧词卡的 review、收藏与取消收藏；r1 自己生成的匹配 workflow | 使用实际产生的 UUID／时间，升级前后按 ID 比较。以下为源码已核对的动作路径，尚未经本轮原生执行；导出／系统 picker 仍须 QA 实测 |
| 预制 `examples/phase2/harmony-device/` 文件 | 固定 UUID／日期的旧备份、完整匹配 workflow、prepared 和缺引用输入 | 词卡有正常导入 UI；**Study 没有恢复 UI**。`workflow.json` 不会建立旧 Attempt／Checkin；手工新作答也不可能匹配其固定 UUID。因此不能单凭导入 workflow 证明正向原生恢复或带数据升级 |

已有 `seed-isolated-context.cjs` 只服务新浏览器 Context／loopback origin，**不能注入原生 `https://lantern.local/`，不能当作 HAP seed 通道**。本轮没有新增原生调试、私有数据库编辑或 seed 桥。若要完整固定 UUID 的原生正向恢复，仍缺另行审定的隔离测试 seed 通道；否则采用下面的真实 UI 基线，明确它覆盖自然生成的合成事实，而非预制样本全部字段。

## 2. 目标、包与安装前门槛

- 历史指定 QA 目标：`LanternUIQA4d5098e7` / `127.0.0.1:15551`；Pura90Pro、Harmony7/API26。r1 结束时保留了默认单词计划和 document 首卡模糊反馈，当前组未完成。**这是历史快照，执行前重新核对官方 instancePath、HDC 显式目标及仅含 QA 数据的归属**；不是当前连接结论。不能选手机或其它含私人题包的实例。
- r1：`P2-20261014-r1-2c3061fdf74b`，`com.lantern.toeic/entry/EntryAbility`，`0.3.4/20010`。已交 HAP：`vocab-work/phase2-20261014/tooling/builds/build-lantern-phase2-0w883ffp/lantern-phase2-unsigned-local-only.hap`，46,430,052 B，SHA256 `0a9d2760ddf6b52d06df95aa243bd14826b1dcbd90eaf719535a4406b5605e0d`。
- 若该指定实例确实仍装 r1，可直接在其上补合成基线，保留已有 QA 记录。若另建隔离实例，由 QA 明确选定后安装精确 r1；不能为“重新开始”卸载、清数据或覆盖已有未知分区。
- r2 必须先收到 root 的新 buildId、versionCode、完整 HAP 路径、字节／SHA、输入／资源清单及 `com.lantern.toeic` 身份。若覆盖安装不兼容或失败，停止并报告，不能用卸载解决。`install -r` 成功仅表示安装成功。

执行者可沿 r1 已用官方入口，所有 `QA_TARGET`／`R2_HAP` 均先绑定实际交接，不能猜测：

```text
hdc.exe -t QA_TARGET shell bm dump -n com.lantern.toeic
hdc.exe -t QA_TARGET install -r R2_HAP
hdc.exe -t QA_TARGET shell aa start -a EntryAbility -b com.lantern.toeic -m entry
hdc.exe -t QA_TARGET shell aa force-stop com.lantern.toeic
hdc.exe -t QA_TARGET shell pidof com.lantern.toeic
```

官方工具历史路径：`D:\zzl\harmony-toolchain\studio-26.0.0.821\sdk\default\openharmony\toolchains\hdc.exe`、`D:\zzl\harmony-toolchain\deveco.ps1`。本文件不执行这些命令。安装结果不确定时先查 bundle／进程和界面，不盲重试。

## 3. r1 通过 UI 建立非空基线并留底

每步用新 UI layout 的实际节点／坐标，不沿用 r1 旧坐标。称呼／备注标为 `SYNTHETIC P2-r2 QA`；不录音、不导入私人卷、不访问账号云库。

1. **Study 首答**：主导航「练习」→「自选一组」，专项 Part1、目标题数 1 →「开始自选练习」。记录实际标题／qid（无既有作答时首个内容为 `p1-01 / 会议室里的动作`，已有记录可能改变排序）。任选并记录选项，点「确认答案」；保存成功后才点「完成本组」。不要手改正确性或历史。
2. **Checkin**：完成页「记录时间与收获」→「确认这一组的实际用时」，填 7 分钟，备注 `SYNTHETIC P2-r2 QA baseline` →「确认并记下时间」。它是合成测试自报值，不是真实学习时长；只确认这一组一次。
3. **同题复练**：主导航「复习」→点击步骤1对应题目的行（即使标「已安排」仍有单题／整组入口）→再次作答并完成。本组选择「先休息一下」或「稍后确认」，**不再确认分钟**。预期保留第一次 Attempt，另有复练 Attempt，Study 中至少一个 Checkin；不能将复练覆盖首答。若内容是题组则整组完成，不拆组。
4. **词卡非空事实**：主导航「单词」→「浏览全部词条、旧词卡与收藏备份」；查找 `document`，可先「加入生词本」后「移出生词本」，留两次 mark 的递增 revision。可使用原有 document 模糊事实；若需新增旧 review，用该旧词库组件的「词卡自测」→「查看释义与例句」→「还没记住」或「记住了」。这里仍写旧 schema1 事件；查询／收藏本身不算 review。
5. **可选未知词输入**：在同一旧组件「词库来源与记录备份」→「导入词库记录」，选择 [harmony-device/legacy-vocabulary-backup.json](../../examples/phase2/harmony-device/legacy-vocabulary-backup.json)。它含 `synthetic-missing-word` 与 v-file 的取消收藏 revision2。**系统文件选择器 r1 未验**；需 QA 将这个合成文件放到正常 picker 实际可见位置并记录位置／文件 hash。当前没有已验的模拟器共享目录／传文件流程，不能虚构路径；picker 不可用则该项 BLOCKED，不写私有存储兜底。未知 ID 无法靠正常查词造出来，不能把 UI 查不到当作已覆盖。
6. **导出 B0**：设置（「外观与偏好」）→「记录分域备份」→「导出学习记录」得 `lantern-my-study-records.json`；旧词卡「导出词库记录」得 `lantern-vocabulary-records.json`；单词计划「把计划留在自己手里」→「导出工作流备份」得 `lantern-workflow-backup.json`。在系统保存对话框选择 QA 文件夹并保存，分别归档到 `B0-r1/`，不可覆盖同名旧证据。源码 `NativeDownloads.allowedBlob` 允许这三个 JSON 名，**实际保存／取回仍待验证**；只见 toast 不算取得文件。
7. **r1 冷启基线**：force-stop 仅此 App，查 pidof 后重新 start，再正常导出 `B1-r1-cold/`。先证明这些非空事实已在 r1 冷启保存，才执行 r2 install-r。没有可读导出时，截图仅能证明可见计数，不能扩大成全部旧事件升级保留。

原生旧 key 是 `lantern-v1-device`，词卡前缀 `lantern-vocab-v1:device:`；新工作流库 `lantern-workflow-v1`/v1，scope 为 `{"kind":"harmony-device","partition":"existing-device"}`。这些仅供核对，**不是要求直接写 key 的操作步骤**。

## 4. r2 保留数据复测与比较

1. 核 B0/B1、r1 bundle 与 r2 文件 hash → 对同一已核实 QA 目标执行 `install -r` →核新 bundle／build 关联 →启动；此时先不新增学习、反馈或确认分钟。
2. 正常导出 `B2-r2-first/`，冷启后再导出 `B3-r2-cold/`。比较 B0/B1/B2/B3：Study 全部旧 Attempt 的 ID/qid/choice/correct/mode/createdAt/seconds、Checkin 的 ID/date/minutes/note/createdAt；词卡全部旧 ID/wordId/type/grade/createdAt、mark.starred/revision；原计划／活动组 queue、cursor、原 step/command/receipt／待确认草稿。按 ID／规范字段比较，排除备份 `exportedAt` 和纯数组排序；若跨日产生新日窗口另记，不能借此掩盖旧事实变化。
3. 补 r2 已授权的进度页两主题／底栏复验，再走一遍词卡反馈与一次记时，**将升级保留检查与升级后新增动作分开**。新增事实要有来源，不要求 B3 与后续文件完全相同。
4. 可用 r1 自己导出的匹配 workflow 做重复恢复：单词计划「恢复工作流备份」选择 B0 的 workflow，两次均不新增旧事实／Checkin。不要用预制固定 UUID workflow 代替这份自然 UI 基线。

独立缺引用负例可在另一个新 QA context 使用 [harmony-device/workflow.json](../../examples/phase2/harmony-device/workflow.json)，但不配它的旧事实：应提示引用缺失／`reference-unverified`，prepared 不自动执行、不能揭义或补记时。它不是本正向升级环境的 seed；不要用负例污染 B0–B3。固定样本的 2026-10-14 ledger 与运行当日分开核对，不改系统时钟。

## 5. 实际 OS 键盘观察路径

| 当前 UI 路径／输入 | 观察与留证 |
|---|---|
| 单词→「调整计划」；「总覆盖目标」20、「每日新词量」3 | 先截图软键盘实际出现及输入前值，再用真实屏幕数字键输入；检查表单／保存 CTA 可滚动、焦点不被底栏遮住；首次 Back 是否先收键盘、再次 Back 如何处理页面。20 须满足当前真实已学下限，否则用合法值并登记，不制造历史 |
| 查词→「搜索单词或中文释义」输入 `reservation` | 此实际词为 `v-reservation`／「预订」。观察英文输入、精确词头优先、结果稳定后返回来源；不固定总结果数 |
| 同搜索框，真实中文 IME 拼音 `yuding` 并选「预订」 | 留候选栏与 composition 前／中／选词后的截图／layout；观察组成中不提前确认查询、提交后中文释义匹配。仅 `ui text 预订` 注入字符串不能证明 IME composition／候选／遮挡 |
| 完成组→「记录时间与收获」；分钟7，备注 `合成复测：预订时间`，先「稍后确认」 | 观察数字键盘→中文键盘、textarea／按钮滚动、Back 收键盘与草稿保留；不点确认则 Checkin 分钟不增加 |

r1 只证明 `ui text reservation` 的文本输入，聚焦截图没有软键盘。若上述真实点击仍不出现屏幕键盘，保留截图及“文本可输入、IME 不可见”的区分，IME 显示／遮挡／收起仍 NOT_RUN；需要 QA 提供可见输入法的隔离环境／手工通道。**不在此准备中更改模拟器输入法／硬件键盘／调试配置，不用 DOM composition 替身代证 OS 键盘。**

## 6. 现有免费本地音频的操作路径

只用包内已有合成音，不生成新音频、不接付费服务、不播私人录音／题包。以下文本与清单已静态精确匹配；时长来自既有 manifest，本轮未播放／重新测量。

| 入口 | 已有包内文件／清单时长 | 用途 |
|---|---|---|
| 查词 `document`→详情「听单词发音」 | `/audio/offline/43cc23fa52b87b4cc1d0.mp3`，1.539320s | 基本出声／重复点击；太短，不作为前后台持续播放样本 |
| 查词 `reservation`→同按钮 | `/audio/offline/9efa077f044e7a779c65.mp3`，1.754195s | 查词音源身份对照 |
| 练习→自选 Part3／目标题数3→首组 `p3-01 / 产品演示：问题是什么`→「听一遍，再选择」 | `/audio/offline/1935c17708c726884ac9.mp3`，33.151519s；完整 p3-01..03 组 | 足够观察播放中停止、后台、返回；若历史导致选中别组，记录实际 qid 与对应 manifest，不假称此音轨 |

动作与预期逐项记录，不能只凭波形或播放图标判有声：

1. 确认原生 UI 显示「内置合成语音」，默认1×；点击播放，记录实际系统音频输出／听者能否听到。若环境无可观察输出，只可报按钮／加载状态，系统出声仍未验。它是旧单声线合成素材，不是已通过自然度／真人／考试贴合的小样。
2. Part3 播放中再次点击同按钮（aria-label「停止朗读」），观察声音终止、按钮恢复，再点击应从头播放；视觉的 pause 图标实际执行 stop，不应声称暂停续播。
3. 播放中从可见系统 Home／最近任务进入后台；再经系统返回 App，观察声音已停且没有自动续播，仍需明确点击。源码 `installHarmonyHost.onAppState(false)` 会取消 TTS、pause 全部 audio/video；**实际后台通知到达与声音停止仍须同候选 HAP 实证**，不注入 JS 生命周期代替系统动作。
4. 播放中系统 Back：先核实际退出确认层。当前 `Practice.requestClose` 首次 Back 是打开「先结束这组练习？」；源码未在这个分支显式 stop，不能预写第一次 Back 已停音。点击「结束并返回」才卸载播放器，应停止；是否在确认层期间继续播放单列实测／缺陷，勿混同后台停止。
5. 若要观察播放器互斥，提交后「精听与听写」的两段回听依次点击，或停止后返回查词再播放；仅将实际标「内置合成语音」的段落记为包内播放。若某段显示「系统朗读」，单列免费系统 TTS 或跳过，不能冒充已核对的离线轨。记录前一声音是否释放；不同时操作活动模考／录音，也不改变普通练习分钟。慢速／逐句只作辅助，未测自然度不记 PASS。

依据：[SpeechPlayer／退出](../../app/learn/practice.tsx)、[包内播放器](../../lib/lesson-audio.ts)、[前后台桥](../../lib/native-host.ts)、[包内音频清单](../../mobile/offline-audio/manifest.json)。实际 UI／输出、系统 Home/Back、冷启及错误终态分别留证；一项通过不代替其余项。

## 7. 交给 QA 的精确缺口

- root 尚需交 r2 最终产物身份和安装兼容输入；本文件没有生成包或更新 QA 结果。
- 非空 native Study 基线可按源码 UI 路径建立，但原生完整导出／取回和上述基线动作尚待实际执行。导出失败时不能声称完成了字段级升级验证。
- 固定 UUID 的完整预制 Study 没有 native UI 恢复／受控 seed 通道；现有文件与浏览器 helper 不填补它。未知词负例还依赖实际 picker 可用，不能仅靠正常查词模拟。
- IME 是否可见、系统音频输出是否可听、前后台实际通知／停止，以及首次 Back 确认层中的播放行为都未验；给出明确路径后仍按实测记 PASS/FAIL/NOT_RUN。

本轮交付只有准备文档；没有执行设备动作、测试、音频生成、运行输入修改或证据改写。
