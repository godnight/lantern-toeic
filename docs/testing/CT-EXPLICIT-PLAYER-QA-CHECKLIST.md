# CT-r15 显式新建播放器：独立 QA 接收清单

2026-10-15。状态：**CHECKLIST_READY / INDEPENDENT_QA_NOT_RUN**。本文件是接收后复验门槛，不是验收结果。开发检查、Chrome 夹具与开发者原生观察分别保留；均不能代替独立 QA、用户批准或发布授权。当前设备窗口由 root 独占，QA 须先收到明确交接再操作；本文件编写没有操作设备或重跑测试。

## 接收身份与数据基线

| 项目 | 必须匹配的冻结值 |
| --- | --- |
| 候选 | `CT-20261015-r15-ba90c9bc3f45` |
| 版本 / bundle | `0.3.5` / `20030` / `com.lantern.toeic` |
| 源输入 SHA-256 | `ba90c9bc3f45bd5077606eedc3ad270c0c1706828e76ca650d3aa4844939b675`，1371 项 |
| 冻结清单 | 外层 `source-freezes/CT-20261015-r15/runtime-inputs.json`；文件 SHA `9117df64a3ffe5bbd08bfaeb1c2655fd76f39c8f34742b7a88673bf0ce7fb98b` |
| HAP | 外层 `tooling/builds/build-lantern-phase2-ge_wh24c/lantern-phase2-unsigned-local-only.hap`；46,516,804 字节 |
| HAP SHA-256 | `58cef7d206d7505de6b43fb504aa6bae887b105970909711e8f5af3413a3b16e`，本清单编写时已对实际文件重算一致 |
| SpeechPlayer SHA | `b06a76bedb0b017876535463a37d98fc57529d85406e0b1334792167afd4b0a2` |
| 新 wrapper SHA | `5690e49f40217b1976909ede026c64bb46b13bd0d49830405e894f9f130b072a` |
| 原 controller SHA | `995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0`，与 r14 字节相同 |

本树为 `vocab-work/ct-explicit-player-20261015/site`；下文“外层”均指 `vocab-work/ct-explicit-player-20261015/`。该 HAP 为本地 unsigned 工件，只接续已授权本地环境，不据此安装其他设备或发布。

- [ ] QA 交接记录注明设备标识、系统/ArkWeb 版本、包版本、实际 UID、起始 PID、前台页面和麦克风/renderer 状态；保存命令、stdout/stderr、退出码、UTC 和字节 SHA。既有 15551 观察 UID 为 `20020063`，新环境重新核实，不套用他人 UID 的流。
- [ ] 用正常 UI 导出 study/workflow/vocab 三域及导出回执，记录原始文件字节/SHA、目标 session/revision 与其音频 `trackId/sourceId/rate/positionSeconds`、unit/material hash。保留原件，不读取私有 AppDB，不注入状态，不导入、清库、卸载或降级。若需重新安装，仅按交接授权 preserve-data 升级，先完成新基线。
- [ ] 核对包内身份、设备版本及工件 SHA。身份不匹配、导出缺失或数据基线不明，记 **BLOCKED**，不开始候选判定。
- [ ] 接收 root 的最终开发证据清单；下文列出的在途前缀不是“已完成”声明。当前已知开发 1× r1 实际 pause→resume 间隔 87.437 秒，见 `r15-1x-r1-resume-gate.json`；其 `OBSERVED_LIMITED_GATE` 不等于独立 QA PASS，其余开发轮次以最终原件为准。

## 每一非零 Continue 的共同门槛

仅走可见按钮/系统 Home/Back/重新打开 App 等正常 UI。允许官方 UI 采集、应用既有诊断日志与系统只读音频状态；不执行 DOM 媒体操作、直接 currentTime、静音预播、播放 promise 替身、注入事件、修改存储或替换 URL。

- [ ] 动作前明确是“继续 听一遍，再选择”（或当前句子的“继续 …”），目标必须是已有正数保存点。保持同一 `sourceId`、track、unit/material hash、速率及暂停点；保存点精度取正常 workflow receipt 的 `value.audio` 与诊断 current/baseline，UI 一位小数只用于人眼比对，不能作为精确 seek 证据。
- [ ] 单次点击恰好建立一个新 controller/player；同 PID 内 `player` 与前次不同，无隐式多次 begin、失败后自动补建或 play 重试。以 `(PID, player, request, seq/uptimeMs)` 关联整条事件。冻结 wrapper 的单 factory 路径与新 player 日志共同支持重建结论；若缺少 DOM 对象级身份观测，应在结论注明这一证据层次，不能声称日志直接暴露了 DOM identity。
- [ ] 同请求完整保留 `begin → load/loadedmetadata → seek-request → seeked → seek-settled → play → playing/timeupdate → confirmed`；metadata、duration、preparedDuration 均 finite/positive，前后时长差不大于 0.01 秒。`sourceMatches=true`，rate 等于已选值，muted=false。非零目标必须真实收到 seeked；仅赋值回显或 play promise resolve 不算成功。
- [ ] seeked 若短暂 `seeking=true`，只能在原有 10 秒总界限内等到 settled；play 前仍应 paused=true、seeking=false、seekComplete=true、current 距目标不超过 1 秒。没有先 play 再 seek、静音 prime 或从 0 短播后跳转。
- [ ] 独立列出 target、preparedPosition、首个实际正向推进 `firstProgressPosition/firstProgressElapsed` 与首个推进原始 timeupdate；首实际推进相对目标误差应不超过 1 秒。保留所有前置零值、重复位置、首事件与异常行，不能挑后续较有利行。`confirmed` 通常较晚，不能当作初始 seek 点计算定位误差。
- [ ] `playing` 到首实际推进的等待单列，不能把尚未推进的启动时间混算为已推进区间的速率。整个准备/确认仍受 10 秒门禁；等待过长、一次短暂推进后停止均不能确认成功。
- [ ] 普通非短尾：确认必须来自当前实际前进的 timeupdate，至少 3 次连续增量、窗口至少 750ms，前进间隔均不超过 500ms；当前未 paused/seeking、无错误，不能由静止重复事件凑窗口。确认后继续独立观察至少 1 秒多点推进，并保留更长 3 个以上 UI 时刻与至少两次对应系统流采样；不能只截一次“正在播放”。
- [ ] 持续 UI 位置应单调推进、斜率与 1×/.85×相符；给原始位置/墙钟及误差，沿用既有速率门槛，不因本轮调度而放宽。精确高频样本可用原标准：推进链间隔≤500ms，持续窗速率误差≤0.4 秒、确认后独立窗口累计误差≤0.25 秒；若原生只取得稀疏 rounded UI 样本，应明确无法证明同等精度，不以粗 UI 假装满足高频断言。
- [ ] 播放期间同应用 UID 的 AudioPolicy `rendererState=2` 与多次 UI 推进同时存在；其他 UID 或仅缓存 stream 条目不算。暂停/后台后本 UID 不再 running，capturer 为 0（明确录音阶段除外）。系统流只证明系统播放状态，不替代实际可闻声音，未采集声音就注明限制。
- [ ] 暂停后新 receipt 音频字段与实际停止点一致；取消、准备失败或未确认 Replay 保留旧正数 baseline/receipt，不把新元素的 0 当可信保存点。关联单调 revision、命令时间、UI 动作和控制器 tuple；跨时钟关联误差单列，不能当位置或时间精度证明。

## 必跑原生矩阵

全部复验先标 **NOT_RUN**，逐项填写原始前缀、结果与限制。两率各三轮为最低门槛，不以跨率合计三轮充数。

| 组别 | 正常 UI 操作 | 必须保存的观察 |
| --- | --- | --- |
| 1× 长暂停 r1/r2/r3 | 同一正常打开的材料/组件，速率只在组开始设为 1×。每轮先真实播放到有余量的非零点、暂停，真实静置≥60秒，再仅点 Continue；三轮间可显式 Replay 建立下一可用暂停点，单列该动作，不能靠切源/重开页面替代本轮 resume。 | 每轮前暂停精确点、stop→下一 begin 的单调时间差≥60秒，等待中至少两次 quiet 系统采样；新 player、同 source/track/rate/点、真实 paused-seek、首推进/持续 UI+renderer、再暂停 quiet。 |
| .85× 长暂停 r1/r2/r3 | 组开始选 .85×；随后同源、同速率连续三轮与上述相同。 | 三轮各自≥60秒并独立判定，不把换速或 fresh page 作为消除故障的准备。 |
| 新 PID 直接 Continue，两率 | 保存非零点，经正常保存返回/退出；记录旧 PID 消失，再冷启动新 PID。打开材料后的**第一个播放动作**直接点非零 Continue。之前不得 Replay、从头播放、切速、换源或先播放别段。 | 新旧 PID 原始命令；启动静默、点/速率恢复、首动作标签、首新 player 全链与持续流。每率至少一次；导航打开材料不算播放动作。 |
| 显式 Replay / 再 Continue | 保留正数旧点，点“从头播放”，实际确认后再暂停和 Continue。 | 新 player 一次/动作、成功后从零附近推进。新元素已经处于零附近（<0.025秒）时冻结 controller 可直接准备播放，Replay **不强求不存在的 seeked**；非零 Continue 仍必须 seeked。若出现有效失败，停止，不为凑负例主动造设备故障。 |
| Home 后返回 | 已确认播放时 Home，后台 quiet，正常回前台后先保持静默，再 Continue；另核 preparing 未确认时 Home 可取消。 | 后台不再 running/capturing，旧正点保留，恢复无自动播放；迟到事件不启动旧播放器、不写错点、不弹旧错误；新显式动作正常。 |
| Back / 保存并返回 | 播放或准备时系统 Back，正常“保存并返回”，再回材料；确认对话框/取消路径均可达。 | 音频停止、UI 不丢失或重复保存；确认后的正数点保留；重新进入静默、新显式 Continue 正确。 |
| 换 source/track | 由正常句子/材料入口切换，点击另一句或另一材料，再返回旧源。 | 旧源停止且旧 cleanup 只保存旧 source/track；首点击新源能创建新 player，不先误走暂停；新源未确认不以0覆盖旧可信点，同源 callback 更新不重建或错存。 |
| 录音 / 回放 | 由可见录音入口，先有媒体播放再正常开始真实录音，录制并正常停止/保存，再回放；暂停/关闭/Back/Home 均抽验停止。 | 原 lesson renderer 停止；录音时只出现本阶段 capturer，停止后 capturer=0；真实文件可读、有时长/字节/hash、记录实际发生时间，回放只一个流；录音不能与 lesson 同时持续。麦克风拒绝/硬件无法启动记 BLOCKED/FAIL 的实际阶段，不能写通过或伪造录音。仅正常保存新增 recording，单列 ID/hash/native scope，不改原记录。 |
| 短 clip 与短尾 | 正常 UI 播一个实际短句 clip 到自然 ended；另用正常可用定位入口从真实音轨 duration−0.35/0.4秒非零点 Continue 到 ended。 | 非零短尾仍需真实 metadata/seeked/settled/play、finite positive duration、首中间推进和更后自然 ended，不能只有 seek 到末尾即完成。短尾墙钟/速率应符合冻结门禁，不退化为普通750ms要求或空 ended 假确认。若产品 UI 没有合法建立该短尾点的入口，记 **NOT_RUN/BLOCKED** 并交接，不注入保存点；Chrome短尾结果只作不同层级旁证。 |

跨阶段不得清 App 数据或更换媒体 URL“修复”现象。所有持续测试保持足够剩余时长，预期自然结束与“中途停住”分开记录。

## 原始证据命名与历史保留

开发原件位于外层 `dev-native/`。已经存在的身份/基线前缀：`INSTALL-PREFLIGHT-r15`、`POSTUPGRADE-PREFLIGHT-r15`、`r15-install*`、`r15-identity-after*`、`r15-pid-after*`。在途媒体前缀：

- `r15-direct-inherited-1x-*`；`r15-1x-r1-wait.json`、`r15-1x-r1-quiet-*`、`r15-1x-r1-resume-*`；`r15-1x-r2-prepare-*` / `-wait.json` / `-quiet-*` / `-resume-*`；`r15-1x-r3-prepare-*` 与其后续实际文件。
- 逐组保留 `*-observations.json`、`*-gate.json`、`*-layout.json`、`*-playback-log.stdout.txt`、`*-range-log.stdout.txt`；每次工具调用保留 `.command.json/.stdout.txt/.stderr.txt`。gate 中空 checks 或限定状态必须原样说明，不能把文件名/摘要当作全部门槛已通过。
- QA 另用 `qa-r15-1x-r1/r2/r3-*`、`qa-r15-085x-r1/r2/r3-*`、`qa-r15-cold-1x/085x-*`、`qa-r15-home-*`、`qa-r15-back-*`、`qa-r15-source-*`、`qa-r15-record-playback-*`、`qa-r15-short-clip/tail-*` 等新前缀；这是建议命名，**没有预先声明对应原件存在**。最终正常 UI 三域导出及原始命令/receipt全量保留，新增行为按新 revision 逐条关联，旧 command/canonicalPayload/payloadHash/receipt、其他 session、attempt/checkin/profile/词表不得被归一化覆盖。

旧 r14 原生实际 **FAIL**（只读总账快照 `NATIVE_FAIL_PENDING_REPAIR`；最终交付状态 `NATIVE_FAIL_PENDING_ARCHITECTURE_COORDINATION`），完整保留在 `vocab-work/ct-sustain-guard-20261015/`。其原生总账为 `site/reports/native-media-readonly-review.json`（SHA `6958534df3627c333796d3bcf399604ff30d4ab23e21c17123a2b3bebbab4479`）及同名 `.md`；保留三次快照和对应原件，不用 r15 结果覆盖。核心失败前缀为 `dev-native/r14-1x-repeat-base-*`、`dev-native/r14-unchanged-rate-after-fixed-idle-*`；新元素同点成功为 `dev-native/r14-new-element-same-checkpoint-*`。精确失败日志分别是 `r14-1x-repeat-base-28-playback-log.stdout.txt` / `-29-range-log.stdout.txt` 与 `r14-unchanged-rate-after-fixed-idle-26-playback-log.stdout.txt` / `-27-range-log.stdout.txt`。后者成功对照后保持1×、52.028秒暂停即再次 pre-play MediaError2；因此不能把“切速”写成必需条件。暂停资源生命周期路径可复现，宿主传输与引擎最终根因仍未证实。r14 最终正常导出 `dev-native/r14-final-before-handoff/workflow.json` 为1,577,041字节，SHA `118259928afac494bd60b654d310597f37bc6a0b2b3976d0d1af628a2b066511`；157 commands、revision138、保存点15.17秒。冻结交付索引 `DELIVERY-CT-r14.json` SHA `369a7e802f76c1edae4016fbf68a56f3418800de35d8a9594f156754b2b309ee`，不随r15测试重写。

## 任一有效失败立即停止与最终回执

- [ ] 出现一次真实可归属的媒体错误、非零 Continue 回零/偏离>1秒、真 seeked/settled 缺失却 play、10秒门禁超时、短推进后停住却确认、确认后中途静止/错误、后台仍播/录、错源错点或原数据损失：立即停止后续重复矩阵，记录候选 **FAIL / PENDING_REPAIR**，先保存本次原始日志、UI、系统流及正常可导出的当前数据。
- [ ] 不重复同批用例挑 green，不删首零/失败行、不放宽等待/位置/持续阈值、不用另一次新 player 成功抵消有效失败。需要诊断时由 root 新授权、用新前缀，保留首次失败；身份/工具采集失效须有证据说明，分类为工具失败或 BLOCKED，不悄悄豁免产品失败。
- [ ] 原日志缺失/环形缓冲覆盖、精确时间或 renderer 不可关联、UI入口不可达等，记 **INCONCLUSIVE/NOT_RUN/BLOCKED**，列已完成动作和缺证据，不能借开发单测/Chrome通过补作原生通过。若无有效失败但矩阵不完整，保持待验收。
- [ ] QA 回执逐项列 PASS/FAIL/BLOCKED/NOT_RUN、候选/源/HAP SHA、设备与 PID/UID、实际长暂停秒数、首定位误差、持续窗口/声音层次、正常导出 SHA/旧数据审计、新录音边界、原始文件及总清单 SHA。最后明确独立 QA 的结论与未覆盖项；发布、push/合入/部署仍需原会话授权，不能由本清单或测试通过推导。
