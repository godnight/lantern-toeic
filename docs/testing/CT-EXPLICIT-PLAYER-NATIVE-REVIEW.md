# CT-r15 原生证据独立只读审查

结论：**NATIVE_INCOMPLETE**。`CT-20261015-r15-ba90c9bc3f45` / `0.3.5/20030` 的六轮长暂停、冷启、Home、确认前 Back、其余速率及单次短尾，在下述已采集证据范围内未发现 RED。麦克风取消后的资源回收仍为 **INCONCLUSIVE**；不能整体验收 PASS，也不因该项转用 Blob 或重试。

根代理于 2026-10-15 UTC 授权关闭本审查。本角色仅读取已落盘的普通 UI、AudioPolicy、白名单日志及已闭报告，新增独占 parser/JSON/本文件；没有访问设备、重放动作、运行应用测试/构建、修改实现或冻结件。原 r14 FAIL、r15 首次麦克风断言和较早静态审查遗漏均保留。

## 候选与方法边界

候选 sourceInputs SHA256 `ba90c9bc3f45bd5077606eedc3ad270c0c1706828e76ca650d3aa4844939b675`，1371 输入。探针中的 candidate 字段来自本地 build identity；安装/HAP身份由外层交付绑定，本角色没有另行读取设备包。

本地解析器 [audit-native-r15.py](../../../tooling/audit-native-r15.py) SHA256 `ee966a6cab52da3d6cbde865cf05c27cd6138c8a38eac6f7c6dc2ecadf8f9b1c`。它读取宿主 `LANTERN_PLAYBACK` 的嵌套 `data`，以 PID/player/request 和同 PID seq 关联，不把 request 单独当身份；逐点核同源、有限一致时长、速率及实际推进。准备阶段的默认/旧 DOM rate 不等同用户选择；UI未暴露 selector 数值时保留 NOT_OBSERVED，另核 play 后有效 rate。

helper 的 observed 不等同 PASS。每请求32条普通日志、宿主256条与Range64请求预算及环形日志均可能造成缺口；缺记录不能变成“没有请求/没有错误”的证据。行首为设备本地时间，wallMs为epoch；设备和采集主机亦可能有时钟偏差，耗时优先同组uptime或JS elapsed。Range ready/长度正确不证明引擎消费完毕；UI与匹配UID运行音流不独立证明人耳可听PCM或唯一根因。

## 六轮长暂停

下表间隔由上一明确stop到新begin的同PID uptime独立计算；不是只采用helper给出的等待值，也不声称连续监听整个暂停期。

| 速率 | 轮次 | PID / 新player | 暂停秒数 | 恢复目标 → 确认 → 停止（秒） |
| --- | --- | --- | --- | --- |
| 1× | 1 | 18309 / 2 | 87.437 | 20.282836 → 21.264824 → 25.315430 |
| 1× | 2 | 18309 / 4 | 65.149 | 6.213503 → 7.382562 → 11.384521 |
| 1× | 3 | 18309 / 6 | 65.108 | 6.192360 → 7.578445 → 11.553821 |
| 0.85× | 1 | 20881 / 3 | 65.057 | 5.591079 → 6.784440 → 10.165752 |
| 0.85× | 2 | 20881 / 5 | 65.045 | 5.264502 → 6.423479 → 9.787372 |
| 0.85× | 3 | 20881 / 7 | 65.086 | 5.182056 → 6.400187 → 9.752989 |

六轮均相对prior快照使用新player，具有目标附近真实暂停seeked/settled、其后play、至少四个可重建实际推进点及原持续窗口确认；匹配UID多次RUNNING，停止后原始AudioPolicy为state3且capture0。所审组未见MediaError2、虚假确认、点回零污染、退休控制器迟到接管或停止后仍RUNNING。逐点与输入SHA见 [1×索引](../../../tooling/native-reviews-r15/index-1x-initial.json)、[0.85×及Home/cold索引](../../../tooling/native-reviews-r15/index-085-home-cold.json)。这是限定观察，不能推广为所有资源或设备均已修复。

## 退出、冷启、速率与短尾

- 首次继承点：PID18309/player1，15.17暂停seeked后真实推进，停20.282836。
- Home：player7停止current=baseline=13.308971；前为UID RUNNING，之后两次及返回后均无本应用RUNNING、capture0；原UI返回显示继续按钮与13.3秒，没有自动播放证据。手动继续的新player8 target与真实seeked均精确13.308971，停18.683950。
- 保存返回：运行中关闭并正常保存后回Today恢复入口，未声称已重新进入训练弹窗。stop记录current21.142795、baseline21.057888；stop诊断发生在采样前，不能把两者差异直接判为保存污染。旧PID18309已退出后新PID20881，启动前后quiet；首次direct player1 target21.143符合current的毫秒舍入，主动点击后才推进。
- Back：PID20881/player8在真实play/playing后约240.8ms、持续确认前被Back取消，**不是play前取消**。stop actual10.103568、保留baseline9.752989；无timeupdate/confirmed/rejected。三次原始系统快照均state3/capture0，UI为继续练习/保存并返回确认框。保存退出后旧20881已gone、新25942；首次direct target9.753是旧baseline的毫秒舍入，没有采用未确认actual10.103568。
- 新PID25942的首次0.85×direct停13.987101；随后0.7×新player2从13.987101停17.590813，1.15×新player3从17.590813停23.252719，均有充分实际推进链及停止quiet。见 [冷启与其余速率索引](../../../tooling/native-reviews-r15/index-cold-085-other-rates.json)。
- 单次短尾：正常自然播放准备后暂停32.251123，剩余0.900396秒；新player5真实暂停seeked/play原点，三次中间推进后自然confirmed-short-end→ended33.151519。playing到结束997.1ms，首推进252.2ms，首点到结束744.9ms（对应媒体尾666.224ms），末实际推进距结束213.9ms；两次匹配UID RUNNING后quiet/capture0，23项限定证据条件一致。见 [短尾独立审查](../../../tooling/native-reviews-r15/r15-shorttail-1x.json)。此为一次短尾观察，不承诺所有稀疏短尾支持。
- 最后一次明确Replay：新player6从目标0经正常持续窗口确认1.497897后停止6.638419，停止state3/capture0。合法Replay确认后才接管低位置，不能把它当成继续失败归零。见 [最后Replay](../../../tooling/native-reviews-r15/r15-final-positive-replay.json)。

## 麦克风：保留 INCONCLUSIVE

[原记录](../../../dev-native/R15-MIC-PREPARATION.json) 的 `FAIL_OR_INCOMPLETE_SAFE_HOME` 和“立即count0”断言失败完整保留。f276/f278原UI仍在准备倒计时；f279普通点击坐标位于取消准备按钮内且命令成功。f277 UID20020063/stream100068为capturerState2、count1；f280取消后同stream为state3、count1；f281安全Home后约51.607754秒的f282才count0，f283为桌面。

[本机官方SDK定义](../../../tooling/LOCAL-AUDIOSTATE-DEFINITION.json)明确2=RUNNING、3=STOPPED、4=RELEASED，实际SDK文件SHA `bb2092981f6e191686c745dd0de7733e1164c2427afa1debc04ef6b9a3304b03`已核对。故state3不能称仍采集，也不能称已RELEASED；Home介入和延后归零不能反推Cancel独立有界回收PASS。未发现这组快照中的真正STOP失败，但取消后的资源完全回收仍不确定。

`app/learn/speaking.tsx` SHA `793d7f92af0777c0dbfd2fe4f13e4674aee5e03aa983915c085a77b5ff682ea2`与r14逐字节相同。69行releaseMicrophone遍历全部track.stop；124行cancelPrep先使generation失效再释放；119行迟到getUserMedia结果、71行卸载及132行准备后台路径也停止track。未发现确定漏stop分支；仍持有已停止MediaStream引用不证明持续采集，也不证明ArkWeb原生对象已释放。本候选不再改源码或重试；QA另开明确窗口核取消不采集与有界资源回收。详情见 [麦克风独立审查](../../../tooling/native-reviews-r15/r15-mic-preparation-independent.json)。

## 数据与剩余门槛

已绑定 [关闭后的数据审计](../../../data-audit-prep/R15-DATA-AUDIT.json)，SHA `470298f97ee7796c43da4af0fd9a9b19fd3472a95d1a183ba8a8e7df0d5c159c`：159项、0失败，作用域是正常导出保留、canonical/receipt、完整写入及revision/CAS/expectedHash；本角色只读该报告，没有复跑159项。报告记录无新录音元数据，最终211 commands/rev192，question内置轨point6.638/rate1，与Replay停止点毫秒舍入一致。Study除exportedAt相同、Vocab原字节一致由该数据审计/外层关闭证据支持，不是本角色另行审计全部三域。

额外54条逐probe action-receipt关联：**NOT_AUDITED_BY_THIS_REVIEW**，由外层交付绑定另一个角色后续报告，不等待或预判其结论。早期各prefix报告中的持久化NOT_AUDITED状态保持历史原样，最终仅引用上述独立数据报告，不将媒体日志包装成导出/动作归因证明。

新录制、既有录音回放、原生跨材料矩阵、独立PCM、手机、独立QA均 **NOT_RUN**；麦克风取消资源回收为 **INCONCLUSIVE**。原r14错误路径仍作为已知FAIL保留。最终设备Home/quiet交接尚未在本文件关闭时绑定，由外层DEVICE-HANDOFF后续提供。本角色停止写入，不再等新证据、不重试、不启动Blob；没有push、合入、上传、部署、发布或验收授权。

机器可读结论、所有本角色新产物SHA及原始输入绑定见 [FINAL-NATIVE-REVIEW.json](../../../tooling/native-reviews-r15/FINAL-NATIVE-REVIEW.json)。
