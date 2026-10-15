# r14 持续推进门禁：真实 Chrome 开发验证

独立树 `vocab-work/ct-sustain-guard-20261015/site`，只修改继承的 `tests/browser/paused-prepare.cjs`，结果写入 ignored `reports/sustain-guard/<UTC-random>/`。主线程正式 runtimeStable 后**仅执行一次 11 项矩阵，11/11 通过**，准确输入与证据如下。未通过重复运行选择绿色结果。

```text
node tests/browser/paused-prepare.cjs --runtime-stable --expect-source-sha=<lib/lesson-audio.ts完整SHA256>
```

测试使用现有工程 TypeScript 将稳定的 `lib/lesson-audio.ts` 编译为隔离 fixture，创建真正的新 Audio，全部 play/load/pause 包装只观察并原样委托原生 API。实际 33.151519 秒主轨与 1.049433 秒最短打包 MP3 由 localhost Range 服务提供，不安装依赖、不使用外网、不载入 App 或 repository、不访问任何数据库或 localStorage/sessionStorage、不操作设备。

## 三个分开观察的阶段

1. **定位与初始等待**：保留首可信 playing（包括零值），真实 play 调用前必须 paused、非 seeking、同源且距目标 ≤1 秒。单独记录请求至 playing、play 至 playing、playing 至首实际推进的延迟；后者由真实事件及名义 50ms 多点采样观察，不能声称精确物理起播时刻。总确认仍受原 controller 10 秒有界门禁约束。
2. **实际推进后的连续确认窗口**：从真实前进 timeupdate 构造当前连续链；重复/静止会断链，实际前进点之间不得相隔超过 500ms。至少四个前进点与约 750ms 窗口、足够实际位移、无中断，按既有 0.4 秒速率误差容差核对。首 playing 或旧累计推进不能单独证明持续播放。
3. **确认后独立稳态观察**：每次正常主轨续播及 replay 再采 13 个名义 100ms 点，覆盖至少一秒。逐点要求持续正向推进、无暂停/seek/ended/媒体错误/controller failed、无 waiting/stalled，采样不得桥接超过 500ms 空白；总位移按既有 0.25 秒速率误差容差核对。短 clip 和 0.4 秒自然短尾通过真实中途推进与自然结束验证，物理剩余时长不足以额外播放一秒，明确豁免长轨稳态步骤。

真实 prepared/playing/confirmed 点均要求 duration/currentTime 为有限有效值，duration 为正且跨阶段一致；无 metadata 的真实挂起请求不得播放或确认。未知或失败不能伪装成有效持续推进。

## 11 项矩阵

- 1x 新 Audio 从 14.376 秒恢复、同元素两次 pause/resume、显式 replay；每次长轨确认后独立稳态观察。
- 0.85x 新 Audio 从 10.218 秒开始，重复同样步骤。
- source/load 替换、显式 pause/reload 取消、真实无 metadata 的 10 秒超时保非零点。
- 首次真实推进后实际 pause 不得确认。此项是自然停止负向案例，不冒充 renderer 饥饿模拟；重复静止 timeupdate 和 preparedDuration NaN 的确定性门禁由其他专属单元测试验证。
- 1.049433 秒最短真实 clip 两速率，以及主轨 `duration - 0.4` 非零 seek 后两速率自然结束；保留完整 timeupdate/pause/ended 顺序。
- 实际 Chrome Range206、输入 SHA 不变、无外网或存储访问、正常清理。计划的服务端响应与 Chrome 实际收到的响应分别计数。

## 与 r13 历史的关系

旧树 `ct-paused-prepare-20261015/site` 的三轮及其断言、失败、聚合文件均不修改。旧第二轮首 playing 后约 0.7 秒媒体时钟未推进确实发生，旧全启动墙钟断言确实失败；随后连续窗口 0.7948 秒推进 0.679444 秒，符合 0.85x。playing 不是首个实际推进，所以本轮把初始等待与已推进区间分开测量，不把初始等待当作稳定速率，也不否认延迟事实。没有证据说明其根因已确定。

r13 后续另被静态审查判定持续门禁与短尾非有限值存在缺陷，已 STATIC_FAIL。旧 Chrome 单次通过不能覆盖该结论，也不能证明新 r14。此处只为本地真实 Chrome controller 证据；ArkWeb、系统 renderer、真实 Home/exit/cold、可闻输出、生产 UI/receipt 与独立 QA 验收继续由对应层验证。

## 执行结果

2026-10-15 UTC，主线程与独立审查确认停止修改 runtime 后，实际调用：

```text
node tests/browser/paused-prepare.cjs --runtime-stable --expect-source-sha=995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0
```

- controller 输入 18213 B，SHA256 `995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0`；测试脚本 SHA256 `4743211e0b39b75a41c6f68b796a49024790ab13bef36a4bcab23e0895477f4f`。运行前后均一致。
- **一次运行 11 PASS / 0 FAIL**。两速率各三次主轨续播与一次 replay，共八组长轨确认后独立稳态观察，全部保存十三点，合计 **104 点**；最短独立观察窗 **1.2814 秒**。每个采样间隔均正向推进，无暂停、seek、ended、waiting/stalled、媒体错误或 controller failed。
- 八组 playing 至首观察到实际推进延迟为 **3.9–373.6ms**，只是事件/名义 50ms 采样测得的上界观察，不能当作精确物理启动时刻。最长请求至确认 **1350.3ms**，均在总 10 秒门禁内。
- 连续确认窗口速率误差最大 **0.013751 秒**（原容差 0.4 秒）；确认后稳态误差最大 **0.006048 秒**（原容差 0.25 秒）。实测 media/wall 稳态速率：1x 为 **0.997781–1.002806**，0.85x 为 **0.845280–0.851859**。没有扩大容差。
- 真实最短 1.049433 秒 clip 与主轨最后 0.4 秒，两速率均实际自然结束并通过；原始 pause/ended 顺序保留。source/load 替换、显式 pause/reload、真实无 metadata 超时保点、首进后真实 pause 不确认均通过。
- Chrome 实际收到 **11 条 206**；服务端完成发送 **13 条**、计划记录 **16 条**，故不把计划 status 当成送达。存储 guard 访问为空，无外部请求或 page error；两素材 SHA 保持一致。
- 自有 context、Chrome 和 HTTP 服务均已关闭。未操作设备、原始数据库、SDK、旧树或 Git。

所有路径相对本树 `site/`：

| 证据 | 字节 | SHA256 |
|---|---:|---|
| `reports/sustain-guard/2026-10-15T20-30-59.793Z-2e1e88/report.json` | 452859 | `630b9d78fe147842e1e761f682d0fbea7cda804eebdf7c5d1f23f10a63623c5c` |
| 同运行目录 `SHA256SUMS.json`（已逐项复核） | 3106 | `db1ceed1dedea11048120a4b611600cd2a222cde8e19c31321fd8ba85e3141cb` |
| `reports/sustain-guard/FINAL-CHROME-REVIEW.json` | 13270 | `8da5a67c0e7fb17735fc28de1b9c17e485d6aca960e31930a4c394417867782d` |

每次主轨操作的实际十三点另存 `steady-fixture-<fixtureId>-request-<sequence>.json`，fixture1/2 各 request1–4；全部原始事件、50ms 采样、诊断、Range 请求/响应、当轮 TS 原文与编译 fixture 在同运行目录，清单含字节与哈希。聚合 JSON 引用这些原文件，不修改已有报告 bytes。

该次 r14 Chrome 通过不覆盖 r13 STATIC_FAIL、旧三轮或旧启动滞后事实，也不构成 ArkWeb、系统 renderer、人耳可闻输出、生产持久化或真实生命周期验收。下一层须继续用实际原生连续 UI 与对应 renderer/receipt 证据判定。
