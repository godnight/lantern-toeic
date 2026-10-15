# 本地打包音轨 Range 宿主诊断

仅用于关联“用户手动继续”期间宿主收到的请求及返回的字节。此诊断不能证明解码器已消费字节、实际发声或唯一根因，也不能关闭既有 QA 缺陷。

实现位于 `harmony/entry/src/main/ets/pages/Index.ets` 的 `intercept`、`readAsset` 和本文件内的诊断辅助类。未修改 `AssetRange.ets`、Range/If-Range/HEAD 选择规则或响应头；同步打包 MP3 仍在 `intercept` 返回前设置 ready。没有新增等待、计时器、资源读取、权限、JS 注入或调试桥。

## 范围与上限

- 只有本地 origin 经安全路径解析后的 `web/audio/offline/<20位小写十六进制>.mp3` 进入日志。
- 每个进程最多记录 64 个请求，每个请求两行，达到上限后最多再输出一条 `phase=limit`；随后只停止诊断，仍照常返回媒体。预算不因换页或前后台切换重置，重启进程会重置。
- 路径只包含打包音轨的哈希标识，不记录完整 URL、查询、fragment、外链、认证头、Cookie、If-Range 原值、正文或用户录音。
- Range 仅保留不超过160字符的数字字节范围语法；空值记 `none`，过长记 `oversize`，任意其他文本记 `redacted`。清理空白仅用于日志，传入原 Range 算法的值不变。
- 单调时钟和日志调用均有独立异常保护；失败时丢弃日志或将时钟记为 `-1`，不将成功媒体响应改成404。

## 字段与采集

使用官方 `hilog.info(0x1001, 'LANTERN_RANGE', '%{public}s', ...)`，明确公开的内容仅为上述受限字段。无须打开 WebView 调试或添加权限。采集由根或 QA 在已授权设备窗口执行，例如：

```text
hdc -t <已授权目标> shell hilog -x -T LANTERN_RANGE
```

本次实现任务未执行该命令、SDK构建或任何设备操作；具体 SDK/设备是否输出及日志保留范围需由后续实际采集确认。原生 Range HiLog 路径不依赖网页 console。现已另加下述受控 `onConsole` 转发，普通网页 console 保持原处理；不能仅凭静态代码承诺默认 ArkWeb console 输出或新增标签已在设备实际采到。

| 字段 | 含义 |
|---|---|
| `v=1`、`id` | 格式版本、进程内递增请求编号；只在同次进程及相同音轨中关联 |
| `phase=request/ready` | 请求已由宿主接收／已执行 `setResponseIsReady(true)`；不是播放状态 |
| `uptimeMs` | `systemDateTime.getUptime(TimeType.STARTUP, false)`，启动后毫秒，包含深睡眠；API10起可用，当前最低API12 |
| `wallMs` | `Date.now()`毫秒，用于和前端/操作时间对齐；系统校时可能使其变化 |
| `elapsedMs` | 从该请求进入至本行的单调耗时；时钟不可用记 `-1` |
| `path`、`range`、`ifRange`、`head` | 受限本地路径、安全的原请求范围、If-Range有无、HEAD有无 |
| `code`、`contentRange` | ready行的200/206/416或资源失败404及真实Content-Range；request行code为0 |
| `bodyBytes`、`contentLength` | 实际响应体字节数及声明Content-Length；HEAD体为0而声明仍为完整文件长度；未设置长度记 `-1` |

例如，同一 `id` 的 request 与 ready 可确认是否命中非零 Range、是否被 If-Range 转为完整200、以及返回的206范围和体长是否相符。`range=none` 的200本身不证明错误；必须同时看前端请求的目标时间、原生 seek/playing/timeupdate 事件和实际播放进度。未出现日志也可能是超出预算、非目标路径或日志采集遗漏，不能单独推断宿主未收到请求。

## 播放控制器的受控 console 转发

原宿主没有 `onConsole`。本地官方SDK的 `web.d.ts` 定义了 `onConsole(Callback<OnConsoleEvent, boolean>)` 和 `event.message.getMessage(): string`，但未提供默认 `console.info` 必然可从HiLog检索的保证。为让下一轮具备明确采集路径，仅新增该官方只读事件回调，无JS注入、调试接口或额外权限。

先确认页面就绪、宿主仍存活且当前document为可信 `https://lantern.local/` origin，再仅接受精确前缀 `Bundled playback `、原始总长不超过4096字符的JSON。格式错误、未知stage/event、非法数值/布尔/范围等返回 `false`，普通console沿原有默认行为。校验通过后重新构造具名输出对象，返回 `true`；即使日志sink异常或达到上限也保持已处理，不因转发失败改变媒体逻辑。

日志标签为 `LANTERN_PLAYBACK`，同domain `0x1001`。格式为外层 `v/seq/uptimeMs/wallMs` 和内层 `data`；仅投影以下契约字段：

- `player/request`为正安全整数；`readyState`为0–4整数，`advances`为非负安全整数，`rate`在(0,16]。位置、baseline、耗时均为有限非负数。
- `current/duration/preparedDuration/preparedPosition/firstProgressPosition/firstProgressElapsed`允许有限非负数或null，保留元数据尚不可用的事实。
- `paused/seeking/muted/sourceMatches/metadataSeen/seekAssigned/seekEventSeen/seekComplete/playingSeen/interrupted`必须为布尔值。
- `seekable`最多8个有限非负、终点不小于起点的二元组；重新复制每个数字。`events`仅复制固定事件名下0–1,000,000的整数计数，任意未知key丢弃。
- stage仅 `metadata/paused-seek/confirming-progress/playing`。event固定为 `begin/load/loadedmetadata/canplay/progress/durationchange/seek-request/seeked/seek-settled/play/play-resolved/playing/timeupdate/waiting/stalled/abort/emptied/rejected/confirmed/confirmed-short-end/stop/pause/ended`。
- reason仅在 `rejected` 且属于固定18项失败原因时保留；其他字符串丢弃。异常仅保留有限数值code及固定 `AbortError/NotAllowedError/NotSupportedError/InvalidStateError/IndexSizeError/NetworkError/OperationError/SecurityError/TypeError/Error` 名称，其余名称省略。完整失败原因表见同文件 `PLAYBACK_REASONS`。

不输出原JSON、任意未知字段、URL、sourceId、来源行号、用户文本或异常message，也不调用 `getSourceId()`。全进程最多256条投影消息和一条限额提示，独立于Range的64请求预算。达到上限仍不影响播放或继续拦截固定安全诊断。采集使用同样的授权目标及 `hilog -x -T LANTERN_PLAYBACK`。

`data.player/request`关联前端播放器及其播放代次；它们不是Range日志的 `id`。结合宿主 `wallMs/uptimeMs`、UI所选固定音轨与Range path关联两组日志。该转发不声称已经实测ArkWeb触发、声音或设备日志可见性。

## 针对性验证

新增 `harmony/tests/media-range-diagnostics.test.cjs`：经 TypeScript AST 读取实际辅助类和宿主方法，执行真实 `AssetRange.ets`，仅替换系统时钟、HiLog和资源管理器。验证200/206/416、HEAD、If-Range、重复Range、精确字节/响应头、同步ready顺序、范围脱敏及64请求上限、时钟/日志异常，以及普通文档的原异步顺序。不会读取真实用户数据或操作设备。

```text
node --test harmony/tests/media-range-diagnostics.test.cjs harmony/tests/asset-range.test.cjs
```

上述为受控宿主逻辑回归，不替代 ArkTS SDK 编译、实际 ArkWeb、HiLog采集或独立QA。

2026-10-15 Range首轮聚焦检查14/14通过；增加受控console转发后，再运行上述命令一次，共20/20通过、退出码0（Range原14项＋转发新增6项）。转发检查覆盖可信document、普通console返回值、输入拒绝、白名单重建与隐私、256条上限、时钟/日志/消息读取异常；仍验证原206精确字节和同步ready。未运行全套、SDK或设备；实际ArkWeb回调和原生日志可见性仍待后续验证。
