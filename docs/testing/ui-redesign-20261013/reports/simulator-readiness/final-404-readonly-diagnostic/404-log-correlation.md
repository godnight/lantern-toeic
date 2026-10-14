# 剩余 404 的一次限定日志关联诊断

结论：四个请求 ID 可以各自关联到 404 响应及后续 `ContinueWithResponseHeaders`，**不能从现有日志确定请求 URL、包内路径或发起者**。新发现是每次 404 前 0–1ms 都有 `ResourceManagerJs: GetRawFileContent failed, name is empty.` 警告，但没有同一个请求 ID / 句柄来建立一一对应。保持待归因，不判为 favicon、PWA manifest、字体或无害资源。

本次只完整扫描两份最终候选原始应用日志及必要已有归档，未重复全审或采集。结构化证据在同目录 `404-evidence-index.json`，含全部目标 ID 命中、邻近原生资源警告、URL / cache / routing 示例和原始行号。

## 请求 ID 链条

| 阶段 / PID | request ID | 404 HeadersComplete | ContinueWithResponseHeaders | 与主 PageEnd 的间隔 |
| --- | --- | --- | --- | --- |
| 初始 / 7949 | 970702 | 行 1438，18:09:25.093 | 行 1442，18:09:25.094 | +67ms |
| 初始 / 7949 | 970703 | 行 1441，18:09:25.094 | 行 1445，18:09:25.094 | +68ms |
| 冷启 / 8038 | 43742 | 行 1456，18:09:28.348 | 行 1457，同时间 | +54ms |
| 冷启 / 8038 | 43744 | 行 1476，18:09:28.350 | 行 1477，同时间 | +56ms |

四个 ID 在各自完整文件中均只出现这两处，共 8 条记录；404 都为 `text/plain / utf-8 / 26 字节`，后续记录 `request_.is_sync_mode=0`。没有绑定该 ID 的 request start、URL、initiator、referer、asset path、cache hit 或 routing ID。

邻近拦截链条也存在：初始行 1436–1447、冷启行 1454–1459 / 1464–1478 有 `NWebResourceHandler::Open`、`NWEB_STRING_TYPE response_length=26`、响应头、Read。除响应头和继续记录外，其余消息不包含请求标识，因此只能描述时间相邻的处理过程，不能把其未知路径补到请求上。

## 新线索及不能建立的关联

- 初始行 1434、1435：18:09:25.093，线程 8054，均为 `GetRawFileContent failed, name is empty.`；紧接行 1438 / 1441 的两次 404。
- 冷启行 1453：18:09:28.347，线程 8325；行 1463：18:09:28.349，线程 8250；同样警告各在邻近 404 前 1ms。

这些警告证明同一应用进程在邻近时刻记录了原生 rawfile 获取失败。它们没有 URL、具体文件名、请求 ID 或可交叉匹配的对象句柄，且线程与 HeadersComplete 不同。不能仅按两个警告与两个 404 的数量建立因果或一一对应，也不能把字面 `name is empty` 当作已核实的业务代码传入空字符串；后者需由独立静态代码审查或更明确诊断证据确认。

现有未掩码路径均没有目标 ID 关联。例如初始行 176 / 204、冷启 251 / 279 的 `GetAsset failed: resources/styles/default.json` / `manifest.json` 是 Ace 原生资产消息；初始 245、冷启 318 的 `pages/Index / pages/Index.js` 是原生页面路由。这些消息发生在 Web 主导航之前，没有 HTTP 状态或目标请求 ID，不能把其中 `manifest.json` 指认为这两次 Web 404。ArkWeb 的 ICU / pak 路径和 `arkweb://resources/*` 也不构成目标 Web 请求的路径证据。

## URL、cache 和 routing 的精确阻塞

两份完整应用日志中未发现未掩码的 HTTP(S) URL。主导航从 LoadUrl 到 PageEnd 都显示 `ht**s://lan***`（初始示例行 894 / 1378，冷启 958 / 1404）；图标相关消息是 `No icon sizes available for URL: ***`（初始 1385、冷启 1411）。这些主导航或引擎消息没有四个目标 ID，不能根据相邻图标警告猜测 favicon。

`routing_id=1` / `main_frame_routing_id=1` 和 `frameInfo id:3_1` 属于文档 / 主框架事件；没有目标 request ID 对应表。`fromBFCache:0`、`use_no_cache=0` 属于主导航 / 页面预加载参数；HTTP cache 容量、缓存目录、`cookie size is 0` 也不是目标请求的缓存命中结果。它们均不能补足缺失的请求 URL或 initiator。

这不是只有“URL 被掩码”一个缺口：**404 行本身不输出 URL；可见导航 URL 已被掩码；相邻资源消息又不提供请求 ID / 路径。** 因此无法通过已有日志建立 URL → rawfile → 404 的可证映射。

## 可证影响与范围

可证：最终候选的每次启动确实有两次拦截资源响应失败，发生在 PageEnd 后、FCP 前；随后仍记录主页面 FCP（初始行 1601、冷启 1610）。因此这两次 404 没有阻止日志中已观察到的主文档加载结束及绘制事件。

不可证：缺失的是哪一项资产、是否由应用或引擎发起、是否同一路径、是否显示空白图片 / 缺样式、是否影响某业务流程，或是否可以忽略。主页面继续绘制不证明用户界面正确，亦不能据此关闭剩余 404。

两份采集均限定应用 PID 7949 / 8038；索引逐行核实各文件记录的 PID 只有其自身。没有独立 renderer 进程的完整日志、网络 initiator 栈或应用 DOM / 控制台证据。该最终目录没有同期系统 hilog / renderer 日志。已有 `../system-hilog-valid-02.txt` 范围为 17:11:27.417–17:20:49.233，四个目标 ID 命中为零，与本次 18:09 事件不重叠；旧模拟器启动 stdout / stderr 也无目标 ID，不能填补本次缺口。

原始日志 SHA-256 未变：初始 `d5398d01a6fecf1307e84e23698b06e0cdb1b5dd8ee8a77bbf4bcc3a6d04c5b1`（1,667 行）；冷启 `2db9605562402850a9e81e87ba72bf825c8813238322f11f22e30cad950c46a0`（1,681 行）。本次唯一新增这份说明与证据索引；未操作设备、进程、UI、源码、原 proof 或安装包，也没有重启、重打包、解除掩码或发起新捕获。
