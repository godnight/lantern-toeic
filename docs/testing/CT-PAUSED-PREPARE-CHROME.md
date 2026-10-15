# 暂停准备后播放：真实 Chrome 开发验证

专属脚本 `tests/browser/paused-prepare.cjs` 直接编译当轮 `lib/lesson-audio.ts` 为隔离 controller fixture，只创建真实 `new Audio()`。不载入 StudyApp、repository、原生入口，不读写 IndexedDB/localStorage/sessionStorage，不注入生产或学习状态。仅使用已安装 Chrome 和现有工程依赖，无安装或外部网络。

主线程 runtimeStable 后已完成三轮真实 Chrome 验证。三轮的原始结果均保留，最终一次通过不覆盖前轮失败；具体范围与启动滞后见下文。

正式调用：

```text
node tests/browser/paused-prepare.cjs --runtime-stable --expect-source-sha=<lib/lesson-audio.ts完整SHA256>
```

脚本先严格验证 SHA，运行后再次验证 controller 与媒体字节不变。每次结果写入 ignored `reports/paused-prepare/<UTC-random>/`，保留 fixture HTML、当轮 TS 原文、所有真实事件/采样、请求与响应、逐项结论和 SHA256 清单，不覆盖历史运行。运行后自动关闭自有 context、浏览器、HTTP 服务及挂起响应。

## 矩阵与判据

- 主轨为实际打包 `1935c17708c726884ac9.mp3`（33.151519 秒）。1x 从 14.376 秒、0.85x 从 10.218 秒各用全新 Audio 开始；每个速率各重复两次同元素 pause/resume，再显式 replay。
- 包装实例 play/load/pause 只记录参数与状态并原样委托原生 API，不伪造媒体事件、currentTime、Promise 或时钟。记录真实 play 调用前 paused/seeking/currentTime、首个可信 playing（包括零点，禁止挑行）、全部 timeupdate 与 50ms 采样。
- play 调用和首个 playing 分别要求距目标不超过 1 秒，确认点则按实际耗时与速率核对，不能把持续推进之后的确认位置直接当 seek 误差。确认前保留多次推进，确认后再独立采样实际速率。
- source/load 替换、显式 pause/reload 取消、真实挂起 HTTP 无 metadata 的 10 秒超时均不得确认或覆盖非零点。短暂首次真实推进后调用真实 pause，确认必须为零；此项是实际停止负向案例，**不是 renderer 饥饿/卡顿模拟**。
- 真实最短打包 clip `e53657178cb6855ac4b2.mp3`（1.049433 秒）在 1x/0.85x 均应完整播放且不产生 controller 错误。若固定持续确认窗口使其播放到尾仍未确认，按回归失败记录，不把保点降级算成功。
- 主轨另从 `duration - 0.4` 秒用全新 Audio 非零暂停 seek，再按 1x/0.85x 自然结束，直接覆盖短尾。至少一条可信中途正向推进与其后继续前进的真实 ended、足够实际耗时、无 waiting/stalled 才能接受短尾确认；单独末尾 tick 不算通过，保留完整 pause/ended 顺序。
- localhost HTTP 服务保留标准 200/206/416 Range 契约及素材 SHA；要求实际 Chrome 主轨请求观察到 Range206。该证据只适用于本地 Chrome，不能替代 ArkWeb 资源拦截器、系统 renderer、人耳输出或真实 Home/exit/cold 生命周期。

## 结论边界

controller fixture 可验证媒体控制和 checkpoint 基线，不证明产品 UI、持久化命令/receipt、原生生命周期或独立 QA 已通过。

## 实际执行与完整历史（2026-10-15 UTC）

三轮 controller SHA256 始终为 `92511fccda5627add3809071a7148273d9a621a94970d43d9bd4daa82d360039`。第二、三轮使用同一测试脚本，SHA256 `2d0cb68cc748d316e0df9b5a7a16831a0674e00f108e70aa5e4f6c3e15c1ab1c`。Chrome `157.0.8092.0`。未改 runtime、旧树、设备、SDK 或 Git；全部自有 context、浏览器、挂起响应与 HTTP 服务均已关闭。

| 原始运行目录（均在 `reports/paused-prepare/`） | 结果 | report.json SHA256 |
|---|---|---|
| `2026-10-15T20-06-46.763Z-fef69b/` | 9 PASS / 2 FAIL：工具错误假设 ended 必须先于自然结束确认派发 | `5d69134ad61d27447ad3f9947517d60720be8908d8e4fd79d31102f3ef6339e1` |
| `2026-10-15T20-08-59.129Z-238b1b/` | 10 PASS / 1 FAIL：真实 0.85× 续播启动推进落后于墙钟预期 | `59f164d61cb8d764706aa7843254292c6e5f52bbad402f78de8d47ff9a658b78` |
| `2026-10-15T20-10-24.090Z-84d3ce/` | 该次 11 PASS / 0 FAIL，不覆盖前轮 | `9c590b998d560f9f94bfe721e44b732b3c5b36dc5ca102467e7dcc0d0b76874c` |

首轮两条短尾的真实顺序都是中途推进、自然 `pause(ended=true)`、确认、随后约 0.6/0.7ms 才派发可信 `ended`。工具修为等待真实 ended 事件及其处理完成，并允许确认由已收到的自然 pause/ended 状态触发；仍要求中途实际推进、末尾继续前进、足够耗时且无 waiting/stalled，没有扩大 1 秒定位或 0.4 秒整体启动推进误差容差。另补首 playing 的实际 play-call 时间边界、fixture ID 与独立清理。原始失败文件不修改。

### 第二轮保留的真实启动滞后

`failure-2.json` 中 fixture2/request2 的实际 0.85× 续播：

| 原始观测 | performance.now 毫秒 | currentTime 秒 |
|---|---:|---:|
| 真实 play 调用 | 3588.8 | 11.941482 |
| 首可信 playing | 3589.0 | 11.941482 |
| 仍未推进的采样 | 4256.7 | 11.941482 |
| 首次推进的 50ms 采样 | 4303.7 | 11.952817 |
| 首非暂停 timeupdate | 4387.9 | 11.969443 |
| 下一 timeupdate | 4653.7 | 12.189978 |
| 下一 timeupdate | 4919.7 | 12.413190 |
| 最后一条确认前 timeupdate | 5182.5 | 12.648816 |
| confirmed | 5182.7 | 12.648887 |

从 play 到 playing 只有 0.2ms，所以这不是误把 playing 之前的加载等待算入速率。真实 playing 后媒体时钟约 0.7 秒未推进；全请求没有 waiting/stalled 事件。启动整体 1.5939 秒仅推进 0.707405 秒，比 0.85× 预期少 0.647410 秒，确实超过工具固定 0.4 秒容差，失败保留。随后连续确认窗口 0.7948 秒推进 0.679444 秒，0.85× 预期为 0.675580 秒，差 +0.003864 秒，确认后仍继续推进。

这说明首 playing 本身不足以证明持续播放，且存在本地 Chrome 启动滞后波动；没有证据将其归因于并行 SDK 或其他单一原因。第三轮通过也不能抹掉该事实。完整原始请求事件与全部 50ms 采样另存 `STARTUP-VARIABILITY-ANALYSIS.json`（43052 B，SHA256 `b180b019c3916eb3641dcef8f033b3581b6a3245d72f664f69871f78fea558f7`）。原 `requests[].rate` 字段是调用前媒体速率快照，应用速率以 `calls[].rate` 与该测试矩阵速率为准。

### 第三轮限定结论

11 项全部通过：两速率新 Audio 各一次非零恢复及同元素两次续播、各自 replay、source/load 与显式 pause/reload 取消、真实无 metadata 超时保点、首进后真实 pause 不确认、1.049433 秒短 clip 与主轨末尾 0.4 秒两速率自然结束。六次续播及两次 replay 首可信 playing 的目标误差均为 0 秒；仍保留首行，没有跳零或选择有利样本。确认后实际 media/wall 速率范围为 1× 的 0.9888–1.0075、0.85× 的 0.8518–0.8598。存储 guard 访问为空、无外部请求和 page error，运行前后源码及两媒体 SHA 一致。

Chrome 实际观察到 9 条 206 响应；服务端完成发送 11 条、计划记录 15 条，其中包含刻意挂起或取消的请求。计划 status 不能等同已送达响应。旧聚合 `FINAL-CHROME-SUMMARY.json` 保留，新的权威聚合为 `FINAL-CHROME-REVIEW.json`，明确拆开这些计数，未改原报告 bytes。

权威聚合完整路径：`D:/zzl/托业学习/vocab-work/ct-paused-prepare-20261015/site/reports/paused-prepare/FINAL-CHROME-REVIEW.json`，5301 B，SHA256 `0cca6d2b0e96d7d7e9e57652231fe3bdccd64e558db1d6a627e78afe7f57eda9`。每轮子目录另有 `SHA256SUMS.json`，包含完整事件证据、fixture HTML 和当轮 TS 原文的字节哈希。

下一层应在独立原生窗口按连续 UI 与对应 renderer 证据继续验证，保留本地启动滞后观察。当前结果仅为 Chrome controller fixture，不构成 ArkWeb、系统声音、人耳或真实生命周期验收通过。
