# CT-r14 媒体替代路线只读架构评估

日期：2026-10-15；负责人：微光-小开。范围：读取 r14 源码、已有 root 原生采集、本机官方 SDK 声明和打包短轨元数据；仅新增本文。未操作设备、播放音频、运行测试/构建、修改实现或学习数据。本文是候选路线及判别条件，不是修复、独立 QA 或发布结论。

## 结论与建议

当前已证实的阻断是：**同一个 HTMLAudioElement 在已成功播放、显式暂停并静置后，再赋非零 currentTime，会在 play 前出现媒体错误 2；失败不限于切换倍率。** 不能把它归为“0.85 不支持”“没有 Range”“所有暂停 seek 均不支持”，也不能从宿主的 ready/206 日志认定 ArkWeb 已消费完整字节或已正确结束该响应。

建议由 dot 决定下一轮是否建立**完整字节校验后 Blob 的诊断 A/B 候选**：只对有 manifest 身份的内置短轨，一次完整本地读取，严格限长与 SHA-256 验证，再走普通暂停定位和显式用户播放。它移除媒体解码器的分段资源请求链，仍使用 ArkWeb HTMLAudio，尚不能称为可靠修复。如果完整 Blob 仍不能通过同元素静置恢复，才进一步评估原生 AVPlayer；该路线涉及媒体桥、生命周期、录音互斥及 API 12 倍率兼容，成本明显更高。

## 读取身份及现有证据

工作树：`vocab-work/ct-sustain-guard-20261015/site`；r14，`0.3.5 / 20029`（[app.json5](../../harmony/AppScope/app.json5:5)）。读取到的控制器 SHA-256 为 `995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0`，Index 为 `e1f0558417f08217e5d61a014617f58eb2b060eb10071e37361d83e8fc9f28b4`，AssetRange 为 `72b72e5fe3ae321b50dc775ff18f1c25746574ed0c4ed7a753ffb00ca5e28ef2`。与既有 [r14 静态复核](CT-SUSTAIN-GUARD-READONLY-REVIEW.md) 的控制器/宿主身份一致；分层原生失败分析见 [CT-R14-NATIVE-FAILURE-READONLY](CT-R14-NATIVE-FAILURE-READONLY.md)。

本轮只读核对冻结资源 `../resources/CT-20261015-r14/web/audio/offline/1935c17708c726884ac9.mp3`：266,075 B，SHA-256 `275c0d315f7ab35fe7c3a004d2cbb33316bb82676c3da21e002e68093b932d2a`，与 manifest 相同；manifest 声明时长 33.151519 s，对应 p3-01/02/03。没有解码或试听。manifest 共 1,015 段，合计 18,749,095 B，最大单段 410,897 B / 51.273197 s；这些数值只适用于现有内置短轨，不能扩展为私人模考长音轨的内存预算。

| 已有原件 | 可核实事实 | 不能推出 |
|---|---|---|
| [cold .85 playback](../../../dev-native/r14-085-cold-first-nonzero-18-playback-log.stdout.txt) | PID 12274 / player 1 / request 2：target 5.613；load→fresh metadata→真实 seeked→seek-settled→play(.85)→confirmed，继续推进至 9.969054 后 stop | 不能证明所有恢复、全部时长或持续人耳出声均通过 |
| [cold Range](../../../dev-native/r14-085-cold-first-nonzero-19-range-log.stdout.txt) | `bytes=262144-` 的尾部请求在 uptime 215413191 已出现，早于成功 seeked/confirmed；每次报告 206、3931 B、`262144-266074/266075` | 重复尾部请求不是仅在暂停后才开始，不能单独作为暂停故障根因 |
| [原同元素失败](../../../dev-native/r14-1x-repeat-base-28-playback-log.stdout.txt) | player 1/request 6：target/baseline 9.969054，原 current 9.969362；seek-request 后 14 ms，readyState 3→1、seeking=true、media-error code 2，无 seeked/play | 此时媒体 rate 仍 .85；虽 UI 选 1×，新倍率尚未在 start 应用，不能写成已实际 1×播放失败 |
| [新元素重入成功](../../../dev-native/r14-new-element-same-checkpoint-18-playback-log.stdout.txt) | player 4/request 2：target 9.969、load/fresh metadata、seeked、confirmed；实际 rate=1，推进至 15.170487 后 stop（uptime 215700451） | 新元素这一次成功不是长期修复；重新创建元素是否充分仍未证实 |
| [同倍率静置失败](../../../dev-native/r14-unchanged-rate-after-fixed-idle-26-playback-log.stdout.txt) | 同 player 4/request 5；保持 rate=1，暂停 52.028 s 后 target 15.170487/current 15.170875，readyState=3、完整 seekable；seek-request 后 19 ms 错误 2，无 seeked/play/confirmed | 已排除“必须由 .85→1 的倍率切换触发”；仍不能区分资源消费、引擎 loader、解复用或元素状态的唯一责任 |

设备日志日历为 10-16，本任务采集命令 UTC 为 10-15；本文按 PID、player/request 和单调 uptime 关联，不靠两者日期相同推断。本文未重新执行采集命令。

## 分层：事实、假设与最小反证

| 层 | 当前源码或证据 | 剩余假设及最小判别 |
|---|---|---|
| 宿主 Range 算法 | [Index:477](../../harmony/entry/src/main/ets/pages/Index.ets:477) 对内置 MP3 用 `getRawFileContentSync`；媒体分支在 intercept 返回前完成数据、头、code 及 ready。`async` 方法名与调用处无 await 不意味着这条同步媒体分支尚未完成。[AssetRange:13](../../harmony/entry/src/main/ets/services/AssetRange.ets:13) 按 Uint8Array 的 byteOffset/byteLength 精确 slice；上述尾部算术相符。源码无尾部重试定时器 | 只能证明宿主准备的响应和声明一致，不能证明引擎收到/消费及 EOF。完整读取后在 JS 验证总长+SHA，可独立检查“浏览器完整消费一次本地响应” |
| 响应/缓冲区生命周期 | setResponseData 得到独立 ArrayBuffer，随后 setResponseIsReady(true)；无已发现的提前清空/复用缓冲区代码。SDK 声明允许 binary ArrayBuffer | SDK 声明未给出 ArrayBuffer 复制时机、消费完成通知或 decoder EOF 保证。不能无证据认定 GC/生命周期损坏；更换响应载体或持有缓冲区只能列为单变量候选，不能直接宣布修复 |
| HTML 控制状态机 | [lesson-audio:135](../../lib/lesson-audio.ts:135) 对非零目标即使 current 与 target 只差约 0.0003 s，也仍执行 currentTime setter；没有跳过此 seek 的普通 resume 分支。实际失败在 setter 后、start/play 前；[第 122 行](../../lib/lesson-audio.ts:122) 此时还未写新 playbackRate | 赋值是触发边界，但尚未证明控制器单独制造错误。近点省略 setter 或新建元素会改变条件，必须另建身份按原目标、同倍率、相同静置时长验证；不可用 setter 回显代替真实定位和持续推进 |
| ArkWeb/媒体引擎 | cold 与新元素已有非零暂停 seek 成功，同元素静置后两次失败，且完整 seekable/readyState3未保证成功 | 更支持需调查元素/loader存续状态，仍不足以宣布平台全面无 seek。完整且校验一致的 Blob 可移除 HTTP-like媒体Range；若仍失败，再查 HTML引擎/编码/生命周期，而非继续把Range header视作唯一原因 |
| 音轨编码 | 同一冻结 MP3 的 bytes/SHA已核对，cold可正常产生媒体进展 | 不证明该文件在所有解复用/寻址路径无问题，也未做人耳核验。不要生成/转码音轨来同时改变多个变量掩盖原缺陷 |

本机主声明：`D:/zzl/harmony-toolchain/studio-26.0.0.821/sdk/default/openharmony/ets/component/web.d.ts` 第 2918–2928 行明确 ArrayBuffer 为 binary（since 11），第 2978 行允许 number response code；第 2980–2988 行只描述 ready 布尔值，没有消费者读完的保证。最低 API 12 覆盖 ArrayBuffer 的声明版本。该 SDK 文档没有给当前现象的已知缺陷公告；本文不把推断写成官方限制。

## 候选 A：有界完整本地读取 → 验证 → Blob → 原 HTMLAudio

这是建议先做的诊断候选，尚未实现或原生验证。设计应满足以下完整条件：

1. 仅接受已注册 manifest 的内置 clip ID，得到可信相对路径、确切 bytes、SHA 和稳定 sourceId。先验证安全整数长度及硬上限，建议单段 **1 MiB**（覆盖当前最大 410,897 B）；不预读全部 18.75 MB，不接私人录音、模考整轨、任意 URL 或任意本地路径。
2. 用户请求后从现有可信 local origin 完整 GET，不发 Range；要求 200、audio/mpeg、预期长度，并把异常 206/重定向/失败当失败。分块累计读取时逐块限制 `expectedBytes` 和硬上限，取消/超时立即取消 reader；只靠 Content-Length 或 `response.arrayBuffer()` 之后再验长度不能充当一般性的内存上限。若当前 ArkWeb 不支持可界定的完整读取，就在该能力门处失败，不退回未验证字节。
3. 读到 EOF 后，要求实际字节数完全相同，计算完整 SHA-256 与 manifest 比较。校验前不创建可播放 URL、不解码或 play。现有 [checkedLibraryDownload:29](../../lib/exam-library.ts:29) 提供“逐块限长、完整性、SHA”的同类控制结构；其 JSON校验、96MiB限额及 WebCrypto-only调用不能原样套作离线音频实现。现有 [exam-model:230](../../lib/exam-model.ts:230) 有离线 SHA 后备，但目前是私有函数且 fingerprintExam 面向 JSON，不能错误地将 JSON/文本 canonicalHash 当文件SHA。
4. 完整校验后创建 `Blob(type='audio/mpeg')` 和 object URL，HTMLAudio 只绑定该 Blob URL。保留正常 paused metadata→非零 seek→真实 seeked且seeking=false→用户明确 play→实际推进确认；不静音偷播、不播放再跳转、不把 ended 或 play Promise 当确认。
5. 稳定 sourceId仍使用 manifest文件+文件SHA；Blob URL是易失的传输句柄，不能落入checkpoint成为音频版本，也不能因重建URL丢掉旧定位。每次读取、hash及创建URL回调均验证请求/owner/document/lifecycle代次。取消、换材料、离开口语或页面销毁时停止旧媒体，撤销不再使用的URL、取消reader并释放字节引用；在已绑定元素卸载前提前 revoke 会引入新生命周期失败。
6. 保持单活动播放器。缓存若有，仅持有当前轨和极小有界缓存；不能给每个逐句组件常驻一份完整轨。包含读取分块、拼接、Blob、解码缓冲的峰值会高于单个MP3大小，1MiB是压缩字节上限，不是整个解码内存上限。

**区分力：** 若完整读取+SHA失败，应停在传输/资源消费层；若SHA通过、Blob仍在普通paused seek报同样错误，则Range传输不是该候选的充分解释；若Blob稳定通过而URL Range路线复现，支持媒体分段loader路径相关，但仍须覆盖静置/重入/中断后才谈修复。初次创建Blob也改变资源生命周期，因此单次成功不能进一步断言某一响应头是根因。

**已存在的边界：** 项目 [createAssetUrl:253](../../lib/exam-model.ts:253) 和 [ExamAssetUrls:118](../../lib/exam-ui.ts:118) 已使用 Blob URL；录音回放也有object URL。这只是源码已有机制，不是本轮内置MP3长暂停恢复的能力证明。Index 对非local资源返回null的现有pass-through保留（[第 522 行](../../harmony/entry/src/main/ets/pages/Index.ets:522)）；不为Blob放开fileAccess、调试桥、跨域或任意URL。

## 候选 B：鸿蒙 AVPlayer + 打包 rawfile FD

原生播放器可绕开HTML媒体资源loader，并明确使用本地fd/offset/length；它仍依赖系统媒体服务/codec，不是保证无缺陷的替换。它也不应替换现有Web/PWA播放器或顺带重做录音。

SDK主声明根目录：`D:/zzl/harmony-toolchain/studio-26.0.0.821/sdk/default/openharmony/ets/api/`。

- `@ohos.multimedia.media.d.ts`：AVPlayer `seek` 第2330–2350行、`seekDone`第3319–3331行；`setSpeed`第3102–3114行；任意数值`setPlaybackRate`第3116–3133行。FD、状态、清理的精确声明位置见下方表格。
- `@ohos.resourceManager.d.ts`：`getRawFileContent`第1975–2004行返回整文件Uint8Array（API9），相对resources/rawfile路径不得以`/`开头；`getRawFd`第2006–2046行（API9）；`closeRawFd`第2048–2077行（API9），以对应相对路径关闭。`global/rawFileDescriptor.d.ts:19–63`（API8）明确fd及HAP内字节offset/length。以本包资源映射获取，不将路径或fd暴露为通用Web能力。
- 项目 [build-profile](../../harmony/build-profile.json5:7) 最低/target API12、配置compile API18；新版本SDK的声明存在不等于最低API可调用。

| 契约 | 原生路线必须处理的行为和成本 |
|---|---|
| 本地输入和状态 | media.d.ts:2867–2899：fdSrc为API9，仅idle可赋，使用完整`{fd,offset,length}`；2855–2858禁止同一资源句柄并发交其他读写/媒体实例。2176–2208：prepare仅initialized；2210–2232：play仅prepared/paused/completed；2234–2256：pause仅playing。不能把重复pause/release当永远可执行的幂等操作 |
| 定位 | seek(API9)允许prepared/playing/paused/completed，单位毫秒、范围[0,duration]，音频不传视频I帧SeekMode；seekDone(API9)回调值是requested，实际currentTime见media.d.ts:2999–3011（-1无效）。3431–3451：timeUpdate默认约100ms，seek完成和pause缓冲结束也会报告；单次timeUpdate不证明持续播放。须保留实际值容差、后续推进、尾部边界和失败保留checkpoint |
| **倍率** | API9起的setSpeed只收PlaybackSpeed枚举；API12可用档位为 .125/.25/.5/.75/1/1.25/1.5/1.75/2，**没有现UI的 .7/.85/1.15**。任意rate接口setPlaybackRate为**API20**。须由产品决定能力分流/清楚降级或调整档位；不可强制类型转换为枚举、静默近似或声称API12已支持.85 |
| 跨端与桥 | 新增固定、allowlist clip身份的native命令/事件，不开放任意路径/URL/fd；绑定document/lifecycle/request/owner，拒绝旧回调。现有native-host只有生命周期/Back协议，没有AVPlayer桥；设计、实现与QA均是新增工作 |
| checkpoint | 持续保存业务层trackId/sourceId、秒、实际倍率；AVPlayer fd或Blob URL都不入持久模型。seek/prepare失败保留最后确认点；原生不单独写第二套学习记录，不让迟到事件越过owner更新其他轨 |
| 麦克风和录音 | [speaking:110](../../app/learn/speaking.tsx:110) 开始准备前先stopLessonAudio；原生路线必须接入相同单活动互斥，并等停止/状态确认，不能让native播放留在DOM扫描之外。保留录音发生时间、保存及未保存恢复；不读取或重建用户录音 |
| Home/Back/失焦 | [native-host:32](../../lib/native-host.ts:32) 与 [SpeechPlayer:35](../../app/learn/practice.tsx:35) 当前负责暂停；原生media不会被querySelectorAll暂停。宿主须直接同步撤销代次并暂停/收尾，前台回来由用户明确恢复；不得引入后台播放、后台任务或自动续播作为绕过 |
| 权限与音频焦点 | 当前只请求INTERNET和MICROPHONE；rawfile/getRawFd/fdSrc上述声明未列新增用户授权权限，不能泛化为任意外部文件可读。media.d.ts:2850–2853明确URL播放需INTERNET。2960–2971：audioInterruptMode为API9、默认SHARE_MODE，首次play前设置；2973–2987：audioRendererInfo为API10、仅initialized首次prepare前设置。3578–3592的audioInterrupt为API9；audio.d.ts:1751–1817包含eventType/forceType/hintType，1687–1698明确RESUME只是提示、系统不替应用恢复。须遵守本项目手动恢复策略 |
| 后台 | 创建AVPlayer不等于后台保活。backgroundTaskManager.d.ts:699/734的单模式申请为API9，771多模式为API12，1135–1152的AUDIO_PLAYBACK为API9；当前module未声明后台模式/KEEP_BACKGROUND_RUNNING。本候选不引入该功能，仍要求Home立即暂停 |
| cleanup | media.d.ts:2306–2328：release为API9，除released外可调用；4748–4778：FD由调用方负责关闭，release不等于closeRawFd。单活动AVPlayer、句柄所有权、prepare/seek未决取消、reset/release顺序、closeRawFd、错误恢复及页面重建必须成套处理。FD在播放器仍可能读取时不可提前close；监听器/对象/句柄都必须有可复核的释放路径 |

## 下一轮最小判别，不扩张当前实验

root已停止进一步设备实验和运行时修改。以下是未来候选的验收设计，本轮没有执行：

1. 保留r14及完整原件，绑定新候选源码/打包身份。先由root确认已有新元素成功及同倍率52秒失败证据完整，不再用改速率或零点播放代替原复现。
2. A/B只换内置短轨的字节交付：同一266,075B/SHA MP3、同一非零checkpoint、同倍率、相同暂停至少52秒，保持正常用户play/seek语义。分别记录GET完整校验、实际seeked、playing/连续currentTime、checkpoint和系统音流；一条路线成功不能代替所有矩阵。
3. 通过该最小序列后再验证非零冷重入、普通返回、.85、Home与麦克风互斥、短尾及卸载。失败/取消/超时/哈希不符必须维持旧点和旧数据；无需借此打开新的内容、签名、登录或发布工作。
4. Blob若仍失败，先记录完整字节已校验的事实及相同失败阶段，再决定AVPlayer能力原型。原生原型须先解决API12倍率产品契约；若未解决，不能声称可无损替换现播放器。

本报告只提供技术取舍依据。继续阻断：r14原生同元素静置恢复失败未关闭；A/B和原生替代均未实现/验证；完整数据审计及独立QA由各自证据决定。

SDK限制说明：已核对本机官方主声明，未联网。未取得独立官方示例的完整生命周期实证；HAP压缩资源对FD路线的限制、设备精确定位误差、倍速音质及来电/路由实际行为仍未证实。本文不以API存在替代实际SDK构建或设备验证。
