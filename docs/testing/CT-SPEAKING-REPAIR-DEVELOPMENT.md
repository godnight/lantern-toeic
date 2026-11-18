# CT-r12 口语弹窗开发验证

原r11原生截图裁切可用真实生产CSS复现：individual translate为-50%/-50%，rect[-160,-444,320,888]。打包器把旧transform:none+translate:none合并为transform:translate(0,0)，留下Tailwind独立translate；全屏left/top0因而偏出屏幕。新DialogContent可选positioning=inset，不生成居中/zoom类；默认center行为保留。SpeakingRoom与未保存确认框用此variant，专属可视窗口CSS变量来自visualViewport resize/scroll/window resize，卸载清理；无全局viewport或存储变更。内部滚动flex1/min-height0，工具栏固定，safe-area内边距保留。

独立DOM首轮还检出主题通用dialog max-height specificity覆盖专属可视高：420高可视窗口中discard高526.25溢出。修订只给口语两弹窗可视max-height与room/scroll边界明确优先级；不修改通用主题约定。所有失败原始证据保留。

开发检查：类型/Web/SDK通过；739/739 CJS与宿主测试、34/34 MJS通过。既有录音生命周期测试执行真实新增viewport hook；适配VM import后不以固定替身绕过。新 tests/browser/speaking-viewport.cjs 检查真实React/Dialog及320/430/1440布局、内部滚动与按钮hit-test、420高/offset32及64的受控IME、未保存确认留下/放弃、关闭重开。真实day主题源码9/9，SDK实际minified CSS同fixture9/9。最终证据外层 dev-speaking/2026-10-15T19-39-09.321Z-14b332/report.json；同目录保存实际压缩CSS，源指纹前后相同。无mic/play调用，自有服务已关闭。

冻结CT-20261015-r12-dbaa84e640e9，0.3.5/20027，1369输入SHA dbaa84e640e915d285470c2606f3c2607d859e1b42edc81a29cf9d2bb9c03a29。SDK HAP SHA581b455f2a00324000cb9ebf765ef6a38bcd8b646b50ea15dc4809175b404a9b，1091资源与包一致。新源码/HAP/资源/证据准确身份见外层清单。r11原39工件保持；本候选未原生安装、未动15551或任何其它设备，真实ArkWeb/系统键盘/录放NOT_RUN，须dot协调窗口后再验。

音频运行源码与r11相同。dot新增QA非零已保存点恢复失败待完整复现证据；当前只读分析确认代码先等目标seekable才首次muted play的条件性等待，不据此断言根因。此布局包不称续播已修复/独立QA通过，不因739/9项通过关闭原缺陷。救援工件另树单列，实际回滚仍不得由文档补算。
