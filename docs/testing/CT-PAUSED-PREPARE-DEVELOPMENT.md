# CT 暂停准备修订开发记录 — 2026-10-15

本轮独立树：`vocab-work/ct-paused-prepare-20261015/site`，分支 `fix/ct-paused-prepare-20261015`，基于已冻结 r12 `c62b3e22040d7960a0e28eaf6ddbd240caccf908`。r12 的口语布局修复保留。原 r11、r12 源码、工件和独立 QA 证据均不修改。本文件是开发实现与聚焦验证记录，不是原生验收结论、根因判定或发布授权。

## 问题与证据边界

依据项目组 `QA-DEFECT-CT-r11-RESUME-TIMEOUT-20261015.md`：原 PID 中，正常重入后从 14.376 秒选择 1× Continue，以及从约 10.2 秒选择 0.85× Continue 均在完整窗口内失败；0.85×显式 replay 也有失败。部分 1× replay、暖 Continue 和一次冷首 Continue 成功，只支持各自子路径。revision103 的 13.189→13.554 短暂确认随后失效，不能按首点差小于一秒当持续播放成功；该次 Home 动作没有执行，生命周期仍待测。

r11 已有 Range 支持，本次不归因为 r3 历史的全量 200 响应。QA 未读取实际 ArkWeb 元素的 readyState、seekable 或 duration，不能把静态等待路径宣称已证实的唯一根因。

## 实现行为

`lib/lesson-audio.ts` 保持现有 create/play/resume/pause/stop/dispose/position 与回调调用接口，未增加数据存储或 Blob fallback。

1. 用户开始请求时保留已确认 checkpoint 与请求代次。首次准备同一元素、来源变化或 suspension 标记后的下一次用户请求，在暂停状态设置 `preload='auto'` 并 `load()`；要求此轮新 metadata，旧 canplay/progress 和旧范围不代替它。普通暂停后的同源准备可以复用已加载资源。
2. 有效 metadata、有限正时长和同源成立后，在暂停状态尝试定位。seekable 区间作为诊断记录，空区间不再构成无限等待的前置。**currentTime setter 同步回显不是定位证明**。非零目标必须收到真实 seeked，等待 seeking=false，并核对同源和目标容差后才调用 play。非零目标不被自动改成从头播放。
3. play 前不播放，也不以静音播放解锁。控制器不改变原 muted 状态。自然位于零点的显式 replay 可免去伪造 seeked，仍须 metadata、同源及非 seeking。
4. 开始播放后，普通确认要求真实 playing，首 timeupdate 后至少三次前进更新，覆盖至少 750ms，且达到相应前进量及位置包络；首次 timeupdate 或 play promise resolve 不确认。waiting/stalled 清除尚未完成的观察窗口；重新开始必须重新收集完整证据。整个准备、定位与启动确认共用 10 秒上限。
5. 剩余播放按倍率不超过 1500ms 的短轨或短尾，提供保守自然结束路径：锁定 play 前 duration 和位置，结束时 duration 仍匹配；真实 playing 后经过与剩余时长相符的墙钟（至少期望时长的 80%），有实际前进 timeupdate，随后真实 ended 位于另一个更后位置且到达已知片尾，未发生播放期间 waiting/stalled 或错误。自然 timeupdate→pause→ended 顺序与只发 ended 的引擎序列均由同一验证处理。立即、同位置、未到片尾、长轨时长缩水或等待很久后瞬跳 ended 均不确认。非常短或低事件频率片段无法提供这些证据时可能安全失败；不为通过而补造进度。
6. 明确 pause/stop、换播放器、离页清理、dispose、定位或 play 错误、超时均使旧代次失效，清理定时器与事件监听；迟到 metadata/seeked/playing/progress 不会重启旧请求或写入零点。确认后若媒体紧接着失效，停止采样错误位置，终态诊断保留最后已确认基线；一次确认不意味着之后可无限持续播放。

### abort 的明确限制

load 自身可能中止旧资源并发出 abort，DOM 事件不携带应用请求 ID。本实现对新 metadata 前、仍处于暂停准备的 abort 记录诊断并继续有界等待；之后仍须完整新 metadata、真实暂停定位及持续播放证据，不把 abort 或旧进度当成功。metadata 后的 abort 会终止本次请求。用户、离页及后台入口通过显式 pause/stop 取消代次，不依赖单个 DOM abort 的归因。不能声称所有 metadata 前 abort 都立即取消，也不能据此宣称实际 ArkWeb 已恢复。

## 诊断契约

受控 console 前缀为 `Bundled playback `。player 为页面进程内递增播放器编号，request 为该播放器请求代次。记录固定 stage/event/reason、目标、当前点、基线、preparedPosition、preparedDuration、firstProgressPosition/firstProgressElapsed、readyState、duration、最多八个 seekable 区间、布尔状态及固定事件次数。每请求最多 32 条普通样本，confirmed/confirmed-short-end/rejected/stop/pause/ended 终态另外保留；不在确认后每个 timeupdate 持续输出日志。整个诊断读取、序列化、console 调用均防异常，不参与控制决策。

不记录 URL、sourceId、题目文本、账号、录音或任意异常 message；来源只给 sourceMatches 布尔值。宿主 onConsole 白名单投影与 `LANTERN_PLAYBACK` 时间关联由另一负责人实现，不能把 Web 日志当系统音流或 PCM 证据。

**定位与确认是两个时点。** preparedPosition 是播放前暂停定位的实际点；firstProgressPosition/Elapsed 是第一实际推进；confirmed 时 current 是收集持续证据之后的点。延迟确认回执比原保存点更后属于已播放时间，不能直接把该差值称为起播误差。原生定位精度须结合对应阶段和独立系统观测。

## 聚焦验证

执行 `node --test tests/audio-resume-confirmation.test.cjs tests/lesson-audio.test.cjs tests/continuous-audio-ui.test.cjs`：**43/43 通过**。原始输出见 `reports/ct-paused-prepare-audio-focused.log`。包括 29 项新控制器矩阵、8 项既有控制器兼容、6 项实际 SpeechPlayer 受控集成。验证使用明确事件与可控时钟的媒体夹具，不模拟已完成原生解码。

关键正例：新元素空 seekable 但可暂停 seek；真实 seeked 时 seeking 延迟清除；1×/0.85×/1.25×持续确认；同源暖准备与单次 suspension reload；短轨 0.4 秒、实际素材时长 1.049433 秒/1.15×、33.151519 秒轨的短尾；自然 pause→ended；初始 waiting 后完整播放。

关键负例：setter 回显而无 seeked；必须先 play 才能 seek 的引擎（**预期安全失败，play 次数为零**）；原 QA 样式的短进展后失效；首点/重复静止更新/play promise；waiting/stalled 后窗口不足；所有准备阶段取消、换源、迟到事件；即时或伪短结束、duration 缩短绕过、play 请求等待时间冒充实际播放时间；原点重置；诊断抛错与采样预算。React 测试保留未确认点不写入、后台取消、owner 切换与 DOM ref 先清空的卸载场景。

控制器 runtime SHA-256：`92511fccda5627add3809071a7148273d9a621a94970d43d9bd4daa82d360039`。只读复核针对同一快照，已修正 duration 锁定、自然结束事件顺序、实际 playing 计时与初始 buffering 边界；未发现新的实质问题。此结论仅限源码。

## 未验证与交接

本角色未运行构建、冻结、提交或设备操作。全根类型、其他测试、真实 Chrome 媒体与 SDK 构建由集成负责人接续。实际 ArkWeb 暂停 seek 是否可用仍待指定模拟器窗口验证；若真实引擎只能在 play 后完成 seek，本方案会停止并保旧点，应记录具体阶段再由 dot 决定下一步，不擅自引入静音偷播、Blob 或新 API 替换。

新统一候选需重新绑定原主轨/来源/非零点，分别验证 1×、0.85×正常重入、冷首恢复、重复 Continue、显式 replay、短词与短尾、保存返回、后台及重启，并以真实系统音流和持续 UI/回执对应确认；未完成的生命周期不能补算通过。r11 失败、原回执和所有旧成果保留。开发聚焦通过不关闭独立 QA 缺陷、不授权 push/合入/上传/发布/真机。
