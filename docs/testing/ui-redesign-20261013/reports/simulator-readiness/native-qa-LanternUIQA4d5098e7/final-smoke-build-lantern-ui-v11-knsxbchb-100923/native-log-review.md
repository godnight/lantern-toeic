# 最终冻结候选原生日志独立复核

结论：原始证据支持此最终冻结 HAP 在唯一自有 QA 实例采用 `install -r` 正常升级、AA 启动及单独应用冷启；两次均有主 HTML / JS / CSS 200、DOMContentLoaded、PageEnd 200 和内容绘制。每次仍有两条 URL 未知的子资源 404。汇总漏收绘制事件；未发现把失败事件误判为成功的已列加载条目。只能记为“最终候选原生启动 / 主加载 smoke，有未解观察项”，不能等价原生界面或交互验收。

## 身份与实际证据

- 唯一 QA：`LanternUIQA4d5098e7`，明确 HDC 目标 `127.0.0.1:15551`；系统日志为 API 26、`emulator 7.0.0.106(SP1DEVC00E999R4P11)`。
- 实际核对本地 HAP：`build-lantern-ui-v11-knsxbchb/lantern-ui-v11-unsigned-local-only.hap`，44,292,998 字节；SHA-256 `d10202ec9ffc908e15199d8917cc270214d36b351161d90403a786faa604f573`，与 `native-smoke-proof.json`、`final-freeze-proof.json` 相符。09:03 的 `1fa436…` 仍是历史候选，不得替代本次证据。
- `install-final-preserve-data.stdout.log` 明确对应此 HAP 路径并返回 `install bundle successfully`。proof 的实际 argv 使用 `install -r`，没有卸载、clear、reset 或权限授予标志。只能确认所用升级方式，未对学习数据内容作完整性比较。
- 升级前后 bm 原始输出带 bundle 名前缀，剥离该前缀后按大小写敏感 JSON 解析。根与 applicationInfo 均为 `com.lantern.toeic`、`0.3.3 / 20009`；compatible / target `50000012`、provision `debug`、distribution `none`、debug true、UID `20020063` 均一致。这些身份相同不证明学习数据逐字节保留，也不是设备端安装文件哈希读取。
- 初始 `aa-start-final.stdout.log`、单独应用 stop、`aa-cold-start-final.stdout.log` 分别明确成功。初始 PID `7949`；stop 后 pidof 输出为空；冷启及稍后 pidof 均为 `8038`。对应 AA state 中两次进程前台、Ability 前台且 `ready #1`，但同时保留 `window attached #0`；不以 ready 或前台状态宣布 UI 通过。
- `native-smoke-proof.json` 是合法 JSON，20 条命令均记录退出码 0；本次复核读取时 SHA-256 `eec6aa7b8794b0c7566b9e88d5ed9bff52c9fcc8e5e7f02199388ed56ea34e0c`。SDK 静态 freeze proof 的 `installed=false` 是该静态步骤的范围，不能推翻后续实际安装收据。本复核没有重新执行源码 / 资源全量验证或设备命令。

## 有效日志的精确行号

| 项目 | 初始：app-hilog-final-initial.stdout.log | 冷启：app-hilog-final-cold.stdout.log |
| --- | --- | --- |
| 应用 PID | 7949 | 8038 |
| 行数 / 原始时间范围 | 1,667；18:09:24.220–18:09:27.273 | 1,681；18:09:27.767–18:09:30.504 |
| 引擎就绪 | 683 `isReady:1`；741 init succeed | 750 `isReady:1`；795 init succeed |
| 主 HTML 200 | 963，424 字节 | 1036，424 字节 |
| 主 JS 200 | 1289，1,332,784 字节 | 1336，1,332,784 字节 |
| 主 CSS 200 | 1291，371,845 字节 | 1341，371,845 字节 |
| DOMContentLoaded | 1364 | 1396 |
| PageEnd / LoadEnd HTTP 200 | 1378 / 1380 | 1404 / 1406 |
| 表面 resize | 1281–1282，1256x2526 | 1389–1390，1256x2526 |
| PageVisible | 1474 | 1489 |
| FCP / FMP / 首屏绘制 | 1601 / 1657 / 1666，564ms | 1610 / 1673 / 1680，437ms |
| 两条子资源 404 | 1438 ID 970702；1441 ID 970703 | 1456 ID 43742；1476 ID 43744 |
| E / F 级条数 | 100 / 0 | 106 / 0 |

日志实际 SHA-256 分别为：

- 初始：`d5398d01a6fecf1307e84e23698b06e0cdb1b5dd8ee8a77bbf4bcc3a6d04c5b1`。
- 冷启：`2db9605562402850a9e81e87ba72bf825c8813238322f11f22e30cad950c46a0`。

两者与 proof 的 hash / 行数一致；其中两次各三条成功资源、两条 404 和一条 PageEnd，共 12 条已聚合记录，其行号和完整文本均与原始文件逐项一致。两段日志各仅约 3 秒，不能沿用历史候选的一分钟观察范围或“30 条 E 级”的计数。原始时间戳为 10-13 的 18 时段；proof 记录 UTC 10:09 时段，不把 PowerShell 展示的本地时区转换当作新启动事件。

## 汇总遗漏与错误解释

**聚合遗漏：** `initialLogs.paintMarkers` / `coldLogs.paintMarkers` 都是空数组，但上述实际 FCP、FMP、首屏事件存在。空数组不表示未绘制；独立结论以原始行号为准。本报告没有修改 proof。`FINAL_NATIVE_RESULT.md` 已明确这项遗漏、数秒窗口及未完成交互的边界，其启动范围表述与本次检查一致。

**真实未解项：** 四条 404 均为 `text/plain`、26 字节，响应由拦截资源加载器记录，日志不含具体请求 URL。现象在升级后初始加载及冷启均重现；无法断定是同一文件、PWA manifest、图标、字体或无害资源，也不能把主 JS/CSS 成功推广为全部资产成功。具体路径及视觉 / 功能影响仍需后续受支持的诊断或 UI 检查。

**不能按关键词判崩溃：** 对 `Uncaught`、`Unhandled`、`SyntaxError`、`TypeError`、`ReferenceError`、`RangeError`、致命信号、renderer gone / exit / crash 等模式复核，未发现明确应用 JS 异常或应用崩溃事件。crashpad 初始化 / 目录警告、`app.background.crashed.*` 内部通知关闭、shutdown signal handler 注册并非本次应用崩溃；`RegisterClientDeathObserver failed` 也不是应用已死亡的记录。E 级 `CreateNWeb … successfully` 同时存在（初始 687、冷启 754），进一步说明日志级别不能代替消息语义。

本次 E 级消息还来自 WMS、Ace、OpenGL / DGLES、PARAM、IPC、ResourceManager、ArkCompiler 等平台模块；其中有真实的平台调用或资源配置失败，不能全部改写为“无害”或“零错误”。冷启第 50 行 `LoadThemesRes failed` 是原生 ResourceManager 消息，不能据此断言四套 Web 主题失败或正常；窗口权限、渲染同步等消息亦需要实际 UI 验证其影响。主加载及后续绘制只表明这些消息没有阻止本次观察到的主文档流程。

## 验收边界

采集命令为 `hilog -x -P` 指定应用 PID，未提供完整独立 renderer 子进程日志或应用控制台 / 业务 DOM 结果。JS 执行回调入口（初始 1390–1391 / 1426；冷启 1416–1417 / 1449）不含业务返回值，不能证明所有 React 功能、native bridge 或持久化业务均初始化成功。有限 PID 日志未记录异常不等于异常绝不存在。

表面 1256x2526 是引擎像素，未核实 CSS viewport 或控件尺寸。FCP/FMP 为两次启动的单次事件，不能作为性能基准。此次未覆盖点击 / Back 顺序、四主题视觉、输入法与搜索、录音或播放、文件选择、学习 / 模考保存与重试、数据完整性、云同步、折叠屏或手机验收。

本复核仅只读已归档日志、摘要及本地构建包；唯一写入为本报告。未启动或停止设备 / 进程、执行安装、触发 UI、读取学习数据 / 签名、修改原始 proof 或发起网络请求。
