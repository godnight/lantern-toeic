# CT-r15 显式动作重建播放器：只读集成审查

日期：2026-10-15。审查角色：ct_audio_review。工作树：`vocab-work/ct-explicit-player-20261015/site`，基线 `4eca4a3`。

结论：**STATIC_NO_NEW_BLOCKER，限下列源码身份及生命周期边界。** 未发现可静态证明的新保存点覆盖、旧回调接管或资源替换门禁缺陷。本结论不是原生修复完成、整体 QA PASS、发布批准或唯一根因判断。r14 原生 FAIL 及所有失败证据保留。

本轮只读源码、既有测试内容及项目规则，仅新增本文件；没有执行测试、构建、SDK、设备、Git 写操作。Blob 方案已暂停，未作为本候选实现、验证结果或回退路径。

## 审查身份

以下为工作区文件原始字节 SHA256，审查结束时再次核对。

| 文件 | SHA256 |
| --- | --- |
| `lib/explicit-bundled-playback.ts` | `5690e49f40217b1976909ede026c64bb46b13bd0d49830405e894f9f130b072a` |
| `app/learn/practice.tsx` | `88ade6b587b1b379c8c3b99d10e312912d19e57e9d1a85faaed49124c669a01c` |
| `lib/lesson-audio.ts` | `995e149e419909fa0c1de224d1725c334c6472ac4904241189a342266b07a9d0` |
| `lib/native-host.ts` | `80af3d1f2c95381ea1a00008b1584d2bbfc4a30ce3979b6073f5adcb784229c0` |
| `mobile/src/main.tsx` | `3ce6b5e9bf2221301c190a0d7690c46ed8413c3fca36fb6ac16fd313055c8f07` |
| `harmony/entry/src/main/ets/pages/Index.ets` | `e1f0558417f08217e5d61a014617f58eb2b060eb10071e37361d83e8fc9f28b4` |

`lesson-audio.ts` 已恢复为 r14 冻结原始字节；本次读取确认以上四个继承文件与当前 HEAD 内容相同。首次检出曾有 CRLF 字节差异，该中间字节身份不作为本结论身份。

## 已核对的生命周期边界

1. **每次显式动作一次真实元素替换。** wrapper `begin`（59 行起）先采样旧已确认点、增加 action generation、retire 旧 lease，再调用一次 factory。`SpeechPlayer`（49–56 行）通过 `document.createElement('audio')` 创建真实新元素并追加到隐藏 span。暂停或 stop 只取消当前动作、保留已暂停节点；下一次 play/resume/replay 才替换。挂载、恢复保存点、状态重渲染和前台恢复都不自行创建并播放媒体。
2. **旧节点完整退役。** `retire`（49–58 行）先使 lease 失效并清除 current，再解绑 timeupdate、dispose 旧 controller，依次 pause、移除 src、load 空资源、移除节点。释放步骤分别受保护；旧回调已无法在这些操作中接管新动作。先退役再创建也避免同一 wrapper 的两个活动音源并存。
3. **未确认新资源不得接管旧保存点。** `snapshot`（25–35 行）只从已确认 lease 采样。独立 baseline 不受新 inner 初始零点影响：已确认 17 秒后 replay(0)，若新资源仍在 metadata/seek/持续确认中就取消或失败，position 仍返回旧点；新 replay 经过原确认门禁后才可合法写回接近零的位置。首次非零 restore 则保留传入恢复点。
4. **回调重入和迟到事件受身份门禁约束。** `valid` 同时要求未 dispose、current lease 一致、live 且 action generation 一致；changed、failed、confirmed、tick 均先核验。confirmed/changed/tick 同步触发新动作或 dispose 后，旧回调没有后续写入新 lease 的步骤。当前错误先 changed(false) 后 failed 时仍可提示；若 changed 已触发换代，旧 failed 会被抑制。旧元素监听解绑及原 controller Promise/token 门禁共同隔离迟到媒体事件。
5. **React 不再拥有媒体 src。** JSX（77 行）仅持有隐藏 span；src 由每次 factory 写入，position/rate/playing/checkpoint 的重渲染不会把新节点改回旧节点或旧 src。逻辑 `bundled:<file>:<hash>`、trackId、材料 identity 保持原方案，不把 DOM 身份写入 checkpoint。
6. **保存回调与卸载绑定原材料。** effect 的 `captureOwn`（40–46 行）只读其闭包 player；同 renderSource identity 时用最新 onCheckpoint，换源清理时用原 callback 和原 source/track 字段。换源渲染即更新 renderSource，使旧 changed/confirmed/tick 在 effect cleanup 前也被阻断；旧 cleanup 不更新新 identity 的 offset/UI，也不读取新 playback.current。Practice 的 checkpoint/updateMaterial（92–93 行）读取当前 draft 内容，只修改闭包绑定的材料 identity，不用旧整份训练值覆盖后续编辑。
7. **退出、录音及后台停止链保留。** SpeechPlayer 的全局 stop、pagehide、hidden、native inactive 订阅均进入当前 effect 的 stopOwn。新 audio 追加在实际 DOM 下，既有 `querySelectorAll('audio,video').pause()` 仍可覆盖。`stopLessonAudio()` 继续先停止 active inner，再广播到各 wrapper；未播放或不拥有 checkpoint 的组件仍受 played/source/owner 门禁约束。组件卸载先捕获旧确认点，再 dispose，并解除全局/native 订阅。
8. **原媒体证明条件及宿主协议未放宽。** 新 wrapper 委托原 r14 controller；仍要求 metadata、暂停 seek、真实 seeked 和 settled、实际持续推进确认，保留 finite duration、500ms 连续链、短尾及旧点保护。普通本地 URL、Range/If-Range、速率、超时、诊断 schema、可信文档与宿主权限没有在这些继承源码中修改。新的 inner 自带递增 player 标识，现有宿主白名单仍可采集，无需新增桥或日志字段。

## 测试与待验边界

实现代理报告 wrapper 聚焦测试 14/14 通过；本审查只读了测试内容，没有复跑。覆盖内容包含元素替换、metadata/seek/确认期间取消、未确认 replay 失败保旧点、退休事件和 Promise、dispose、回调同步重入、factory 失败、换源及 global stop。该报告属于实现侧受控验证，不是本审查独立执行或原生证据；SpeechPlayer UI 回归结果以根代理实际产物为准。

这条改动直接避开“暂停后再次复用旧元素”的已观察失败路径，但不能静态证明 ArkWeb 底层资源已经恢复，也没有确定传输或解码器的唯一根因。必须用冻结构建继续记录至少：

- 主轨 1×、0.85× 各至少三轮真实暂停不少于 60 秒后主动继续，确认新元素/新 player 身份、原非零点及持续推进；不能以短暂停或第一次成功替代。
- 同一逻辑材料保存返回、冷启动、Home/前后台后保持静音直至主动点击，再核继续点及退出停止；核导出中实际 source/track/rate/position 与 revision。
- 0.7×、1.15×、明确从头播放、短尾、切句、切材料，以及录音开始时停止旧源；短尾稀疏事件可能按原严格门禁安全失败，不声称全短尾均支持。
- 任一 MediaError2、错误重启归零、旧源迟到接管或保存点污染，都停止该候选并保留首次失败；没有自动重试、Blob 或 Range 回退来覆盖失败。

剩余阻碍是冻结候选的实际原生验证与证据交接，不是已知的新静态阻断。本文件不关闭 r14 FAIL，也不授予 push、合入、上传、部署或发布权限。

## 追加：换源 playing 状态缺陷及限定修复复核

本节追加于同日，不覆盖上文的历史源码身份。根代理随后报告受控 UI 首轮 **12/13**，检出了 `practice.tsx` 的 `88ade6b…` 缺陷：旧资源正在播放时，组件保持挂载并切换 source identity；旧 dispose 的 changed(false) 被 retired/current 门禁正确阻止，但新 identity setup 未重置 `playingRef` 和 React playing 状态。旧 true 因而残留，新源第一次普通点击在 `play()` 的 69 行仅进入 pause 分支，没有创建新音频元素。先前静态审查没有识别此缺陷，`STATIC_NO_NEW_BLOCKER` 不能解释为该版本不存在缺陷；该首次 UI 失败须保留。

本次限定复核源码：`app/learn/practice.tsx` 原始字节 SHA256 **`b06a76bedb0b017876535463a37d98fc57529d85406e0b1334792167afd4b0a2`**。第 36 行仅在 `effectSource.current !== identity` 的 setup 内增加 `playingRef.current=false;setPlaying(false);`。只读逆向移除此唯一新增片段后，文件 SHA256 精确回到上文 `88ade6b…`，确认本轮差异仅此修复。

限定结论：新增同步 ref 重置使新源的首个普通点击可通过旧 playing 的暂停分支；React 状态重置同步按钮显示。重置只发生于新的逻辑 source/track identity，不触发 play/factory、不改变旧 cleanup 的材料归属，不改变 baseline、确认门禁、native 或其他运行源码。此次差异未发现新的静态阻断。根代理安排保留首轮失败，并用原测试不变复跑；**本审查未运行测试，尚不将该复跑或原生结果记为通过**。上文所有实际原生待验门槛继续有效。
