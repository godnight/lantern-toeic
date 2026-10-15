# CT Explicit Player：真实 Chrome 独立媒体夹具

状态：**PASS_LIMITED_CHROME_EXPLICIT_PLAYER，单次4/4通过，exit0**。2026-10-15。本代理本任务只拥有 `tests/browser/explicit-player.cjs` 与本文件，不改旧 `paused-prepare.cjs`、wrapper、inner、SpeechPlayer或设备。

root明确GO后在21:46:35.495Z–21:46:59.149Z运行一次；候选 `CT-20261015-r15-ba90c9bc3f45` /20030。Chrome157.0.8092.0，Playwright1.62.1。无失败、无重跑。浏览器与服务器均确认关闭，原生窗口已交还root。

## 单次运行结果

- [原始报告](../../reports/explicit-player/2026-10-15T21-46-35.495Z-2323f5/report.json) SHA256 `c03b468a76d935b1b6f6516df4d886189f02dd99a7981a41956a8690b0711e93`。
- [证据SHA清单](../../reports/explicit-player/2026-10-15T21-46-35.495Z-2323f5/SHA256SUMS.json) SHA256 `b2d31ab565e42622f1f6bfebe06accd0e67cc26235900a4e5c42e1e39a43c932`，包含逐次事件、13点样本、源码快照与fixture；未覆盖或删除任何旧r14结果。
- wrapper5690…、inner995e…、practice b06a…完整SHA与下方命令一致，运行始末均核对；原MP3为266075字节，SHA256 `275c0d315f7ab35fe7c3a004d2cbb33316bb82676c3da21e002e68093b932d2a`。浏览器实际206共7次，服务器已发送206共7次；无外网请求、pageError或存储访问。

| 速率/动作 | 请求目标 | 实际play与首trusted playing位置 | 新元素ID | 后续13点稳态速率 |
|---|---:|---:|---:|---:|
| 1×首次非零 | 14.376 | 14.376 | 1 | 1.000233 |
| 1×暂停后resume | 16.770619 | 16.770619 | 2 | 1.000208 |
| 1×Replay | 0 | 0 | 3 | 1.000139 |
| .85×首次非零 | 10.218 | 10.218 | 1 | .851827 |
| .85×暂停后resume | 12.159394 | 12.159394 | 2 | .851980 |
| .85×Replay | 0 | 0 | 3 | .846864 |

各速率单独context内的三次动作共享同一原始媒体URL，旧元素在新factory前已paused、src属性为null、断开DOM且执行过empty load。Chrome的currentSrc getter此时仍可保留旧URL，本夹具没有把它必须同步变空作为释放条件。每次动作恰好一个factory、一个真实未静音play；非零动作都先有真实trusted seeked且paused/nonseeking。首次定位与延后确认分开记录，没有把约1秒后的确认位置当作起播误差。

两次暂停实际观测为2003.5ms与2014.6ms，期间逻辑点不变；随后新元素未确认时仍保留旧点。六个常规确认后的独立13点窗口覆盖1.2953–1.3141秒，逐段前进、间隔≤500ms、无pause/wait/stall/error；最大累计速率误差0.004063秒，小于原0.25秒阈值。

真实短尾1×：target32.751519→自然ended33.151519，余量0.4秒，play至短尾确认约480.4ms；有真实中间推进和更后终点，无failed。没有伪造事件、补点或放宽r14短尾规则。

## 准备与执行命令

- 新脚本SHA256：`8ebd465af1cc06d86d856f1de306d59fde2323fcae1b1051411aeb71d94cbeb7`。
- `node --check tests/browser/explicit-player.cjs` 已通过，exit0；这只是语法检查，没有启动浏览器。
- 开始前与结束后严格核wrapper、inner及practice三个SHA；缺 `--runtime-stable` / `--parent-go` 或不匹配即拒绝。已采用root最新practice修订，不使用旧88ade版本。

在 `D:/zzl/托业学习/vocab-work/ct-explicit-player-20261015/site`，**仅root明确GO之后**执行：

```powershell
& 'C:\Program Files\nodejs\node.exe' tests/browser/explicit-player.cjs --runtime-stable --parent-go --expect-wrapper-sha=5690e49f40217b1976909ede026c64bb46b13bd0d49830405e894f9f130b072a --expect-inner-sha=995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0 --expect-practice-sha=b06a76bedb0b017876535463a37d98fc57529d85406e0b1334792167afd4b0a2
```

## 运行范围

使用既有Chrome安装和Playwright，原始MP3 `1935c17708c726884ac9.mp3`（完整清单长度/SHA校验），本地HTTP Range服务器。wrapper与inner各自转译成ES模块并真实导入；只读practice文件用于身份门禁，**不执行产品SpeechPlayer集成**。

仅四个检查：1×、.85×各自直接非零首次→真实2秒暂停→新元素resume→新元素Replay；一个原音轨最后0.4秒的真实非零短尾自然结束；实际206、资产/源码不变与存储隔离。相同用例保留context、原始媒体URL，不用改URL或换context掩盖连续动作的资源行为。暂停本身保留节点，下一显式动作才检查旧src属性已移除、empty load已发生、节点已断开，然后factory恰好一次新建。

原生事件捕获自己的固定Audio引用与element ID，另记createdByAction；按请求和元素共同归属，旧资源释放时的pause/abort/emptied不误记成新元素。play/load/pause只观察并调用原生API。无伪造事件、媒体时钟、currentTime赋值（除原控制器合法seek）、静音预播或play promise替身。

保留原fixture的定位≤1秒、持续窗口速率误差0.4秒；每个常规确认后13个100ms采样，间隔≤500ms、逐段真实前进、整体速率误差0.25秒。确认位置与起播位置分开记录，不能用延迟确认点计算起播误差。短尾仍守真实seeked、中间推进、更后ended与墙钟，不为稀疏事件放宽门禁。

## 输出与限制

本次新增 `reports/explicit-player/2026-10-15T21-46-35.495Z-2323f5/`，保留report、各次原始事件与样本、Range头/body SHA、浏览器实际206、源快照、fixture HTML和SHA清单；失败会原样保存且脚本不重跑整个用例，本次未发生失败。取消/旧迟到事件/失败Replay保点等受控负例由已有14项单测覆盖，本浏览器轮次不伪造这些媒体事件。

阻断ServiceWorker、外网与三种存储读取，不加载StudyApp、数据库或用户状态。两个真实秒暂停**不是**原生52秒重现；Chrome不是ArkWeb、AudioPolicy、实际声音或设备验收。主候选原生效果仍待root协调，不以本次Chrome通过代表修复完成或发布授权。
