# CT r14 原生失败：只读分类与最小复现

2026-10-15 UTC；设备 hilog 本地显示为次日 05:xx。只新增本文件；冻结 r14 控制器、宿主与设备均未改动。root 独占原生操作，本报告读取 root 已采集的普通 UI、AudioPolicy 与受控日志。

**结论：已复现暂停后复用旧 Audio 元素的 seek/媒体资源生命周期路径失败。失败在 play 前，不能归为持续确认超时、速率切换所必需、空 seekable 死锁或所有 ArkWeb 非零暂停 seek 不支持。具体是传输/缓存响应消费还是引擎资源状态，仍未证实。暂停点保持，r14 不能作为续播缺陷已关闭交付。**

## 固定身份与数据

- 候选 `CT-20261015-r14-50737e67a3e7`，`0.3.5/20029`；1370 输入总 SHA `50737e67a3e76e59a7e65140028cec4a51c0b5357e8a3ad4e650a02f65aff1c9`。
- 控制器 SHA256 `995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0`；Index SHA256 `e1f0558417f08217e5d61a014617f58eb2b060eb10071e37361d83e8fc9f28b4`；AssetRange SHA256 `72b72e5fe3ae321b50dc775ff18f1c25746574ed0c4ed7a753ffb00ca5e28ef2`。
- 本轮相关日志均为 PID12274。目标资产 `1935c17708c726884ac9.mp3` 长266075字节，源文件 `mobile/offline-audio/mp3/` 与外层 `resources/CT-20261015-r14/web/audio/offline/` 完全一致，SHA256 `275c0d315f7ab35fe7c3a004d2cbb33316bb82676c3da21e002e68093b932d2a`。这是本地源/打包资源目录比较，未另外声称已复验设备/HAP内字节。
- 262144起的3931字节尾段 SHA256 `2b3d9b27f37e036f71d724482540bbae11b93d532fac90bae044b4116dd84cad`。

## 关联到同一进程的事实

| 场景 | 实际事件与原生观察 | 结论范围 |
|---|---|---|
| cold .85，player1/request2 | 05:01:35.187暂停load；.231 metadata/seek-request；.232真实seeked并settled5.613；.233才设.85并play；05:01:36.282 confirmed6.652279。UI5.6→7.3→8.5→9.6，两次匹配UID音流运行。05:01:40.199 stop9.969054。 | 本次新load后的暂停非零定位与.85持续播放确实成功。 |
| 同元素下一次1×请求，player1/request6 | 05:02:18.514 begin current9.969362、target9.969054、ready3、完整seekable，随即seek-request；.528 ready1、seeking=true、media-error/code2，无seeked/play。UI保持10.0，三次系统观察无本应用运行音流。 | 暂停seek阶段14ms失败；此前DOM rate=.85是start前旧属性，不证明普通selector未选1×。 |
| 普通关闭/保存/恢复后的新元素，player4/request2 | 同PID，05:06:17.351 begin current0并load；.366新metadata；.372真实暂停seeked9.969；.373 play1；05:06:18.423 confirmed11.140411；UI10.0→11.9→13.3→14.6，两次匹配UID音流运行；05:06:22.451 stop15.170487。 | 相同保存点仅正常毫秒舍入，新的元素在1×成功；不需进程冷重启。 |
| 保持1×，同player4暂停52.028秒后再继续 | stop uptime215700451；begin215752479 target15.170487/current15.170875、ready3、完整seekable、rate1。seek-request后19ms rejected215752498：ready1、seeking=true、code2，无seeked/play。UI保持15.2，多次系统观察无运行音流。 | 不改速率也能复现；速率切换不是必要条件。 |

新元素1×的 preparedPosition=9.969，firstProgressPosition=10.336598；confirmed位置11.140411是持续窗口后的点，不能把+1.171411误写为起播误差。冷.85亦应分清定位5.613、首推进5.966798与延后确认6.652279。

证据（外层 dev-native 原件保持）：

- [cold观察](../../../dev-native/r14-085-cold-first-nonzero-observations.json)、[cold控制日志](../../../dev-native/r14-085-cold-first-nonzero-18-playback-log.stdout.txt)、[cold Range](../../../dev-native/r14-085-cold-first-nonzero-19-range-log.stdout.txt)。
- [首次旧元素失败](../../../dev-native/r14-1x-repeat-base-observations.json)、[28控制日志](../../../dev-native/r14-1x-repeat-base-28-playback-log.stdout.txt)、[29 Range](../../../dev-native/r14-1x-repeat-base-29-range-log.stdout.txt)；普通selector证据为f403–f407。
- [新元素同点成功](../../../dev-native/r14-new-element-same-checkpoint-observations.json)、[控制日志](../../../dev-native/r14-new-element-same-checkpoint-18-playback-log.stdout.txt)。
- [不改速率的复现](../../../dev-native/r14-unchanged-rate-after-fixed-idle-observations.json)、[26控制日志](../../../dev-native/r14-unchanged-rate-after-fixed-idle-26-playback-log.stdout.txt)、[27 Range](../../../dev-native/r14-unchanged-rate-after-fixed-idle-27-range-log.stdout.txt)。

## 宿主 Range 与 SDK：确认到哪一层

[Index.ets:477–550](../../harmony/entry/src/main/ets/pages/Index.ets) 对打包哈希MP3调用同步 `getRawFileContentSync`。虽然外层方法声明async，媒体分支没有执行await；本次响应在intercept返回前完成data/status/header及ready=true。[AssetRange.ets](../../harmony/entry/src/main/ets/services/AssetRange.ets) 使用Uint8Array实际byteOffset切出独立ArrayBuffer；没有宿主重试计时器或跨请求共享可变响应。

实际记录 `Range: bytes=262144-`、非HEAD、If-Range不存在。宿主配置及日志对应：

```text
status: 206 Partial Content
response MIME property: audio/mpeg
response encoding property: utf-8
Cache-Control: no-store
X-Content-Type-Options: nosniff
Accept-Ranges: bytes
Content-Length: 3931
Content-Range: bytes 262144-266074/266075
ArrayBuffer.byteLength: 3931
ready: true
```

3931=266074−262144+1，完整长度写在Content-Range而非把266075误作该片段Content-Length，符合[HTTP单段206语义](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.7.1)。Mime由专门属性设置；日志不等于已读取引擎最终生成的完整响应头。If-Range回退、HEAD、416、多范围路径均未出现在这组故障响应，不能当成已触发原因。

本地SDK `...sdk/default/openharmony/ets/component/web.d.ts:2918–2988`：ArrayBuffer是API11起的binary输入；setResponseCode接受number，未见禁止206条款；setResponseIsReady只声明资源已准备。resourceManager声明2433–2446提供API10起同步Uint8Array读取。[OpenHarmony一手API文档](https://raw.githubusercontent.com/openharmony/docs/master/en/application-dev/reference/apis-arkweb/arkts-basic-components-web-WebResourceResponse.md)与此相符，但没有给出本例消费者已接收全部字节、EOF或响应生命周期结束的确认契约。因此 ready206 日志只能证明宿主完成设置，不能证明ArkWeb接受/消费完毕；也没有证据宣称ArrayBuffer必遭UTF-8转码或必须手工保活。

`no-store` 是真实配置。[RFC9111](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.5)要求缓存不保存/复用于另一请求；这不证明媒体内部缓冲状态、EOF、解码器生命周期或暂停后就绪，也不能单凭它决定改成缓存命中即可修复。

## 重复尾段的边界

重复尾段最迟在cold成功路径05:01:35.191的id3已出现，早于seeked/play。其后仍成功推进约5秒并有真实系统音流；故“有重复尾段”不足以证明失败、也不是只在暂停后才发生。

两次快照合并id3–33，均为该3931字节206；请求间隔从305ms逐步约每次增加50ms，最后1753ms。宿主没有这种重试循环，故请求侧重复这一现象成立，具体重试原因未证。首次失败前29快照只到05:02:06.035/id33，代码预算64且未见limit，既不能称预算耗尽，也不能断言失败时完全无请求。后续player4的27快照则明确在05:06:44.764出现 `phase=limit requests=64`，早于05:07:14失败；此后缺少Range记录受预算约束，不是“无网络请求”证据。

## 分类、可证伪假设与最小复现

- **资源生命周期/旧元素状态：当前最强定位。** 同PID同点新元素成功，旧元素暂停后在.85切1与固定1两次均pre-play code2失败。仍不能分开媒体元素自身、其loader/demux缓存状态和底层拦截响应消费。
- **Range消费者/EOF或缓存：待查假设。** 重复末尾及渐增重试间隔与此相容，但成功期间同样重复；宿主算术及原始资源目录字节未见错。精确到引擎层的读完/EOF/底层错误尚缺。
- **业务门禁误超时：这两次不成立。** 不是10秒deadline、不是750ms确认窗口、不是时长不一致、不是空seekable；真实原生error事件先于seeked/play，保点停止符合门禁。
- **平台一概不支持暂停seek或1×/.85：被正向对照反证。** 只能说当前旧元素路径不可靠，不能推广到全部资源、设备或引擎。

保留最小复现：同冻结r14、同PID、普通UI恢复同内置主轨→确认实际推进/系统音流→普通暂停保点→保持同速率1×、同元素等52秒→普通继续。观察begin/seek-request至19ms code2且无seeked/play，再普通关闭保存并恢复，核player编号变更及新load/metadata/seeked对照。root已完成这些步骤，当前停止更多设备实验，不再重复污染证据。

若后续协调一个探针修订，只改变一个变量：保持数据/素材/速率/门禁，用同元素强制暂停load或新元素准备，关联fresh metadata、真正seeked、code2、实际持续推进及独立音流；与原路径并列保留。若两者仍失败，再以清单白名单和完整长度/SHA校验的本地整文件读取排除HTTP媒体Range消费，不将Blob或原生API预先宣称为可靠修复。替代方案成本与行为见独立[媒体方案只读评估](CT-R14-MEDIA-ALTERNATIVES-READONLY.md)，由root协调新身份，不改冻结r14。

另有明确源码边界：当前mediaError只在active时终止；失败不标记needsReload，readyState仍1时下次显式请求可能继续复用同资源。HTML标准规定[媒体加载算法重置error并重新选择资源](https://html.spec.whatwg.org/multipage/media.html#media-element-load-algorithm)，而[code2表示可用资源的获取过程中出错](https://html.spec.whatwg.org/multipage/media.html#error-codes)。这使“失败资源需要新load/新元素”成为后续验证点；它**不是首次暂停失败的已证根因，也不是标记needsReload就已修复**。当前证据未记录暂停期间inactive元素的error/networkState，不能声称错误一定早在暂停中已发生。

## 交接条件

只读检查可再核最终HAP内同资产与上述SHA、保留同PID故障前后底层媒体错误上下文；不得用本报告推断未采到的EOF、buffered或native错误文本。源/资源目录一致不替代设备实际读到的内容一致。后续每个探针由root定义独立身份、保留checkpoint和本轮失败证据，再决定实现方向。未改等待事件、时间容差、缓存头或生产实现；未把测试、静态检查或一次成功当成用户批准/发布授权。
