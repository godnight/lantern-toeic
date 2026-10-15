# CT Explicit Player：每次显式动作建立新媒体元素

2026-10-15。隔离树 `vocab-work/ct-explicit-player-20261015/site`，分支 `fix/ct-explicit-player-20261015`，基础提交 `4eca4a3875fe80c20d94779b6535f09af145016b`。本代理仅拥有新包装器、新聚焦测试及本文件；SpeechPlayer集成和整包验证由root负责。

## 目的与已实现边界

r14原生事实是同PID的新元素在保存点成功，而旧元素暂停后复用seek两次pre-play code2失败（含保持1×、暂停52.028秒）。本修订只把**显式play/resume**的资源生命周期改成旧媒体退役后建立新Audio及原控制器；不把该路径当作已证根因修复，不自动重试错误。

新增 `lib/explicit-bundled-playback.ts` 导入原 `createBundledPlayback`；未改Range、URL、速率、seeked、持续窗口或时长门禁，未加入Blob。

```ts
createExplicitBundledPlayback(createAudio, changed, failed, confirmed?, tick?)
// play(rate, target=0), resume(rate, target=position()),
// pause(reload=false), position(), stop(), dispose()
```

createAudio由调用方提供，负责创建并加入隐藏DOM宿主，使全局DOM暂停仍能观察元素。普通有效的每个play/resume先退役旧lease，再恰好调用factory一次。disposed后调用无动作；factory或旧资源释放异常安全失败，不循环补建。

## checkpoint 与回调所有权

包装器保存独立baseline。首次resume从有效保存目标初始化；新inner尚未确认时，position及tick始终返回之前保留的baseline，不能读取新replay内层初值0作为可信点。旧点例如18秒、replay(0)尚未确认就失败时，外层仍得到18秒。只有原控制器confirmed以后才切换本lease的点所有权，所以成功Replay可回到零附近。

退役顺序是先捕获当前已确认点，再失效lease/清current，移除wrapper timeupdate，dispose旧控制器（清原监听和定时器），暂停旧元素、移除src属性、load清资源、remove DOM节点。每个DOM清理步骤即使前一步异常也会尝试；释放异常报告失败，不借机追加第二次factory。

changed/failed/confirmed/timeupdate均核对本地lease、action generation与disposed状态。confirmed先标记本lease并采可信位置再转发；转发后不追加旧代次写入。changed(false)之后、仍属同一请求的failed会保留；若changed回调已经同步换代或dispose，旧failed被抑制。tick回调内同步stop、confirmed/changed回调内同步resume/dispose均不能让旧代次影响新元素。

pause/stop先保存确认点，再失效当前动作并停止inner；保留暂停节点，**不重建**。下一次显式动作才释放该节点并建新元素。dispose先采点，再失效所有回调并释放当前元素，重复dispose无动作；不会把清资源产生的零位timeupdate写成checkpoint。

## 聚焦验证与源码身份

运行：

```text
node --test tests/explicit-bundled-playback.test.cjs
tests 14
pass 14
fail 0
cancelled 0
skipped 0
exit 0
```

测试实际转译并运行新增wrapper和原lesson-audio控制器；只替代DOM媒体/定时器，不用inner假确认。覆盖每动作一次factory及释放顺序、fresh metadata/真实seeked前不play、首次保存点、未确认Replay失败不归零、确认后Replay切点、各准备阶段暂停/stop取消、旧DOM事件/已移除回调/旧promise拒绝、dispose幂等与DOM资源清除、新源独立点、factory失败、confirmed/changed/tick同步重入。

- wrapper SHA256：`5690e49f40217b1976909ede026c64bb46b13bd0d49830405e894f9f130b072a`。
- 新测试 SHA256：`c3ac44c82e4f56ba8466b3adf3d7431b4a2463357a499ad43c443aa05edda427`。
- 原 `lesson-audio.ts` 本checkout最初为CRLF，初始SHA256 `727416e85998fc714b46e34a2603605e3ce9b28b9a40bc8abc822f051d2af89c`；本代理没有编辑它。root并行集成期间行尾已归一，最终复核SHA256为 `995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0`，与git HEAD及冻结r14字节一致、git diff为空。行尾变化没有控制器逻辑更改。
- 本轮文件diff-check通过。独立源码复核由ct_audio_review负责并单独出具，不能由这些测试替代。

## 交接与未验证项

root负责稳定SpeechPlayer wrapper每text的effect、DOM宿主/factory、logical source和checkpoint、numeric tick回调集成，再完成全根兼容/类型、Web/SDK与新源码身份的Chrome/实际ArkWeb验证。当前测试不证明真实元素销毁已清除ArkWeb全部网络/解码缓存，也不证明r14暂停52秒失败已修复。每次显式动作重建可能带来重新读取/metadata准备延迟，实际量级待测。

本代理未构建、使用浏览器或设备、提交Git、冻结、上传、push、合入或部署；未改旧r14与已暂停Blob树。保留r14全部失败证据，不以wrapper测试通过代表用户批准、设备验收或发布授权。
