# UI 实现最终窄复验

日期：2026-10-13，执行机 PC-20230610ZTOE。独立评审对象为 `D:\zzl\托业学习\vocab-work\theme-redesign-20261012\site` 的 `feat/ui-redesign-v11`，Git HEAD `12317b26b85a71888760b0cc18242d00a843ac74` 加未提交最终候选。基准为审定 v1.1、原独立实现报告及 09:55 窄复核。本轮仅复验 I04/I08、确认 I01/P1未回退，以及核对最终运行证据和两条404；没有重新扩大功能或视觉审计。

## 结论

**I04、I08可在源码及受控回归范围关闭，I01/P1恢复保护未回退。本轮限定范围无剩余未修代码阻塞。** 前轮已关闭的 I02/I03/I05–I07/I09–I11不重新展开；原1P1+10P2报告保留为历史快照，不能继续当作当前未修数量。

474/474业务/模型/受控组件测试和34/34构建后契约已有与最后改动对应的落盘证据。允许将此候选作为代码关闭后的人工平台验收基线；**不等同原生全流程、真实用户数据、真实媒体、无障碍或发布验收通过。** 两条未归因子资源404保留开放观察，原生终验前需要补路径或实际影响证据。

本任务只读生产与作者证据，仅新增这份独立报告；未跑测试/构建、浏览器、模拟器、接口或设备；未改生产、作者验收报告、截图索引、旧评审、Git配置或真实记录，未上传/提交/发布。源码关闭判断来自直接控制流、测试源码及哈希对照；测试和原生运行结果来自作者已有记录，未冒称由本评审执行。

## I04：相同云URL的媒体重读

`app/study-app.tsx:49,83,129`：回放状态增加有效读取的 `request`；请求通过既有owner/生代/页面/页签门禁后保存该值，audio使用 `key={recordingPlay.request}`。即使返回同一URL，新的有效重读会替换音频元素，解决只清错误却不重新加载的残余。获取URL后的媒体onError、原recording对象、原ID和读取失败反馈均保留。

`tests/repo-review-regressions.test.cjs:274–283`现在明确检查第一次媒体错误后重读，src相同而audio key不同，并保持原录音对象。最终474日志第256行包含该用例通过，非仅断言getter调用两次。**关闭此代码缺陷**；真实浏览器云请求/解码/扬声器及真实重试仍需人工验收，不把替身断言当已听到音频。

## I08：到期队列完成后的返回焦点

`app/learn/vocabulary-library.tsx:49`的focusWithin返回是否找到可用目标，拒绝缺失、disabled、`:disabled`和aria-disabled；`:166`恢复列表位置后，目标不可用则聚焦本词典实例标题；`:195`标题具有实例稳定ID与 `tabIndex={-1}`。因此最后一张到期卡完成、原自测按钮已禁用时，返回仍有有效焦点落点。

`tests/ui-redesign-search.test.cjs:120–124`实际调用词库组件，覆盖仅一张到期卡完成→按钮禁用→Browser Back→标题焦点，并检查保存review数量与标题可聚焦属性。最终474日志第435行含该用例通过。**关闭此残余P2**；真实ReactDOM的屏内/Browser/Native返回、下一次Tab顺序及读屏播报仍需人工检查。截图文件存在与焦点流程通过不能等同。

## I01/P1：恢复保护未回退

`study-app.tsx:32–42,107,124`仍在owner/nativeMode keyed Workspace之外使用页内存恢复库；按原owner范围展示恢复入口并传入原clip。`speaking.tsx:68,74–88,196`仍在卸载时止录、保留processing窗口及迟到onstop最终Blob；旧组件卸载后不调用新账号保存。成功保存或明确放弃才按同ID释放。

SpeakingRoom和恢复库的SHA与前轮09:53复核完全一致，当前manifest也匹配。A的未保存音频不会因切B被静默释放，B不展示或重存A音频，回A可回听/同ID重试/下载/明确放弃。外层离页保护保留。恢复只保证当前页内存，不声称跨刷新、系统杀进程或设备故障持久；本轮不要求修改DB/key/ID/API。

## 最终测试与源版本对应

直接读取正式归档 `docs/testing/ui-redesign-20261013/ACCEPTANCE.md`、日志和清单，不仅采用作者口头总结：

- 最后I04/I08实现mtime均为10:00:48 UTC；对应测试mtime分别10:00:57与10:03:03。最终474日志mtime10:05:12；第493–499行：tests/pass474，fail/cancelled/skipped/todo均0。日志含上述两条最后修正用例。
- 34契约日志mtime10:09:47，第35–41行：tests/pass34，fail/cancelled/skipped/todo均0。它是构建后契约范围，I04/I08行为证明来自474中的对应用例，不把两类数量相加。
- 当前 `IMPLEMENTATION-MANIFEST.json` 中两份实现和两份测试SHA与当前文件一致；knsxbchb `source-manifest.json` 中StudyApp、词库、SpeakingRoom、恢复库SHA均与当前一致。最终日志SHA与 `reports/LATEST-COPIED-EVIDENCE.json` 匹配。
- source manifest SHA为 `5d0527bcf3a110e7d4791b8205f632c842460c0ce2c105d1487416c1a6e2e3d6`，匹配final-freeze-proof。10:10:47的proof报告1,229限定runtime/build-input新增/缺失/变更均空、1,071资源逐字节一致。docs/tests/reports不在HAP源冻结范围，测试文件另由implementation manifest核对，不扩大为整个仓库冻结。

**据这组manifest、执行日志、最后修改时间及复制校验，可确认474/34是最后I04/I08修正后的候选证据，旧473/416不替代它。** 单条文本日志没有自行携带源码哈希；上述版本关联依赖整组落盘证据，不宣称可单靠日志计数证明任意后续源码，也不声称本评审独立执行了这些命令。

## 新HAP与404开放观察

当前正常候选HAP：44,292,998字节，SHA `d10202ec9ffc908e15199d8917cc270214d36b351161d90403a786faa604f573`，knsxbchb、debug未签名、com.lantern.toeic 0.3.3/20009。已读最终原生结果及smoke proof：官方精确目标上正常 `install -r`，Ability启动、应用force-stop后冷启动成功，PID7949→8038；主HTML/JS/CSS及PageEnd200。该链路没有卸载/清数据/重置；**没有实际旧学习数据比较，不能据此声称验证保数据升级或原生业务全流程。** 静态proof的installed=false描述静态步骤，后续smoke另证明安装，不误读为最终未安装。

对当前两份原始HiLog与smoke proof做窄核：

- 初启第1438/1441行、冷启第1456/1476行仍各有两条26B、text/plain子资源404；请求URL被系统掩码，request ID不足以映射资产路径。
- 附近初启1435/冷启1453有 `GetRawFileContent failed name is empty`，没有与404请求URL的直接绑定，不能据此确定缺失文件、失败发起者或业务影响。
- 原始日志SHA与smoke proof一致。主资源200、PageEnd/FCP、无明确JS崩溃标记均不能证明子资源无害或全部资源加载成功。
- 现有 `404_DIAGNOSTIC_PLAN.md` 的静态扫描对象为09:03历史候选；它是待执行的最小隔离诊断方案，不能当作当前HAP已定位的证据。本轮没有重打诊断包、改隐私/调试开关、操作设备或扩大资源审计。

**仍无法识别两条404的URL及影响。** 不猜成favicon/字体，不升级为已证实业务回归，也不删除观察。原生完整验收前应在自有隔离QA取得可关联的安全静态路径/错误来源并核对当前HAP，或提供足以界定实际影响的原生流程证据。

## 剩余人工验收门槛

1. 真实媒体与恢复：麦克风权限/止录/后台、账号切换失败音频恢复、真实云音频错误后相同URL重读、播放与下载文件可用；保存ID/开始时间及owner保持。页内存保护不代替刷新/进程退出持久。
2. 真实返回与焦点：屏内/Browser/Native Back；最后到期卡完成后可见标题焦点、下一Tab可继续、读屏播报；实体IME、软键盘遮挡和折叠内外屏。正常JSON文件选择器/导入与恢复不能由QA seam代验。
3. 原生加载及数据：两条404定位/影响；原生实际交互、真实媒体、持久化及升级前后数据比较。仅安装/Ability前台/冷启不算这些通过。当前原生UI控制通道缺失，模拟器声卡警告保留。
4. 已列未完成平台项：200%文本放大/间距、完整键盘/读屏、低端设备/长时前台性能、外链网络可达。它们是原有人工门槛，本轮未新增大范围审计要求。

上述门槛未完成时，可报告“限定代码缺陷关闭、最终候选测试/构建通过、隔离原生安装与冷启通过”；不能报告“原生全流程/手机发布/全部资源/真实数据验收通过”。

## 指纹与归档

开始复核10:23:25 UTC，最终归档前再次核对关键源文件。以下均为SHA-256：

| 文件 | mtime UTC | SHA-256 |
|---|---|---|
| app/study-app.tsx | 10:00:48.8735968 | `CDCF87ED21B67F21BEF81CE11583A1B3063FD34111AF8815F194D45614C7CE3B` |
| app/learn/vocabulary-library.tsx | 10:00:48.8742789 | `EA863D2FB439B722273F1943E9DBCFEAF569A5DC828F679ABB494CDC7209669E` |
| app/learn/speaking.tsx | 09:23:06.4844637 | `1AE6532A0C71355D50CB842CF963BB91515DAC0EA2AB4FF695A38C056294C732` |
| lib/speaking-recovery.ts | 09:23:03.1139152 | `3BD29745773E038C3D92F6FEDFEB965C35904C60C0F73723EAD5AAF61FE1ECB6` |
| tests/repo-review-regressions.test.cjs | 10:00:57.0800694 | `10557BD55F6DD5F0EB1BECEF41003010CEADBE48AB5AE4BD508DBCFD1EF985CA` |
| tests/ui-redesign-search.test.cjs | 10:03:03.0516106 | `7554DEBEFF840E92CDAA0168CCC2D5144036CA6629F2E7188D10BFDB9C2398E7` |
| logs/full-study-test-final-recheck.log | 10:05:12.2942294 | `32F23EDE5E71C8A4D7DCCE08DBA66534D7B594BCBEE449134972BE72E546481C` |
| logs/mjs-tests-final-recheck.log | 10:09:47.3265400 | `E8E74062ED3BE1C937F0A28C3A6C500DC439598A82D507E3439E6A23E9DE5E04` |
| ACCEPTANCE.md | 10:19:04.3053729 | `A79E1BC655E09B7696218632B9368DAD043A39F8B90DBA6D314B178EE22AE82B` |

后三项相对 `docs/testing/ui-redesign-20261013/`。归档前 `2026-10-13T10:28:31.7124899Z` 再核四份关键实现、两份测试及ACCEPTANCE，共7文件指纹全部一致。旧独立报告与作者原稿不覆盖；本结论作为独立补充归档。
