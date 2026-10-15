# CT-r14 持续推进门禁只读复核

结论：**STATIC_REVIEW_NO_NEW_BLOCKER**，仅适用于下面核对的最终候审SHA及本次同域门禁。r13的 **STATIC_FAIL_SUSTAIN_CONFIRMATION** 独立保留，不改写为通过。此结论不是SDK、浏览器、原生播放、声音、独立QA或发布验收。

## 最终审查对象

工作区：`vocab-work/ct-sustain-guard-20261015/site`，继承r13 `e315884`；本审不分配或修改最终冻结buildId。

| 文件 | 实际核对的SHA256 |
|---|---|
| `lib/lesson-audio.ts` | `995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0` |
| `app/learn/practice.tsx` | `97dce7aeda2b8e53ec6d7bacdaeb944a57e91ae68637d5b90ed2d3c7104e6b4f` |
| `harmony/entry/src/main/ets/pages/Index.ets` | `e1f0558417f08217e5d61a014617f58eb2b060eb10071e37361d83e8fc9f28b4` |

此前 `89e465…`、`d960cf…`、`ec317359…`为中间版本，不能引用其审阅进度代替本SHA。实现负责人报告最终三文件聚焦63/63、差异检查通过，并保留两个原反例对r13的负对照；本审实际读取源码及相关既有测试，未复跑或替代那些执行证据。

本次仅新增本文档，没有修改运行时、测试、版本或冻结身份，没有执行测试、SDK或设备操作。

## 原反例A：静止回调补足750ms

`lesson-audio.ts:90–113`现只有当前真实前进的timeupdate可以调用accept：

- playing及play Promise不再调用accept；stationary或回退观察在第108行返回，不推进计数、不更新最后推进时间，也不调用accept。
- 第109–112行要求相邻真实推进间隔为正且不超过500ms；同瞬突发或超过500ms间隔会从当前观察重新建链，不沿用旧累计推进。
- accept同时要求至少3次推进、链跨度至少750ms、最低媒体位移、当前观察等于lastAdvanceAt/lastProgress，以及未暂停、未seek、同源和启动位置/时长校验。

r13确切序列在本版不能确认：1×，t0位置T，t200/400/600各前进.2秒，t800仍T+.6。最后一次stationary timeupdate在第108行直接返回；迟到playing或resolved play也没有确认入口。若长停之后再出现新前进，超过500ms会重建链，旧3次推进不能补入新链。

该规则是有界的媒体位置采样证据，不声称连续人耳出声。初始playing后短暂不动，随后以正确.85×速率形成足够真实推进的新链，仍可通过；不会把全部启动延迟认定为失败或根因。

## 原反例B：NaN锁定时长绕过短尾

第82–87、117–120、135–144、165–181行共同封住该路径：

- ready只从有限正duration建立metadataDuration，已有锁时在seekAssigned/started的提前返回之前先检查一致性。
- seeked之后的start重新检查metadata就绪、duration有限且与metadataDuration相符；preparedDuration取已验证锁定值。
- 普通接受最终再走validStartPosition，包含同一时长校验。
- 短尾显式要求metadata/current/prepared时长有限正且一致；remaining、expectedMs、elapsed、tailMs、observedTailMs均须有限，并执行各自正值、上限与墙钟比较。

原目标8秒、metadata为12秒、seek中duration变NaN、后来恢复12秒并在3秒时ended的反例，现会在seek后start之前拒绝；即使其他入口尝试进入短尾，非有限锁或派生值也不能靠NaN比较绕过拒绝条件。旧baseline保留。

## 同域追加边界

### 准备之后的额外seek

第133、185–187行安装并清理seeking监听。只有同代有效请求已经started且实际 `audio.seeking=true` 时受控失败；正常请求的暂停seek尚未started，不被误判。迟到通知且flag已false也不据此终止。已起播的长轨、短尾和已确认轨不能把一次额外seek的跳跃混入原证据链。

### 已确认后的采样、暂停与正常片尾

第33、39–48、95、181行新增内部confirmedDuration锁。sample必须满足当前duration有限正且与确认时长一致，才可更新baseline；普通confirmed后的pause/ended也先核对此锁。修订前“锁定12秒→无先到durationchange/timeupdate→duration变9并ended→直接sample保存9”的同域边界现已封闭；不一致时保持最后确认点。stop/dispose之后锁清空，capture仍读取保留下来的baseline。

### 短尾的观察时间与回调重入

除从playing起算的总墙钟和最多1500ms剩余条件外，第170–178行检查首个真实前进位置到片尾所需媒体时长及实际观察墙钟：后者至少为对应尾段时长的80%。首个实际前进还须在playing之后 `min(500ms,理论剩余时长×80%)` 内发生，且位置不晚于剩余段的80%；ended距离最近实际推进不得超过500ms。迟到首进度、首点接近片尾、同瞬ended或陈旧推进不能补足完整尾段。原waiting/stalled中断条件、同源及位置上界仍在。

这明确采用安全失败策略：如果短轨/短尾的真实timeupdate过于稀疏，无法提供及时首点和近期尾段观察，即使真实音轨可能已经结束，也会保留旧定位并报受控失败。本结论不声称所有短尾或所有ArkWeb事件节奏均受支持；正向能力须按真实设备证据限定。

第181行在confirmed回调后再次检查valid/token。如果同步回调启动、取消或处置了另一代请求，旧短尾不再继续执行ended/stopped去取消新代。该保护与现有请求清理相符。

## 调用方与宿主契约

`SpeechPlayer`和Index指纹与r13相同。play/resume/pause/stop/dispose/position接口、confirmed回调签名均未改变。未确认时position仍返回baseline，SPlayer的played/source/owner门禁继续在确认后接管保存；失败、显式取消或duration失配不把DOM零点写成已确认定位。

控制器诊断仍使用原固定prefix、四stage、23个event及18个reason。新增内部metadataDuration/confirmedDuration/lastAdvanceAt没有改变消息schema；seeking失败复用已有 `rejected/progress-position`。原六个nullable字段（含preparedDuration）、数值/布尔、seekable和events投影与Index一致，无新增字段被宿主拒绝。异常名称的固定安全收窄仍是有意的隐私边界。

宿主与JS日志均有既定预算，原生onConsole触发和HiLog可见性仍须实际验证。此前常驻mediaError的迟到事件风险仍未取得原生证据；本审不将其扩写为当前根因或新阻断。

## 交接边界

在最终SHA不变的前提下，本次两个原反例及审查中确认的同域边界已在源码上封闭，可交根总确认stable并建立新的r14身份、执行其授权验证。任何后续运行时变化应重新绑定SHA审查。实际ArkWeb seek/playing/timeupdate时序、持续推进、日志采集及独立QA结果，仍由对应证据决定，不能由本静态结论代替。
