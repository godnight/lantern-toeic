# 隔离模拟器启动日志独立复核

结论：证据支持历史候选 HAP 的原生 Ability 启动、ArkWeb 主文档及主 CSS/JS 加载完成并产生绘制。未发现明确应用崩溃或已记录的 JavaScript 异常；存在两次真实的子资源 404 待查。此次是 CLI 启动 smoke，不能计为新版界面、交互或最终包验收通过。

## 范围与证据身份

- 实例 `LanternUIQA4d5098e7`，应用 `com.lantern.toeic / entry / EntryAbility`，PID `7678`。
- `install-receipt.json` 标明候选 SHA-256 `1fa43622e1c740d76a943889de69b9778d5466dc0892f0be3be7765655cccb8a`，且 `candidateIsFinalSource: false`。这是 09:03 历史构建候选，不是最终冻结源码的验收包。
- 主证据为 `app-hilog-valid-02.txt`，按提供的采集说明来自有效 `hilog -x -P 7678`；共 1,107 行，原始时间戳范围 `10-13 17:18:47.023` 至 `17:19:51.323`。日志 SHA-256：`d02a421505b146ad6b9dc3372244a2737be45f3baed74470a326d83e213f1dfc`。
- `app-hilog-01.txt` 和 `system-hilog-bounded-01.txt` 内容仅为 CLI 参数组合失败 `[CODE: -31]`，不作为应用日志或“无错误”证据。
- 辅证为 `aa-start-candidate.log`、`launch-receipt.json`、`app-pid-02.txt`、`aa-process-state-02.txt`、`aa-ability-state-02.txt`、`system-hilog-valid-02.txt`。只读当前 `harmony/entry/src/main/ets/pages/Index.ets` 了解本地 origin 及拦截机制，未把当前源码等同于历史候选的独立源码证明。

## 可核实结果

| 项目 | 证据 | 能支持的判断 |
| --- | --- | --- |
| 原生启动 | `aa-start-candidate.log`：`start ability successfully.`；launch receipt 退出码 0 | Ability 启动请求成功 |
| 进程 / Ability | `aa-process-state-02.txt` PID 7678 `FOREGROUND`；`aa-ability-state-02.txt` `FOREGROUND`、`ready #1` | 采样时处于前台。该 dump 同时记 `window attached #0`，不能仅据 ready 值宣布 UI 验收 |
| Web 引擎 | 主日志第 217 行 `InitWebEngine, isReady:1`；第 221 行 `CreateNWeb … successfully` | ArkWeb 实例初始化后继续运行 |
| 主资源 | 第 629 行 HTML 200 / 424 字节；第 775 行 CSS 200 / 371,486 字节；第 786 行 JavaScript 200 / 1,322,975 字节 | 主 HTML、CSS、JS 资源被拦截并成功返回，不等于所有子资源成功 |
| 文档生命周期 | 第 839 行 `DOMContentLoaded`；第 844 行主框架 `OnDidFinishLoad`；第 847、849 行 `OnPageEnd` / `OnLoadEnd` HTTP 200 | 主文档加载完成 |
| 绘制 | 第 656–657 行 Display resize `1256x2526`；第 932 行 `OnPageVisible`；第 1020、1080、1082 行 FCP/FMP/首屏绘制 852ms | 有表面尺寸和内容绘制事件。尺寸是引擎表面像素，未验证 CSS viewport、截图或控件布局；单次启动指标不构成性能基准 |
| JavaScript 信号 | 第 249 行 JavaScript enabled；第 859–860、906 行执行 / 回调入口 | 引擎支持 JS 并有执行回调。日志没有回调结果、业务 DOM 或 native bridge ready 结果，不能确认 React 所有功能初始化成功 |

当前原生源码的 `APP_ORIGIN` 为 `https://lantern.local`（Index.ets 第 6–8 行），本地 GET 由 rawfile 拦截返回（第 224–265 行）。因此主导航日志中遮蔽的 HTTPS 字样不能直接当作线上部署请求或外网依赖。

## 错误分类与待关注项

主日志有 30 条 E 级消息、0 条 F 级消息。E 级全部来自 ArkWeb / Chromium / CEF 平台标签，不能按级别直接归为应用失败。例如第 221 行成功创建 NWeb 也使用 E 级；第 31 行 ICU 路径缺失后，第 32 行仍取得 ICU 数据；第 9 行早期 resize 警告后，第 355、656 行继续成功 resize。初始配置、网络回调 `ret = 201`、安全浏览库、媒体会话、空 VSync 等消息发生后仍有主文档 200 和绘制，未形成已证实的应用启动阻塞。

检索 `Uncaught`、`Unhandled`、`SyntaxError`、`TypeError`、`ReferenceError`、`RangeError`、`SIGSEGV`、`SIGABRT`、renderer gone / crash 等模式，未发现明确应用 JS 异常、致命信号或 renderer 退出事件。`app.background.crashed.*` 是 Chromium 关闭内部通知的记录；crashpad 初始化、目录 / 上报器警告亦不是本次应用崩溃报告。系统日志中与 PID / bundle 关联的检索也未发现明确崩溃证据。这只表示提供的有限日志没有记录到这些事件；未启用应用 `onConsole` 捕获，也未收集完整崩溃诊断，不能证明异常绝不存在。

需要保留的未解项：

1. **两次子资源 404**：第 915、917 行，request ID `615375` / `615377`，状态 `404 Not Found`、`text/plain`、26 字节。日志未显示请求 URL。当前 Index.ets 第 238–244 行缺失 rawfile 的回包文案正为 26 字节，这与缺少包内资源相符，但仅凭当前源码不能确认历史候选请求的具体路径或影响；不得猜为 favicon、字体或无关资源。应在后续支持的资源 / UI 观察中核对 URL 和对应文件。
2. **DNS / 平台网络消息**：第 1083 行 DNS 错误的 host 已遮蔽，不能归因给本地 origin、应用请求或平台后台请求。现有日志只证明主资源加载不被阻断，没有覆盖外链、云能力、音频或麦克风。
3. **汇总脚本范围**：`launch-log-review.json` 的 `javascriptOrLoadErrorMatches: []` 只是其检索结果；它未列上述 404，不能引用为“没有加载失败”或“全部资源通过”。

## 验收限制

启动 receipt 明确 `UIInputUsed: false`、`debugFlags: false`。本复核没有截图、DOM、触摸、返回、四主题切换、搜索、录音、练习、模考、保存 / 重试、折叠屏或生命周期往返证据，也没有最终冻结 HAP 的启动证据。应记录为“历史候选原生 CLI lifecycle smoke：主加载与绘制有证据，子资源 404 待归因”，不可扩大为 ArkWeb UI 全验通过。

本次复核只读取已归档日志和相关原生源码，仅新增本文件；未操作设备、进程、UI、安装、学习数据、签名或网络。

## 同一历史候选冷启动追加复核

协调者随后提供应用单独 force-stop / restart 证据。本复核仍只读这些文件，没有执行设备命令。`cold-start-receipt.json` 记录原 PID 7678、stop / start 退出码均 0、没有停止其他应用、清数据、卸载或 UI 输入；两份命令日志分别确认 stop / start 成功。`app-pid-cold-01.txt` 和 `app-pid-cold-02.txt` 均为新 PID `8051`；`aa-cold-process-state.txt` 与 `aa-cold-ability-state.txt` 再次显示前台、ready 1，同时后者仍有 window attached 0。它们支持此次应用进程重启及采样时存活，未证明任意更长时间持续无故障。

`app-hilog-cold-valid.txt` 共 1,009 行，原始时间戳 `10-13 17:24:24.992` 至 `17:25:25.404`，SHA-256 `af56afaab8b5be64cf645dae3526105351f3dd8b6234663547782ae4846ac5ef`。独立行号核对如下：

| 冷启动项目 | 精确行号与结果 |
| --- | --- |
| 引擎就绪 | 211 `InitWebEngine, isReady:1`；215 E 级 `CreateNWeb … successfully` |
| 主 HTML / JS / CSS | 411 HTML 200 / 424 字节；696 JavaScript 200 / 1,322,975 字节；700 CSS 200 / 371,486 字节 |
| DOM / 加载完成 | 759 `DOMContentLoaded`；767、769 `OnPageEnd` / `OnLoadEnd` HTTP 200 |
| 表面 / 可见 / 绘制 | 743–744 resize `1256x2526`；829 `OnPageVisible`；927 FCP 485ms；983 FMP 485ms；985 首屏绘制 duration 485 |
| 两次子资源 404 | 816 request ID `697195`；823 request ID `697197`；均 `404 Not Found`、`text/plain`、26 字节 |

冷启动再次出现两个同样形态的 404，说明该现象可以在同一候选重启后重现。**两次启动的日志都缺请求 URL，不能断定它们对应同一资源路径或无害资源，更不能仅依据数量猜测 PWA manifest / favicon。** 主文档及主 CSS / JS 成功与子资源缺失应同时记录。

冷启动仍有 30 条 E 级、0 条 F 级消息；未发现上述 JS 异常、致命信号或 renderer gone / crash 模式。crashpad / 内部扩展通知消息继续属于初始化上下文；遮蔽 host 的 DNS 错误在第 986 行，归因仍未解决。重新采集没有改变此前验收限制：这是历史候选的两次启动 / 主加载 / 绘制 smoke，未完成最终源码包、业务初始化结果、界面或交互验收。
