# 界面重设计 v1.1 本机实现验收

> **用户视觉验收未通过；合入与部署暂停。** 用户最新反馈：“我看了下你这版本的设计，完全没有空洞骑士的元素了。先别合入了”。当前本地源码、HAP、截图与评审均保留。此前独立评审通过仅适用于其限定技术审查范围，不能等同用户视觉认可。中性日间/夜间主题继续不带 IP；空洞骑士和丝之歌主题需要重新讨论明确角色、场景和世界观辨识度。本次只同步暂停与验收状态，不启动重新实现、渲染或新一轮评审。


**当前状态：限定源码与受控回归缺陷经同一独立最后复验关闭，原生人工验收及404观测仍开放。** 最新源码474/474业务与受控组件测试、34/34构建后契约、类型检查及Web/mobile构建通过。[最后独立复验](reports/IMPLEMENTATION-INDEPENDENT-FINAL-RECHECK.md)直接核对当前源与指纹，确认I04/I08关闭且I01/P1保护未回退；I02/I03/I05–I07/I09–I11前轮关闭结论未被推翻。原1P1+10P2报告保留为历史，不再作为当前未修数。此源码结论不等同原生全流程、真实媒体/用户数据或无障碍验收。

对象是本机 `vocab-work/theme-redesign-20261012/site` 的 `feat/ui-redesign-v11`，HEAD `12317b26b85a71888760b0cc18242d00a843ac74` 加未提交实现。保留PR #42/#43/#45业务，GitHub main与旧部署不能代替本轮工作树。没有推送、合并、发布、部署、手机安装、真实学习数据整改或新增云题包上传。仅自有全新QA模拟器完成正常安装与冷启，见下文。

## 实现及末轮修订

桌面侧栏、移动五栏、今日任务、查词结果/详情、练习、复习、进度、资料、口语与模考已统一。四主题为默认日间/默认夜间/空洞骑士/丝之歌，持久ID仍paper/crystal/hollow/silk，主题只保存theme，已有目标与记录不重置。日夜无IP素材，两游戏普通页48px原创意象，专注学习不使用游戏装饰；body tokens覆盖Portal与模考早返回。学习、词库、模考与私人云题包保留各自备份/同步边界。

I01的临时音频恢复库在owner/nativeMode key外、按原owner保留未保存Blob与止录整理窗口；新账号不能重存旧音频。原owner恢复入口支持回听、同ID重试、下载与明确放弃；页内存不宣称跨刷新/系统杀进程持久。I02失败选择在重试或明确取消前不跨题；I03浏览器返回经录音guard。I04媒体错误保留元数据，每次成功重读递增audio key，相同URL也重挂元素；I08拒绝disabled/aria-disabled焦点目标，fallback到本词典实例可聚焦标题。I05–I07分开执行查询、IME草稿、取消加载/私人未知计数与Back/Forward/断点历史。I09已提交解析中受控查词保留原Practice；I10通知显式接手选主题并使用tokens；I11练习/口语专注时隐藏全局导航与侧栏空槽。

旧词条ID、首答/复练、考试ordinal/revision/原截止/FIFO/评分模型、账号边界与原备份协议保留；没有借UI改版迁移或清理存储。详细触发、修订与受控用例见[整改响应](reports/IMPLEMENTATION-RESPONSE-I01-I11.md)。原[初轮独立未通过报告](reports/IMPLEMENTATION-INDEPENDENT-REVIEW.md)原文保留；它记录当时快照，最新状态按本页及后续同一终审复验读取。

## 当前检查证据

| 范围 | 实际结果与证据 | 边界 |
|---|---|---|
| 业务/模型/受控组件 | [474/474](logs/full-study-test-final-recheck.log)，fail/cancelled/skipped/todo均0 | 受控Hook/媒体/时钟/历史替身不等于真实设备或所有ReactDOM流程 |
| 构建后契约 | [34/34](logs/mjs-tests-final-recheck.log)，fail/cancelled/skipped/todo均0 | 不等于GitHub CI、部署或生产账号验证 |
| TypeScript | `tsc --noEmit` exit0：[日志](logs/typecheck-final-recheck.log) | 不替代运行与布局验收 |
| Web/mobile构建 | 两者exit0：[Web](logs/web-build-final-recheck.log)、[mobile](logs/mobile-build-final-recheck.log) | JS1332.78kB/gzip407.77kB；CSS373.76kB/gzip60.79kB；>500kB警告保留，不称性能验收通过 |
| Harmony SDK/包体 | [最新proof](reports/simulator-readiness/build-lantern-ui-v11-knsxbchb/final-freeze-proof.json)：1,229限定输入新增/缺失/变化均空；1,071资源逐字节/SHA一致 | 限定runtime/build-input，docs/tests/reports不纳入；public随包许可/署名保留，见[SOURCE_SCOPE](reports/simulator-readiness/SOURCE_SCOPE.md) |
| 同一独立代码终审 | [同一最后独立复验](reports/IMPLEMENTATION-INDEPENDENT-FINAL-RECHECK.md)确认I04/I08关闭、I01/P1未回退；限定源码范围无遗留实现缺陷 | 不把作者测试、早先C09壳展示关闭或有限截图当作最终独立通过 |
| 独立实际视觉 | [前轮IV01–IV05](reports/independent-visual/IMPLEMENTATION-VISUAL-REVIEW.md)有限范围关闭，48亲见/53索引冻结；[新增I09–I11十张](reports/independent-visual/I09-I11-VISUAL-RECHECK.md)有限像素接受 | 四主题实际成功通知、手机/桌面专注与查词返回可见；不证明失败通知、所有历史/保存控制流或58全流程通过 |

测试数分别记录，不相加成“全部流程”。日志尾部计数已直接读取，类型/双构建exit0来自Root执行回报。旧416/473及旧HAP不绑定最新修订，失败日志与此前候选保留。

最新未签名HAP位于 `D:\zzl\托业学习\vocab-work\ui-redesign-implementation-20261013\simulator-readiness\build-lantern-ui-v11-knsxbchb\lantern-ui-v11-unsigned-local-only.hap`，**44,292,998字节**，SHA-256 `d10202ec9ffc908e15199d8917cc270214d36b351161d90403a786faa604f573`。归档再次读取实际包体核对，44MB包未复制入Git文档。source manifest SHA `5d0527bcf3a110e7d4791b8205f632c842460c0ce2c105d1487416c1a6e2e3d6`。SDK26.0.0.105、min/target API12、com.lantern.toeic、0.3.3/20009、debug、未签名；完整构建及安装后复核以[构建报告](reports/simulator-readiness/BUILD_RESULT.md)与[最终原生结果](reports/simulator-readiness/FINAL_NATIVE_RESULT.md)为准。

## 模拟器与未解决观测

**已启动、已安装当前HAP并冷启。** 官方CLI创建自有空白实例LanternUIQA4d5098e7，精确目标127.0.0.1:15551；没有操作旧Offline7/Content7/Books7或手机。最新HAP正常`install -r`覆盖，没有卸载/清数据/重置/授予权限/签名绕过。实际[smoke proof](reports/simulator-readiness/final-native-smoke/native-smoke-proof.json)为passed-with-open-observations：安装、启动与冷启成功，初次PID7949/冷启PID8038，bundle/Ability前台；主HTML/JS/CSS与PageEnd200。构建proof中的installed=false描述构建时点；安装结论来自独立后续smoke，不改写原proof。

每次启动仍有两个26字节text/plain子资源404，URL被系统掩码，路径与影响未知；不能猜成favicon、字体或无害请求，不能写所有资源加载成功。约3秒日志窗口、FCP564ms/冷启437ms仅是单次观察，非性能或耐久验收。没有明确应用JS异常/崩溃标记不等于零平台错误。只读[404定位方案](reports/simulator-readiness/404_DIAGNOSTIC_PLAN.md)保留，未启用原生UI/调试桥或安全设置绕过。

本轮原生只验证官方安装/Ability生命周期与主加载。**没有原生点击、搜索、系统Back、录音、媒体回放、存储数据比较、云验收或Pura X Max内外屏验收。** 当前受支持CUA无原生/任意ArkWeb attach，见[工具能力边界](reports/simulator-readiness/DEBUGGER_SCOPE.md)。自有QA安装成功不推导手机发行签名规则或真实数据保全。

## 实际Chrome与截图范围

普通共享界面在隔离41881实际StudyApp(nativeMode)；起始空数据，QA完成4次Part6首答/1启动/0打卡分钟/0录音。末轮受控查词新增一条Part6复练，未新增首答/分钟/收藏/录音。已提交B/depart原第1/4题、已提交1与词汇页签保留，BrowserBack详情→列表→Practice及Escape往返恢复question-scroll1176.67px与“查词depart”焦点。中文填值不算实体IME。

旧390px资料底部搜索回程5342、最新1440px最后B1–B2详情回目录3372以及受控probe预设5342分为三个来源，不从截图推算滚动/焦点。资料详情桌面两列，错标390副本排除。

模考由独立41883可见QA seam调用实际repository装载1包/2合成记录；同ID旧备份冲突被真实接口拒绝，后续查看已有记录没有覆盖。fixture为200合成题、32×24PNG、20秒静音WAV，证明RC/提交/原答UI边界，不证明真实完整听力或连续两小时考试。原截止2026-10-13T09:04:02.945Z未重置；复测3已答/197未答提交为1/200，首答原A与复测B独立，原答解析只读。

[当前69张索引](SCREENSHOT-INDEX.md)逐文件读取像素/字节/SHA/UTC，与CSS视口独立记录：49sample、16excluded、2historical-limited、2fixture-seam-only；0未分类。旧nonfocused toast无通知/预绘制/错视口一律excluded，focused四图只接受实际“主题已切换”成功反馈，焦点暂停计时形成的多条堆叠不当普通单次密度。`practice-lookup-return-night-390-I09-I11.jpg`重新哈希仍为`4a54166ea46731906c688f966f3281bb4b6eec2deb0f1c0733b823d12fad8ac5`，对应最终正确1/4/B/已提交1与焦点取样，没有虚构新SHA。

[原53张冻结索引](reports/history-0903-candidate/evidence-index.json)与原48亲见报告保留；[新增十张独立索引](reports/independent-visual/I09-I11-OBSERVED-SCREENSHOTS.json)另列。不同时间图片不自动绑定后续源码，观察文件数不是通过流程数。

## 剩余边界与交付

| 项目 | 当前状态 |
|---|---|
| I04/I08最后独立复验 | 已由同一终审者关闭，I01/P1未回退；474/34与最终指纹匹配。原生人工验收与404观测另列，旧未通过报告保留历史 |
| 正常JSON文件选择器/恢复入口 | Chrome扩展缺Allow access to file URLs，正常filechooser.setFiles失败；没有修改权限或绕过；QA seam成功不补算正常入口通过 |
| 真实mic/扬声器、系统Back、前后台、实体IME、软键盘/折叠 | 本轮未执行；媒体/历史替身只证明受控逻辑。模拟器有无声卡告警，不能声称真实mic可用 |
| 无障碍/性能完整验收 | 尚未完成200%放大、文本间距、完整读屏/键盘、低端设备/首屏与长时前台；少量token/DOM值与构建不代替它们 |
| 23外链可达 | 原检查均网络TypeError，不是坏链接证明：[保留失败结果](resource-links-network-failed.json) |
| 审批 | SDK/模拟器工作线没有审批请求、拒绝或安全设置变化；不能替其他manager审批ID宣称解除或仍阻塞 |

[最新原样证据复制清单](reports/LATEST-COPIED-EVIDENCE.json)、[当前截图与结构化证据](evidence-index.json)、[归档校验](ARCHIVE-VALIDATION.json)可供Root复制到正式docs/testing/ui-redesign-20261013。原工程作者报告、v1.0未通过、v1.1设计复验及独立架构目录均保留，未覆盖。最后同一终审结论返回后由Root增补；无需为了等待外部复核无限挂起已完成归档。

本机[普通预览](http://127.0.0.1:41881/)由Root保留自有服务38309；Chrome revisionQaTab2062074137已恢复默认视口并标为交付。合成fixture的41883服务42503已由Root关闭，不能把该地址当持续可用预览。原生[最低人工检查步骤](reports/simulator-readiness/native-qa-LanternUIQA4d5098e7/manual-visible-window.md)只针对自有QA；正常文件选择器若人工复验，只能在新隔离QA环境选择`browser-exam-fixtures/qa-package-only.json`或`qa-reading-and-submitted-backup.json`，对应导入题包/恢复备份入口，不能导入真实数据。其他实例不停止、不安装或重置。本归档代理没有操作服务或设备。

## 可实际打开的本机预览

[打开微光托业](http://127.0.0.1:41881/)：保留Root自有服务session38309。最终独立复验之后已重新加载Chrome并显示当前首页，另有HTTP200实测；不是旧截图缓存、发布站或原生ArkWeb验收。此QA origin含合成练习记录，勿导入真实备份。证据见[浏览器观察](reports/preview/browser-observation.json)、[HTTP观察](reports/preview/http-observation.json)、[实际截图](reports/preview/preview-verified-20261013.jpg)。原41883 fixture服务已关闭。

## 最后一次限定只读404排查

最终独立源码关闭之后对当前 knsxbchb 候选做了一次[限定只读排查](reports/simulator-readiness/final-404-readonly-diagnostic/404_FINAL_READONLY_DIAGNOSTIC.md)，核对既有原始日志、实际打包资源、HTML/CSS/JS引用、静态可解析模板及原生路由；只在自有15551上读取PID与日志，没有重复启动、重装、修改实现或系统设置。当前PID仍8038；新hilog读取exit0且为空，明确没有新增URL证据。

资源读取失败分支的26字节text/plain响应与404特征吻合，ResourceManager错误时间紧邻，但无法一一绑定请求或确认实际响应body。当前原生Index与HEAD一致，已解析静态引用存在；bundle中的/sw.js字面量受nativeMode禁止注册，不能据此认定为未知404。动态引用没有运行时参数，不宣称穷尽所有请求。

**URL仍被掩码，原生UI/ArkWeb检查通道不可用；路径和业务影响未能确认。** 这次未定位到可证实的改版错误，因此未做猜测性修补或重复构建/测试。最小人工步骤是在既有自有QA按[可见窗口指南](reports/simulator-readiness/native-qa-LanternUIQA4d5098e7/manual-visible-window.md)打开同一实例，检查首页、主题、查词是否缺图/空白，并记录回放或导航加载失败的具体屏幕；这能补影响证据，不能恢复被掩码URL。进一步URL归因需要隔离QA的公开静态路径错误日志，现有构建没有此日志，本轮未加入或启用调试/隐私设置。
