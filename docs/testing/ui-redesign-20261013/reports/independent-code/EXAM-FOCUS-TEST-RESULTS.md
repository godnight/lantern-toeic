# 答题卡跳题 / 延迟焦点独立回归

日期：2026-10-13。Root负责实际Chrome验收；本代理只复读审定spec/源码并在staging增加受控测试，未修改production源码。

交付：完整 `ui-redesign-exam.test.cjs`，保留原15项，增加3项，最终 **18/18通过，0失败，0跳过**，1276.0924ms。可由Root覆盖同名测试，沿已有 `test:study` 入口；`prepare-exam-focus-tests.cjs` 与 `exam-focus-cases.txt` 仅作本地组装辅助，无需集成。

核验源：`app/learn/mock-exam.tsx` SHA `844F8F50A1A32EA64201B64C31259D6D034C299AAF5FBB63E42C647CDCDDCFBD`。
交付测试SHA：`10E12B92D3A2C854C21F2D8CA9E0025D83210ECD8A5BF8A7A70B96D7E4BC1926`。

```powershell
$env:LANTERN_SITE_ROOT='D:\zzl\托业学习\vocab-work\theme-redesign-20261012\site'
& 'C:\Program Files\nodejs\node.exe' --test 'D:\zzl\托业学习\vocab-work\ui-redesign-implementation-20261013\independent-code\ui-redesign-exam.test.cjs'
```

## 设计与代码判断

DESIGN-SPEC EX10要求手机答题卡返回当前题，EX08–09要求手机流式材料/题面关系及同组切题位置保持。成功答题卡选择定位当前`.mock-question`，并提供本题组已有材料锚点，是实现审定导航的展示修复。Root将 `fromCard=true` 限定到答题卡入口，普通上一/下一不自动scroll；没有更改FIFO、expectedRevision、deadline、交卷快照、原题包或attempt身份。

实际select先捕获session和attempt.id，活动考试仍await既有perform/repo.select/apply；成功才rAF。rAF再校验session、原attempt.id，并以精确question number匹配DOM。原卷复盘只setReviewNumber，仍不写普通Attempt/模考答案。失败或身份过期不会调scroll/focus。

材料按钮用当前article中的`.mock-materials`，tabIndex=-1允许程序focus，并focus preventScroll；没有新材料/题文/OCR或媒体状态。实际焦点可见、读取顺序和320尺寸属于Root/视觉运行验收。

## 新增3项

1. 活动RC点击答题卡176：保存后activeQuestion=176，下一paint才scroll/focus176。ID、LC/RC期限和answers保持；普通Next177不新增焦点frame或scroll，不写answer/submit。
2. select保存失败：activeQuestion仍101，完整attempt JSON语义不变，没有排frame/DOM查询/scroll；错误可见。重新点击成功后才focus147，原期限/answers保持。
3. 同一owner两条已交卷真实模型记录先后选择相同147题号：旧frame必须在DOM查询前被attempt.id guard挡住，新frame仅focus第二条。再卸载owner，旧176frame不查询或focus。两条已提交记录/答案/期限不变，复盘没有select/answer/submit存储调用。

测试调用实际TSX和真实exam模型，使用受控repository、Hook、DOM查询与rAF队列。第3项刻意让新旧记录同题号、DOM都有匹配目标，避免只靠“旧元素不存在”得到假通过。数据比较按JSON语义归一，避免Node VM跨realm原型造成无关失败；未以归一化忽略字段差异。

## 边界

未运行ReactDOM、Chrome、ArkWeb、真实媒体、用户数据库或两小时计时。Root报告的实际320卡格44.34×44、147题定位y23.95及材料按钮成功属于Root亲测，本代理不代领。此次18通过不能替代全主题/屏宽/实际焦点及设备验收。
