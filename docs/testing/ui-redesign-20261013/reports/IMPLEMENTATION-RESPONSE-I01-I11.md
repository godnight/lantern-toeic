# 实施整改响应 I01–I11

2026-10-13。对应同一独立评审者的 [IMPLEMENTATION-INDEPENDENT-REVIEW.md](IMPLEMENTATION-INDEPENDENT-REVIEW.md)。原报告保持原文。本页记录作者修订与验证，**不代替独立复验关闭**。当前源码仍是本地未提交候选，没有发布、推送、合并、安装手机或修改真实学习数据。

## 最终候选核对

最后 I04/I08 两项 P2 修订后的源码已重新通过 **474/474 学习测试、34/34 MJS、tsc、Web build、mobile build**。I04 每次成功取得 URL 使用 request key 重挂 audio，即使云端返回同一 URL；I08 返回焦点拒绝 disabled/aria-disabled 控件并退到本实例 h1。对应实际组件回归分别覆盖相同 URL 不同媒体 key、最后一张到期卡学习完成后按钮禁用但标题可获焦点；未用源码匹配冒充行为验证。

[同一独立最后复验](IMPLEMENTATION-INDEPENDENT-FINAL-RECHECK.md)已确认 **I04/I08 关闭、I01/P1 保护未回退**，限定源码与受控回归范围无遗留实现缺陷；不等同完整原生、真实媒体/数据或无障碍验收通过。下面各项记录保留修订过程，状态以本段及[当前验收](../../../testing/ui-redesign-20261013/ACCEPTANCE.md)为准。

最后 unsigned HAP `build-lantern-ui-v11-knsxbchb/lantern-ui-v11-unsigned-local-only.hap` 为 **44,292,998B**，SHA-256 `d10202ec9ffc908e15199d8917cc270214d36b351161d90403a786faa604f573`；**1,071 资源 / 1,229 构建输入** path set 与 hash 均与当前源一致。仅对新建自有 QA `LanternUIQA4d5098e7` / HDC 127.0.0.1:15551 做 preserve-data 升级，最终包 AA start 与冷启动成功、身份一致。未签名、发布、上传、手机安装、清空数据或操作旧模拟器。

日志仍有两个 URL 被掩码的子资源 404，未归因；原生 UI 自动化通道不可用，正常文件选择器/真实麦克风/OS IME/原生 Back与后台/200%及读屏/Pura X Max 实机仍待验收。原生构建与启动成功不能替代这些交互证明。

## 可立即只读复核的修订

| 项目 | 已合入的具体行为 | 验证与当前状态 |
|---|---|---|
| I01 / P1 | owner/nativeMode keyed 工作区外的页内存恢复库按原记录范围保留临时 Blob。录制/处理中切换会止录、保留待回收标记，延迟 onstop 以同 ID/原开始及止录时间替换；不调用新账号保存。B 不显示 A 音频，回 A 有恢复入口；未完成的原保存 Promise 保留串行门禁，失败可重试、下载或明确放弃。只有保存成功或明确放弃按同 ID 释放。跨账号离页仍有外层 beforeunload 保护。没有改 DB、存储 key、备份或 API。 | [口语回归](../../../../tests/ui-redesign-speaking.test.cjs) 35/35，实际 Room、恢复库和外层 Guard 执行；含失败、重试、放弃、延迟 onstop、空音频、未决保存、迟到权限及 StrictMode。Root scope/恢复入口另有真实 hook/组件集成回归。作者完成；独立终审待回。 |
| I02 | 失败 pending 选择尚未成功保存或明确取消时，上一题/下一题/答题卡禁用，同步 ref 拒绝旧跨题回调；重新读取不静默清空草稿。同题修改仍遵循原保存流程；成绩只读 durable 答案。 | 模考 28 项回归保留原 22 项并增 6 项，含原答锁定、反复失败/成功、明确取消及旧回调。 |
| I03 | SpeakingRoom 拥有可取消释放的 Browser history 层；Back 与页面/Native 调用同一 requestClose。准备、止录、processing、pending save 和失败确认均保持门禁，取消重插原层，最终离开只消费自己的层。 | 口语 35 项中覆盖 Browser Back、StrictMode 单层/单释放及更换目的地不误退。真实 Browser 门禁待联动复验。 |
| I04 | 获取 URL 后的 audio onError 显示加载/解码失败、保留原录音元数据和重新读取入口；重新读取仍使用原 recording 对象及 owner/请求世代检查。与获取 URL 失败分开。 | Root 实际回放组件回归从 URL 获取成功后触发 media error，再重读同 ID；没有用返回 URL 冒充播放成功。 |
| I05 | 结果/无结果使用已执行查询；IME 草稿与 deferred 查询未一致时提示输入/更新状态，不把尚未执行的文字报成零结果。 | 查词修订回归覆盖 composition、deferred、Enter 和错误后重试。 |
| I06 | 取消/清空 general 查询复位 loading；私人读取未 ready 或有 error 时显示读取中/不可读，不显示已核实的 0 收藏/到期数，且不写空记录。 | 查词取消加载、私人读取失败与恢复用例。 |
| I07 | 词典 history 保存 view/selectedId/context；Back/Forward 恢复相应详情，宽→窄补自己的层。返回父来源先等待 child Back ack，再调用父层；Root 普通导航移除过期 vocabulary/practice/speaking/lookup 标记。 | 同 token Forward、断点切换、取消迟到 frame、owner 切换与 parent ack 回归。 |
| I08 | 自测前保存触发控件稳定信息，返回先恢复列表/滚动再恢复触发焦点。DOM ID 使用 useId，焦点限定于本词典实例；嵌套弹层用其 scrollTop，保留底层页面位置。 | 实例 ID 不相交、弹层滚动、列表自测焦点及无 history 主机回归。 |
| I09 | 仅已成功提交解析提供查词入口。保持原 Practice Dialog、题号、材料、答案、听写、图层及实例；专用 lookup 层中的词典接 initialQuery，返回原触发按钮。词典 lookupOnly 隐藏再开启词卡/关联题的入口，避免死按钮或嵌套第二个练习。 | Practice 原 14 + 新 4 项，Root 嵌套队列/触发焦点回归；实际 Browser/Portal 往返尚在检查。 |
| I10 | Toaster 显式采用当前 UI colorScheme，去掉系统 richColors；通知背景/文字/边框继承 body 的主题 tokens，在原位出现。 | 当前日/夜/空洞/丝之歌的 actual DOM computed colors 已核；可见截图取证进行中，旧无可见 toast 的图不算通知通过。 |
| I11 | 普通 Practice/Speaking 激活时共享 focused 标志；顶部、桌面侧栏和手机导航均隐藏，内容 margin 清零，仍使用实际受控返回和 Dialog 焦点保护。 | 实际前景/背景 DOM 与手机/桌面截图复验进行中；不把 Radix 禁背景点击等同设计落实。 |

I05–I08 及 I09 的词典组件当前 [回归](../../../../tests/ui-redesign-search.test.cjs) **39/39**；组件 imports 在项目中语义/语法诊断为 0。子组件限定复核与原独立终审分别报告。

## 生命周期与数据边界

临时恢复只存在于当前页的内存，不声称跨刷新、应用被系统杀死或设备故障持久。全页离开仍提示，保存失败有下载/明确放弃入口。待回收的空 Blob 标记只保护 stop→onstop 窗口，不显示为已保存录音或可播放音频；空最终片段会释放该标记。已成功保存的音频仍由原 hook/IndexedDB/云同步处理。

旧偏好、打卡和练习回调仍绑定原账号，key 重挂隔离新工作区；没有将旧恢复库音频交给新账号的 addRecording。主题继续仅更新 theme。旧条目 ID、首答/复练、考试 ordinal/revision/截止、四套学习/词库/考试/私人题包范围保持不变。

## 本机模拟器与候选区别

官方 CLI 已在全新隔离实例 `LanternUIQA4d5098e7` 创建、启动、首次安装并冷启整改前 unsigned 候选。HDC `127.0.0.1:15551` Connected、boot completed、API 26；bundle/ability foreground，ArkWeb 主 HTML/JS/CSS/PageEnd 200。没有审批、签名绕过、系统安全变更、旧实例启动/停止或旧 overlay 修改。

日志仍有两个路径未知的子资源 404，不能写全部资源加载成功。当前原生 UI 控制接口不可用，未做点击、系统 Back、真实麦克风或真机内外屏验收。下一候选必须重跑全量/类型/双构建并重新核对 HAP，再在这个自有实例保持数据升级与冷启；旧 416/34 和 09:03 HAP只保留为整改前证据。

## 待回证据

同一终审者 09:55 复核已确认 I01/P1 在源码范围关闭，其余修订只剩 I04 同 URL 重读、I08 禁用控件焦点两项 P2。两处现已做最小修正：每次成功读取递增 audio key，即使 URL 相同仍挂载新元素；自测返回拒绝 disabled/aria-disabled 目标，备用焦点为本实例 h1（tabIndex=-1）。实际 Root 相同 URL 重试和最后一张到期词反馈后的禁用按钮回归 **61/61** 通过。最终全量、双构建和新 HAP 正在运行，请同一评审者复核这两处；不能用此前 473 日志覆盖这次修改。

真实 Chrome 已完成：已提交 Part6 原题解析→题内查词→详情→Browser Back 列表→原解析，随后 Escape 往返，保持 B 原答案、1/4 题、已提交 1 题、词汇页签与 `.question-scroll` 1176.67px，并恢复“查词 depart”按钮焦点；不卸载 Practice。结束练习后原 advance reservation 详情仍在，Back/Forward 恢复 reservation 查询及该详情。桌面来源按钮变为手机宽度时，会改用可见的顶部查词入口恢复焦点，保留原来源 scrollY159.33。该 QA origin 新增一条 Part6 复练，未新增首答、时长、收藏或录音。

四主题 Toast 与手机/桌面专注壳已通过有限真实截图复核，见独立 staging 的 `I09-I11-VISUAL-RECHECK.md`；这是像素范围，不能代替 P1 控制流或原生验收。

最新全量运行与真实 Root/Portal 查词、主题通知和专注壳截图仍在收尾。最新 TypeScript 检查已通过，初轮全量 470 中旧 dictionary fixture 缺少 history/useId 环境导致一项失败；已按实际接口补齐并保留原断言，相关 lookup 63/63 已通过。这里不会把该初轮失败抹去或宣称最终全量通过。请同一评审者先只读复核本页列出的源码修订，最终结论以其复验报告为准。
