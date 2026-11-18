# Practice StrictMode / history 独立受控回归

2026-10-13 07:35 UTC。仅staging交付，由Root集成；未修改production checkout的任何文件。

可集成文件：`ui-redesign-practice.test.cjs`，SHA-256 `DE631FA5FD8DCDEABE901E3D725B25592E09EC2D1C1FB893B29E266E0B12C826`。它保留现有9项全部断言，基于同一TSX/模型harness增加5项；Root覆盖原同名测试即可沿已有 `test:study` 脚本运行，不需要生产功能开关。

本地执行命令（staging路径运行时显式指定只读项目根）：

```powershell
$env:LANTERN_REVIEW_ROOT='D:\zzl\托业学习\vocab-work\theme-redesign-20261012\site'
& 'C:\Program Files\nodejs\node.exe' --test 'D:\zzl\托业学习\vocab-work\ui-redesign-implementation-20261013\independent-code\ui-redesign-practice.test.cjs'
```

最终输出：14 tests / 14 pass / 0 fail / 0 skipped，552.3777ms。执行生产Practice SHA `0951CCEA01A894C1A3581A0F26B4CC3EA7CE37CB6DE10546D31E6AC815BBA329`；实际Vocabulary SHA `D710ECF9D1F841A0D8641DC626C128139975D91E2C46A95B3B266B2B80D808A0`。

## 新增5项的实际断言

1. StrictMode passive effect setup→cleanup→setup保持同一Practice token，push恰一次、pop listener恰一，不在挂载时打开退出确认，也不作答/打卡；最终卸载回原detail token。
2. cleanup计时器尚未运行时再真正卸载，延迟清理必须只发出一次异步history.back。最终位置仍search/detail，不越过源页；listener清空，不调用onClose/onAttempt/onFinish。
3. 保存失败B仍未增加进度；Browser Back先关图片，第二次打开退出确认，第三次关闭确认。每次维持同一Practice token、选择B和保存失败状态，不让bubble父壳先离页。
4. 最终卸载后若current entry已被新目的地settings替换，旧清理不能回退新页面。
5. 实际VocabularyLibrary与实际Practice共用受控history，使用真实已有`timetable`词条与关联题：词条Native30在overlayBlocked时返回false，Practice10处理确认；词典capture Escape不吞事件，再调用部件关闭回调；BrowserBack护住后台详情。明确结束Practice后消费Practice入口，保留原词条detail token与详情；再返回列表保留`timetable`查询。不添加收藏/词卡事件，不访问storage、API或词典大文件。

## 缺陷捕获与收敛

初次运行在第一版lease/active修复上，新增第2项实测backCalls=2，预期1；Root收到后改为单一可取消release timer。这证明新增回归能检测异步重复回退，并非只扫描实现字符串。

同一次初跑的第5项使用了不含关联题的schedule样本，无法找到题目按钮；这是测试fixture选词错误，已改为现有`timetable`，不列作生产缺陷。修正fixture及Root清理竞态修复后，全部14项通过。

## 证据边界

- 真实源码执行：Practice TSX、VocabularyLibrary TSX、study/vocabulary/dictionary模型、已有content文件。
- 模拟平台：Hook槽、effect重播、Radix部件树、Native回调、matchMedia、document focus、计时器与history。`history.back()`只请求异步遍历，导航完成后才更新state和dispatch popstate；capture顺序/stopImmediatePropagation由通用适配器处理。
- Escape通过真实词典capture回调检查不拦截，然后模拟部件dismiss；不称真正Radix Escape/focus trap通过。
- 不启动浏览器/server/模拟器；不读写用户localStorage、IndexedDB、D1/R2或设备数据。实际Chrome StrictMode发现及复验由Root另行记录，设备桥与真实媒体不在此测试结论内。

`prepare-practice-history-tests.cjs` 和 `practice-history-cases.txt` 是本地组装辅助，留在staging即可，不必加入生产测试清单；Root集成完整同名测试文件。没有把这些测试当整个改版或所有设备验收通过。
