# 最终候选：两条 404 的一次限定只读诊断

结论：仍不能给出具体 URL 或确认业务影响。新的强线索是 rawfile 读取失败与 404 的时间邻近，以及原生壳缺失资源响应的完整特征匹配。这支持“本地资源读取失败后产生 404”作为候选归因，但没有请求路径、关联 ID 或实际响应正文，不能升级为确认。没有把它说成 favicon、无害请求或改版已知 Bug。

本包仅对应最终 HAP `d10202ec9ffc908e15199d8917cc270214d36b351161d90403a786faa604f573`，44,292,998 字节，`build-lantern-ui-v11-knsxbchb`。这里只检查剩余 404 的日志、静态引用、模板与原生路由；没有重复完整评审、测试、构建或冷启，没有修改源码、打诊断包、切 UI、装工具或改系统设置。没有读取真实学习数据。本目录不含 HAP、SDK 工具或 09:03 旧诊断计划，可单独归档。

## 实际请求证据

| 启动 | 应用 PID | 404 请求 ID / 原始行 | 邻近 rawfile 警告行 |
| --- | --- | --- | --- |
| 最终包初始启动 | 7949 | 970702 / 1438；970703 / 1441 | 1434、1435，18:09:25.093 |
| 最终包应用冷启 | 8038 | 43742 / 1456；43744 / 1476 | 1453、1463，18:09:28.347 / .349 |

对应 [初始原始日志](app-hilog-final-initial.stdout.log) 和 [冷启原始日志](app-hilog-final-cold.stdout.log)。每个目标 ID 在其完整归档日志中只命中 `HeadersComplete`、`ContinueWithResponseHeaders` 两处；共 8 条命中，没有包含 initiator、未掩码 URL、资源路径或可关联路由。四条邻近警告都是 `GetRawFileContent failed, name is empty.`；警告不含请求 ID 或路径，不能逐条配对，也不能据此断言传入参数为空。[独立关联说明](404-log-correlation.md) 与 [精确行号索引](404-evidence-index.json) 保留原文和范围。

四个 404 均为 text/plain、26 字节。最终原生 `Index.ets` 第 226 行只有一处 `getRawFileContent(path)`；catch 在 240–243 行设置 `Bundled resource not found`、text/plain、404，这段字符串正好 26 个 UTF-8 字节。`localPath` 第 28 行为根返回 web/index.html，其余本地路径返回 web + decoded，不产生空字符串。这是有依据的候选因果链；没有读取实际响应 body 或请求 path，所以仍不能确认是哪一个资产失败，或解释 ResourceManager 的空 name 消息。

原生 Index 的工作区与冻结快照 SHA 都是 `02fb309591821fb24289e336b9ec65dfcdf5c963c63da097d56ee80642e821dc`；与 HEAD 的源码在 CRLF/LF 归一化后完全相同，`git diff --name-only HEAD -- Index.ets` 为空。HEAD 原始字节 SHA 不同只来自换行。该失败分支不是本次 UI 重设计修改的代码；这不证明原先没有问题，也不能判定触发请求来自哪一层。[路由与源码索引](404-final-routes-and-templates.json) 保存 SHA、行号和条件。

早于主 Web 导航的 Ace `manifest.json` / `resources/styles/default.json` 消息没有目标请求 ID；没有把它们归因给这两条 HTTP 404。旧系统日志只覆盖 guest 17:11–17:20，不覆盖最终 18:09 事件，且没有目标 ID；其历史审查摘要有保留，但旧日志未混入本次包。

## 最终 HAP 的静态可判范围

- [HTML / CSS / SVG / JS 字面扫描](404-final-static-audit.json) 对最终包 7 个文本资产检查引用。HTML 的最终 JS `assets/index-DRUJ_l4J.js`、CSS `assets/index-Cd6QOvGF.css` 存在；四个 CSS 图像引用也都存在。是否实际使用这些样式不能由字面扫描证明。
- [JS AST 检查](404-final-js-ast-audit.json) 使用已有 Babel parser，读取与 HAP manifest 字节/SHA 一致的最终 1,332,784 字节 JS，没有执行代码或安装依赖。可判的静态资产字面值为练习图和 `/sw.js`；练习图存在，`/sw.js` 被 native sync 故意排除。最终 mobile 入口传 nativeMode=true；StudyApp 第 75 行仅 `!nativeMode` 注册 worker。因此不能将 `/sw.js` 的缺失直接配对给这两条运行时 404。
- 原生 HTML 没有 manifest/icon link；这不能排除引擎隐式请求，也不能支持猜测 favicon。AST 中 `/api/*`、目录前缀以及 React 内部 `/$`、`/&` 只是代码字面值，不是已执行请求或应用路由。动态 API 模板、对象中的动态 src、外部/Blob 资源和引擎隐式请求不能靠这个静态检查对应 masked ID。
- [已发布模板检查](404-final-routes-and-templates.json) 确认 1,015 个内置音频文件在打包清单中，通用词典 `dictionaries/zh-en-63cf606ec4d0.json` 存在，三个源 JSON 图片引用均存在。只检查这些明确模板的数据，不推断用户导入内容、动态计算结果或运行时加载成功。
- 应用 workspace 导航用 setNav 和没有新 URL 参数的 history.pushState；主本地 origin 的资源拦截会把路径映射到 rawfile，没有服务端路由回退。代码中某个路径存在或不存在仍不能揭示这四个请求 ID 的实际目标。

这次没有重做 1,071 资源的逐字节验收；该验收及 1,229 构建输入证明已有最终冻结报告。本次只使用它绑定的清单和具体引用。

## 唯一新增的只读捕获

确认已有自有 QA 的应用 PID 仍为 8038 后，只执行一次官方 `hilog -x -P 8038`。退出码 0，但 stdout 为空、零行，没有新请求或 URL 证据；不能据此宣称 404 消失。未再次 coldstart、刷新、清日志或扩展隐私输出。[捕获收据](404-readonly-capture.json) 保存准确 argv、退出码及空回包 SHA；对应 PID 和日志原始输出也在本目录。

## 影响与精确阻塞

已归档的两次启动均有主 HTML/JS/CSS 200、DOMContentLoaded、PageEnd HTTP200 与首次绘制。因此这些 404 没有阻止已观察到的主文档流程；这不能证明某个图标、字体、图片、媒体或业务交互正常。实际资产路径及视觉/功能影响仍未知。

阻塞是请求路径信息缺失：四个 ID 没有可关联 URL，相关 URL 被系统掩码，现有约 3 秒应用 PID 日志也没有独立 renderer/Network 证据。当前会话没有可调用的原生 CUA 或 ArkWeb Network 检查接口；官方 CLI 的 PID/日志读取仍可用，已执行，结果没有增加路径信息。当前包没有输出经过过滤的资产路径。本轮不改隐私/调试配置、不注入 bridge、不修改源码或安装诊断包，所以不能继续补出不存在于证据中的 URL。

人工检查可以补影响观察，不能解除 URL 归因：

1. 协调当前 QA 取证结束后，按 [可见窗口手工步骤](MANUAL_QA_VISUAL_MEDIA_CHECK.md) 打开同一自有实例；本轮没有执行停止或切窗。
2. 查看首页及四主题的图形、文字、导航是否完整，打开一条带图的内置练习，记录破图、空白或提示文字。
3. 查询一个普通单词并播放一段内置音频，记录能否加载、报错位置和时间；使用自有空白 QA，不导入真实记录或提交学习结果。

即使这些观察均正常，也仍保留“两个 URL 未知、具体影响未证”的限制；不要据此把 404 自动关闭为无害。

本包 [FILE_INDEX.json](FILE_INDEX.json) 列出相对文件名、字节和 SHA，支持整体复制到正式报告目录。所有原始日志保持原字节；分析索引不包含查词 query、账号或真实学习记录。
