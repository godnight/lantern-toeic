# CT-r13 冻结源码只读交叉审查

结论：**STATIC_FAIL_SUSTAIN_CONFIRMATION**。根已接受以下两项确定的静态门禁遗漏为r13阻断；保留r13冻结源码和产物，在下一隔离修订处理。它们不等于本轮已经在原生发生，也不确定既有QA失败的唯一根因。

审查对象：`CT-20261015-r13-1d60121e4a86`、`0.3.5/20028`。本轮实际读取并核对：

| 文件 | SHA256 |
|---|---|
| `lib/lesson-audio.ts` | `92511fccda5627add3809071a7148273d9a621a94970d43d9bd4daa82d360039` |
| `harmony/entry/src/main/ets/pages/Index.ets` | `e1f0558417f08217e5d61a014617f58eb2b060eb10071e37361d83e8fc9f28b4` |
| `app/learn/practice.tsx` | `97dce7aeda2b8e53ec6d7bacdaeb944a57e91ae68637d5b90ed2d3c7104e6b4f` |

SDK编译通过是根提供的构建事实。本轮仅静态读取源码和相关既有测试，新增本文档；未修改冻结运行代码或测试，未执行测试、SDK、设备或提交。

## 阻断一：静止观察可补足普通确认的750ms

位置：`lesson-audio.ts:86–105`，尤其 `accept()`第87–90行及 `progress()`第103–105行。

普通确认要求 `clock()-windowAt>=750`、`advances>=3`、`actual-windowPosition>=max(.05,rate*.5)`。但 `windowAt`是首次观察时间；没有最后一次真实推进时间。后续位置不变的 `timeupdate`仍调用 `accept()`，故静止时间也可补足门禁。

确切反例：同源、正常完成暂停seek、1×、目标T、未出现waiting/stalled，始终 `paused=false/seeking=false`。

| 起播后时间 | currentTime | 门禁状态 |
|---|---|---|
| 0ms | T | 首次progress，`windowAt=0`、`windowPosition=T` |
| 200ms | T+.2 | `advances=1` |
| 400ms | T+.4 | `advances=2` |
| 600ms | T+.6 | `advances=3`，总推进.6秒，尚不满750ms |
| 800ms | T+.6，仍不动 | stationary timeupdate仍调用accept，全部条件成立 |

此时真实推进只持续到600ms；最后200ms静止，却在第800ms进入 `confirmed`，将baseline改为T+.6，触发 `SpeechPlayer`确认回调和保存。`validStartPosition()`的上界与回退检查不会拦截该序列。若之后立即error，已确认保存点也会保留，因此不能仅靠“未确认时保护旧点”弥补此门禁遗漏。突发的多次推进之后长时间静止也存在相同逻辑路径。

下一修订需使确认依赖真实推进形成的有效窗口，不能由stationary回调或仅墙钟等待补足；应添加上述确切反例及恢复真实推进后的正向回归。此处不指定或实施新算法。

该缺口不同于起播延迟：playing之后先不动，随后在约.7948秒内以.85×真实推进约.679秒，属于根已观察的启动滞后与后续正确速率证据，不能仅因最初约.7秒不动就判为根因或失败，也不能用第三轮11/11抹去其他轮次事实。

## 阻断二：NaN锁定时长可绕过短尾确认门禁

位置：`lesson-audio.ts:112`锁定 `preparedDuration=audio.duration`；第126–146行准备/seek流程；第155–165行 `pendingEnded()`，尤其第162行。

`ready()`最初要求当前duration有限且大于0，但seek完成后调用的 `start()`不重新检查duration。seek期间duration若临时变NaN，`durationchange`进入ready时又因 `seekAssigned`直接返回，随后seeked可令start锁定 `preparedDuration=NaN`。

短尾判断只检查 `preparedDuration===null`。对NaN，以下拒绝条件全部为false：

- `Math.abs(duration-preparedDuration)>.01`；
- `remaining<=.02`；
- `expectedMs>1500`；
- `elapsed<expectedMs*.8`。

可满足其余门禁的确切输入序列：

1. 同源，1×，目标8秒，初始有效duration为12秒，触发暂停seek。
2. seek期间duration临时NaN；位置8秒，真实seeked且seeking清除，仍paused，随后起播并收到playing。
3. 起播.5秒，收到一次实际progress，位置8.5秒；duration恢复12秒。
4. 起播3秒，位置12秒并自然ended；无waiting/stalled，没有足够progress事件触发普通确认。

此时 `remaining/expectedMs`为NaN，1500ms和实际播放时长门禁失效；`validStartPosition()`仍允许 `12<=8+1+3`。首个进度与片尾位置不同、当前duration有限、source一致，故进入 `confirmed-short-end`并保存12秒。若锁定时长是正常有限12秒，本来4秒剩余时长应被1500ms门禁拒绝。总10秒超时也拦不住此例。

下一修订应在start复核并锁定有限正duration，且短尾证明自身明确拒绝非有限的 `preparedDuration/remaining/expectedMs`，失败保旧baseline。不能只依赖早先metadata检查或NaN参与的大小比较。

同类边界已一并核对：ready确有当前duration有限正值检查；pendingEnded也检查当前duration有限正值。缺口集中在seek之后锁定的preparedDuration及其派生值。正常非片尾位置确认以实际位置推进为依据，不因duration元数据短暂未知就自动等同于“已完成片尾”；本轮未发现另一个独立的duration fail-open路径。

## 已检查的调用边界

- metadata/seek/轮询/play Promise的请求级回调均有generation与active门禁；stop/dispose清理请求监听和定时器。
- 未确认前 `sample()`返回旧baseline；确认之前的error、pause、explicit replay失败不会单凭DOM归零覆盖旧点。
- `SpeechPlayer`第27–39行通过played/source/owner门禁保存，只在控制器confirmed后接管新源；capture不依赖已经清空的audio DOM ref。换页、切题等先stop再flush的既有边界未在本次审查发现确定新阻断。
- 正常片尾pause先到或ended先到，active清除可避免第二次确认。若片尾证据本身有效，短尾确认后的迟到error不应被直接称作伪造保存点；但上述NaN反例会使其证据本身不成立。

## 未证实的迟到mediaError风险

`lesson-audio.ts:48`的常驻mediaError只检查 `active===playback`，没有请求代次、source或 `audio.error`非空检查。若同一audio的新请求期间投递旧媒体的error，新请求仍会被拒绝，即使新的load已清空error。该路径会停止新请求，现有baseline保护仍在。

尚无原生迟到error序列证据，不能将它写为本次根因。下一轮最小诊断应看player/request、sourceMatches、阶段与error时的实际状态；不为此扩大任意console或添加调试桥。

## 宿主日志契约匹配

实际控制器输出和冻结Index投影字段匹配：player/request、四stage、23个event、18个reason、全部数值/布尔、六个nullable数值（含preparedDuration）、seekable最多8元组、固定events计数，以及可选异常code。exceptionName只保留固定安全名称是有意收窄，其余任意字符串不转发。

JSON将duration/preparedDuration的NaN序列化为null，宿主允许其元数据不可用状态；因此日志可以记录相关事实，但不能替代控制器对非有限preparedDuration的拒绝。日志预算、可信页面条件或采集遗漏也可能导致消息缺失，不能把缺日志等同于未发生事件。

本文不改变既有SDK/Chrome/QA记录，不声称实际音质、持续出声或原生问题已经通过。r13保持上述静态失败结论，后续修复和设备证据应使用新的独立身份。
